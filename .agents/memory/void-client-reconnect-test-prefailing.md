---
name: void-client reconnect test is env-blocked, not a regression
description: why the useRoomConnection ONION-budget reconnect test can be red in-container yet green in CI
---

`src/hooks/useRoomConnection.reconnect.test.tsx > "rejoins within the ONION budget
under high latency + multiple failed attempts"` can fail with `expected null not to be
null` at `harness.media.webrtcRef.current` right after `joinInitial(...)`.

**Rule:** treat this failure as environment-blocked, not a code regression, when the
container's Node differs from the repo's pinned version (look for `WARN Unsupported
engine`). Its join path uses `crypto.subtle` (HKDF), which resolves on a real macrotask;
under Node-version skew the microtask-oriented test harness observes `webrtcRef` before
it is set. CI runs the pinned Node, so it is green there.

**Why:** same family as the jsdom Ed25519 env failures — a runtime-capability/timing
mismatch, not a logic bug.

**How to apply:** if void-client-tests is red ONLY on this test (plus the standard jsdom
"getContext()/navigation/scrollTo not implemented" noise), do NOT attribute it to a
CI-YAML/README/docs-only diff — that surface cannot touch void-client runtime. Scope-test
your own file and skip this. A genuine fix belongs to the reconnect/crypto owner, not a
build-wiring or CI task.
