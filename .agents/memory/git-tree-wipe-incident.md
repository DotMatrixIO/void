---
name: Git working-tree wipe + recovery
description: How the whole file tree got silently deleted and committed, how to recover, and how to prevent it. Read before trusting auto-commit or writing codegen/clean scripts.
---

# Git working-tree wipe: cause, recovery, prevention

## What happened
The entire tracked tree (968 files) was deleted by a single agent auto-commit whose subject was an innocuous "Add initial file for generating mockup components" — it deleted everything and touched only `artifacts/mockup-sandbox/src/.generated/mockup-components.ts`. Git records only the committed *result*, so the exact shell command that emptied the tree is not recoverable from history — but the pattern (mass deletion + one codegen file + `agent@replit.com` author) points to a mockup/codegen step running against an empty/cleaned working tree.

## Root-cause lesson (durable)
The platform end-of-task auto-commit is an unconditional `git add -A` with **no floor guard**. It will faithfully commit a catastrophic working-tree deletion. Any generation/clean step that empties the tree becomes a committed wipe on the next checkpoint.

**Why:** auto-commit stages whatever is on disk; there is no "you just deleted 900 files, are you sure?" check.

## Recovery lesson (durable)
- Recover with **git** (`git restore` / checkout from the last healthy commit), NOT `cp`. A `cp`-based restore puts files on disk but leaves them **untracked**; the index stays broken and `git archive HEAD` / `git ls-files`-based guards then see a near-empty repo. This caused a second, separate cleanup.
- Notably, the very next end-of-loop auto-commit DID `git add -A` the cp-restored files and re-tracked them — so auto-commit both caused the wipe and (later) healed the untracked state. Do not rely on this; make the index correct explicitly.
- The main agent is hard-blocked from ALL git writes (even `git add --dry-run`). Git writes must go through a background Project Task.

## Prevention (recommended, not yet all implemented)
1. **Tracked-file-count floor guard** in the existing publish guard (`scripts/check-publish-inventory.mjs`): hard-fail if tracked count drops below a floor or a change deletes >X% of files. Highest-value fix — turns a silent wipe into a loud failure.
2. **Scope codegen/clean scripts** strictly to their own output dir (e.g. `.generated/`), never the repo root.
3. Checkpoints are the ultimate backstop — every agent action checkpoints, so rollback to a pre-wipe checkpoint is always possible.

## Do NOT
- Do NOT "fix" the publish inventory guard by deleting its STALE/UNCLASSIFIED warnings when the real cause is an empty/broken index. Those warnings are a symptom; weakening the guard hides the next wipe. Fix the index, not the guard.
