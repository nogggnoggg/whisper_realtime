# 進度日誌 Progress Log

每次工作 session 結束時追加：完成事項、目前狀態、下一步、已知問題。新 session 開始時先讀此檔。

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
