/**
 * audio.js — AudioPipeline
 *
 * Handles microphone capture, PCM16 streaming, level metering, and
 * auto/manual activation state machine.
 *
 * Usage (called by frontend-ui agent / app.js):
 *
 *   const pipeline = new AudioPipeline({ ws, getMode, getThresholdPct, onLevel, onStateChange });
 *   await pipeline.init(deviceId?);
 *   pipeline.setMode("manual" | "auto");
 *   pipeline.setThreshold(pct);   // 0–100
 *   pipeline.manualStart();
 *   pipeline.manualStop();
 *   const devices = await pipeline.listDevices();
 *
 * States reported via onStateChange(state):
 *   "idle"       — pipeline not yet initialised, or WS disconnected
 *   "standby"    — ready, not streaming (auto mode waiting for threshold)
 *   "listening"  — actively streaming audio
 *   "ending"     — silence detected, draining before stop
 *
 * WebSocket messages sent:
 *   {"type":"audio.start","mode":"manual"|"auto"}  — before first binary frame
 *   <ArrayBuffer PCM16LE 24kHz>                    — audio data
 *   {"type":"audio.stop"}                          — end of utterance
 */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_RATE = 24000;
const SILENCE_DURATION_MS_DEFAULT = 2000; // default hold-off before ending (ms)
const MAX_UTTERANCE_MS = 20_000;     // hard cutoff
const COOLDOWN_MS = 300;             // minimum gap between auto utterances
const PCM_FLUSH_INTERVAL_MS = 20;   // how often worklet flushes PCM (informational)

// Pre-roll buffer: keeps the last ~400 ms of PCM so that sentence-initial
// words are not clipped when Auto mode threshold is crossed.
const PREROLL_TARGET_MS = 400;      // desired amount of audio to prepend
const PREROLL_MAX_MS   = 500;       // ring-buffer ceiling (older chunks dropped)

// dB ↔ % conversion (linear mapping: dB = -50 + pct * 0.5)
function pctToDb(pct) {
  return -50 + pct * 0.5;
}
function dbToPct(db) {
  return (db + 50) / 0.5;
}
function rmsToDb(rms) {
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms);
}

// ---------------------------------------------------------------------------
// AudioPipeline
// ---------------------------------------------------------------------------

export class AudioPipeline {
  /**
   * @param {object} opts
   * @param {WebSocket|null} opts.ws           — live WebSocket instance (may be null initially)
   * @param {function():string} opts.getMode   — returns current mode "manual"|"auto"
   * @param {function():number} opts.getThresholdPct — returns threshold 0–100
   * @param {function(number):void} opts.onLevel      — called with level 0–100
   * @param {function(string):void} opts.onStateChange — called with state string
   */
  constructor({ ws, getMode, getThresholdPct, onLevel, onStateChange }) {
    this._ws = ws;
    this._getMode = getMode || (() => 'manual');
    this._getThresholdPct = getThresholdPct || (() => 60);
    this._onLevel = onLevel || (() => {});
    this._onStateChange = onStateChange || (() => {});

    // Runtime state
    this._state = 'idle';           // idle | standby | listening | ending
    this._mode = 'manual';          // manual | auto
    this._thresholdPct = 60;        // 0–100
    this._silenceDurationMs = SILENCE_DURATION_MS_DEFAULT; // adjustable hold-off

    // AudioContext / Worklet
    this._audioCtx = null;
    this._workletNode = null;
    this._sourceNode = null;
    this._stream = null;

    // Auto mode timing
    this._silenceTimer = null;      // setTimeout handle for silence hold-off
    this._maxUtteranceTimer = null; // setTimeout handle for 20 s cutoff
    this._cooldownUntil = 0;        // timestamp: don't start new utterance before this

    // Whether we are currently streaming (have sent audio.start, not yet audio.stop)
    this._streaming = false;

    // Pre-roll ring buffer (auto mode only).
    // Holds Int16Array chunks covering the last PREROLL_MAX_MS of PCM.
    // Flushed to WS at the start of each auto-mode utterance.
    this._prerollBuffer = [];   // Array<Int16Array>
    this._prerollMs     = 0;    // cumulative duration of stored chunks (ms)
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Initialise microphone and AudioWorklet.
   * Must be called once (or again after teardown) before streaming.
   * @param {string} [deviceId] — optional MediaDevices deviceId
   */
  async init(deviceId) {
    await this._teardown(); // clean up any previous session

    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
      video: false,
    };

    this._stream = await navigator.mediaDevices.getUserMedia(constraints);

    this._audioCtx = new AudioContext({ sampleRate: 48000 });

    // Load worklet module (path relative to origin root)
    await this._audioCtx.audioWorklet.addModule('/pcm-worklet.js');

    this._workletNode = new AudioWorkletNode(this._audioCtx, 'pcm-processor', {
      processorOptions: {
        inputSampleRate: this._audioCtx.sampleRate,
        targetSampleRate: TARGET_SAMPLE_RATE,
      },
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });

    this._workletNode.port.onmessage = (evt) => {
      const { type } = evt.data;
      if (type === 'level') {
        this._handleLevel(evt.data.rms);
      } else if (type === 'pcm') {
        this._handlePcm(evt.data.buffer);
      }
    };

    this._sourceNode = this._audioCtx.createMediaStreamSource(this._stream);
    this._sourceNode.connect(this._workletNode);

    this._setState('standby');
  }

