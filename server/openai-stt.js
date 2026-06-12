/**
 * server/openai-stt.js — OpenAI Realtime API transcription session 客戶端
 *
 * 連線細節（2026-06-12 以 scripts/probe-realtime.mjs 實測 GA API 確認）：
 *   URL     : wss://api.openai.com/v1/realtime?intent=transcription
 *   Headers : Authorization: Bearer <OPENAI_API_KEY>
 *   （GA 版不需要 OpenAI-Beta header；模型放在 session.audio.input.transcription.model）
 *
 * ── 2026-06-12 實測參數支援結果（以 OpenAI key 對 GA API 直測，以下為唯一依據）─────────
 *
 *   delay（精度/延遲權衡）
 *     路徑  : session.audio.input.transcription.delay
 *     合法值: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
 *     注意  : session.updated 不 echo 此欄，但 API 有驗證（非法值回 invalid_value）
 *     環境變數: STT_DELAY，預設 'medium'（偏精度）
 *
 *   noise_reduction（降噪）
 *     路徑  : session.audio.input.noise_reduction，值為物件 { type: string }
 *     合法值: 'near_field' | 'far_field'；null 明確關閉；'auto' 被拒（invalid_value）
 *     session.updated 原樣 echo 確認
 *     環境變數: STT_NOISE_REDUCTION，預設 'near_field'；設為 'off' 時不送此欄位
 *
 *   prompt（轉錄提示詞）
 *     路徑  : session.audio.input.transcription.prompt
 *     僅 gpt-4o-transcribe 支援；gpt-realtime-whisper 使用時回 invalid_value
 *     session.updated 原樣 echo 確認（gpt-4o-transcribe）
 *     環境變數: STT_PROMPT，留空使用內建工廠術語預設值
 *
 *   gpt-4o-transcribe
 *     可作為 session.audio.input.transcription.model 使用，session.updated echo 確認
 *     額外優勢：支援 prompt 欄位（gpt-realtime-whisper 不支援）
 *
 *   不支援的候選路徑（全部回 unknown_parameter，不送）：
 *     session.audio.input.transcription.latency
 *     session.delay / session.latency
 *     session.audio.input.latency / session.audio.input.delay
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * 初始化流程：
 *   1. 建立 WebSocket 連線
 *   2. 收到 session.created 後送出 session.update（關閉 server VAD、設定 PCM16 輸入）
 *   3. 收到 session.updated 後視為 ready，呼叫 onReady callback
 *   4. 若 session.update 後在 ready 達成前收到 error，自動以最小組態重試一次
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
const CONNECT_TIMEOUT_MS = 15_000;

// ── 環境變數讀取（模組載入時固定，重啟後生效）─────────────────────────────────────────

/** 轉錄模型。支援 'gpt-realtime-whisper'（不支援 prompt）/ 'gpt-4o-transcribe'（支援 prompt）*/
const STT_MODEL = process.env.STT_MODEL ?? 'gpt-realtime-whisper';

/**
 * 精度/延遲權衡。合法值：'minimal'|'low'|'medium'|'high'|'xhigh'
 * 預設 'medium'（偏精度，適合工廠術語辨識）
 */
const STT_DELAY = process.env.STT_DELAY ?? 'medium';

/**
 * 降噪模式。合法值：'near_field'（近場麥）/'far_field'（遠場）/'off'（不送欄位）
 * 預設 'near_field'（適合配戴式或桌上麥）
 */
const STT_NOISE_REDUCTION = process.env.STT_NOISE_REDUCTION ?? 'near_field';

/** 工廠術語提示詞預設值（僅 gpt-4o-transcribe 支援；gpt-realtime-whisper 不送此欄）*/
const FACTORY_PROMPT_DEFAULT =
  '品保 QA、隔離區 quarantine area、停線 stop the line、卡料 material jam、' +
  '首件檢查 first article inspection、良品 good parts、不良品 defective parts、' +
  '出貨 ship、貼標籤 label';

/**
 * 轉錄提示詞。留空使用工廠術語預設值；設為任意字串覆蓋；僅對 gpt-4o-transcribe 生效。
 * 注意：process.env.STT_PROMPT === '' 時視為「明確不送提示詞」。
 */
const STT_PROMPT =
  process.env.STT_PROMPT !== undefined ? process.env.STT_PROMPT : FACTORY_PROMPT_DEFAULT;

// ─────────────────────────────────────────────────────────────────────────────────────

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
    /** graceful degrade 旗標：session.update 錯誤時最多重試一次 */
    this._sessionUpdateRetried = false;
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
      const url = `${OPENAI_REALTIME_WS}?intent=transcription`;

      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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

  /**
   * 建立完整 session.update payload（含所有實測支援的精度欄位）
   * @returns {object}
   */
  _buildSessionUpdate() {
    /** @type {Record<string, unknown>} */
    const transcription = { model: STT_MODEL };

    // delay：session.audio.input.transcription.delay（實測確認，不在 session.updated echo）
    if (STT_DELAY) {
      transcription.delay = STT_DELAY;
    }

    // prompt：僅 gpt-4o-transcribe 支援；gpt-realtime-whisper 送此欄會收到 invalid_value
    if (STT_MODEL === 'gpt-4o-transcribe' && STT_PROMPT) {
      transcription.prompt = STT_PROMPT;
    }

    /** @type {Record<string, unknown>} */
    const audioInput = {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription,
      turn_detection: null, // manual commit mode（前端自行控制起訖）
    };

    // noise_reduction：{ type: 'near_field'|'far_field' }；'off' 時不送欄位
    if (STT_NOISE_REDUCTION && STT_NOISE_REDUCTION !== 'off') {
      audioInput.noise_reduction = { type: STT_NOISE_REDUCTION };
    }

    return {
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: { input: audioInput },
      },
    };
  }

  /**
   * 建立最小 session.update payload（graceful degrade 重試用）
   * 只含 format + transcription.model，去除所有可能觸發錯誤的欄位
   * @returns {object}
   */
  _buildMinimalSessionUpdate() {
    return {
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: { model: STT_MODEL },
            turn_detection: null,
          },
        },
      },
    };
  }

  /** @param {object} evt @param {()=>void} onReady */
  _handle(evt, onReady) {
    switch (evt.type) {
      case 'session.created': {
        // 重設重試旗標（以防重連）
        this._sessionUpdateRetried = false;
        // 送出含所有實測支援欄位的完整 session.update
        this._send(this._buildSessionUpdate());
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
        // Graceful degrade：若 ready 尚未達成且尚未重試，改送最小組態重試一次
        if (!this.ready && !this._sessionUpdateRetried) {
          this._sessionUpdateRetried = true;
          const errMsg =
            evt.error?.message ??
            (typeof evt.error === 'string' ? evt.error : JSON.stringify(evt.error ?? evt));
          console.warn(
            `[openai-stt] session.update 錯誤（${errMsg}），降級為最小組態重試...`
          );
          this._send(this._buildMinimalSessionUpdate());
          // 暫不上報錯誤，等待 session.updated 或下一個 error 事件
          return;
        }
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
    // 注意：只檢查 WS 連線狀態，不檢查 ready —
    // 初始的 session.update 必須在 ready=false 時送出
    if (this.ws?.readyState === WebSocket.OPEN) {
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
