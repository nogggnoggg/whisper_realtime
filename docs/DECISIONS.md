# 決策紀錄 Decision Log

重大技術/產品決策紀錄。每條含：日期、決策、理由、否決方案。新決策往下追加。

## D-001：Route A 架構（接法 1）

**日期**：2026-06-12

**決策**：
語音 → OpenAI `gpt-realtime-whisper`（Realtime API transcription session，WebSocket，$0.017/分鐘）串流轉錄 → delta events（conversation.item.input_audio_transcription.delta）→ Draft 暫定字幕（原文第一行逐字出現）→ completed events → 正式原文 → 立即送 `gpt-5-mini` 做文字快翻 → 第二行即時翻譯 [RT] → 精準翻譯 ON 時：句子完成後用 `gpt-5-mini` + 完整原文 + Route A 翻譯 + Glossary + 上下文做語意重整 → 第三行「精準翻譯：」[Refined]

**理由**：
- 原文字幕來源明確（gpt-realtime-whisper）
- 翻譯行為可控（多級翻譯流程）
- 成本相對合理

**否決方案與原因**：
- `gpt-realtime-translate`（2026/5/7 發布，$0.034/分鐘，語音→翻譯語音+字幕）：
  1. 原文字幕來源未確認
  2. 需並行雙串流成本約 3 倍
  3. 翻譯行為較難控制

## D-002：技術棧

**日期**：2026-06-12

**決策**：
Node.js 全端（後端 Node + WebSocket，前端 vanilla JS / 輕量）

**理由**：
- 單一語言開發效率高
- Zeabur 部署支援完善

**否決方案與原因**：
- Python/FastAPI：多語言維護負擔重，Zeabur 部署相對複雜

## D-003：存取保護與部署

**日期**：2026-06-12

**決策**：
由 Zeabur 平台層級處理（basic auth / IP 限制），v1 程式內不實作登入。部署採 GitHub 連動自動部署（git push 即部署）

**理由**：
- 平台層保護足夠
- 開發簡潔
- 自動部署流程清晰

**否決方案與原因**：
- 程式內 PIN 登入：使用者選擇由平台層處理，降低程式複雜度

## D-004：進階音訊設定位置

**日期**：2026-06-12

**決策**：
進階音訊設定（Silence Duration / Pre-roll Buffer / Cooldown / Max Utterance Duration）收進 ⚙ 設定頁；主畫面 Audio Settings panel 只保留 Threshold slider + Level Meter + Microphone

**理由**：
- 主畫面保持簡潔，符合現場人員操作需求
- 進階設定隔離，避免誤操作

**否決方案與原因**：
- 全部放在主畫面：增加介面複雜度，不符合使用情景

## D-005：Threshold % 與 dB 對應關係

**日期**：2026-06-12

**決策**：
Threshold % ↔ dB 對應：0% = -50dB，100% = 0dB，線性對映（60% ≈ -20dB）；Level Meter 紅線據此繪製

**理由**：
- 統一音訊感知單位
- 便於使用者直觀調整

**否決方案與原因**：
- 非線性對映：複雜度高，使用者體驗差

## D-006：語言方向偵測規則

**日期**：2026-06-12

**決策**：
以轉錄文字字元判斷 — 含 CJK 字元且 CJK 為多數 → 中文發言；否則英文發言。中英夾雜以多數字元為準

**理由**：
- 無須額外 API 調用
- 快速、準確度足夠

**否決方案與原因**：
- 額外語言識別 API：成本增加，延遲風險

## D-007：Session 生命週期

**日期**：2026-06-12

**決策**：
開啟頁面建立 session；閒置逾 30 分鐘或關閉頁面即結束

**理由**：
- 資源管理清晰
- 符合一般會議時長

**否決方案與原因**：
- 永久 session：資源浪費，成本不可控

## D-008：Manual 模式狀態列去重

**日期**：2026-06-12

**決策**：
移除「Ready」與「Status: Online」並存，統一為「Status: Ready」

**理由**：
- 狀態表達簡潔明確
- 避免使用者困惑

**否決方案與原因**：
- 保留多狀態：冗餘，增加複雜度

## D-009：STT 精度策略

**日期**：2026-06-12

**決策**：
語音識別參數全面環境變數化。預設配置偏重精度：`STT_DELAY=high`（犧牲少量延遲換精度）、`STT_NOISE_REDUCTION=near_field`（工廠近場消噪）、`STT_PROMPT=工廠術語詞表`（自訂提示詞）。同時保留 `gpt-4o-transcribe` 作為 A/B 測試備選模型（支援 prompt，精度優勢驗證中）。

