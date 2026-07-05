---
name: VOID org identity & public-launch rename
description: Canonical publish identity DotMatrixIO/void; what the routine hygiene pass touches vs. what history-scrub owns.
---

# VOID public-launch org identity

The repo publishes at `github.com/DotMatrixIO/void` under the pseudonymous maintainer **DotMatrixIO** (contact `dot_matrix_apps@proton.me`). The old org slug was `Void-PWA/void`.

**Rule:** routine repo-hygiene / copy passes rename `Void-PWA/void → DotMatrixIO/void` only in **LIVE** refs (README*, SECURITY.md, manifest.yaml, umbrel-app.yml, void-client `repo.ts` + its test, api-server `proof-build.ts` + its test). The org rename must stay atomic across all of these in one change — `proof-build.ts`'s release-repo default and `repo.ts` must agree or `proof-latest-release.test.ts` / `checkRepoUrl.test.ts` break.

**Do NOT touch** historical internal docs under `docs/` (security-audit-*, manifest-review-*, launch-decisions.md, etc.) — stale `Void-PWA` strings and grant references there are intentionally left to the dedicated **pre-publish history-scrub** task. "Fixing" them in a hygiene pass collides with that task.

**Why:** the publish identity and the contact email are externally-meaningful commitments, not code details; and the history scrub is a separate, history-rewriting operation that owns all of `docs/` plus git history.

**How to apply:** when asked to rename the org or clean refs for publish, scope to the LIVE file set above, run `check:phrases` + `check:literals` + `check-repo-url` (strict) + the two affected unit tests, and leave `docs/` alone. The grant-leak guard (`nlnet`, `ngi-zero`) lives in `artifacts/void-client/scripts/banned-phrases.mjs` and scans copy/manifests/README-selfhost — but NOT README.md or SECURITY.md.
