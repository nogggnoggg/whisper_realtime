# PRD：工廠內部雙語即時溝通系統（UI 更新版）

版本：v1.2  
狀態：技術方向定案稿（2026-06-12 更新 Model 策略與技術決策）  
產品型態：HTML / PWA Web App  
使用場景：工廠現場 iPad / 筆電 / 電腦共用畫面  
部署方向：Zeabur + PostgreSQL + OpenAI API  

---

## 1. 文件目的

本文件根據目前確認的 UI 方向，重新整理工廠內部雙語即時溝通系統的產品需求。

本系統用於協助講中文的臺籍員工與講英文的外籍員工，在工廠現場透過同一個網頁畫面進行雙向對話。

本產品不是對外銷售的 SaaS，也不是一般翻譯工具，而是工廠內部使用的「雙語即時對話系統」。

---

## 2. 產品目標

### 2.1 核心目標

建立一個適合工廠現場使用的雙語即時溝通工具，讓中文使用者與英文使用者可以共同看著同一個畫面，進行可即時理解、可回看、有術語控制、且成本可控的雙向對話。

### 2.2 主要目標

- 支援中文與英文雙向語音對話。
- 即時顯示原文與翻譯。
- 支援「精準翻譯」第三行顯示。
- 保留對話上下文，避免前文太快消失。
- 使用 timestamp 作為每段對話識別，不顯示 speaker role。
- 支援 Manual Speak 與 Auto Detection / Always On with Threshold 兩種接收模式。
- 支援可設定的 threshold，避免背景音持續送入 AI。
- 支援工廠 Glossary，讓術語翻譯一致。
- 支援 translation logs，方便回看與改善。
- 可部署在 Zeabur，資料存 PostgreSQL。

---

## 3. 非目標

第一版不處理以下項目：

- 不做語音輸出。
- 不做完整 SaaS 化。
- 不做多租戶架構。
- 不做複雜權限管理。
- 不做 MES / ERP 整合。
- 不做完整事故報告生成。
- 不做 speaker diarization。
- 不自動辨識「小組長」、「Employee」或其他個人身份。
- 不在 conversation card 上顯示 speaker role。
- 不做進階降噪或自動環境噪音校準。

---

## 4. 使用情境

### 4.1 基本場景

現場有一台 iPad、筆電或電腦。網頁打開後，臺籍員工與外籍員工共同看著同一個畫面輪流說話。

系統根據語音內容自動產生：

- 原文
- 即時翻譯
- 精準翻譯（如果功能開啟）
- timestamp
- translation 狀態

### 4.2 對話範例

中文使用者說：

```text
這批先不要出貨，等品保確認。
```

畫面顯示：

```text
10:29
這批先不要出貨，等品保確認。
Do not ship this batch yet. Wait for QA.
精準翻譯：Do not ship this batch yet. Wait for QA to confirm first.
```

英文使用者說：

```text
Should I move it to the quarantine area?
```

畫面顯示：

```text
10:30
Should I move it to the quarantine area?
我要把它移到隔離區嗎？
```

---

## 5. 使用者角色

### 5.1 臺籍員工

主要使用中文溝通。

需求：

- 看到自己的中文是否正確翻成英文。
- 看懂英文發言的中文翻譯。
- 能回看前面對話脈絡。
- 能使用工廠術語。

### 5.2 外籍員工 / English Speaker

主要使用英文溝通。

需求：

- 看到自己的英文是否正確翻成中文。
- 看懂中文發言的英文翻譯。
- 能透過同一畫面理解上下文。

### 5.3 管理者 / Admin

後續可管理：

- Glossary
- Translation logs
- 產線設定
- Audio threshold profile
- 精準翻譯預設值

---

## 6. 核心產品概念

### 6.1 雙向對話，但不做 speaker 分類

目前版本不做 speaker classification。

因此 conversation card 不顯示：

- 小組長
- Employee
- Operator
- Technician
- 個人姓名

每一段對話只需要顯示：

- timestamp
- 原文
- 翻譯
- 精準翻譯（如果有）
- 狀態標籤

### 6.2 Conversation Feed

主畫面採用滾動式雙語對話牆。

行為：

- 新對話從底部加入。
- 舊對話自然往上推。
- 不固定只顯示三段。
- 顯示多少段由螢幕尺寸與字體大小決定。
- 使用者可往上滑回看上下文。
- 使用者手動往上滑時，auto-scroll 暫停。
- 有新對話時顯示「有新對話，點擊回到最新」。

