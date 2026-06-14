/**
 * app.js — Frontend UI logic
 * WebSocket connection, feed rendering, mode switching, audio pipeline glue.
 *
 * Depends on: audio.js (AudioPipeline), public/styles.css
 * Protocol:   WS /ws  (see CLAUDE.md / WebSocket 協定 v1)
 */

import { AudioPipeline } from './audio.js';

// ── State ──────────────────────────────────────────────────────────────────
/** @type {'manual'|'auto'} */
let mode = 'manual';
let thresholdPct = 60;
let silenceDurationMs = 2000;
let refinedOn = false;

/** @type {WebSocket|null} */
let ws = null;
let wsConnected = false;
let reconnectTimer = null;
let reconnectDelay = 1000;   // ms, doubles on each failure (max 30 s)

/** @type {AudioPipeline|null} */
let ap = null;
let selectedDeviceId = '';

/** Manual mode: is the user currently holding Speak? */
let isSpeaking = false;
/** AudioPipeline state: 'standby'|'listening'|'ending'|'idle' */
let audioState = 'idle';

/** Feed auto-scroll flag — set false when user scrolls up */
let autoScroll = true;

/**
 * Manual 模式：講完才一次顯示「原文+翻譯」。
 * final 訊息先暫存於此，等對應 translation 到達後一起渲染。
 * @type {Map<string, {msg: object, timer: number}>} itemId → pending final
 */
const pendingFinals = new Map();
/** 等不到翻譯的保底逾時（ms）：先顯示原文，翻譯之後到再補上 */
const PENDING_FINAL_TIMEOUT_MS = 12000;

// ── DOM References ──────────────────────────────────────────────────────────
const feedEl            = /** @type {HTMLElement} */ (document.getElementById('feed'));
const cardsContainer    = /** @type {HTMLElement} */ (document.getElementById('cards-container'));
const scrollHint        = /** @type {HTMLElement} */ (document.getElementById('scroll-hint'));
const speakBtn          = /** @type {HTMLButtonElement} */ (document.getElementById('speak-btn'));
const speakHint         = /** @type {HTMLElement} */ (document.getElementById('speak-hint'));
const thresholdSlider   = /** @type {HTMLInputElement} */ (document.getElementById('threshold-slider'));
const thresholdValEl    = /** @type {HTMLElement} */ (document.getElementById('threshold-val'));
const thresholdMark     = /** @type {HTMLElement} */ (document.getElementById('threshold-mark'));
const thresholdSection  = /** @type {HTMLElement} */ (document.getElementById('threshold-section'));
const calibrateBtn      = /** @type {HTMLButtonElement} */ (document.getElementById('calibrate-btn'));
const silenceSlider     = /** @type {HTMLInputElement} */ (document.getElementById('silence-slider'));
const silenceValEl      = /** @type {HTMLElement} */ (document.getElementById('silence-val'));
const levelBar          = /** @type {HTMLElement} */ (document.getElementById('level-bar'));
const micSelect         = /** @type {HTMLSelectElement} */ (document.getElementById('mic-select'));
const topbarModeEl      = /** @type {HTMLElement} */ (document.getElementById('topbar-mode'));
const topbarThresholdEl = /** @type {HTMLElement} */ (document.getElementById('topbar-threshold'));
const topbarThresholdSep = /** @type {HTMLElement} */ (document.getElementById('topbar-threshold-sep'));
const topbarStatusPill  = /** @type {HTMLElement} */ (document.getElementById('topbar-status-pill'));
const topbarRefinedPill = /** @type {HTMLElement} */ (document.getElementById('topbar-refined-pill'));
const modeAutoEl        = /** @type {HTMLElement} */ (document.getElementById('mode-auto'));
const modeManualEl      = /** @type {HTMLElement} */ (document.getElementById('mode-manual'));
const mkAutoEl          = /** @type {HTMLElement} */ (document.getElementById('mk-auto'));
const mkManualEl        = /** @type {HTMLElement} */ (document.getElementById('mk-manual'));

