---
name: useRoomConnection reconnect ONION-budget flake (RESOLVED)
description: Formerly-flaky void-client reconnect test — fixed July 2026; failures here are now real.
---

**RESOLVED (July 2026).** The intermittent failures in
`src/hooks/useRoomConnection.reconnect.test.tsx` were a fake-timer vs
`crypto.subtle` threadpool race in the test harness, fixed by a
real-macrotask-yielding `pumpUntil` helper in the file (verified green
10/10 consecutive isolated runs).

**How to apply:** do NOT treat failures in this file as a known flake or
note them in `skip_validation_reason` anymore — a red here is a genuine
regression. Details of the fix pattern:
`void-client-reconnect-test-prefailing.md`.
