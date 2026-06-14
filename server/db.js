/**
 * server/db.js — PostgreSQL 資料層
 *
 * 公開介面契約（db-foundation 實作，route-b 消費）：
 *   isDbEnabled()          → boolean
 *   initDb()               → Promise<void>
 *   findGlossaryTerms(sourceLang, targetLang, text)
 *                          → Promise<Array<{id, source_term, target_term}>>
 *   insertLog({sessionId, ts, sourceLang, targetLang, sourceText,
 *              rtTranslation, audioMode, thresholdPct, refinementEnabled})
 *                          → Promise<number|null>
 *   updateLogRefined(logId, refinedTranslation, glossaryUsedJson)
 *                          → Promise<void>
 *   createSession()        → Promise<string|null>
 *   endSession(sessionId)  → Promise<void>
 *   getCjkThreshold(sourceLang, targetLang)
 *                          → Promise<number|null>   （記憶體快取；無 DB/無列→null）
 *   listLangThresholds()   → Promise<Array<{source_lang,target_lang,threshold,updated_at}>>
 *   upsertLangThreshold(sourceLang, targetLang, threshold)
 *                          → Promise<object|null>   （upsert 後列；清該對快取）
 *   listLogs({ limit, offset, flaggedOnly })
 *                          → Promise<{ rows:Array, total:number }>
 *                            （rows 依 id DESC；flaggedOnly=true 時 WHERE quality_flag=true；
 *                             無 DB → { rows:[], total:0 }）
 *   setLogQuality(id, flag, note)
 *                          → Promise<object|null>   （UPDATE RETURNING *；無 DB → null）
 *
 * DATABASE_URL 未設定 → isDbEnabled()=false，所有函式為安全 no-op。
 * SSL：PGSSLMODE=disable → 不加 SSL；否則先試 ssl:{rejectUnauthorized:false}，
 *      失敗再試無 SSL（Zeabur PG 容錯）。
 */

import pg from 'pg';
import { randomUUID } from 'crypto';

const { Pool } = pg;

const DB_URL = process.env.DATABASE_URL;

/** @type {import('pg').Pool|null} */
let pool = null;
let _dbEnabled = false;

// ── 公開：狀態查詢 ────────────────────────────────────────────────────────────

/** DB 是否可用 */
export function isDbEnabled() {
  return _dbEnabled;
}

// ── 內部：建立 Pool（SSL 容錯） ───────────────────────────────────────────────

async function tryConnect(config) {
  const p = new Pool(config);
  await p.query('SELECT 1'); // 驗證連線
  return p;
}

async function buildPool() {
  if (!DB_URL) return null;

  // 明確停用 SSL
  if (process.env.PGSSLMODE === 'disable') {
    return tryConnect({ connectionString: DB_URL });
  }

  // 優先嘗試 ssl:rejectUnauthorized=false（Zeabur PG 常見設定）
  try {
    return await tryConnect({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
    });
  } catch (e1) {
    console.warn('[db] SSL 連線失敗，改試不帶 SSL:', e1.message);
    try {
      return await tryConnect({ connectionString: DB_URL });
    } catch (e2) {
      console.warn('[db] 無 SSL 連線亦失敗:', e2.message);
      return null;
    }
  }
}

// ── 公開：初始化 ──────────────────────────────────────────────────────────────

/**
 * 連線 + 建立三張表（IF NOT EXISTS）。
 * 失敗只警告，不 throw，不阻礙啟動。
 */