**理由**：
- 現場實測發現原文精度不足（機械音干擾、行業術語識別差），單靠 gpt-realtime-whisper 預設參數不夠
- 環境變數化便於快速 A/B 測試不同配置，無須改代碼
- gpt-4o-transcribe 為高精度備選，可用於精度關鍵的場景

**否決方案與原因**：
- 硬編碼參數：降低試驗效率，現場調校困難
- 僅用一個模型：無法對比，難以驗證精度改善是否來自參數還是模型差異

## D-010：繁體中文輸出與翻譯供應商抽象

**日期**：2026-06-12

**決策**：
(a) **Server 端 OpenCC 後處理**：所有輸出中文（draft / final / translation）統一由後端以 OpenCC（zh-Hans → zh-Hant）轉為台灣正體繁體中文，保證全鏈路統一簡繁格式。(b) **翻譯層提供者抽象**：翻譯模型不綁定單一供應商，支援 `openai`（gpt-5-mini）/ `anthropic`（claude-haiku-4-5）/ `custom`（OpenAI 相容端點）三個 provider，環境變數 `TRANSLATE_PROVIDER` 與 `TRANSLATE_MODEL` 控制。(c) **Always On silence duration 可調、預設 2000ms**：Auto 模式無音停止延遲由預設 800ms 改為可調，預設升至 2000ms。

**理由**：
(a) STT 模型（Whisper、gpt-realtime-whisper）簡繁輸出隨機，不依賴模型選擇，後處理方案與模型無關，保障輸出一致性；OpenCC 轉換快速精準，不增加延遲。
(b) 使用者需要 A/B 測試不同廠商模型，翻譯是純文字進出，最易抽換；環境變數化便於現場快速切換，無須改代碼；支援自訂端點便於整合企業內部 LLM 服務。
(c) 現場實測發現 800ms silence duration 被句中停頓（1-2 秒）提早切斷，導致後半句漏掉；改為 2000ms 允許正常說話節奏，同時保留可調空間應對場景差異。

**否決方案與原因**：
- 簡繁轉換放在前端：複雜化前端邏輯，無法統一管理
- 翻譯模型硬編碼單一供應商：無法對比測試，難以適應不同部署環境
- Silence duration 固定不調：現場效果差，無法應對不同工廠環境

## D-011：多語言對策略（韓/中/英）

**日期**：2026-06-12

**決策**：
未來支援韓文，UI 採**兩個語言選單**（語言 A ↔ 語言 B，各可選 韓文/中文/英文）自由組合互譯方向，不採固定模式列舉。排程：Phase 1–2 不實作；Phase 2 的 PostgreSQL schema（glossary、translation logs）必須以 `(source_lang, target_lang)` 語言對為一級欄位；Phase 3 實作 UI 與韓文偵測/翻譯。詳見 PRD §7.10。

**理由**：
- Phase 1 目標是驗證核心可行性（延遲/精度/threshold），韓文是廣度功能，且韓文 STT/翻譯品質需獨立驗證
- zh/en 二元假設若滲入 Phase 2 資料庫設計，Phase 3 需 schema migration — 現在寫進設計原則成本為零
- 兩選單組合比列舉模式更通用，與「判定發言屬於 A 或 B、翻成另一邊」的偵測抽象天然對應

**已知 zh/en 寫死點（Phase 3 實作備忘）**：
- `server/lang.js`：CJK 二元偵測（韓文諺文 U+AC00–U+D7AF 會誤判為 en）
- `server/translate.js`：prompt 僅 zh↔en 兩方向
- WS 協定 `final.lang`：值域僅 `"zh"|"en"`
- `server/index.js`：翻譯方向 = 「非 zh 就翻 zh」
- Top bar：「中文 ↔ English」固定文字

**否決方案與原因**：
- Phase 1 直接實作：拖慢核心驗證、韓文品質未知數會干擾現有實測
- 現在就重構語言層但不加韓文：中等成本但無立即收益，留待 Phase 3 一次到位（資料模型原則已預留，技術債可控）

## D-012：Phase 2 架構

**日期**：2026-06-12

