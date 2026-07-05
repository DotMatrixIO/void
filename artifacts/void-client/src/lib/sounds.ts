// SPDX-License-Identifier: AGPL-3.0-or-later
// The AudioContext is owned per-session: RoomPage and PreviewGate
// close it on teardown. Closing also terminates the AudioWorklet
// global scope thread (Web Audio spec). The next sound call lazily
// creates a fresh context.
let ctx: AudioContext | null = null;

type BeforeCloseHook = () => void;
const beforeCloseHooks = new Set<BeforeCloseHook>();

// Audio-owning modules (e.g. music.ts) register a hook so their timers
// and source nodes are stopped before the context is closed.
export function registerBeforeAudioClose(fn: BeforeCloseHook): () => void {
  beforeCloseHooks.add(fn);
  return () => beforeCloseHooks.delete(fn);
}

function getCtx(): AudioContext {
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioContext();
  }
  return ctx;
}

// Per-call note for every play* helper below: `AudioBufferSourceNode`
// is single-use by Web Audio spec — once started, it cannot be reused
// or restarted. Each playback therefore constructs a fresh source via
// `audioCtx.createBufferSource()`. The underlying noise sample is
// regenerated per call here too (cheap, ~ms of `Math.random`); ONLY
// the AudioContext itself is shared across calls. Do not "optimize"
// by caching either the source or buffer — caching the source breaks
// playback after the first use, and caching the buffer is unnecessary
// for these short bursts and would defeat the per-call randomness.
// (Web Audio spec invariant — no task ref; indexed in
// docs/code-quirks-index.md.)
function createNoiseBuffer(audioCtx: AudioContext, duration: number): AudioBuffer {
  // `audioCtx.sampleRate` is browser/device-chosen (we never pass a
  // sampleRate option to `new AudioContext()`), commonly 44.1 kHz or
  // 48 kHz. Both `frameCount` and the `createBuffer` rate must be
  // derived from it — hardcoding 44100 would cause pitch / duration
  // drift on 48 kHz devices. (Indexed in docs/code-quirks-index.md.)
  const frameCount = Math.ceil(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, frameCount, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function playClick(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(90, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.025);

  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.06, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.035);

  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(audioCtx, 0.02);

  const hpf = audioCtx.createBiquadFilter();
  hpf.type = "highpass";
  hpf.frequency.setValueAtTime(3000, now);
  hpf.Q.value = 1;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.04, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

  noise.connect(hpf);
  hpf.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.02);
}

export function playSelectClick(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(140, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.04);

  const oscGain = audioCtx.createGain();
  oscGain.gain.setValueAtTime(0.05, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.05);

  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(audioCtx, 0.04);

  const bpf = audioCtx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.setValueAtTime(2200, now);
  bpf.Q.value = 8;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0, now);
  noiseGain.gain.linearRampToValueAtTime(0.035, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  noise.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.045);

  const ping = audioCtx.createOscillator();
  ping.type = "sine";
  ping.frequency.setValueAtTime(1800, now + 0.01);

  const pingBpf = audioCtx.createBiquadFilter();
  pingBpf.type = "bandpass";
  pingBpf.frequency.setValueAtTime(1800, now);
  pingBpf.Q.value = 20;

  const pingGain = audioCtx.createGain();
  pingGain.gain.setValueAtTime(0.0, now);
  pingGain.gain.linearRampToValueAtTime(0.02, now + 0.012);
  pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  ping.connect(pingBpf);
  pingBpf.connect(pingGain);
  pingGain.connect(audioCtx.destination);
  ping.start(now + 0.01);
  ping.stop(now + 0.065);
}

export function playBleep(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(audioCtx, 0.12);

  const bpf = audioCtx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.setValueAtTime(1400, now);
  bpf.Q.value = 5;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0, now);
  noiseGain.gain.linearRampToValueAtTime(0.05, now + 0.005);
  noiseGain.gain.setValueAtTime(0.05, now + 0.03);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  noise.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.13);

  const thump = audioCtx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(120, now);
  thump.frequency.exponentialRampToValueAtTime(50, now + 0.06);

  const thumpGain = audioCtx.createGain();
  thumpGain.gain.setValueAtTime(0.06, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

  thump.connect(thumpGain);
  thumpGain.connect(audioCtx.destination);
  thump.start(now);
  thump.stop(now + 0.08);

  const latch = audioCtx.createOscillator();
  latch.type = "triangle";
  latch.frequency.setValueAtTime(680, now + 0.03);

  const latchBpf = audioCtx.createBiquadFilter();
  latchBpf.type = "bandpass";
  latchBpf.frequency.setValueAtTime(680, now);
  latchBpf.Q.value = 15;

  const latchGain = audioCtx.createGain();
  latchGain.gain.setValueAtTime(0.0, now);
  latchGain.gain.linearRampToValueAtTime(0.03, now + 0.035);
  latchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  latch.connect(latchBpf);
  latchBpf.connect(latchGain);
  latchGain.connect(audioCtx.destination);
  latch.start(now + 0.03);
  latch.stop(now + 0.11);
}

