// SPDX-License-Identifier: AGPL-3.0-or-later
export type VideoStyle = 0 | 1 | 2 | 3 | 4 | 5;

const VERTEX_SRC = /* glsl */ `#version 300 es
in vec2 a_position;
out vec2 v_texcoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texcoord = a_position * 0.5 + 0.5;
}`;

const FRAGMENT_SRC = /* glsl */ `#version 300 es
// Task #522: precision must be highp where the device supports it. The
// GOLD branch below relies on per-pixel hash math whose intermediate
// products (~43758 × sin(...)) exceed mediump's guaranteed ±16384 range
// on strict-mediump GPUs (notably DuckDuckGo's WebKit on iOS and some
// Android Chromium variants); on those devices the hash collapses to
// Inf/NaN, every subsequent mix() propagates NaN, and the canvas
// renders pure black — invisible to the user but emitted to peers as a
// blank video track. Desktop Chrome/Firefox/Safari typically promote
// mediump to highp internally, which is why they were never affected.
// Selecting highp explicitly when available makes the bug impossible on
// every browser that supports it; the mediump fallback below pairs
// with hardened hash math (smaller multiplier + time wrap) further down
// in the GOLD branch so the same shader is numerically stable even on
// devices that genuinely cannot promote to highp.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
// On highp the original 43758.5453 multiplier and unwrapped u_time fit
// comfortably; keeping the literals identical here preserves the GOLD
// look on Chrome/Firefox/Safari desktop bit-for-bit.
#define GOLD_HASH_MULT 43758.5453
#define GOLD_TC_SCALE  1234.5
#define GOLD_TIME(t)   (t)
#else
precision mediump float;
// Mediump-safe fallback: shrink the hash multiplier by 100× (still
// gives uniform-looking pseudo-random output for dither / jitter, just
// with a different specific seed pattern — the duotone look is
// preserved), shrink the texcoord pre-multiplier in the jitter hash so
// the sin() argument stays inside mediump range, and wrap u_time on a
// 256-second period before it gets multiplied by 60 so the temporal
// jitter term cannot exceed 15360 (under the ~16384 mediump ceiling).
#define GOLD_HASH_MULT 437.5853
#define GOLD_TC_SCALE  12.345
#define GOLD_TIME(t)   mod((t), 256.0)
#endif

uniform sampler2D u_texture;
uniform sampler2D u_font_atlas;
uniform int u_mode;
uniform vec3 u_color_dark;
uniform vec3 u_color_light;
uniform vec2 u_texel_size;
uniform float u_time;

in vec2 v_texcoord;
out vec4 outColor;

float luminance(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float blurredLuma() {
  return luminance(texture(u_texture, v_texcoord).rgb);
}

void main() {
  if (u_mode == 0) {
    outColor = texture(u_texture, v_texcoord);

  } else if (u_mode == 1) {
    // ── GOLD mode — duotone luminance mapping, hardened ──────────────────
    // Seven layered defenses. Stages run in the order: (a) sample-coord
    // warp, (b) spatial filtering, (c) range compression, (d) temporal
    // jitter, (e) ordered dither. Defense rationale per stage is inline.
    //
    // No face detector is in the pipeline. Spatial filtering uses a
    // single screen-center-radial vignette: blur, mosaic, and dither
    // are all strongest at frame center (0.5, 0.5) and fade smoothly
    // to crisp at the perimeter. In centered video-call framing the
    // face sits roughly under the high-weight zone, but the vignette
    // is anchored to the screen, not the face — it does not follow
    // eye position. Adding mediapipe / blazeface for real face
    // tracking is a much heavier architectural change (model assets,
    // worker plumbing, additional shader uniforms) than these shader-
    // local hardenings, and was explicitly declined by the user in
    // favour of this simpler radial vignette.

    // (a) Sub-pixel temporal warp. ±0.5 texel sinusoid at non-integer
    // frequencies. Imperceptible at 15fps in a 320×240 frame; lethal
    // to landmark trackers and frame-aligned super-resolution.
    vec2 warp = vec2(
      sin(GOLD_TIME(u_time) * 1.7 + v_texcoord.y * 47.0),
      cos(GOLD_TIME(u_time) * 1.3 + v_texcoord.x * 53.0)
    ) * 0.5 * u_texel_size;
    vec2 uv = v_texcoord + warp;

    // (b1) Bilateral pre-smooth — separable 3×3 Gaussian, weights
    // 1/4/6/4/1 normalized, kernel offsets at 3.25 texels (was 2.6
    // — boosted another 25% per user request to ensure that a face
    // accidentally framed at the edge of the frame, where the (b2)
    // center-radial obscuring is near zero, still receives enough
    // baseline blur to wipe pore / wrinkle / scar detail). This is
    // the only blur stage that applies uniformly across the WHOLE
    // frame at full strength — (b2)'s wide blur, mosaic, and dither
    // all fade with centerWeight, so the corners depend almost
    // entirely on this stage for surface-texture defense.
    float L = 0.0;
    L += luminance(texture(u_texture, uv + vec2(-3.25, -3.25) * u_texel_size).rgb) * 0.0625;
    L += luminance(texture(u_texture, uv + vec2( 0.0,  -3.25) * u_texel_size).rgb) * 0.125;
    L += luminance(texture(u_texture, uv + vec2( 3.25, -3.25) * u_texel_size).rgb) * 0.0625;
    L += luminance(texture(u_texture, uv + vec2(-3.25,  0.0)  * u_texel_size).rgb) * 0.125;
    L += luminance(texture(u_texture, uv).rgb) * 0.25;
    L += luminance(texture(u_texture, uv + vec2( 3.25,  0.0)  * u_texel_size).rgb) * 0.125;
    L += luminance(texture(u_texture, uv + vec2(-3.25,  3.25) * u_texel_size).rgb) * 0.0625;
    L += luminance(texture(u_texture, uv + vec2( 0.0,   3.25) * u_texel_size).rgb) * 0.125;
    L += luminance(texture(u_texture, uv + vec2( 3.25,  3.25) * u_texel_size).rgb) * 0.0625;
    float luma = L;

    // (b2) Center-radial obscuring — wide blur + chunky mosaic, both
    // strongest at the screen center and fading smoothly to crisp at
    // the perimeter. Single circular falloff anchored at frame center
    // (0.5, 0.5). Per user request: drop the prior fixed eye-band
    // heuristic (it produced an immovable highly-pixelated strip that
    // didn't follow the user's actual eye position) AND drop the
    // perimeter horizontal blur from old (b3) (it was treating the
    // edges — the opposite of what's wanted now). The vignette is a
    // cheap, honest substitute for face tracking: in centered video-
    // call framing the face sits roughly under the high-weight zone,
    // but the obscuring is anchored to the screen, not the face.
    float r = length(v_texcoord - vec2(0.5, 0.5));
    float centerWeight = 1.0 - smoothstep(0.05, 0.65, r);

    // Wide blur — 4-tap diagonal at 3.9-texel offset (was 3.0 —
    // boosted by 30% per user request for "30% more blur"), mixed
    // by centerWeight at peak weight 0.93 (was 0.85 — bumped ~10%
    // per user request for "more blur towards center") so the screen
    // center reads heavily blurred while the perimeter stays close
    // to the (b1) Gaussian baseline.
    float Lwide = 0.25 * (
      luminance(texture(u_texture, uv + vec2(-3.9, -3.9) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2( 3.9, -3.9) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2(-3.9,  3.9) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2( 3.9,  3.9) * u_texel_size).rgb)
    );
    luma = mix(luma, Lwide, centerWeight * 0.93);

    // 10-texel mosaic with 6-level dithered quantization (was 8 —
    // bumped 25% per user request for "a bit larger" cells), mixed by
    // centerWeight at peak weight 0.7. The quantize block has been
    // reworked to eliminate the "big black squares on faces"
    // artifact the user reported:
    //   1. 6 bands instead of 4 — finer luma steps mean fewer cells
    //      land in the bottom band that drops to pure black.
    //   2. Per-cell hash dither — each mosaic cell gets a stable
    //      pseudo-random threshold offset from its cell ID, so
    //      adjacent cells with the SAME source luma can land in
    //      DIFFERENT quantize bands when that luma sits near a band
    //      boundary. Big contiguous dark regions get broken up into
    //      a speckle of mixed-shade cells instead of a solid block.
    //   3. Quantize-range compression to [0.18, 0.95] — even the
    //      darkest possible mosaic cell stays just above the stage
    //      (c) smoothstep(0.15, 0.95) floor, so no quantized cell
    //      can map to pure u_color_dark post-(c). The chunky
    //      pixel-art look is preserved (the mosaic-cell snap still
    //      creates the hard boundaries that survive the duotone),
    //      but the artifact-style solid-black 8×8 blocks can no
    //      longer appear in skin / shadow areas.
    if (centerWeight > 0.001) {
      vec2 mosaicCell = u_texel_size * 10.0;
      vec2 cellID = floor(uv / mosaicCell);
      vec2 mosaicUV = cellID * mosaicCell + mosaicCell * 0.5;
      float Lmosaic = luminance(texture(u_texture, mosaicUV).rgb);
      float cellHash = fract(sin(dot(cellID, vec2(12.9898, 78.233))) * GOLD_HASH_MULT);
      float quant = (floor(Lmosaic * 6.0 + cellHash) + 0.5) / 6.0;
      Lmosaic = mix(0.18, 0.95, clamp(quant, 0.0, 1.0));
      luma = mix(luma, Lmosaic, centerWeight * 0.7);
    }

    // Post-mosaic soft blur — a SECOND wide blur (6.5-texel diagonal
    // offset, wider than the 3.9-texel pre-mosaic Lwide above; was
    // 5.0 — boosted by 30% per user request for "30% more blur")
    // applied AFTER the mosaic step and scaled by the same
    // centerWeight at peak weight 0.93 (was 0.85 — bumped ~10% per
    // user request for "more blur towards center"). In the same
    // center-perimeter ratio as the pixelation, this softens the
    // chunky mosaic blocks at the screen center into smooth blobby
    // shapes (the blocks don't disappear, they just blur together)
    // while the perimeter stays crisp. At the dead center, 93% of
    // the value is the soft source-blur, which makes any remaining
    // "block" character very soft-edged.
    float Lsoft = 0.25 * (
      luminance(texture(u_texture, uv + vec2(-6.5, -6.5) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2( 6.5, -6.5) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2(-6.5,  6.5) * u_texel_size).rgb) +
      luminance(texture(u_texture, uv + vec2( 6.5,  6.5) * u_texel_size).rgb)
    );
    luma = mix(luma, Lsoft, centerWeight * 0.93);

    // (c) Background luma collapse. smoothstep(0.15, 0.95) clamps deep
    // shadow to flat dark and specular highlight to flat light,
    // collapsing the "room fingerprint" side channel (LED spectrum,
    // wallpaper, posters, time-of-day shadow geometry) without
    // destroying skin tones — the band is wide enough that most face
    // luminance values pass through the linear region.
    luma = smoothstep(0.15, 0.95, luma);

    // (d) Per-frame threshold jitter. Hash from frame coord + time
    // produces noise decorrelated across frames. ±2.5% on luma kills
    // multi-frame averaging — an attacker can no longer accumulate N
    // gold frames into one near-clean face — without making the
    // duotone visibly tremble at video framerate.
    float jh = fract(sin(dot(v_texcoord * GOLD_TC_SCALE, vec2(12.9898, 78.233)) + GOLD_TIME(u_time) * 60.0) * GOLD_HASH_MULT);
    luma = clamp(luma + (jh - 0.5) * 0.05, 0.0, 1.0);

    // (e) Stochastic ordered dither at the duotone boundary, scaled
    // by the same screen-center-radial centerWeight from stage (b2).
    // The dither amplitude follows the same vignette: ±0.25% at the
    // perimeter (essentially crisp) and ±5.75% at the screen center
    // (dense pixel-grid noise on top of the 8-texel mosaic). This
    // keeps the "progressively less obscuring toward the perimeter"
    // gradient consistent across blur, mosaic, AND dither so the
    // three effects fade together rather than fighting each other.
    // Honesty note: this leaves the perimeter with very little
    // anti-deblock / anti-super-resolution entropy. That's a
    // deliberate aesthetic-vs-anti-SR trade per user request — the
    // (a) wider Gaussian still applies everywhere and provides the
    // baseline smoothing defense outside the high-weight zone.
    vec2 ditherCoord = floor(v_texcoord / u_texel_size);
    float ditherNoise = fract(sin(dot(ditherCoord, vec2(12.9898, 78.233))) * GOLD_HASH_MULT) - 0.5;
    float ditherAmp = 0.005 + centerWeight * 0.055;
    luma = clamp(luma + ditherNoise * ditherAmp, 0.0, 1.0);

    vec3 color = mix(u_color_dark, u_color_light, luma);
    outColor = vec4(color, 1.0);

  } else if (u_mode == 2) {
    vec2 gridSize = vec2(40.0, 30.0);
    vec2 cell = floor(v_texcoord * gridSize) / gridSize;
    vec2 cellCenter = cell + 0.5 / gridSize;
    vec3 color = texture(u_texture, cellCenter).rgb;
    float luma = luminance(color);
    vec3 pxDark = vec3(0.118, 0.102, 0.078);
    vec3 pxLight = vec3(0.784, 0.353, 0.0);
    outColor = vec4(mix(pxDark, pxLight, luma), 1.0);

  } else if (u_mode == 3) {
    float tl = luminance(texture(u_texture, v_texcoord + vec2(-1.0, -1.0) * u_texel_size).rgb);
    float t  = luminance(texture(u_texture, v_texcoord + vec2( 0.0, -1.0) * u_texel_size).rgb);
    float tr = luminance(texture(u_texture, v_texcoord + vec2( 1.0, -1.0) * u_texel_size).rgb);
    float l  = luminance(texture(u_texture, v_texcoord + vec2(-1.0,  0.0) * u_texel_size).rgb);
    float r  = luminance(texture(u_texture, v_texcoord + vec2( 1.0,  0.0) * u_texel_size).rgb);
    float bl = luminance(texture(u_texture, v_texcoord + vec2(-1.0,  1.0) * u_texel_size).rgb);
    float b  = luminance(texture(u_texture, v_texcoord + vec2( 0.0,  1.0) * u_texel_size).rgb);
    float br = luminance(texture(u_texture, v_texcoord + vec2( 1.0,  1.0) * u_texel_size).rgb);
    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
    float edge = sqrt(gx*gx + gy*gy);
    float threshold = step(0.15, edge);
    outColor = vec4(vec3(threshold), 1.0);

  } else if (u_mode == 4) {
    float luma = blurredLuma();
    float mask = smoothstep(0.25, 0.35, luma);
    vec3 bg = vec3(0.039, 0.035, 0.031);
    vec3 fg = vec3(0.85, 0.85, 0.85);
    outColor = vec4(mix(bg, fg, mask), 1.0);

  } else if (u_mode == 5) {
    vec2 cellSize = vec2(3.0 / 320.0, 5.0 / 240.0);
    vec2 cellCoord = floor(v_texcoord / cellSize);
    vec2 cellCenter = (cellCoord + 0.5) * cellSize;
    vec2 halfCell = cellSize * 0.25;
    float luma = (
      luminance(texture(u_texture, cellCenter + vec2(-halfCell.x, -halfCell.y)).rgb) +
      luminance(texture(u_texture, cellCenter + vec2( halfCell.x, -halfCell.y)).rgb) +
      luminance(texture(u_texture, cellCenter + vec2(-halfCell.x,  halfCell.y)).rgb) +
      luminance(texture(u_texture, cellCenter + vec2( halfCell.x,  halfCell.y)).rgb)
    ) * 0.25;
    float charIndex = clamp(floor(luma * 16.0), 0.0, 15.0);
    vec2 localUV = fract(v_texcoord / cellSize);
    float atlasX = (charIndex + localUV.x) / 16.0;
    float atlasY = localUV.y;
    float charAlpha = texture(u_font_atlas, vec2(atlasX, atlasY)).r;
    vec3 bg = vec3(0.039, 0.035, 0.031);
    vec3 fg = vec3(0.910, 0.635, 0.000);
    outColor = vec4(mix(bg, fg, charAlpha), 1.0);

  } else {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}`;

