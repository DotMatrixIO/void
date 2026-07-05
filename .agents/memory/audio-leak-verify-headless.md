---
name: Audio-leak verification must use the self-contained harness
description: Why real void-client routes can't be driven to verify AudioContext teardown headlessly
---

Verifying `closeAudioContext()` teardown (AudioContext/AudioWorklet leak
checks) must use the self-contained `tools/audio-leak-verify` harness
(harness.html + verify.mjs), NOT real app routes.

**Why:** Driving real void-client routes (`/preview`, `/n/n`) in headless
Chromium creates **0 AudioContexts** — the app gates all audio behind user
gestures / feature toggles, so a headless real-app driver is vacuous (no
context ever created → nothing to leak-check). The harness instead
create/teardown-cycles a context directly, mirroring the production
two-stage teardown.

**Path independence:** all four teardown paths (BURN, leave, expire,
PreviewGate unmount) converge on the single `closeAudioContext()` in
`artifacts/void-client/src/lib/sounds.ts`, reached from only PreviewGate.tsx
(unmount) and useRoomConnection.ts (BURN/leave/expire). So per-path
engine-level leak numbers are identical by construction; the harness labels
runs per path but exercises one shared teardown.

**WebKit/Safari:** cannot run on the Replit Linux host (bundled WebKit
often absent; documented NixOS GStreamer/libwayland abort; it's the WPE/GTK
port, not Safari). Record Safari rows BLOCKED and defer to a real macOS pass
+ the manual DevTools per-trigger walk.
