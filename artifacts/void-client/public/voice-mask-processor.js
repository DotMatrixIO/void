// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Unified Voice Mask AudioWorklet — all voice masking algorithms in one processor.
 *
 * Modes:
 *   0 = Passthrough (off)
 *   1 = Deep -100 semitones (OLA with slow LFO stretch + smooth lag correction)
 *   2 = Formant (pitch-shifted OLA with dual LFO wobble + sawtooth buzz)
 *   3 = Scramble (pitch -3 + gentle granular shuffle)
 *   4 = Combined (deep pitch + formant wobble/buzz + grain scatter)
 *
 * Mode switch via: port.postMessage({ type: "mode", value: N })
 * All buffers reset on mode change to prevent cross-algorithm artifacts.
 */

const GRAIN_SIZE = 512;
const HOP_SIZE = 256;
const BUF_SIZE = GRAIN_SIZE * 32;
const NUM_SCRAMBLE_GRAINS = 2;
const SCRAMBLE_GRAINS = 3;
const SCRAMBLE_GRAIN_SIZE = 256;
const SCRAMBLE_HOP_SIZE = SCRAMBLE_GRAIN_SIZE / 2;
const TARGET_LAG = GRAIN_SIZE * 4;
const LAG_CORRECTION = 0.008;

const HANN = new Float32Array(GRAIN_SIZE);
for (let i = 0; i < GRAIN_SIZE; i++) {
  HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / GRAIN_SIZE));
}

const SCRAMBLE_HANN = new Float32Array(SCRAMBLE_GRAIN_SIZE);
for (let i = 0; i < SCRAMBLE_GRAIN_SIZE; i++) {
  SCRAMBLE_HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / SCRAMBLE_GRAIN_SIZE));
}

class VoiceMaskProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._mode = 0;

    this.port.onmessage = (e) => {
      if (e.data.type === "mode") {
        const newMode = Math.max(0, Math.min(4, e.data.value | 0));
        if (newMode !== this._mode) {
          this._mode = newMode;
          this._resetAllBuffers();
        }
      }
    };

    this._initOLA();
    this._initFormant();
    this._initScramble();
    this._initCombined();
  }

  _initOLA() {
    this._inBuf = new Float32Array(BUF_SIZE);
    this._outBuf = new Float32Array(BUF_SIZE);
    this._inWrite = TARGET_LAG;
    this._inRead = 0.0;
    this._outWrite = GRAIN_SIZE * 2;
    this._outRead = 0;
    this._hopAccum = 0;
    this._deepLfoPhase = 0.0;
  }

  _initFormant() {
    this._fmtInBuf = new Float32Array(BUF_SIZE);
    this._fmtOutBuf = new Float32Array(BUF_SIZE);
    this._fmtInWrite = TARGET_LAG;
    this._fmtInRead = 0.0;
    this._fmtOutWrite = GRAIN_SIZE * 2;
    this._fmtOutRead = 0;
    this._fmtHopAccum = 0;
    this._lfoPhase = 0.0;
    this._lfo2Phase = 0.0;
    this._sawPhase = 0.0;
    this._fmtEnvState = 0.0;
    this._fmtSawLpState = 0.0;
    this._fmtLpState = 0.0;
  }

  _initScramble() {
    this._scrGrains = [];
    for (let g = 0; g < SCRAMBLE_GRAINS; g++) {
      this._scrGrains.push(new Float32Array(SCRAMBLE_GRAIN_SIZE));
    }
    this._scrWriteIdx = 0;
    this._scrReadOrder = [];
    this._scrGrainAccum = 0;
    this._scrGrainsReady = 0;
    this._scrOutBuf = new Float32Array(BUF_SIZE);
    this._scrOutWrite = GRAIN_SIZE * 2;
    this._scrOutRead = 0;

    this._scrPitchInBuf = new Float32Array(BUF_SIZE);
    this._scrPitchOutBuf = new Float32Array(BUF_SIZE);
    this._scrPitchInWrite = TARGET_LAG;
    this._scrPitchInRead = 0.0;
    this._scrPitchOutWrite = GRAIN_SIZE * 2;
    this._scrPitchOutRead = 0;
    this._scrPitchHopAccum = 0;
    this._scrLpState = 0.0;
  }

  _initCombined() {
    this._combInBuf = new Float32Array(BUF_SIZE);
    this._combOutBuf = new Float32Array(BUF_SIZE);
    this._combInWrite = TARGET_LAG;
    this._combInRead = 0.0;
    this._combOutWrite = GRAIN_SIZE * 2;
    this._combOutRead = 0;
    this._combHopAccum = 0;
    this._combLfoPhase = 0.0;
    this._combLfo2Phase = 0.0;
    this._combSawPhase = 0.0;

    this._combScrGrains = [];
    for (let g = 0; g < SCRAMBLE_GRAINS; g++) {
      this._combScrGrains.push(new Float32Array(SCRAMBLE_GRAIN_SIZE));
    }
    this._combScrWriteIdx = 0;
    this._combScrGrainAccum = 0;
    this._combScrGrainsReady = 0;
    this._combScrOutBuf = new Float32Array(BUF_SIZE);
    this._combScrOutWrite = GRAIN_SIZE * 2;
    this._combScrOutRead = 0;
    this._combLpState = 0.0;
    this._combEnvState = 0.0;
    this._combSawLpState = 0.0;
  }

  _resetAllBuffers() {
    this._inBuf.fill(0);
    this._outBuf.fill(0);
    this._inWrite = TARGET_LAG;
    this._inRead = 0.0;
    this._outWrite = GRAIN_SIZE * 2;
    this._outRead = 0;
    this._hopAccum = 0;
    this._deepLfoPhase = 0.0;

    this._fmtInBuf.fill(0);
    this._fmtOutBuf.fill(0);
    this._fmtInWrite = TARGET_LAG;
    this._fmtInRead = 0.0;
    this._fmtOutWrite = GRAIN_SIZE * 2;
    this._fmtOutRead = 0;
    this._fmtHopAccum = 0;
    this._lfoPhase = 0.0;
    this._lfo2Phase = 0.0;
    this._sawPhase = 0.0;
    this._fmtEnvState = 0.0;
    this._fmtSawLpState = 0.0;
    this._fmtLpState = 0.0;

    for (let g = 0; g < SCRAMBLE_GRAINS; g++) this._scrGrains[g].fill(0);
    this._scrWriteIdx = 0;
    this._scrReadOrder.length = 0;
    this._scrGrainAccum = 0;
    this._scrGrainsReady = 0;
    this._scrOutBuf.fill(0);
    this._scrOutWrite = GRAIN_SIZE * 2;
    this._scrOutRead = 0;

    this._scrPitchInBuf.fill(0);
    this._scrPitchOutBuf.fill(0);
    this._scrPitchInWrite = TARGET_LAG;
    this._scrPitchInRead = 0.0;
    this._scrPitchOutWrite = GRAIN_SIZE * 2;
    this._scrPitchOutRead = 0;
    this._scrPitchHopAccum = 0;
    this._scrLpState = 0.0;

    this._combInBuf.fill(0);
    this._combOutBuf.fill(0);
    this._combInWrite = TARGET_LAG;
    this._combInRead = 0.0;
    this._combOutWrite = GRAIN_SIZE * 2;
    this._combOutRead = 0;
    this._combHopAccum = 0;
    this._combLfoPhase = 0.0;
    this._combLfo2Phase = 0.0;
    this._combSawPhase = 0.0;

    for (let g = 0; g < SCRAMBLE_GRAINS; g++) this._combScrGrains[g].fill(0);
    this._combScrWriteIdx = 0;
    this._combScrGrainAccum = 0;
    this._combScrGrainsReady = 0;
    this._combScrOutBuf.fill(0);
    this._combScrOutWrite = GRAIN_SIZE * 2;
    this._combScrOutRead = 0;
    this._combLpState = 0.0;
    this._combEnvState = 0.0;
    this._combSawLpState = 0.0;
  }

  process(inputs, outputs) {
    const inp = inputs[0]?.[0];
    const out = outputs[0]?.[0];
    if (!inp || !out) return true;

    switch (this._mode) {
      case 0: this._passthrough(inp, out); break;
      case 1: this._deepPitch(inp, out); break;
      case 2: this._formant(inp, out); break;
      case 3: this._scramble(inp, out); break;
      case 4: this._combined(inp, out); break;
      default: this._passthrough(inp, out); break;
    }

    return true;
  }

  _passthrough(inp, out) {
    out.set(inp);
  }

  _pitchOLA(inp, out, ratio) {
    for (let i = 0; i < inp.length; i++) {
      this._inBuf[this._inWrite % BUF_SIZE] = inp[i];
      this._inWrite++;
      this._hopAccum++;
      if (this._hopAccum >= HOP_SIZE) {
        this._hopAccum = 0;

        const currentLag = this._inWrite - this._inRead;
        const correction = (currentLag - TARGET_LAG) * LAG_CORRECTION;
        const advance = HOP_SIZE * ratio + correction;

        const base = Math.floor(this._inRead);
        for (let j = 0; j < GRAIN_SIZE; j++) {
          const sample = this._inBuf[(base + j) % BUF_SIZE] * HANN[j];
          this._outBuf[(this._outWrite + j) % BUF_SIZE] += sample;
        }
        this._inRead += advance;
        this._outWrite += HOP_SIZE;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const ri = this._outRead % BUF_SIZE;
      out[i] = this._outBuf[ri];
      this._outBuf[ri] = 0.0;
      this._outRead++;
    }
  }

  _deepPitch(inp, out) {
    // Pitch shift WITHOUT time stretch (TD-PSOLA style):
    //   - Input read advances at full rate (HOP_SIZE per hop) → speech runs at
    //     real-time speed, no skipped words.
    //   - Each grain is resampled longer (grainLen = GRAIN_SIZE / ratio) so when
    //     the longer grain is played back at the output sample rate, it sounds
    //     lower in pitch. Heavy 75% overlap-add keeps it smooth.
    const baseSemitones = -6;
    const lfoFreq = 0.12;
    const lfoDepth = 1.5;
    const lfoInc = (2 * Math.PI * lfoFreq) / sampleRate * HOP_SIZE;
    const MAX_GRAIN_LEN = GRAIN_SIZE * 4; // ratio floor ≈ 0.25

    for (let i = 0; i < inp.length; i++) {
      this._inBuf[this._inWrite % BUF_SIZE] = inp[i];
      this._inWrite++;
      this._hopAccum++;
      if (this._hopAccum >= HOP_SIZE) {
        this._hopAccum = 0;

        const lfoVal = Math.sin(this._deepLfoPhase);
        this._deepLfoPhase += lfoInc;
        if (this._deepLfoPhase > 2 * Math.PI) this._deepLfoPhase -= 2 * Math.PI;

        const ratio = Math.pow(2, (baseSemitones + lfoVal * lfoDepth) / 12);
        let grainLen = Math.round(GRAIN_SIZE / ratio);
        if (grainLen > MAX_GRAIN_LEN) grainLen = MAX_GRAIN_LEN;
        if (grainLen < 8) grainLen = 8;

        // Amplitude compensation for overlap-add: with hop = HOP_SIZE and a
        // Hann window of length grainLen, the steady-state OLA sum is
        // grainLen / (2 * HOP_SIZE), so divide by that.
        const ampScale = (2 * HOP_SIZE) / grainLen;
        const winInc = (2 * Math.PI) / (grainLen - 1);

        const base = Math.floor(this._inRead);
        for (let j = 0; j < grainLen; j++) {
          const srcPos = j * ratio;
          const srcIdx = Math.floor(srcPos);
          const frac = srcPos - srcIdx;
          const a = this._inBuf[(base + srcIdx) % BUF_SIZE];
          const b = this._inBuf[(base + srcIdx + 1) % BUF_SIZE];
          const sample = a + (b - a) * frac;
          const w = 0.5 - 0.5 * Math.cos(winInc * j);
          this._outBuf[(this._outWrite + j) % BUF_SIZE] += sample * w * ampScale;
        }
        this._inRead += HOP_SIZE;
        this._outWrite += HOP_SIZE;
      }
    }
    for (let i = 0; i < out.length; i++) {
      const ri = this._outRead % BUF_SIZE;
      out[i] = this._outBuf[ri];
      this._outBuf[ri] = 0.0;
      this._outRead++;
    }
  }

  _formant(inp, out) {
    // TD-PSOLA pitch shift (no time-stretch): grains resampled per-hop, input
    // read advances at full rate. Fixes the dropouts caused by lag correction
    // racing with the LFO-modulated ratio.
    const lfo1Freq = 0.5;
    const lfo1Depth = 2.0;
    const lfo2Freq = 0.5;
    const lfo2Depth = 2.0;
    const basePitchSemitones = -1.0;
    const lfo1Inc = (2 * Math.PI * lfo1Freq) / sampleRate * HOP_SIZE;
    const lfo2Inc = (2 * Math.PI * lfo2Freq) / sampleRate * HOP_SIZE;
    const MAX_GRAIN_LEN = GRAIN_SIZE * 4;

    for (let i = 0; i < inp.length; i++) {
      this._fmtInBuf[this._fmtInWrite % BUF_SIZE] = inp[i];
      this._fmtInWrite++;
      this._fmtHopAccum++;

      if (this._fmtHopAccum >= HOP_SIZE) {
        this._fmtHopAccum = 0;

        const lfo1Val = Math.sin(this._lfoPhase);
        this._lfoPhase += lfo1Inc;
        if (this._lfoPhase > 2 * Math.PI) this._lfoPhase -= 2 * Math.PI;

        const lfo2Val = Math.sin(this._lfo2Phase);
        this._lfo2Phase += lfo2Inc;
        if (this._lfo2Phase > 2 * Math.PI) this._lfo2Phase -= 2 * Math.PI;

        const ratio = Math.pow(2, (basePitchSemitones + lfo1Val * lfo1Depth + lfo2Val * lfo2Depth) / 12);
        let grainLen = Math.round(GRAIN_SIZE / ratio);
        if (grainLen > MAX_GRAIN_LEN) grainLen = MAX_GRAIN_LEN;
        if (grainLen < 8) grainLen = 8;

        const ampScale = (2 * HOP_SIZE) / grainLen;
        const winInc = (2 * Math.PI) / (grainLen - 1);

        const base = Math.floor(this._fmtInRead);
        for (let j = 0; j < grainLen; j++) {
          const srcPos = j * ratio;
          const srcIdx = Math.floor(srcPos);
          const frac = srcPos - srcIdx;
          const a = this._fmtInBuf[(base + srcIdx) % BUF_SIZE];
          const b = this._fmtInBuf[(base + srcIdx + 1) % BUF_SIZE];
          const sample = a + (b - a) * frac;
          const w = 0.5 - 0.5 * Math.cos(winInc * j);
          this._fmtOutBuf[(this._fmtOutWrite + j) % BUF_SIZE] += sample * w * ampScale;
        }
        this._fmtInRead += HOP_SIZE;
        this._fmtOutWrite += HOP_SIZE;
      }
    }

    const sawFreq = 80;
    const sawInc = sawFreq / sampleRate;
    const sawMix = 0.50;
    const envTau = 0.030;
    const envAlpha = 1 - Math.exp(-1 / (envTau * sampleRate));
    const sawLpFc = 150;
    const sawLpAlpha = 1 - Math.exp(-2 * Math.PI * sawLpFc / sampleRate);
    const sawLpGain = 1.6;
    const lpFc = 7000;
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * lpFc / sampleRate);

    for (let i = 0; i < out.length; i++) {
      const ri = this._fmtOutRead % BUF_SIZE;
      const voice = this._fmtOutBuf[ri] * 0.85;
      this._fmtOutBuf[ri] = 0.0;
      this._fmtOutRead++;

      const sawRaw = (this._sawPhase * 2 - 1);
      this._sawPhase += sawInc;
      if (this._sawPhase >= 1) this._sawPhase -= 1;
      this._fmtSawLpState += sawLpAlpha * (sawRaw - this._fmtSawLpState);
      const saw = this._fmtSawLpState * sawLpGain;

      this._fmtEnvState += envAlpha * (Math.abs(voice) - this._fmtEnvState);
      const mixed = voice + saw * this._fmtEnvState * sawMix;
      this._fmtLpState += lpAlpha * (mixed - this._fmtLpState);
      out[i] = Math.tanh(this._fmtLpState);
    }
  }

  _scramble(inp, out) {
    // TD-PSOLA pitch shift (no time stretch) — same approach as DEEP/FORMANT.
    const pitchRatio = Math.pow(2, -1 / 12);
    const MAX_GRAIN_LEN = GRAIN_SIZE * 4;
    const pitched = new Float32Array(inp.length);

    let pgrainLen = Math.round(GRAIN_SIZE / pitchRatio);
    if (pgrainLen > MAX_GRAIN_LEN) pgrainLen = MAX_GRAIN_LEN;
    if (pgrainLen < 8) pgrainLen = 8;
    const pAmpScale = (2 * HOP_SIZE) / pgrainLen;
    const pWinInc = (2 * Math.PI) / (pgrainLen - 1);

    for (let i = 0; i < inp.length; i++) {
      this._scrPitchInBuf[this._scrPitchInWrite % BUF_SIZE] = inp[i];
      this._scrPitchInWrite++;
      this._scrPitchHopAccum++;
      if (this._scrPitchHopAccum >= HOP_SIZE) {
        this._scrPitchHopAccum = 0;
        const base = Math.floor(this._scrPitchInRead);
        for (let j = 0; j < pgrainLen; j++) {
          const srcPos = j * pitchRatio;
          const srcIdx = Math.floor(srcPos);
          const frac = srcPos - srcIdx;
          const a = this._scrPitchInBuf[(base + srcIdx) % BUF_SIZE];
          const b = this._scrPitchInBuf[(base + srcIdx + 1) % BUF_SIZE];
          const sample = a + (b - a) * frac;
          const w = 0.5 - 0.5 * Math.cos(pWinInc * j);
          this._scrPitchOutBuf[(this._scrPitchOutWrite + j) % BUF_SIZE] += sample * w * pAmpScale;
        }
        this._scrPitchInRead += HOP_SIZE;
        this._scrPitchOutWrite += HOP_SIZE;
      }
    }
    for (let i = 0; i < inp.length; i++) {
      const ri = this._scrPitchOutRead % BUF_SIZE;
      pitched[i] = this._scrPitchOutBuf[ri];
      this._scrPitchOutBuf[ri] = 0.0;
      this._scrPitchOutRead++;
    }

    for (let i = 0; i < pitched.length; i++) {
      const gIdx = this._scrWriteIdx;
      const gPos = this._scrGrainAccum;

      this._scrGrains[gIdx][gPos] = pitched[i] * SCRAMBLE_HANN[gPos];
      this._scrGrainAccum++;

      if (this._scrGrainAccum >= SCRAMBLE_GRAIN_SIZE) {
        this._scrGrainAccum = 0;
        this._scrWriteIdx = (this._scrWriteIdx + 1) % SCRAMBLE_GRAINS;
        this._scrGrainsReady = Math.min(this._scrGrainsReady + 1, SCRAMBLE_GRAINS);

        if (this._scrGrainsReady >= SCRAMBLE_GRAINS) {
          const order = [];
          for (let g = 0; g < SCRAMBLE_GRAINS; g++) order.push(g);
          for (let g = 0; g < SCRAMBLE_GRAINS - 1; g++) {
            if (Math.random() < 0.45) {
              const tmp = order[g];
              order[g] = order[g + 1];
              order[g + 1] = tmp;
              g++;
            }
          }

          for (let g = 0; g < SCRAMBLE_GRAINS; g++) {
            const srcGrain = this._scrGrains[order[g]];
            for (let s = 0; s < SCRAMBLE_GRAIN_SIZE; s++) {
              this._scrOutBuf[(this._scrOutWrite + g * SCRAMBLE_HOP_SIZE + s) % BUF_SIZE] += srcGrain[s];
            }
          }
          // Advance by exactly the input that produced this emission (one new
          // grain = SCRAMBLE_GRAIN_SIZE samples). Otherwise rate breaks.
          this._scrOutWrite += SCRAMBLE_GRAIN_SIZE;
        }
      }
    }

    const scrLpFc = 7000;
    const scrLpAlpha = 1 - Math.exp(-2 * Math.PI * scrLpFc / sampleRate);
    for (let i = 0; i < out.length; i++) {
      const ri = this._scrOutRead % BUF_SIZE;
      const x = this._scrOutBuf[ri];
      this._scrOutBuf[ri] = 0.0;
      this._scrOutRead++;
      this._scrLpState += scrLpAlpha * (x - this._scrLpState);
      out[i] = Math.tanh(this._scrLpState);
    }
  }

  _combined(inp, out) {
    // Stage 1: TD-PSOLA pitch shift (no time stretch / no dropouts).
    const baseSemitones = -4.0;
    const lfo1Freq = 0.6;
    const lfo1Depth = 1.5;
    const lfo2Freq = 0.8;
    const lfo2Depth = 2.0;
    const lfo1Inc = (2 * Math.PI * lfo1Freq) / sampleRate * HOP_SIZE;
    const lfo2Inc = (2 * Math.PI * lfo2Freq) / sampleRate * HOP_SIZE;
    const MAX_GRAIN_LEN = GRAIN_SIZE * 4;

    for (let i = 0; i < inp.length; i++) {
      this._combInBuf[this._combInWrite % BUF_SIZE] = inp[i];
      this._combInWrite++;
      this._combHopAccum++;

      if (this._combHopAccum >= HOP_SIZE) {
        this._combHopAccum = 0;

        const lfo1Val = Math.sin(this._combLfoPhase);
        this._combLfoPhase += lfo1Inc;
        if (this._combLfoPhase > 2 * Math.PI) this._combLfoPhase -= 2 * Math.PI;

        const lfo2Val = Math.sin(this._combLfo2Phase);
        this._combLfo2Phase += lfo2Inc;
        if (this._combLfo2Phase > 2 * Math.PI) this._combLfo2Phase -= 2 * Math.PI;

        const ratio = Math.pow(2, (baseSemitones + lfo1Val * lfo1Depth + lfo2Val * lfo2Depth) / 12);
        let grainLen = Math.round(GRAIN_SIZE / ratio);
        if (grainLen > MAX_GRAIN_LEN) grainLen = MAX_GRAIN_LEN;
        if (grainLen < 8) grainLen = 8;

        const ampScale = (2 * HOP_SIZE) / grainLen;
        const winInc = (2 * Math.PI) / (grainLen - 1);

        const base = Math.floor(this._combInRead);
        for (let j = 0; j < grainLen; j++) {
          const srcPos = j * ratio;
          const srcIdx = Math.floor(srcPos);
          const frac = srcPos - srcIdx;
          const a = this._combInBuf[(base + srcIdx) % BUF_SIZE];
          const b = this._combInBuf[(base + srcIdx + 1) % BUF_SIZE];
          const sample = a + (b - a) * frac;
          const w = 0.5 - 0.5 * Math.cos(winInc * j);
          this._combOutBuf[(this._combOutWrite + j) % BUF_SIZE] += sample * w * ampScale;
        }
        this._combInRead += HOP_SIZE;
        this._combOutWrite += HOP_SIZE;
      }
    }

    // Stage 2: sub-bass saw modulated by the voice envelope.
    const sawFreq = 80;
    const sawInc = sawFreq / sampleRate;
    const sawMix = 0.40;
    const envTau = 0.030;
    const envAlpha = 1 - Math.exp(-1 / (envTau * sampleRate));
    const sawLpFc = 150;
    const sawLpAlpha = 1 - Math.exp(-2 * Math.PI * sawLpFc / sampleRate);
    const sawLpGain = 1.6;
    const stage1 = new Float32Array(out.length);

    for (let i = 0; i < out.length; i++) {
      const ri = this._combOutRead % BUF_SIZE;
      const voice = this._combOutBuf[ri] * 1.4;
      this._combOutBuf[ri] = 0.0;
      this._combOutRead++;

      const sawRaw = (this._combSawPhase * 2 - 1);
      this._combSawPhase += sawInc;
      if (this._combSawPhase >= 1) this._combSawPhase -= 1;
      this._combSawLpState += sawLpAlpha * (sawRaw - this._combSawLpState);
      const saw = this._combSawLpState * sawLpGain;

      this._combEnvState += envAlpha * (Math.abs(voice) - this._combEnvState);
      stage1[i] = voice + saw * this._combEnvState * sawMix;
    }

    // Stage 3: granular shuffle (same algorithm/sizing as SCRAMBLE).
    for (let i = 0; i < stage1.length; i++) {
      const gIdx = this._combScrWriteIdx;
      const gPos = this._combScrGrainAccum;

      this._combScrGrains[gIdx][gPos] = stage1[i] * SCRAMBLE_HANN[gPos];
      this._combScrGrainAccum++;

      if (this._combScrGrainAccum >= SCRAMBLE_GRAIN_SIZE) {
        this._combScrGrainAccum = 0;
        this._combScrWriteIdx = (this._combScrWriteIdx + 1) % SCRAMBLE_GRAINS;
        this._combScrGrainsReady = Math.min(this._combScrGrainsReady + 1, SCRAMBLE_GRAINS);

        if (this._combScrGrainsReady >= SCRAMBLE_GRAINS) {
          const order = [];
          for (let g = 0; g < SCRAMBLE_GRAINS; g++) order.push(g);
          for (let g = 0; g < SCRAMBLE_GRAINS - 1; g++) {
            if (Math.random() < 0.30) {
              const tmp = order[g];
              order[g] = order[g + 1];
              order[g + 1] = tmp;
              g++;
            }
          }

          for (let g = 0; g < SCRAMBLE_GRAINS; g++) {
            const srcGrain = this._combScrGrains[order[g]];
            for (let s = 0; s < SCRAMBLE_GRAIN_SIZE; s++) {
              this._combScrOutBuf[(this._combScrOutWrite + g * SCRAMBLE_HOP_SIZE + s) % BUF_SIZE] += srcGrain[s];
            }
          }
          this._combScrOutWrite += SCRAMBLE_GRAIN_SIZE;
        }
      }
    }

    const lpFc = 7000;
    const lpAlpha = 1 - Math.exp(-2 * Math.PI * lpFc / sampleRate);
    for (let i = 0; i < out.length; i++) {
      const ri = this._combScrOutRead % BUF_SIZE;
      const x = this._combScrOutBuf[ri];
      this._combScrOutBuf[ri] = 0.0;
      this._combScrOutRead++;
      this._combLpState += lpAlpha * (x - this._combLpState);
      out[i] = Math.tanh(this._combLpState);
    }
  }
}

registerProcessor("voice-mask", VoiceMaskProcessor);
