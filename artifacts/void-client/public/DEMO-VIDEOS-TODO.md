# Demo Video Production — Drop-In Specs

The page structure, captions, and poster frames are wired up. This file describes what to record and where to put it. When the MP4s land in this directory with the exact filenames below, both pages light up automatically.

## File slots

| Filename | Embedded in | Purpose |
|---|---|---|
| `biometric-demo.mp4` | `LandingPage.tsx`, `BiometricPage.tsx` | Split-screen biometric demo |
| `biometric-demo-poster.jpg` | (already in place) | Poster shown before play |

The embed component lives at `src/components/DemoVideoEmbed.tsx`. The captions, ARIA labels, and labels are baked in at the call sites — change them there, not here.

## Encoding specs

Both videos:
- Container: `.mp4` (H.264 video, AAC audio, faststart enabled)
- Resolution: 1280x720 final (16:9). Source can be 320x240 native and upscaled per the demo script.
- Frame rate: 30 fps
- Target file size: under 8 MB each (landing page is the priority — keep it light)
- Audio: silent or very minimal. The marketing vision is explicit: no narration, no music. App-native chiptune sound effects only.

Quick ffmpeg recipe once the source is ready:

```sh
ffmpeg -i source.mov \
  -vf "scale=1280:720:flags=neighbor" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -movflags +faststart \
  -c:a aac -b:a 96k \
  biometric-demo.mp4
```

## Demo 1 — Biometric split-screen (~30-60 s)

See `VOID-demo-script.txt` (lines 36-60) for the full caption flow. Short version:
- LEFT: a real person on a normal webcam call.
- RIGHT: the same person passed through CONTOUR, ASCII, and PIXEL modes, paired with COMBINED voice mask audio.
- Caption (already on the page): "Enough presence to trust. Not enough to surveil."

The whole point is that the right side is unmistakably a real human (visible motion, gesture, expression) but unusable as biometric data. Use a real face. The shaders are GPU-side in the running app — record from the actual product.

## Regenerating the posters (repeatable)

The `*-demo-poster.png` files are the click-to-play thumbnails shown in
`DemoVideoEmbed`. They are captured straight from the live video apps, so when
a video is re-edited (scene timing, copy, shaders) just re-run the generator
and commit the refreshed PNGs:

```sh
pnpm --filter @workspace/void-client run gen:demo-posters
```

It spins up each video app on an isolated port, lets the scene player run to a
representative moment, and screenshots a 1280x720 PNG into this directory.

- One video only: `POSTER_ONLY=biometric pnpm --filter @workspace/void-client run gen:demo-posters`
- Move the captured moment: `BIOMETRIC_AT_MS=12300 ...`
  (timestamps are ms into the looping video; pick a beat well inside a scene).

This regenerates POSTERS only — not the MP4 fallback (`biometric-demo.mp4`)
or its FFmpeg drift reference. The legacy `*-demo-poster.jpg` files are no
longer referenced by the embed (the call sites use `.png`).

## Out of scope (per task)

- No music, no voiceover, no narration.
- No localized versions or alternate-language captions.
- No professional video team needed. Screen recording at 320x240 + basic editing per the demo script.
- The "burns down" still graphic and per-route Open Graph cards are separate tasks.
