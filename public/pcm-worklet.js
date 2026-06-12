/**
 * pcm-worklet.js — AudioWorkletProcessor
 * Responsibilities:
 *   1. Receive Float32 audio from the mic (at the AudioContext sample rate)
 *   2. Resample to 24 kHz using linear interpolation
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

    // Resample ratio: how many input samples per output sample
    this._ratio = this._inputRate / this._targetRate;

    // Accumulation buffer for PCM16 output before posting
    // We accumulate ~20 ms worth of TARGET_SAMPLE_RATE samples between posts
    this._pcmAccum = [];
    this._pcmFlushSize = Math.ceil(this._targetRate * 0.02); // 480 samples @ 24 kHz = 20 ms

    // Level / RMS accumulation
    // ~50 ms at the input sample rate
    this._rmsAccum = 0;
    this._rmsCount = 0;
    this._rmsFlushSize = Math.ceil(this._inputRate * 0.05); // ~50 ms of input samples

    // Fractional position cursor for linear interpolation resampler
    this._cursor = 0;
    // Last sample value (needed to interpolate across process() boundaries)
    this._lastSample = 0;
  }

  /**
   * Linearly interpolate and resample a mono Float32 input array to target rate.
   * Returns an Int16Array.
   */
  _resampleToInt16(input) {
    const inputLen = input.length;
    if (inputLen === 0) return new Int16Array(0);

    // Estimate output length
    const outputLen = Math.ceil((inputLen + (this._cursor % 1 > 0 ? 1 : 0)) / this._ratio);
    const out = new Int16Array(outputLen);
    let outIdx = 0;

    // pos is the fractional index into the *current* input buffer
    // _cursor holds the fractional position within the current input buffer
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
