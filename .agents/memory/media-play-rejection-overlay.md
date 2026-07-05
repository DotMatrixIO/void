---
name: media play() rejection surfaces as runtime-error overlay
description: Why every HTMLMediaElement.play() in the demo-video artifacts must have .catch()
---

Every `video.play()` / `audio.play()` call in the demo-video artifacts (biometric-demo-video, coordination-demo-video) MUST attach `.catch(() => {})`.

**Why:** `HTMLMediaElement.play()` returns a promise. When a `<video>`/`<audio>` element unmounts mid-playback (e.g. split-pane webcam elements removed at the endCard scene transition) or autoplay is blocked, the promise rejects with `NotSupportedError: "The element has no supported sources."` / `AbortError` / `NotAllowedError`. An uncaught rejection becomes a `window` `unhandledrejection`, which `@replit/vite-plugin-runtime-error-modal`'s client listener catches and shows as a recurring runtime-error overlay in the Replit preview — even though the media file itself is valid and serves 200. The error is benign teardown/policy noise, not a real source failure.

**How to apply:** Grep `\.play\(\)` across the artifact before finishing; any call without `.catch()` is a latent overlay bug. The error appears "after playing all the way through" because the scene-change effect calls play() on the soon-to-be-unmounted elements at the final scene. Reproduce/verify with a Playwright probe (iframed, `?autoplay=1`, `--autoplay-policy=no-user-gesture-required`) that plays to end and asserts zero `unhandledrejection`.

**Drift coupling:** VideoTemplate.tsx / scene sources are guarded by biometric-video-drift (git hash) AND biometric-poster-drift (FFmpeg frame vs committed PNG). ANY edit to a watched source — even a pure `.catch()` with no visual change — forces a full re-export: re-run record-biometric.mjs (copy into void-client first; @playwright/test only resolves there), copy mp4 + poster jpg into void-client/public, then `update:biometric-poster` to refresh the ref PNG.
