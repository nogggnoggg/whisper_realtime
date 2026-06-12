// glossary.js — Glossary management page logic
// Phase 2 — glossary-page agent

'use strict';

// PRD §7.5 — 9 default zh→en factory terms
const DEFAULT_TERMS = [
  { source_lang: 'zh', target_lang: 'en', source_term: '良品',     target_term: 'good parts' },
  { source_lang: 'zh', target_lang: 'en', source_term: '不良品',   target_term: 'defective parts' },
  { source_lang: 'zh', target_lang: 'en', source_term: '隔離區',   target_term: 'quarantine area' },
  { source_lang: 'zh', target_lang: 'en', source_term: '停線',     target_term: 'stop the line' },
  { source_lang: 'zh', target_lang: 'en', source_term: '開機',     target_term: 'start the machine' },
  { source_lang: 'zh', target_lang: 'en', source_term: '關機',     target_term: 'shut down the machine' },
  { source_lang: 'zh', target_lang: 'en', source_term: '卡料',     target_term: 'material jam' },
  { source_lang: 'zh', target_lang: 'en', source_term: '首件檢查', target_term: 'first article inspection' },
  { source_lang: 'zh', target_lang: 'en', source_term: '品保',     target_term: 'QA / Quality Assurance' },
];

// Language display labels
const LANG_LABELS = { zh: '中文', en: 'English', ko: '한국어' };

// ── State ───────────────────────────────────────────────────────────────────
let terms = [];        // Array of term objects from server
let editingId = null;  // id of row currently in inline-edit mode
let dbDisabled = false;

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadGlossary();
});

// ── API helpers ──────────────────────────────────────────────────────────────

/**
 * Show or hide the DB error banner.
 * @param {boolean} show
 */
function setDbError(show) {
  dbDisabled = show;
  const banner = document.getElementById('dbError');
  banner.style.display = show ? 'block' : 'none';

  // Disable add controls when DB is off
  const addBtn = document.getElementById('btnAdd');
  if (addBtn) addBtn.disabled = show;
  ['addSrcLang','addSrcTerm','addTgtLang','addTgtTerm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = show;
  });
}

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

// ── Load glossary ────────────────────────────────────────────────────────────

