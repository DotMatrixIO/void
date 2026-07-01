---
name: Main agent destructive-git guardrail
description: What git operations the main agent cannot run on the live workspace .git, and how to route them.
---

The main agent (working directly on the live Replit-managed `.git`) is hard-blocked
from ALL destructive / `.git`-mutating operations, including ones that are
logically reversible:

- `git rm -r --cached <path>` (untracking — even though files stay on disk)
- `git config --local user.name/user.email` (writes `.git/config`)
- `rm .git/*.lock` (even clearing a stale lock is blocked — the path is under `.git`)
- the usual list: commit, reset, clean, rebase, restore, checkout, init, push -f, etc.

The error is: "Destructive git operations are not allowed in the main agent.
Propose a background Project Task to perform this git operation instead."

**Why:** these must run inside a dedicated background Project Task that has the
system-level protections; the assigned-task context does NOT lift the block.

**How to apply:**
- Read-only git is fine: pass `--no-optional-locks` (e.g. `git --no-optional-locks status`).
- For untrack/identity/lock-clearing work, do the reversible non-git parts in the
  current task (e.g. broaden `.gitignore`, fix Dockerfile) and DEFER the actual
  git mutation to a separate git task. Document it; don't try to force it.
- A blocked `git config --local` leaves a large stale `.git/config.lock` (the
  workspace config is huge due to `subrepl-*` checkpoint remotes). It does NOT
  break reads (`git status` still returns 0) and the platform auto-commit uses
  the index, not config writes — so it is harmless until the deferred task clears it.
- Untracking an already-tracked dir: adding it to `.gitignore` does NOT untrack
  it; `git rm --cached` is required. But a publish via orphan snapshot already
  excludes gitignored paths, so untrack is belt-and-suspenders, not a publish blocker.
