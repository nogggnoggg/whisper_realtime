/**
 * server/openai-stt.js — OpenAI Realtime API transcription session 客戶端
 *
 * 連線細節（依 2026-06 OpenAI 文件確認）：
 *   URL     : wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper
 *   Headers : Authorization: Bearer <OPENAI_API_KEY>
 *             OpenAI-Beta: realtime=v1
 *
 * 初始化流程：
 *   1. 建立 WebSocket 連線
 *   2. 收到 session.created 後送出 session.update（關閉 server VAD、設定 PCM16 輸入）
 *   3. 收到 session.updated 後視為 ready，呼叫 onReady callback
 *
 * 音訊傳輸：
 *   - sendAudio(buffer) → input_audio_buffer.append（base64 encoded PCM16LE 24kHz mono）
 *   - commit()          → input_audio_buffer.commit（觸發轉錄）
 *
 * 轉錄事件：
 *   - conversation.item.input_audio_transcription.delta     → onDraft(itemId, accumulatedText)
 *   - conversation.item.input_audio_transcription.completed → onFinal(itemId, transcript)
 *   - error                                                  → onError(message)
 */

import WebSocket from 'ws';

const OPENAI_REALTIME_WS = 'wss://api.openai.com/v1/realtime';
const MODEL = 'gpt-realtime-whisper';
const CONNECT_TIMEOUT_MS = 15_000;

export class OpenAISTTSession {
  /**
   * @param {string} apiKey OpenAI API key
   * @param {{
   *   onDraft : (itemId: string, text: string) => void,
   *   onFinal : (itemId: string, transcript: string) => void,
   *   onError : (message: string) => void,
   *   onReady?: () => void,
   * }} callbacks
   */
  constructor(apiKey, callbacks) {
    this.apiKey = apiKey;
    this.cb = callbacks;
    /** @type {WebSocket|null} */
    this.ws = null;
    this.ready = false;
    /** @type {Map<string, string>} itemId → accumulated draft text */
    this.drafts = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * 建立 WebSocket 連線並等待 session ready
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      const url = `${OPENAI_REALTIME_WS}?model=${MODEL}`;

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });

      let resolved = false;
      const settle = (fn, arg) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          fn(arg);
        }
      };

      const timer = setTimeout(() => {
        settle(reject, new Error('OpenAI Realtime 連線逾時'));
        this._closeWs();
      }, CONNECT_TIMEOUT_MS);

      this.ws.on('open', () => {
        // Connection open — wait for session.created before sending session.update
      });

      this.ws.on('message', (raw) => {
        let evt;
        try {
          evt = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this._handle(evt, () => settle(resolve, undefined));
      });

      this.ws.on('error', (err) => {
        const msg = `OpenAI Realtime WebSocket 錯誤：${err.message}`;
        if (!resolved) {
          settle(reject, new Error(msg));
        } else {
          this.cb.onError(msg);
        }
      });

      this.ws.on('close', (code, reason) => {
        this.ready = false;
        // 1000 = normal close, ignore; anything else is unexpected
        if (code !== 1000 && resolved) {
          this.cb.onError(
            `OpenAI Realtime 連線意外中斷（${code}：${reason?.toString() ?? ''}）`
          );
        }
      });
    });
  }

  /**
   * 送出 PCM16LE mono 24kHz 音訊 buffer（audio.start 後呼叫）
   * @param {Buffer} pcm16Buffer
   */
  sendAudio(pcm16Buffer) {
    if (!this._isOpen()) return;
    this._send({
      type: 'input_audio_buffer.append',
      audio: pcm16Buffer.toString('base64'),
    });
  }

  /**
   * 提交本段音訊，觸發轉錄（audio.stop 時呼叫）
   */
  commit() {
    if (!this._isOpen()) return;
    this._send({ type: 'input_audio_buffer.commit' });
  }

  /**
   * 關閉連線，釋放資源
   */
  close() {
    this.ready = false;
    this.drafts.clear();
    this._closeWs();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** @param {object} evt @param {()=>void} onReady */
  _handle(evt, onReady) {
    switch (evt.type) {
      case 'session.created': {
        // Configure the session: disable server VAD, set PCM16 input + transcription model
        this._send({
          type: 'session.update',
          session: {
            input_audio_format: 'pcm16',
            input_audio_transcription: {
              model: MODEL,
            },
            turn_detection: null, // manual commit mode
          },
        });
        break;
      }

      case 'session.updated': {
        if (!this.ready) {
          this.ready = true;
          this.cb.onReady?.();
          onReady();
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.delta': {
        const itemId = evt.item_id ?? evt.itemId ?? '';
        const delta = evt.delta ?? '';
        const prev = this.drafts.get(itemId) ?? '';
        const accumulated = prev + delta;
        this.drafts.set(itemId, accumulated);
        if (itemId && accumulated) {
          this.cb.onDraft(itemId, accumulated);
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const itemId = evt.item_id ?? evt.itemId ?? '';
        // Use transcript field; fall back to accumulated draft if empty
        const transcript =
          evt.transcript ??
          evt.text ??
          this.drafts.get(itemId) ??
          '';
        this.drafts.delete(itemId);
        if (itemId) {
          this.cb.onFinal(itemId, transcript);
        }
        break;
      }

      case 'error': {
        const msg =
          evt.error?.message ??
          (typeof evt.error === 'string' ? evt.error : JSON.stringify(evt));
        this.cb.onError(`OpenAI Realtime API 錯誤：${msg}`);
        break;
      }

      // All other events (input_audio_buffer.committed, conversation.item.created, etc.)
      default:
        break;
    }
  }

  _send(obj) {
    if (this._isOpen()) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _isOpen() {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  _closeWs() {
    if (this.ws) {
      try {
        this.ws.close(1000, 'session ended');
      } catch {
        // ignore close errors
      }
      this.ws = null;
    }
  }
}
