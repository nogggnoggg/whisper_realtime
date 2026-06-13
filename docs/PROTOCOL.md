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

### 3.4 精準翻譯開關

```json
{"type": "settings", "refined": true}
{"type": "settings", "refined": false}
```

- `refined`：布林值，是否啟用 Route B 精準翻譯（第三行）。可隨時切換，影響後續發言。

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

### 4.5 精準翻譯結果（Route B，選擇性）

```json
{"type": "refined", "itemId": "item_abc123", "text": "Do not ship this batch. Await QA confirmation."}
```

- 僅當精準翻譯開啟且啟用 REFINE_MODEL 時發送。
- 對應 `final` 的 `itemId`。
- 前端在第三行顯示「精準翻譯：」加此文本。

### 4.5.1 精準翻譯失敗通知

```json
{"type": "refined_error", "itemId": "item_abc123", "message": "reasoning_effort is not supported..."}
```

- Route B 呼叫失敗時發送（例如模型不支援 reasoning_effort 且重試後仍失敗）。
- 前端在對應卡片尾端附加小字錯誤提示（僅顯示一次，不覆蓋）。
- `itemId` 與 `final` 對應；`message` 為錯誤原文（供除錯用）。

### 4.6 錯誤通知

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
| `OPENAI_API_KEY` | OpenAI API 金鑰（provider=openai 時必填） | — |
| `PORT` | HTTP/WS 伺服器埠號 | `3000` |
| `STT_MODEL` | 語音識別模型 | `gpt-realtime-whisper` |
| `STT_DELAY` | 轉錄延遲等級 | `medium` |
| `STT_NOISE_REDUCTION` | 噪音消除等級 | `near_field` |
| `STT_PROMPT` | 轉錄提示詞（工廠術語）| （留空使用內建） |
| `TRANSLATE_PROVIDER` | 翻譯服務提供者 | `openai` |
| `TRANSLATE_MODEL` | 翻譯模型名稱 | 依 provider（openai: `gpt-5-mini` / anthropic: `claude-haiku-4-5` / custom: 必填） |
| `ANTHROPIC_API_KEY` | Anthropic API 金鑰（provider=anthropic 時必填） | — |
| `TRANSLATE_BASE_URL` | 自訂翻譯端點基礎 URL（provider=custom 用，須相容 OpenAI 格式） | — |
| `TRANSLATE_API_KEY` | 自訂翻譯端點 API 金鑰（provider=custom 用） | — |
| `SILENCE_DURATION` | Auto 模式無音時停止錄音持續時間（毫秒） | `2000` |
| `DATABASE_URL` | PostgreSQL 連線字串（Zeabur PG 或自行部署，例 `postgresql://user:pass@host:5432/db`） | — |
| `REFINE_MODEL` | 精準翻譯模型，沿用 TRANSLATE_PROVIDER（例 openai 時為 `gpt-4o` 等），無值時 Route B 停用 | — |
| `REFINE_REASONING_EFFORT` | gpt-5 系列精準翻譯的 reasoning_effort 值（none/low/medium/high/xhigh/minimal，模型不支援時自動移除重試） | `minimal` |
| `TRANSLATE_REASONING_EFFORT` | gpt-5 系列 Route A 翻譯的 reasoning_effort 值（none/low/medium/high/xhigh/minimal，模型不支援時自動移除重試） | `minimal` |
| `STT_LANGUAGE` | 來源語言提示，單一 ISO-639-1 碼如 `zh`/`en`；**預設留空＝auto-detect**；雙語輪流請留空，僅單語為主的現場才設 | （留空） |

載入方式：`dotenv`，`.env` 檔不進 git。

**DATABASE_URL 說明**：
- 若不填或為空，資料庫功能停用（Glossary、Translation Logs 無法保存），但翻譯流程正常運作。
- 填入時自動啟用 Glossary 記錄、Session 日誌等 Phase 2 功能。
- Zeabur PostgreSQL service 自動注入 `DATABASE_URL` 環境變數。

