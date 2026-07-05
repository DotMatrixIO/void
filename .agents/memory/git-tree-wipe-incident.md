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

## Prevention (implemented)
1. **Tracked-file-count floor guard** — DONE. `MIN_TRACKED_FILES` in `scripts/publish-inventory-manifest.mjs` (a fixed floor, deliberately set well below the real count; not a live baseline/delta, which would drift and train reviewers to rubber-stamp bumps). Enforced FIRST in `runSourceMode()` of `scripts/check-publish-inventory.mjs` via the pure exported `fileCountFloorProblem()` — a wipe now fails LOUD with one FILE-COUNT-FLOOR message instead of being buried under one STALE per missing entry. Rides along automatically in the `publish-inventory` validation workflow (no `.replit` edit needed). Lowering the floor is a deliberate, reviewed act.
2. **Scope codegen/clean scripts** strictly to their own output dir — the mockup codegen (`artifacts/mockup-sandbox/mockupPreviewPlugin.ts`) was already write-only (mkdirSync+writeFileSync into `src/.generated/`), NOT the wipe's cause. Locked in place by a source-scan regression test (`scripts/check-mockup-codegen-safe.test.mjs`): fs imports are an allowlist (mkdirSync/writeFileSync only) — string-only scans get fooled by chokidar's `"unlink"` EVENT name, so the import allowlist is the real guard.
3. Checkpoints are the ultimate backstop — every agent action checkpoints, so rollback to a pre-wipe checkpoint is always possible.

## Testing the floor (durable)
Source mode lists tracked files via `git ls-files` against the real REPO_ROOT (derived from the script's own path, not cwd), so a synthetic below-floor tree CANNOT be simulated in-process. Test the pure `fileCountFloorProblem(count, floor)` helper directly for below/at/above, plus one subprocess run of the CLI in source mode to prove the invoked-directly dispatch still fires on the healthy tree (a regressed main-guard would silently no-op).

## Do NOT
- Do NOT "fix" the publish inventory guard by deleting its STALE/UNCLASSIFIED warnings when the real cause is an empty/broken index. Those warnings are a symptom; weakening the guard hides the next wipe. Fix the index, not the guard.
