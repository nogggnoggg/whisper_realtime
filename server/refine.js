/**
 * server/refine.js — Route B 精準翻譯
 *
 * export refine({ sourceText, sourceLang, targetLang, rtTranslation,
 *                 glossaryTerms, context }) → Promise<string>
 *
 * - 沿用 translate.js 的三 provider 模式（TRANSLATE_PROVIDER 環境變數）
 * - 模型優先級：REFINE_MODEL → TRANSLATE_MODEL → provider 預設
 *   openai 預設：gpt-5-mini；anthropic 預設：claude-haiku-4-5
 *   gpt-5 系列：max_completion_tokens + reasoning_effort（預設 'minimal'，
 *   可由 REFINE_REASONING_EFFORT 環境變數覆寫；若模型不支援則自動移除重試）
 * - system prompt（英文）：提供原文、RT 翻譯、詞彙表、對話上下文；
 *   目標語言為 zh 時加入 Traditional Chinese 臺灣用語指示
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ── Lazy client singletons ─────────────────────────────────────────────────

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

// ── Model resolution ───────────────────────────────────────────────────────

/**
 * 取得精準翻譯使用的模型名稱。
 * 優先級：REFINE_MODEL → TRANSLATE_MODEL → provider 預設。
 * @param {string} provider
 * @returns {string}
 */
function resolveModel(provider) {
  if (process.env.REFINE_MODEL) return process.env.REFINE_MODEL;
  if (process.env.TRANSLATE_MODEL) return process.env.TRANSLATE_MODEL;
  switch (provider) {
    case 'anthropic':
      return 'claude-haiku-4-5';
    case 'custom':
      throw new Error(
        'REFINE_MODEL or TRANSLATE_MODEL is required when TRANSLATE_PROVIDER=custom',
      );
    case 'openai':
    default:
      return 'gpt-5-mini';
  }
}

// ── System prompt ──────────────────────────────────────────────────────────

/**
 * Build the refinement system prompt.
 *
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {Array<{source_term:string, target_term:string}>} glossaryTerms
 * @param {Array<{sourceText:string, translation:string}>} context
 * @returns {string}
 */
function buildSystemPrompt(sourceLang, targetLang, glossaryTerms, context) {
  const targetLangLabel =
    targetLang === 'zh'
      ? 'Traditional Chinese (繁體中文，臺灣用語)'
      : targetLang === 'en'
        ? 'English'
        : targetLang.toUpperCase();

  const sourceLangLabel =
    sourceLang === 'zh'
      ? 'Chinese'
      : sourceLang === 'en'
        ? 'English'
        : sourceLang.toUpperCase();

  const lines = [
    `You are a factory-floor interpreter specializing in semantic refinement.`,
    `Your task: produce a more accurate and natural ${targetLangLabel} translation of a ${sourceLangLabel} factory utterance.`,
    `You will receive:`,
    `  1. The complete original source text`,
    `  2. A real-time translation (Route A — fast but possibly imprecise)`,
    `  3. Glossary terms you MUST follow exactly (source_term → target_term)`,
    `  4. Recent conversation context (for continuity and disambiguation)`,
    ``,
    `Rules:`,
    `- Return ONLY the refined translated text. No explanations, labels, or quotation marks.`,
    `- Use natural, concise spoken language suitable for a factory environment.`,
    `- Preserve all numbers, units of measurement, and technical terms exactly as written.`,
    `- Apply every glossary term listed below precisely as specified.`,
    `- Do not add any content not present in the original text.`,
  ];

  if (targetLang === 'zh') {
    lines.push(
      `- Output must be Traditional Chinese in Taiwan usage (臺灣正體繁體中文，請勿使用簡體字或中國大陸慣用語).`,
    );
  }

  if (glossaryTerms.length > 0) {
    lines.push(``, `Glossary (must follow exactly):`);
    for (const t of glossaryTerms) {
      lines.push(`  ${t.source_term} → ${t.target_term}`);
    }
  }

  if (context.length > 0) {
    lines.push(``, `Recent conversation context (most recent last):`);
    for (const c of context) {
      lines.push(`  [Source]      ${c.sourceText}`);
      lines.push(`  [Translation] ${c.translation}`);
    }
  }

  return lines.join('\n');
}

