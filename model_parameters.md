# OpenAI Realtime Whisper / Realtime Translate 可調參數整理

> ※ 已實作為 server 環境變數、可在 Zeabur 後台調整的欄位，請見 `docs/PROTOCOL.md` §6.6 / §6.6.1（STT_MODEL / STT_DELAY / STT_NOISE_REDUCTION / STT_PROMPT / STT_LANGUAGE）。本檔為完整參數研究參考。

最後整理日期：2026-06-13  
範圍：只列 OpenAI 官方文件中可確認的欄位，以及少數建議放進 DB 的 client-side tuning 欄位。  
注意：這裡的「fine-tune」指的是 runtime parameter tuning / A/B testing，不是 OpenAI model fine-tuning job。

來源：
- OpenAI Realtime Transcription guide: https://developers.openai.com/api/docs/guides/realtime-transcription
- OpenAI Realtime and audio overview: https://developers.openai.com/api/docs/guides/realtime
- OpenAI Realtime client events reference: https://developers.openai.com/api/reference/resources/realtime/client-events
- OpenAI Realtime Translation guide: https://developers.openai.com/api/docs/guides/realtime-translation
- OpenAI Create translation client secret reference: https://developers.openai.com/api/reference/resources/realtime/subresources/translations/subresources/client_secrets/methods/create
- OpenAI Realtime Translation client events reference: https://developers.openai.com/api/reference/resources/realtime/translation-client-events

---

## 1. `gpt-realtime-whisper`

用途：即時語音轉文字。  
主要場景：live captions、即時 STT、先取得 source-language transcript 再交給其他模型翻譯。  
官方定位：Realtime transcription sessions 會在 audio 到達時串流 transcript deltas；`gpt-realtime-whisper` 是 live audio、transcript deltas、tunable latency 的 realtime transcription model。

### 1.1 官方 session 參數

#### `session.type`

```json
{
  "path": "session.type",
  "type": "enum",
  "allowed_values": ["transcription"],
  "recommended_default": "transcription",
  "required_for": "Realtime transcription session",
  "db_group": "session",
  "quality_tuning": false
}
```

用途：指定這是 transcription-only session。  
備註：這不是品質參數，但 DB 裡建議保留，用來區分 realtime / transcription / translation session。

---

#### `session.audio.input.format.type`

```json
{
  "path": "session.audio.input.format.type",
  "type": "enum",
  "allowed_values": ["audio/pcm", "audio/pcmu", "audio/pcma"],
  "recommended_default": "audio/pcm",
  "db_group": "audio_input",
  "quality_tuning": true
}
```

用途：指定輸入音訊格式。

說明：
- `audio/pcm`：PCM raw audio。
- `audio/pcmu`：G.711 μ-law。
- `audio/pcma`：G.711 A-law。

建議：如果你能控制 browser / server audio pipeline，優先使用 `audio/pcm`，並確保 sample rate / channel / PCM conversion 正確。

---

#### `session.audio.input.format.rate`

```json
{
  "path": "session.audio.input.format.rate",
  "type": "number",
  "allowed_values": [24000],
  "recommended_default": 24000,
  "valid_when": "session.audio.input.format.type == 'audio/pcm'",
  "db_group": "audio_input",
  "quality_tuning": false
}
```

用途：指定 PCM sample rate。  
限制：官方 reference 對 PCM 寫的是只支援 24 kHz。

---

#### `session.audio.input.noise_reduction`

```json
{
  "path": "session.audio.input.noise_reduction",
  "type": "object_or_null",
  "allowed_values": [null, {"type": "near_field"}, {"type": "far_field"}],
  "recommended_default": {"type": "near_field"},
  "db_group": "audio_input",
  "quality_tuning": true
}
```

用途：設定輸入降噪。  
說明：降噪會在 audio buffer 寫入後、送到 VAD / model 之前處理音訊；官方文件說這可以改善 VAD / turn detection 準確度與模型對音訊的感知。

---

#### `session.audio.input.noise_reduction.type`

```json
{
  "path": "session.audio.input.noise_reduction.type",
  "type": "enum",
  "allowed_values": ["near_field", "far_field"],
  "recommended_default": "near_field",
  "db_group": "audio_input",
  "quality_tuning": true
}
```

