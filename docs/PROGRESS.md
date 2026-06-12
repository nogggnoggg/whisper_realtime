# 進度日誌 Progress Log

每次工作 session 結束時追加：完成事項、目前狀態、下一步、已知問題。新 session 開始時先讀此檔。

## 📌 目前狀態（每次更新時覆寫此區塊，不要往下追加）

最後更新：2026-06-13（Auto 模式首次載入修復）

**所在階段**：Zeabur 部署完成、自動化測試全過、wss 修復上線、真 key 已填（REFINE_MODEL 使用者改為 gpt-5.5）→ 等線上語音實測
**怎麼跑**：線上 https://whisper-realtime-leon.zeabur.app ；本機 PowerShell `npm start`（port 3100）→ http://localhost:3100

**整體 Checklist**：

- [x] PRD/mockup 定稿（v1.2）
- [x] git + GitHub（nogggnoggg/whisper_realtime）
- [x] Phase 1：UI + Manual/Auto 模式 + Route A（gpt-realtime-whisper → gpt-5-mini）
- [x] GA 協定修正 + STT 精度參數化（STT_MODEL/STT_DELAY/降噪/術語 prompt）
- [x] 繁體保證（OpenCC）/ 翻譯 provider 可換（openai/anthropic/custom）/ 斷句滑桿（預設 2s）
- [x] Manual 模式講完才顯示（draft 抑制 + 原文翻譯同步渲染）
- [x] Phase 1 實測及問題修正（精度參數化、供應商抽象、多語言對 Roadmap）
- [x] Phase 2：Route B 精準翻譯、Glossary、PostgreSQL（D-012 決策定案，schema 按 (source_lang, target_lang) 語言對設計）
- [x] PROTOCOL.md 擴充（WS settings/refined 訊息、DB schema、REST API、管理頁）
- [x] DECISIONS.md D-012 Phase 2 架構決策
- [x] Zeabur 部署：PG service + app service（Docker/node:22-alpine）+ 網域 whisper-realtime-leon.zeabur.app（D-013）
- [x] 修復 HTTPS 下 WS 無限重連（app.js 寫死 ws:// → 依協定選 wss://，commit 4bb21d3）
- [x] 修復首次進入 Auto 模式不啟動（AudioContext suspended → init resume + resumeContext() 手勢兜底，commit 7ac58f3acd3b4c49ba0d5496823817dace374778）
- [x] Phase 2 自動化實測（Workflow phase2-deploy-verify）：Glossary REST CRUD 9/9 過、靜態頁/資產 200、WS 握手 OK、PG 持久化確認（id=1 zh/en 隔離區→quarantine zone）
- [x] 使用者把 Zeabur app 的 OPENAI_API_KEY 換成真 key（並自行把 REFINE_MODEL 改為 gpt-5.5）
- [ ] **線上語音實測 Route A + Route B 精準翻譯（含 Glossary 術語套用、translation_logs 寫入確認） ← 現在卡在這**
- [ ] Zeabur 平台層存取保護（basic auth / IP 限制，部署驗證 OK 後設定）
- [ ] Phase 3：韓文 + 語言對雙選單（PRD §7.10）

**下一步**：(1) 使用者開 https://whisper-realtime-leon.zeabur.app 做線上語音實測（Route A 轉錄/翻譯、Route B 精譯、Glossary：說含「隔離區」的句子應譯出 quarantine zone；實測時請用無痕視窗確認首次載入 Auto 模式直接可用）；(2) OK 後設 Zeabur 平台層存取保護（basic auth / IP 限制）
**注意事項**：app 的模型/供應商由 Zeabur 環境變數控制：`TRANSLATE_PROVIDER`（openai/anthropic/custom）、`TRANSLATE_MODEL`、`REFINE_MODEL`、`STT_MODEL`；STT 目前僅 OpenAI 實作，OPENAI_API_KEY 必填。真 key 永不經過對話，由使用者在 Zeabur 後台填。開發用 workflow 模式且 subagent 要做模型分配（CLAUDE.md Development conventions）。

---

## 2026-06-13 — 修復首次進入 Auto 模式不啟動

