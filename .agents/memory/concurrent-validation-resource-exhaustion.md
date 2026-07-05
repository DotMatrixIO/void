---
name: Concurrent validation resource exhaustion
description: vitest/playwright failures that only appear when the whole validation suite runs at once — flaky, not code defects.
---

When `mark_task_complete` runs the full validation suite, every workflow
spawns at once and the container hits OS process/thread limits. This
surfaces as failures that have NOTHING to do with the diff:

- **void-client-tests**: all unit tests pass (e.g. "1094 passed") but the
  run still exits 1 with an Unhandled Error: `pthread_create: Resource
  temporarily unavailable` / `spawn ... EAGAIN` (errno -11) from the
  vitest fork pool. The tests themselves are green; the worker pool just
  couldn't fork another process.
- **void-client-playwright**: a layout spec (seen: `reminder-safe-zone`
  webkit-360) fails with "Target page, context or browser has been
  closed" — the browser was killed under memory pressure, not an
  assertion failure.
- **api-server-tests**: transient `LightningBackendUnavailableError`
  / timeout-shaped failures that pass on the real (non-batched) run.

**Why:** same root cause as the `smoke-serve-static` load flake — mass
concurrent workflow start saturates the container.

**How to apply:** before chasing these, check the per-workflow log: if
the test counts are all green and the only error is EAGAIN / browser
closed / a backend timeout, it's the flake, not your change. Confirm
your own change in isolation (run just the affected project), and if it
passes, mark complete with a `skip_validation_reason` noting the
environmental flake. Don't try to "fix" worker counts for this.
