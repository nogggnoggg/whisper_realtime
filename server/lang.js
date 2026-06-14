/**
 * server/lang.js — 語言方向偵測
 *
 * 規則（依 PROTOCOL.md §6.3）：
 *   CJK 統一漢字（U+4E00–U+9FFF）及擴充 A（U+3400–U+4DBF）字元
 *   佔非空白字元總數 > threshold → "zh"，否則 → "en"
 *   假名（片假名、平假名）不計入 CJK 統計。
 *
 *   threshold 優先序：
 *     1. detectLang 呼叫端傳入的 thresholdOverride（DB 查詢值）
 *     2. 環境變數 LANG_CJK_THRESHOLD
 *     3. 內建預設 0.15（低門檻，讓中英 code-switch 句子仍判中文方）
 */

import { fileURLToPath } from 'url';

// 可調門檻：CJK 字元佔非空白字元的比例超過此值 → 判為中文方（翻英）
// 安全 parse：允許 0；未設 / 空字串 / NaN 時 fallback 0.15
const _rawThreshold = process.env.LANG_CJK_THRESHOLD;
const _t = (_rawThreshold == null || _rawThreshold.trim() === '') ? NaN : Number(_rawThreshold);
const CJK_THRESHOLD = Number.isFinite(_t) ? _t : 0.15;

/**
 * 偵測文字語言方向
 * @param {string} text
 * @param {number|null} [thresholdOverride=null]  呼叫端傳入（如 DB 值）；null 時用 CJK_THRESHOLD
 * @returns {"zh"|"en"}
 */
export function detectLang(text, thresholdOverride = null) {
  if (!text || typeof text !== 'string') return 'en';

  // 移除空白後的字元
  const nonWS = [...text.replace(/\s/g, '')];
  if (nonWS.length === 0) return 'en';

  let cjkCount = 0;
  for (const ch of nonWS) {
    const cp = ch.codePointAt(0);
    // U+4E00–U+9FFF 基本漢字
    // U+3400–U+4DBF CJK 擴充 A
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) {
      cjkCount++;
    }
  }

  // threshold 優先序：呼叫端 override → env 常數 CJK_THRESHOLD（env/預設 0.15）
  const threshold = (thresholdOverride != null) ? thresholdOverride : CJK_THRESHOLD;

  // CJK 佔比 > 門檻 → 中文方（翻英）；否則英文方（翻中）。
  return cjkCount / nonWS.length > threshold ? 'zh' : 'en';
}

// ---- 自測：node server/lang.js --------------------------------------------
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  const cases = [
    {
      text: '這批先不要出貨，等品保確認。',
      expected: 'zh',
      desc: '純中文句子',
    },
    {
      text: 'Do not ship this batch yet. Wait for QA.',
      expected: 'en',
      desc: '純英文句子',
    },
    {
      text: 'Check the 數量 is correct before shipping.',
      expected: 'en',
      desc: '英文為主（含少量漢字）',
    },
    {
      text: '今天氣溫很高要注意安全戴好 PPE 才能進入作業區。',
      expected: 'zh',
      desc: '中文為主（含英文縮寫）',
    },
    {
      text: 'please幫我check一下。 the shipment,然後update狀態。',
      expected: 'zh',
      desc: 'code-switch（英文框架夾中文，CJK ≈ 20% > 0.15 → zh）',
    },
    {
      text: 'please幫我check一下。 the shipment,然後update狀態。',
      expected: 'en',
      desc: 'thresholdOverride=0.5 → 同句 CJK 佔比 < 0.5 → 判 en',
      thresholdOverride: 0.5,
    },
  ];

  let passed = 0;
  for (const { text, expected, desc, thresholdOverride } of cases) {
    const result = detectLang(text, thresholdOverride ?? null);
    const ok = result === expected;
    const icon = ok ? '✓' : '✗';
    console.log(`${icon} [${desc}] detectLang → "${result}" (expected "${expected}")`);
    if (ok) passed++;
  }
  console.log(`\n${passed}/${cases.length} 測試通過`);
  process.exit(passed === cases.length ? 0 : 1);
}
