---
name: useRoomConnection reconnect ONION-budget flake
description: A timing-sensitive void-client test that fails intermittently in the full suite, unrelated to UI/copy diffs.
---

`src/hooks/useRoomConnection.reconnect.test.tsx` → "rejoins within the ONION
budget under high latency + multiple failed attempts" fails intermittently
(9 passed / 1 failed) both in the full suite and in isolation. It is a
timing/latency-budget assertion around Tor reconnect backoff.

**Why:** it depends on wall-clock-ish reconnect budgeting under simulated high
latency, which is fragile under container load.

**How to apply:** if you are doing a copy/UI/palette-only change and this is
the ONLY red test, it is not yours — do not chase it. Scope-test your own
files; treat this as a pre-existing flake and note it in
`skip_validation_reason`.
