/**
 * server/basic-auth.js — HTTP Basic Auth 中介層
 *
 * 帳密由環境變數 BASIC_AUTH_USERS 提供，格式：user1:pass1,user2:pass2
 * 未設或空 → 驗證停用，啟動時印警告（graceful degrade）。
 */

import { timingSafeEqual } from 'node:crypto';

// ── Parse env ────────────────────────────────────────────────────────────────

/** @type {Map<string, string>} */
const authMap = new Map();

const raw = process.env.BASIC_AUTH_USERS ?? '';
if (raw.trim()) {
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      console.warn('[basic-auth] 忽略格式錯誤的帳密組（缺少冒號）:', trimmed);
      continue;
    }
    const user = trimmed.slice(0, colonIdx);
    const pass = trimmed.slice(colonIdx + 1); // 允許密碼本身含冒號
    if (!user) {
      console.warn('[basic-auth] 忽略空白 user 的帳密組');
      continue;
    }
    authMap.set(user, pass);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** 回傳 Basic Auth 是否啟用（Map 有至少一組帳密） */
export function isAuthEnabled() {
  return authMap.size > 0;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 常數時間字串比對（避免 timing attack）。
 * 長度不同直接回 false（timingSafeEqual 長度不同會 throw）。
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * 從 Authorization header 解析並驗證帳密。
 * @param {string|undefined} authHeader
 * @returns {boolean}
 */
function verifyHeader(authHeader) {
  if (!authHeader || !authHeader.startsWith('Basic ')) return false;

  let decoded;
  try {
    decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) return false;

  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);

  const storedPass = authMap.get(user);
  if (storedPass === undefined) return false;

  return safeEqual(pass, storedPass);
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Express middleware：保護靜態檔與所有 /api/* 路由。
 * @type {import('express').RequestHandler}
 */
export function expressBasicAuth(req, res, next) {
  if (!isAuthEnabled()) return next();

  if (verifyHeader(req.headers['authorization'])) return next();

  res
    .set('WWW-Authenticate', 'Basic realm="whisper-realtime"')
    .status(401)
    .end();
}

/**
 * WebSocket upgrade 驗證：供 verifyClient callback 使用。
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function verifyBasicAuthUpgrade(req) {
  if (!isAuthEnabled()) return true;
  return verifyHeader(req.headers['authorization']);
}