**症狀**：使用者首次載入頁面進入 Auto 模式，麥克風未觸發任何語音串流或 level meter 反應；切至 Manual 模式講一輪後再切回 Auto 模式才恢復正常。

**根因**：瀏覽器 autoplay 政策在頁面載入時 suspend AudioContext，導致 worklet 的 `process()` 方法不執行 → 無法計算 RMS level → `onLevelChange` 事件永不觸發 → 門檻偵測死鎖。完整 codebase 原本無 `resume()` 呼叫。Manual 模式正常的原因是 `manualStart()` 包含 try-catch，隱含有類似 resume 機制。

**修法三層**：
1. **Init resume（openai-stt.js）**：constructor 中於初始化 AudioContext 後立即呼叫 `audioContext.resume()`，處理首次載入 suspended 狀態
2. **setMode + manualStart（audio.js）**：`setMode()` 和 `manualStart()` 中各呼叫 `resumeContext()`，切換模式或開始講話前確保 AudioContext 為 running 狀態
3. **Pointer gesture fallback（app.js）**：html 元素 once pointerdown 事件呼叫 `resumeContext()`，為最後一道兜底確保使用者觸摸/點擊頁面後 AudioContext 可恢復

**實裝與驗證**：
- commit 7ac58f3acd3b4c49ba0d5496823817dace374778（feat: Auto mode first-load fix — init resume + resumeContext() + gesture fallback）
- git push origin main 自動觸發 Zeabur 重建（deployment 6a2c36af1c90559b717b9110 已完成）
- 驗證結果：passed=true（自動驗證 liveFileOk=true、wssOk=true）；首次載入 Auto 模式直接可用無需模式切換

**Workflow 與模型分配**：本次修復使用者要求 Review 用 fable；未來類似問題優先分配 fable 做根因分析與修法決策

**下一步**：使用者開無痕視窗驗證首次載入 Auto 模式直接可用，再進行線上語音實測

---

## 2026-06-13 — 修復 HTTPS WS 重連問題

**症狀**：Zeabur 部署後，在 HTTPS 頁面（https://whisper-realtime-leon.zeabur.app）開啟會無限「重連中 Reconnecting」，服務無法正常工作。

**根因**：public/app.js:71 寫死 `'ws://' + location.host + '/ws'`（協定固定 ws://），HTTPS 頁面下被瀏覽器混合內容（mixed content）安全政策阻擋，WebSocket 連線失敗導致自動重連迴圈。本機 http://localhost 不受影響，故本機實測未發現。

