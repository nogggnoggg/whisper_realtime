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
import { refine } from './refine.js';
import { detectLang } from './lang.js';
import { toTraditional } from './zh-convert.js';
import { expressBasicAuth, verifyBasicAuthUpgrade, isAuthEnabled } from './basic-auth.js';
import {
  isDbEnabled,
  initDb,
  createSession,
  endSession,
  insertLog,
  findGlossaryTerms,    // exported for route-b agent consumption
  updateLogRefined,     // exported for route-b agent consumption
  listGlossaryTerms,
  createGlossaryTerm,
  updateGlossaryTerm,
  listRefinePrompts,
  createRefinePrompt,
  updateRefinePrompt,
  deleteRefinePrompt,
  getActiveRefinePrompt,
} from './db.js';

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
app.use(express.json());
app.get('/healthz', (req, res) => res.status(200).send('ok')); // Zeabur 健康檢查，不需驗證
app.use(expressBasicAuth); // 保護靜態頁與所有 /api/*
app.use(express.static(join(__dirname, '..', 'public')));

// ── REST API：詞彙表 ──────────────────────────────────────────────────────────

/** DB 停用時回 503 */
const requireDb = (req, res, next) => {
  if (!isDbEnabled()) {
    return res.status(503).json({ error: 'database disabled' });
  }
  next();
};

/**
 * GET /api/glossary
 * Query params: source_lang（可選）、target_lang（可選）
 * 回傳全部詞條；有帶 query 時依語言對過濾。
 */