用途：指定降噪模式。

說明：
- `near_field`：近距離麥克風，例如耳機、手機近距離收音、外接麥克風。
- `far_field`：遠場麥克風，例如筆電內建麥克風、會議室、房間收音。

建議：
- 單人手機 / headset：先測 `near_field`。
- 筆電、會議室、環境聲多：先測 `far_field`。
- 如果音訊已經由你自己的 DSP / noise suppression 處理過，也要測 `null`。

---

#### `session.audio.input.transcription.model`

```json
{
  "path": "session.audio.input.transcription.model",
  "type": "string",
  "allowed_values_for_this_mode": ["gpt-realtime-whisper"],
  "recommended_default": "gpt-realtime-whisper",
  "db_group": "transcription",
  "quality_tuning": false
}
```

用途：指定 realtime transcription model。  
備註：如果你的 DB 是泛用 STT config，可以另外允許其他 transcription models；但在這份文件的 `gpt-realtime-whisper` mode 裡，建議固定為 `gpt-realtime-whisper`。

---

#### `session.audio.input.transcription.language`

```json
{
  "path": "session.audio.input.transcription.language",
  "type": "string",
  "format": "ISO-639-1 language code",
  "example_values": ["zh", "en", "ja", "ko"],
  "recommended_default_for_zh_tw_app": "zh",
  "db_group": "transcription",
  "quality_tuning": true
}
```

用途：提供輸入語言提示。  
說明：官方 reference 寫明，提供 ISO-639-1 格式的 input language，例如 `en`，可以改善準確度與 latency。

建議：
- 如果你的 app 當前模式明確是中文語音，設定 `zh`。
- 如果你支援多語言模式，把這個欄位放進 DB，並且跟 UI 的 source language 綁定。
- 不建議在單一中文模式下依賴 auto-detect。

---

#### `session.audio.input.transcription.delay`

```json
{
  "path": "session.audio.input.transcription.delay",
  "type": "enum",
  "allowed_values": ["minimal", "low", "medium", "high", "xhigh"],
  "recommended_default_for_translation_app": "high",
  "db_group": "transcription",
  "quality_tuning": true
}
```

用途：控制模型在輸出 transcription text 前要等多久。  
說明：這是 latency / accuracy tradeoff。官方文件說 higher delay 可以給模型更多 audio context，可能改善 word error rate，但會增加延遲。

建議：
- `minimal`：最重視低延遲，字幕可能較不穩。
- `low`：低延遲 live captions。
- `medium`：延遲與準確度平衡。
- `high`：翻譯 app 建議起點，因為 source transcript 錯會直接污染翻譯。
- `xhigh`：最重視準確度，可接受更高延遲。

---

#### `session.audio.input.transcription.prompt`

```json
{
  "path": "session.audio.input.transcription.prompt",
  "type": "string_or_null",
  "supported_for_gpt_realtime_whisper": false,
  "recommended_default": null,
  "db_group": "transcription",
  "quality_tuning": false
}
```

用途：理論上是用來引導 transcription style、延續上一段 audio，或補充關鍵詞。  
限制：官方文件明確寫，`gpt-realtime-whisper` 在 GA Realtime sessions 不支援 `prompt`。

建議：  
不要在 `gpt-realtime-whisper` 的調參 UI 裡開啟這個欄位。可以在 DB schema 保留，但標記為 disabled / unsupported，避免前端誤用。

---

#### `session.audio.input.turn_detection`

```json
{
  "path": "session.audio.input.turn_detection",
  "type": "null",
  "allowed_values_for_gpt_realtime_whisper": [null],
  "recommended_default": null,
  "db_group": "turn_detection",
  "quality_tuning": false
}
```

用途：turn detection / VAD 設定。  
限制：官方文件寫明，`gpt-realtime-whisper` transcription sessions 不支援 VAD，`turn_detection` 必須設為 `null` 或省略，然後由 client 手動 commit audio。

建議：  
這個欄位不要做成可調 VAD。真正要調的是你自己的 client-side commit policy，例如靜音幾毫秒後 commit。

