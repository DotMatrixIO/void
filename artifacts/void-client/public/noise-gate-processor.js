// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Noise Gate AudioWorklet — runs on audio rendering thread.
 *
 * Soft gate with hysteresis to prevent flutter near threshold.
 * Uses per-sample RMS envelope for smooth transitions.
 * Exposes gate open/closed state via message port for VU meter.
 *
 * Parameters:
 *   threshold: -50 dB (open)
 *   hysteresis: 6 dB (close at threshold - 6 = -56 dB)
 *   attack:    3 ms
 *   release:   200 ms
 *   floor:     -18 dB (soft gate — attenuates, never fully silences)
 */

const OPEN_THRESHOLD_DB = -50;
const HYSTERESIS_DB = 6;
const CLOSE_THRESHOLD_DB = OPEN_THRESHOLD_DB - HYSTERESIS_DB;
const ATTACK_MS = 3;
const RELEASE_MS = 200;
const FLOOR_LINEAR = Math.pow(10, -18 / 20);

class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._openThreshold = Math.pow(10, OPEN_THRESHOLD_DB / 20);
    this._closeThreshold = Math.pow(10, CLOSE_THRESHOLD_DB / 20);
    this._envelope = 1;
    this._gateOpen = true;
    this._rmsEnv = 0;
    this._framesSinceReport = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === "threshold") {
        this._openThreshold = Math.pow(10, e.data.value / 20);
        this._closeThreshold = Math.pow(10, (e.data.value - HYSTERESIS_DB) / 20);
      }
    };
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    const sr = sampleRate;
    const attackCoeff = 1 - Math.exp(-1 / (sr * ATTACK_MS / 1000));
    const releaseCoeff = 1 - Math.exp(-1 / (sr * RELEASE_MS / 1000));
    const rmsCoeff = 1 - Math.exp(-1 / (sr * 0.020));

    for (let i = 0; i < inp.length; i++) {
      const absSample = Math.abs(inp[i]);
      this._rmsEnv += rmsCoeff * (absSample - this._rmsEnv);

      if (this._gateOpen) {
        if (this._rmsEnv < this._closeThreshold) {
          this._gateOpen = false;
        }
      } else {
        if (this._rmsEnv >= this._openThreshold) {
          this._gateOpen = true;
        }
      }

      const target = this._gateOpen ? 1 : FLOOR_LINEAR;
      const coeff = this._envelope < target ? attackCoeff : releaseCoeff;
      this._envelope += coeff * (target - this._envelope);
      out[i] = inp[i] * this._envelope;
    }

    this._framesSinceReport++;
    if (this._framesSinceReport >= 10) {
      this._framesSinceReport = 0;
      this.port.postMessage({
        type: "gate-state",
        open: this._gateOpen,
        rms: this._rmsEnv,
      });
    }

    return true;
  }
}

registerProcessor("noise-gate", NoiseGateProcessor);