### 6.3 翻譯顯示邏輯

每段對話最多顯示三行。

#### 使用者講中文時

第一行：中文原文  
第二行：英文即時翻譯  
第三行：精準翻譯（如果開啟）

範例：

```text
10:29
這批先不要出貨，等品保確認。
Do not ship this batch yet. Wait for QA.
精準翻譯：Do not ship this batch yet. Wait for QA to confirm first.
```

#### 使用者講英文時

第一行：英文原文  
第二行：中文即時翻譯  
第三行：精準翻譯（如果開啟）

範例：

```text
10:30
Should I move it to the quarantine area?
我要把它移到隔離區嗎？
```

如果精準翻譯開啟且需要重整，可顯示：

```text
精準翻譯：我應該把它移到隔離區嗎？
```

### 6.4 Route A + Route B

系統採用兩層翻譯策略。

#### Route A：Realtime Translation

- 永遠啟用。
- 負責低延遲即時翻譯。
- 先讓現場人員快速理解大意。
- UI 標示為 `[RT]`。

#### Route B：Refined Translation / 精準翻譯

- 由 HTML 上的 ON / OFF 控制。
- 句子完成後才執行。
- 使用完整原文、Route A 翻譯、Glossary 與上下文做語意重整。
- 完成後顯示第三行「精準翻譯：」。
- UI 標示為 `[Refined]`。

---

## 7. 主要功能需求

## 7.1 即時語音辨識與翻譯

需求：

- 支援中文語音 → 中文原文 + 英文翻譯。
- 支援英文語音 → 英文原文 + 中文翻譯。
- 支援暫定字幕與正式字幕。
- 支援語句穩定後產生 conversation card。
- 支援自動判斷語言方向。
- 不要求辨識 speaker identity。

---

## 7.2 Conversation Card

每一段完成的發言會產生一張 conversation card。

### 中文發言 card

```text
10:29
這批先不要出貨，等品保確認。
Do not ship this batch yet. Wait for QA.
精準翻譯：Do not ship this batch yet. Wait for QA to confirm first.
[RT] [Refined]
```

### 英文發言 card

```text
10:30
Should I move it to the quarantine area?
我要把它移到隔離區嗎？
[RT]
```

### Card 欄位

| 欄位 | 說明 |
|---|---|
| timestamp | 該段語音完成或開始時間 |
| source text | 原文 |
| translation | Route A 即時翻譯 |
| refined translation | Route B 精準翻譯，若有 |
| status | Draft / RT / Refined |
| safety flag | 第二階段可加入 |

---

## 7.3 Draft / 暫定字幕

正在說話時，內容先顯示為 Draft，不立即變成正式 card。

範例：

```text
10:33
[暫定] 可以，但要先貼標籤...
[Draft] Yes, but label it first...
[Draft]
```

行為：

- 語音尚未穩定時標示 Draft。
- Draft 內容可以被修正。
- 語句完成後轉成正式 card。
- 如果精準翻譯 ON，Route B 完成後再新增第三行「精準翻譯：」。

---

## 7.4 精準翻譯 ON / OFF

UI 顯示：

```text
精準翻譯 ON
精準翻譯 OFF
```

### ON 時

- Route A 先顯示即時翻譯。
- 句子完成後 Route B 執行語意重整。
- 完成後在該 card 加上第三行「精準翻譯：」。
- Card 標示 `[Refined]`。

### OFF 時

- 只顯示 Route A 翻譯。
- 不做語意重整。
- 不顯示第三行。
- Card 標示 `[RT]`。
- 降低成本與延遲。

---

## 7.5 Glossary 工廠術語表

目的：

- 讓工廠術語翻譯一致。
- 提高 Route B 精準翻譯品質。
- 避免通用翻譯誤解現場用語。

範例：

| 中文 | 英文 |
|---|---|
| 良品 | good parts |
| 不良品 | defective parts |
| 隔離區 | quarantine area |
| 停線 | stop the line |
| 開機 | start the machine |
| 關機 | shut down the machine |
| 卡料 | material jam |
| 首件檢查 | first article inspection |
| 品保 | QA / Quality Assurance |

第一版需求：

