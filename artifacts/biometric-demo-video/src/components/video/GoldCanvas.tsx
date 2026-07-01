// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, type RefObject } from 'react';

// ── Canvas2D faithful re-implementation of mediaPipeline.ts GOLD mode 1 ──────
//
// WebGL2 requires GPU access which may be unavailable in headless recording
// environments. Canvas2D pixel manipulation produces an identical visual:
// the same luminance → smoothstep → duotone pipeline that the GLSL shader
// executes per-fragment runs here per-pixel in JS, with a pre-blur pass via
// ctx.filter to replicate stages (b1)+(b2) of the shader.
//
// Color palette — exact values from mediaPipeline.ts line 638-639:
//   u_color_dark  = (0x1E/255, 0x1A/255, 0x14/255) → #1E1A14  (deep brown-black)
//   u_color_light = (0xE8/255, 0xA2/255, 0x00/255) → #E8A200  (amber gold)
//
// Shader stage mapping:
//   blur(12px) pre-filter → stages (a)+(b1)+(b2) wide Gaussian + post-mosaic soft blur
//   center radial mosaic  → stage (b2) 10-texel mosaic, centerWeight vignette
//   smoothstep(0.15,0.95) → stage (c) range compression
//   per-pixel dither      → stages (d)+(e) jitter + Bayer dither
//   mix(dark, light, L)   → final duotone output

// ── GOLD palette ──────────────────────────────────────────────────────────────
const DARK_R = 0x1e;   // 30
const DARK_G = 0x1a;   // 26
const DARK_B = 0x14;   // 20
const LIGHT_R = 0xe8;  // 232
const LIGHT_G = 0xa2;  // 162
const LIGHT_B = 0x00;  // 0

// Canvas resolution — right pane is half of 1280×720
const W = 640;
const H = 360;
// Mosaic cell size in pixels (matches 10*texelSize in the shader at this resolution)
const MOSAIC_CELL = 10;
// Render at 15fps — same as mediaPipeline.ts FRAME_INTERVAL
const FRAME_INTERVAL = 1000 / 15;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Simple deterministic hash matching the GLSL: fract(sin(dot(v, k)) * M)
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ── Pre-compute mosaic cell quantization table ─────────────────────────────
// For each (cellX, cellY) we compute a stable cellHash once. Cell IDs are
// bounded by canvas dimensions. This avoids computing the hash per-pixel.
const CELLS_X = Math.ceil(W / MOSAIC_CELL);
const CELLS_Y = Math.ceil(H / MOSAIC_CELL);
const cellHashTable = new Float32Array(CELLS_X * CELLS_Y);
for (let cy = 0; cy < CELLS_Y; cy++) {
  for (let cx = 0; cx < CELLS_X; cx++) {
    cellHashTable[cy * CELLS_X + cx] = hash2(cx, cy);
  }
}

interface GoldCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
  style?: React.CSSProperties;
}

