---
name: Replit git author/committer injection
description: Why a Replit-built repo stamps the wrong git identity on commits, and how to force the intended one for a public-publish snapshot.
---

# Replit git author/committer injection

A repo built inside Replit will silently put the WRONG identity on commits, even
when `.git/config user.*` is correct. Two distinct sources, both higher-priority
than you expect:

- **Replit per-user config** at `/run/replit/user/<id>/.config/git/config` holds
  the operator's **real name** + a `…@users.noreply.replit.com` email. A freshly
  `git init`'d repo with no LOCAL `user.*` inherits this → legal-name leak.
- **`Replit Agent <agent@replit.com>`** is stamped whenever the commit is made
  through Replit's mediated git path (the **Git pane** or an auto-checkpoint),
  which overrides `user.*` regardless of config. This is why the workspace
  repo's HEAD can read `Replit Agent` while its `.git/config` says something
  else — the checkpoint daemon, not your shell, made that commit.

**Why:** for a one-way public publish (squashed snapshot) the commit's
author/committer must read the pseudonymous identity only; either injected
identity is a privacy failure (real name) or an attribution leak (agent).

**How to apply (force the intended identity):**
- Set a **local** `git config user.name/email` inside the publish repo, AND
- pass `GIT_AUTHOR_NAME/EMAIL` + `GIT_COMMITTER_NAME/EMAIL` **inline on the
  commit** (env vars are git's highest-precedence identity source), AND
- create the commit from a **plain shell — never the Replit Git pane**.
- Recovery for an already-made commit: same env vars inline +
  `git commit --amend --reset-author --no-edit`, then re-verify.
- Verify precedence non-destructively with `git var GIT_AUTHOR_IDENT` /
  `git var GIT_COMMITTER_IDENT` (resolves identity without committing). Confirmed
  no hook/wrapper forces the committer, so the inline env override holds.
- Trace the active source with `git config --show-origin --get-regexp '^user\.'`.

The VOID pre-publish runbook (`docs/pre-publish-scrub-2026-06.md` §1.2/§3/§4.3)
now names both injected identities and the recovery amend.