- Glossary 存在 PostgreSQL。
- HTML 提供簡單管理頁。
- 可新增、修改、停用詞彙。
- Route B 執行時套用相關 Glossary。

第二階段：

- Admin approval。
- 版本紀錄。
- 依產線 / 機台 / 部門套用不同 Glossary。
- 錯誤翻譯回報後建議新增詞彙。

---

## 7.6 Translation Logs

系統應保存對話紀錄。

第一版記錄：

- timestamp
- source language
- target language
- source transcript
- realtime translation
- refined translation
- glossary used
- refinement enabled
- audio mode
- threshold value
- session id

用途：

- 現場回看。
- 找出常見翻譯錯誤。
- 改善 Glossary。
- 評估 Route B 是否值得開啟。
- 分析 threshold 是否造成誤觸發或漏收音。

---

## 7.7 安全提醒

底部固定顯示安全提醒。

建議文字：

```text
請注意安全，專注工作。避免在機台運轉或危險區域進行長時間對話。
For safety, stay focused on your work. Avoid long conversations while machines are operating or in hazardous areas.
```

第二階段可偵測安全關鍵詞：

- 停線
- 開機
- 關機
- 安全門
- 不要碰
- 隔離
- 電氣
- 維修
- 化學品
- 吊掛

偵測到時可標示該段為 safety-related message。

---

## 7.8 Audio Activation Mode / 語音啟動模式

系統需要避免麥克風持續將背景聲音送給 AI，造成成本與誤觸發。

支援兩種模式：

```text
1. Manual Speak Mode
2. Auto Detection / Always On with Threshold Mode
```

---

### 7.8.1 Manual Speak Mode

定義：

使用者按下 Speak 按鈕後開始送音訊給 AI，再按一次或放開後停止，具體互動可在實作時決定。

UI：

- Top bar 顯示 `Audio: Manual`。
- 狀態顯示 `Ready`。
- 右上區域出現醒目的藍色 `Speak` 按鈕。
- Audio Settings 內 `Manual Speak` radio 被選取。
- Always On threshold controls 顯示為 disabled / greyed out。

行為：

1. 使用者按下 Speak。
2. 系統開始 Listening。
3. 使用者講話。
4. 使用者停止 Speak。
5. 系統停止送音訊。
6. 產生正式 conversation card。

優點：

- 成本最可控。
- 誤觸發最低。
- 適合 Demo、測試、高噪音環境。

缺點：

- 對話不夠自然。
- 使用者需要手動操作。

---

### 7.8.2 Auto Detection / Always On with Threshold Mode

定義：

麥克風 device 保持啟用，但前端只在本機監測音量。只有音量超過 threshold 時，才啟動 AI listening / streaming。

核心原則：

```text
Microphone device: Always On
AI listening: Only activated above threshold
```

UI：

- Top bar 顯示 `Audio: Always On`。
- Top bar 顯示 `Threshold: 60%` 或目前設定值。
- 狀態顯示 `正常 Normal` / `Standby` / `Listening`。
- `Speak` 按鈕仍可顯示，但需為灰色 disabled，不可點擊。
- Audio Settings 內 `Always On` radio 被選取。
- Threshold slider 與 level meter 啟用。

行為：

1. 使用者允許麥克風。
2. 前端本機監測音量。
3. 音量超過 threshold，啟動 AI listening。
4. 系統開始送音訊給 AI。
5. 音量低於 threshold 並持續 silence duration 後，停止送音訊。
6. 產生正式 conversation card。

狀態：

| 狀態 | 說明 |
|---|---|
| Standby | 麥克風可用，但沒有送音訊給 AI |
| Listening | 音量超過 threshold，正在送音訊 |
| Ending | 音量低於 threshold，等待 silence duration 結束 |

---

### 7.8.3 Threshold 設定

HTML 上需要提供 Audio Settings。

設定項目：

| 設定 | 說明 |
|---|---|
| Activation Threshold | 啟動 AI listening 的音量門檻 |
| Silence Duration | 音量低於門檻多久後視為講話結束 |
| Pre-roll Buffer | 啟動前保留一小段音訊，避免漏掉句首 |
| Cooldown Time | 停止後多久內避免重複觸發 |
| Max Utterance Duration | 單段最長講話時間 |
| Input Device | 麥克風裝置 |
| Level Meter | 即時音量顯示 |

建議初始值：