function makePipelineError(message: string): Error {
  const err = new Error(message);
  err.name = "PipelineError";
  return err;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw makePipelineError("Failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw makePipelineError(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string
): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw makePipelineError("Failed to create WebGL program");
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw makePipelineError(`Program link error: ${log}`);
  }
  return prog;
}

// ── Recording-honesty watermark ──────────────────────────────────────────────
//
// The watermark is a small, semi-transparent overlay burned into every
// outgoing video frame. It carries a short room identifier, a wall-clock
// timestamp, and the local peer's tag (e.g. `PEER-ABC123`). The intent is
// twofold: signal to the recipient that the room itself is treating
// recording as plausible, and make any leaked recording attributable to
// a specific peer in a specific room at a specific time. We do not store
// any mapping between the peer tag and a real identity — that mapping,
// if a host wants it, must be made manually during the call.
//
// The text-formatting and draw helpers are exported so the screen-share
// compositor and the unit tests can reuse them without going through the
// full pipeline (jsdom does not implement the canvas 2D API end-to-end,
// so these helpers are designed to accept a minimal context shape).
export interface WatermarkInfo {
  roomId: string;
  peerTag: string;
}

export function formatWatermarkTimestamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function formatWatermarkText(info: WatermarkInfo, ms: number): string {
  return `${info.roomId} · ${formatWatermarkTimestamp(ms)} · ${info.peerTag}`;
}