async function loadGlossary() {
  const tbody = document.getElementById('glossaryTbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="5">載入中…</td></tr>';

  try {
    const res = await fetch('/api/glossary');
    const data = await handleResponse(res);
    setDbError(false);
    terms = Array.isArray(data) ? data : [];
    renderTable();
  } catch (err) {
    if (err.message === 'db_disabled') {
      terms = [];
      renderTable();
    } else {
      tbody.innerHTML = `<tr class="loading-row"><td colspan="5" style="color:var(--err-tx)">載入失敗：${escHtml(err.message)}</td></tr>`;
    }
  }
}

// ── Render table ─────────────────────────────────────────────────────────────

function renderTable() {
  const tbody   = document.getElementById('glossaryTbody');
  const empty   = document.getElementById('emptyState');

  if (terms.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';

    // Disable load-defaults button if DB is off
    const btn = document.getElementById('btnLoadDefaults');
    if (btn) btn.disabled = dbDisabled;
    return;
  }

  empty.style.display = 'none';

  tbody.innerHTML = terms.map(t => buildRow(t)).join('');
}

/**
 * Build a single <tr> for a term.
 * @param {{ id: number, source_lang: string, target_lang: string,
 *           source_term: string, target_term: string, enabled: boolean }} t
 */
function buildRow(t) {
  const isEditing   = editingId === t.id;
  const disabledCls = t.enabled ? '' : ' row-disabled';
  const langLabel   = `${t.source_lang}&nbsp;→&nbsp;${t.target_lang}`;

  if (isEditing) {
    return `
      <tr data-id="${t.id}"${disabledCls}>
        <td><span class="lang-badge">${langLabel}</span></td>
        <td><input class="inline-input" id="edit-src-${t.id}" type="text" value="${escAttr(t.source_term)}" /></td>
        <td><input class="inline-input" id="edit-tgt-${t.id}" type="text" value="${escAttr(t.target_term)}" /></td>
        <td>
          <span class="status-pill ${t.enabled ? 'enabled' : 'disabled'}">
            ${t.enabled ? '啟用' : '停用'}
          </span>
        </td>
        <td class="td-actions">
          <button class="btn-sm btn-save"   onclick="saveTerm(${t.id})">儲存</button>
          <button class="btn-sm btn-cancel" onclick="cancelEdit()">取消</button>
        </td>
      </tr>`;
  }

  const toggleLabel = t.enabled ? '停用' : '啟用';
  const toggleCls   = t.enabled ? 'btn-toggle-off' : 'btn-toggle-on';

  return `
    <tr data-id="${t.id}" class="${disabledCls.trim()}">
      <td><span class="lang-badge">${langLabel}</span></td>
      <td>${escHtml(t.source_term)}</td>
      <td>${escHtml(t.target_term)}</td>
      <td>
        <span class="status-pill ${t.enabled ? 'enabled' : 'disabled'}">
          ${t.enabled ? '啟用' : '停用'}
        </span>
      </td>
      <td class="td-actions">
        <button class="btn-sm" onclick="startEdit(${t.id})" ${dbDisabled ? 'disabled' : ''}>編輯</button>
        <button class="btn-sm ${toggleCls}" onclick="toggleEnabled(${t.id}, ${t.enabled})" ${dbDisabled ? 'disabled' : ''}>${toggleLabel}</button>
      </td>
    </tr>`;
}

// ── Add term ─────────────────────────────────────────────────────────────────

async function addTerm() {
  if (dbDisabled) return;

  const srcLang = document.getElementById('addSrcLang').value.trim();
  const srcTerm = document.getElementById('addSrcTerm').value.trim();
  const tgtLang = document.getElementById('addTgtLang').value.trim();
  const tgtTerm = document.getElementById('addTgtTerm').value.trim();

  if (!srcTerm || !tgtTerm) {
    alert('請填寫原文詞與譯詞。');
    return;
  }
  if (srcLang === tgtLang) {
    alert('來源語言與目標語言不能相同。');
    return;
  }

  const btn = document.getElementById('btnAdd');
  btn.disabled = true;
  btn.textContent = '新增中…';

  try {
    const res = await fetch('/api/glossary', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_lang: srcLang, target_lang: tgtLang,
                             source_term: srcTerm, target_term: tgtTerm }),
    });
    await handleResponse(res);
    // Clear inputs
    document.getElementById('addSrcTerm').value = '';
    document.getElementById('addTgtTerm').value = '';
    await loadGlossary();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`新增失敗：${err.message}`);
    }
  } finally {
    btn.disabled = dbDisabled;
    btn.textContent = '新增';
  }
}

// ── Inline edit ───────────────────────────────────────────────────────────────

function startEdit(id) {
  editingId = id;
  renderTable();
  // Focus first input
  const input = document.getElementById(`edit-src-${id}`);
  if (input) input.focus();
}

function cancelEdit() {
  editingId = null;
  renderTable();
}

async function saveTerm(id) {
  const srcTerm = document.getElementById(`edit-src-${id}`).value.trim();
  const tgtTerm = document.getElementById(`edit-tgt-${id}`).value.trim();

  if (!srcTerm || !tgtTerm) {
    alert('詞條不能為空。');
    return;
  }

  try {
    const res = await fetch(`/api/glossary/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ source_term: srcTerm, target_term: tgtTerm }),
    });
    await handleResponse(res);
    editingId = null;
    await loadGlossary();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`儲存失敗：${err.message}`);
    }
  }
}

// ── Toggle enabled ────────────────────────────────────────────────────────────

async function toggleEnabled(id, currentEnabled) {
  if (dbDisabled) return;

  try {
    const res = await fetch(`/api/glossary/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ enabled: !currentEnabled }),
    });
    await handleResponse(res);
    // Optimistic local update
    const term = terms.find(t => t.id === id);
    if (term) term.enabled = !currentEnabled;
    renderTable();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`操作失敗：${err.message}`);
    }
  }
}

// ── Load default factory terms ────────────────────────────────────────────────

async function loadDefaults() {
  if (dbDisabled) return;

  const btn = document.getElementById('btnLoadDefaults');
  btn.disabled = true;
  btn.textContent = '載入中…';

  let successCount = 0;
  let errorCount   = 0;

  for (const term of DEFAULT_TERMS) {
    try {
      const res = await fetch('/api/glossary', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(term),
      });
      await handleResponse(res);
      successCount++;
    } catch (err) {
      if (err.message === 'db_disabled') {
        break;
      }
      errorCount++;
    }
  }

  btn.textContent = '載入預設工廠術語（9 組）';

  if (!dbDisabled) {
    await loadGlossary();
    if (errorCount > 0) {
      alert(`已載入 ${successCount} 組，${errorCount} 組失敗（可能已存在）。`);
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