| 項目 | 建議值 |
|---|---:|
| Activation Threshold | 依現場測試，初始可設 60% |
| Silence Duration | 700–1000 ms |
| Pre-roll Buffer | 300–500 ms |
| Cooldown Time | 300–500 ms |
| Max Utterance Duration | 15–30 秒 |

**主畫面 Audio Settings 面板範圍**：主畫面僅顯示 Threshold slider、Level Meter 與 Microphone 選擇器三項，保持版面簡潔。Silence Duration、Pre-roll Buffer、Cooldown Time、Max Utterance Duration 等進階參數，統一收進 ⚙ 設定頁（進階音訊設定），不出現在主畫面。

### 7.8.3.1 Threshold % ↔ dB 對映定義

| Threshold % | 對應 dB |
|---:|---:|
| 0% | −50 dB |
| 60% | ≈ −20 dB |
| 100% | 0 dB |

換算方式：線性對映，即 dB = −50 + (threshold% / 100) × 50。

Level Meter 的紅色門檻線依此公式計算後繪製，使視覺刻度與百分比設定值一致。

---

### 7.8.4 Level Meter

UI 應顯示目前音量與 threshold。

範例：

```text
音量等級 Level Meter
||||||||||||||||------
-50dB   -30dB   -12dB   0dB
```

目的：

- 協助使用者調整 threshold。
- 讓現場人員知道目前是否可能觸發收音。
- 降低背景噪音誤觸發。

---

### 7.8.5 Pre-roll Buffer

為避免漏掉句首，前端應保留最近 300–500 ms 的音訊。

當 threshold 被觸發時，把 pre-roll audio 一起送出。

目的：

避免漏掉重要句首，例如：

```text
不要
先
stop
do not
wait
```

---

### 7.8.6 成本控制規則

- Standby 狀態不送音訊給 AI。
- 只有 Listening 狀態送音訊。
- Ending 只在 silence duration 內繼續送音訊。
- 空白或低信心辨識結果不建立 card。
- Route B 只在有效語句完成後執行。
- 背景噪音不應觸發 AI listening。

---

## 7.9 語言方向偵測

系統根據轉錄文字的字元組成，自動判斷本次發言為中文或英文，決定翻譯方向，不需另外呼叫語言偵測 API。

偵測規則：

| 條件 | 判定結果 | 翻譯方向 |
|---|---|---|
| 轉錄文字含 CJK 字元，且 CJK 字元佔字元總數多數（> 50%） | 中文發言 | 中 → 英 |
| 否則（英文為多數，或無 CJK 字元） | 英文發言 | 英 → 中 |
| 中英夾雜 | 以多數字元語言為準 | 依上述規則 |

實作說明：

- CJK 字元範圍：U+4E00–U+9FFF（基本漢字）、U+3400–U+4DBF（擴充 A）等常見 CJK 區段。
- 判斷在後端收到 `conversation.item.input_audio_transcription.completed` 事件、取得完整轉錄文字後執行。
- 偵測結果決定 Route A / Route B 的翻譯目標語言。

---

## 8. UI 架構

## 8.1 主畫面區域

主畫面分成：

```text
1. Top Status Bar
2. Conversation Feed
3. Audio Settings Panel
4. Bottom Safety Notice
```

---

## 8.2 Top Status Bar

顯示：

- 語言方向：`中文 ↔ English`
- Audio Mode：`Audio: Always On` 或 `Audio: Manual`
- Threshold：Auto Detection 模式顯示
- Status：`正常 Normal` / `Ready` / `Standby` / `Listening`
- 精準翻譯：`精準翻譯 ON`
- Line / Station：例如 `Line A`
- Settings icon

### Auto Detection 模式範例

```text
中文 ↔ English | Audio: Always On | Threshold: 60% | 狀態 Status: 正常 Normal | 精準翻譯 ON | Line A | 設定
```

### Manual Speak 模式範例

```text
中文 ↔ English | Audio: Manual | Status: Ready | 精準翻譯 ON | Line A | 設定
```

---

## 8.3 Conversation Feed UI

標題：

```text
對話紀錄  Conversation Feed
```

Card 顯示規則：

- 左側顯示 timestamp。
- 不顯示 speaker role。
- 右側顯示原文與翻譯。
- 中文發言：中文在第一行，英文在第二行。
- 英文發言：英文在第一行，中文在第二行。
- 精準翻譯 ON 且完成後，第三行顯示 `精準翻譯：...`。
- 右側顯示 `[RT]`、`[Refined]` 或 `[Draft]` badge。