// Minimal subset of CanvasRenderingContext2D the watermark draw needs.
// Defined explicitly so the unit test can pass a recorder without
// instantiating a real canvas (jsdom does not provide one).
export interface WatermarkDrawContext {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textBaseline: CanvasTextBaseline;
  measureText(text: string): { width: number };
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export function drawWatermark(
  ctx: WatermarkDrawContext,
  width: number,
  height: number,
  info: WatermarkInfo,
  nowMs: number = Date.now(),
): void {
  const text = formatWatermarkText(info, nowMs);
  // Scale font with the smaller of width/height so a 320×240 camera frame
  // and a 1920×1080 screen-share frame both end up with a legible-but-not-
  // dominating overlay.
  const fontSize = Math.max(10, Math.round(Math.min(width, height) * 0.04));
  ctx.font = `${fontSize}px monospace`;
  ctx.textBaseline = "top";

  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const metrics = ctx.measureText(text);
  const textW = metrics.width;
  const textH = fontSize * 1.2;

  // Bottom-right corner with a small inset so the overlay isn't flush with
  // the frame edge (some downstream encoders crop a few pixels).
  const inset = Math.round(fontSize * 0.5);
  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;
  const x = Math.max(0, width - boxW - inset);
  const y = Math.max(0, height - boxH - inset);

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, boxW, boxH);

  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillText(text, x + padX, y + padY);
}

