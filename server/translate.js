/**
 * server/translate.js — 文字翻譯
 *
 * 使用 gpt-5-mini（OpenAI Chat Completions API，reasoning_effort: minimal 以求低延遲）
 * 進行 zh→en 或 en→zh 翻譯。System prompt 要求：只回譯文、口語簡潔、保留數字與單位。
 */

import OpenAI from 'openai';

/** @type {OpenAI|null} */
let _client = null;

function getClient() {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

const TRANSLATE_MODEL = 'gpt-5-mini';

/**
 * 翻譯文字
 * @param {string} text 原文
 * @param {"zh"|"en"} sourceLang 來源語言
 * @returns {Promise<string>} 譯文（只含翻譯結果，不含任何說明）
 */
export async function translate(text, sourceLang) {
  if (!text || typeof text !== 'string' || text.trim() === '') return '';

  const targetLangName =
    sourceLang === 'zh' ? 'English' : 'Traditional Chinese (繁體中文)';
  const sourceLangName = sourceLang === 'zh' ? 'Chinese' : 'English';

  const systemPrompt = [
    `You are a factory-floor interpreter. Translate the ${sourceLangName} text to ${targetLangName}.`,
    'Rules:',
    '- Return ONLY the translated text. No explanations, labels, or quotation marks.',
    '- Use natural, concise spoken language suitable for a factory environment.',
    '- Preserve all numbers, units of measurement, and technical terms exactly as written.',
    '- Do not add any content not present in the original text.',
  ].join('\n');

  const client = getClient();
  const response = await client.chat.completions.create({
    model: TRANSLATE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text.trim() },
    ],
    max_completion_tokens: 512,
    reasoning_effort: 'minimal',
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}