// ── WebSocket ───────────────────────────────────────────────────────────────
function connect() {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  ws = new WebSocket(url);

  ws.onopen = function() {
    wsConnected = true;
    reconnectDelay = 1000;
    updateTopbar();
    sendSettings();
    if (ap) {
      // Reconnect: hot-swap the WebSocket reference; keep existing mic/AudioContext
      ap.setWs(ws);
    } else {
      // First connection: create the pipeline from scratch
      initAudioPipeline();
    }
  };

  ws.onmessage = function(evt) {
    try {
      const msg = JSON.parse(/** @type {string} */ (evt.data));
      handleServerMessage(msg);
    } catch (e) {
      console.error('[app] WS parse error:', e);
    }
  };

  ws.onclose = function() {
    wsConnected = false;
    updateTopbar();
    scheduleReconnect();
  };

  ws.onerror = function(e) {
    console.error('[app] WS error:', e);
    // onclose will fire next; nothing else needed here
  };
}

/**
 * Send current refined setting to server (Phase 2 WS protocol).
 */
function sendSettings() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'settings', refined: refinedOn }));
  }
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(function() {
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

// ── AudioPipeline ───────────────────────────────────────────────────────────
function initAudioPipeline() {
  ap = new AudioPipeline({
    ws: ws,
    getMode: function() { return mode; },
    getThresholdPct: function() { return thresholdPct; },
    onLevel: function(levelPct) {
      levelBar.style.width = levelPct + '%';
    },
    onStateChange: function(state) {
      audioState = state;
      // If audio pipeline reports stopped, sync manual-speak flag
      if (mode === 'manual' && (state === 'idle' || state === 'standby')) {
        isSpeaking = false;
      }
      updateSpeakButton();
      updateTopbar();
    }
  });

  // Apply persisted silence duration
  ap.setSilenceDuration(silenceDurationMs);

  ap.init(selectedDeviceId || undefined)
    .then(function() {
      return ap.listDevices();
    })
    .then(function(devices) {
      populateMicSelect(devices);
      // 兜底：若 AudioContext 仍是 suspended（init 時無手勢），
      // 等下一次使用者觸碰畫面時再 resume（once 確保只觸發一次）。
      document.addEventListener('pointerdown', function() {
        if (ap) ap.resumeContext();
      }, { once: true });
    })
    .catch(function(err) {
      console.warn('[app] AudioPipeline init/listDevices error:', err);
    });
}

/**
 * @param {Array<{deviceId:string, label:string}>} devices
 */
function populateMicSelect(devices) {
  const current = micSelect.value;
  micSelect.innerHTML = '';
  devices.forEach(function(d) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || ('Microphone (' + d.deviceId.slice(0, 8) + ')');
    if (d.deviceId === current || d.deviceId === selectedDeviceId) {
      opt.selected = true;
    }
    micSelect.appendChild(opt);
  });
  if (!micSelect.value && devices.length > 0) {
    micSelect.value = devices[0].deviceId;
    selectedDeviceId = devices[0].deviceId;
  }
}

// ── Server message dispatch ─────────────────────────────────────────────────
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'status':      handleStatus(msg);      break;
    case 'draft':       handleDraft(msg);        break;
    case 'final':       handleFinal(msg);        break;
    case 'translation': handleTranslation(msg);  break;
    case 'refined':       handleRefined(msg);       break;
    case 'refined_error': handleRefinedError(msg);  break;
    case 'error':         handleServerError(msg);   break;
    default:
      console.warn('[app] Unknown message type:', msg.type);
  }
}

function handleStatus(msg) {
  // Server-reported status (ready / listening / processing / error)
  if (msg.state === 'error') {
    topbarStatusPill.className = 'pill err';
    topbarStatusPill.textContent = msg.message || 'Server Error';
  } else {
    // Let our own audioState + wsConnected drive the topbar
    updateTopbar();
  }
}

function handleServerError(msg) {
  console.error('[app] Server error:', msg.message);
  topbarStatusPill.className = 'pill err';
  topbarStatusPill.textContent = msg.message || 'Error';
}

/**
 * Handle refined message (Phase 2 Route B): append or update the refined
 * translation line and [Refined] badge on the matching card.
 * The card is always already rendered (refined arrives after translation).
 * @param {{itemId:string, text:string}} msg
 */