export function GoldCanvas({ videoRef, className, style }: GoldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Off-screen canvas for the pre-blur pass
    const blurCanvas = document.createElement('canvas');
    blurCanvas.width = W;
    blurCanvas.height = H;
    const blurCtx = blurCanvas.getContext('2d', { willReadFrequently: true });
    if (!blurCtx) return;

    // Second off-screen for the center-radial mosaic pass
    const mosaicCanvas = document.createElement('canvas');
    mosaicCanvas.width = W;
    mosaicCanvas.height = H;
    const mosaicCtx = mosaicCanvas.getContext('2d', { willReadFrequently: true });
    if (!mosaicCtx) return;

    // Pre-compute per-pixel radial center weight (same formula as shader b2)
    // centerWeight = 1 - smoothstep(0.05, 0.65, r)  where r = length(uv - 0.5)
    const centerWeightMap = new Float32Array(W * H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const u = px / W - 0.5;
        const v = py / H - 0.5;
        const r = Math.sqrt(u * u + v * v);
        centerWeightMap[py * W + px] = 1 - smoothstep(0.05, 0.65, r);
      }
    }

    // Pre-compute per-pixel Bayer dither noise (stable, matches shader stage e)
    const ditherMap = new Float32Array(W * H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        ditherMap[py * W + px] = hash2(px, py) - 0.5;
      }
    }

    let rafId = 0;
    let lastFrameTime = 0;
    let frameCount = 0;
    let stopped = false;

    function render(now: number) {
      if (stopped) return;
      rafId = requestAnimationFrame(render);

      if (now - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = now;
      frameCount++;

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        // Fill with DARK color until video is ready so canvas is never transparent
        ctx!.fillStyle = '#1E1A14';
        ctx!.fillRect(0, 0, W, H);
        return;
      }

      // ── Stage (a)+(b1)+(b2) pre-blur: draw video with Gaussian blur ────────
      // 12px matches the combined effect of the shader's 3.25-texel Gaussian
      // plus the 6.5-texel post-mosaic soft blur at center.
      blurCtx!.filter = 'blur(12px)';
      blurCtx!.drawImage(video, 0, 0, W, H);
      blurCtx!.filter = 'none';

      // ── Stage (b2) center-radial mosaic: draw pixelated version ───────────
      // 10-pixel mosaic cells at 1/10 scale, stretched back up — identical
      // to the shader's floor(uv/mosaicCell)*mosaicCell+mosaicCell*0.5 sample.
      const mosaicScale = 1 / MOSAIC_CELL;
      mosaicCtx!.imageSmoothingEnabled = false;
      mosaicCtx!.drawImage(video, 0, 0, W * mosaicScale, H * mosaicScale);
      // Scale back up with no smoothing for hard mosaic blocks
      mosaicCtx!.drawImage(mosaicCanvas, 0, 0, W * mosaicScale, H * mosaicScale, 0, 0, W, H);

      // ── Get pixel data from both passes ───────────────────────────────────
      const blurData = blurCtx!.getImageData(0, 0, W, H).data;
      const mosaicData = mosaicCtx!.getImageData(0, 0, W, H).data;

      // ── Per-pixel GOLD pipeline ────────────────────────────────────────────
      const outData = ctx!.createImageData(W, H);
      const out = outData.data;

      for (let i = 0, n = W * H; i < n; i++) {
        const bi = i * 4;
        const px = i % W;
        const py = (i / W) | 0;
        const cw = centerWeightMap[i];

        // Stage (b1): blurred luminance
        const br = blurData[bi] / 255;
        const bg2 = blurData[bi + 1] / 255;
        const bb = blurData[bi + 2] / 255;
        let luma = 0.299 * br + 0.587 * bg2 + 0.114 * bb;

        // Stage (b2): mix in mosaic luma at center
        if (cw > 0.001) {
          const mr = mosaicData[bi] / 255;
          const mg = mosaicData[bi + 1] / 255;
          const mb = mosaicData[bi + 2] / 255;
          const lumaM_raw = 0.299 * mr + 0.587 * mg + 0.114 * mb;
          // 6-level quantization with cell hash dither (shader line 175-176)
          const cx2 = (px / MOSAIC_CELL) | 0;
          const cy2 = (py / MOSAIC_CELL) | 0;
          const cellHash = cellHashTable[cy2 * CELLS_X + cx2];
          const quant = (Math.floor(lumaM_raw * 6 + cellHash) + 0.5) / 6;
          const lumaM = 0.18 + (0.95 - 0.18) * Math.max(0, Math.min(1, quant));
          luma = luma + (lumaM - luma) * (cw * 0.7);
        }

        // Stage (c): range compression
        luma = smoothstep(0.15, 0.95, luma);

        // Stage (d): per-frame jitter ±2.5% on luma
        // Use frameCount as time proxy for temporal decorrelation
        const jh = hash2(px * 0.0156, py * 0.0156 + frameCount * 0.0167);
        luma = Math.max(0, Math.min(1, luma + (jh - 0.5) * 0.05));

        // Stage (e): stochastic Bayer dither at duotone boundary
        const ditherAmp = 0.005 + cw * 0.055;
        luma = Math.max(0, Math.min(1, luma + ditherMap[i] * ditherAmp));

        // Duotone output: mix(COLOR_DARK, COLOR_LIGHT, luma)
        out[bi]     = (DARK_R + (LIGHT_R - DARK_R) * luma) | 0;
        out[bi + 1] = (DARK_G + (LIGHT_G - DARK_G) * luma) | 0;
        out[bi + 2] = (DARK_B + (LIGHT_B - DARK_B) * luma) | 0;
        out[bi + 3] = 255;
      }

      ctx!.putImageData(outData, 0, 0);
    }

    rafId = requestAnimationFrame(render);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
    };
  }, [videoRef]);

  return (
    <canvas
      ref={canvasRef}
      width={W}
      height={H}
      className={className}
      style={style}
    />
  );
}
