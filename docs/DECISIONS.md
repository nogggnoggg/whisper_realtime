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
