/**
 * server/translate.js — 多供應商文字翻譯
 *
 * 支援三種 provider（由 TRANSLATE_PROVIDER 環境變數決定，預設 openai）：
 *   openai    — OpenAI Chat Completions API
 *   anthropic — Anthropic Messages API（@anthropic-ai/sdk）
 *   custom    — 任何 OpenAI 相容端點（Gemini/Groq/Ollama 等）
 *
 * Export 簽名：translate(text, sourceLang) → Promise<string>
 *
 * gpt-5 系列：max_completion_tokens + reasoning_effort（預設 'minimal'，
 * 可由 TRANSLATE_REASONING_EFFORT 環境變數覆寫；若模型不支援則自動移除重試）
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

/** @type {OpenAI|null} */
let _openaiClient = null;
/** @type {Anthropic|null} */
let _anthropicClient = null;
/** @type {OpenAI|null} */
let _customClient = null;

function getOpenAIClient() {
  if (!_openaiClient) {
    _openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiClient;
}

function getAnthropicClient() {
  if (!_anthropicClient) {
    _anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropicClient;
}

function getCustomClient() {
  if (!_customClient) {
    _customClient = new OpenAI({
      baseURL: process.env.TRANSLATE_BASE_URL,
      apiKey: process.env.TRANSLATE_API_KEY ?? 'not-needed',
    });
  }
  return _customClient;
}

/**
 * 建立工廠口譯 system prompt
 * @param {"zh"|"en"} sourceLang
 * @returns {string}
 */
function buildSystemPrompt(sourceLang) {
  const targetLangName =
    sourceLang === 'zh'
      ? 'English'
      : 'Traditional Chinese (繁體中文，臺灣用語)';
  const sourceLangName = sourceLang === 'zh' ? 'Chinese' : 'English';

  return [
    `You are a factory-floor interpreter. Translate the ${sourceLangName} text to ${targetLangName}.`,
    'Rules:',
    '- Return ONLY the translated text. No explanations, labels, or quotation marks.',
    '- Use natural, concise spoken language suitable for a factory environment.',
    '- Preserve all numbers, units of measurement, and technical terms exactly as written.',
    '- Do not add any content not present in the original text.',
  ].join('\n');
}

/**
 * OpenAI provider 翻譯
 * @param {string} text
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
async function translateOpenAI(text, systemPrompt) {
  const model = process.env.TRANSLATE_MODEL ?? 'gpt-5-mini';
  const isGpt5Series = model.startsWith('gpt-5');
  const reasoningEffort = process.env.TRANSLATE_REASONING_EFFORT ?? 'minimal';

  const extraParams = isGpt5Series
    ? { max_completion_tokens: 512, reasoning_effort: reasoningEffort }
    : { max_tokens: 512, temperature: 0.1 };

  const client = getOpenAIClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      ...extraParams,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    if (err.message && err.message.includes('reasoning_effort')) {
      console.warn(
        `[translate] 模型 ${model} 不支援 reasoning_effort=${reasoningEffort}，改用模型預設值重試`,
      );
      const retryParams = { ...extraParams };
      delete retryParams.reasoning_effort;
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        ...retryParams,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }
    throw err;
  }
}

/**
 * Anthropic provider 翻譯
 * @param {string} text
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
async function translateAnthropic(text, systemPrompt) {
  const client = getAnthropicClient();
  try {
    const response = await client.messages.create({
      model: process.env.TRANSLATE_MODEL ?? 'claude-haiku-4-5',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: text }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.text?.trim() ?? '';
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Custom（OpenAI 相容）provider 翻譯
 * @param {string} text
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
async function translateCustom(text, systemPrompt) {
  const model = process.env.TRANSLATE_MODEL;
  if (!model) {
    throw new Error('TRANSLATE_MODEL is required when TRANSLATE_PROVIDER=custom');
  }

  const isGpt5Series = model.startsWith('gpt-5');
  const reasoningEffort = process.env.TRANSLATE_REASONING_EFFORT ?? 'minimal';

  const extraParams = isGpt5Series
    ? { max_completion_tokens: 512, reasoning_effort: reasoningEffort }
    : { max_tokens: 512, temperature: 0.1 };

  const client = getCustomClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      ...extraParams,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    if (err.message && err.message.includes('reasoning_effort')) {
      console.warn(
        `[translate] 模型 ${model} 不支援 reasoning_effort=${reasoningEffort}，改用模型預設值重試`,
      );
      const retryParams = { ...extraParams };
      delete retryParams.reasoning_effort;
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        ...retryParams,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }
    throw err;
  }
}

/**
 * 翻譯文字
 * @param {string} text 原文
 * @param {"zh"|"en"} sourceLang 來源語言
 * @returns {Promise<string>} 譯文（只含翻譯結果，不含任何說明）
 */
export async function translate(text, sourceLang) {
  if (!text || typeof text !== 'string' || text.trim() === '') return '';

  const systemPrompt = buildSystemPrompt(sourceLang);
  const trimmed = text.trim();
  const provider = process.env.TRANSLATE_PROVIDER ?? 'openai';

  switch (provider) {
    case 'anthropic':
      return translateAnthropic(trimmed, systemPrompt);
    case 'custom':
      return translateCustom(trimmed, systemPrompt);
    case 'openai':
    default:
      return translateOpenAI(trimmed, systemPrompt);
  }
}