#### 6.6.1 STT 參數詳細說明（實測 2026-06-12；STT_LANGUAGE 新增 2026-06-13）

> **如何在 Zeabur 調整**：進入 Zeabur 後台 → 選 `app` service → Variables → 新增或修改對應環境變數 → 重啟 service 生效。所有 STT 參數均在 server 建立 OpenAI session 時送出（`session.update`），**不需改程式碼**，改環境變數重啟即可。

> **Silence Hold-off（斷句延遲）**：Auto 模式音量低於門檻後等待多久才停止錄音，目前由**前端設定頁**的滑桿調整（預設 2000ms），是 client-side 設定，不走環境變數。

---

**STT_MODEL**

- **可選值**：`gpt-realtime-whisper`、`gpt-4o-transcribe`
- **預設值**：`gpt-realtime-whisper`（即時性優先，延遲更低）
- **說明**：
  - `gpt-realtime-whisper`：低延遲（~200ms），支援 delta 事件串流轉錄，不支援 prompt 提示詞
  - `gpt-4o-transcribe`：延遲稍高（~500ms），支援 prompt 欄位，精度略高，適合高精度場景（A/B 測試用）
- **建議**：預設即可；需要術語 prompt 時改 `gpt-4o-transcribe` 並同步設 `STT_PROMPT`。
- **Zeabur 設定**：Variables → `STT_MODEL=gpt-4o-transcribe`，重啟生效。
- **驗證註記**：兩者均可作為 `session.audio.input.transcription.model` 使用，session.updated echo 確認：`transcription: { model: 'gpt-4o-transcribe', ... }`。

---

**STT_DELAY**

- **欄位路徑**：`session.audio.input.transcription.delay`
- **合法值**：`minimal`、`low`、`medium`、`high`、`xhigh`
- **預設值**：`medium`
- **說明**：控制轉錄延遲 vs 精度的平衡。值越低出字越快但精度越低；值越高精度越好但出字較慢。工廠環境（術語多、背景音複雜）推薦 `high` 或 `xhigh`。
- **建議**：先試 `high`；若仍有漏字再升 `xhigh`；若字幕延遲感明顯可退回 `medium`。
- **Zeabur 設定**：Variables → `STT_DELAY=high`，重啟生效。
- **驗證註記**：API 對非法值回傳 `invalid_value` 錯誤並列出合法值清單。session.updated echo 不含此欄位（服務端驗證但不反映），此行為正常，不代表欄位無效。其他路徑候選（`session.latency`、`session.audio.input.latency` 等）均拒絕 `unknown_parameter`。

---

**STT_NOISE_REDUCTION**

- **欄位路徑**：`session.audio.input.noise_reduction`
- **合法值**：`near_field`（近距離麥克風）、`far_field`（遠距離麥克風）、或 `null`（停用）
- **預設值**：`near_field`
- **說明**：自動噪音消除強度。工廠環境機械音多，`near_field` 適合固定式麥克風，`far_field` 適合距聲源 1m+ 的麥克風。若噪音消除反而使人聲失真，設 `null` 停用。
- **建議**：一般工廠場景維持 `near_field`；若麥克風距嘴巴超過 1m 可試 `far_field`。
- **Zeabur 設定**：Variables → `STT_NOISE_REDUCTION=far_field`（或 `null`），重啟生效。
- **驗證註記**：API echo 確認此欄位被接受並原樣回傳：`noise_reduction: { type: 'near_field' }`。`auto` 被拒絕為 `invalid_value`，API 明確告知支援值。

---

**STT_PROMPT**