---

## 8.4 Auto Detection UI 狀態

Auto Detection / Always On 模式畫面：

- Top bar：`Audio: Always On`
- Top bar：`Threshold: 60%`
- Top bar：`狀態 Status: 正常 Normal`
- `Speak` 按鈕：灰色 disabled，不可點擊
- Audio Settings：`Always On` 選取
- Audio Settings：`Manual Speak` 未選取
- Threshold slider 啟用
- Level Meter 啟用
- Microphone device selector 可用

---

## 8.5 Manual Speak UI 狀態

Manual Speak 模式畫面：

- Top bar：`Audio: Manual`
- Top bar：`Status: Ready`
- 右上方顯示醒目的藍色 `Speak` 按鈕
- Audio Settings：`Manual Speak` 選取
- Audio Settings：`Always On` 未選取
- Threshold controls 顯示為 disabled / greyed out
- 顯示提示：`Click Speak to start speaking.`

兩張 UI 狀態圖的版面、字型、間距、卡片樣式應保持一致。唯一主要差異為：

| 模式 | Speak button | Threshold controls |
|---|---|---|
| Auto Detection | 灰色 disabled | 啟用 |
| Manual Speak | 藍色可點擊 | disabled / greyed out |

---

## 8.6 Audio Settings Panel

Panel 標題：

```text
Audio Settings
```

**主畫面 Audio Settings 面板**僅顯示以下三項，保持版面簡潔。Silence Duration、Pre-roll Buffer、Cooldown Time、Max Utterance Duration 等進階參數收進 ⚙ 設定頁（進階音訊設定），不出現在主畫面 Panel。

### Auto Detection 模式欄位

- Mode
  - Always On selected
  - Manual Speak unselected
- Threshold slider
- Level Meter
- Microphone device

### Manual Speak 模式欄位

- Mode
  - Manual Speak selected
  - Always On unselected
- Threshold slider（disabled / greyed out）
- Microphone device

---

## 8.7 Bottom Safety Notice

固定在底部。

建議文字：

```text
請注意安全，專注工作。避免在機台運轉或危險區域進行長時間對話。
For safety, stay focused on your work. Avoid long conversations while machines are operating or in hazardous areas.
```

---

## 9. 技術架構

### 9.1 整體架構

```text
[HTML / PWA Frontend]
- 麥克風輸入
- 本機音量 threshold 偵測
- 雙語 conversation feed
- 精準翻譯 ON / OFF
- Audio Mode 設定
- Glossary 設定頁

        ↓ HTTPS / WebSocket

[Backend API on Zeabur（Node.js）]
- 管理 session
- 接收音訊或文字
- 呼叫 Route A realtime translation
- 管理 Route B semantic refinement
- 查詢 glossary
- 儲存 logs
- 回傳字幕更新
- 管理設定值

        ↓

[PostgreSQL on Zeabur]
- glossary
- translation logs
- sessions
- user settings
- factory line settings
- audio settings

        ↓

[OpenAI API]
- gpt-realtime-whisper（串流轉錄，$0.017/分鐘）
- gpt-5-mini（即時翻譯 / 語意重整）
```

---

## 9.2 前端責任

- 在 iPad / 電腦瀏覽器運作。
- 顯示 conversation feed。
- 處理 mic permission。
- 在本機計算 audio level。
- 控制 threshold trigger。
- 顯示 level meter。
- 顯示 Draft / RT / Refined 狀態。
- 顯示 Auto Detection 與 Manual Speak 狀態。
- 控制 Speak button enabled / disabled。
- 不保存 OpenAI API key。

---

## 9.3 後端責任

- 保存 OpenAI API key。
- 管理 session。
- 呼叫 OpenAI API。
- 管理 Route A / Route B。
- 套用 Glossary。
- 儲存 translation logs。
- 儲存 audio settings。
- 提供 glossary API。
- 提供 conversation API。

---

## 9.4 PostgreSQL 資料

第一版：

- glossary terms
- translation logs
- sessions
- audio settings
- app settings

第二階段：

- users
- roles
- production lines
- glossary approval history
- safety keyword rules
- audio threshold profiles
- device profiles

---

### 9.5 存取保護與部署