// ── User message ───────────────────────────────────────────────────────────

/**
 * Build the user message that contains the actual source text + RT translation.
 * @param {string} sourceText
 * @param {string} rtTranslation
 * @returns {string}
 */
function buildUserMessage(sourceText, rtTranslation) {
  return [
    `[Source text]`,
    sourceText,
    ``,
    `[Real-time translation (Route A)]`,
    rtTranslation || '(none)',
  ].join('\n');
}

// ── Provider implementations ───────────────────────────────────────────────

/**
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function refineOpenAI(systemPrompt, userMessage) {
  const model = resolveModel('openai');
  const isGpt5Series = model.startsWith('gpt-5');
  const reasoningEffort = process.env.REFINE_REASONING_EFFORT ?? 'minimal';

  const extraParams = isGpt5Series
    ? { max_completion_tokens: 512, reasoning_effort: reasoningEffort }
    : { max_tokens: 512, temperature: 0.2 };

  const client = getOpenAIClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...extraParams,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    if (err.message && err.message.includes('reasoning_effort')) {
      console.warn(
        `[refine] 模型 ${model} 不支援 reasoning_effort=${reasoningEffort}，改用模型預設值重試`,
      );
      const retryParams = { ...extraParams };
      delete retryParams.reasoning_effort;
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...retryParams,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }
    throw err;
  }
}

/**
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function refineAnthropic(systemPrompt, userMessage) {
  const model = resolveModel('anthropic');
  const client = getAnthropicClient();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
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
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function refineCustom(systemPrompt, userMessage) {
  const model = resolveModel('custom');
  const isGpt5Series = model.startsWith('gpt-5');
  const reasoningEffort = process.env.REFINE_REASONING_EFFORT ?? 'minimal';

  const extraParams = isGpt5Series
    ? { max_completion_tokens: 512, reasoning_effort: reasoningEffort }
    : { max_tokens: 512, temperature: 0.2 };

  const client = getCustomClient();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      ...extraParams,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    if (err.message && err.message.includes('reasoning_effort')) {
      console.warn(
        `[refine] 模型 ${model} 不支援 reasoning_effort=${reasoningEffort}，改用模型預設值重試`,
      );
      const retryParams = { ...extraParams };
      delete retryParams.reasoning_effort;
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...retryParams,
      });
      return response.choices[0]?.message?.content?.trim() ?? '';
    }
    throw err;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * 精準翻譯（Route B）
 *
 * @param {{
 *   sourceText:    string,
 *   sourceLang:    string,
 *   targetLang:    string,
 *   rtTranslation: string,
 *   glossaryTerms: Array<{source_term:string, target_term:string}>,
 *   context:       Array<{sourceText:string, translation:string}>,
 * }} params
 * @returns {Promise<string>}
 */
export async function refine({
  sourceText,
  sourceLang,
  targetLang,
  rtTranslation,
  glossaryTerms,
  context,
}) {
  if (!sourceText || sourceText.trim() === '') return '';

  const provider = process.env.TRANSLATE_PROVIDER ?? 'openai';
  const systemPrompt = buildSystemPrompt(
    sourceLang,
    targetLang,
    glossaryTerms ?? [],
    context ?? [],
  );
  const userMessage = buildUserMessage(sourceText.trim(), rtTranslation);

  switch (provider) {
    case 'anthropic':
      return refineAnthropic(systemPrompt, userMessage);
    case 'custom':
      return refineCustom(systemPrompt, userMessage);
    case 'openai':
    default:
      return refineOpenAI(systemPrompt, userMessage);
  }
}
