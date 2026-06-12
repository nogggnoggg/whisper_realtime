/**
 * server/lang.js — 語言方向偵測
 *
 * 規則（依 PROTOCOL.md §6.3）：
 *   CJK 統一漢字（U+4E00–U+9FFF）及擴充 A（U+3400–U+4DBF）字元
 *   佔非空白字元總數 >50% → "zh"，否則 → "en"
 *   假名（片假名、平假名）不計入 CJK 統計。
 */

import { fileURLToPath } from 'url';

/**
 * 偵測文字語言方向
 * @param {string} text
 * @returns {"zh"|"en"}
 */
export function detectLang(text) {
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

  return cjkCount / nonWS.length > 0.5 ? 'zh' : 'en';
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
  ];

  let passed = 0;
  for (const { text, expected, desc } of cases) {
    const result = detectLang(text);
    const ok = result === expected;
    const icon = ok ? '✓' : '✗';
    console.log(`${icon} [${desc}] detectLang → "${result}" (expected "${expected}")`);
    if (ok) passed++;
  }
  console.log(`\n${passed}/${cases.length} 測試通過`);
  process.exit(passed === cases.length ? 0 : 1);
}
