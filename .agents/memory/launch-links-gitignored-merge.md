---
name: launch-links gate vs gitignored evidence
description: Why check:launch-links (marketing-voice) can be green in a task agent's env but red on main after merge.
---

# launch-links / marketing-voice red after a task "fixes" it

`check:launch-checklist-links.mjs` scans `attached_assets/internal-docs/*.md`
(the LAUNCH-CHECKLIST) and resolves every cited evidence file. That whole
directory is **gitignored**.

**The trap:** a task agent can make launch-links pass in its isolated env by
*creating/restoring evidence docs inside `attached_assets/internal-docs/`*.
Those files are gitignored, so git does NOT carry them back on merge — only
tracked content merges. The main env never receives them, so the gate stays
red on main even though the task reported it green and was merged.

**Why it doesn't matter for publish:** `attached_assets/` is gitignored, so it
is absent from the `git archive HEAD` publish snapshot, and `marketing-voice`
is a Replit-local workflow, NOT one of the shipped `.github/workflows/`. A red
launch-links is a dev-only cosmetic gate over untracked internal evidence; it
never blocks or contaminates the public GitHub snapshot.

**How to apply:** when launch-links is red on main, check whether the cited
evidence docs actually exist in the working tree (`ls attached_assets/internal-docs/`).
If they're missing because a prior task created them in a gitignored path,
either recreate them locally or repoint the citations — but never treat it as a
publish blocker. Any "fix" to gitignored files must be redone in the env that
needs it; it will not survive a task merge.

**The guard now self-classifies absence vs relocation (so this can't read red).**
`check-launch-checklist-links.mjs` no longer fails on a broken citation whose
basename exists *nowhere* (ABSENCE = git-ignored tree didn't propagate → skip,
exit 0). It only fails when the basename exists at a *different* path
(RELOCATION = stale citation, the regression it was built for). Roots scanned
for the basename: `attached_assets/internal-docs/` + `docs/`. Net: full
enforcement on a maintainer's complete tree, clean skip everywhere else. The
script header documents this as a maintainer-local-only gate.

**The durable fix lives in TRACKED `docs/`, not in the gitignored checklist.**
A fix that only edits the gitignored checklist (or recreates receipts under the
gitignored `attached_assets/internal-docs/`) makes the local gate green but is
INVISIBLE to code review (it reviews the tracked diff, sees nothing) AND is lost
on merge. The correct move: create the missing target files at the TRACKED path
the citations already point to (e.g. `docs/threat-model-readaloud.md`,
`docs/lockfile-regen-drill.md`) and leave the checklist's `docs/...` citations
untouched. Tracked targets always exist, so whenever the gitignored checklist is
present its citations resolve; on a clean checkout the checklist is absent and
the guard skips. New `docs/*.md` get scanned by check:publish-doc-hygiene
(no Void-PWA/.local//grant names) and check:publish-cross-links (no never-ship
doc refs) — keep the content clean of those.