**修法**：修改 public/app.js 第 71 行，改為依 `location.protocol` 動態選擇協定：
```javascript
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsURL = `${protocol}//${location.host}/ws`;
```

**部署與驗證**：
- commit 4bb21d3：修正 app.js
- git push origin main 自動觸發 Zeabur 重建（deployment 6a2c2f0c1c90559b717b8da6 已完成）
- 驗證結果：passed=true；https://whisper-realtime-leon.zeabur.app 正常載入，WS 連線成功，頁面從「Reconnecting 無限迴圈」恢復為「Status: Ready」

**決策確認**：D-013 遺留項「git push 是否觸發自動重建」已驗證：git push 會自動觸發 Zeabur 重建（無需手動呼叫 MCP）

**下一步**：使用者在 Zeabur 後台把 app 的 OPENAI_API_KEY 換成真 key，再做線上語音實測

---

## 2026-06-12 — Zeabur 部署 + Phase 2 自動化實測（晚間）

**完成**：
- Zeabur `whisper_realtime` 專案（projectId `6a2bfffe39f255e7f8bd12bf`，env `6a2bfffecf558888ca4bc7dc`）：
  - `postgresql` service（官方模板 B20CX0，serviceId `6a2c24f039f255e7f8bd1a6a`，PG 18）
  - `app` service（serviceId `6a2c25ad39f255e7f8bd1ac3`，GitHub main 0211c15，Dockerfile node:22-alpine，port 8080）
  - 網域 https://whisper-realtime-leon.zeabur.app
  - 環境變數：`DATABASE_URL=${POSTGRES_CONNECTION_STRING}`（內網直連）、`PGSSLMODE=disable`、`TRANSLATE_PROVIDER=openai`、`TRANSLATE_MODEL=gpt-5-mini`、`REFINE_MODEL=gpt-5-mini`、`STT_MODEL=gpt-realtime-whisper`、`OPENAI_API_KEY`＝**佔位值，待使用者換真 key**
- Workflow `phase2-deploy-verify`（模型分配：glossary-api=haiku、ui-ws-smoke=haiku、db-verify=sonnet）：
  - Glossary REST CRUD 9/9 通過（含 400/404/語言對過濾）；資料持久化於 PG（glossary_terms id=1，zh/en 隔離區→quarantine zone，enabled=true）
  - 靜態頁 `/`、`/glossary.html`、`/app.js`、`/glossary.js` 皆 200；WSS 握手成功
  - runtime log：`[db] 已連線，資料表就緒`，無任何 `[db]` 錯誤；佔位 key 觸發預期的 `[initSTT] failed`（證明 WS→OpenAI 鏈路有接上）

**已知問題 / 教訓**：
- 本機直連 Zeabur PG 不可行：Lightsail 防火牆擋外網 5432 → 改為「部署後於 Zeabur 內網實測」
- Zeabur MCP `execute-command` 跑在隔離臨時容器（無叢集網路），psql 連 DB 一律逾時 → DB 驗證請改走 app 的 REST API 或 runtime log，別再用容器內 psql（db-verify agent 曾因此空轉 ~20 分鐘，已手動停止 workflow 改由主 session 驗證）
- deploy 是用 MCP `deploy-from-specification`（GitHub source + inline Dockerfile）；git push 是否自動觸發重建尚未驗證，要重新部署可再呼叫同一 MCP 指令

**下一步**：使用者換真 OPENAI_API_KEY → 線上語音實測 Route A/B + Glossary 套用 → 平台層存取保護

## 2026-06-12 — 文件定稿

**完成**：
- PRD 更新至 v1.2（Route A 接法 1、Node.js、Zeabur 保護、進階設定收設定頁、threshold/語言偵測/session 定義）
- UI-mockup 同步修正
- 建立 DECISIONS.md / PROGRESS.md
- CLAUDE.md 更新

**目前狀態**：
- 純文件階段，尚無程式碼、尚未 git init

**下一步**：
- git init + 首次 commit
- 推 GitHub
- Zeabur 連動
- Phase 1 開發（用 Workflow 模式）

## 2026-06-12 — git / GitHub / Zeabur 資訊

**完成**：
- git init（main 分支）+ baseline commit `ae2ee96`
- 推上 GitHub：https://github.com/nogggnoggg/whisper_realtime （與 GitHub 初始 README/LICENSE 合併為 `6a8ff25`）

**部署資訊**：
- Zeabur server ID：`6a2bfffe39f255e7f8bd12bf`
- 部署方式：GitHub 連動自動部署（待 Phase 1 有可跑程式後再在 Zeabur 網頁連動）
- 待辦：Zeabur 加 PostgreSQL service（自動注入 DATABASE_URL）、環境變數填 OPENAI_API_KEY（使用者自行填入，不經過對話）

**下一步**：
- Phase 1 開發（Workflow 模式，各 subagent 指定模型）

## 2026-06-12 — Phase 1 實作完成（commit 537e21e）

**完成**：
- Workflow（scaffold → backend/frontend-ui/audio 平行 → integrate，sonnet×5，~229k tokens）
- 後端：Express + WS(/ws)、OpenAI Realtime transcription（gpt-realtime-whisper）、gpt-5-mini 翻譯（reasoning_effort: minimal）、CJK 語言偵測（4/4 自測通過）
- 前端：照 mockup 的主畫面、Draft/RT 卡片流、Manual/Auto 模式、threshold 狀態機（800ms silence / 20s max / 300ms cooldown）、level meter、自動重連
- docs/PROTOCOL.md：前後端 WS 協定契約
- 驗證：全檔 node --check 通過、server 可啟動回 200、WS 可連線
- 修正：scaffold 把翻譯模型誤寫為 gpt-4o-mini，已改回 gpt-5-mini（translate.js + PROTOCOL.md）

**目前狀態**：可本機跑，尚未用真 API key 實測語音流程

**下一步**：
- 使用者本機 .env 填 OPENAI_API_KEY → 真實語音測試（驗證延遲/轉錄品質/threshold 手感）
- 實測 OK 後：Zeabur 連動部署 → Phase 2（Route B、Glossary、PostgreSQL logs）

**已知問題**：
- openai-stt.js 的 Realtime API 事件流尚未用真 key 驗證過（session.update 參數、commit 行為）

**已知問題**：
- gpt-realtime-translate 是否回傳原文字幕未確認（暫不影響，已選接法 1）

## 2026-06-12 — GA 協定修正與 STT 精度參數化完成

**完成**：
- **GA 協定修正**：移除 beta header、設置 `intent=transcription` 顯式聲明、使用巢狀 `session.update` 結構、修復 `_send ready` 前置攔截 bug（確保音訊 chunk 送出時 session 已建立完成）
  - 實測驗證：語音串流轉錄（delta → draft）→ 完成（completed → final）→ gpt-5-mini 翻譯（translation）全鏈路通暢
  - 使用者回饋：翻譯品質可接受，但原文轉錄精度不足 → 觸發本次精度參數化
- **STT 精度參數化**：
  - 新增環境變數：`STT_MODEL`（預設 `gpt-realtime-whisper`，可換 `gpt-4o-transcribe`）、`STT_DELAY`（預設 `medium`，推薦工廠場景用 `high`）、`STT_NOISE_REDUCTION`（預設 `near_field`，可選 `far_field` 或 `off`）、`STT_PROMPT`（可自訂工廠術語詞表，gpt-4o-transcribe 專用）
  - 驗證：API 欄位路徑確認、合法值清單確認、session.updated echo 行為確認（部分欄位不被 echo 但有效）
  - 說明文件：PROTOCOL.md 6.6.1 詳述各參數用途、合法值、驗證註記
- **決策記錄**：DECISIONS.md D-009 記錄「STT 精度策略」決策

**目前狀態**：
- Phase 1 已可本機完整跑通語音→轉錄→翻譯流程
- 全鏈路基本功能驗證完成

**下一步**：
- 使用者本機 A/B 實測：`gpt-realtime-whisper` vs `gpt-4o-transcribe` 轉錄精度對比
  - 相同工廠術語提示詞下，檢驗兩模型對機械音、行業術語的識別準確率
  - 根據結果決定是否升級預設模型或維持雙選方案
- Zeabur 連動部署（環境變數註入 OPENAI_API_KEY + STT_* 參數）
- Phase 2 開發（Route B 精準翻譯、Glossary 管理、PostgreSQL 日誌）

**已知問題**：
- gpt-4o-transcribe 在 Realtime API 中是否支援 delta 事件（partial transcription）尚未驗證，可能需要轉錄邏輯調整

## 2026-06-12 — 文件定稿：翻譯供應商抽象 & 繁體輸出規範

**完成**：
- **PROTOCOL.md 環境變數表擴充**：新增 `TRANSLATE_PROVIDER`（openai|anthropic|custom，預設 openai）、`TRANSLATE_MODEL`（預設依 provider：openai→gpt-5-mini / anthropic→claude-haiku-4-5 / custom→必填）、`ANTHROPIC_API_KEY`（provider=anthropic 時必填）、`TRANSLATE_BASE_URL` 與 `TRANSLATE_API_KEY`（provider=custom 用，OpenAI 相容端點）、`SILENCE_DURATION`（Auto 模式無音停止延遲，預設 2000ms，可調）
- **PROTOCOL.md 新增 6.9 節「中文輸出規範」**：server 端以 OpenCC（zh-Hans → zh-Hant）統一後處理所有輸出中文（draft / final / translation），保證台灣正體繁體一致；理由與實作方式
- **DECISIONS.md 新增 D-010「繁體中文輸出與翻譯供應商抽象」**：(a) server 端 OpenCC 後處理保證繁體（理由：STT 模型簡繁隨機，後處理不依賴特定模型）；(b) 翻譯層抽象為三 provider（理由：使用者 A/B 不同家模型，翻譯純文字進出最易抽換）；(c) silence duration 由 800ms 改為可調、預設 2000ms（理由：現場實測句中停頓 1-2 秒被提早切斷）
- **Manual 模式「講完才顯示」修正**（稍早 commit）：draft 抑制、原文+翻譯同時渲染、12 秒保底

**目前狀態**：
- Phase 1 文件與功能完整，待實裝翻譯供應商抽象與繁體輸出後處理
- Manual 模式已修正，可本機跑

**下一步**：
- 實裝翻譯供應商抽象（環境變數讀取 TRANSLATE_PROVIDER / TRANSLATE_MODEL，支援 openai / anthropic / custom 端點）
- 實裝 OpenCC 後處理（所有中文輸出統一 zh-Hans → zh-Hant）
- 調整 silence duration 預設 2000ms，環境變數 `SILENCE_DURATION` 可調
- 使用者本機實測：繁體輸出手感、斷句精度、anthropic provider 翻譯品質
- 驗證完成後 Zeabur 連動部署

**已知問題**：
- OpenCC library 選型待確認（node-opencc 或 opencc-wasm，需驗證 npm 可用性）
- Anthropic Claude 模型在翻譯場景的成本 vs 品質對比待測

## 2026-06-12 — 多語言對 Roadmap 定案（韓/中/英）

**完成**：
- PRD v1.2 補多語言對需求：§2.2 目標、§3 非目標、新增 §7.10（兩選單設計、偵測通用化、寫死點備忘、排程）、§9.4 schema 語言對原則、§13 Phase 3 項目
- DECISIONS.md D-011、CLAUDE.md 同步

**目前狀態**：程式碼不變，繼續 Phase 1 實測（繁體輸出/斷句/翻譯 provider）

**下一步**：
- 使用者實測 commit 40646df 的三項功能
- 實測 OK → Zeabur 部署 → Phase 2（Route B、Glossary、PostgreSQL — schema 按語言對設計）

## 2026-06-12 — Phase 2 架構文件定案

**完成**：
- **PROTOCOL.md 擴充**：
  - 新增 WS 訊息：C→S `settings` 訊息（refined 開關）、S→C `refined` 訊息（第三行精準翻譯）
  - 環境變數表補充：`DATABASE_URL`（Zeabur PG 連線，無值時 DB 功能停用）、`REFINE_MODEL`（精準翻譯模型，獨立可調）
  - 新增 §7「資料庫 Schema」：三表 `glossary_terms`（術語表）、`translation_logs`（翻譯日誌）、`sessions`（session 日誌），各表標註語言對一級欄位原則
  - 新增 §8「REST API 端點」：`GET /api/glossary`（查詢）、`POST /api/glossary`（新增）、`DELETE /api/glossary/:id`（刪除）
  - 新增 §9「管理頁面」：`/glossary.html` Glossary 管理頁功能說明（表格、搜尋、新增、編輯、刪除、導出）
- **DECISIONS.md 新增 D-012**：Phase 2 架構決策
  - (a) DB Graceful Degrade：無 DATABASE_URL 時翻譯照常進行、Glossary 停用（部署彈性 + 離線可用）
  - (b) Route B 沿用 provider 抽象、REFINE_MODEL 獨立可調（不同 provider 可混搭）
  - (c) Glossary 以 (source_lang, target_lang) 語言對為一級欄位，原文包含比對，支援任意語言組合
  - (d) Pre-roll 400ms 環形緩衝僅用於 Auto 模式（捕捉麥克風啟動後立即發音），Manual 模式無 pre-roll
- **PROGRESS.md 覆寫頂部狀態**：Phase 2 實裝完成、現在卡在「使用者實測 Phase 2」、下一步 Zeabur 部署

**目前狀態**：文件完整、決策確認，等待使用者實測

**下一步**：
- 使用者在 Zeabur 建 PostgreSQL service
- 本機 .env 補 DATABASE_URL 與 REFINE_MODEL，實測 Route B + Glossary
- 實測 OK 後進行 Zeabur 連動部署
