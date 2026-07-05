---
name: publish-inventory manifest drift (post-recovery, genuine)
description: Two check-publish-inventory findings that survive a full git-tracking recovery are GENUINE tree/manifest drift, not empty-index artifacts.
---

After the full working tree is (re)staged and committed so `git ls-files` reports
the real ~969 files, `node scripts/check-publish-inventory.mjs` (source mode)
still reports two findings, and both are **genuine**, not empty-index artifacts:

- **UNCLASSIFIED `attached_assets`** — the dir is gitignored, but one legacy file
  (`attached_assets/Pasted-...*.txt`) was committed before the exclusion and stays
  tracked, so `attached_assets` shows up as a tracked top-level entry the manifest
  never classifies. The recovery task explicitly permits keeping that one `.txt`.
- **STALE `replit.nix`** — `replit.nix` is in the manifest STRIP list but the file
  does not exist on disk in this tree at all (not merely hidden by an empty index).

**Why:** how to tell genuine drift from the empty-index artifact — with an empty
index every manifest entry reports STALE; once the tree is fully tracked, only
truly-absent/misclassified entries remain. Both above persist against a full
969-file tree, so they are real drift.

**How to apply:** these are owned by a manifest-hygiene / publish task, NOT by a
git-tracking recovery task (which is forbidden from editing
`scripts/publish-inventory-manifest.mjs`). To clear them: remove `replit.nix`
from STRIP, and either untrack the legacy `attached_assets/*.txt` or classify
`attached_assets` in the manifest. They will block a publish `--snapshot` run
until reconciled.
