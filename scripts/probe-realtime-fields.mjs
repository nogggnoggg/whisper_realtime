/**
 * probe-realtime-fields.mjs
 * 實測 OpenAI Realtime transcription session 的進階欄位
 * 用法：node scripts/probe-realtime-fields.mjs
 *
 * 每個 variant 建立一條獨立 WS 連線，送出 session.update，
 * 記錄 session.updated 回傳值或 error 訊息後關閉。
 * API key 從 .env 的 OPENAI_API_KEY 載入，絕不印出。
 */
import 'dotenv/config';
import WebSocket from 'ws';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('[probe] OPENAI_API_KEY not set'); process.exit(1); }

const URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const TIMEOUT_MS = 12_000;

// ─────────────────────────────────────────────────────────────────────────────
// 每個 variant 描述：{ label, session } — session 物件直接作為 session.update.session
// ─────────────────────────────────────────────────────────────────────────────
const BASE_AUDIO = {
  format: { type: 'audio/pcm', rate: 24000 },
  transcription: { model: 'gpt-realtime-whisper' },
  turn_detection: null,
};

const VARIANTS = [
  // ── 原始基準線 ──────────────────────────────────────────────────────────────
  {
    label: 'baseline',
    session: {
      type: 'transcription',
      audio: { input: { ...BASE_AUDIO } },
    },
  },

  // ── gpt-4o-transcribe 作為 transcription model ──────────────────────────────
  {
    label: 'model_gpt4o_transcribe',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: { model: 'gpt-4o-transcribe' },
        },
      },
    },
  },

  // ── 精度/延遲候選 1：audio.input.transcription.delay ────────────────────────
  {
    label: 'delay_transcription_delay_medium',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: { model: 'gpt-realtime-whisper', delay: 'medium' },
        },
      },
    },
  },

  // ── 精度/延遲候選 2：audio.input.transcription.latency ─────────────────────
  {
    label: 'delay_transcription_latency_medium',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: { model: 'gpt-realtime-whisper', latency: 'medium' },
        },
      },
    },
  },

  // ── 精度/延遲候選 3：session 頂層 delay ────────────────────────────────────
  {
    label: 'delay_session_top_delay_medium',
    session: {
      type: 'transcription',
      delay: 'medium',
      audio: { input: { ...BASE_AUDIO } },
    },
  },

  // ── 精度/延遲候選 4：session 頂層 latency ─────────────────────────────────
  {
    label: 'delay_session_top_latency_medium',
    session: {
      type: 'transcription',
      latency: 'medium',
      audio: { input: { ...BASE_AUDIO } },
    },
  },

  // ── 精度/延遲候選 5：audio.input.latency ──────────────────────────────────
  {
    label: 'delay_audio_input_latency_medium',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          latency: 'medium',
        },
      },
    },
  },

  // ── 精度/延遲候選 6：audio.input.delay ────────────────────────────────────
  {
    label: 'delay_audio_input_delay_medium',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          delay: 'medium',
        },
      },
    },
  },

  // ── 若 delay 欄位存在，也試 "minimal" 與 "xhigh" 極端值 ──────────────────
  // （先確認欄位名後再跑；這裡直接全試，靠 error 反饋）
  {
    label: 'delay_transcription_delay_minimal',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: { model: 'gpt-realtime-whisper', delay: 'minimal' },
        },
      },
    },
  },
  {
    label: 'delay_transcription_delay_xhigh',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: { model: 'gpt-realtime-whisper', delay: 'xhigh' },
        },
      },
    },
  },

  // ── noise_reduction near_field ─────────────────────────────────────────────
  {
    label: 'noise_reduction_near_field',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          noise_reduction: { type: 'near_field' },
        },
      },
    },
  },

  // ── noise_reduction far_field ──────────────────────────────────────────────
  {
    label: 'noise_reduction_far_field',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          noise_reduction: { type: 'far_field' },
        },
      },
    },
  },

  // ── noise_reduction auto ───────────────────────────────────────────────────
  {
    label: 'noise_reduction_auto',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          noise_reduction: { type: 'auto' },
        },
      },
    },
  },

  // ── noise_reduction null（明確關閉）──────────────────────────────────────
  {
    label: 'noise_reduction_null',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          noise_reduction: null,
        },
      },
    },
  },

  // ── prompt 中英混合術語 ────────────────────────────────────────────────────
  {
    label: 'prompt_factory_terms',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: {
            model: 'gpt-realtime-whisper',
            prompt:
              '品保 QA、隔離區 quarantine area、停線 stop the line、' +
              '卡料 material jam、首件檢查 first article inspection、' +
              '良品 good parts、不良品 defective parts',
          },
        },
      },
    },
  },

  // ── gpt-4o-transcribe + prompt ────────────────────────────────────────────
  {
    label: 'gpt4o_transcribe_with_prompt',
    session: {
      type: 'transcription',
      audio: {
        input: {
          ...BASE_AUDIO,
          transcription: {
            model: 'gpt-4o-transcribe',
            prompt:
              '品保 QA、隔離區 quarantine area、停線 stop the line、' +
              '卡料 material jam、首件檢查 first article inspection',
          },
        },
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 執行單一 variant
// ─────────────────────────────────────────────────────────────────────────────
function runVariant(v) {
  return new Promise((resolve) => {
    const result = { label: v.label, status: 'unknown', detail: null };
    let done = false;

    const finish = (status, detail) => {
      if (done) return;
      done = true;
      result.status = status;
      result.detail = detail;
      try { ws.close(1000); } catch { /* ignore */ }
      resolve(result);
    };

    const timer = setTimeout(() => finish('timeout', 'no response within 12s'), TIMEOUT_MS);

    const ws = new WebSocket(URL, {
      headers: { Authorization: `Bearer ${KEY}` },
    });

    ws.on('error', (e) => {
      clearTimeout(timer);
      finish('ws_error', e.message);
    });

    ws.on('message', (raw) => {
      let evt;
      try { evt = JSON.parse(raw.toString()); } catch { return; }

      if (evt.type === 'session.created') {
        ws.send(JSON.stringify({ type: 'session.update', session: v.session }));
      }

      if (evt.type === 'session.updated') {
        clearTimeout(timer);
        // 只取關鍵欄位避免輸出過長
        const s = evt.session ?? {};
        const summary = {
          type: s.type,
          audio_input_keys: s.audio?.input ? Object.keys(s.audio.input) : [],
          transcription: s.audio?.input?.transcription ?? null,
          noise_reduction: s.audio?.input?.noise_reduction ?? undefined,
          latency: s.latency ?? s.audio?.input?.latency ?? s.audio?.input?.transcription?.latency ?? undefined,
          delay: s.delay ?? s.audio?.input?.delay ?? s.audio?.input?.transcription?.delay ?? undefined,
          raw_session_keys: Object.keys(s),
        };
        finish('updated', summary);
      }

      if (evt.type === 'error') {
        clearTimeout(timer);
        finish('error', {
          code: evt.error?.code,
          message: evt.error?.message ?? JSON.stringify(evt.error),
          param: evt.error?.param ?? null,
        });
      }
    });

    ws.on('close', () => {
      clearTimeout(timer);
      if (!done) finish('closed_without_response', null);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程：逐一執行，印出 JSON 結果
// ─────────────────────────────────────────────────────────────────────────────
const results = [];
for (const v of VARIANTS) {
  process.stdout.write(`[probe] running: ${v.label} ... `);
  const r = await runVariant(v);
  results.push(r);
  console.log(r.status);
  if (r.status === 'error') {
    console.log('        error:', JSON.stringify(r.detail));
  }
  // 小暫停避免 rate-limit
  await new Promise(res => setTimeout(res, 400));
}

console.log('\n═══════ FULL RESULTS ═══════');
console.log(JSON.stringify(results, null, 2));