**存取保護**：v1 程式內不實作登入邏輯；存取保護由 Zeabur 平台層處理（可設定 Basic Auth 或 IP 白名單限制），降低開發複雜度，第三版（Phase 3）再補完整帳號權限管理。

**自動部署**：採用 GitHub 連動自動部署（git push 至指定 branch 即觸發 Zeabur 重新部署），無需手動上傳或操作 CLI。

---

### 9.6 Session 生命週期

- 使用者開啟頁面時建立新 session，後端分配唯一 session id。
- 閒置超過 **30 分鐘**（無任何語音輸入）後，session 自動結束，相關 WebSocket 連線關閉。
- 使用者關閉頁面或瀏覽器 tab 時，前端觸發 session 結束事件，後端同步關閉連線。
- Session 結束後，該 session 的 translation logs 保留於 PostgreSQL 供回看。

---

## 10. Model 策略

### 10.1 Route A

用途：低延遲串流轉錄 + 即時翻譯。

**管線（接法 1）**：

1. 語音 → **`gpt-realtime-whisper`**（OpenAI Realtime API transcription session，WebSocket 連線，$0.017 / 分鐘）進行串流轉錄。
2. `conversation.item.input_audio_transcription.delta` 事件 → 逐字更新 **Draft 暫定字幕**（原文第一行即時出現）。
3. `conversation.item.input_audio_transcription.completed` 事件 → 取得正式原文，立即送 **`gpt-5-mini`** 做文字快翻 → 第二行即時翻譯，標示 `[RT]`。

#### 備選方案（暫不採用）

`gpt-realtime-translate`（2026/5/7 發布，$0.034 / 分鐘）可直接從語音產生翻譯語音與字幕，列為未來 A/B 測試備選。目前不採用的三個理由：

1. **原文字幕來源未確認**：delta 逐字字幕是否可靠取得尚待驗證。
2. **並行雙串流成本偏高**：若需同時保留原始轉錄串流，整體成本約為接法 1 的 3 倍。
3. **翻譯行為較難控制**：無法像純文字翻譯一樣套用 Glossary 與 Prompt 控制。

### 10.2 Route B

用途：語意重整、Glossary 強化、較穩定翻譯。

建議：

```text
gpt-5-mini
```

輸入為**完整原文 + Route A 翻譯 + Glossary 詞彙 + 對話上下文**，句子完成後才執行（與 §6.4 定義一致），以確保語意完整與術語一致性。完成後顯示第三行「精準翻譯：」，標示 `[Refined]`。

### 10.3 事後整理

第二階段可使用：

```text
gpt-5
```

用途：

- 交接紀錄
- 會話摘要
- SOP 草稿
- 品質問題整理
- 事故對話整理

---

## 11. Latency 與成本目標

### 11.1 Latency 目標

| 指標 | 目標 |
|---|---:|
| 第一段原文字幕 | 盡量低於 1 秒 |
| 第一段翻譯字幕 | 盡量低於 1–2 秒 |
| 一般短句完整翻譯 | 盡量在 2 秒內 |
| Refined translation | 盡量低於 1–2 秒 |
| 安全相關指令 | 可稍慢，但應更穩定 |

### 11.2 成本控制目標

| 指標 | 目標 |
|---|---|
| Standby | 不產生 AI streaming 成本 |
| 背景噪音 | 不觸發 AI listening |
| 有效講話 | 能穩定觸發 |
| 句首漏字 | 不漏掉否定詞與命令詞 |
| Route B | 只在有效語句完成後執行 |
| 空白片段 | 不建立 conversation card |

---

## 12. MVP 範圍

### 12.1 第一版必須包含

- HTML / PWA 主畫面。
- 雙向語音輸入。
- 中文 / 英文即時翻譯。
- Conversation feed。
- Timestamp-only conversation cards。
- 不顯示 speaker role。
- 中文原文 / 英文翻譯顯示邏輯。
- 英文原文 / 中文翻譯顯示邏輯。
- 精準翻譯第三行顯示。
- Draft / RT / Refined 狀態。
- Route A 即時翻譯。
- Route B 精準翻譯。
- 精準翻譯 ON / OFF。
- 基本 Glossary。
- PostgreSQL 儲存。
- Translation logs。
- 底部安全提醒。
- Zeabur 部署。
- Manual Speak Mode。
- Auto Detection / Always On with Threshold Mode。
- Manual 模式下可點擊 Speak button。
- Auto Detection 模式下 disabled Speak button。
- Threshold slider。
- Level meter。
- Silence duration。
- Pre-roll buffer。
- Standby / Listening / Ending 狀態。