function handleRefined(msg) {
  const el = cardsContainer.querySelector('[data-item-id="' + msg.itemId + '"]');
  if (!el) return;
  const body = el.querySelector('.card-body');
  if (!body) return;

  // Add or update the .refined paragraph (re-send → update text)
  let refinedEl = body.querySelector('.refined');
  if (refinedEl) {
    refinedEl.textContent = '精準翻譯：' + msg.text;
  } else {
    refinedEl = document.createElement('p');
    refinedEl.className = 'refined';
    refinedEl.textContent = '精準翻譯：' + msg.text;
    // Insert before the first badge, or append if no badge yet
    const firstBadge = body.querySelector('.badge');
    if (firstBadge) {
      body.insertBefore(refinedEl, firstBadge);
    } else {
      body.appendChild(refinedEl);
    }
  }

  // Add [Refined] badge only once
  if (!body.querySelector('.b-rf')) {
    const badge = document.createElement('span');
    badge.className = 'badge b-rf';
    badge.textContent = 'Refined';
    body.appendChild(badge);
  }

  scrollToBottomIfNeeded();
}

/**
 * Handle refined_error message: append a small error notice to the matching card.
 * Idempotent — will not add a second line if one already exists.
 * @param {{itemId:string, message:string}} msg
 */
function handleRefinedError(msg) {
  const el = cardsContainer.querySelector('[data-item-id="' + msg.itemId + '"]');
  if (!el) return;
  const body = el.querySelector('.card-body');
  if (!body) return;

  // 防重複：同一張卡片只顯示一行錯誤提示
  if (body.querySelector('.refined-error')) return;

  const errEl = document.createElement('p');
  errEl.className = 'refined-error';
  errEl.textContent = '精準翻譯失敗 Refined translation failed';
  body.appendChild(errEl);
}

// ── Card Management ─────────────────────────────────────────────────────────

/**
 * Retrieve existing card or create a new draft card.
 * @param {string} itemId
 * @returns {HTMLElement}
 */
function getOrCreateCard(itemId) {
  let el = cardsContainer.querySelector('[data-item-id="' + itemId + '"]');
  if (!el) {
    el = document.createElement('div');
    el.className = 'card draft';
    el.dataset.itemId = itemId;

    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = '--:--';

    const body = document.createElement('div');
    body.className = 'card-body';

    const src = document.createElement('p');
    src.className = 'src';

    const badge = document.createElement('span');
    badge.className = 'badge b-dr';
    badge.textContent = 'Draft';

    body.appendChild(src);
    body.appendChild(badge);
    el.appendChild(ts);
    el.appendChild(body);
    cardsContainer.appendChild(el);
  }
  return el;
}

/**
 * Handle draft message: create/update a draft card.
 * @param {{itemId:string, text:string}} msg
 */
function handleDraft(msg) {
  // Manual 模式：講話過程不顯示即時 Draft（PRD §7.8.1 — 講完才處理）
  if (mode === 'manual') return;
  const el = getOrCreateCard(msg.itemId);
  const srcEl = el.querySelector('.src');
  if (srcEl) {
    srcEl.textContent = msg.text;
  }
  scrollToBottomIfNeeded();
}

/**
 * Handle final message: promote draft to final card.
 * @param {{itemId:string, text:string, lang:'zh'|'en', ts:string}} msg
 */
function handleFinal(msg) {
  // Manual 模式：暫存 final，等翻譯到達後與原文同時顯示
  if (mode === 'manual') {
    const timer = window.setTimeout(function() {
      // 翻譯逾時保底：先顯示原文（翻譯之後到達會走 renderTranslation 補上）
      const pending = pendingFinals.get(msg.itemId);
      if (pending) {
        pendingFinals.delete(msg.itemId);
        renderFinal(pending.msg);
      }
    }, PENDING_FINAL_TIMEOUT_MS);
    pendingFinals.set(msg.itemId, { msg: msg, timer: timer });
    if (!isSpeaking) speakHint.textContent = '處理中… Processing';
    return;
  }
  renderFinal(msg);
}

/**
 * 實際渲染 final 卡片（原 handleFinal 主體）。
 * @param {{itemId:string, text:string, lang:'zh'|'en', ts:string}} msg
 */