export function playBloop(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(audioCtx, 0.3);

  const bpf = audioCtx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.setValueAtTime(2000, now);
  bpf.frequency.exponentialRampToValueAtTime(400, now + 0.25);
  bpf.Q.value = 3;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.04, now);
  noiseGain.gain.linearRampToValueAtTime(0.035, now + 0.05);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  noise.connect(bpf);
  bpf.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.3);

  const sub = audioCtx.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(100, now);
  sub.frequency.exponentialRampToValueAtTime(35, now + 0.25);

  const subGain = audioCtx.createGain();
  subGain.gain.setValueAtTime(0.045, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  sub.connect(subGain);
  subGain.connect(audioCtx.destination);
  sub.start(now);
  sub.stop(now + 0.3);
}

export function playSlide(): void {
  const audioCtx = getCtx();
  const now = audioCtx.currentTime;

  const noise = audioCtx.createBufferSource();
  noise.buffer = createNoiseBuffer(audioCtx, 0.22);

  const lpf = audioCtx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.setValueAtTime(200, now);
  lpf.frequency.exponentialRampToValueAtTime(4000, now + 0.05);
  lpf.frequency.exponentialRampToValueAtTime(600, now + 0.18);
  lpf.Q.value = 2;

  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0, now);
  noiseGain.gain.linearRampToValueAtTime(0.04, now + 0.012);
  noiseGain.gain.setValueAtTime(0.04, now + 0.06);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

  noise.connect(lpf);
  lpf.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.22);

  const surge = audioCtx.createOscillator();
  surge.type = "sine";
  surge.frequency.setValueAtTime(40, now);
  surge.frequency.exponentialRampToValueAtTime(80, now + 0.06);
  surge.frequency.exponentialRampToValueAtTime(50, now + 0.18);

  const surgeGain = audioCtx.createGain();
  surgeGain.gain.setValueAtTime(0.0, now);
  surgeGain.gain.linearRampToValueAtTime(0.06, now + 0.02);
  surgeGain.gain.setValueAtTime(0.06, now + 0.07);
  surgeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  surge.connect(surgeGain);
  surgeGain.connect(audioCtx.destination);
  surge.start(now);
  surge.stop(now + 0.19);

  const metal = audioCtx.createOscillator();
  metal.type = "triangle";
  metal.frequency.setValueAtTime(320, now + 0.03);
  metal.frequency.exponentialRampToValueAtTime(180, now + 0.16);

  const metalBpf = audioCtx.createBiquadFilter();
  metalBpf.type = "bandpass";
  metalBpf.frequency.setValueAtTime(300, now);
  metalBpf.Q.value = 12;

  const metalGain = audioCtx.createGain();
  metalGain.gain.setValueAtTime(0.0, now);
  metalGain.gain.linearRampToValueAtTime(0.025, now + 0.04);
  metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

  metal.connect(metalBpf);
  metalBpf.connect(metalGain);
  metalGain.connect(audioCtx.destination);
  metal.start(now + 0.03);
  metal.stop(now + 0.18);
}

export function resumeAudio(): void {
  if (ctx && ctx.state === "suspended") {
    ctx.resume();
  }
}

export function getAudioContext(): AudioContext {
  return getCtx();
}

// Tear down the per-session AudioContext. Runs before-close hooks
// (music, etc.) FIRST so any in-flight `BufferSource` / oscillator
// scheduled against this context is stopped, THEN closes the context.
// Skipping the stop step regresses Task #283: closing while sources
// are still scheduled leaks the context on Chromium and the burn /
// leave sound bleeds into the next session. Two stages are required
// — closing the context alone does not stop already-scheduled nodes
// in time, and stopping nodes alone does not free the context.
// (Indexed in docs/code-quirks-index.md.)
export async function closeAudioContext(): Promise<void> {
  for (const hook of beforeCloseHooks) {
    try { hook(); } catch {}
  }
  const c = ctx;
  if (!c) return;
  ctx = null;
  if (c.state === "closed") return;
  try {
    await c.close();
  } catch {
    // Double-close or never-started contexts can throw in some browsers.
  }
}
