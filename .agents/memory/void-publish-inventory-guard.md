---
name: VOID pre-publish inventory guard
description: How the fail-closed top-level classification backstop relates to the denylist scrub, and the four lists that must stay in lockstep.
---

# VOID pre-publish scrub: denylist + fail-closed inventory backstop

The public-GitHub publish scrub (`docs/pre-publish-scrub-2026-06.md`) is a
**denylist**: `git archive HEAD` ships the whole tracked tree, then the scrub
deletes named exceptions. That fails OPEN — anything nobody named ships by
default. It nearly leaked `replit.md` because the §2 classification only ever
surveyed `docs/**` and `.agents/**`; the repo root was never classified.

**Backstop:** `scripts/check-publish-inventory.mjs` (+ `publish-inventory-manifest.mjs`,
registered validation `publish-inventory`) requires every tracked **top-level**
entry to be explicitly SHIP or STRIP and hard-fails on unclassified / stale /
double-classified. This converts the *decision* to fail-closed while keeping the
cheap archive-then-strip *mechanism*.

**Why top-level only:** a literal full-tree allowlist (~950 files) is high-churn
and breaks on every new source file. Top-level (43 entries) changes rarely and
is exactly where both near-leaks lived. Files INSIDE a SHIP dir (e.g. a new
private doc under `docs/`) are NOT caught here — they rely on the §3 strip list
plus §4 content scans (gitleaks `-c .gitleaks-void.toml`, hygiene, cross-link grep).

**Two modes, one manifest = single source of truth:**
- SOURCE (default): classification completeness vs `git ls-files` (in the repo).
- SNAPSHOT (`--snapshot "$PUB"`): vs the built tree AFTER the §3 strip — asserts
  every STRIP entry absent (NOT-STRIPPED), every SHIP entry present (MISSING-SHIP),
  nothing unclassified. This replaced the old hand-synced §4.2 `test ! -e` block,
  so the §3 `rm` lines can no longer silently drift from the manifest.

**Lockstep now:** the only remaining hand-synced copy is the §2 table (prose docs);
the manifest drives both the source check and the snapshot check. Add/remove a
top-level STRIP entry → update the manifest + §2 table; the §3 `rm` line is then
enforced by snapshot mode (a forgotten `rm` fails NOT-STRIPPED).

**Run via versioned commands**, not just the registered validation name
(registration is environment state, not committed config):
- `pnpm --filter @workspace/scripts run check:publish-inventory`
- `node scripts/check-publish-inventory.mjs --snapshot "$PUB"` (from repo root)