function renderFinal(msg) {
  const el = getOrCreateCard(msg.itemId);
  el.classList.remove('draft');
  el.dataset.lang = msg.lang;

  const tsEl = el.querySelector('.ts');
  if (tsEl) {
    tsEl.textContent = msg.ts;
  }

  const body = el.querySelector('.card-body');
  if (!body) return;

  // Rebuild card body
  body.innerHTML = '';

  const src = document.createElement('p');
  src.className = 'src';
  src.textContent = msg.text;
  body.appendChild(src);

  // Translation placeholder (pending)
  const tr = document.createElement('p');
  tr.className = 'tr tr-pending';
  tr.textContent = '翻譯中…';
  body.appendChild(tr);

  // Finalized flash animation
  el.classList.remove('just-finalized');
  // Force reflow so animation restarts
  void el.offsetWidth;
  el.classList.add('just-finalized');

  scrollToBottomIfNeeded();
}

/**
 * Handle translation message: fill in translation and add RT badge.
 * @param {{itemId:string, text:string}} msg
 */
function handleTranslation(msg) {
  // Manual 模式暫存中的 final：原文+翻譯一次同時渲染
  const pending = pendingFinals.get(msg.itemId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingFinals.delete(msg.itemId);
    renderFinal(pending.msg);
    if (mode === 'manual' && !isSpeaking) {
      speakHint.textContent = 'Click Speak to start speaking.';
    }
  }
  renderTranslation(msg);
}

/**
 * 實際填入翻譯（原 handleTranslation 主體）。
 * @param {{itemId:string, text:string}} msg
 */
function renderTranslation(msg) {
  const el = cardsContainer.querySelector('[data-item-id="' + msg.itemId + '"]');
  if (!el) return;

  const body = el.querySelector('.card-body');
  if (!body) return;

  let trEl = body.querySelector('.tr');
  if (trEl) {
    trEl.textContent = msg.text;
    trEl.classList.remove('tr-pending');
  } else {
    trEl = document.createElement('p');
    trEl.className = 'tr';
    trEl.textContent = msg.text;
    body.appendChild(trEl);
  }

  // Add [RT] badge if not present
  if (!body.querySelector('.b-rt')) {
    const badge = document.createElement('span');
    badge.className = 'badge b-rt';
    badge.textContent = 'RT';
    body.appendChild(badge);
  }

  scrollToBottomIfNeeded();
}

// ── Feed scroll management ──────────────────────────────────────────────────
feedEl.addEventListener('scroll', function() {
  const distanceFromBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight;
  if (distanceFromBottom < 50) {
    autoScroll = true;
    scrollHint.hidden = true;
  } else {
    autoScroll = false;
  }
});

scrollHint.addEventListener('click', jumpToBottom);
scrollHint.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    jumpToBottom();
  }
});

function jumpToBottom() {
  autoScroll = true;
  scrollHint.hidden = true;
  feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: 'smooth' });
}

function scrollToBottomIfNeeded() {
  if (autoScroll) {
    feedEl.scrollTop = feedEl.scrollHeight;
  } else {
    scrollHint.hidden = false;
  }
}

// ── Mode switching ──────────────────────────────────────────────────────────
[modeAutoEl, modeManualEl].forEach(function(el) {
  el.addEventListener('click', function() {
    setMode(el.dataset.mode);
  });
  el.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setMode(el.dataset.mode);
    }
  });
});

/**
 * @param {string} newMode  'manual' | 'auto'
 */
function setMode(newMode) {
  if (mode === newMode) return;
  // Stop any active manual speaking when switching
  if (isSpeaking && ap) {
    ap.manualStop();
    isSpeaking = false;
  }
  mode = newMode;
  localStorage.setItem('sttMode', mode);
  if (ap) ap.setMode(mode);
  updateModeUI();
  updateTopbar();
}

