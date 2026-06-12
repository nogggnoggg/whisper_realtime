# WebSocket 協定 v1 — 前後端契約文件

版本：v1  
更新日期：2026-06-12  
適用範圍：Phase 1 demo

---

## 1. 檔案配置與職責

| 檔案 | 負責 Agent | 職責說明 |
|---|---|---|
| `server/index.js` | backend | Express 靜態服務 `public/` + WebSocket server + session 管理 |
| `server/openai-stt.js` | backend | OpenAI Realtime transcription session 客戶端 |
| `server/translate.js` | backend | gpt-5-mini 文字翻譯 |
| `server/lang.js` | backend | 語言方向偵測（CJK 字元比例判斷） |
| `public/index.html` | frontend-ui | 主畫面 HTML |
| `public/styles.css` | frontend-ui | 樣式 |
| `public/app.js` | frontend-ui | UI 邏輯：feed 渲染、WS 訊息處理、模式切換 UI |
| `public/audio.js` | audio | 音訊管線：mic、meter、threshold、串流 |
| `public/pcm-worklet.js` | audio | AudioWorklet：Float32 → PCM16 重採樣 24kHz |

> 各 agent 嚴格只修改自己負責的檔案，不得跨界修改。

---

## 2. WebSocket 端點

```
ws://host/ws
```

連線為純 WebSocket（非 Socket.IO）。

---

## 3. Client → Server 訊息

### 3.1 開始一段發言

```json
{"type": "audio.start", "mode": "manual"}
```

```json
{"type": "audio.start", "mode": "auto"}
```

- `mode`：`"manual"` 表示手動按鍵觸發；`"auto"` 表示 threshold 自動觸發。
- 發送此訊息後，客戶端才可開始送二進位音訊 frame。

### 3.2 音訊資料

- 格式：**二進位 frame（Binary WebSocket frame）**
- 編碼：PCM16LE，mono，24kHz
- 必須在 `audio.start` 之後才能發送。

### 3.3 結束該段發言

```json
{"type": "audio.stop"}
```

- 通知後端本段發言結束，後端將觸發最終轉錄與翻譯流程。

---

## 4. Server → Client 訊息

所有 Server → Client 訊息均為 **JSON 文字 frame**。

### 4.1 狀態通知

```json
{"type": "status", "state": "ready"}
{"type": "status", "state": "listening"}
{"type": "status", "state": "processing"}
{"type": "status", "state": "error", "message": "錯誤說明"}
```

| state | 說明 |
|---|---|
| `ready` | 連線成功，等待發言 |
| `listening` | 正在接收音訊並串流轉錄 |
| `processing` | 音訊接收完畢，正在進行翻譯 |
| `error` | 發生錯誤 |

### 4.2 草稿字幕（轉錄中）

```json
{"type": "draft", "itemId": "item_abc123", "text": "這批先不要..."}
```

- `itemId`：本段發言的唯一識別碼（由後端產生，貫穿整個發言生命週期）。
- `text`：delta 事件累積後的**當前全文**（非增量 delta，前端直接以此覆蓋顯示）。
- 對應 OpenAI 事件：`conversation.item.input_audio_transcription.delta`

### 4.3 正式原文（轉錄完成）

```json
{
  "type": "final",
  "itemId": "item_abc123",
  "text": "這批先不要出貨，等品保確認。",
  "lang": "zh",
  "ts": "10:29"
}
```

- `lang`：`"zh"` 或 `"en"`，由 `server/lang.js` 偵測。
- `ts`：格式 `"HH:MM"`，後端產生。
- 對應 OpenAI 事件：`conversation.item.input_audio_transcription.completed`

### 4.4 翻譯結果（Route A）

```json
{"type": "translation", "itemId": "item_abc123", "text": "Do not ship this batch yet. Wait for QA."}
```

- 與 `final` 訊息的 `itemId` 對應。
- 前端根據 `final.lang` 決定翻譯文字顯示在第幾行。

### 4.5 錯誤通知

```json
{"type": "error", "message": "OpenAI API 連線失敗"}
```

---

## 5. 訊息序列範例

```
Client → Server: {"type":"audio.start","mode":"auto"}
Client → Server: [binary PCM16 chunk 1]
Client → Server: [binary PCM16 chunk 2]
Server → Client: {"type":"status","state":"listening"}
Server → Client: {"type":"draft","itemId":"item_001","text":"這批"}
Server → Client: {"type":"draft","itemId":"item_001","text":"這批先不要出貨"}
Client → Server: [binary PCM16 chunk N]
Client → Server: {"type":"audio.stop"}
Server → Client: {"type":"final","itemId":"item_001","text":"這批先不要出貨，等品保確認。","lang":"zh","ts":"10:29"}
Server → Client: {"type":"status","state":"processing"}
Server → Client: {"type":"translation","itemId":"item_001","text":"Do not ship this batch yet. Wait for QA."}
Server → Client: {"type":"status","state":"ready"}
```

---

## 6. 關鍵技術決策

### 6.1 STT 模型

- **模型**：OpenAI Realtime API transcription session，model `gpt-realtime-whisper`
- **連線方式**：WebSocket
- **輸入格式**：24kHz mono PCM16LE
- **delta 事件**：`conversation.item.input_audio_transcription.delta` → `draft`
- **completed 事件**：`conversation.item.input_audio_transcription.completed` → `final`

### 6.2 翻譯模型

- **模型**：`gpt-5-mini`（OpenAI Chat Completions API）
- **方向**：`zh→en` 或 `en→zh`，依 `server/lang.js` 偵測結果決定

### 6.3 語言方向偵測（`server/lang.js`）

判斷規則：

