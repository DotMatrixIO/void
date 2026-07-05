---
name: void-client reconnect test pre-failing on main
description: useRoomConnection ONION-budget reconnect test fails deterministically in-container, unrelated to CI/docs diffs
---

`src/hooks/useRoomConnection.reconnect.test.tsx > "rejoins within the ONION budget
under high latency + multiple failed attempts"` fails DETERMINISTICALLY (3/3) in the
Replit container with `expected null not to be null` at
`harness.media.webrtcRef.current` right after `joinInitial(...)`.

**Why:** this is the async-join / `crypto.subtle` HKDF timing class — join now resolves
on a real macrotask, and the container runs Node v24 while the repo pins v22.12.0
(`WARN Unsupported engine`). Same family as the jsdom Ed25519 env failures. CI runs on
the pinned Node so this is plausibly environment-only, not a real main regression.

**How to apply:** if a void-client-tests run is red ONLY on this test (and the standard
jsdom "getContext()/navigation/scrollTo not implemented" noise), do NOT attribute it to
a CI-YAML/README/docs-only diff — that surface cannot touch void-client runtime. Scope
your own test file; skip this as env-blocked. If you must actually fix it, it belongs to
the reconnect/crypto owner, not a build-wiring task.