function updateModeUI() {
  const isAuto = mode === 'auto';

  // Mode radio buttons
  modeAutoEl.classList.toggle('on',  isAuto);
  modeAutoEl.classList.toggle('off', !isAuto);
  modeAutoEl.setAttribute('aria-checked', String(isAuto));
  mkAutoEl.classList.toggle('sel', isAuto);

  modeManualEl.classList.toggle('on',  !isAuto);
  modeManualEl.classList.toggle('off', isAuto);
  modeManualEl.setAttribute('aria-checked', String(!isAuto));
  mkManualEl.classList.toggle('sel', !isAuto);

  // Threshold section — greyed and disabled in Manual mode
  thresholdSection.classList.toggle('grey', !isAuto);
  thresholdSlider.disabled = !isAuto;
  silenceSlider.disabled = !isAuto;
  if (isAuto) {
    thresholdValEl.textContent = thresholdPct + '%';
    thresholdValEl.style.fontWeight = '600';
    silenceValEl.textContent = (silenceDurationMs / 1000).toFixed(1) + 's';
    silenceValEl.style.fontWeight = '600';
  } else {
    thresholdValEl.textContent = '—';
    thresholdValEl.style.fontWeight = '';
    silenceValEl.textContent = '—';
    silenceValEl.style.fontWeight = '';
  }

  // Speak button + hint
  updateSpeakButton();
  speakHint.hidden = isAuto;
  if (!isAuto && !isSpeaking) {
    speakHint.textContent = 'Click Speak to start speaking.';
  }
}

function updateSpeakButton() {
  const isAuto = mode === 'auto';
  if (isAuto) {
    speakBtn.disabled = true;
    speakBtn.className = 'speak dis';
    speakBtn.textContent = '🎙 Speak';
  } else if (isSpeaking) {
    speakBtn.disabled = false;
    speakBtn.className = 'speak speaking';
    speakBtn.textContent = '⏹ Stop';
  } else {
    speakBtn.disabled = false;
    speakBtn.className = 'speak on';
    speakBtn.textContent = '🎙 Speak';
  }
}

// ── Speak button ────────────────────────────────────────────────────────────
speakBtn.addEventListener('click', function() {
  if (mode !== 'manual') return;
  if (!ap || !wsConnected) {
    speakHint.textContent = '尚未連線，請稍候… Not connected yet.';
    return;
  }
  if (isSpeaking) {
    ap.manualStop();
    isSpeaking = false;
    speakHint.textContent = 'Click Speak to start speaking.';
  } else {
    ap.manualStart();
    isSpeaking = true;
    speakHint.textContent = '● 錄音中… Recording';
  }
  updateSpeakButton();
  updateTopbar();
});

// ── Threshold slider ────────────────────────────────────────────────────────
thresholdSlider.addEventListener('input', function() {
  thresholdPct = Number(thresholdSlider.value);
  thresholdValEl.textContent = thresholdPct + '%';
  // Threshold mark position = pct% from left
  thresholdMark.style.left = thresholdPct + '%';
  localStorage.setItem('sttThresholdPct', String(thresholdPct));
  if (ap) ap.setThreshold(thresholdPct);
  updateTopbar();
});

// ── Calibrate button ────────────────────────────────────────────────────────
calibrateBtn.addEventListener('click', async function() {
  if (mode !== 'auto') return;            // only meaningful in Auto mode
  if (!ap) return;

  // Disable button and show status while sampling
  calibrateBtn.textContent = '校準中…';
  calibrateBtn.disabled = true;
  const prevHint = speakHint.textContent;
  speakHint.hidden = false;
  speakHint.textContent = '校準中,請保持安靜… Calibrating, please stay quiet…';

  try {
    const pct = await ap.calibrate();

    // Apply result through the existing threshold path
    thresholdPct = Math.round(pct);
    thresholdSlider.value = String(thresholdPct);
    thresholdValEl.textContent = thresholdPct + '%';
    thresholdValEl.style.fontWeight = '600';
    thresholdMark.style.left = thresholdPct + '%';
    localStorage.setItem('sttThresholdPct', String(thresholdPct));
    // ap.setThreshold() was already called inside calibrate(); no need to repeat.
    updateTopbar();
  } finally {
    calibrateBtn.textContent = '校準 Calibrate';
    calibrateBtn.disabled = false;
    // Restore hint state
    speakHint.hidden = (mode === 'auto');
    if (mode !== 'auto') speakHint.textContent = prevHint;
  }
});