export async function initDb() {
  if (!DB_URL) {
    console.warn('[db] DATABASE_URL 未設定 — DB 功能停用');
    return;
  }

  try {
    pool = await buildPool();
    if (!pool) {
      console.warn('[db] 無法建立 DB 連線 — DB 功能停用');
      return;
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS glossary_terms (
        id          serial PRIMARY KEY,
        source_lang text        NOT NULL,
        target_lang text        NOT NULL,
        source_term text        NOT NULL,
        target_term text        NOT NULL,
        enabled     boolean     NOT NULL DEFAULT true,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS translation_logs (
        id                  serial PRIMARY KEY,
        session_id          text,
        ts                  text,
        source_lang         text,
        target_lang         text,
        source_text         text,
        rt_translation      text,
        refined_translation text,
        glossary_used       jsonb,
        refinement_enabled  boolean,
        audio_mode          text,
        threshold_pct       int,
        created_at          timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 冪等遷移：為既有 translation_logs 補品質欄 + 索引
    await pool.query(`ALTER TABLE translation_logs ADD COLUMN IF NOT EXISTS quality_flag boolean DEFAULT false`);
    await pool.query(`ALTER TABLE translation_logs ADD COLUMN IF NOT EXISTS quality_note text`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_logs_created_at ON translation_logs(created_at DESC)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         text PRIMARY KEY,
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at   timestamptz
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS refine_prompts (
        id          serial      PRIMARY KEY,
        name        text        NOT NULL,
        prompt_text text        NOT NULL,
        is_active   boolean     NOT NULL DEFAULT false,
        enabled     boolean     NOT NULL DEFAULT true,
        created_at  timestamptz          DEFAULT now(),
        updated_at  timestamptz          DEFAULT now()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lang_pair_thresholds (
        source_lang text  NOT NULL,
        target_lang text  NOT NULL,
        threshold   real  NOT NULL,
        updated_at  timestamptz DEFAULT now(),
        PRIMARY KEY (source_lang, target_lang)
      )
    `);

    _dbEnabled = true;
    console.log('[db] 已連線，資料表就緒');
  } catch (err) {
    console.warn('[db] initDb 失敗（DB 功能停用）:', err.message);
    pool = null;
    _dbEnabled = false;
  }
}

// ── 公開：詞彙表查詢 ──────────────────────────────────────────────────────────

/**
 * 回傳 enabled 且 source_term 出現在 text 中的詞條。
 * DB 停用或查詢失敗時回 []。
 *
 * @param {string} sourceLang  來源語言碼（zh / en / ko …）
 * @param {string} targetLang  目標語言碼
 * @param {string} text        待比對的原文
 * @returns {Promise<Array<{id:number, source_term:string, target_term:string}>>}
 */
export async function findGlossaryTerms(sourceLang, targetLang, text) {
  if (!_dbEnabled || !pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, source_term, target_term
         FROM glossary_terms
        WHERE source_lang = $1
          AND target_lang = $2
          AND enabled     = true`,
      [sourceLang, targetLang],
    );
    return rows.filter((row) => text.includes(row.source_term));
  } catch (err) {
    console.warn('[db] findGlossaryTerms 失敗:', err.message);
    return [];
  }
}

// ── 公開：詞彙表 CRUD（供 REST API 使用） ────────────────────────────────────

/**
 * 列出詞彙表，可選以語言對過濾。
 * @param {string|undefined} sourceLang
 * @param {string|undefined} targetLang
 * @returns {Promise<Array>}
 */
export async function listGlossaryTerms(sourceLang, targetLang) {
  if (!_dbEnabled || !pool) return [];
  try {
    const conditions = [];
    const params = [];
    if (sourceLang) { conditions.push(`source_lang = $${params.length + 1}`); params.push(sourceLang); }
    if (targetLang) { conditions.push(`target_lang = $${params.length + 1}`); params.push(targetLang); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT * FROM glossary_terms ${where} ORDER BY id`,
      params,
    );
    return rows;
  } catch (err) {
    console.warn('[db] listGlossaryTerms 失敗:', err.message);
    return [];
  }
}

/**
 * 新增詞彙條目，回傳完整新列（DB 停用時回 null）。
 * @param {{ source_lang:string, target_lang:string, source_term:string, target_term:string, enabled?:boolean }} term
 * @returns {Promise<object|null>}
 */
export async function createGlossaryTerm({ source_lang, target_lang, source_term, target_term, enabled = true }) {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO glossary_terms (source_lang, target_lang, source_term, target_term, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [source_lang, target_lang, source_term, target_term, enabled],
    );
    return rows[0];
  } catch (err) {
    console.warn('[db] createGlossaryTerm 失敗:', err.message);
    return null;
  }
}

/**
 * 更新詞彙條目（部分欄位），回傳更新後的列；不存在時回 null。
 * @param {number} id
 * @param {{ source_term?:string, target_term?:string, enabled?:boolean }} fields
 * @returns {Promise<object|null>}
 */
export async function updateGlossaryTerm(id, fields) {
  if (!_dbEnabled || !pool) return null;
  const { source_term, target_term, enabled } = fields;
  const sets = [];
  const params = [];
  if (source_term !== undefined) { sets.push(`source_term = $${params.length + 1}`); params.push(source_term); }
  if (target_term !== undefined) { sets.push(`target_term = $${params.length + 1}`); params.push(target_term); }
  if (enabled    !== undefined) { sets.push(`enabled     = $${params.length + 1}`); params.push(enabled); }
  if (!sets.length) return null; // 呼叫端應先驗證
  sets.push('updated_at = now()');
  params.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE glossary_terms SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[db] updateGlossaryTerm 失敗:', err.message);
    return null;
  }
}

// ── 公開：翻譯 log 寫入 ───────────────────────────────────────────────────────

/**
 * 寫入一筆翻譯 log，回傳新建 log 的 id（DB 停用時回 null）。
 *
 * @param {{
 *   sessionId:          string|null,
 *   ts:                 string|null,
 *   sourceLang:         string|null,
 *   targetLang:         string|null,
 *   sourceText:         string|null,
 *   rtTranslation:      string|null,
 *   audioMode:          string|null,
 *   thresholdPct:       number|null,
 *   refinementEnabled:  boolean,
 * }} params
 * @returns {Promise<number|null>}
 */
export async function insertLog({
  sessionId,
  ts,
  sourceLang,
  targetLang,
  sourceText,
  rtTranslation,
  audioMode,
  thresholdPct,
  refinementEnabled,
}) {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO translation_logs
         (session_id, ts, source_lang, target_lang, source_text,
          rt_translation, audio_mode, threshold_pct, refinement_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        sessionId      ?? null,
        ts             ?? null,
        sourceLang     ?? null,
        targetLang     ?? null,
        sourceText     ?? null,
        rtTranslation  ?? null,
        audioMode      ?? null,
        thresholdPct   ?? null,
        refinementEnabled ?? false,
      ],
    );
    return rows[0].id;
  } catch (err) {
    console.warn('[db] insertLog 失敗:', err.message);
    return null;
  }
}

/**
 * 補填精準翻譯結果與使用的詞彙（Route B 完成後呼叫）。
 *
 * @param {number}  logId
 * @param {string}  refinedTranslation
 * @param {any}     glossaryUsedJson  — 可序列化為 JSONB 的值
 */
export async function updateLogRefined(logId, refinedTranslation, glossaryUsedJson) {
  if (!_dbEnabled || !pool) return;
  try {
    await pool.query(
      `UPDATE translation_logs
          SET refined_translation = $1,
              glossary_used       = $2
        WHERE id = $3`,
      [refinedTranslation, JSON.stringify(glossaryUsedJson), logId],
    );
  } catch (err) {
    console.warn('[db] updateLogRefined 失敗:', err.message);
  }
}

// ── 公開：翻譯 log 查詢 / 品質標記 ───────────────────────────────────────────

/**
 * 分頁列出翻譯 log，依 id DESC。
 * @param {{ limit?:number, offset?:number, flaggedOnly?:boolean }} opts
 * @returns {Promise<{ rows:Array, total:number }>}
 */
export async function listLogs({ limit = 50, offset = 0, flaggedOnly = false } = {}) {
  if (!_dbEnabled || !pool) return { rows: [], total: 0 };
  const where = flaggedOnly ? 'WHERE quality_flag = true' : '';
  try {
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT * FROM translation_logs ${where} ORDER BY id DESC LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query(
        `SELECT count(*) FROM translation_logs ${where}`,
      ),
    ]);
    return {
      rows:  dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
    };
  } catch (err) {
    console.warn('[db] listLogs 失敗:', err.message);
    return { rows: [], total: 0 };
  }
}

/**
 * 更新翻譯 log 的品質標記與備註，回傳更新後的完整列。
 * DB 停用時回 null。
 *
 * @param {number}  id
 * @param {boolean} flag
 * @param {string|null} note
 * @returns {Promise<object|null>}
 */
export async function setLogQuality(id, flag, note = null) {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE translation_logs
          SET quality_flag = $1,
              quality_note = $2
        WHERE id = $3
        RETURNING *`,
      [flag, note ?? null, id],
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[db] setLogQuality 失敗:', err.message);
    return null;
  }
}

// ── 公開：Refine Prompt 庫 CRUD ───────────────────────────────────────────────

/**
 * 列出所有 refine prompt（DB 停用時回 []）。
 * @returns {Promise<Array>}
 */
export async function listRefinePrompts() {
  if (!_dbEnabled || !pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM refine_prompts ORDER BY id`,
    );
    return rows;
  } catch (err) {
    console.warn('[db] listRefinePrompts 失敗:', err.message);
    return [];
  }
}

/**
 * 新增 refine prompt，回傳完整新列（DB 停用時回 null）。
 * @param {{ name:string, prompt_text:string, enabled?:boolean }} params
 * @returns {Promise<object|null>}
 */
export async function createRefinePrompt({ name, prompt_text, enabled = true }) {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO refine_prompts (name, prompt_text, enabled)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, prompt_text, enabled],
    );
    return rows[0];
  } catch (err) {
    console.warn('[db] createRefinePrompt 失敗:', err.message);
    return null;
  }
}

/**
 * 更新 refine prompt（部分欄位），回傳更新後的列；不存在時回 null。
 * 若 is_active=true，先清除其他列的 is_active，再設定目標列（單一 active 規則）。
 * @param {number} id
 * @param {{ name?:string, prompt_text?:string, enabled?:boolean, is_active?:boolean }} fields
 * @returns {Promise<object|null>}
 */
export async function updateRefinePrompt(id, fields) {
  if (!_dbEnabled || !pool) return null;
  const { name, prompt_text, enabled, is_active } = fields;
  const sets = [];
  const params = [];
  if (name        !== undefined) { sets.push(`name        = $${params.length + 1}`); params.push(name); }
  if (prompt_text !== undefined) { sets.push(`prompt_text = $${params.length + 1}`); params.push(prompt_text); }
  if (enabled     !== undefined) { sets.push(`enabled     = $${params.length + 1}`); params.push(enabled); }
  if (is_active   !== undefined) { sets.push(`is_active   = $${params.length + 1}`); params.push(is_active); }
  if (!sets.length) return null; // 呼叫端應先驗證
  sets.push('updated_at = now()');
  params.push(id);
  try {
    // 單一 active 規則：啟用某列時先把其他列清除
    if (is_active === true) {
      await pool.query(
        `UPDATE refine_prompts SET is_active = false WHERE id <> $1`,
        [id],
      );
    }
    const { rows } = await pool.query(
      `UPDATE refine_prompts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[db] updateRefinePrompt 失敗:', err.message);
    return null;
  }
}

/**
 * 刪除 refine prompt。
 * @param {number} id
 * @returns {Promise<void>}
 */
export async function deleteRefinePrompt(id) {
  if (!_dbEnabled || !pool) return;
  try {
    await pool.query(`DELETE FROM refine_prompts WHERE id = $1`, [id]);
  } catch (err) {
    console.warn('[db] deleteRefinePrompt 失敗:', err.message);
  }
}

/**
 * 取得目前啟用中的 refine prompt（is_active=true 且 enabled=true）。
 * 無符合列時回 null（DB 停用時亦回 null）。
 * @returns {Promise<object|null>}
 */
export async function getActiveRefinePrompt() {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM refine_prompts WHERE is_active = true AND enabled = true LIMIT 1`,
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[db] getActiveRefinePrompt 失敗:', err.message);
    return null;
  }
}

// ── 公開：語言對偵測門檻 ──────────────────────────────────────────────────────

/** 記憶體快取：`"${sourceLang}:${targetLang}"` → threshold(number) */
const _thresholdCache = new Map();

/**
 * 取得指定語言對的 CJK 門檻值（來自 DB lang_pair_thresholds 表）。
 * 使用記憶體快取；無 DB 或無對應列時回 null。
 *
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {Promise<number|null>}
 */
export async function getCjkThreshold(sourceLang, targetLang) {
  if (!_dbEnabled || !pool) return null;
  const cacheKey = `${sourceLang}:${targetLang}`;
  if (_thresholdCache.has(cacheKey)) return _thresholdCache.get(cacheKey);
  try {
    const { rows } = await pool.query(
      `SELECT threshold FROM lang_pair_thresholds
        WHERE source_lang = $1 AND target_lang = $2
        LIMIT 1`,
      [sourceLang, targetLang],
    );
    if (!rows.length) return null;
    const val = rows[0].threshold;
    _thresholdCache.set(cacheKey, val);
    return val;
  } catch (err) {
    console.warn('[db] getCjkThreshold 失敗:', err.message);
    return null;
  }
}

/**
 * 列出所有語言對門檻設定（DB 停用時回 []）。
 * @returns {Promise<Array<{source_lang:string, target_lang:string, threshold:number, updated_at:Date}>>}
 */
export async function listLangThresholds() {
  if (!_dbEnabled || !pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT source_lang, target_lang, threshold, updated_at
         FROM lang_pair_thresholds
        ORDER BY source_lang, target_lang`,
    );
    return rows;
  } catch (err) {
    console.warn('[db] listLangThresholds 失敗:', err.message);
    return [];
  }
}

/**
 * 新增或更新語言對門檻，回傳 upsert 後的完整列；並清除該對的記憶體快取。
 * DB 停用時回 null。
 *
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {number} threshold
 * @returns {Promise<object|null>}
 */
export async function upsertLangThreshold(sourceLang, targetLang, threshold) {
  if (!_dbEnabled || !pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO lang_pair_thresholds (source_lang, target_lang, threshold, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (source_lang, target_lang)
       DO UPDATE SET threshold = EXCLUDED.threshold, updated_at = now()
       RETURNING *`,
      [sourceLang, targetLang, threshold],
    );
    // 清除該對快取，使下次 getCjkThreshold 重新從 DB 讀取
    _thresholdCache.delete(`${sourceLang}:${targetLang}`);
    return rows[0] ?? null;
  } catch (err) {
    console.warn('[db] upsertLangThreshold 失敗:', err.message);
    return null;
  }
}

// ── 公開：session 生命週期 ────────────────────────────────────────────────────

/**
 * 建立新 session，回傳 UUID（DB 停用時回 null）。
 * @returns {Promise<string|null>}
 */
export async function createSession() {
  if (!_dbEnabled || !pool) return null;
  try {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sessions (id) VALUES ($1)`,
      [id],
    );
    return id;
  } catch (err) {
    console.warn('[db] createSession 失敗:', err.message);
    return null;
  }
}

/**
 * 記錄 session 結束時間。
 * @param {string|null} sessionId
 */
export async function endSession(sessionId) {
  if (!_dbEnabled || !pool || !sessionId) return;
  try {
    await pool.query(
      `UPDATE sessions SET ended_at = now() WHERE id = $1`,
      [sessionId],
    );
  } catch (err) {
    console.warn('[db] endSession 失敗:', err.message);
  }
}
