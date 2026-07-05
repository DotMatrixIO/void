---
name: Demo poster capture from live video apps
description: How the landing-page demo-video posters are regenerated, and the puppeteer gotchas that produce blank captures.
---

# Demo poster capture (void-client)

The landing-page click-to-play thumbnails (`public/*-demo-poster.png`) are
captured from the **live** video apps (`biometric-demo-video`,
`coordination-demo-video`) via a repeatable script
(`gen:demo-posters`), modeled on `gen-still-poster.mjs` (puppeteer-core +
isolated spawned vite). Re-run it whenever a demo video is re-edited.

**Why capture from the live app, not the MP4:** the landing embed plays the
live app in a sandboxed iframe on click; the MP4 is only a fallback. So a
poster grabbed from the live app matches the primary experience. Posters and
the MP4 re-export are intentionally decoupled — the script does NOT touch
`biometric-demo.mp4` or its FFmpeg drift reference (`*-poster-ref.png`).

## Gotchas that silently produce a blank/white poster

- **Never `waitUntil: "networkidle0"`** on these pages — the scene `<video>`
  (`webcam-talking.webm`) holds an open connection forever, so networkidle
  never fires and `goto` hangs to timeout. Use `waitUntil: "load"` plus a
  readiness wait (`#root` has children) before the timed capture.
- **A spawned vite with `strictPort` must abort on early child `exit`.** If the
  port is already held (e.g. an orphan from a previous timed-out run), vite
  exits but a stale server still answers `fetch`, and you screenshot garbage —
  this is exactly how a ~5KB all-white PNG gets written. Track `child.exit` and
  throw instead of capturing.

**Why:** both bugs cost multiple attempts; the white poster looked like a WebGL
failure but was purely a port clash + missing readiness gate.

## Self-inflicted shell hazard
`pkill -f "<port>"` matches the *current* bash command line if that number
appears in it → kills your own shell (exit 143). Kill background helpers by
captured PID only, or use a port literal the command line doesn't contain.

## Capture timing
Viewport 1280x720 = exact 16:9, fills the locked video stage (no letterbox).
`captureAtMs` per video is configurable via `BIOMETRIC_AT_MS` /
`COORDINATION_AT_MS`; pick a beat well inside a scene, not on a transition.