---

#### `session.include`

```json
{
  "path": "session.include",
  "type": "array",
  "allowed_values": [["item.input_audio_transcription.logprobs"]],
  "recommended_default": [],
  "db_group": "diagnostics",
  "quality_tuning": false
}
```

用途：要求 server output 包含額外欄位。  
目前官方文件中和 realtime input transcription 相關的是：

```json
["item.input_audio_transcription.logprobs"]
```

用途：debug / confidence-like diagnostics。  
建議：先不要預設打開；只在 eval / debug 模式開啟，並確認你的 endpoint / model 實際有回傳。

---

### 1.2 `gpt-realtime-whisper` 串流事件參數

這些是 client event，不是 model behavior 參數，但你會在實作中需要儲存或控制。

#### `input_audio_buffer.append.audio`

```json
{
  "event_type": "input_audio_buffer.append",
  "path": "audio",
  "type": "string",
  "format": "base64-encoded audio bytes",
  "db_group": "streaming",
  "quality_tuning": false
}
```

用途：把 audio bytes append 到 input audio buffer。  
說明：audio 必須符合 session 裡設定的 input audio format。

---

#### `input_audio_buffer.commit`

```json
{
  "event_type": "input_audio_buffer.commit",
  "parameters": {},
  "db_group": "streaming",
  "quality_tuning": true
}
```

用途：手動提交目前 audio buffer，讓 server 開始產生 transcription。  
重要性：因為 `gpt-realtime-whisper` 不支援 VAD，所以 commit 時機會直接影響中文短句辨識穩定度。

建議你在 DB 額外存 app-level commit policy，例如：

```json
{
  "client_commit_strategy": "silence_after_speech",
  "client_silence_duration_ms_before_commit": 700,
  "client_min_utterance_ms": 500,
  "client_max_utterance_ms": 15000
}
```

---

### 1.3 建議給 DB 的 `gpt-realtime-whisper` app-level tuning 欄位

這些不是 OpenAI API 欄位，但對產品品質很重要。

#### `client.audio.chunk_ms`

```json
{
  "path": "client.audio.chunk_ms",
  "type": "number",
  "recommended_test_values": [20, 40, 100, 200],
  "recommended_default": 100,
  "api_field": false,
  "quality_tuning": true
}
```

用途：client 每次 append 的音訊長度。  
說明：官方 reference 說 client 可以自己選擇每次 append 放多少 audio；較小 chunk 可能讓 VAD / UI 更即時，但 overhead 較高。

---

#### `client.commit.silence_duration_ms`

```json
{
  "path": "client.commit.silence_duration_ms",
  "type": "number",
  "recommended_test_values": [500, 700, 900, 1200],
  "recommended_default": 700,
  "api_field": false,
  "quality_tuning": true
}
```

用途：偵測到語音結束後，等待多少靜音再 commit。  
建議：中文口語短停頓多，太短容易把句子切碎。可以從 700 ms 開始測。

---

#### `client.commit.min_utterance_ms`

```json
{
  "path": "client.commit.min_utterance_ms",
  "type": "number",
  "recommended_test_values": [300, 500, 800],
  "recommended_default": 500,
  "api_field": false,
  "quality_tuning": true
}
```

用途：避免太短的音訊片段被單獨 commit，造成前文不足與同音誤判。

---

## 2. `gpt-realtime-translate`

用途：即時語音翻譯。  
主要場景：中文語音直接翻成英文語音 / 英文字幕，或多語言即時口譯。  
官方定位：Realtime translation sessions 使用 dedicated `/v1/realtime/translations` endpoint，session 是 continuous streaming；translation 從 audio stream 本身開始，不要呼叫 `response.create`，也不要等 client commit user turn。

### 2.1 Translation client secret 建立參數

#### `expires_after.anchor`

```json
{
  "path": "expires_after.anchor",
  "type": "enum",
  "allowed_values": ["created_at"],
  "recommended_default": "created_at",
  "db_group": "client_secret",
  "quality_tuning": false
}
```

用途：指定 client secret TTL 的起算點。  
備註：這是安全 / session 建立參數，不影響翻譯品質。

