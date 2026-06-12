/**
 * server/zh-convert.js — 簡體→繁體中文（台灣正體）轉換
 *
 * 依賴：opencc-js（已安裝）
 * 模組載入時建立 converter 一次，重複使用。
 */

import * as OpenCC from 'opencc-js';

// 簡體→台灣正體（含慣用語，例如 软件→軟體、质量→品質）
const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * 將文字轉換為繁體中文（台灣正體）。
 * 非中文字元（英文、數字、符號）原樣保留。
 *
 * @param {string} text 輸入文字
 * @returns {string} 繁體中文輸出
 */
export function toTraditional(text) {
  if (!text) return text;
  return converter(text);
}

// ── 小自測：node server/zh-convert.js ────────────────────────────────────────
// 僅在直接執行時運行，import 時不執行
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('server/zh-convert.js')) {
  const input = '软件质量保证';
  const output = toTraditional(input);
  console.log(`輸入：${input}`);
  console.log(`輸出：${output}`);

  // 驗證含台灣用語或繁體字
  const hasTaiwanTerm = /軟體/.test(output);
  const hasTraditional = /[質量保證軟體品質]/.test(output);

  if (hasTaiwanTerm) {
    console.log('PASS：含台灣用語「軟體」');
  } else {
    console.error('FAIL：未含台灣用語「軟體」');
    process.exit(1);
  }

  if (hasTraditional) {
    console.log('PASS：輸出為繁體字');
  } else {
    console.error('FAIL：輸出不含繁體字');
    process.exit(1);
  }

  // 確認無簡體字殘留
  const hasSimplified = /软|件|质/.test(output);
  if (!hasSimplified) {
    console.log('PASS：無簡體字殘留');
  } else {
    console.error('FAIL：仍含簡體字');
    process.exit(1);
  }

  console.log('自測全部通過。');
}
