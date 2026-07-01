---
name: VOID public-release CI fork-gating
description: How to gate canonical-only GitHub workflows when forks will inherit them, before the canonical repo slug exists.
---

# Gating canonical-only workflows for a public VOID release

When prepping VOID's workflows for a public repo (forks will inherit every
workflow), the rule is "don't let canonical-only jobs silently fail on forks."

**Use `if: ${{ github.event.repository.fork == false }}`** to gate jobs with
write side effects (releases, cosign signing, commit-back to main, GitHub
Release uploads). It is name-independent — true on the canonical repo, false on
forks — so it can be added *before* the canonical owner/slug is decided.

**Why name-independent matters:** the canonical repo URL/slug is a deliberate
launch-time decision (placeholders like `REPO_URL=[[TO BE ADDED]]` and
`void.example` stay until the publish task). You cannot pin to
`github.repository == 'owner/repo'` yet, so the fork flag is the first line of
defense. Recommend adding the slug pin too, at publish time, for defense in
depth (a detached fork can lose its fork flag).

**Critical limit:** `github.event.repository` is populated for
`push` / `pull_request` / tag / `workflow_dispatch` events but NOT reliably for
`schedule` events. Do NOT put the fork guard on a scheduled step — `null ==
false` is false, so it would skip on the canonical repo too. For scheduled
canonical-only steps (e.g. pnpm-audit's issue-sync), pin to
`github.repository_owner == '<owner>'` at publish time instead, and note that
GitHub disables scheduled runs on forks by default anyway.

**Fork-safe as-is (no guard):** pure drift checks, lint, build-verification,
SRI checks. Workflows that already self-skip when a `vars.*` origin is unset
(onion-smoke, sri-canary) need no change.