---

#### `expires_after.seconds`

```json
{
  "path": "expires_after.seconds",
  "type": "number",
  "allowed_range": {"min": 10, "max": 7200},
  "recommended_default": 600,
  "db_group": "client_secret",
  "quality_tuning": false
}
```

用途：client secret 的有效秒數。  
官方限制：10 到 7200 秒；未指定時預設 600 秒。  
備註：session 已建立後可以繼續存在；這個 TTL 是 client secret 的有效期，不是翻譯品質參數。

---

### 2.2 Translation session 建立參數

#### `session.model`

```json
{
  "path": "session.model",
  "type": "string",
  "allowed_values_for_this_mode": ["gpt-realtime-translate"],
  "recommended_default": "gpt-realtime-translate",
  "mutable_with_session_update": false,
  "db_group": "session",
  "quality_tuning": false
}
```

用途：指定 translation model。  
限制：官方 reference 寫明，translation session 的 `model` 在建立時設定，不能用 `session.update` 修改。

---

#### `session.audio.input.noise_reduction`

```json
{
  "path": "session.audio.input.noise_reduction",
  "type": "object_or_null",
  "allowed_values": [null, {"type": "near_field"}, {"type": "far_field"}],
  "recommended_default": {"type": "near_field"},
  "mutable_with_session_update": true,
  "db_group": "audio_input",
  "quality_tuning": true
}
```

用途：設定輸入音訊降噪。  
說明：可設為 `null` 關閉。  
可透過 `session.update` 修改。

---

#### `session.audio.input.noise_reduction.type`

```json
{
  "path": "session.audio.input.noise_reduction.type",
  "type": "enum",
  "allowed_values": ["near_field", "far_field"],
  "recommended_default": "near_field",
  "mutable_with_session_update": true,
  "db_group": "audio_input",
  "quality_tuning": true
}
```

用途：指定 translation input audio 的降噪模式。

說明：
- `near_field`：近距離麥克風，例如 headset。
- `far_field`：遠場麥克風，例如 laptop 或 conference room microphone。

---

#### `session.audio.input.transcription`

```json
{
  "path": "session.audio.input.transcription",
  "type": "object_optional",
  "recommended_default": {"model": "gpt-realtime-whisper"},
  "mutable_with_session_update": true,
  "db_group": "source_transcript",
  "quality_tuning": false
}
```

用途：開啟 source-language transcript deltas。  
重要限制：官方 reference 寫明，啟用後 server 會 emit `session.input_transcript.delta`，但 translation 本身仍然是從 input audio stream 進行，不是從這份 source transcript 翻譯。

建議：  
如果你的 UI 要顯示「原文字幕」，可以啟用。  
如果只需要目標語言翻譯，這個欄位可以省略。

---

#### `session.audio.input.transcription.model`

```json
{
  "path": "session.audio.input.transcription.model",
  "type": "string",
  "example_values": ["gpt-realtime-whisper"],
  "recommended_default": "gpt-realtime-whisper",
  "mutable_with_session_update": true,
  "db_group": "source_transcript",
  "quality_tuning": false
}
```

用途：指定 source transcript deltas 使用的 transcription model。  
注意：這只影響 `session.input_transcript.delta`，不代表 translation pipeline 會先把 source audio 轉文字再翻譯。

---

#### `session.audio.output.language`

```json
{
  "path": "session.audio.output.language",
  "type": "string",
  "example_values": ["en", "es", "ja", "ko"],
  "recommended_default_for_zh_tw_app": "en",
  "mutable_with_session_update": true,
  "db_group": "translation_output",
  "quality_tuning": true
}
```

用途：指定翻譯輸出的目標語言。  
影響：translated output audio 與 translated transcript deltas 的語言。  
注意：官方 reference 將此欄位標為 string，未在該 reference 頁列出完整 enum；不要自行硬編一份語言表，除非另有官方來源或你在產品層自行限制。

---

### 2.3 Translation `session.update` 可修改參數

Realtime Translation 的 `session.update` 只支援更新以下三類：

