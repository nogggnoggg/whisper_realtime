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

> **2026-06-13 更正**：Zeabur 共享部署（Shared Server）**不提供**平台層 Basic Auth 功能；防火牆/IP 限制功能僅限 Dedicated Server 方案。本決策「由 Zeabur 平台層處理」的前提錯誤，已改為 app 內 Basic Auth middleware（見 D-016）。部署方式（GitHub 連動自動部署）維持不變。

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

> **2026-06-13 更正（見 D-017）**：「CJK 為多數（>50%）才算中文」這條對**中英夾雜（code-switching）**會誤判——中文母語者夾較多英文術語的句子（如「please幫我check一下 the shipment 然後update狀態」CJK 僅約 20%）會掉到 50% 以下被判成英文方、翻成中文，造成「翻錯邊」。已改為**可調門檻**（環境變數 `LANG_CJK_THRESHOLD`，預設下調至 0.15）+ 翻譯 prompt 強制全譯。此為中↔英專屬修正；多語言（韓/日…）需 per-script 偵測，留待 Phase 4 語言對雙選單一併通用化（見 D-011）。

> **2026-06-14 交叉註記**：「純多數不足、需 per-pair 偵測偏置」此點已於 D-011（2026-06-14）一般化，形成 per-pair 偵測偏置架構；zh↔en 沿用 `LANG_CJK_THRESHOLD`（0.15），ko 兩對吃預設 0.5。

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

### 偵測通用化設計原則（2026-06-13 補；Phase 4 多語言 implement 前須拍板）

**現況限制**：`server/lang.js` 用 CJK 佔比門檻（`LANG_CJK_THRESHOLD`，D-017）只能分「CJK(中文) vs 拉丁(英文)」，`detectLang` 僅回 `zh|en`、翻譯方向僅 zh↔en。**此單一門檻無法通用到韓/日等語言**（韓文用諺文不算 CJK；日文含 CJK 與中文重疊）。新增語言**不可**沿用此機制硬擴。

**方向原則（避免日後重構地獄）**：
1. **每語言一份 script profile**：以 Unicode 腳本範圍定義——中＝CJK(U+4E00–9FFF, U+3400–4DBF)、韓＝諺文(U+AC00–D7AF, jamo U+1100–11FF)、英＝拉丁、日＝假名+漢字(與中文重疊，特例)。新增語言＝**加一筆 profile + 標準語言碼**，不得堆 if/else 或再寫死語言。
2. **偵測由「語言對雙選單 A↔B」驅動**：只在使用者選的兩種語言的腳本間判定該段屬 A 或 B，回傳**標準語言碼**（zh/en/ko…），不再回寫死 zh/en。
3. **門檻/邏輯 per 語言對**，非單一全域 CJK 門檻；`LANG_CJK_THRESHOLD` 屆時退場或改為「中↔英 pair 專屬」設定。

**implement 前必須拍板的開放問題**：
- (a) 繼續「per-pair 腳本比例自動猜方向」 vs 改「**說話者切換**」按鈕（明確指定哪方在講、不靠文字猜）？兩者可並存（自動猜＋手動覆寫）。
  - ✅ 定案（2026-06-14）：維持現狀，per-script 自動偵測方向為主，不強制說話者切換按鈕；手動覆寫按鈕列為日後選配。本期不改。
- (b) **腳本重疊**：中 vs 日 都大量用 CJK，純字符比例分不出 → 需字典/語言模型，或先不開放此對。
  - ✅ 定案（2026-06-14）：Phase 3 語言選單只提供 zh/en/ko，不放日文（避開同腳本無法自動區分的對）。中↔日偵測的真正解法是假名輔助（日文句幾乎必帶假名，中文無）；中↔日 + English pivot 跳板（zh→en→ja / ja→en→zh）整包列為「全專案完成後的獨立議題」，屬未來增強，現在不實作、不關死架構。