// ── Silence duration slider ──────────────────────────────────────────────────
silenceSlider.addEventListener('input', function() {
  silenceDurationMs = Number(silenceSlider.value);
  silenceValEl.textContent = (silenceDurationMs / 1000).toFixed(1) + 's';
  localStorage.setItem('sttSilenceMs', String(silenceDurationMs));
  if (ap) ap.setSilenceDuration(silenceDurationMs);
});

// ── Microphone selector ─────────────────────────────────────────────────────
micSelect.addEventListener('change', function() {
  selectedDeviceId = micSelect.value;
  if (ap && wsConnected) {
    ap.init(selectedDeviceId).catch(function(err) {
      console.error('[app] mic reinit failed:', err);
    });
  }
});

// ── Refined translation toggle ──────────────────────────────────────────────
topbarRefinedPill.addEventListener('click', toggleRefined);
topbarRefinedPill.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleRefined();
  }
});

function toggleRefined() {
  refinedOn = !refinedOn;
  localStorage.setItem('sttRefinedOn', String(refinedOn));
  updateTopbar();
  sendSettings();
}

// ── Topbar rendering ────────────────────────────────────────────────────────
function updateTopbar() {
  const isAuto = mode === 'auto';

  // Mode label
  topbarModeEl.textContent = isAuto ? 'Audio: Always On' : 'Audio: Manual';

  // Threshold (Auto only)
  topbarThresholdEl.hidden   = !isAuto;
  topbarThresholdSep.hidden  = !isAuto;
  if (isAuto) {
    topbarThresholdEl.textContent = 'Threshold: ' + thresholdPct + '%';
  }

  // Status pill
  if (!wsConnected) {
    topbarStatusPill.className = 'pill warn';
    topbarStatusPill.textContent = '重連中… Reconnecting';
  } else if (isAuto) {
    if (audioState === 'listening') {
      topbarStatusPill.className = 'pill info';
      topbarStatusPill.textContent = '● Listening';
    } else if (audioState === 'ending') {
      topbarStatusPill.className = 'pill ok';
      topbarStatusPill.textContent = '● Ending';
    } else {
      // standby or idle
      topbarStatusPill.className = 'pill ok';
      topbarStatusPill.innerHTML = '<span class="dot"></span>正常 Normal';
    }
  } else {
    // Manual mode
    if (isSpeaking) {
      topbarStatusPill.className = 'pill info';
      topbarStatusPill.textContent = 'Status: Listening';
    } else {
      topbarStatusPill.className = 'pill info';
      topbarStatusPill.textContent = 'Status: Ready';
    }
  }

  // Refined pill
  if (refinedOn) {
    topbarRefinedPill.className = 'pill info topbar-refined';
    topbarRefinedPill.textContent = '精準翻譯 ON';
  } else {
    topbarRefinedPill.className = 'pill topbar-refined';
    topbarRefinedPill.textContent = '精準翻譯 OFF';
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

// Restore persisted audio settings from localStorage
(function() {
  // Silence duration (existing pattern)
  const storedSilence = localStorage.getItem('sttSilenceMs');
  if (storedSilence !== null) {
    const parsed = Number(storedSilence);
    if (!isNaN(parsed) && parsed >= 300 && parsed <= 5000) {
      silenceDurationMs = parsed;
    }
  }
  silenceSlider.value = String(silenceDurationMs);

  // Threshold %
  const storedThreshold = localStorage.getItem('sttThresholdPct');
  if (storedThreshold !== null) {
    const parsed = Number(storedThreshold);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
      thresholdPct = parsed;
    }
  }
  thresholdSlider.value = String(thresholdPct);
  thresholdMark.style.left = thresholdPct + '%';

  // Mode — set variable directly; AP not created yet, updateModeUI() applies UI
  const storedMode = localStorage.getItem('sttMode');
  if (storedMode === 'auto' || storedMode === 'manual') {
    mode = storedMode;
  }

  // Refined ON/OFF
  const storedRefined = localStorage.getItem('sttRefinedOn');
  if (storedRefined !== null) {
    refinedOn = storedRefined === 'true';
  }
})();

updateModeUI();
updateTopbar();
connect();