- **欄位路徑**：`session.audio.input.transcription.prompt`
- **適用模型**：**僅 `gpt-4o-transcribe` 支援**；`gpt-realtime-whisper` 使用時 API 拒絕 `invalid_value`（需同步把 `STT_MODEL` 改為 `gpt-4o-transcribe`）
- **預設值**：（留空，使用 OpenAI 內建通用辨識）
- **合法值**：自由文字，可中英混合；建議格式為「術語中文 英文對照」條列，例：`品保 QA、隔離區 quarantine area、停線 stop the line、卡料 material jam、首件檢查 first article inspection`
- **說明**：讓模型優先辨識指定術語，有效降低專業詞彙的誤辨率。prompt 僅用於引導辨識，不會出現在轉錄輸出中。
- **建議**：先從 5–10 個最常用術語開始；避免放太長（可能影響整體精度）。
- **Zeabur 設定**：Variables → `STT_PROMPT=品保 QA、隔離區 quarantine area`，重啟生效。注意：`STT_MODEL` 必須同時為 `gpt-4o-transcribe`，否則此參數被忽略並報錯。
- **驗證註記**：session.updated echo 確認 prompt 欄位被接受：`transcription: { model: 'gpt-4o-transcribe', language: null, prompt: '...' }`。

---

**STT_LANGUAGE**

- **欄位路徑**：`session.audio.input.transcription.language`
- **合法值**：單一 ISO-639-1 語言碼，如 `zh`（中文）、`en`（英文）、`ja`（日文）、`ko`（韓文）；**留空**代表 auto-detect
- **預設值**：（留空，由 OpenAI 自動偵測語言）
- **說明**：提供語言碼可讓模型跳過語言偵測步驟，提升該語言的辨識精度與降低首字延遲。**但此欄位只接受單一語言碼**。本系統中英雙語輪流說話共用同一個 session，若固定填 `zh`，英語發言的辨識精度會下降（反之亦然），因此**雙語現場必須留空**。僅在「現場幾乎只有一種語言」（例如全程中文、偶有英文技術詞彙）的單語為主場景才建議設定。
- **建議**：
  - 雙語輪流（預設情境）→ 留空（不設此變數）
  - 單語為主（如廠內全程中文）→ `STT_LANGUAGE=zh`
- **Zeabur 設定**：Variables → `STT_LANGUAGE=zh`，重啟生效。若要恢復 auto-detect，刪除此變數（或設空字串）並重啟。
- **實作說明**：此欄位由後端 `_buildSessionUpdate()` 在建立 OpenAI session 時一次性送出（`session.update`）。連線後無法動態切換，需重啟 service 才生效。

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

### 6.9 中文輸出規範

所有送往前端的中文文字（draft / final / translation）由後端使用 **OpenCC** 統一轉換為**台灣正體繁體中文**（簡體 → 繁體，zh-Hans → zh-Hant）。

**實作方式**：
- 在 `server/translate.js` 和 `server/openai-stt.js` 中的文字輸出環節，經由 OpenCC library 的 `cn2twp` 配置進行後處理
- 對象：所有前端訊息中的文字欄位（`draft.text`、`final.text`、`translation.text` 若為中文）
- 時機：STT 完成 / 翻譯完成，輸出訊息前執行

**理由**：
- STT 模型（如 Whisper、gpt-realtime-whisper）輸出簡繁隨機，不依賴模型選擇
- 後處理方案與模型無關，保障一致性
- OpenCC 轉換速度快、精度高，不增加延遲

---

## 7. 資料庫 Schema（Phase 2，DATABASE_URL 啟用時）

### 7.1 Glossary 術語表

**表名**：`glossary_terms`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID / BIGINT | 主鍵 |
| `source_lang` | varchar(5) | 來源語言代碼（例 `"zh"`、`"en"`、`"ko"`） |
| `target_lang` | varchar(5) | 目標語言代碼 |
| `source_term` | TEXT | 原文術語 |
| `target_term` | TEXT | 譯文術語 |
| `category` | varchar(50) | 分類（例 `"equipment"`、`"process"`、`"quality"`） |
| `notes` | TEXT | 備註 |
| `created_at` | TIMESTAMP | 建立時間 |
| `updated_at` | TIMESTAMP | 最後修改時間 |

**複合主鍵**：`(source_lang, target_lang, source_term)` 唯一。