1. 計算轉錄文字中的 CJK 字元數（Unicode 區段：U+4E00–U+9FFF 基本漢字、U+3400–U+4DBF 擴充 A）。
2. 假名（片假名、平假名）**不計入** CJK 統計。
3. CJK 字元數 > 非空白字元總數的 50% → 判定為 **`"zh"`**（中文發言）。
4. 否則 → 判定為 **`"en"`**（英文發言）。

### 6.4 Threshold % ↔ dB 換算

線性對映公式：

```
dB = -50 + threshold% × 0.5
```

| Threshold % | 對應 dB |
|---:|---:|
| 0% | −50 dB |
| 60% | −20 dB（預設值） |
| 100% | 0 dB |

Level Meter 的紅色門檻線依此公式繪製。

### 6.5 Auto 模式狀態機

```
Standby（不送音訊）
  → 音量超過 threshold
    → Listening（送音訊）
      → 音量低於 threshold 持續 silence duration（預設 800ms）
        → Ending
          → audio.stop
```

- **Max utterance**：20 秒強制截斷，發送 `audio.stop`
- **Phase 1 不做 pre-roll buffer**

### 6.6 環境變數

| 變數名 | 說明 | 預設值 |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API 金鑰（必填） | — |
| `PORT` | HTTP/WS 伺服器埠號 | `3000` |
| `STT_MODEL` | 語音識別模型 | `gpt-realtime-whisper` |
| `STT_DELAY` | 轉錄延遲等級 | `medium` |
| `STT_NOISE_REDUCTION` | 噪音消除等級 | `near_field` |
| `STT_PROMPT` | 轉錄提示詞（工廠術語）| （留空使用內建） |

載入方式：`dotenv`，`.env` 檔不進 git。

#### 6.6.1 STT 參數詳細說明（實測 2026-06-12）

**STT_DELAY**

- **欄位路徑**：`session.audio.input.transcription.delay`
- **合法值**：`minimal`、`low`、`medium`、`high`、`xhigh`
- **預設值**：`medium`
- **說明**：控制轉錄延遲 vs 精度的平衡。越高延遲越低但精度越低；反之越高精度越好。工廠環境推薦 `high` 或 `xhigh`。
- **驗證註記**：API 對非法值回傳 `invalid_value` 錯誤並列出合法值清單。session.updated echo 不含此欄位（服務端驗證但不反映），此行為正常，不代表欄位無效。其他路徑候選（`session.latency`、`session.audio.input.latency` 等）均拒絕 `unknown_parameter`。

**STT_NOISE_REDUCTION**

- **欄位路徑**：`session.audio.input.noise_reduction`
- **合法值**：`near_field`（近距離麥克風）、`far_field`（遠距離麥克風）、或 `null`（停用）
- **預設值**：`near_field`
- **說明**：自動噪音消除強度。工廠環境機械音多，`near_field` 適合固定式麥克風，`far_field` 適合距聲源 1m+ 的麥克風。
- **驗證註記**：API echo 確認此欄位被接受並原樣回傳：`noise_reduction: { type: 'near_field' }`。`auto` 被拒絕為 `invalid_value`，API 明確告知支援值。

**STT_PROMPT**

- **欄位路徑**：`session.audio.input.transcription.prompt`
- **適用模型**：僅 `gpt-4o-transcribe` 支援；`gpt-realtime-whisper` 使用時拒絕 `invalid_value`
- **預設值**：（留空，使用 OpenAI 內建工廠術語庫）
- **說明**：提示詞範例：`品保 QA、隔離區 quarantine area、停線 stop the line、卡料 material jam、首件檢查 first article inspection` — 可用中英混合。此參數提升轉錄精度，特別是領域術語。
- **驗證註記**：session.updated echo 確認 prompt 欄位被接受：`transcription: { model: 'gpt-4o-transcribe', language: null, prompt: '...' }`。

**STT_MODEL**

- **可選值**：`gpt-realtime-whisper`、`gpt-4o-transcribe`
- **預設值**：`gpt-realtime-whisper`（即時性優先，延遲更低）
- **說明**：
  - `gpt-realtime-whisper`：低延遲（~200ms），支援 delta 事件串流轉錄，不支援 prompt 提示詞
  - `gpt-4o-transcribe`：延遲稍高（~500ms），支援 prompt 欄位，精度略高，適合高精度場景（A/B 測試用）
- **驗證註記**：兩者均可作為 `session.audio.input.transcription.model` 使用，session.updated echo 確認：`transcription: { model: 'gpt-4o-transcribe', ... }`。

### 6.7 Conversation Card 顯示規則

- 不顯示 speaker role（無小組長、Employee、技術員等）
- 每張 card 只有：timestamp + 原文 + 翻譯 + badge
- Badge 種類：`[Draft]`（轉錄中）、`[RT]`（Route A 完成）、`[Refined]`（Route B 完成，Phase 1 樣式先做，不會觸發）
- 中文發言：第一行中文，第二行英文翻譯
- 英文發言：第一行英文，第二行中文翻譯

### 6.8 Session 生命週期

- 使用者開啟頁面時建立新 session
- 閒置 30 分鐘後自動結束
- 使用者關閉頁面時前端通知後端結束 session

---

## 7. 注意事項

- 前端**絕對不保存** `OPENAI_API_KEY`，金鑰僅存於後端環境變數。
- 音訊 binary frame 只能在 `audio.start` 之後、`audio.stop` 之前發送。
- `itemId` 由後端產生並在 `draft`、`final`、`translation` 三個訊息中保持一致，前端以此對應並更新同一張 card。
- `draft.text` 為累積全文，前端直接覆蓋顯示，不需自行做 delta 合併。
