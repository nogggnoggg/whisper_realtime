// refine-prompts.js — Refine prompt management page logic

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let prompts    = [];   // Array of prompt objects from server
let editingId  = null; // id of row currently in inline-edit mode
let dbDisabled = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadPrompts();
});

// ── DB error banner ───────────────────────────────────────────────────────────

/**
 * Show or hide the DB error banner and disable/enable add controls.
 * @param {boolean} show
 */
function setDbError(show) {
  dbDisabled = show;
  const banner = document.getElementById('dbError');
  banner.style.display = show ? 'block' : 'none';

  const addBtn = document.getElementById('btnAdd');
  if (addBtn) addBtn.disabled = show;
  ['addName', 'addPromptText'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = show;
  });
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

// ── Load prompts ──────────────────────────────────────────────────────────────

async function loadPrompts() {
  const tbody = document.getElementById('promptsTbody');
  tbody.innerHTML = '<tr class="loading-row"><td colspan="4">載入中…</td></tr>';

  try {
    const res  = await fetch('/api/refine-prompts');
    const data = await handleResponse(res);
    setDbError(false);
    prompts = Array.isArray(data) ? data : [];
    renderTable();
  } catch (err) {
    if (err.message === 'db_disabled') {
      prompts = [];
      renderTable();
    } else {
      tbody.innerHTML = `<tr class="loading-row"><td colspan="4" style="color:var(--err-tx)">載入失敗：${escHtml(err.message)}</td></tr>`;
    }
  }
}

// ── Render table ──────────────────────────────────────────────────────────────

function renderTable() {
  const tbody = document.getElementById('promptsTbody');
  const empty = document.getElementById('emptyState');

  if (prompts.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = prompts.map(p => buildRow(p)).join('');
}

/**
 * Build a single <tr> for a prompt.
 * @param {{ id: number, name: string, prompt_text: string, is_active: boolean }} p
 */
function buildRow(p) {
  const isEditing   = editingId === p.id;
  const inactiveCls = p.is_active ? '' : ' row-inactive';

  if (isEditing) {
    return `
      <tr data-id="${p.id}">
        <td><input class="inline-input" id="edit-name-${p.id}" type="text" value="${escAttr(p.name)}" /></td>
        <td><textarea class="inline-textarea" id="edit-text-${p.id}">${escHtml(p.prompt_text)}</textarea></td>
        <td>
          <span class="status-pill ${p.is_active ? 'active' : 'inactive'}">
            ${p.is_active ? '✓ 啟用中' : '未啟用'}
          </span>
        </td>
        <td class="td-actions">
          <button class="btn-sm btn-save"   onclick="savePrompt(${p.id})">儲存</button>
          <button class="btn-sm btn-cancel" onclick="cancelEdit()">取消</button>
        </td>
      </tr>`;
  }

  const preview = p.prompt_text.length > 60
    ? escHtml(p.prompt_text.slice(0, 60)) + '…'
    : escHtml(p.prompt_text);

  return `
    <tr data-id="${p.id}" class="${inactiveCls.trim()}">
      <td>${escHtml(p.name)}</td>
      <td><span class="preview-text">${preview}</span></td>
      <td>
        <span class="status-pill ${p.is_active ? 'active' : 'inactive'}">
          ${p.is_active ? '✓ 啟用中' : '未啟用'}
        </span>
      </td>
      <td class="td-actions">
        ${!p.is_active ? `<button class="btn-sm btn-activate" onclick="setActive(${p.id})" ${dbDisabled ? 'disabled' : ''}>設為啟用</button>` : ''}
        <button class="btn-sm" onclick="startEdit(${p.id})" ${dbDisabled ? 'disabled' : ''}>編輯</button>
        <button class="btn-sm" style="color:var(--err-tx)" onclick="deletePrompt(${p.id})" ${dbDisabled ? 'disabled' : ''}>刪除</button>
      </td>
    </tr>`;
}

// ── Add prompt ────────────────────────────────────────────────────────────────

async function addPrompt() {
  if (dbDisabled) return;

  const name       = document.getElementById('addName').value.trim();
  const promptText = document.getElementById('addPromptText').value.trim();

  if (!name || !promptText) {
    alert('請填寫指令名稱與指令內容。');
    return;
  }

  const btn = document.getElementById('btnAdd');
  btn.disabled = true;
  btn.textContent = '新增中…';

  try {
    const res = await fetch('/api/refine-prompts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, prompt_text: promptText }),
    });
    await handleResponse(res);
    document.getElementById('addName').value       = '';
    document.getElementById('addPromptText').value = '';
    await loadPrompts();
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
  const input = document.getElementById(`edit-name-${id}`);
  if (input) input.focus();
}

function cancelEdit() {
  editingId = null;
  renderTable();
}

async function savePrompt(id) {
  const name       = document.getElementById(`edit-name-${id}`).value.trim();
  const promptText = document.getElementById(`edit-text-${id}`).value.trim();

  if (!name || !promptText) {
    alert('名稱與指令內容不能為空。');
    return;
  }

  try {
    const res = await fetch(`/api/refine-prompts/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, prompt_text: promptText }),
    });
    await handleResponse(res);
    editingId = null;
    await loadPrompts();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`儲存失敗：${err.message}`);
    }
  }
}

// ── Set active ────────────────────────────────────────────────────────────────

async function setActive(id) {
  if (dbDisabled) return;

  try {
    const res = await fetch(`/api/refine-prompts/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ is_active: true }),
    });
    await handleResponse(res);
    // Server clears other active flags; reload to reflect
    await loadPrompts();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`操作失敗：${err.message}`);
    }
  }
}

// ── Delete prompt ─────────────────────────────────────────────────────────────

async function deletePrompt(id) {
  if (dbDisabled) return;

  const prompt = prompts.find(p => p.id === id);
  const label  = prompt ? `「${prompt.name}」` : '';
  if (!confirm(`確定刪除精譯指令 ${label}？此操作無法復原。`)) return;

  try {
    const res = await fetch(`/api/refine-prompts/${id}`, { method: 'DELETE' });
    if (res.status === 503) {
      setDbError(true);
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body}`);
    }
    await loadPrompts();
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`刪除失敗：${err.message}`);
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
