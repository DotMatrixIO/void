<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

<!--
Security fix? Do not describe the vulnerability in a public PR. See SECURITY.md.
New feature? Open an issue first and read VOID-Feature-Policy.md.
-->

## What this changes

<!-- One or two plain sentences. What and why. -->

## Why it fits VOID

<!--
Which feature-policy / threat-model assumption does this rest on or change?
If it touches signaling, crypto, or what the server can see, say so explicitly.
A change that weakens a privacy property is a regression even if tests pass.
-->

## Checklist

- [ ] One logical change (no drive-by reformatting of untouched files).
- [ ] `pnpm run typecheck` and `pnpm run lint` pass.
- [ ] Tests for the affected package pass; new behavior has a test.
- [ ] Generated code (Zod schemas, React Query client) was regenerated from the
      spec, not hand-edited.
- [ ] User/operator-facing copy passes the voice check
      (`pnpm --filter @workspace/void-client run check:phrases`).
- [ ] No secrets, no real `turnserver.conf`, no filled-in `.env` committed.
- [ ] New source files carry the `SPDX-License-Identifier: AGPL-3.0-or-later` header.
- [ ] I agree my contribution is licensed under AGPL-3.0-or-later.
