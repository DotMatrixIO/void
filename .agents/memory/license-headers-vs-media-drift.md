---
name: License/comment headers vs byte-exact media drift guards
description: Why a repo-wide SPDX/comment header codemod trips the media-drift CI guards, and how to scope around it.
---

# Per-file comment headers collide with byte-exact media-drift guards

Adding a per-file comment header (e.g. `// SPDX-License-Identifier: ...`) to
source that is *watched* by a media-drift guard will trip that guard, even
though the comment changes nothing the user sees.

**Why:** the drift guards are pure git-diff path checks. They fail when a
watched source path appears in the diff range but the corresponding rendered
artifact path does not. A comment-only edit puts the source in the diff but
can't change the rendered media. Worse, the deterministic regenerators produce
byte-identical output for a comment-only change, so re-running them does NOT add
the artifact to the diff → the guard stays red and is effectively
unsatisfiable-by-regen for that edit. (The biometric MP4 re-encode is the one
exception — video encoding is non-deterministic, so a re-export there does
change bytes.)

The guards (in `artifacts/void-client/scripts/`):
- `check-biometric-video-drift.mjs` — watches `artifacts/biometric-demo-video/src/**`
  + `record-biometric.mjs`; artifact = `public/biometric-demo.mp4` + poster jpg.
- (`check-still-poster.mjs` was DELETED along with the whole still-poster
  pipeline — the social OG card is now a hand-chosen screenshot that must
  never be regenerated, so no guard watches it anymore.)

**How to apply:** before any repo-wide header/codemod, carve out the
biometric-demo-video src tree (it has a currently-green guard you'd regress
with binary churn).
