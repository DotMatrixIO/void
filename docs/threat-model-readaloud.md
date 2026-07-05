# Threat-model read-aloud log

This file is the receipt for `LAUNCH-CHECKLIST.md` item 3 (v2 A.2): the
`ThreatModelPage` matches shipped reality. The gate is satisfied by
reading each named section of the page aloud against the code path that
implements it, and recording — on a dated line — whether the page
`matches` the code or a `correction filed`.

It is **evidence**, not decoration. A reader should be able to tell at a
glance which sections have been verified, on what date, and against which
code path. A "read-aloud" pass means the section's wording was checked
sentence-by-sentence against the implementation, not skimmed; a glanced
pass is worse than none because it launders attention into a checkbox.

All dates are ISO 8601 (`YYYY-MM-DD`).

---

## Sections to verify

The four sections whose wording most directly promises behaviour to a
reader, each traced to the code that must back the claim:

1. **AUTO-RELAY-ON-ONION** — the page's claim about forcing relay when
   reached over an `.onion` origin.
2. **REKEY BANNER** — what the page says the rekey banner means vs. what
   the rekey path actually does.
3. **BURN GUARANTEES** — "BURN closes the door, it does not rewrite the
   past."
4. **WON'T-FIX LIST** — "WHAT VOID DOES NOT PROTECT YOU FROM": each
   bullet is a real, current limit, phrased without overclaiming a fix.

---

## Log

- 2026-06-05 — **AUTO-RELAY-ON-ONION** — `matches`. Page wording checked
  against the onion-origin relay-forcing path; the page does not promise
  auto-relay behaviour the code has not shipped. Pinned by
  `threatModelTorComposition.test.tsx`.
- 2026-06-05 — **REKEY BANNER** — first `correction filed`, then
  `matches` on the re-run after the Duet-rekey disclosure landed. Pinned
  by `threatModelDuetRekey.test.tsx`.
- 2026-06-05 — **BURN GUARANTEES** — `matches`. The page's "BURN closes
  the door, it does not rewrite the past" agrees with the BURN code path.
- 2026-06-05 — **WON'T-FIX LIST** — `matches`. Each won't-fix bullet
  maps to a real current limit; the Tor-composition wording is pinned by
  `threatModelTorComposition.test.tsx`.
