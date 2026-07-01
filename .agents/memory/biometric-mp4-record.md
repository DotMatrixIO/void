---
name: Biometric demo MP4 record pipeline
description: Re-exporting biometric-demo.mp4; the stale-webm trap that makes biometric-video-drift fail after a "successful" re-record.
---

# Biometric demo MP4 re-export

The landing-page `biometric-demo.mp4` (+ poster) is a Playwright+FFmpeg export of
the biometric-demo-video React scenes. The `biometric-video-drift` guard watches
**every** `.ts(x)` under `artifacts/biometric-demo-video/src/` (plus the record
script) and fails if any watched source changed since merge-base but the MP4
*and* poster did not change in the same diff.

## VideoWithControls edits still require a re-export
The recording renders the **non-iframed** `<VideoTemplate/>` path, so changes to
the interactive player wrapper (`VideoWithControls.tsx`) never alter the recorded
visuals — but the file is still in the watched set, so you MUST re-export the MP4
+ poster anyway. The MP4 only differs run-to-run because Scene6 (end card) uses
`Math.random()` for particle positions, so a fresh recording yields new bytes.

## The stale-webm trap (cost real debugging)
`record-biometric.mjs` writes the Playwright `.webm` into `/tmp/video-captures`
and then encodes `readdirSync(OUT_DIR).filter(webm)[0]` — the **first** webm in
the directory. That dir accumulates one webm per run, so `[0]` can pick a **stale
prior recording**, producing an MP4 byte-identical to what's already committed →
`biometric-video-drift` fails with `biometric-demo.mp4 [UNCHANGED]` even though
you "just re-recorded."

**Fix/How to apply:** `rm -rf /tmp/video-captures` before every re-record so only
the fresh webm exists. Verify with `md5sum /tmp/biometric-demo.mp4` vs
`git show HEAD:artifacts/void-client/public/biometric-demo.mp4 | md5sum` — they
must differ before you copy into `public/` and run `update:biometric-poster`.
