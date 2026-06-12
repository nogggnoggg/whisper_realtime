import 'dotenv/config';
import WebSocket from 'ws';

const KEY = process.env.OPENAI_API_KEY;
const URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

const tests = [
  {
    label: 'delay_invalid_value_BOGUS',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-realtime-whisper', delay: 'BOGUS_VALUE_XYZ' },
          turn_detection: null,
        },
      },
    },
  },
  {
    label: 'delay_high_check_echo',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-realtime-whisper', delay: 'high' },
          turn_detection: null,
        },
      },
    },
  },
];

function runVariant(v) {
  return new Promise((resolve) => {
    const result = { label: v.label, status: 'unknown', detail: null };
    let done = false;
    const finish = (status, detail) => {
      if (done) return;
      done = true;
      result.status = status;
      result.detail = detail;
      try { ws.close(1000); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => finish('timeout', null), 12000);
    const ws = new WebSocket(URL, { headers: { Authorization: `Bearer ${KEY}` } });
    ws.on('error', (e) => { clearTimeout(timer); finish('ws_error', e.message); });
    ws.on('message', (raw) => {
      let evt;
      try { evt = JSON.parse(raw.toString()); } catch { return; }
      if (evt.type === 'session.created') {
        ws.send(JSON.stringify({ type: 'session.update', session: v.session }));
      }
      if (evt.type === 'session.updated') {
        clearTimeout(timer);
        const s = evt.session ?? {};
        const t = s.audio?.input?.transcription ?? {};
        finish('updated', { transcription: t, full_session_raw: JSON.stringify(s).slice(0, 800) });
      }
      if (evt.type === 'error') {
        clearTimeout(timer);
        finish('error', { code: evt.error?.code, message: evt.error?.message, param: evt.error?.param });
      }
    });
  });
}

for (const v of tests) {
  process.stdout.write(`[probe] ${v.label} ... `);
  const r = await runVariant(v);
  console.log(r.status);
  console.log(JSON.stringify(r.detail, null, 2));
  await new Promise(res => setTimeout(res, 400));
}
