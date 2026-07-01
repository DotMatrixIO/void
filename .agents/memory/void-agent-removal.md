---
name: VOID agent removal
description: What was deleted vs. what survived when VOID was made agent-free, and how the dated audit/security docs were reconciled.
---

# VOID made agent-free (v0.6)

VOID is now a single human-to-human product. The agent product was removed.

**Deleted entirely:** `lib/void-agent-sdk`, the `agent-protocol` package, `agent-spike`,
the `agent`/`hybrid` room types, the public Agent Mode page, `Dockerfile.pilot` +
`docker-pilot-build.yml`, `crypto-compat.test.ts`, the `void-secret:`/`void-phrase`
agent-invite scheme (`generateAgentSecret`/`parseAgentSecret`), and the unused
`timing-safe-string.ts` helper.

**Survived but MOVED** `lib/agent-protocol/src` → `lib/wire-core/src`: `argon2.ts`
(Argon2id room derivation), `brand.ts` (branded `Secret<T>`), `hello-envelope.ts`
(signed hello), plus `index.ts`/`schemas.ts`. `SIGNING_CONTEXTS` source is now
`@workspace/wire-core`.

## Reconciling dated audit / security docs

`docs/security-audit-public-2026-04.md` and similar are DATED public attestations,
not living docs. Reconcile by **tombstoning** removed agent-only numbered sections
(keep the heading + an italic `*Removed (v0.6): …*` note, do NOT renumber) rather
than deleting them, and **repoint** surviving-primitive paths to `lib/wire-core`.
For MIXED findings (e.g. M-06 production Dockerfile + deleted pilot image), keep the
finding and strip only the agent clause. For claims that cited deleted tests
(crypto-compat/agent-spike parity), reframe to "single source in
`lib/wire-core/src/argon2.ts`" — do not invent a replacement test.

**Why:** preserves the integrity of a dated attestation while removing dangling
references to code that no longer exists.

**How to apply:** if you hit agent references in these docs, don't re-add agent code
and don't assume the tombstoned features still ship. Watch for coherence drift after
edits — survivor lists, "both/all-three surfaces" counts, severity bullets, and
summary-table rows must stay in sync with the body. Leave generic `ICE agent` /
`user-agent` strings alone.
