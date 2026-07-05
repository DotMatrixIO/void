---
name: VOID §4 publish secret-scan triage (gitleaks + hazard grep)
description: How to triage the pre-publish §4 gitleaks + hazard-name grep over the snapshot ($PUB) so the gates are green AND trustworthy.
---

The pre-publish scrub §4 runs gitleaks + a single hazard-name grep over the
stripped snapshot. Both surface only benign noise today, but each has a trap.

## gitleaks (.gitleaks-void.toml)
- Benign upstream `generic-api-key` hits that are NOT real secrets: fabricated
  StartOS round-trip test vectors (`0123456789abcdef`×4 paywall-secret,
  `abc123def456` lnbits key, in smoke-startos-compat.mjs + startos-entrypoint
  test) and the non-secret localStorage constant `void.onionReachability.v1`.
- FIX = allowlist by **exact value** (`[[allowlists]] regexTarget="match"`),
  NOT by path. **Why:** path-exempting test files on a privacy product would
  let a real secret hide in a test. Value allowlist still catches real secrets
  in the same files. Verified: with config → "no leaks found"; without → 8.

## Hazard grep (§4.2)
The grep runs over the **shipped** tree, so it never returns nothing — the
publish guards and this runbook legitimately contain the hazard terms by
design. The ONLY legit residuals are: `banned-phrases.mjs`,
`check-publish-cross-links.mjs`, `check-publish-doc-hygiene.mjs`, and
`pre-publish-scrub-2026-06.md`. (PRIVATE docs that also hit are stripped from
$PUB per §2.) Any hit OUTSIDE that set is a stop. The old "must return nothing"
prose was simply wrong.

Flag traps (correct invocation is `grep -rIniE`):
- `-rinE` (case-insensitive) vs `-rInE` (skip-binary) — you need BOTH letters.
  Dropping `-i` silently lets capitalized hazards (`OpenSats`/`NLnet`/`HRF`)
  ship undetected. **Why:** patterns are lowercase; case-sensitive misses them.
- `\b…\b` bounds the 3-char token `hrf` so it stops matching pnpm-lock
  integrity hashes (e.g. `hRF04…` → no trailing boundary) and, with `-I`,
  binary media (mp3/mp4/png) where `hrf` hits random bytes.
- Boundary gotcha: `\bnlnet\b` does NOT match the literal source `/\bnlnet\b/i`
  because the token is glued to the `b` of the source's `\b` (no word
  boundary). banned-phrases.mjs still matches via its quoted `"NLnet"` instead.
