/**
 * server/index.js — Express 靜態服務 + WebSocket server + session 管理
 *
 * 職責：
 *   - 以 Express 服務 public/ 靜態檔
 *   - 升級 /ws 路徑為 WebSocket（純 ws 套件，非 Socket.IO）
 *   - 每個瀏覽器連線維護一個 session 物件，含獨立 OpenAI STT 連線
 *   - 轉發協定訊息（audio.start / binary PCM / audio.stop）
 *   - 收到 STT final 後：lang.js 偵測語言 → 回 final → translate.js → 回 translation
 *   - 閒置 30 分鐘自動結束 session
 *   - 完整錯誤處理：API key 缺失、OpenAI 斷線均回 error/status，server 不 crash
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OpenAISTTSession } from './openai-stt.js';
import { translate } from './translate.js';
import { detectLang } from './lang.js';

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const API_KEY = process.env.OPENAI_API_KEY;
const IDLE_TIMEOUT_MS = 30 * 60 * 1_000; // 30 分鐘

const __dirname = dirname(fileURLToPath(import.meta.url));

// API key 缺失 → 印出清楚錯誤訊息後退出（不讓 server 在無效狀態下運行）
if (!API_KEY) {
  console.error('');
  console.error('ERROR: OPENAI_API_KEY 未設定。');
  console.error('請在專案根目錄建立 .env 檔案並填入：');
  console.error('  OPENAI_API_KEY=sk-...');
  console.error('');
  process.exit(1);
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.static(join(__dirname, '..', 'public')));

const httpServer = createServer(app);

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (clientWs) => {
  // Per-connection session state
  const session = {
    /** @type {OpenAISTTSession|null} */
    stt: null,
    /** true = between audio.start and audio.stop */
    active: false,
    /** @type {ReturnType<typeof setTimeout>|null} */
    idleTimer: null,
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** 向此客戶端送出 JSON 訊息 */
  const send = (obj) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(obj));
    }
  };

  /** 重設閒置計時器 */
  const resetIdle = () => {
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      send({
        type: 'status',
        state: 'error',
        message: '連線閒置逾時（30 分鐘），請重新整理頁面',
      });
      teardown();
      clientWs.close(1000, 'idle timeout');
    }, IDLE_TIMEOUT_MS);
  };

  /** 清理 STT 連線與計時器 */
  const teardown = () => {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.stt) {
      session.stt.close();
      session.stt = null;
    }
    session.active = false;
  };

  // ── 初始化 STT session ────────────────────────────────────────────────────

  const initSTT = async () => {
    try {
      const stt = new OpenAISTTSession(API_KEY, {
        // draft: STT 回報轉錄中暫定文字（已累積全文）
        onDraft: (itemId, text) => {
          send({ type: 'draft', itemId, text });
        },

        // final: 轉錄完成 → 偵測語言 → 回 final → 翻譯 → 回 translation
        onFinal: async (itemId, text) => {
          try {
            if (!text || text.trim() === '') {
              // 空轉錄不建卡片
              send({ type: 'status', state: 'ready' });
              return;
            }

            const lang = detectLang(text);
            const ts = new Date()
              .toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 1. 送出正式原文
            send({ type: 'final', itemId, text, lang, ts });
            send({ type: 'status', state: 'processing' });

            // 2. 翻譯
            let translatedText = '';
            try {
              translatedText = await translate(text, lang);
            } catch (err) {
              console.error('[translate] error:', err.message);
              send({ type: 'error', message: `翻譯失敗：${err.message}` });
            }

            // 3. 送出翻譯結果（即使翻譯失敗也送 ready）
            if (translatedText) {
              send({ type: 'translation', itemId, text: translatedText });
            }

            send({ type: 'status', state: 'ready' });
          } catch (err) {
            console.error('[onFinal handler] error:', err.message);
            send({ type: 'error', message: `後處理失敗：${err.message}` });
            send({ type: 'status', state: 'ready' });
          }
        },

        onError: (message) => {
          console.error('[stt] error:', message);
          send({ type: 'error', message });
          send({ type: 'status', state: 'error', message });
        },

        onReady: () => {
          send({ type: 'status', state: 'ready' });
        },
      });

      await stt.connect();
      session.stt = stt;
      resetIdle();
    } catch (err) {
      console.error('[initSTT] failed:', err.message);
      send({
        type: 'error',
        message: `無法連線至 OpenAI Realtime API：${err.message}`,
      });
      send({
        type: 'status',
        state: 'error',
        message: 'OpenAI 連線失敗，請重新整理頁面',
      });
    }
  };

  initSTT();

  // ── 訊息處理 ──────────────────────────────────────────────────────────────

  clientWs.on('message', (data, isBinary) => {
    resetIdle();

    // ── 二進位 frame：PCM16 音訊塊 ─────────────────────────────────────────
    if (isBinary) {
      if (!session.active) return; // audio.start 前的 binary frame 一律忽略
      session.stt?.sendAudio(Buffer.from(data));
      return;
    }

    // ── 文字 frame：JSON 控制訊息 ─────────────────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      send({ type: 'error', message: '收到無效的 JSON 訊息' });
      return;
    }

    switch (msg.type) {
      case 'audio.start': {
        if (!session.stt) {
          send({
            type: 'error',
            message: 'STT session 尚未就緒，請稍候再試',
          });
          return;
        }
        session.active = true;
        send({ type: 'status', state: 'listening' });
        break;
      }

      case 'audio.stop': {
        if (!session.active) return;
        session.active = false;
        // 提交音訊，觸發 OpenAI 轉錄 → onFinal callback
        session.stt?.commit();
        // status 會在 onFinal 完成後更新為 processing → ready
        break;
      }

      default: {
        send({ type: 'error', message: `未知的訊息類型：${msg.type}` });
        break;
      }
    }
  });

  // ── 客戶端中斷連線 ────────────────────────────────────────────────────────

  clientWs.on('close', () => {
    teardown();
  });

  clientWs.on('error', (err) => {
    console.error('[ws client] error:', err.message);
    teardown();
  });
});

// ── 啟動伺服器 ───────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
  console.log(`WebSocket     → ws://localhost:${PORT}/ws`);
});
