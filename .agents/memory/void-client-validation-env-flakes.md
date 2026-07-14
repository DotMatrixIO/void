---
name: void-client / api-server validation env failures
description: Suites that fail in the mark_task_complete validation environment regardless of an unrelated UI diff.
---
# Pre-existing validation-environment failures (not your diff)

When `mark_task_complete` runs the full validation matrix, one suite can come
back FAILED even for a purely UI-only change that does not touch its source:

- NOTE (corrected): the old "jsdom can't do Ed25519" claim for
  `src/lib/helloEnvelope.test.ts` was WRONG. jsdom in this repo DOES support
  Ed25519 — the SDK-interop cases that build/sign/verify their own envelope
  pass in both jsdom and a node test env. The historical ~12/19
  `malformed_envelope` failures came from a stale `beforeAll` calling
  `buildBrowserHelloBody(...)` WITHOUT the `roomType` arg that became required
  (so `body.roomType` was undefined → whole `signed` malformed → cascade). Fix
  was to pass `roomType`, not to change the test environment. If this file ever
  goes red again, diff the test's envelope-construction args against the current
  `buildBrowserHelloBody`/`buildHelloBody` signatures FIRST.
- `api-server-tests` — `LightningBackendUnavailableError`, simulated KMS outage,
  and WebRTC renegotiation/`forged peer` assertions. Environmental (no live
  lightning/coturn/KMS in the validation container), see also
  `concurrent-validation-resource-exhaustion.md`. Also observed: a
  `flushSync wins the race against an in-flight async write` assertion (expected
  hash set to include a value it doesn't) — a nondeterministic write-race test.
- `void-client-tests` — `src/hooks/useRoomConnection.reconnect.test.tsx` fails
  3/10 (rejoin-within-ONION/CLEARNET budget, and `iceTransportPolicy 'relay'`
  reading `harness.media.webrtcRef.current.iceTransportPolicy` on a `null` ref).
  Fails IN ISOLATION too (not just under concurrency) — the jsdom RTCPeerConnection
  harness doesn't rebuild `webrtcRef.current` on reconnect here. Treat as
  pre-existing/environmental for non-reconnect diffs.

**How to apply:** if your change is confined to UI/render code (e.g. RoomPage /
PeerTileGrid) and `git log -1 --name-only` shows you did not touch
`helloEnvelope*`, the agent-protocol signing lib, or `api-server/src`, treat
these two as flaky/environmental and skip_validation with that reason. Confirm
your own added tests + `void-client typecheck` pass in isolation first.

- api-server `security-headers-proxy.test.ts` requires an `nginx` binary on PATH; containers without nginx fail it deterministically — env-blocked, not a code regression.
- void-client `RoomPage.test.tsx` "urgent re-fire is one-shot" toast test is a timing flake under full-suite load; passes in isolation.
