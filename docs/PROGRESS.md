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
