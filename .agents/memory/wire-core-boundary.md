---
name: wire-core vs agent-protocol boundary
description: Which neutral wire primitives live in @workspace/wire-core vs the agent-RPC layer, and the guard that keeps the human/shared surface off agent-protocol.
---

# wire-core / agent-protocol split

`lib/wire-core` (`@workspace/wire-core`) holds the **neutral** wire primitives that the
human/shared transport surface needs: the `Secret` brand, argon2 room-key derivation,
the signed-hello envelope, generic zod schemas (RoomType / TranscriptMode / AgentIdentity /
FeatureFlag / ContentType / AgentCapabilities / HelloBody), `PROTOCOL_VERSION`,
`RELAY_SIGNAL_MAX_PAYLOAD_BYTES`, `SIGNING_CONTEXTS`, `canonicalize`, `signingPayload`.

`lib/agent-protocol` (`@workspace/agent-protocol`) keeps the **agent-only** RPC surface:
the RPC envelope, channel limits, tool descriptors, the `void-secret:` invite grammar.
It re-exports the moved symbols from `@workspace/wire-core` so its public surface stays
unchanged (the SDK + agent-spike consume the barrel and need no edits).

**Rule:** `artifacts/void-client`, `artifacts/api-server`, and `lib/wire-core` must NEVER
depend on `@workspace/agent-protocol` (package.json dep OR source import). Import neutral
primitives from `@workspace/wire-core`. If you need an agent-only symbol in the human
surface, the symbol is in the wrong package — move it down to wire-core.

**Why:** the human/shared client+server are the publishable/shippable surface; they must
not pull in the agent RPC layer. This was the whole point of extracting wire-core.

**How to apply:** the boundary is enforced by `scripts/check-publish-boundary.mjs`
(named check `check:publish-boundary` in `@workspace/scripts`, registered as the
`publish-boundary` validation). The scanner matches only real import specifiers
(`from`/`import`/`require` + quoted module string), so doc comments may name the package.
Resolution is workspace-source-based via package.json `exports` (no project references),
so there is no stale-dist pitfall. crypto-tests is the byte-identity gate — if a move is
not verbatim, its cross-impl vectors (hello canonical, argon2 production-param) go red.