- (c) **第三語言闖入 code-switch**：如「中↔韓」對話夾英文詞，該歸 A 還 B？（暫定原則：歸當前語言對中非拉丁那方，或依說話者切換。）
  - ✅ 定案（2026-06-14）：方向判定只比所選兩語言的腳本（如中↔韓只比漢字 vs 諺文），第三語言字元不計入方向；但譯文一併翻成目標語（延續 D-017 強制全譯）。「排除其他語言」指排除「方向候選 + 輸出語言」，不是假裝輸入無第三語言。並將語言對 (A,B) 注入 Route A/B 翻譯 prompt 以約束方向候選與輸出語言；STT 轉錄層維持單碼/留空（realtime 轉錄 language 參數只吃單碼）。
- (d) 須與 D-012 的 `(source_lang, target_lang)` schema 對齊：偵測輸出標準語言碼。
  - ✅ 定案（2026-06-14）：偵測輸出標準語言碼（zh/en/ko），對齊 D-012 的 (source_lang, target_lang)。

### 門檻一般化與設定載體（2026-06-14 定案）

- **全域 `LANG_CJK_THRESHOLD` → per-pair 偵測偏置**：每語言對只需一個門檻數字，方向內含於「量哪個腳本」（低 = 偏該腳本側、高 = 偏另一側），不需額外「A/B 方向」變數。
- **載體 = 預設在碼、覆寫才用變數**：程式碼常數 `DEFAULT_THRESHOLD = 0.5`（純多數）；只有想偏離預設的對才用環境變數覆寫。zh↔en 沿用現有 `LANG_CJK_THRESHOLD`（0.15，D-017，不動）；ko 兩對吃預設 0.5，不新增任何環境變數、不碰 Zeabur。
- **語言對 (A,B) 注入翻譯 prompt**（Route A `translate.js` / Route B `refine.js`），約束方向候選與輸出語言；STT 轉錄層維持單碼/留空（realtime 轉錄 `language` 參數只吃單碼）。
- **設定頁 UI（backlog，日後做）= 情境式單一滑桿**：設定頁只顯示主畫面當下選的那一對的偏置滑桿，換語言對滑桿跟著換；資料層是 per-pair 表（`(langA, langB) → 門檻`，預設 0.5）；矩陣式「顯示全部」列為未來進階視圖。

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

**遺留**：git push 會自動觸發 Zeabur 重建（已驗證）。STT 僅 OpenAI 實作，若要「完全去 OpenAI」需另立 STT 供應商抽象工作項。

## D-014：STT_LANGUAGE 環境變數與調參方式釐清

**日期**：2026-06-13

**決策**：
將 OpenAI transcription session 的 `session.audio.input.transcription.language` 欄位以環境變數 `STT_LANGUAGE` 暴露，預設留空（auto-detect）。此變數定位為「單語為主現場」的 per-deployment 語言鎖定覆寫；雙語輪流場景維持留空。

**理由**：
- OpenAI 文件指明提供語言碼可提升該語言辨識精度與降低首字延遲。
- 但 `transcription.language` 只接受**單一** ISO-639-1 語言碼；本系統中英（或未來中英韓）雙語輪流共用同一 session，固定語言碼會降低另一方向的辨識精度，故雙語場景必須留空。
- 仍有使用者有「廠內幾乎全中文、偶有英文術語」的單語為主現場，此時設 `STT_LANGUAGE=zh` 可有效提升精度，需求真實存在。

**釐清項**：
- `_buildSessionUpdate()` 是連線時送一次的 `session.update`，不是動態切換機制；`STT_LANGUAGE` 在 Zeabur 改完需**重啟 service** 才生效。
- 「做成環境變數」的意思是：值由 `process.env.STT_LANGUAGE` 提供，函式邏輯已實作，之後只需在 Zeabur 後台改變數值並重啟，完全不需改程式碼。
- 函式本身只在新增欄位時改一次；日後調整語言設定的入口是 Zeabur Variables，不是程式碼。

**否決方案與原因**：
- 硬填單一語言（如 `zh`）：否決，中英輪流場景英語辨識精度下降，不適合預設值。
- 完全不暴露（永遠 auto-detect）：否決，單語為主現場的使用者有真實的精度改善需求，且成本為零。

