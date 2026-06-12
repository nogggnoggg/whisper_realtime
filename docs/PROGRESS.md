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

**已知問題**：
- gpt-realtime-translate 是否回傳原文字幕未確認（暫不影響，已選接法 1）
