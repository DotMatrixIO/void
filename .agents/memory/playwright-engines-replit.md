---
name: Playwright browser engines on Replit
description: Which Playwright engines are available in void-client's environment, how they persist, and headless-WebKit WebRTC limits.
---

# Playwright engines in the void-client Playwright suite

**Where binaries live:** `/home/runner/workspace/.cache/ms-playwright/` (the
workspace cache, not `~/.cache`). It is **gitignored** (`.cache/` in root
`.gitignore`), so browser binaries never travel with the repo.

**Pre-installed by the platform:** chromium + webkit only. **Firefox is NOT**
pre-installed.

**Why:** because the cache is gitignored and per-environment, any engine you
add (firefox) must be reinstalled in every fresh environment or it silently
disappears after a merge.

**How to apply:**
- To add firefox: `pnpm --filter @workspace/void-client exec playwright install
  firefox`, AND add the same line to `scripts/post-merge.sh` (idempotent —
  no-ops when cached) so it persists across merges. Bump the post-merge timeout
  (firefox download ~104MB needs ~30-60s; the default 20s is too short — set
  ~180000ms).
- **Always** run the suite with `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
  (the workflow already does). Without it, webkit/firefox abort with "Host
  system is missing dependencies" (libgles2, gstreamer) even though the browser
  actually launches and renders fine on this NixOS image.

# Headless WebKit on Linux cannot do WebRTC ICE

A loopback `RTCPeerConnection` under Playwright's Linux WebKit stays at
`connectionState=new` / `iceConnectionState=new` forever — the WPE/GTK build
does not gather ICE candidates. This is a **tooling limitation, not an app or
Safari defect**.

**How to apply:** gate any live-WebRTC assertion with
`test.skip(browserName === "webkit", ...)`; do NOT delete the webkit project to
go green (it still validates landing/preview-gate/joined-call render). Cover
real Safari WebRTC via the manual runbook (`docs/cross-browser-tor-runbook.md`,
iOS Safari row). Chromium needs `--use-fake-device-for-media-stream` +
`--use-fake-ui-for-media-stream`; firefox needs `firefoxUserPrefs`
(`media.navigator.streams.fake`, `media.navigator.permission.disabled`,
`permissions.default.camera/microphone=1`).