function generateFontAtlas(): HTMLCanvasElement {
  const chars = " .:-=+*#%@WMBN&$";
  const cellW = 3;
  const cellH = 5;
  const atlasCanvas = document.createElement("canvas");
  atlasCanvas.width = cellW * 16;
  atlasCanvas.height = cellH;
  const ctx = atlasCanvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `${cellH}px monospace`;
  ctx.textBaseline = "top";
  for (let i = 0; i < 16; i++) {
    const ch = i < chars.length ? chars[i] : "#";
    ctx.fillText(ch, i * cellW, 0);
  }
  return atlasCanvas;
}

export interface MediaPipeline {
  processedStream: MediaStream;
  rawStream: MediaStream;
  gainNode: GainNode;
  canvas: HTMLCanvasElement;
  analyser: AnalyserNode;
  stop: () => void;
  setVideoStyle: (mode: VideoStyle) => void;
  setVoiceMode: (mode: number) => void;
  enableMonitor: () => void;
  disableMonitor: () => void;
  // Set or clear the recording-honesty watermark burned into the outgoing
  // camera-derived video. Pass `null` to remove the overlay (e.g. before
  // the room is fully joined so we never burn an empty placeholder tag).
  setWatermark: (info: WatermarkInfo | null) => void;
}

export interface MediaPipelineOptions {
  audioDeviceId?: string;
  // Task #522: runtime error surface for failures that can only be
  // detected after the pipeline has started rendering. The pipeline's
  // construction-time errors continue to throw from buildMediaPipeline
  // as before; this callback exists solely so post-construction
  // failures can reach the same `mapPipelineErrorToLabel` path instead
  // of silently emitting a blank video track to peers.
  //
  // Task #526: the GOLD blank-canvas sanity check no longer fires
  // through this surface — see `onVideoStyleDisabled` below.
  onError?: (err: Error) => void;
  // Task #526: post-construction signal that a specific VideoStyle has
  // been disabled in-pipeline (currently only GOLD via the blank-frame
  // sanity check). The pipeline keeps streaming, silently switches off
  // the disabled mode if the user was on it, and coerces subsequent
  // `setVideoStyle(disabled)` calls back to passthrough. This callback
  // lets the React side mirror the flag so the style-cycle button can
  // skip the now-unavailable mode.
  onVideoStyleDisabled?: (mode: VideoStyle) => void;
}

