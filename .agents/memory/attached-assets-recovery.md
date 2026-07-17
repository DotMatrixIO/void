---
name: attached_assets historical recovery
description: Where the pre-June-2026 attached_assets content lives in git history and the standing rule not to delete it again
---

The "Untrack attached assets" commit (June 9, 2026, `bdbef8bb`) deleted 130 tracked files under `attached_assets/` (grant-drafts/, internal-docs/, coordination-vo/, brand imagery, screenshots, FAQ/threat-model drafts) when the directory became gitignored.

All 130 were restored into the working tree from `bdbef8bb^` in July 2026. They live at their original paths under the gitignored `attached_assets/` and MUST NOT be deleted again — the user explicitly asked for them to be preserved.

**Why:** the directory is gitignored, so nothing under it is protected by git going forward; any cleanup sweep of `attached_assets/` destroys the only working copy (recovery source remains `git show bdbef8bb^:<path>`).

**How to apply:** never bulk-delete or "clean up" `attached_assets/`; if a task needs the space, ask the user first. Task agents cannot write here durably (gitignored paths don't survive merges) — only main agent can maintain these files.
