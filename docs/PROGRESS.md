# 進度日誌 Progress Log

每次工作 session 結束時追加：完成事項、目前狀態、下一步、已知問題。新 session 開始時先讀此檔。

## 📌 目前狀態（每次更新時覆寫此區塊，不要往下追加）

最後更新：2026-06-13（中英 code-switch 翻譯方向 bug 根因確認 D-017；Roadmap 先行修正，待實作 B+A）

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
- [x] 修復 Route B 無聲失敗（gpt-5.5 不支援 reasoning_effort=minimal → 環境變數覆寫＋400 自動回退＋前端 refined_error 提示，commit b3e47f3f7c141e4c9b2511644564f6313d931b52）
- [x] Phase 2 自動化實測（Workflow phase2-deploy-verify）：Glossary REST CRUD 9/9 過、靜態頁/資產 200、WS 握手 OK、PG 持久化確認（id=1 zh/en 隔離區→quarantine zone）
- [x] 使用者把 Zeabur app 的 OPENAI_API_KEY 換成真 key（並自行把 REFINE_MODEL 改為 gpt-5.5）
- [x] STT_LANGUAGE 環境變數實作（單語現場可設 ISO-639-1 碼；雙語留空）；PROTOCOL.md §6.6 / §6.6.1 全部可調 STT 參數補齊說明（合法值、建議值、Zeabur 設定方式）（D-014）
- [x] **線上語音實測 Route A + Route B 精準翻譯（含 Glossary 術語套用、translation_logs 寫入確認）**（已通過）
- [x] app 內 HTTP Basic Auth（BASIC_AUTH_USERS，D-016）—**已於 Zeabur 設 BASIC_AUTH_USERS 並線上驗證生效（2026-06-13）：/ 與 /api/* 回 401、/healthz 200、部署 6a2d5563 RUNNING**
**Phase 3（穩定版，PRD §13）— 進行中**（此里程碑含多個功能，依下列順序推進）

*已完成的 Phase 3 項目：*
- [x] Glossary 管理頁（Phase 2 期間完成）
- [x] 基本登入＝app 內 HTTP Basic Auth（D-016，已上線驗證生效，見上）

*待辦（依優先序）：*
- [x] **① 自訂 Refine Prompt 管理頁（精譯指令）+ 導覽修復（D-015）— 實作完成（待部署 CRUD 驗證）**
  - 功能：類似 Glossary 的頁面，讓使用者對 Route B refine model 下自訂指令（先讀完整句→依意圖重寫→去口語化等）
  - 決策：**加在硬規則之上**（保留繁體/glossary/只回譯文/保留數字單位，最末重申不可覆蓋）｜**多組具名 prompt 選一個 active**（direction-agnostic）｜**topbar 加兩個連結**（詞彙表、精譯指令）
  - 完成項目：DB 表 `refine_prompts` + `/api/refine-prompts` GET/POST/PUT/DELETE（套 requireDb）+ `refine-prompts.html/js` + refine.js `buildSystemPrompt` 注入（additive，硬規則最末重申）+ index.html topbar 導覽兩連結 + 無 DB graceful degrade（503 + 頁面提示 + Route B 回退寫死預設）
- [ ] **② 中英 code-switch 翻譯方向 bug 修正（D-017）← 下一步（bug，優先）**
  - 根因（trace 實證）：中文夾較多英文的句子 CJK<50% 被判 en → 翻成中文（翻錯邊）。非模型 echo，是 D-006 二元門檻不適合 code-switch。
  - 修法：B＝`server/lang.js` 門檻改環境變數 `LANG_CJK_THRESHOLD`（預設下調 0.15）；A＝`translate.js`/`refine.js` prompt 強制整句全譯、夾雜外語一併翻、不照抄。
  - 範圍：僅中↔英；多語言 per-script 偵測留 Phase 4（見 ③、D-011、D-017）。
- [ ] **③ 韓文 + 語言對雙選單**（PRD §7.10、D-011；無迫切韓文需求前不啟動）；含**偵測通用化（per-script，CJK/諺文/拉丁）** — D-017 的多語言部分併此處理
- [ ] （未排程）其他 Phase 3 條目：多站別/產線設定、Safety keyword 標示、Log viewer、翻譯品質回報、Refined translation 效果分析

**Backlog（待執行，未排定；線上實測後再評估是否做）**：

- [ ] (需寫碼) `STT_MIN_UTTERANCE_MS`：server commit gating + openai-stt.js 新增 `clear()`（送 input_audio_buffer.clear），過濾極短誤觸發產生的雜訊卡片；預設關（0）。**程式碼目前未實作**，加 Zeabur 變數無效（見 D-014）
- [ ] (需寫碼) `STT_CHUNK_MS` 可調（前端 append 塊大小，現寫死 ~20ms，需改 pcm-worklet.js/audio.js）+ 修 `SILENCE_DURATION` 幽靈變數（PROTOCOL 列過但 server 從不讀；靜音實際由前端設定頁滑桿控制 → 接成真的或從文件移除以免誤會）
- [ ] (低成本/面板可見性) 視需要把「已支援但未上 Zeabur」的變數以預設值加進面板：`TRANSLATE_REASONING_EFFORT`(minimal)、`REFINE_REASONING_EFFORT`(minimal；gpt-5.5 不支援會自動移除)；換供應商才需 `ANTHROPIC_API_KEY`/`TRANSLATE_BASE_URL`/`TRANSLATE_API_KEY`；`STT_PROMPT`(僅 gpt-4o-transcribe)。這類**程式碼已支援**，只是沒加面板，跑預設值
- [ ] (需寫碼/之後評估) 升級存取保護為 session/cookie 登入（方案 C）：真正登入頁 + 登出按鈕 + 閒置逾時失效 + 關瀏覽器清除憑證。動機＝目前 Basic Auth 無真正登出、憑證快取到「瀏覽器關閉」才清（關分頁不清）、server 無法控制有效期或強制清除（見 D-016）。注意：「關分頁瞬間失效」即使 session 也難 100% 保證，能做到的是登出/閒置逾時/關瀏覽器清
- [ ] (低成本/之後評估) `LANG_CJK_THRESHOLD` 調整 UI（設定頁欄位/滑桿）：D-017 本期用環境變數，使用者原想要像 glossary 那樣點進去調的 UI，留待併 D-004 ⚙設定頁或 Phase 4 一起做

**下一步**：實作 D-017 修法（B：lang.js `LANG_CJK_THRESHOLD` 可調、預設 0.15；A：translate.js/refine.js prompt 強制全譯）走 Workflow → 部署 → 重講失敗句確認改判 zh→翻英 → 移除 [trace] 暫時 log。（D-015 精譯指令頁亦待線上 CRUD 實測。）
**注意事項**：app 的模型/供應商由 Zeabur 環境變數控制：`TRANSLATE_PROVIDER`（openai/anthropic/custom）、`TRANSLATE_MODEL`、`REFINE_MODEL`、`STT_MODEL`；STT 目前僅 OpenAI 實作，OPENAI_API_KEY 必填。真 key 永不經過對話，由使用者在 Zeabur 後台填。`STT_LANGUAGE`：單語為主現場可設（如 `zh`），雙語輪流現場留空（auto-detect）。`BASIC_AUTH_USERS`：未設＝全站開放（程式正常運行但無驗證）；設多組 `user:pass` 後保護靜態頁、`/api/*` 及 WebSocket `/ws`；Basic Auth 無正式登出，需關閉瀏覽器或清除憑證。開發用 workflow 模式且 subagent 要做模型分配（CLAUDE.md Development conventions）。

---

## 2026-06-13 — 中英 code-switch 翻譯方向 bug 根因確認（D-017）+ Roadmap 先行修正

**現象**：Always-On 講中英夾雜句，原文轉錄出來但「翻譯欄呈現的不是想要的語言」。使用者一度以為是即時翻譯 / echo。

**用 [trace] log 實證根因**（線上重現 + Zeabur runtime log）：
- 句「please幫我check一下。 the shipment,然後update狀態。」→ `final lang=en` → `translate.out="請幫我檢查一下貨件，然後更新狀態。"`。即偵測判成**英文方**→翻成**中文**（翻錯邊）；非模型 echo（模型翻得出來，只是方向錯）。
- 對照「我準備commit現在這個版本」CJK≈60% 判 zh→正確翻英。差別在英文佔比：英文越多 CJK 佔比越低，跌破 D-006 的 50% 門檻。
- 同時確認轉錄機制：draft 逐字串流（邊講邊轉錄），翻譯在 audio.stop（commit）後才做；長句因停頓≥2s 被 silence 切成多段，每段各自翻譯。

**Roadmap 先行修正（本次，依使用者指示「先修正再執行」）**：
- DECISIONS：D-006 加更正註記；新增 **D-017**（可調 CJK 門檻 + prompt 全譯；範圍限中↔英；多語言 per-script 留 Phase 4）。
- dashboard：Phase 3 待辦新增「② D-017 bug 修正（優先）」，韓文順為 ③ 並註明偵測通用化併此；backlog 加「LANG_CJK_THRESHOLD 調整 UI」。

**待執行（下一步）**：走 Workflow 實作 B（lang.js `LANG_CJK_THRESHOLD`，預設 0.15）+ A（translate.js/refine.js prompt 強制全譯）→ 部署 → 重講失敗句確認改判 zh→翻英 → 移除 [trace] 暫時 log。

---

## 2026-06-13 — 自訂 Refine Prompt 管理頁實作完成（D-015）

**完成事項**：
- **DB**：新增 `refine_prompts` 表（`id / name / prompt_text / is_active / enabled / created_at / updated_at`）；`getActiveRefinePrompt()` 取單一 active 組；`is_active` 設定時自動清除其他組；無 DB 時返回 null（沿用 `isDbEnabled`）。
- **REST**：`/api/refine-prompts` GET / POST / PUT / DELETE 四端點，套用 `requireDb` middleware；無 DB 時一律 503（`{"error":"db not available"}`）；PUT `:id` 帶 `is_active: true` 時後端先清其他再設定。
- **前端頁**：`public/refine-prompts.html` + `refine-prompts.js`（沿用 glossary 頁架構）：表格列出所有組、新增/編輯/設 active/刪除按鈕；API 503 時顯示離線提示，不崩潰。
- **Route B 注入**：`server/refine.js` `buildSystemPrompt` 呼叫 `getActiveRefinePrompt()`；有 active 組 → 自訂文字置於硬規則之上（additive），硬規則在 prompt 最末重申（「以上為使用者自訂風格指令，以下規則不可覆蓋…」）；無 active / 無 DB / DB 錯誤 → 維持現行寫死完整 prompt（Route B 不中斷）。
- **導覽修復**：`public/index.html` topbar 補「詞彙表」（→ `/glossary.html`）與「精譯指令」（→ `/refine-prompts.html`）兩連結，修復主畫面無進 Glossary 入口的 bug。

**設計原則確認**：
- 注入採 **additive**（不整段取代），硬規則最末重申，防使用者自訂指令意外覆蓋繁體/只回譯文等不可破壞規則。
- 沿用 glossary 既有架構（DB + REST CRUD + 管理頁 + graceful degrade），UX 與程式碼結構一致。

**下一步**：git push → Zeabur 自動部署 → 實測 CRUD 與精譯效果（第三行 [Refined] 出現自訂指令風格）。

---

## 2026-06-13 — app 內 HTTP Basic Auth 實作完成（D-016）

**完成事項**：
- `server/index.js` 新增最小 HTTP Basic Auth middleware：Express `use()` 在路由前攔截所有請求；WebSocket `verifyClient` 同步驗證 Upgrade 請求的 `Authorization` header。
- 帳密來源：環境變數 `BASIC_AUTH_USERS`（格式 `user1:pass1,user2:pass2`，支援多組）；以 `crypto.timingSafeEqual()` 常數時間比對。
- **Graceful degrade**：`BASIC_AUTH_USERS` 未設或空 → 全站開放 + 啟動時輸出警告 log；設定後才啟用驗證。部署順序安全（先 push 程式不鎖死，Zeabur Variables 填帳密重啟才生效）。
- `GET /healthz` 掛在 middleware 前，固定回 200 不需驗證，避免 Zeabur 健檢收 401 誤判。

**為何從 Zeabur 平台層改為 app 內**：查證確認 Zeabur 共享部署不提供任何平台層 Basic Auth 功能；防火牆/IP 限制僅 Dedicated Server 方案有。D-003 原前提錯誤，以 D-016 更正並記錄補述。

**取捨說明**：Basic Auth 無正式登出機制（瀏覽器快取帳密，登出需關閉瀏覽器/清除憑證），此為協定本質限制；內部工廠工具環境可接受，UI 加說明小字。

**線上驗證（2026-06-13）**：使用者已於 Zeabur 設 `BASIC_AUTH_USERS`（多組帳密）；curl 線上確認 `GET /` 與 `/api/glossary` 回 401（含 `WWW-Authenticate: Basic`）、`/healthz` 回 200、部署 6a2d5563 RUNNING。保護正式生效。註：Basic Auth 無自製登入頁，使用瀏覽器原生帳密彈窗（方案 A 取捨）。

**下一步**：繼續 D-015 精譯指令管理頁 + 導覽修復（走 Workflow）。

---

## 2026-06-13 — 自訂 Refine Prompt 管理頁設計定案 + 導覽 bug

**導覽 bug（待修）**：主畫面 `index.html:28` 的「⚙ 設定」是裝飾性 span、app.js 無點擊 handler（按了沒反應）；主畫面**沒有任何進 Glossary 的連結**，只能手動打 `/glossary.html` URL。反向（glossary→主畫面）正常（glossary.html:261 有 `<a href="index.html">`）。另 D-004 規劃的進階設定頁從未實作，「⚙ 設定」其實是該頁的空殼。

**新功能設計定案（D-015）**：使用者要一個類似 Glossary 的「精譯指令」管理頁，對 Route B refine model 下自訂 prompt（例：先讀完整句→依使用者意圖重寫→去除口語化字）。現況 refine.js:87-141 的 system prompt 100% 寫死。三個決策：
1. **加在硬規則之上**（additive）：保留繁體/OpenCC、必套 glossary、只回譯文、保留數字單位等不可破壞規則，自訂指令當額外段，硬規則在 prompt 最末重申以防被覆蓋。
2. **多組具名 prompt + 選一個 active**：指令庫可存多組，單一生效；direction-agnostic。
3. **topbar 加兩個連結**：詞彙表 / 精譯指令。

**實作規格**（沿用 glossary 架構）：新表 `refine_prompts` + `/api/refine-prompts` CRUD + `refine-prompts.html/js` + graceful degrade（無 DB 回退現行寫死預設）；注入點 refine.js `buildSystemPrompt`(:306)。詳見 D-015 與 dashboard 待實作項。

**本次動作**：純文件（dashboard 待實作項 + 本條目 + D-015）。**未實作任何功能**。

**下一步**：主線仍是線上語音實測；此功能實作另開步驟走 Workflow（使用者指示時）。

---

## 2026-06-13 — STT/翻譯調參 backlog 整理進 Roadmap

**起因**：使用者在 Zeabur 面板沒看到「之前討論過的其他可調變數」，詢問是未做還是排後面 phase。grep `process.env` 盤點後分成兩類，使用者決定先記進 Roadmap 追蹤、稍後再執行。

**分類（重要，避免下個 session 誤判）**：
- **B 類＝程式碼已支援、只是沒加進 Zeabur 面板**（跑預設值，隨時可加，零程式碼）：`TRANSLATE_REASONING_EFFORT`、`REFINE_REASONING_EFFORT`、`STT_PROMPT`、`STT_LANGUAGE`、以及換供應商才需的 `ANTHROPIC_API_KEY`/`TRANSLATE_BASE_URL`/`TRANSLATE_API_KEY`。「面板看不到」≠「不能調」，只代表未覆寫預設。
- **C 類＝程式碼根本沒做**（加 Zeabur 變數無效，需寫程式碼）：`STT_MIN_UTTERANCE_MS`、`STT_CHUNK_MS`；另 `SILENCE_DURATION` 是幽靈變數（文件有、server 從不讀，靜音由前端滑桿控制）。當初收斂計畫時刻意不做（價值/成本權衡），現列為 backlog。

**本次動作**：純文件——dashboard 新增 Backlog 分組（三項未勾選）、本條目、D-014 補述。未寫任何功能程式碼、未動 Zeabur 變數。

**下一步**：以線上語音實測為主；實測後再決定 backlog 是否執行（C 類要寫碼走 Workflow、B 類可隨時加 Zeabur 變數）。

---

## 2026-06-13 — STT_LANGUAGE 環境變數 + 可調參數文件補齊

**完成事項**：
- 新增 `STT_LANGUAGE` 環境變數，對應 OpenAI `session.audio.input.transcription.language`，預設留空（auto-detect）。單語為主現場（如廠內全程中文）可在 Zeabur Variables 設 `STT_LANGUAGE=zh` 重啟生效，提升該語言辨識精度並降低首字延遲。
- `docs/PROTOCOL.md` §6.6 環境變數表新增 `STT_LANGUAGE` 列。
- `docs/PROTOCOL.md` §6.6.1 STT 參數詳細說明全面補強：所有已可調參數（STT_MODEL / STT_DELAY / STT_NOISE_REDUCTION / STT_PROMPT / STT_LANGUAGE）均補齊合法值、建議值、Zeabur 設定步驟；新增「Silence Hold-off 由前端滑桿調整、非環境變數」說明；新增如何在 Zeabur 後台調整的統一引言。
- `model_parameters.md` 標題下插入指示行，引導使用者到 PROTOCOL.md §6.6 查看已實作的可調欄位。
- `docs/DECISIONS.md` 新增 D-014，記錄 STT_LANGUAGE 設計決策與釐清項（雙語留空原因、`_buildSessionUpdate()` 一次性送出機制、改環境變數重啟生效不需改碼）。

**為何併入當前線上實測階段**：線上實測前使用者需知道哪些參數可調、怎麼調——文件補齊是實測前準備的一部分，與精度優化（STT_DELAY、STT_NOISE_REDUCTION、STT_PROMPT）直接相關；STT_LANGUAGE 是同批新增的輕量功能，一次整理清楚避免下次重複說明。

**下一步**：使用者線上語音實測；若現場幾乎只有中文可試設 `STT_LANGUAGE=zh`（Zeabur Variables 改完重啟）觀察辨識精度改善。

---

## 2026-06-13 — 修復 Route B 精準翻譯無聲失敗

**症狀**：精準翻譯 ON 但無第三行 [Refined]。

**根因**：runtime log 顯示 `400 Unsupported value reasoning_effort minimal`；translate.js/refine.js 以 `startsWith('gpt-5')` 寫死 `reasoning_effort: 'minimal'`，但 gpt-5.5 不支援此參數（僅 gpt-5-mini 支援）。前端無失敗提示，使用者毫無警示。

**修法**：
1. **環境變數覆寫**：新增 `REFINE_REASONING_EFFORT`（覆寫 Route B reasoning_effort，預設 none）、`TRANSLATE_REASONING_EFFORT`（覆寫 Route A 翻譯 reasoning_effort，預設 minimal）
2. **400 自動重試**：translate.js/refine.js 捕捉 400 Invalid Request Parameter，移除 reasoning_effort 並重試（無 reasoning_effort 時 gpt-5.5 正常回應）
3. **refined_error 前端提示**：WS 訊息新增 refined_error 欄位；UI 顯示小字「精準翻譯失敗」（灰色、不中斷 RT 流）

**Route A 不受影響**：gpt-5-mini 支援 reasoning_effort: minimal，TRANSLATE_MODEL 預設 gpt-5-mini；refine 流程才使用 gpt-5.5，兩路模型不同。

**部署與驗證**：
- commit b3e47f3f7c141e4c9b2511644564f6313d931b52：環境變數抽象、400 重試、refined_error 訊息
- deployment 6a2c3c7f1c90559b717b937e 已完成
- 驗證結果：liveFileOk=true、wssOk=true；精準翻譯開啟時正常顯示第三行

**提醒**：REFINE_REASONING_EFFORT 可設 `none`（無推理加速）或 `low`（低推理降速度成本），由使用者根據線上延遲/成本決定。

**下一步**：使用者線上語音實測確認精準翻譯第三行出現

---

## 2026-06-13 — 修復首次進入 Auto 模式不啟動

**症狀**：使用者首次載入頁面進入 Auto 模式，麥克風未觸發任何語音串流或 level meter 反應；切至 Manual 模式講一輪後再切回 Auto 模式才恢復正常。

**根因**：瀏覽器 autoplay 政策使 AudioContext 建立時處於 suspended，worklet 的 `process()` 不執行 → 不發 level 訊息 → `_handleLevel()` 收不到資料 → Auto 模式門檻偵測永不觸發。全 codebase 原本無任何 `resume()` 呼叫。「切 Manual 按 Speak 後恢復」是因為按鈕點擊（使用者手勢）讓瀏覽器隱式恢復了 context。

**修法三層**：
1. **Init resume（audio.js init）**：getUserMedia 成功、worklet 圖接好後立即 `resume()`（Chrome 政策允許「已取得麥克風擷取」的頁面 resume，多數情況首次載入即生效，無需手勢）
2. **setMode + manualStart（audio.js）**：新增公開方法 `resumeContext()`，在 `setMode()` 與 `manualStart()` 最頂端（guards 之前）呼叫——模式切換與 Speak 都是手勢上下文
3. **Pointer gesture fallback（app.js）**：`document` 上掛 once `pointerdown` 呼叫 `resumeContext()`，兜底 Safari/iPad 等 init-resume 不生效的環境

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
