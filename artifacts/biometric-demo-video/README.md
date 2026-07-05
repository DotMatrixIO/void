# Demo 1 — Biometric Split-Screen Marketing Video

A ~30s programmatic marketing video for VOID's landing page. Split-screen:

- **LEFT** = a normal talking webcam feed (a face, eyes, lips — fully identifiable).
- **RIGHT** = the *same* feed through the VOID GOLD shader, where every biometric
  is obscured (presence survives, identity does not).

Output is rendered by recording the running React app, then encoding to MP4.

> **Status: this is "Plan B" for Demo 1.** The talking footage is AI-generated. The
> intended final version ("Plan A") replaces both panes with real footage the user
> supplies. See **[Next step: swap in real video](#next-step-swap-in-real-video)**.

---

## Outputs (committed to the landing site)

| File | Path | Spec |
| --- | --- | --- |
| Video | `artifacts/void-client/public/biometric-demo.mp4` | H.264, 1280×720, **no audio**, 29.52s, ~2.9 MB |
| Poster | `artifacts/void-client/public/biometric-demo-poster.jpg` | JPEG, captured at 12.3s, ~60 KB |

Embedded on the landing page via `artifacts/void-client/src/components/DemoVideoEmbed.tsx`
(locked to `aspect-ratio: 16/9`, so the embed never squeezes either).

---

## Settings / configuration

### Scene timeline (`src/components/video/VideoTemplate.tsx` → `SCENE_DURATIONS`)

| # | Key | Component | Duration | Window |
| --- | --- | --- | --- | --- |
| 1 | `intro` | `Scene1` | 3.0s | 0–3s |
| 2 | `scan` | `Scene2` | 8.0s | 3–11s |
| 3 | `caption1` | `Scene3` | 4.5s | 11–15.5s |
| 4 | `caption2` | `Scene4` | 4.5s | 15.5–20s |
| 5 | `caption3` | `Scene5` | 4.5s | 20–24.5s |
| 6 | `endCard` | `Scene6` | 5.0s | 24.5–29.5s |

During `scan`, both video panes freeze at 3.5s and resume at 6.5s (the
"analysis" beat). See the freeze/resume effect in `VideoTemplate.tsx`.

### Layout — locked landscape (16:9)

The stage is a centered 16:9 box with letterbox bars, so portrait phones never
squeeze it:

```
width:  min(100vw, calc(100vh * 16 / 9))
height: min(100vh, calc(100vw * 9 / 16))
```

### Layering — overlays must sit above the GOLD canvas (both panes)

The GOLD canvas paints at `z-index: 1`. The split-pane wrapper is given `z-0`
(this bounds the canvas inside its stacking context) and the foreground scenes
are wrapped in a `z-30` container. **If you add a new overlay box, render it
inside the foreground scene layer** — do not place it inside the right pane, or
the canvas will cover it (this was the original "boxes only show on the left" bug).

### GOLD shader (`src/components/video/GoldCanvas.tsx`)

Canvas2D pixel-manipulation port of `artifacts/void-client/src/lib/mediaPipeline.ts`
mode 1 (GOLD). Canvas2D is used (not WebGL2) because WebGL2 fails under the
`--disable-gpu` flag the recorder needs. Pipeline: blur(12px) prefilter →
radial Gaussian blur → 10px center-radial mosaic + 6-level cell-hash
quantization → smoothstep(0.15, 0.95) → temporal jitter → Bayer dither →
duotone `mix(#1E1A14 dark, #E8A200 amber)`.

### Source footage

`public/images/webcam-talking.webm` — 24s VP9/WebM, an 8s AI talking clip looped
3×. Both panes load this same file (proving it's the same feed). Set via
`VIDEO_SRC` in `VideoTemplate.tsx`.

### Color palette

| Use | Hex |
| --- | --- |
| Background | `#14110D` |
| GOLD amber (light) | `#E8A200` / UI `#F0A500` |
| GOLD dark | `#1E1A14` |
| Amber dim | `#C4850A` |
| Capture/alert red (left pane) | `#CC2200` |

---

## How to re-record

1. Ensure the `artifacts/biometric-demo-video: web` workflow is running
   (default port **22687** — confirm in the workflow logs if the preview moved).
2. Run the recorder from a workspace that has `@playwright/test`:
   ```bash
   cp artifacts/biometric-demo-video/scripts/record-biometric.mjs artifacts/void-client/record-biometric.mjs
   (cd artifacts/void-client && node record-biometric.mjs)
   rm artifacts/void-client/record-biometric.mjs
   ```
3. Copy outputs into the landing site and shrink the poster under 100 KB:
   ```bash
   cp /tmp/biometric-demo.mp4 artifacts/void-client/public/biometric-demo.mp4
   ffmpeg -y -i /tmp/biometric-demo-poster.jpg -q:v 8 /tmp/poster-final.jpg
   cp /tmp/poster-final.jpg artifacts/void-client/public/biometric-demo-poster.jpg
   ```
4. Validate: `bash artifacts/biometric-demo-video/scripts/validate-recording.sh`

Recorder knobs live at the top of `scripts/record-biometric.mjs` (`POSTER_AT`,
`TOTAL`, viewport, CRF).

---

## All on-screen text (for revision)

**Persistent labels (whole video)**
- Left pane: `NORMAL WEBCAM` · `REC`
- Right pane: `VOID` · `LIVE`

**Scene 1 — Intro:** _no text_ (split-screen reveal)

**Scene 2 — Scan**
- Left (captured): `FACE: CAPTURED` · `IRIS: CAPTURED` · `LIP-READ: CAPTURED` · `ROOM CONTEXT: INDEXED`
- Right (failed): `FACE SCAN — NO BIOMETRIC FOUND —` · `IRIS SCAN — NO DATA —` · `LIP PATTERN — NO DATA —` · `CONTEXT SCAN — NOTHING IDENTIFIABLE —`
- Right (badge): `VOID SHIELD ACTIVE` / `Biometrics Stripped`

**Scene 3 — Caption 1:** `ONE FEED IDENTIFIES YOU.` / `ONE DOESN'T.`

**Scene 4 — Caption 2:** `PRESENCE SURVIVES.` / `BIOMETRICS DON'T.`

**Scene 5 — Caption 3:** `ENOUGH TO TRUST.` / `NOT ENOUGH TO SURVEIL.`

**Scene 6 — End card:** `VOID` / `THE ROOM BURNS DOWN.`

---

## Next step: swap in real video

Goal: replace the AI-generated footage with **real footage the user provides** —
one clip of someone actually talking (LEFT) and the VOID-filtered version (RIGHT).

Two ways to supply the right pane:

- **A. Pre-filtered clip (simplest):** the user provides a separate file that is
  already VOID-filtered. Add a second source (e.g. `VIDEO_SRC_RIGHT`) and point
  the right pane's `<video>` at it; remove/disable `GoldCanvas` for the right pane.
- **B. Live filter (keep the shader):** the user provides only the raw talking
  clip; keep `GoldCanvas` so the right pane is filtered in-browser at record time.
  This keeps both panes provably the same feed.

### Checklist when the real clip(s) arrive

1. Drop the file(s) in `public/images/` (e.g. `webcam-real.webm`). Prefer VP9/WebM
   (or H.264 MP4) for headless-Chromium playback. ~24s+ so it covers the 29.5s loop.
2. Point `VIDEO_SRC` (and `VIDEO_SRC_RIGHT` if using approach A) in
   `VideoTemplate.tsx` at the new file(s).
3. If the new face sits differently in frame, retune the scan-box positions in
   `Scene2.tsx` / `Scene3.tsx` (the `top-[..] left-[..] w-[..] h-[..]` values) so
   FACE/IRIS/LIP boxes land on the right features.
4. Re-record (steps above), validate, and check the poster moment still shows the
   peak-contrast frame at 12.3s (adjust `POSTER_AT` if needed).
5. Remove the AI clip (`webcam-talking.webm`) once the real version is approved.

### Outstanding polish (non-blocking, from review)

- Right-pane "failed scan" overlays use amber; the spec prefers red `#CC2200` for
  consistency with the left pane.
- `package.json` carries heavy unused template deps (three/drei/react-spring/
  lottie) that could be pruned.
