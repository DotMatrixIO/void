---
name: void-client-tests pre-existing helloEnvelope failures
description: When the full void-client-tests suite is red, check whether the failures are the unrelated agent-protocol hello-envelope tests before assuming your diff broke them.
---

The `void-client-tests` workflow runs a full `vite build` (incl. lib
typecheck/build) then the whole vitest suite. A block of failures in
`src/lib/helloEnvelope.test.ts` (`verifySignedHello` returning
`malformed_envelope` for well-formed envelopes; `isSignedHello` returning
false) comes from the `lib/agent-protocol` hello-envelope module / a stale
built shape — NOT from UI or palette work.

**Why:** these tests exercise the agent-protocol signing/verification layer
and are decoupled from anything in `src/pages` or `src/components`. They
were failing independently of contrast/UI changes.

**How to apply:** before chasing a red full-suite run, scope your actual
diff and run only the affected test file(s) directly
(`pnpm exec vitest run <file>`). If the only failures are helloEnvelope /
agent-protocol, treat them as pre-existing and unrelated; verify your own
surface with its targeted test + the relevant guard (e.g. `check:contrast`
inside the `marketing-voice` workflow).