const CANVAS_W = 320;
const CANVAS_H = 240;

export async function buildMediaPipeline(
  audioCtx: AudioContext,
  opts?: MediaPipelineOptions
): Promise<MediaPipeline> {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error("Camera/mic not available in this browser");
    err.name = "NotSupportedError";
    throw err;
  }

  // Stack of cleanup actions for partial allocations. If construction
  // throws after any allocation but before the MediaPipeline object is
  // returned, we run these in reverse so the caller is not left
  // holding leaked tracks, DOM nodes, or WebGL contexts.
  const cleanups: Array<() => void> = [];
  const runCleanups = () => {
    while (cleanups.length) {
      const fn = cleanups.pop()!;
      try { fn(); } catch {}
    }
  };

  let rawStream: MediaStream;
  try {
    rawStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 },
        facingMode: "user",
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(opts?.audioDeviceId ? { deviceId: { exact: opts.audioDeviceId } } : {}),
      },
    });
  } catch (firstErr) {
    rawStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
  }
  cleanups.push(() => rawStream.getTracks().forEach((t) => t.stop()));

  const rawVideoTrack = rawStream.getVideoTracks()[0];
  const rawAudioTrack = rawStream.getAudioTracks()[0];

  if (!rawVideoTrack || !rawAudioTrack) {
    runCleanups();
    const missing = !rawVideoTrack ? "camera" : "microphone";
    const err = new Error(`No ${missing} track available`);
    err.name = "NotFoundError";
    throw err;
  }

  try {
    return await buildMediaPipelineInner(audioCtx, rawStream, rawVideoTrack, rawAudioTrack, cleanups, opts?.onError, opts?.onVideoStyleDisabled);
  } catch (err) {
    runCleanups();
    throw err;
  }
}

