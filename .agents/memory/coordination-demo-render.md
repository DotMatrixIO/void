---
name: Coordination demo MP4 render
description: How the coordination demo MP4 (voiceover-driven) is recorded and why audio is muxed, not captured.
---

# Coordination demo MP4 render

The landing-page demo MP4s are produced with Playwright `recordVideo`, which
captures **video only** (no audio). The biometric demo is silent, so it just
encodes the webm. The **coordination** demo is voiceover-driven, so its MP4 must
have the voiceover **muxed in separately** from `public/audio/voiceover.mp3`.

**Alignment trick:** the player exposes `window.startRecording()` /
`window.stopRecording()` hooks (see `lib/video/hooks.ts`). `startRecording` fires
the instant the scene timeline mounts (visual t=0); `stopRecording` after one full
cycle. The recorder binds these via `page.exposeFunction` + `addInitScript`, then
trims the measured lead-in offset (page load + React mount, ~2s) off the front of
the webm so MP4 t=0 == scene-0 start. Since visuals were retimed to the voiceover,
muxing the voiceover from its own t=0 then lines up by design. Verify with a
`fps=1/2,tile=3x3` ffmpeg contact sheet.

**Why:** Playwright cannot capture page audio, and the recordVideo file has a
variable blank lead-in; without trimming to the hook-marked scene start, the muxed
voiceover drifts ahead of the visuals.

**How to apply:** run `artifacts/coordination-demo-video/scripts/record-coordination.mjs`
(copy into `artifacts/void-client` to resolve `@playwright/test`, set
`PLAYWRIGHT_BROWSERS_PATH=/home/runner/workspace/.cache/ms-playwright`), then copy
`/tmp/coordination-demo.mp4` to `artifacts/void-client/public/`. The MP4 is only a
fallback — the landing embed (`DemoVideoEmbed`) shows the live `/coordination-demo-video/`
iframe first and only HEAD-checks the MP4 if the iframe errors.