**Backlog（2026-06-13 補述）— 當初收斂計畫時刻意不做、列為待辦**：
- `STT_MIN_UTTERANCE_MS`（過濾極短誤觸發雜訊卡片）與 `STT_CHUNK_MS`（前端 append 塊大小可調）：**程式碼未實作**，需寫碼（前者需 server commit gating + openai-stt.js 新增 `clear()`，後者需改 pcm-worklet.js/audio.js）。加 Zeabur 變數無效。價值/成本權衡後先擱置，待線上語音實測後再決定是否執行。
- `SILENCE_DURATION`：幽靈變數——PROTOCOL 曾列出但 server 從不讀取，靜音 hold-off 實際由前端設定頁滑桿控制。待辦：接成真的環境變數，或從文件移除以免誤會。
- 區分清楚：上述為 C 類（需寫碼）；另有 B 類變數（`TRANSLATE_REASONING_EFFORT`/`REFINE_REASONING_EFFORT`/`STT_PROMPT` 等）程式碼已支援，只是未加進 Zeabur 面板、跑預設值，隨時可加，非 backlog 功能項。詳見 PROGRESS.md 2026-06-13 條目。

---

## D-015：自訂 Refine Prompt 管理頁設計（精譯指令）

**日期**：2026-06-13（設計定案，待實作）

**背景**：Route B 精準翻譯的 system prompt 目前 100% 寫死於 `server/refine.js:87-141`（`buildSystemPrompt`），無外部設定點。使用者希望能像 Glossary 一樣，自行對 refine model 下指令（例：先讀完整句→依使用者意圖重寫→去除口語化字詞），且需求會隨現場/用途變動，故要可管理。

**決策**：
1. **作用方式＝加在硬規則之上（additive）**：保留系統內建不可破壞規則（台灣正體繁體輸出＋OpenCC、必套 glossary、**只回傳譯文無解釋/標籤/引號**、保留數字與單位），自訂指令作為額外「風格/意圖」段注入；硬規則在 prompt 最末重申，確保自訂指令無法覆蓋。
2. **粒度＝多組具名 prompt + 選一個 active**：指令庫可存多組（各有名稱），同時只有一組生效（`is_active`）；direction-agnostic（套用所有翻譯方向）。
3. **導覽＝主畫面 topbar 加兩個連結**（詞彙表→glossary.html、精譯指令→refine-prompts.html）。

**理由**：
- additive 而非整段取代——避免使用者誤刪「只回譯文」「繁體」等規則導致第三行 [Refined] 輸出格式或 OpenCC 後處理損壞。
- 具名庫選一啟用——比單一全域文字更彈性（可備多套切換），又比 per-session 切換簡單（本期先做全域單一 active）。
- 沿用 Glossary 既有架構（DB 表 + REST CRUD + 管理頁 + graceful degrade），不重造輪子、UX 一致。

**實作規格（待執行）**：
- DB 新表 `refine_prompts`（仿 `glossary_terms`）：`id, name, prompt_text, is_active, enabled, created_at, updated_at`；設 active 時清除其他 active。
- DB 函式：list/create/update/delete + `getActiveRefinePrompt()`；無 DB 回 null（沿用 `isDbEnabled`）。
- REST `/api/refine-prompts` GET/POST/PUT/DELETE（仿 `/api/glossary`，套 `requireDb`）。
- 前端 `public/refine-prompts.html` + `refine-prompts.js`（仿 glossary 頁），含 503 離線降級。
- 注入點：`refine.js` `buildSystemPrompt`（呼叫於 :306）——有 active 則注入其文字並最末重申硬規則；無 active 或無 DB → 維持現行寫死預設（即現有 prompt 當 fallback）。
- 附帶修復導覽 bug：`index.html` topbar「⚙ 設定」目前是無 handler 空殼、且主畫面無進 Glossary 連結；本功能會在 topbar 補兩個連結。「⚙ 設定」對應的 D-004 進階設定頁仍列 backlog。

**否決方案**：
- 整段取代式 prompt：否決，易破壞不可破壞規則導致輸出損壞。
- 單一全域純文字（不具名）：否決，使用者要可備多套切換。
- per-session 不同 prompt：暫緩（本期全域單一 active；之後若需要再擴充 WS settings 帶 `refinePromptId`）。

