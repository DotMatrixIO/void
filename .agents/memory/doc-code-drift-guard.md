---
name: doc-code-drift guard
description: check:doc-code-drift pins specific prose literals in the long-form docs to their code constants; what it covers and the parsing gotcha.
---

# check:doc-code-drift

A static guard (`artifacts/void-client/scripts/check-doc-code-drift.mjs`, run in the
`marketing-voice` CI chain) that fails the build when a hand-written prose value in the
long-form docs disagrees with the code constant it describes. Mirrors
`check-signaling-envelope.mjs`. Born from recurring doc-vs-code drift (the original
five-place fix only guarded the signaling event count).

## What is pinned
- `GC_INTERVAL_MS` (artifacts/api-server/src/rooms/types.ts) → the "Every N seconds …
  (`GC_INTERVAL_MS = …`)" line in VOID_TECHNICAL_OVERVIEW.md §3.5. Asserts BOTH the
  human seconds value and the code expression.
- `ALLOWED_AUDIO_CODECS` / `ALLOWED_VIDEO_CODECS` (artifacts/void-client/src/lib/sdpValidator.ts)
  → the codec allowlist enumerated in VOID_TECHNICAL_OVERVIEW.md §14 (H-03 entry). Compared
  as SETS (doc and code deliberately order entries differently). NOTE: the guard used to also
  pin VOID_INTERNALS_STUDY.md's Allowlists bullet, but that doc was relocated out of the public
  tree (internal planning docs → attached_assets), so the study-specific docTarget was removed;
  only the still-public OVERVIEW copy is pinned now.

**Why:** these prose values are free-text; nothing else forces an editor to revisit them
when the code changes, so they silently rot.

**How to apply:** when you change any of those code constants, the guard will name the
exact doc line(s) to update. When adding more pinned values, note the two doc shapes the
codec parser handles: one-codec-per-backtick (`opus`, `g722`, …) and a single comma-list
backtick span (`opus, g722, …`). The codec region MUST be anchored to the allowlist passage
(e.g. "per-section codec allowlist", "**Allowlists:**") first — the bare marker "audio:"
occurs elsewhere in the docs and will grab the wrong region if used unanchored.
