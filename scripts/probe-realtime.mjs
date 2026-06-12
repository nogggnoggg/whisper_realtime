// 臨時探測腳本：確認 GA Realtime transcription session 的正確協定
// 用法：node scripts/probe-realtime.mjs [urlVariant]
import 'dotenv/config';
import WebSocket from 'ws';

const variant = process.argv[2] ?? 'plain';
const URLS = {
  plain: 'wss://api.openai.com/v1/realtime',
  intent: 'wss://api.openai.com/v1/realtime?intent=transcription',
  model: 'wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper',
};
const url = URLS[variant];
console.log('[probe] connecting:', url);

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
});

const sessionUpdate = {
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: { type: 'audio/pcm', rate: 24000 },
        transcription: { model: 'gpt-realtime-whisper' },
        turn_detection: null,
      },
    },
  },
};

ws.on('open', () => console.log('[probe] open'));
ws.on('message', (raw) => {
  const evt = JSON.parse(raw.toString());
  console.log('[probe] event:', evt.type);
  if (evt.type === 'error') console.log(JSON.stringify(evt, null, 2));
  if (evt.type.endsWith('session.created')) {
    console.log('[probe] session object:', JSON.stringify(evt.session ?? {}, null, 2).slice(0, 800));
    ws.send(JSON.stringify(sessionUpdate));
    console.log('[probe] sent session.update');
  }
  if (evt.type.endsWith('session.updated')) {
    console.log('[probe] SUCCESS — updated session:', JSON.stringify(evt.session ?? {}, null, 2).slice(0, 800));
    ws.close(1000);
  }
});
ws.on('close', (c, r) => { console.log('[probe] close', c, r?.toString()); process.exit(0); });
ws.on('error', (e) => { console.log('[probe] ws error:', e.message); process.exit(1); });
setTimeout(() => { console.log('[probe] timeout'); process.exit(2); }, 15000);
