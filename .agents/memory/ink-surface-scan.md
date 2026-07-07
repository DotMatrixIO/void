---
name: ink-surface invisibility scan
description: How the check:ink-surface guard works — 3.0:1 floor, baseline ratchet, heuristics, and how to handle its failures
---

# ink-surface invisibility scan

`check:ink-surface` (void-client, marketing-voice chain) statically pairs every
resolvable `color:` with a background (same style object, same CSS block, or
nearest surface marker above incl. `.void-header`/`.void-video-slot` classes)
and fails on pairings below a **3.0:1 invisibility floor** — catches both
dark-on-dark and light-on-light without direction-specific keyword lists.

**Why 3.0, not 4.5:** the tree ships ~50 sub-AA-but-legible accents (e.g.
--burnt on --surface-dark at 4.41:1); `check:contrast` owns AA for curated
pairs. The invisibility class from the manual audit sat at 1.09–2.40:1.

**How to apply:**
- Pre-existing findings are grandfathered in `scripts/ink-surface-baseline.json`,
  a count ratchet keyed `file|ink|surface` (no line numbers → edits don't churn
  it). A failure means a file gained a NEW pairing: fix the ink, or add a
  `/* contrast-exception: <reason> */` comment within 6 lines above the color.
- Never `--update-baseline` to absorb a new offender; only to lock improvements.
- The "nearest background above" pass is a heuristic and can pair a sibling's
  background — that's what the exception comment / baseline are for; don't
  weaken the pass.
- The ~50 baselined pairings were never visually verified — some may be real
  shipped low-contrast spots (e.g. `var(--fg)` on `var(--surface-dark)` in
  PaywallModal containers whose children override color).
