---
name: marketing-voice launch-links sub-check
description: check:launch-links in the marketing-voice chain validates a gitignored internal checklist; a red there is often pre-existing and unrelated to publish-hygiene edits.
---

The `marketing-voice` workflow chains ~17 sub-checks. One of them,
`check:launch-links` (artifacts/void-client/scripts/check-launch-checklist-links.mjs),
validates that every evidence-file citation in
`attached_assets/internal-docs/LAUNCH-CHECKLIST-2.md` resolves to a real file.

**Key fact:** `attached_assets/` is **gitignored** — that checklist is NOT
tracked and does NOT ship in the public snapshot. The check still scans it on
disk for internal-validation-green purposes.

As of 2026-06, this sub-check is RED on its own: 5 broken citations to
`docs/threat-model-readaloud.md` and `docs/lockfile-regen-drill.md`, which the
checklist claims were created (Status 2026-06-04) but which do not exist.

**Why this matters:** If you make publish-hygiene / doc edits and run the full
marketing-voice chain, a red `check:launch-links` is most likely PRE-EXISTING
and unrelated to your diff. Scope-check: confirm your changed files don't touch
LAUNCH-CHECKLIST-2.md or the cited docs before chasing it. The other 16
sub-checks (phrases, literals, contrast, signaling-envelope, doc-code-drift,
threat-model-drift, room-not-session, etc.) are the ones that actually gate
shipping-doc content.

**How to apply:** Treat a lone `check:launch-links` failure as a separate
tech-debt item (restore the cited docs or fix the citations / add placeholder
tokens), not a blocker for publish-snapshot/advertise-private work.