### 12.2 第一版可暫緩

- 完整權限管理。
- Admin approval。
- 多產線 Glossary。
- Safety keyword 自動標記。
- Focus Mode。
- Log 搜尋。
- 事後摘要。
- 語音輸出。
- Speaker diarization。
- 自動環境噪音校準。
- 進階降噪。
- 多麥克風支援。
- 不同產線 threshold profile。

---

## 13. 開發階段

### Phase 1：UI / 技術 Demo

目標：確認 UI 方向與技術可行。

內容：

- HTML / PWA。
- Conversation Feed。
- Timestamp-only cards。
- Manual / Auto Detection UI 狀態。
- Speak button enabled / disabled 差異。
- Threshold slider。
- Level meter。
- Route A 即時翻譯。
- 精準翻譯開關 UI。
- 固定安全提醒。

### Phase 2：內部試用版

目標：讓現場人員實際使用。

內容：

- Route B 語意重整。
- Glossary 串接。
- Translation logs。
- Auto-scroll 暫停與回到最新。
- Zeabur + PostgreSQL 部署。
- Audio settings 保存。
- Pre-roll buffer。
- Silence duration tuning。
- Max utterance duration。
- 空白片段過濾。

### Phase 3：穩定版

目標：成為正式內部工具。

內容：

- Glossary 管理頁。
- 基本登入。
- 多站別 / 產線設定。
- Safety keyword 標示。
- Log viewer。
- 翻譯品質回報。
- Refined translation 效果分析。
- Threshold presets by area。
- Background noise profile。
- Per-device audio profile。
- Auto-calibration。

---

## 14. 成功指標

### 14.1 使用體驗

- 現場人員能快速理解 UI。
- 不需要知道 speaker role 也能理解對話脈絡。
- 雙方能看懂原文、翻譯與精準翻譯。
- 對話上下文不會太快消失。
- 使用者能理解 Draft / RT / Refined。
- 使用者能理解 Manual / Auto Detection。
- 使用者能透過 level meter 調整 threshold。

### 14.2 翻譯品質

- 常見工廠術語翻譯一致。
- 安全、品質、機台相關指令不被明顯誤譯。
- Route B 開啟時，翻譯品質比 Route A 更穩定。
- Glossary 對專有名詞有明顯改善。

### 14.3 系統穩定性

- iPad / 電腦瀏覽器可穩定使用。
- 網路中斷時有明確提示。
- 麥克風權限問題有明確提示。
- 對話紀錄可保存並回看。
- Audio Mode 切換後行為明確。
- Threshold 設定不會造成 UI 混亂。
- Manual / Auto Detection 兩個 UI 狀態保持一致風格。

### 14.4 成本控制

- Standby 不送音訊給 AI。
- 背景噪音誤觸發率可接受。
- 有效講話能穩定啟動。
- 句首不漏掉關鍵否定詞。
- Route B 只在有效語句後執行。
- 空白片段不產生 card。

---

## 15. 目前產品結論

本產品應設計為：

```text
工廠內部雙語即時對話系統
```

而不是：

```text
一般即時翻譯工具
```

第一版核心：

```text
Realtime Translation
+ Optional Refined Translation
+ Timestamp-only Conversation Feed
+ No Speaker Classification
+ Glossary
+ Audio Activation Mode
+ Manual Speak / Auto Detection
+ Zeabur / PostgreSQL 部署
```

UI 核心：

```text
每一輪對話都清楚顯示：
- timestamp
- 原文
- 翻譯
- 精準翻譯（如果開啟）
- 狀態
```

音訊核心：

```text
麥克風 device 可以 Always On，
但 AI listening 不能 Always On。
只有當音量超過可設定 threshold，
才啟動 AI stream。
```

Manual / Auto Detection 的核心差異：

```text
Manual Speak：Speak button 可點擊。
Auto Detection：Speak button 灰色 disabled，靠 threshold 自動觸發。
```

最終方向：

讓臺籍員工與英文員工可以共同看著同一個畫面，在工廠現場進行足夠即時、可回看、有術語控制、且成本可控的雙語對話。