  /**
   * Switch between "manual" and "auto" modes.
   * Switching stops any active utterance first.
   * @param {"manual"|"auto"} mode
   */
  setMode(mode) {
    if (mode !== 'manual' && mode !== 'auto') return;
    if (this._mode === mode) return;
    this._stopUtterance();
    this._mode = mode;
    // Discard stale pre-roll data accumulated under the previous mode
    this._prerollBuffer = [];
    this._prerollMs     = 0;
    if (this._state !== 'idle') {
      this._setState('standby');
    }
  }

  /**
   * Update activation threshold.
   * @param {number} pct — 0 to 100
   */
  setThreshold(pct) {
    this._thresholdPct = Math.max(0, Math.min(100, pct));
  }

  /**
   * Update the silence hold-off duration used by the auto-mode state machine.
   * Clamped to [300, 5000] ms.
   * @param {number} ms
   */
  setSilenceDuration(ms) {
    this._silenceDurationMs = Math.max(300, Math.min(5000, ms));
  }

  /**
   * Manual mode: begin utterance.
   * No-op if not in manual mode or already streaming.
   */
  manualStart() {
    if (this._mode !== 'manual') return;
    if (this._streaming) return;
    if (this._state === 'idle') return;
    this._startUtterance('manual');
  }

  /**
   * Manual mode: end utterance.
   * No-op if not currently streaming.
   */
  manualStop() {
    if (!this._streaming) return;
    this._stopUtterance();
    if (this._state !== 'idle') {
      this._setState('standby');
    }
  }

