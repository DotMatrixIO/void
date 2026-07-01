---
name: Adding a permanent named CI guard when the workflow cap is hit
description: configureWorkflow caps new adds at 10 and .replit is not directly editable; use the validation skill to register permanent named guards.
---

# Permanent named guards vs the workflow cap

This repo runs ~30 named CI-style guards as Replit workflows (defined under `[workflows]`
in `.replit`, each with `[workflows.workflow.metadata] isValidation = true`). Adding a new
one the obvious ways FAILS:

- `configureWorkflow(...)` rejects with "Workflow limit exceeded (30/10)" — the tool caps
  *new* adds at 10 even though 30 already exist.
- Editing `.replit` directly is blocked ("Direct edits to .replit and replit.nix are not
  allowed").

**Fix:** register the guard via the **validation skill** — `setValidationCommand({ name,
command })` then `startValidationRun({ commandIds: [name] })`. This creates a permanent
named guard (it also surfaces as a `name` workflow) without tripping the configureWorkflow
cap, and it is what `isValidation = true` workflows are.

**How to apply:** put the script behind a package.json `scripts` entry (so it is runnable
and reviewable in-repo), then point the validation command at that script, e.g.
`pnpm --filter @workspace/scripts run check:publish-boundary`.