**決策**：
(a) **DB Graceful Degrade**：無 DATABASE_URL 環境變數時，翻譯流程照常進行（Route A 翻譯輸出），Glossary 與 Translation Logs 功能停用（不保存），支援部署彈性與離線可用。(b) **Route B 翻譯層**：沿用 D-010 的翻譯 provider 抽象（openai / anthropic / custom），新增 `REFINE_MODEL` 環境變數獨立指定精準翻譯模型（例 openai provider 時可用 gpt-4o 代替 gpt-5-mini），允許不同 provider 組合（Route A: gpt-5-mini, Route B: claude-opus-4）；Route B 邏輯：原文 + Route A 翻譯 + Glossary 術語 + 上下文 → 語意重整。(c) **Glossary 查詢設計**：以 `(source_lang, target_lang)` 語言對為一級欄位（支援任意語言組合），原文包含比對（source_term LIKE '%原文%'），供 Route B 與日誌查詢使用。(d) **Pre-roll 環形緩衝**：新增 400ms 環形緩衝，僅用於 Auto 模式（捕捉開啟麥後立即發音），Manual 模式無 pre-roll；不佔用 utterance 時長，只作音訊串流起點優化。

**理由**：
- (a) 部署的靈活性：使用者可先不配 PG，程式仍可跑；分階段部署（翻譯功能 → 數據持久化）
- (b) 不同模型成本差異大（gpt-5-mini 便宜、gpt-4o 精準），Route B 應獨立可調，避免鎖定一種模型；provider 抽象已在 D-010 投入，複用成本低
- (c) 語言對一級設計為 Phase 3（韓文）做準備，現在寫進 schema 成本為零；原文包含比對能適應術語變異（簡繁、詞序調整）
- (d) Auto 模式麥克風啟動到使用者發音間隔短（50-200ms），400ms 環形緩衝無損用戶體感且捕捉遺漏音；Manual 模式使用者已按按鈕，無須提前錄製

**已知 DB Graceful Degrade 邊界**：
- Route A（翻譯）不依賴 DB，正常進行
- Route B（精準翻譯）若無 DB 則無 Glossary 可用，仍可用 (Route A + 原文) 做重整，品質降級但不中斷
- `/api/glossary` 與 `/glossary.html` 管理頁須 DATABASE_URL 非空才可用（API 回傳 503 或 404）

**否決方案與原因**：
- DB 必填：運維成本高，不適合快速迭代部署
- Pre-roll 用於 Manual 模式：對話流不符，Manual 是使用者主動按鍵，不需預先錄製
- Glossary 以術語對 (source_term, target_term) 為主鍵：無法支援多語言（同一中文術語對應不同韓文譯法），難以查詢

## D-013：Zeabur 部署形態與實測策略

**日期**：2026-06-12

**決策**：
(a) **同專案雙 service**：Zeabur `whisper_realtime` 專案內建 `postgresql`（官方模板 B20CX0，PG 18）與 `app`（GitHub main + inline Dockerfile node:22-alpine，port 8080，網域 whisper-realtime-leon.zeabur.app）；app 以 `DATABASE_URL=${POSTGRES_CONNECTION_STRING}` 內網直連 PG，並設 `PGSSLMODE=disable`。
(b) **Phase 2 實測改在部署環境做**：放棄「本機連 Zeabur PG」路線。
(c) **模型/供應商選擇以環境變數浮出**：`TRANSLATE_PROVIDER`、`TRANSLATE_MODEL`、`REFINE_MODEL`、`STT_MODEL` 直接放上 Zeabur app service（填程式預設值），使用者可在後台改而不必讀程式碼。
(d) **OPENAI_API_KEY 佔位值過渡**：部署時先填佔位字串讓 server 能啟動（server 缺 key 會 process.exit），完成 DB/REST 自動化測試後由使用者在 Zeabur 後台換真 key（真 key 永不經過對話）。

**理由**：
- (b) Lightsail 防火牆只開 HTTP(S)，外網 5432 不通；且 Zeabur MCP `execute-command` 跑在無叢集網路的臨時容器，容器內 psql 一律逾時——DB 驗證唯一可靠途徑是 app 的 REST API + runtime log
- (c) 使用者明確要求：不一定用 OpenAI、不一定用 gpt-5-mini，模型選擇必須可見可改
- (d) 兼顧「key 不經對話」鐵律與「自動化測試需要 server 活著」

**否決方案與原因**：
- 開放 PG 對外 TCP 供本機測試：要動 Lightsail 防火牆且暴露資料庫，風險大於收益
- 等使用者填真 key 再測試：阻塞所有 DB/Glossary 驗證，且該部分根本不需要 OpenAI

**遺留**：git push 是否觸發 Zeabur 自動重建未驗證；重新部署可再呼叫 MCP `deploy-from-specification`（同 spec）。STT 僅 OpenAI 實作，若要「完全去 OpenAI」需另立 STT 供應商抽象工作項。
