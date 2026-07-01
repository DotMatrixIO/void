---
name: VOID env-var audit — bracket notation
description: Auditing the api-server's env contract requires scanning process.env["X"], not just process.env.X
---

# Auditing VOID's env-var contract

**Rule:** When enumerating what env vars the api-server consumes, scan **both**
`process.env["X"]` (bracket) and `process.env.X` (dot). The api-server reads
almost everything via bracket notation, so a dot-only grep falsely reports the
TURN / PAYWALL / ONION group (and others) as "missing/unused."

**Why:** A dot-only `rg 'process\.env\.[A-Z_]+'` over `artifacts/api-server/src`
returned a tiny list and made it look like TURN_SECRET/PAYWALL_SECRET/TURN_URL/
ONION_HOSTNAME weren't consumed — they are. This false-negative was hit twice
before the bracket form was added. The bracket style is pervasive (TS indexed-
access conventions).

**How to apply:** Use a combined pattern, e.g.
`rg -oN "process\.env(\.[A-Z_]+|\[\"[A-Z_]+\"\])" artifacts/api-server/src lib`.
Also attribute carefully: `lib/void-agent-sdk` (SDK) and `build.mjs` (build-time)
reads are NOT api-server runtime vars — `DEFAULT_STUN_URL` is SDK-only,
`CLIENT_DIST_DIR` is build-time (server reads `CLIENT_DIST` at runtime).

**Related:** The 2026-06-11 StartOS build-readiness audit lives in
`docs/manifest-review-2026-06.md` §6–§7 (records the no-config-spec blocker and
the wget-not-in-node:slim health-check break).