**語言對一級欄位原則**：每筆術語必須明確指定 source_lang 與 target_lang，支援任意語言對（zh↔en、zh↔ko、en↔ko 等），為 Phase 3 多語言擴充奠基。

### 7.2 翻譯日誌

**表名**：`translation_logs`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID / BIGINT | 主鍵 |
| `session_id` | varchar(50) | Session 識別碼 |
| `item_id` | varchar(50) | 發言識別碼（WS itemId） |
| `source_lang` | varchar(5) | 原文語言 |
| `target_lang` | varchar(5) | 目標語言 |
| `source_text` | TEXT | 原文轉錄 |
| `route_a_text` | TEXT | Route A 翻譯結果 |
| `route_b_text` | TEXT | Route B 精準翻譯結果（若啟用） |
| `glossary_matched` | JSONB / TEXT | 本次匹配到的 Glossary 術語列表 |
| `created_at` | TIMESTAMP | 記錄時間 |

**語言對一級欄位原則**：source_lang + target_lang 必填，支援多語言查詢。

### 7.3 Session 日誌

**表名**：`sessions`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID / varchar(50) | 主鍵（與 WS session_id 對應） |
| `user_ip` | inet / varchar(45) | 使用者 IP |
| `started_at` | TIMESTAMP | Session 開始時間 |
| `ended_at` | TIMESTAMP | Session 結束時間（NULL = 進行中） |
| `utterance_count` | INT | 本 session 發言數 |
| `total_audio_duration_sec` | FLOAT | 累計音訊時長（秒） |
| `source_lang_stats` | JSONB / TEXT | 語言發言統計（例 `{"zh": 5, "en": 3}`） |

---

## 8. REST API 端點（Phase 2，DATABASE_URL 啟用時）

### 8.1 `/api/glossary` — 術語表查詢與管理

**GET /api/glossary**

查詢術語表。

**查詢參數**：
- `source_lang`（必填）：來源語言，例 `"zh"`
- `target_lang`（必填）：目標語言，例 `"en"`
- `search`（可選）：關鍵詞搜尋（對 source_term 或 target_term 進行 LIKE 比對）
- `category`（可選）：分類篩選

**回應**：
```json
{
  "results": [
    {
      "id": "uuid-123",
      "source_lang": "zh",
      "target_lang": "en",
      "source_term": "隔離區",
      "target_term": "quarantine area",
      "category": "facility",
      "notes": "廢品、不良品隔離所在",
      "created_at": "2026-06-12T10:00:00Z"
    }
  ],
  "total": 42
}
```

**POST /api/glossary** — 新增或更新術語

**Request body**：
```json
{
  "source_lang": "zh",
  "target_lang": "en",
  "source_term": "首件檢查",
  "target_term": "first article inspection",
  "category": "quality",
  "notes": "新產線每批開始前的初次檢驗"
}
```

**DELETE /api/glossary/:id** — 刪除術語

---

## 9. 管理頁面（Phase 2）

### 9.1 `/glossary.html` — Glossary 管理頁

靜態 HTML + vanilla JS，位置 `public/glossary.html`。

**功能**：
- 顯示表格：列出所有術語，可依 source_lang / target_lang / category 篩選
- 搜尋：關鍵詞比對
- 新增：表單提交新術語至 `/api/glossary`（POST）
- 編輯：雙擊行編輯，PATCH 提交
- 刪除：行末刪除按鈕，DELETE 提交
- 導出：CSV 下載（備份用）

**存取控制**：由 Zeabur 平台層級處理（basic auth / IP 限制），本檔無額外驗證。

---

## 10. 注意事項

- 前端**絕對不保存** `OPENAI_API_KEY`，金鑰僅存於後端環境變數。
- 音訊 binary frame 只能在 `audio.start` 之後、`audio.stop` 之前發送。
- `itemId` 由後端產生並在 `draft`、`final`、`translation` 三個訊息中保持一致，前端以此對應並更新同一張 card。
- `draft.text` 為累積全文，前端直接覆蓋顯示，不需自行做 delta 合併。
