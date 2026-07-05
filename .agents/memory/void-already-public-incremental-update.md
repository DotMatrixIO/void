---
name: VOID is already public — updates are incremental clean commits
description: DotMatrixIO/void is live; the scrub doc's §3 first-publish snapshot is spent; ongoing releases are incremental clean commits, and how to prep/verify them.
---

VOID's first public release already happened. `github.com/DotMatrixIO/void` is a
live PUBLIC repo whose human commits are correctly authored as the pseudonymous
`DotMatrixIO <dot_matrix_apps@proton.me>`. Do NOT read `docs/pre-publish-scrub-2026-06.md`
§3 as a to-do — that fresh-history `git init` snapshot is a one-time act that is DONE.

**Ongoing updates are incremental clean commits onto the existing public `main`**,
NOT a new snapshot and NOT a force-push:
1. Materialize a clean candidate from local HEAD: `git archive HEAD | tar -x -C $PUB`,
   then apply the §3 strip list + empty `.gitattributes`.
2. Verify against `$PUB` (no commit needed): `node scripts/check-publish-inventory.mjs
   --snapshot "$PUB"`, gitleaks `-c $PUB/.gitleaks-void.toml`, and the §4.2 hazard grep.
3. Clone public → `git rm -rq .` → lay down `$PUB` → `git add -A` → commit with the
   pseudonymous identity forced inline (env vars, plain shell, never the Replit Git
   pane) → non-force `push origin main`.

**Why:** a future agent handed "publish VOID" will otherwise assume a first-time
publication and either duplicate a baseline or force-push over live public history.

**Gotchas:**
- The public `main` receives `github-actions[bot]` auto-commits (e.g. "Regenerate
  CVE appendix"). It self-heals after a push, but base your incremental commit on a
  fresh clone of public HEAD so you don't revert a bot commit.
- `.gitleaks-void.toml` adds CUSTOM rules (`void-btcpay-api-key`, `void-paywall-secret`)
  that deliberately FIRE on shipped placeholders/test vectors to force human triage —
  a non-zero gitleaks count is EXPECTED. The accepted residuals are placeholder API
  keys in `README-selfhost.md`, dummy hex in the startos-compat smoke/test files, and
  the `void.onionReachability.v1` cache-key string. Real-credential = stop; these = go.
- The legal-name grep (§4.2) is operator-only — the name is intentionally not in the
  repo, so the agent cannot run that specific check.
- `DotMatrixIO/void-private` (full-history backup) exists but was EMPTY as of first
  discovery — retain full history there via an operator push; keep it access-restricted
  (the full dev history contains a historically-leaked Replit-config credential, §0 of
  the scrub doc, which is exactly why history is kept private not public).
- Main agent stays git-write blocked: prep + verify only; commit/push is operator-run.
