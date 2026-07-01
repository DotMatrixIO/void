---
name: publish-doc-hygiene guard
description: CI guard blocking old-org slug Void-PWA and internal .local/ paths from shippable docs
---

`artifacts/void-client/scripts/check-publish-doc-hygiene.mjs` (pnpm
`check:publish-doc-hygiene`, validation workflow `publish-doc-hygiene`) greps
the shippable docs surface (`docs/**/*.md`) for two publish hazards:
`Void-PWA` (old org slug; canonical is `DotMatrixIO/void`) and `.local/`
(internal scratch/planning paths that never ship).

**The non-obvious carve-out:** the doc set comes from the SHIP/PRIVATE table in
`docs/pre-publish-scrub-2026-06.md` §2. Two classes are skipped, not just one:
1. PRIVATE docs (pulled before snapshot, legitimately retain dated refs).
2. **Hazard-procedure / audit-ledger docs that SHIP but quote the forbidden
   strings by design** — `pre-publish-scrub-2026-06.md` itself contains both
   `Void-PWA` and `.local/tasks` because it is the rulebook teaching the
   operator to remove them. Mirrors the audit-ledger carve-out in
   `check-banned-phrases.mjs`.

**Why:** without carve-out #2 the guard flags the rulebook for stating the
rule. Any NEW scrub/procedure/audit-ledger doc that quotes these strings must
be added to `HAZARD_LEDGER_DOCS` (or `PRIVATE_DOCS`) in the script, with a
one-line reason, in the same commit.

**Promoting a PRIVATE doc → SHIP has a three-part lockstep fan-out** (both
guards mirror the scrub §2 table): (1) drop it from `PRIVATE_DOCS`
(doc-hygiene) AND `NEVER_SHIP_TARGETS` + `CARVE_OUT_FILES` (cross-links), so it
gets scanned like any shipping doc; (2) removing it from `NEVER_SHIP_TARGETS`
makes EVERY old ALLOWLIST entry that *targeted* it go stale → must delete them
or the guard fails on staleAllow; (3) **inverse hazard** — once scanned, the
now-shipping doc's OWN outbound citations to still-private docs (internal
audit, manifest-review) become NEW cross-link violations → add one
`[shippingDoc, target]` ALLOWLIST pair per target, owned by the audit/manifest
hygiene tasks (don't repoint — that's their job; public-copy §-anchors may not
match). Scrub the doc's lone `.local/` ref + any internal codename first or
doc-hygiene reddens.