> **實作完成 2026-06-13**（沿用 glossary 架構，additive 注入，硬規則最末重申）：DB 表 `refine_prompts` + REST `/api/refine-prompts` CRUD（套 requireDb）+ 前端 `refine-prompts.html/js` + refine.js `buildSystemPrompt` 注入 + index.html topbar 導覽修復；無 DB graceful degrade 全路徑（API 503、頁面離線提示、Route B 回退寫死預設）。

---

## D-016：v1 存取保護＝app 內最小 HTTP Basic Auth middleware

**日期**：2026-06-13

**背景**：D-003 原定由 Zeabur 平台層處理存取保護，但查證確認 Zeabur 共享部署不提供平台層 Basic Auth（防火牆/IP 限制僅 Dedicated Server 有）。原前提錯誤，改為 app 內實作最小 middleware。

**決策**：

1. **保護範圍**：HTTP 靜態頁（`/`、`/glossary.html`、`/refine-prompts.html` 等）、`/api/*` REST 端點、WebSocket `/ws`（透過 `verifyClient` 檢查 `Authorization` header）。
2. **帳密設定**：環境變數 `BASIC_AUTH_USERS`，格式 `user1:pass1,user2:pass2`（支援多組帳密）；後端解析後以常數時間比對（防止時序攻擊）。
3. **Graceful degrade（部署順序安全）**：`BASIC_AUTH_USERS` 未設（或空）→ 全站開放 + 輸出警告 log；**設定後才上鎖**。確保先 push 程式碼不會鎖死（Zeabur Variables 填帳密後才生效）。
4. **健檢豁免**：`GET /healthz` 固定回 200，不需驗證，避免 Zeabur 健檢收到 401 誤判服務異常。
5. **登出限制**：Basic Auth 本質無正式登出（帳密快取在瀏覽器），需關閉瀏覽器或清除憑證才能切換帳號。內部工具環境可接受；UI 放一行說明小字提示使用者。

**理由**：
- Zeabur 共享部署無任何平台層保護方案可用，in-app middleware 是最小可行路線。
- 同一個 middleware 可同時保護 HTTP 靜態頁、REST API 與 WebSocket，保護邊界統一。
- 常數時間比對避免 timing attack（雖為內部工具，仍為基本安全做法）。

**實作要點**：
- Node.js `server/index.js`：Express `use()` 加 Basic Auth middleware（在路由前），`verifyClient` 做 WS 握手驗證。
- 比對函式：`crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))`。
- `/healthz` 在 middleware 之前掛載，確保豁免。
- Zeabur 設定步驟：app service → Variables → 新增 `BASIC_AUTH_USERS=user1:pass1` → 重啟生效。

**否決方案**：
- **Session / cookie 登入頁**：需要登入表單、session store、CSRF 防護，屬 v1 範圍外，複雜度過高；Basic Auth 已足夠內部工具需求。
- **IP 限制**：Zeabur 共享部署不提供此功能，且工廠 IP 可能動態變化。
- **整套自製 auth 系統（JWT / RBAC）**：PRD §12 明確列為 v1 out-of-scope。

**升級路徑**：日後需要正式登出，可改為 cookie/session 機制；保護邊界（`/api/*`、`/ws`、靜態頁）不變，只換 middleware 實作，不影響其他程式碼。

## D-017：中英 code-switch 翻譯方向修正（可調 CJK 門檻 + prompt 全譯）

**日期**：2026-06-13

**問題（trace log 實證）**：Always-On 實測一句「please幫我check一下。 the shipment,然後update狀態。」→ `final lang=en` → `translate.in lang=en` → `translate.out="請幫我檢查一下貨件，然後更新狀態。"`。即：中文母語者夾英文術語的句子，因 CJK 佔比僅約 20%（< 50% 門檻）被判成**英文方**，於是翻成**中文**（翻錯邊），使用者拿不到想要的英文。對照「我準備commit現在這個版本」CJK 約 60% 判 zh→正確翻英，故「英文夾越多越容易中招」。根因＝D-006 的二元 >50% 門檻不適合 code-switch，**非模型 echo**（模型翻譯本身正常，只是方向錯）。

