---
name: void-client reconnect test flake — FIXED via real-macrotask pump
description: the useRoomConnection reconnect test's fake-timer/crypto.subtle race and the pump pattern that fixed it
---

**Status (July 2026): FIXED.** `src/hooks/useRoomConnection.reconnect.test.tsx` was
nondeterministically red (ONION-budget, knock-approved, duplicate-tiles — all funnel
through `joinInitial`). Root cause: the hook's join path awaits `crypto.subtle`
HKDF (`rendezvousJoinCandidates`), which resolves on Node's threadpool (a real
macrotask), while the tests pumped only fake timers + microtasks
(`vi.advanceTimersByTimeAsync`). Whether the HKDF promise settled before the pump
finished was a real-thread race.

**Fix pattern (reusable):** capture the REAL `setTimeout` at module-evaluation time
(before any `vi.useFakeTimers()`), then pump with a loop that interleaves
`await new Promise(r => realSetTimeout(r, 0))` yields (lets threadpool promises
settle) with small `vi.advanceTimersByTimeAsync(step)` advances, until a predicate
holds (e.g. `webrtcRef.current !== null`). See `pumpUntil` in the test file.

**How to apply:** if this file goes red again, it is a real regression — do NOT
dismiss it as env-blocked/pre-existing anymore. When any fake-timer test starts
awaiting `crypto.subtle` (or other threadpool-backed) work, use the same
captured-real-setTimeout pump instead of a fixed `advanceTimersByTimeAsync` margin.
