// logs.js — Translation logs viewer page logic

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let rows       = [];   // Current page rows from server
let total      = 0;    // Total matching rows
let limit      = 50;   // Page size
let offset     = 0;    // Current page offset
let flaggedOnly = false; // Whether to show only flagged rows
let dbDisabled = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadLogs();
});

// ── DB error banner ───────────────────────────────────────────────────────────

/**
 * Show or hide the DB error banner and disable/enable interactive controls.
 * @param {boolean} show
 */
function setDbError(show) {
  dbDisabled = show;
  const banner = document.getElementById('dbError');
  banner.style.display = show ? 'block' : 'none';

  const chk = document.getElementById('chkFlagged');
  if (chk) chk.disabled = show;

  // Pagination buttons also get disabled via renderPagination when dbDisabled
  document.getElementById('btnPrev').disabled = show || offset <= 0;
  document.getElementById('btnNext').disabled = show || offset + limit >= total;
}

// ── API response handler ──────────────────────────────────────────────────────

/**
 * Handle a fetch Response — propagates 503 as a DB-disabled signal.
 * Returns parsed JSON or throws.
 */
async function handleResponse(res) {
  if (res.status === 503) {
    setDbError(true);
    throw new Error('db_disabled');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Load logs ─────────────────────────────────────────────────────────────────

async function loadLogs() {
  const tbody = document.getElementById('logsTbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="5">載入中…</td></tr>';

  const params = new URLSearchParams({
    limit:  String(limit),
    offset: String(offset),
  });
  if (flaggedOnly) params.set('flagged', '1');

  try {
    const res  = await fetch(`/api/logs?${params}`);
    const data = await handleResponse(res);
    setDbError(false);

    rows  = Array.isArray(data.rows) ? data.rows : [];
    total = typeof data.total === 'number' ? data.total : 0;

    renderTable();
    renderPagination();
  } catch (err) {
    if (err.message === 'db_disabled') {
      rows  = [];
      total = 0;
      renderTable();
      renderPagination();
    } else {
      tbody.innerHTML = `<tr class="loading-row"><td colspan="5" style="color:var(--err-tx)">載入失敗：${escHtml(err.message)}</td></tr>`;
    }
  }
}

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('logsTbody');

  if (rows.length === 0) {
    const msg = dbDisabled
      ? '資料庫未連線，無法顯示紀錄。'
      : '目前沒有符合條件的翻譯紀錄。';
    tbody.innerHTML = `<tr class="loading-row"><td colspan="5">${escHtml(msg)}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => buildRow(r)).join('');
}

/**
 * Build a single <tr> for a log row.
 */
function buildRow(r) {
  const flagged   = !!r.quality_flag;
  const flagCls   = flagged ? ' row-flagged' : '';
  const btnCls    = flagged ? ' flagged' : '';
  const btnLabel  = flagged ? '取消標記' : '標記翻錯';
  const disAttr   = dbDisabled ? ' disabled' : '';

  const timeStr   = formatTime(r.created_at || r.ts);
  const langBadge = r.source_lang
    ? `<span class="lang-badge">${escHtml(r.source_lang)}</span>`
    : '';
  const refined   = (r.refined_translation || '').trim()
    ? escHtml(r.refined_translation)
    : '<span class="empty-dash">—</span>';

  return `
    <tr data-id="${r.id}" class="${flagCls.trim()}">
      <td class="cell-time">${escHtml(timeStr)}</td>
      <td class="cell-text">${escHtml(r.source_text || '')}${langBadge}</td>
      <td class="cell-text">${escHtml(r.rt_translation || '')}</td>
      <td class="cell-text">${refined}</td>
      <td>
        <button class="btn-flag${btnCls}"
                onclick="toggleQuality(${r.id}, ${flagged})"
                ${disAttr}>${escHtml(btnLabel)}</button>
      </td>
    </tr>`;
}

// ── Toggle quality flag ───────────────────────────────────────────────────────

async function toggleQuality(id, currentFlag) {
  if (dbDisabled) return;

  const newFlag = !currentFlag;
  const btn = document.querySelector(`tr[data-id="${id}"] .btn-flag`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '處理中…';
  }

  try {
    const res = await fetch(`/api/logs/${id}/quality`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ quality_flag: newFlag }),
    });
    const updated = await handleResponse(res);

    // Update the local row in place rather than full reload
    const idx = rows.findIndex(r => r.id === id);
    if (idx !== -1) {
      rows[idx] = { ...rows[idx], ...updated };
    }
    renderTable();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`操作失敗：${err.message}`);
      // Restore button label on failure
      if (btn) {
        btn.disabled    = false;
        btn.textContent = currentFlag ? '取消標記' : '標記翻錯';
      }
    }
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination() {
  const info    = document.getElementById('pageInfo');
  const btnPrev = document.getElementById('btnPrev');
  const btnNext = document.getElementById('btnNext');

  if (total === 0) {
    info.textContent = '沒有資料';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  const from = offset + 1;
  const to   = Math.min(offset + limit, total);
  info.textContent = `第 ${from}–${to} 筆，共 ${total}`;

  btnPrev.disabled = dbDisabled || offset <= 0;
  btnNext.disabled = dbDisabled || offset + limit >= total;
}

function goPrev() {
  if (offset <= 0) return;
  offset = Math.max(0, offset - limit);
  loadLogs();
}

function goNext() {
  if (offset + limit >= total) return;
  offset += limit;
  loadLogs();
}

// ── Filter ────────────────────────────────────────────────────────────────────

function onFlaggedChange() {
  if (dbDisabled) return;
  const chk = document.getElementById('chkFlagged');
  flaggedOnly = chk.checked;
  offset = 0; // Reset to first page when filter changes
  loadLogs();
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format an ISO timestamp or epoch string to a human-readable date+time.
 * @param {string|number|null} val
 * @returns {string}
 */
function formatTime(val) {
  if (!val) return '—';
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(val);
  }
}