  /**
   * List available audio input devices.
   * @returns {Promise<MediaDeviceInfo[]>}
   */
  async listDevices() {
    // getUserMedia must have been called first for labels to be available
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  /**
   * Update the WebSocket reference (call when WS reconnects).
   * @param {WebSocket|null} ws
   */
  setWs(ws) {
    this._ws = ws;
  }

  // -------------------------------------------------------------------------
  // Private helpers — state
  // -------------------------------------------------------------------------

  _setState(newState) {
    if (this._state === newState) return;
    this._state = newState;
    this._onStateChange(newState);
  }

  // -------------------------------------------------------------------------
  // Private helpers — utterance lifecycle
  // -------------------------------------------------------------------------

  _startUtterance(mode) {
    if (this._streaming) return;
    if (!this._wsReady()) {
      this._setState('idle');
      return;
    }
    this._streaming = true;
    this._wsSend(JSON.stringify({ type: 'audio.start', mode }));
    this._setState('listening');

    // Pre-roll (Auto mode only): send buffered audio BEFORE the first live
    // chunk so that sentence-initial words are not clipped.
    // Order of frames on the wire:
    //   audio.start  →  [pre-roll chunk 0 … chunk N-1]  →  live chunks …
    if (mode === 'auto') {
      this._flushPrerollToWs();
    }

    // 20-second hard cutoff
    this._maxUtteranceTimer = setTimeout(() => {
      if (this._streaming) {
        this._stopUtterance();
        if (this._state !== 'idle') this._setState('standby');
      }
    }, MAX_UTTERANCE_MS);
  }

  _stopUtterance() {
    this._clearSilenceTimer();
    this._clearMaxUtteranceTimer();
    if (!this._streaming) return;
    this._streaming = false;
    this._wsSend(JSON.stringify({ type: 'audio.stop' }));
    // Record cooldown end time
    this._cooldownUntil = Date.now() + COOLDOWN_MS;
  }

  _clearSilenceTimer() {
    if (this._silenceTimer !== null) {
      clearTimeout(this._silenceTimer);
      this._silenceTimer = null;
    }
  }

  _clearMaxUtteranceTimer() {
    if (this._maxUtteranceTimer !== null) {
      clearTimeout(this._maxUtteranceTimer);
      this._maxUtteranceTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers — level handling
  // -------------------------------------------------------------------------

  _handleLevel(rms) {
    // Convert RMS to dBFS
    const db = rmsToDb(rms);

    // Clamp dB to [-50, 0] then convert to 0–100 %
    const clampedDb = Math.max(-50, Math.min(0, db));
    const levelPct = dbToPct(clampedDb);
    this._onLevel(levelPct);

    if (this._mode !== 'auto') return;
    if (this._state === 'idle') return;

    const thresholdDb = pctToDb(this._getThresholdPct());

    if (!this._streaming) {
      // Standby: check if level crosses threshold
      if (db >= thresholdDb && Date.now() >= this._cooldownUntil) {
        this._clearSilenceTimer();
        this._startUtterance('auto');
      }
    } else {
      // Listening or Ending: check silence
      if (db < thresholdDb) {
        // Below threshold — start or maintain silence timer
        if (this._silenceTimer === null) {
          this._setState('ending');
          this._silenceTimer = setTimeout(() => {
            this._silenceTimer = null;
            if (this._streaming) {
              this._stopUtterance();
              if (this._state !== 'idle') this._setState('standby');
            }
          }, this._silenceDurationMs);
        }
      } else {
        // Above threshold again — cancel silence timer
        if (this._silenceTimer !== null) {
          this._clearSilenceTimer();
          this._setState('listening');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers — PCM streaming
  // -------------------------------------------------------------------------

  _handlePcm(int16Array) {
    // Always maintain the pre-roll ring buffer (auto mode only; no-op for
    // manual mode — see _addToPreroll).  This runs whether or not we are
    // currently streaming so that the ~400 ms window is ready on the next
    // threshold trigger, including during cooldown periods.
    this._addToPreroll(int16Array);

    if (!this._streaming) return;
    if (!this._wsReady()) {
      // WS dropped mid-utterance — abort
      this._stopUtterance();
      this._setState('idle');
      return;
    }
    // Send raw ArrayBuffer as binary WebSocket frame
    this._wsSend(int16Array.buffer);
  }

  // -------------------------------------------------------------------------
  // Private helpers — pre-roll ring buffer
  // -------------------------------------------------------------------------

  /**
   * Append a PCM chunk to the pre-roll ring buffer (auto mode only).
   * Trims the oldest chunks when the buffer exceeds PREROLL_MAX_MS.
   * Called on EVERY incoming PCM chunk regardless of streaming state.
   *
   * @param {Int16Array} chunk — resampled 24 kHz PCM16 chunk from the worklet
   */
  _addToPreroll(chunk) {
    // Pre-roll is only needed for auto mode; skip entirely for manual mode.
    if (this._mode !== 'auto') return;

    const chunkMs = (chunk.length / TARGET_SAMPLE_RATE) * 1000;
    this._prerollBuffer.push(chunk);
    this._prerollMs += chunkMs;

    // Evict oldest chunks until we are within the ceiling.
    // Keep at least one chunk so the buffer is never left empty after a push.
    while (this._prerollMs > PREROLL_MAX_MS && this._prerollBuffer.length > 1) {
      const removed = this._prerollBuffer.shift();
      this._prerollMs -= (removed.length / TARGET_SAMPLE_RATE) * 1000;
    }
  }

  /**
   * Send every chunk currently in the pre-roll buffer to the WebSocket
   * (oldest first), then clear the buffer.
   *
   * Called by _startUtterance immediately after audio.start is sent so that
   * pre-roll frames arrive at the server before any live frames.
   */
  _flushPrerollToWs() {
    for (const chunk of this._prerollBuffer) {
      // WebSocket.send() copies the ArrayBuffer — the stored reference stays valid.
      this._wsSend(chunk.buffer);
    }
    this._prerollBuffer = [];
    this._prerollMs     = 0;
  }

  // -------------------------------------------------------------------------
  // Private helpers — WebSocket
  // -------------------------------------------------------------------------

  _wsReady() {
    return this._ws !== null && this._ws !== undefined && this._ws.readyState === 1; // WebSocket.OPEN === 1
  }

  _wsSend(data) {
    if (!this._wsReady()) return;
    try {
      this._ws.send(data);
    } catch (_) {
      // Silently discard on send error
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers — teardown
  // -------------------------------------------------------------------------

  async _teardown() {
    this._stopUtterance();
    this._clearSilenceTimer();
    this._clearMaxUtteranceTimer();

    if (this._sourceNode) {
      try { this._sourceNode.disconnect(); } catch (_) {}
      this._sourceNode = null;
    }
    if (this._workletNode) {
      try { this._workletNode.disconnect(); } catch (_) {}
      this._workletNode = null;
    }
    if (this._audioCtx) {
      try { await this._audioCtx.close(); } catch (_) {}
      this._audioCtx = null;
    }
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    this._streaming = false;
    this._state = 'idle';

    // Discard pre-roll buffer
    this._prerollBuffer = [];
    this._prerollMs     = 0;
  }
}
