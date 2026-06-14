// lang-settings.js — Language detection threshold settings page

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let dbDisabled = false;
const DEFAULT_THRESHOLD = 0.15; // D-017 default

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('cjk-slider');
  slider.addEventListener('input', () => {
    document.getElementById('cjk-val').textContent = (slider.value / 100).toFixed(2);
  });

  loadThreshold();
});

// ── DB error banner ───────────────────────────────────────────────────────────

/**
 * Show or hide the DB error banner and disable/enable save button.
 * @param {boolean} show
 */
function setDbError(show) {
  dbDisabled = show;
  const banner = document.getElementById('dbError');
  banner.style.display = show ? 'block' : 'none';

  const btn = document.getElementById('btnSave');
  if (btn) btn.disabled = show;
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

// ── Load threshold ────────────────────────────────────────────────────────────

async function loadThreshold() {
  try {
    const res  = await fetch('/api/lang-thresholds');
    const data = await handleResponse(res);
    setDbError(false);

    // Find the zh/en row
    const row = Array.isArray(data)
      ? data.find(r => r.source_lang === 'zh' && r.target_lang === 'en')
      : null;

    const threshold = row ? row.threshold : DEFAULT_THRESHOLD;
    applyThreshold(threshold);
  } catch (err) {
    if (err.message === 'db_disabled') {
      // Show default value; save button already disabled by setDbError
      applyThreshold(DEFAULT_THRESHOLD);
    } else {
      console.error('Failed to load lang threshold:', err);
      applyThreshold(DEFAULT_THRESHOLD);
    }
  }
}

/**
 * Set the slider and display to the given threshold value (0.0–1.0).
 * @param {number} threshold
 */
function applyThreshold(threshold) {
  const slider = document.getElementById('cjk-slider');
  const valEl  = document.getElementById('cjk-val');
  const clamped = Math.max(0, Math.min(1, threshold));
  slider.value   = Math.round(clamped * 100);
  valEl.textContent = clamped.toFixed(2);
}

// ── Save threshold ────────────────────────────────────────────────────────────

async function saveThreshold() {
  if (dbDisabled) return;

  const slider    = document.getElementById('cjk-slider');
  const threshold = parseFloat((slider.value / 100).toFixed(4));

  const btn      = document.getElementById('btnSave');
  const feedback = document.getElementById('saveFeedback');
  btn.disabled     = true;
  btn.textContent  = '儲存中…';

  try {
    const res = await fetch('/api/lang-thresholds', {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ source_lang: 'zh', target_lang: 'en', threshold }),
    });
    const data = await handleResponse(res);

    // Update display to reflect server-confirmed value
    if (data && typeof data.threshold === 'number') {
      applyThreshold(data.threshold);
    }

    // Show brief "saved" feedback
    feedback.classList.add('show');
    setTimeout(() => feedback.classList.remove('show'), 2000);
  } catch (err) {
    if (err.message !== 'db_disabled') {
      alert(`儲存失敗：${err.message}`);
    }
  } finally {
    btn.disabled    = dbDisabled;
    btn.textContent = '儲存';
  }
}
