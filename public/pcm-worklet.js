/**
 * pcm-worklet.js — AudioWorkletProcessor
 * Responsibilities:
 *   1. Receive Float32 audio from the mic (at the AudioContext sample rate)
 *   2. Resample to 24 kHz
 *      — 48 kHz input: 2-tap FIR low-pass (pair-average) then 2:1 decimation
 *      — other input rates: linear interpolation fallback
 *   3. Convert Float32 → PCM16LE
 *   4. Post resampled PCM16 chunks back to the main thread
 *   5. Every ~50 ms post an RMS level message to the main thread
 *
 * Messages TO main thread:
 *   { type: "pcm",   buffer: Int16Array  }  — PCM16LE 24kHz mono chunk
 *   { type: "level", rms: <float 0..1>   }  — RMS of the latest ~50 ms window
 *
 * Parameters (AudioWorkletNode options.processorOptions):
 *   inputSampleRate  — AudioContext.sampleRate (filled in by AudioPipeline)
 *   targetSampleRate — target rate, always 24000
 */

const TARGET_SAMPLE_RATE = 24000;

class PcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this._inputRate = opts.inputSampleRate || sampleRate; // global sampleRate from AudioWorkletGlobalScope
    this._targetRate = opts.targetSampleRate || TARGET_SAMPLE_RATE;
    const flushMs = (opts.flushMs != null) ? opts.flushMs : 20; // PCM flush 間隔(ms)，由 audio.js 傳入

    // Resample ratio: how many input samples per output sample
    this._ratio = this._inputRate / this._targetRate;

    // Use FIR low-pass + 2:1 decimation only for the exact 48 kHz → 24 kHz case
    this._use2to1 = (this._inputRate === 48000 && this._targetRate === 24000);

    // State for 2:1 FIR path: one sample may be left over at a buffer boundary
    this._pending = null;

    // State for linear interpolation fallback
    // Fractional position cursor and last sample across process() boundaries
    this._cursor = 0;
    this._lastSample = 0;

    // Accumulation buffer for PCM16 output before posting
    // We accumulate ~20 ms worth of TARGET_SAMPLE_RATE samples between posts
    this._pcmAccum = [];
    this._pcmFlushSize = Math.ceil(this._targetRate * (flushMs / 1000)); // 480 samples @ 24 kHz, flushMs=20

    // Level / RMS accumulation
    // ~50 ms at the input sample rate
    this._rmsAccum = 0;
    this._rmsCount = 0;
    this._rmsFlushSize = Math.ceil(this._inputRate * 0.05); // ~50 ms of input samples
  }

  /**
   * 2:1 decimation with 2-tap FIR low-pass (pair-average anti-aliasing).
   *
   * Each output sample is the mean of two consecutive input samples:
   *   y[n] = (x[2n] + x[2n+1]) / 2
   *
   * This is a symmetric 2-tap FIR with coefficients [0.5, 0.5].  Its −3 dB
   * point sits at fs_in/4 = 12 kHz, comfortably below the 24 kHz Nyquist
   * limit, suppressing aliasing without meaningful speech-band attenuation.
   *
   * A single leftover sample at the end of a block is held in this._pending
   * and paired with the first sample of the next block so that no input
   * sample is ever silently dropped.
   */
  _resample2to1(input) {
    const inputLen = input.length;
    if (inputLen === 0) return new Int16Array(0);

    // Total available samples including any carried-over from previous block
    const total = (this._pending !== null ? 1 : 0) + inputLen;
    const outLen = Math.floor(total / 2);
    const out = new Int16Array(outLen);
    let outIdx = 0;
    let i = 0;

    // Consume the pending sample by pairing it with input[0]
    if (this._pending !== null) {
      const avg = (this._pending + input[0]) * 0.5;
      const clamped = Math.max(-1, Math.min(1, avg));
      out[outIdx++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      this._pending = null;
      i = 1;
    }

    // Process remaining full pairs
    while (i + 1 < inputLen) {
      const avg = (input[i] + input[i + 1]) * 0.5;
      const clamped = Math.max(-1, Math.min(1, avg));
      out[outIdx++] = clamped < 0 ? clamped * 32768 : clamped * 32767;
      i += 2;
    }

    // Save any unpaired trailing sample for the next block
    if (i < inputLen) {
      this._pending = input[i];
    }

    return out.subarray(0, outIdx);
  }

  /**
   * Linear interpolation resampler — fallback for non-48 kHz input rates.
   * Maintains _cursor (fractional offset) and _lastSample across blocks.
   */
  _resampleLinear(input) {
    const inputLen = input.length;
    if (inputLen === 0) return new Int16Array(0);

    // Estimate output length
    const outputLen = Math.ceil((inputLen + (this._cursor % 1 > 0 ? 1 : 0)) / this._ratio);
    const out = new Int16Array(outputLen);
    let outIdx = 0;

    // pos is the fractional index into the *current* input buffer
    let pos = this._cursor;

    while (pos < inputLen) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;

      const s0 = i0 === 0 ? this._lastSample : input[i0 - 1];
      const s1 = input[i0] !== undefined ? input[i0] : input[inputLen - 1];

      const sample = s0 + frac * (s1 - s0);

      // Float32 [-1,1] → Int16 [-32768, 32767]
      const clamped = Math.max(-1, Math.min(1, sample));
      out[outIdx++] = clamped < 0 ? clamped * 32768 : clamped * 32767;

      pos += this._ratio;
    }

    // Advance cursor: how far past the end of this buffer are we?
    this._cursor = pos - inputLen;
    this._lastSample = input[inputLen - 1];

    return out.subarray(0, outIdx);
  }

  /**
   * Dispatch to the appropriate resampler and return an Int16Array.
   *   48 kHz → 24 kHz : FIR low-pass (pair average) + 2:1 decimation
   *   other rates      : linear interpolation
   */
  _resampleToInt16(input) {
    if (this._use2to1) {
      return this._resample2to1(input);
    }
    return this._resampleLinear(input);
  }

  process(inputs) {
    const channelData = inputs[0] && inputs[0][0];
    if (!channelData || channelData.length === 0) return true;

    // --- RMS level accumulation (on raw input, before resampling) ---
    for (let i = 0; i < channelData.length; i++) {
      this._rmsAccum += channelData[i] * channelData[i];
      this._rmsCount++;
    }
    if (this._rmsCount >= this._rmsFlushSize) {
      const rms = Math.sqrt(this._rmsAccum / this._rmsCount);
      this.port.postMessage({ type: 'level', rms });
      this._rmsAccum = 0;
      this._rmsCount = 0;
    }

    // --- Resample and accumulate PCM ---
    const pcm16 = this._resampleToInt16(channelData);
    for (let i = 0; i < pcm16.length; i++) {
      this._pcmAccum.push(pcm16[i]);
    }

    // Flush when we have enough samples
    while (this._pcmAccum.length >= this._pcmFlushSize) {
      const chunk = new Int16Array(this._pcmAccum.splice(0, this._pcmFlushSize));
      // Transfer the underlying buffer to avoid a copy
      this.port.postMessage({ type: 'pcm', buffer: chunk }, [chunk.buffer]);
    }

    return true; // keep processor alive
  }
}

registerProcessor('pcm-processor', PcmProcessor);