```json
{
  "supported_session_update_fields": [
    "session.audio.output.language",
    "session.audio.input.transcription",
    "session.audio.input.noise_reduction"
  ],
  "not_mutable_with_session_update": [
    "session.type",
    "session.model"
  ]
}
```

用途：
- 切換目標語言。
- 開啟 / 修改 source transcript deltas。
- 調整 / 關閉 input noise reduction。

---

### 2.4 Translation 串流事件參數

#### `session.input_audio_buffer.append.audio`

```json
{
  "event_type": "session.input_audio_buffer.append",
  "path": "audio",
  "type": "string",
  "format": "base64-encoded 24 kHz PCM16 mono little-endian raw audio bytes",
  "db_group": "streaming",
  "quality_tuning": false
}
```

用途：把 source audio append 到 translation session input audio buffer。  
限制：WebSocket translation sessions 接收 base64 encoded 24 kHz PCM16 mono little-endian raw audio bytes。

---

#### `session.input_audio_buffer.append` chunk size

```json
{
  "path": "client.audio.chunk_ms",
  "type": "number",
  "recommended_default": 200,
  "recommended_test_values": [100, 200, 400],
  "api_field": false,
  "db_group": "streaming",
  "quality_tuning": true
}
```

用途：client 每次 append 的音訊長度。  
官方建議：translation engine 以 200 ms engine frames 消耗 audio；最佳 realtime behavior 是 append 200 ms chunks。  
備註：這不是 JSON event 裡的正式欄位，是 client-side tuning 欄位，但建議放 DB。

---

#### `client.audio.stream_silence_when_idle`

```json
{
  "path": "client.audio.stream_silence_when_idle",
  "type": "boolean",
  "recommended_default": true,
  "api_field": false,
  "db_group": "streaming",
  "quality_tuning": true
}
```

用途：當 session active 但使用者暫停說話時，是否持續送 silence。  
官方建議：translation session active 時要持續 append silence；如果 client 停止送 audio 又恢復，模型時間會把恢復後的 audio 視為與前一段連續，而不是現實中的 pause。

---

#### `session.close`

```json
{
  "event_type": "session.close",
  "parameters": {},
  "db_group": "streaming",
  "quality_tuning": false
}
```

用途：優雅關閉 translation session。  
說明：server 會 flush pending input audio，送出剩餘 translated output 後關閉。

---

### 2.5 官方文件中沒有確認支援的 Translation 調參欄位

以下欄位我沒有在官方 Realtime Translation session / client event reference 中找到可確認支援。建議不要放成 active control；如果放進 DB，應標記為 unsupported / reserved。

```json
[
  {
    "path": "session.audio.input.transcription.delay",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Realtime Translation reference only lists audio.input.transcription.model, not delay."
  },
  {
    "path": "session.audio.input.transcription.language",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Realtime Translation reference does not list source-language hint for translation session."
  },
  {
    "path": "session.instructions",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Translation sessions are interpreter sessions and official translation reference does not list instructions/prompt."
  },
  {
    "path": "session.audio.input.transcription.prompt",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Realtime Translation reference does not list prompt for source transcription or translation behavior."
  },
  {
    "path": "session.temperature",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Not listed in Realtime Translation session create/update reference."
  },
  {
    "path": "session.audio.input.turn_detection",
    "status": "not_confirmed_for_gpt_realtime_translate",
    "reason": "Translation sessions are continuous audio streaming sessions, not normal assistant turn lifecycle sessions."
  },
  {
    "path": "input_audio_buffer.commit",
    "status": "not_used_for_gpt_realtime_translate",
    "reason": "Translation begins from continuous audio stream; official guide says do not wait for client commit user turn."
  },
  {
    "path": "response.create",
    "status": "not_used_for_gpt_realtime_translate",
    "reason": "Official guide says do not call response.create for translation sessions."
  }
]
```

---

## 3. 建議 DB seed：`gpt-realtime-whisper`