app.get('/api/glossary', requireDb, async (req, res) => {
  try {
    const rows = await listGlossaryTerms(req.query.source_lang, req.query.target_lang);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/glossary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/glossary
 * Body: { source_lang, target_lang, source_term, target_term, enabled? }
 */
app.post('/api/glossary', requireDb, async (req, res) => {
  const { source_lang, target_lang, source_term, target_term, enabled } = req.body ?? {};
  if (!source_lang || !target_lang || !source_term || !target_term) {
    return res.status(400).json({
      error: 'source_lang, target_lang, source_term, target_term 為必填欄位',
    });
  }
  try {
    const row = await createGlossaryTerm({ source_lang, target_lang, source_term, target_term, enabled });
    if (!row) return res.status(500).json({ error: '新增失敗' });
    res.status(201).json(row);
  } catch (err) {
    console.error('[POST /api/glossary]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/glossary/:id
 * Body: { source_term?, target_term?, enabled? }（可部分更新）
 */
app.put('/api/glossary/:id', requireDb, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'id 必須為整數' });
  }
  const { source_term, target_term, enabled } = req.body ?? {};
  if (source_term === undefined && target_term === undefined && enabled === undefined) {
    return res.status(400).json({ error: '至少須提供 source_term、target_term 或 enabled 其一' });
  }
  try {
    const row = await updateGlossaryTerm(id, { source_term, target_term, enabled });
    if (!row) return res.status(404).json({ error: '找不到指定詞條' });
    res.json(row);
  } catch (err) {
    console.error('[PUT /api/glossary/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── REST API：Refine Prompt 庫 ────────────────────────────────────────────────

/**
 * GET /api/refine-prompts
 * 回傳全部 refine prompt 列表。
 */
app.get('/api/refine-prompts', requireDb, async (req, res) => {
  try {
    const rows = await listRefinePrompts();
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/refine-prompts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/refine-prompts
 * Body: { name, prompt_text, enabled? }
 */
app.post('/api/refine-prompts', requireDb, async (req, res) => {
  const { name, prompt_text, enabled } = req.body ?? {};
  if (!name || !prompt_text) {
    return res.status(400).json({ error: 'name 與 prompt_text 為必填欄位' });
  }
  try {
    const row = await createRefinePrompt({ name, prompt_text, enabled });
    if (!row) return res.status(500).json({ error: '新增失敗' });
    res.status(201).json(row);
  } catch (err) {
    console.error('[POST /api/refine-prompts]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/refine-prompts/:id
 * Body: { name?, prompt_text?, enabled?, is_active? }（可部分更新，至少一欄）
 */
app.put('/api/refine-prompts/:id', requireDb, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'id 必須為整數' });
  }
  const { name, prompt_text, enabled, is_active } = req.body ?? {};
  if (name === undefined && prompt_text === undefined && enabled === undefined && is_active === undefined) {
    return res.status(400).json({ error: '至少須提供 name、prompt_text、enabled 或 is_active 其一' });
  }
  try {
    const row = await updateRefinePrompt(id, { name, prompt_text, enabled, is_active });
    if (!row) return res.status(404).json({ error: '找不到指定 prompt' });
    res.json(row);
  } catch (err) {
    console.error('[PUT /api/refine-prompts/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/refine-prompts/:id
 */
app.delete('/api/refine-prompts/:id', requireDb, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'id 必須為整數' });
  }
  try {
    await deleteRefinePrompt(id);
    res.status(204).end();
  } catch (err) {
    console.error('[DELETE /api/refine-prompts/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const httpServer = createServer(app);

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  verifyClient: (info, cb) => {
    if (verifyBasicAuthUpgrade(info.req)) cb(true);
    else cb(false, 401, 'Unauthorized');
  },
});

wss.on('connection', (clientWs) => {
  // Per-connection session state
  const session = {
    /** @type {OpenAISTTSession|null} */
    stt: null,
    /** true = between audio.start and audio.stop */
    active: false,
    /** @type {ReturnType<typeof setTimeout>|null} */
    idleTimer: null,
    /** DB session id（createSession() 回傳的 UUID，DB 停用時 null） */
    dbSessionId: /** @type {string|null} */ (null),
    /** 本段發言的 audio mode（取自 audio.start 的 mode 欄位） */
    audioMode: /** @type {string|null} */ (null),
    /** 精準翻譯開關（從 settings 訊息更新） */
    refinedEnabled: false,
    /** itemId → DB log id（供 Route B agent 更新精準翻譯用） */
    logMap: /** @type {Map<string,number>} */ (new Map()),
    /** 最近 5 段對話上下文，供 Route B 精準翻譯使用 */
    context: /** @type {Array<{sourceText:string, translation:string}>} */ ([]),
  };

  // 建立 DB session（非阻塞；DB 停用時 id 為 null）
  createSession().then((id) => { session.dbSessionId = id; }).catch(() => {});

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

  /** 清理 STT 連線、計時器，並結束 DB session */
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
    // 結束 DB session（dbSessionId 置 null 防止重複呼叫）
    if (session.dbSessionId) {
      const sid = session.dbSessionId;
      session.dbSessionId = null;
      endSession(sid).catch(() => {});
    }
  };

  // ── 初始化 STT session ────────────────────────────────────────────────────

  const initSTT = async () => {
    try {
      const stt = new OpenAISTTSession(API_KEY, {
        // draft: STT 回報轉錄中暫定文字（已累積全文）
        // 中文 draft 同樣轉繁體，英文字元不受影響
        onDraft: (itemId, text) => {
          send({ type: 'draft', itemId, text: toTraditional(text) });
        },

        // final: 轉錄完成 → 偵測語言 → 回 final → 翻譯 → 回 translation → 寫 log
        onFinal: async (itemId, text) => {
          try {
            // 空白片段過濾：trim 後為空 → 不送 final、不翻譯、不寫 log，直接略過
            if (!text || text.trim() === '') {
              send({ type: 'status', state: 'ready' });
              return;
            }

            const lang = detectLang(text);
            // 中文原文：轉繁體後再送前端與後續翻譯
            const finalText = lang === 'zh' ? toTraditional(text) : text;
            const ts = new Date()
              .toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

            // 1. 送出正式原文
            send({ type: 'final', itemId, text: finalText, lang, ts });
            send({ type: 'status', state: 'processing' });

            // 2. 翻譯（使用已轉繁體的 finalText 作為原文）
            let translatedText = '';
            try {
              translatedText = await translate(finalText, lang);
            } catch (err) {
              console.error('[translate] error:', err.message);
              send({ type: 'error', message: `翻譯失敗：${err.message}` });
            }

            // 3. 送出翻譯結果（即使翻譯失敗也送 ready）
            // 英文→中文翻譯結果保底過一次繁體轉換
            let translationOut = '';
            if (translatedText) {
              translationOut = lang === 'en' ? toTraditional(translatedText) : translatedText;
              send({ type: 'translation', itemId, text: translationOut });
            }

            // 4. 寫入翻譯 log（DB 停用時為 no-op）
            //    targetLang 是翻譯目標語言，目前只支援 zh↔en 兩向
            const targetLang = lang === 'zh' ? 'en' : 'zh';

            // 在寫 log 前先快照上下文（不含本次發言，供 Route B 使用）
            const contextSnapshot = [...session.context];

            const logId = await insertLog({
              sessionId:         session.dbSessionId,
              ts,
              sourceLang:        lang,
              targetLang,
              sourceText:        finalText,
              rtTranslation:     translationOut,
              audioMode:         session.audioMode,
              thresholdPct:      null,   // 前端尚未在 audio.start 傳入，留 null
              refinementEnabled: session.refinedEnabled,
            });
            // 保存 itemId → logId 對應，供 Route B agent 呼叫 updateLogRefined()
            if (logId != null) {
              session.logMap.set(itemId, logId);
            }

            // 5. 更新對話上下文（保留最近 5 段，本次發言在此後才加入）
            session.context.push({ sourceText: finalText, translation: translationOut });
            if (session.context.length > 5) session.context.shift();

            // 6. Route B 精準翻譯（若已啟用，非同步執行，不阻塞主流程）
            if (session.refinedEnabled) {
              const routeBLogId = logId;
              (async () => {
                try {
                  const glossaryTerms = await findGlossaryTerms(lang, targetLang, finalText);
                  const activePrompt = await getActiveRefinePrompt();
                  const customInstructions = activePrompt?.prompt_text ?? null;
                  const refinedRaw = await refine({
                    sourceText:    finalText,
                    sourceLang:    lang,
                    targetLang,
                    rtTranslation: translationOut,
                    glossaryTerms,
                    context:       contextSnapshot,
                    customInstructions,
                  });
                  if (!refinedRaw) return;
                  // 目標語言為中文時過繁體轉換
                  const refinedOut = targetLang === 'zh' ? toTraditional(refinedRaw) : refinedRaw;
                  send({ type: 'refined', itemId, text: refinedOut });
                  if (routeBLogId != null) {
                    await updateLogRefined(routeBLogId, refinedOut, glossaryTerms);
                  }
                } catch (err) {
                  console.warn('[route-b] 精準翻譯失敗:', err.message);
                  send({ type: 'refined_error', itemId, message: err.message });
                }
              })();
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
      case 'settings': {
        // Phase 2 新增：精準翻譯開關（連線後與切換時送）
        if (typeof msg.refined === 'boolean') {
          session.refinedEnabled = msg.refined;
        }
        break;
      }

      case 'audio.start': {
        if (!session.stt) {
          send({
            type: 'error',
            message: 'STT session 尚未就緒，請稍候再試',
          });
          return;
        }
        // 記錄本段發言的觸發模式（manual / auto），供後續 log 使用
        session.audioMode = typeof msg.mode === 'string' ? msg.mode : null;
        session.active = true;
        send({ type: 'status', state: 'listening' });
        break;
      }

      case 'audio.stop': {
        if (!session.active) return;
        session.active = false;
        // msg.discard 由前端有效語音時長 gating 決定（D-018）
        if (msg.discard) {
          // 極短誤觸發：丟棄緩衝、不轉錄、不建卡
          session.stt?.clear();
          send({ type: 'status', state: 'ready' });
        } else {
          // 提交音訊，觸發 OpenAI 轉錄 → onFinal callback
          // status 會在 onFinal 完成後更新為 processing → ready
          session.stt?.commit();
        }
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

// initDb() 先行，失敗不阻礙啟動（db.js 內部已 catch 並警告）
try {
  await initDb();
} catch (err) {
  console.warn('[startup] initDb 意外錯誤（非致命）:', err.message);
}

httpServer.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
  console.log(`WebSocket     → ws://localhost:${PORT}/ws`);
  if (isAuthEnabled()) {
    console.log('Basic Auth 已啟用');
  } else {
    console.warn('⚠  警告：BASIC_AUTH_USERS 未設，全站開放（無任何存取保護）');
  }
});