async function buildMediaPipelineInner(
  audioCtx: AudioContext,
  rawStream: MediaStream,
  rawVideoTrack: MediaStreamTrack,
  rawAudioTrack: MediaStreamTrack,
  cleanups: Array<() => void>,
  onError?: (err: Error) => void,
  onVideoStyleDisabled?: (mode: VideoStyle) => void,
): Promise<MediaPipeline> {

  const srcVideo = document.createElement("video");
  srcVideo.srcObject = new MediaStream([rawVideoTrack]);
  srcVideo.muted = true;
  srcVideo.autoplay = true;
  srcVideo.playsInline = true;
  srcVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999";
  document.body.appendChild(srcVideo);
  cleanups.push(() => { srcVideo.srcObject = null; srcVideo.remove(); });
  await srcVideo.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  canvas.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999";
  document.body.appendChild(canvas);
  cleanups.push(() => canvas.remove());

  const glOrNull = canvas.getContext("webgl2", { preserveDrawingBuffer: true })
    || canvas.getContext("webgl2");
  if (!glOrNull) {
    const err = new Error("WebGL2 not supported by this browser");
    err.name = "PipelineError";
    throw err;
  }
  const gl: WebGL2RenderingContext = glOrNull;
  cleanups.push(() => {
    const loseCtx = gl.getExtension("WEBGL_lose_context");
    if (loseCtx) loseCtx.loseContext();
  });

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);

  const quadVerts = new Float32Array([
    -1, -1,  1, -1, -1,  1,
    -1,  1,  1, -1,  1,  1,
  ]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

  const posLoc = gl.getAttribLocation(program, "a_position");
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fontAtlasCanvas = generateFontAtlas();
  const fontAtlasTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, fontAtlasTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fontAtlasCanvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  gl.useProgram(program);
  const texLoc = gl.getUniformLocation(program, "u_texture");
  const fontAtlasLoc = gl.getUniformLocation(program, "u_font_atlas");
  const modeLoc = gl.getUniformLocation(program, "u_mode");
  const colorDarkLoc = gl.getUniformLocation(program, "u_color_dark");
  const colorLightLoc = gl.getUniformLocation(program, "u_color_light");
  const texelSizeLoc = gl.getUniformLocation(program, "u_texel_size");
  const timeLoc = gl.getUniformLocation(program, "u_time");

  gl.uniform1i(texLoc, 0);
  gl.uniform1i(fontAtlasLoc, 1);

  let currentMode: VideoStyle = 0;

  gl.uniform1i(modeLoc, currentMode);
  gl.uniform3f(colorDarkLoc, 0x1E / 255, 0x1A / 255, 0x14 / 255);
  gl.uniform3f(colorLightLoc, 0xE8 / 255, 0xA2 / 255, 0x00 / 255);
  gl.uniform2f(texelSizeLoc, 1.0 / CANVAS_W, 1.0 / CANVAS_H);
  gl.uniform1f(timeLoc, 0.0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, fontAtlasTex);
  gl.activeTexture(gl.TEXTURE0);

  // 2D compositor sits downstream of the WebGL pass and is the canvas the
  // outgoing track is captured from. Each frame: drawImage(webglCanvas) →
  // optional watermark overlay → captureStream. Keeping the watermark out
  // of the GL fragment shader keeps shader changes (style switches, etc.)
  // independent of attribution concerns.
  const compositor = document.createElement("canvas");
  compositor.width = CANVAS_W;
  compositor.height = CANVAS_H;
  compositor.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999";
  document.body.appendChild(compositor);
  cleanups.push(() => compositor.remove());
  const compositorCtxOrNull = compositor.getContext("2d");
  if (!compositorCtxOrNull) {
    throw makePipelineError("2D context unavailable for video compositor");
  }
  // Bind to a non-nullable local so the render-loop closure (which TS
  // does not flow-narrow through the throw above) sees the right type.
  const compositorCtx: CanvasRenderingContext2D = compositorCtxOrNull;

  let watermark: WatermarkInfo | null = null;

  const FRAME_INTERVAL = 1000 / 15;
  let lastFrameTime = 0;
  let rafId = 0;
  let stopped = false;
  const startTime = performance.now();

  // Task #522: GOLD blank-canvas sanity check. The shader was hardened
  // for strict-mediump GPUs (highp where supported, mediump-safe
  // fallback below it), but if some future device STILL produces an
  // all-zero frame for GOLD we want to fail loudly via `onError`
  // instead of silently emitting a blank video track. The check is a
  // one-time `gl.readPixels` of a small region per GOLD activation: a
  // counter is reset every time setVideoStyle(1) is called, the
  // pipeline renders a few warm-up frames so the source video can
  // arrive (`srcVideo.readyState` may already be >= 2 by then), then
  // one read happens on the next GOLD frame. The check is gated by
  // both `goldSanityNeeded` (cleared after the read fires) and the
  // mode being GOLD on the frame the read happens, so switching away
  // before the check fires simply skips it.
  let goldSanityNeeded = false;
  let goldSanityFramesSeen = 0;
  let goldSanityFired = false;
  // Task #526: in-pipeline disable flag for GOLD. Set when the sanity
  // check trips; once set, `setVideoStyle(1)` is coerced back to 0 so
  // a stale cycle press from the UI cannot re-arm a known-bad mode.
  let goldDisabled = false;
  // Read a 4×4 region near the canvas centre — large enough that a
  // genuine all-zero output cannot be confused with a single dark
  // mosaic pixel, small enough that the readPixels cost is trivial.
  const GOLD_SANITY_SAMPLE = 4;
  const GOLD_SANITY_X = Math.floor((CANVAS_W - GOLD_SANITY_SAMPLE) / 2);
  const GOLD_SANITY_Y = Math.floor((CANVAS_H - GOLD_SANITY_SAMPLE) / 2);
  // Warm-up: skip the first 2 GOLD frames so `texImage2D(srcVideo)`
  // has definitely uploaded a non-blank source frame at least once
  // before we judge the output.
  const GOLD_SANITY_WARMUP_FRAMES = 2;
  const goldSanityBuf = new Uint8Array(GOLD_SANITY_SAMPLE * GOLD_SANITY_SAMPLE * 4);

  function render(timestamp: number) {
    if (stopped) return;
    rafId = requestAnimationFrame(render);

    if (timestamp - lastFrameTime < FRAME_INTERVAL) return;
    if (srcVideo.readyState < 2) return;
    lastFrameTime = timestamp;

    gl.viewport(0, 0, CANVAS_W, CANVAS_H);
    gl.useProgram(program);
    gl.uniform1i(modeLoc, currentMode);
    gl.uniform1f(timeLoc, (timestamp - startTime) / 1000.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcVideo);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    if (goldSanityNeeded && currentMode === 1) {
      if (goldSanityFramesSeen < GOLD_SANITY_WARMUP_FRAMES) {
        goldSanityFramesSeen++;
      } else {
        goldSanityNeeded = false;
        try {
          gl.readPixels(
            GOLD_SANITY_X, GOLD_SANITY_Y,
            GOLD_SANITY_SAMPLE, GOLD_SANITY_SAMPLE,
            gl.RGBA, gl.UNSIGNED_BYTE, goldSanityBuf,
          );
          let allZero = true;
          for (let i = 0; i < goldSanityBuf.length; i += 4) {
            if (goldSanityBuf[i] !== 0 || goldSanityBuf[i + 1] !== 0 || goldSanityBuf[i + 2] !== 0) {
              allZero = false;
              break;
            }
          }
          if (allZero && !goldSanityFired) {
            goldSanityFired = true;
            // Task #526: instead of stopping the outgoing track and
            // raising a PipelineError (which kills the user's camera
            // mid-call), silently disable GOLD: flip the in-pipeline
            // flag, snap the current mode back to passthrough so the
            // next frame is non-blank, and notify the React side so
            // it can skip GOLD in the cycle button. The render loop
            // continues so every other style keeps working.
            goldDisabled = true;
            if (currentMode === 1) {
              currentMode = 0;
            }
            if (onVideoStyleDisabled) {
              try { onVideoStyleDisabled(1); } catch { /* noop */ }
            }
          }
        } catch {
          // readPixels failure is non-fatal: skip the sanity check
          // rather than block the call. The user still sees whatever
          // the GL canvas produced; if that is genuinely blank,
          // they will report it and we revisit then.
        }
      }
    }

    // Composite WebGL output → 2D canvas → watermark.
    compositorCtx.drawImage(canvas, 0, 0, CANVAS_W, CANVAS_H);
    if (watermark) {
      drawWatermark(compositorCtx, CANVAS_W, CANVAS_H, watermark);
    }
  }

  rafId = requestAnimationFrame(render);
  cleanups.push(() => { stopped = true; cancelAnimationFrame(rafId); });

  const canvasStream = compositor.captureStream(15);
  const processedVideoTrack = canvasStream.getVideoTracks()[0];

  // ── Audio pipeline ───────────────────────────────────────────────────────────
  const micSource = audioCtx.createMediaStreamSource(
    new MediaStream([rawAudioTrack])
  );
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0.8;

  const highpass = audioCtx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 300;
  const lowpass = audioCtx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 8000;
  const audioDest = audioCtx.createMediaStreamDestination();

  // Voice-mask AudioWorklet. The processor runs on a dedicated audio
  // rendering thread, isolated from the main JS thread. The cache-bust
  // query string (`?v=__VOICE_MASK_VERSION__`) is load-bearing — the
  // browser caches worklet modules aggressively, and a stale processor
  // silently runs the OLD masking algorithm against the NEW pipeline.
  // The version constant is replaced at build time via Vite's `define`.
  // The try / catch tolerates worklet-add failures (older Safari, file
  // URL contexts) by leaving `voiceMaskNode = null`; the audio graph
  // below skips the node and the user sees the unprocessed mic. Worklet
  // teardown ordering is documented at L595–L600 (port closed first so
  // the worklet thread can release its message channel BEFORE the audio
  // graph is torn down — reversing the order leaks the channel).
  // (Indexed in docs/code-quirks-index.md.)
  let voiceMaskNode: AudioWorkletNode | null = null;

  try {
    const moduleUrl = import.meta.env.BASE_URL + "voice-mask-processor.js?v=" + __VOICE_MASK_VERSION__;
    await audioCtx.audioWorklet.addModule(moduleUrl);
    voiceMaskNode = new AudioWorkletNode(audioCtx, "voice-mask", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
  } catch {
    voiceMaskNode = null;
  }

  micSource.connect(gainNode);
  gainNode.connect(highpass);
  if (voiceMaskNode) {
    highpass.connect(voiceMaskNode);
    voiceMaskNode.connect(lowpass);
  } else {
    highpass.connect(lowpass);
  }

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  lowpass.connect(analyser);
  analyser.connect(audioDest);

  const monitorGain = audioCtx.createGain();
  monitorGain.gain.value = 0;
  analyser.connect(monitorGain);
  monitorGain.connect(audioCtx.destination);
  let monitoring = false;

  const processedAudioTrack = audioDest.stream.getAudioTracks()[0];

  const processedStream = new MediaStream([
    processedVideoTrack,
    processedAudioTrack,
  ]);

  function setVideoStyle(mode: VideoStyle) {
    // Task #526: once GOLD has been disabled in-pipeline by the
    // sanity check, any further `setVideoStyle(1)` (a stale press of
    // the cycle button before the React side mirrors the disable,
    // for example) must coerce back to 0. This is the defensive
    // backstop: the UI also skips disabled modes, but the pipeline
    // refuses to re-arm a known-bad style no matter what the caller
    // asks for.
    if (mode === 1 && goldDisabled) {
      currentMode = 0;
      return;
    }
    // Task #522: arm the one-time GOLD blank-canvas sanity check on
    // every transition into GOLD. Resetting the warm-up counter (but
    // not `goldSanityFired`) means a user toggling away and back will
    // re-warm cleanly, while a device that has already failed the
    // check stays disabled — `goldDisabled` is set on the failure
    // path and the early-return above takes over.
    if (mode === 1) {
      goldSanityNeeded = true;
      goldSanityFramesSeen = 0;
    }
    currentMode = mode;
  }

  function setWatermark(info: WatermarkInfo | null) {
    watermark = info;
  }

  function setVoiceMode(mode: number) {
    if (!voiceMaskNode) return;
    voiceMaskNode.port.postMessage({ type: "mode", value: mode });
  }

  // Monitor-gain transitions are scheduled on `audioCtx.currentTime`
  // (the audio-rendering clock), NOT wall-clock or `setTimeout`. Web
  // Audio gain ramps must be scheduled on the audio clock to avoid
  // sample-boundary clicks; `setTimeout` also drifts on backgrounded
  // tabs. Do not rewrite as a wall-clock-driven assignment. (Indexed
  // in docs/code-quirks-index.md; Web Audio spec invariant, no task
  // ref.)
  function enableMonitor() {
    if (!monitoring) {
      monitorGain.gain.setTargetAtTime(0.3, audioCtx.currentTime, 0.05);
      monitoring = true;
    }
  }

  function disableMonitor() {
    if (monitoring) {
      monitorGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);
      monitoring = false;
    }
  }

  function stop() {
    stopped = true;
    disableMonitor();
    cancelAnimationFrame(rafId);
    rawStream.getTracks().forEach((t) => t.stop());
    processedStream.getTracks().forEach((t) => t.stop());
    srcVideo.srcObject = null;
    srcVideo.remove();
    canvas.remove();
    compositor.remove();
    gl.deleteTexture(texture);
    gl.deleteTexture(fontAtlasTex);
    gl.deleteBuffer(buf);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    const loseCtx = gl.getExtension("WEBGL_lose_context");
    if (loseCtx) loseCtx.loseContext();

    // Disconnect every audio node we wired into the caller's AudioContext
    // so that, even if the caller defers AudioContext.close() (or shares
    // the context with UI bleeps), there is no live mic→processed graph
    // left behind. We do not own the AudioContext itself — the session
    // owner closes it via closeAudioContext() once nothing here is
    // referencing it. The AudioWorkletNode's port is closed first so the
    // worklet thread can release its message channel before teardown.
    try { micSource.disconnect(); } catch {}
    try { gainNode.disconnect(); } catch {}
    try { highpass.disconnect(); } catch {}
    try { lowpass.disconnect(); } catch {}
    try { analyser.disconnect(); } catch {}
    try { monitorGain.disconnect(); } catch {}
    try { audioDest.disconnect(); } catch {}
    if (voiceMaskNode) {
      try { voiceMaskNode.port.close(); } catch {}
      try { voiceMaskNode.disconnect(); } catch {}
      voiceMaskNode = null;
    }
  }

  return {
    processedStream,
    rawStream,
    gainNode,
    canvas,
    analyser,
    stop,
    setVideoStyle,
    setVoiceMode,
    enableMonitor,
    disableMonitor,
    setWatermark,
  };
}