```json
{
  "model_mode": "gpt-realtime-whisper",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": {
          "type": "audio/pcm",
          "rate": 24000
        },
        "noise_reduction": {
          "type": "near_field"
        },
        "transcription": {
          "model": "gpt-realtime-whisper",
          "language": "zh",
          "delay": "high",
          "prompt": null
        },
        "turn_detection": null
      }
    },
    "include": []
  },
  "client_tuning": {
    "audio_chunk_ms": 100,
    "commit_strategy": "silence_after_speech",
    "silence_duration_ms_before_commit": 700,
    "min_utterance_ms": 500,
    "max_utterance_ms": 15000
  },
  "notes": [
    "prompt is not supported with gpt-realtime-whisper in GA Realtime sessions.",
    "turn_detection must be null or omitted; commit audio manually."
  ]
}
```

---

## 4. 建議 DB seed：`gpt-realtime-translate`

```json
{
  "model_mode": "gpt-realtime-translate",
  "expires_after": {
    "anchor": "created_at",
    "seconds": 600
  },
  "session": {
    "model": "gpt-realtime-translate",
    "audio": {
      "input": {
        "noise_reduction": {
          "type": "near_field"
        },
        "transcription": {
          "model": "gpt-realtime-whisper"
        }
      },
      "output": {
        "language": "en"
      }
    }
  },
  "client_tuning": {
    "audio_format": "pcm16_mono_little_endian",
    "sample_rate": 24000,
    "audio_chunk_ms": 200,
    "stream_silence_when_idle": true
  },
  "session_update_supported_fields": [
    "audio.output.language",
    "audio.input.transcription",
    "audio.input.noise_reduction"
  ],
  "notes": [
    "Translation model is set at session creation and cannot be changed with session.update.",
    "Translation runs from the input audio stream, not from the optional source transcript deltas.",
    "No official delay/prompt/source-language-hint parameter was found for Realtime Translation in the referenced API docs."
  ]
}
```

---

## 5. 實作建議

### Realtime Whisper 模式

建議從這組開始：

```json
{
  "language": "zh",
  "delay": "high",
  "noise_reduction": {"type": "near_field"},
  "turn_detection": null,
  "client_silence_duration_ms_before_commit": 700
}
```

A/B 測試順序：
1. `delay`: `medium` → `high` → `xhigh`
2. `noise_reduction`: `near_field` → `far_field` → `null`
3. `client_silence_duration_ms_before_commit`: `500` → `700` → `900`
4. `client.audio.chunk_ms`: `100` → `200`

---

### Realtime Translate 模式

建議從這組開始：

```json
{
  "audio": {
    "input": {
      "noise_reduction": {"type": "near_field"},
      "transcription": {"model": "gpt-realtime-whisper"}
    },
    "output": {
      "language": "en"
    }
  },
  "client_audio_chunk_ms": 200,
  "stream_silence_when_idle": true
}
```

A/B 測試順序：
1. `audio.output.language`
2. `audio.input.noise_reduction`: `near_field` → `far_field` → `null`
3. `audio.input.transcription.model`: 開啟 / 關閉 source transcript display
4. `client.audio.chunk_ms`: 固定先用 `200`
5. `client.audio.stream_silence_when_idle`: 預設 `true`

---

## 6. Schema 建議

如果你要把參數放進 DB，建議拆成：

```json
{
  "model_profiles": {
    "id": "uuid",
    "name": "zh-to-en-realtime-whisper-high-accuracy",
    "model_mode": "gpt-realtime-whisper",
    "is_active": true
  },
  "model_profile_parameters": {
    "profile_id": "uuid",
    "param_path": "session.audio.input.transcription.delay",
    "param_type": "enum",
    "param_value_json": ""high"",
    "source": "official_api",
    "quality_tuning": true,
    "mutable_with_session_update": true
  },
  "model_profile_experiments": {
    "id": "uuid",
    "profile_id": "uuid",
    "metric_name": "zh_stt_word_error_rate",
    "metric_value": 0.0,
    "sample_set_id": "uuid",
    "notes": ""
  }
}
```

理由：
- `param_path` 可以直接對應 API JSON path。
- `param_value_json` 可存 enum / number / object / null。
- `source` 區分 `official_api`、`client_side`、`unsupported_reserved`。
- `quality_tuning` 區分真正會影響品質的欄位。
- `mutable_with_session_update` 區分需要重開 session 才能改的欄位。
