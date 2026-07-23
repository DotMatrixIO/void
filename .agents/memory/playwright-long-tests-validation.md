---
name: Long playwright tests via validation skill
description: How to run Playwright E2E specs that take >2 minutes when the bash tool caps at 120s.
---

The bash tool hard-caps at 120000ms. Background processes started with `&` or `setsid` die when the bash session exits, so pre-warming servers across calls doesn't work reliably.

**Rule:** For playwright specs that take >120s total (server cold-start + test), use `startValidationRun` from the validation skill instead of a bare bash call.

**Why:** `startValidationRun` is not subject to the bash timeout — it blocks in the code_execution sandbox until the command exits, regardless of duration.

**How to apply:**
1. `setValidationCommand({ name: "my-spec", command: "pnpm --filter ... run test:playwright:foo" })`
2. `const run = await startValidationRun({ commandIds: ["my-spec"] })`
3. Check `run.status === "PASSED"` and `run.runSummary` for details.
4. `clearValidationCommand({ name: "my-spec" })` if it was ephemeral.

The void-client playwright resume spec (playwright.resume.config.ts) takes ~114s total (api-server build 2.5s + vite cold-start + 17s test). It consistently passes when run via startValidationRun.