// ── Screen-share watermark wrapper ───────────────────────────────────────────
//
// Screen sharing replaces the outgoing video track via
// `WebRTCManager.replaceVideoTrack`, which bypasses the camera pipeline
// entirely. To keep recording-honesty attribution intact during a screen
// share, the source display track is wrapped in its own 2D compositor
// (drawImage(displayVideo) → drawWatermark → captureStream). The wrapper
// owns its hidden <video> element and canvas; callers must call `stop()`
// when the share ends so both are torn down.
export interface WatermarkedScreenShare {
  /** The watermarked video track to actually send to peers. */
  track: MediaStreamTrack;
  /** The MediaStream wrapping `track` (mostly for symmetry / debugging). */
  stream: MediaStream;
  /** Tear down compositor canvas, hidden video, and stop the output track. */
  stop: () => void;
}

export function createWatermarkedScreenShareTrack(
  sourceStream: MediaStream,
  getWatermark: () => WatermarkInfo | null,
  fps: number = 15,
): WatermarkedScreenShare {
  const sourceTrack = sourceStream.getVideoTracks()[0];
  if (!sourceTrack) {
    throw makePipelineError("Screen-share stream has no video track");
  }

  const settings = sourceTrack.getSettings();
  const initialWidth = (settings.width as number | undefined) ?? 1280;
  const initialHeight = (settings.height as number | undefined) ?? 720;

  const srcVideo = document.createElement("video");
  srcVideo.srcObject = new MediaStream([sourceTrack]);
  srcVideo.muted = true;
  srcVideo.autoplay = true;
  srcVideo.playsInline = true;
  srcVideo.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999";
  document.body.appendChild(srcVideo);
  void srcVideo.play().catch(() => {});

  const compositor = document.createElement("canvas");
  compositor.width = initialWidth;
  compositor.height = initialHeight;
  compositor.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-9999";
  document.body.appendChild(compositor);

  const ctxOrNull = compositor.getContext("2d");
  if (!ctxOrNull) {
    // Null srcObject before remove() so the hidden <video> drops its
    // reference to the source MediaStream — matches the stop() path
    // below and the equivalent throw paths in buildMediaPipelineInner.
    try { srcVideo.srcObject = null; } catch { /* noop */ }
    srcVideo.remove();
    compositor.remove();
    throw makePipelineError("2D context unavailable for screen-share compositor");
  }
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  const FRAME_INTERVAL = 1000 / fps;
  let lastFrame = 0;
  let stopped = false;
  let rafId = 0;

  function tick(ts: number) {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);
    if (ts - lastFrame < FRAME_INTERVAL) return;
    if (srcVideo.readyState < 2) return;

    const w = srcVideo.videoWidth || compositor.width;
    const h = srcVideo.videoHeight || compositor.height;
    if (compositor.width !== w || compositor.height !== h) {
      compositor.width = w;
      compositor.height = h;
    }
    lastFrame = ts;

    ctx.drawImage(srcVideo, 0, 0, compositor.width, compositor.height);
    const wm = getWatermark();
    if (wm) drawWatermark(ctx, compositor.width, compositor.height, wm);
  }

  rafId = requestAnimationFrame(tick);

  const outStream = compositor.captureStream(fps);
  const outTrack = outStream.getVideoTracks()[0];
  if (!outTrack) {
    cancelAnimationFrame(rafId);
    // Mirror stop()'s ordering: null srcObject before removing the
    // hidden <video> so it cannot keep the source MediaStream alive.
    try { srcVideo.srcObject = null; } catch { /* noop */ }
    srcVideo.remove();
    compositor.remove();
    throw makePipelineError("captureStream did not yield a video track");
  }

  // If the underlying screen-share track ends (user clicks "Stop sharing"
  // in the browser chrome), end our wrapped track too so the peer sees the
  // share end naturally.
  const onSourceEnded = () => {
    if (!stopped) {
      try { outTrack.stop(); } catch { /* noop */ }
    }
  };
  sourceTrack.addEventListener("ended", onSourceEnded);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(rafId);
    sourceTrack.removeEventListener("ended", onSourceEnded);
    try { outTrack.stop(); } catch { /* noop */ }
    try { srcVideo.srcObject = null; } catch { /* noop */ }
    srcVideo.remove();
    compositor.remove();
  }

  return { track: outTrack, stream: outStream, stop };
}