**決策**：
1. **B — 可調 CJK 門檻**：`server/lang.js` 門檻改由環境變數 `LANG_CJK_THRESHOLD`（0–1）控制，**預設下調為 0.15**；`CJK 佔比 > 門檻 → 中文方（翻英）`，否則英文方（翻中）。理由：英文母語者句子幾乎 0% CJK，中文人夾英文仍有一兩成 CJK，低門檻能把兩種人分開。設更低（趨近 0）即「含任何中文字就算中文方」。
2. **A — prompt 強制全譯**：`translate.js` 與 `refine.js` 的 system prompt 補強——「整句完全輸出目標語言、夾雜外語詞一併翻譯、絕不原樣回傳原文」。方向正確時確保 code-switch 句子被完整翻譯。
3. **範圍界定**：本修正僅針對**中↔英**。多語言（韓/日…）偵測無法沿用 CJK 比例（韓文用諺文、日文含 CJK 與中文重疊），需 per-script 判斷，**留待 Phase 4 語言對雙選單一併通用化**（見 D-011），現在不做以免過度設計。

**為何門檻是「往低調」不是調高**：調高（如 70%）會讓更多中文夾英文句子掉到門檻下被判英文，bug 更嚴重。修正方向是**降低**門檻。

**門檻單一、非每語言一個**：偵測是二元（一個門檻把中文方/英文方切開），英文方＝「沒過中文門檻」那邊，不需也不能另設一個英文門檻。

> **2026-06-14 交叉註記**：「純多數不足、需 per-pair 偏置」此點已於 D-011（2026-06-14）一般化；zh↔en 仍沿用本決策的 `LANG_CJK_THRESHOLD=0.15`，不動。

**否決/暫緩**：
- 調整門檻的「設定頁 UI」：單一數字做 CRUD 頁過重，本期用環境變數；UI 留 backlog（可併 D-004 設定頁或 Phase 4）。
- 說話者手動切換按鈕（不靠文字猜方向，最穩）：較大 UX 改動，併入 Phase 4 語言對方向設計評估。
- 多語言通用 per-script 偵測：Phase 4 處理。

## D-018 — 雜訊卡片過濾：前端有效語音時長 gating（即時滑桿，預設關）

**日期**：2026-06-14

**決策**：
以「有效語音時長」機制過濾極短誤觸發的短雜訊卡片。做成主面板可收合「進階 / 測試」區的即時滑桿（0–500ms，預設 0=關），前端值即時生效並存 localStorage；丟棄段落由後端送 `input_audio_buffer.clear`（不轉錄、不建卡、省成本）。

**理由**：
使用者麥克風已硬體降噪 + 現有 4 層過濾（硬體 NR / STT_NOISE_REDUCTION / 音量門檻 / 空白過濾），此 gating 屬邊際打磨、必要性與最佳門檻需現場經驗驗證 → 做成即時可調 UI 讓使用者邊講邊 A/B，優於需重啟、無即時回饋的環境變數。

**機制 A：有效語音時長**（與機制 B/C 對比）：
- Auto 模式：前端量「真正越過音量門檻在講話的累積 ms」，排除尾端靜音。因 Auto 模式每段時長含 ~2s 尾端靜音，純 wall-clock 時長在 Auto 失效；有效語音時長能區分真講「好 / OK」（~300ms）與碰撞聲（<100ms）。
- Manual 模式：整段按鈕時長（使用者按下到鬆開）。
- 實作：`_minVoicedMs`（0–500，預設 0）、`_voicedMs` 累積、`_voicedSinceTs` 時戳；`_stopUtterance` 時計算本段 voiced，若 `minVoicedMs > 0 && voiced < minVoicedMs` → `discard = true`（PROTOCOL.md 3.3）。

**否決/取代**：
- 原 backlog 的 Zeabur 環境變數 `STT_MIN_UTTERANCE_MS`（需重啟、無即時回饋）→ **取代為前端滑桿**（即時生效、可見回饋）。
- 機制 B（短轉錄字數）：會誤殺合法短指令（例「好」「OK」）。
- 機制 C（server wall-clock）：Auto 模式含 ~2s 尾端靜音，wall-clock 無法區分真講與空白。

**註記**：CLAUDE.md「主面板只放 3 控制、進階歸 ⚙ 頁」之例外 — 因 A/B 即時調校需講話時可見、且 ⚙ 頁（D-004）尚未建；日後 ⚙ 頁建好可遷入。
