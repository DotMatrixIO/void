---
name: Overview signaling-envelope enumeration is unchecked prose
description: VOID_TECHNICAL_OVERVIEW.md §"Signaling envelope" hand-counts events/labels with no CI guard — it drifts silently from the audit.
---

The "For convenience, the **N** signaling events are: …" / "The **M** data-channel
labels are: …" paragraph in `VOID_TECHNICAL_OVERVIEW.md` (§ Signaling envelope,
Task #437 prose) is **hand-maintained prose**, not generated and not validated by
any check. `check-signaling-envelope.mjs` validates the *audit doc whitelists*
against source callsites; `check-routes-overview-drift.mjs` only covers the §6.2
route table. Nothing cross-checks this enumeration against
`docs/signaling-envelope-audit.md`.

**Why it matters:** it was already stale before Task #868 — it listed **5**
data-channel labels and omitted `void.rekey` even though the audit had 6. A
contributor who adds/removes a signaling event or data channel must update this
paragraph by hand or it silently lies.

**How to apply:** whenever you touch the audit's event/label counts, grep the
overview for the matching `**<n>**` count and the literal name list and update both
the number and the enumeration. The two fragment-backed blocks (server-observable,
disk-logs) ARE synced via `sync-fragments.mjs`, but this convenience paragraph is
not — edit it directly.
