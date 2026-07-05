---
name: Async join breaks microtask-only test pumps
description: Making room join await crypto (HKDF) breaks test helpers that pump only microtasks under fake timers
---

When a code path that tests "pump until X happens" becomes dependent on
`crypto.subtle.*` (e.g. HKDF `deriveBits`/`importKey`), the WebCrypto promise
resolves on a **real macrotask** (libuv threadpool callback), NOT a microtask.

**Symptom:** A test helper that loops `await act(async () => await Promise.resolve())`
to wait for an emit/effect starts failing intermittently (e.g. `expected 0 to be
greater than 0` for an expected socket emit) — only under load, only sometimes,
because occasionally the threadpool callback lands after the fixed microtask-pump
budget. Most runs pass, so it reads as a flake.

**Why microtask pumps miss it:** `vi.useFakeTimers()` replaces `setTimeout` etc.,
but does not fake WebCrypto's threadpool resolution. A pump that only drains
microtasks (`await Promise.resolve()`) gives the event loop *some* chances to
process the crypto callback between iterations, but not deterministically within
a small fixed count.

**Fix:** Yield to a REAL macrotask each pump iteration. Capture the real timer at
module-eval time (before any `beforeEach` installs fake timers):
`const realSetTimeout = globalThis.setTimeout.bind(globalThis)`, then
`await new Promise(r => realSetTimeout(r, 0))` inside the pump loop. A
module-level capture is safe because module eval precedes `beforeEach`.

**How to apply:** Whenever you introduce async crypto into an existing
synchronous-ish flow, audit every test helper that "pumps until" something tied
to that flow — they likely assume microtask-only resolution and will flake.
