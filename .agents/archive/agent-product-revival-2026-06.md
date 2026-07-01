# VOID Agent Product — Archive & Revival Dossier (2026-06)

**Status:** ARCHIVED / REMOVED from the live monorepo as of June 2026 (Task #1056).
**Purpose:** This document is the self-sufficient recovery record for the deleted VOID
agent product. With this doc plus the archive git ref (below), a future engineer can
rebuild the agent coordination product byte-for-byte compatible with the version that
shipped, or re-derive it from scratch.

**Where the bytes live:** the full source tree (every file referenced here, verbatim) is
preserved at the git refs created at the OPERATOR GATE before deletion:
- branch `archive/agent-product`
- annotated tag `archive/agent-product-2026-06`

Both point at the last commit that still contained the agent cluster **and** this dossier.
Restore any single file with `git show archive/agent-product-2026-06:<path>`, or the whole
tree with `git archive archive/agent-product-2026-06 | tar -x -C <dir>`.

> **Never-ship:** this file lives under `.agents/`, which the publish scrub removes wholesale
> (`rm -rf "$PUB/.agents"`, see `docs/pre-publish-scrub-2026-06.md` §3) and which
> `check-publish-cross-links` already treats as never-ship. It is tracked in the private
> monorepo only and must never reach the public mirror.

---

## 1. What was removed

| Path | Kind | Role |
|------|------|------|
| `lib/agent-protocol/` | shared lib | Wire contract: envelope/handshake schemas, error taxonomy, argon2id room-credential primitive (`deriveRoomBytesArgon2id`), timing-safe string compare, domain-separated Ed25519 signing contexts, `PROTOCOL.md`, machine-readable `void-agent-mode.json`. The single source of crypto params shared by browser, Node fixtures, and the SDK. |
| `lib/void-agent-sdk/` | headless SDK | The shippable agent runtime: `agent.ts` (handshake, channel mgmt, hello/capability negotiation), `transport.ts` + `transportStateMachine.ts` + `peerTransport.ts`, `signalingClient.ts`, `keyExchanger.ts`, `relayVerifier.ts` (relay-only path proof), `rpc.ts`, `ice.ts`, `crypto.ts`, `event-log.ts`. Demos (`buyer/seller/tool-client/tool-server/smoke`), pilot harness (`Dockerfile.pilot`, `pilot/`), `README.md`/`PLATFORM.md`/`DEBUGGING.md`. |
| `lib/agent-spike/` | research spike | The reference implementation and the **canonical crypto test vectors** (`src/test-vectors.ts`, `src/crypto.ts`) plus `demo/{creator,joiner,run-spike}.ts`. This is the cleanest, smallest correct implementation — start any revival reading here. |
| `artifacts/coordination-demo-video/` | video artifact | Marketing/explainer video for agent coordination. |

**Dormant hooks stripped from the surviving human surface** (see §7 for exact reconciliation):
- `artifacts/void-client/src/lib/voidPhrase.ts` — `void-secret:` (agent-secret) invite detection.
- `artifacts/void-client/src/lib/helloEnvelope.ts` — agent room-type awareness in the human hello.
- `lib/wire-core/src/schemas.ts` — `RoomType` enum members `agent` / `hybrid`.
- `artifacts/void-client` — `/agents` route + `AgentModePage`, agent SDK links, coordination demo embeds.

---

## 2. Product overview

VOID Agent Mode let **headless software agents** negotiate, exchange data, and collaborate
over the same ephemeral, E2E-encrypted P2P substrate VOID uses for human video. Protocol id
`void-agent/1`. Two agents (or an agent + a human "hybrid" room) shared an invite, derived
identical room credentials from it (server never sees the invite), connected over WebRTC, ran
an ECDHE handshake to a fresh AES-256-GCM session key, then spoke a small envelope protocol
over named data channels. Relay-only (TURN) transport was the default for agent rooms with a
verifier that proved the active path was actually relay-backed.

It was a separate **product** layered on shared core (`api-server`, `wire-core`,
`signaling-types`, `api-spec`). The decision in #1056 was to ship VOID as human-P2P-video-only
and fully retire the agent product rather than maintain a dual pitch.

---

## 3. Architecture

```
                 invite (void-phrase | void-secret:)
                          │  deriveRoomCredentials()  (server never sees invite)
                          ▼
   roomId (16B hex) ──► signaling server (api-server)  ◄── peer discovery only
                          │  encrypted SDP/ICE relayed, never decryptable by server
                          ▼
        WebRTC PeerConnection (TURN relay-only default for agent rooms)
                          │
        ┌─────────────────┴──────────────────┐
        │  void.control   void.rpc   void.stream  (named data channels)  │
        └─────────────────┬──────────────────┘
                          │  ECDHE P-384 → HKDF → AES-256-GCM session key
                          ▼
                  VoidAgentEnvelope (v/type/seq/ts/from/body)
```

Layering:
- **agent-protocol** = the contract (schemas, errors, crypto primitive, signing contexts). No I/O.
- **agent-spike** = minimal correct reference + test vectors. Depends on agent-protocol.
- **void-agent-sdk** = production headless runtime (transport state machine, signaling client,
  relay verifier, RPC). Depends on agent-protocol + shared core.
- shared core (`api-server`, `wire-core`, `signaling-types`) was carried unchanged.

---

## 4. Cryptography (AUTHORITATIVE — supersedes PROTOCOL.md)

> **Drift warning:** `lib/agent-protocol/PROTOCOL.md` §"Credential Derivation" claimed
> *void-phrase → PBKDF2 (SHA-256, 600k, 32-byte salt)*. **That line was STALE.** The shipped
> implementation used **argon2id** via `deriveRoomBytesArgon2id` in `@workspace/agent-protocol`
> (hash-wasm). The pinned test vectors below were produced by the argon2id path; trust the code
> and these vectors, not the PROTOCOL.md prose. Everything else in PROTOCOL.md (channels,
> envelope, handshake, error taxonomy, security model) matched the code.

### 4.1 void-phrase credential derivation (default human + default agent invite)
- Input: 6-word BIP39 mnemonic.
- Normalize: `phrase.trim().toLowerCase().replace(/\s+/g, " ")`.
- KDF: **argon2id (hash-wasm)**, parameters: **m = 64 MiB, t = 3, p = 1, hashLength = 48 bytes,
  fixed 32-byte salt** (the salt is a frozen constant baked into `agent-protocol`; same salt for
  every invite — security comes from the BIP39 entropy + argon2id cost, not a per-invite salt).
- Split 48 output bytes: `roomId = bytes[0:16]` (hex-encoded → 32 hex chars),
  `AES key = bytes[16:48]` (32 bytes → AES-256-GCM).

### 4.2 agent-secret (`void-secret:`) credential derivation (high-entropy machine invite)
- Grammar (frozen):
  ```
  Format:    void-secret:<payload>
  Prefix:    "void-secret:"   (12 chars, literal)
  Payload:   43 chars, unpadded base64url, [A-Za-z0-9_-] only
  Source:    32 cryptographically random bytes, base64url, no padding
  Total len: 55 chars exactly
  Reject on: wrong prefix; payload length ≠ 43; any char outside [A-Za-z0-9_-];
             decoded length ≠ 32 bytes. NEVER silently truncate an invalid secret.
  ```
- Detect kind: `invite.startsWith("void-secret:")` → `agent-secret`, else `void-phrase`.
- KDF: **HKDF-SHA256**, `salt = 32 zero bytes`, `info = "VOID-INVITE-v1"` (UTF-8),
  output 48 bytes, split identically (16 roomId + 32 AES key).
- Generate: `crypto.getRandomValues(new Uint8Array(32))` → base64url (no padding) → prefix.

### 4.3 ECDHE session handshake
- Curve **P-384**; `deriveBits` 384 shared bits.
- Session key: **HKDF-SHA256**, `salt = 32 zero bytes`, `info = "VOID-ECDHE-v1"`,
  → AES-256-GCM 256-bit key.
- SAS (short authentication string): **separate** HKDF, `salt = 32 zero bytes`,
  `info = "VOID-SAS-v1"`, 32 output bits → big-endian uint32 `v`; two BIP39 indices:
  `word1 = (v >>> 21) & 0x7ff`, `word2 = (v >>> 10) & 0x7ff`. Rendered as the two index strings.
- Shared secret bytes are zero-filled after derivation.

### 4.4 AES-GCM record format
- 12-byte random IV, prepended to ciphertext, whole blob base64url-encoded.
- Optional AAD (additional authenticated data) string; omitting AAD preserves the legacy
  no-AAD fixtures (cross-impl byte compatibility — Audit M-01 / Task #461). Decrypt mirrors.

### 4.5 Domain-separated Ed25519 signing
- Signing payload = `context_prefix + canonicalize(data)` → UTF-8 → Ed25519 sign.
- Contexts (NUL `\0` delimited to prevent prefix collision):
  - Hello: `void-agent/1\0hello\0`
  - Envelope: `void-agent/1\0envelope\0`
- Signing key is ephemeral per session, carried in `SignedHello = {hello, signature, signingKey}`.

### 4.6 Canonical serialization (`canonicalize`)
1. Recursively sort object keys lexicographically at every depth.
2. Preserve array order (arrays NOT sorted).
3. `JSON.stringify` with no whitespace; no trailing commas/comments/BOM; UTF-8 only.
4. Numbers without unnecessary leading/trailing zeros.

Vector:
```
Input:  {"z":1,"a":2,"m":{"c":3,"a":1,"b":2},"arr":[{"z":1,"a":2},{"b":3,"a":4}]}
Output: {"a":2,"arr":[{"a":2,"z":1},{"a":4,"b":3}],"m":{"a":1,"b":2,"c":3},"z":1}
```

---

## 5. Canonical test vectors (verbatim — pin these in any revival)

Source of truth: `lib/agent-spike/src/test-vectors.ts` at the archive ref. Reproduce with
`pnpm --filter @workspace/agent-spike` run of the spike, or the `crypto-tests` workflow
(`lib/agent-protocol/src/crypto-compat.test.ts`).

### 5.1 argon2id room-credential vectors
| Phrase | roomId | AES key (hex) |
|--------|--------|----------------|
| `abandon ability able about above absent` | `2f976675ae793206aea7c2f54eb9f603` | `048925451a57707b1b5f6fc0cf139d2c8ad56dab8195f98b47d17946531f2e17` |
| `zoo zoo zoo zoo zoo zoo` | `cea78ce7f841c0ff886379d0f80722ae` | *(reproducible via spike; not separately pinned)* |
| `crystal rapid mandate penalty fabric crystal` | *(printed by spike; not pinned)* | *(printed by spike)* |

Determinism + negative properties asserted by the spike: same phrase → identical roomId+key;
different phrase → different roomId; wrong key fails AES-GCM decrypt; IV reuse impossible
(random IV → different ciphertext for same plaintext).

### 5.2 Deterministic AES-GCM vector (fixed IV — for cross-impl byte identity)
- Key (hex): `048925451a57707b1b5f6fc0cf139d2c8ad56dab8195f98b47d17946531f2e17`
  (the argon2id key for `abandon ability able about above absent`).
- IV (fixed): `0102030405060708090a0b0c`
- Plaintext: `{"type":"test","data":"hello"}` (UTF-8 JSON, exact key order).
- Output blob (IV ‖ ciphertext‖tag, hex):
  ```
  0102030405060708090a0b0cf9f85ceb5c88351ef25a6e4a073c499d8241ad6a30127d494269397579f0cf8d243aabe6d08a44945d0923567670
  ```

### 5.3 Deterministic ECDHE vector (fixed keys → session key + SAS)
- Private key A (JWK):
  ```json
  {"key_ops":["deriveBits"],"ext":true,"kty":"EC","x":"LGsArJV1VN6vD-gODVnU7WoMcCbSKDKLoX1FhPC8JJ9EsANExVY5eZ_XZhf91Jmn","y":"Vv6nRMomG1Kgr7W-8bf_le3bG3uVDCpg_KtbHVl9C_o32994QIltn2kjeu3Tml5_","crv":"P-384","d":"oY2rov905K28hbRGgx7mSykPGqCLcXlVq3VGO4HiLNNYDVUnOLSM2xpnPPk2Zf0v"}
  ```
- Private key B (JWK):
  ```json
  {"key_ops":["deriveBits"],"ext":true,"kty":"EC","x":"QIWkdPJlRRXBm3MlL-tDR5u_jT5kbLzK3nIPyXty_HKg-rP4YO5Qwa8l5uoOK9gv","y":"DEBygOzOJmFOk5MpWgE0GrjU-eTogatxbR0AG_iXWeuwe86a8uq7dmINTxhGGfow","crv":"P-384","d":"TVVv08SEom3-XAPf9f_0sOAxh-OUi7ML_cLcs9X_WODXZTKw1zoEGa9FNmYnNaIR"}
  ```
- Public key A (raw, hex): `042c6b00ac957554deaf0fe80e0d59d4ed6a0c7026d228328ba17d4584f0bc249f44b00344c55639799fd76617fdd499a756fea744ca261b52a0afb5bef1b7ff95eddb1b7b950c2a60fcab5b1d597d0bfa37dbdf7840896d9f69237aedd39a5e7f`
- Public key B (raw, hex): `044085a474f2654515c19b73252feb43479bbf8d3e646cbccade720fc97b72fc72a0fab3f860ee50c1af25e6ea0e2bd82f0c407280ecce26614e9393295a01341ab8d4f9e4e881ab716d1d001bf89759ebb07bce9af2eabb76620d4f184619fa30`
- Expected session key (hex): `8fdf90cdbf552fa888f239b62eb668877caa1fb703037a616c4ddd08e2f87e1d`
- Expected SAS indices: `["909", "203"]`

> These JWK private keys are **committed test fixtures**, not live secrets — they have always
> been public in the test file. They exist only to pin the derivation.

### 5.4 base64url
Round-trip property over `[0,1,2,255,254,253,128,127]` (unpadded base64url, URL-safe alphabet).

---

## 6. Wire protocol (`void-agent/1`)

### 6.1 Room types
| Type | Relay default | ECDHE required |
|------|---------------|----------------|
| `human` | false | false |
| `hybrid` (human + agent) | false | false |
| `agent` (agent-only) | **true** | **true (no downgrade)** |

Room type is fixed at creation; server defaults to `human`. The server-side gate was
`ENABLE_AGENT_ROOMS` (dormant `=0` posture in the Dockerfile at archive time).

### 6.2 Data channels
| Label | Ordering | Max message | Use |
|-------|----------|-------------|-----|
| `void.control` | ordered, reliable | 8 KiB | handshake, hello, capability negotiation, errors |
| `void.rpc` | ordered, reliable | 64 KiB | structured request/response RPC |
| `void.stream` | unordered, unreliable | 16 KiB | bulk transfer (files/media/logs) |

Oversized messages → `ENVELOPE_TOO_LARGE`. The SDK opens `void.control` + `void.rpc` on
connect; `void.stream` is optional and rejected with `INVALID_ENVELOPE` if used when absent.

### 6.3 Envelope
```json
{ "v": 1, "type": "hello", "seq": 0, "ts": 1718000000000, "from": "agent-abc123", "body": { } }
```
All six fields required. `v` always 1; reject `v<1` or `v>1`. `type` ≤64 chars; `from` ≤128
chars; `seq` monotonic per sender; `ts` epoch ms. Unknown `body` fields preserved but may be
ignored.

### 6.4 Handshake
1. Both peers open `void.control`.
2. Each sends `hello` (ECDH public key + nonce). Hello body fields required:
   `protocol, identity, capabilities, roomType, ecdhPublicKey, nonce, timestamp`. Hello body
   is Ed25519-signed and sent as `SignedHello {hello, signature, signingKey}`.
3. Each derives the session key via ECDHE→HKDF (§4.3).
4. Each sends `hello-ack` confirming SAS verification.
5. All channels thereafter AES-256-GCM encrypted.
- **Handshake timeout 30 s** → `HANDSHAKE_TIMEOUT`. Agent rooms require ECDHE; downgrade →
  `ECDHE_REQUIRED`.

Example hello body:
```json
{
  "protocol": "void-agent/1",
  "identity": { "agentId": "agent-abc123", "name": "MyAgent", "version": "1.0.0", "vendor": "AcmeCorp" },
  "capabilities": { "protocols": ["void-agent/1"], "channels": ["void.control","void.rpc"], "transcriptMode": "none", "maxEnvelopeBytes": 65536 },
  "roomType": "agent",
  "ecdhPublicKey": "<base64url P-384 raw public key>",
  "nonce": "<random 16-64 chars>",
  "timestamp": 1718000000000
}
```

### 6.5 Error taxonomy
| Code | Fatal | Meaning |
|------|-------|---------|
| `HANDSHAKE_TIMEOUT` | yes | ECDHE handshake not completed in time |
| `ECDHE_REQUIRED` | yes | agent room demanded ECDHE; no downgrade |
| `INVALID_HELLO` | yes | hello failed schema validation |
| `UNSUPPORTED_PROTOCOL_VERSION` | yes | peer protocol version unsupported |
| `CAPABILITY_MISMATCH` | yes | no compatible capabilities |
| `ROOM_TYPE_MISMATCH` | yes | incompatible room-type expectation |
| `ROOM_FULL` | yes | agent room at capacity |
| `ENVELOPE_TOO_LARGE` | no | exceeds channel size limit |
| `INVALID_ENVELOPE` | no | failed envelope validation |
| `SEQUENCE_VIOLATION` | no | non-monotonic seq |
| `DECRYPT_FAILED` | yes | key mismatch / tampering |
| `RELAY_UNAVAILABLE` | yes | relay-only required, no TURN available |
| `RELAY_PATH_UNVERIFIED` | no | cannot prove active path is relay-backed |

Fatal → terminate connection; non-fatal → log + drop the message.

### 6.6 Machine-readable manifest
`lib/agent-protocol/void-agent-mode.json` (246 lines at archive ref) is the canonical
machine-readable capability/protocol manifest and `PROTOCOL.md`'s companion. Restore it
verbatim for any spec work — do not retype it from this prose.

---

## 7. Reconciliation applied to the surviving human surface

When the agent cluster was deleted, these dormant hooks in the human-only client/core were
removed (record so a revival re-adds them deliberately, not by accident):

- **`voidPhrase.ts`**: `AGENT_SECRET_PREFIX = "void-secret:"`, `detectInviteKind`, and the
  agent-secret derivation branch were removed. The human client now treats any non-phrase
  invite as an invalid void-phrase and falls through cleanly to the invalid-invite path (no
  crash). Revival must re-introduce `detectInviteKind` + `deriveFromSecret` (§4.2).
- **`helloEnvelope.ts`**: agent room-type advertisement in the browser hello was removed; its
  test was rewritten to not import `@workspace/agent-protocol`. Revival re-adds the agent/hybrid
  branch.
- **`wire-core/src/schemas.ts`**: `RoomType` enum reduced to human-only. Persistence was made
  tolerant of a legacy stored `roomType: "agent"`/`"hybrid"` (treated as human / ignored) so old
  rooms don't break parsing. Revival re-adds the enum members.
- **void-client UI**: `/agents` route + `AgentModePage`, agent SDK links, and the
  coordination-demo-video embeds were removed from nav/routes/landing.

---

## 8. CI / infra removed (verify against archive ref)

Agent-specific `.replit` workflows removed: `smoke-negotiate` (void-agent-sdk demo),
`smoke-tools` (void-agent-sdk demo:tools), `sdk-typecheck`, `crypto-tests`
(agent-protocol crypto-compat), `coordination-demo-video-typecheck`,
`artifacts/coordination-demo-video`.

Other infra edited: `Dockerfile` `ENV ENABLE_AGENT_ROOMS` line; `.github/workflows/`
`void-client-sri.yml` `lib/agent-protocol/**` path filters; `lint-secrets.yml` stale
`@workspace/agent-protocol` comment (repointed to `wire-core`);
`scripts/check-publish-boundary.mjs` agent-import ban (vestigial after deletion, removed).

> Confirm the exact, complete list against `.replit` and `.github/workflows/` at the archive
> ref — those files are the ground truth; this list is a guide.

---

## 9. Recovery / rebuild runbook

**Restore a single file:**
```bash
git show archive/agent-product-2026-06:lib/agent-spike/src/test-vectors.ts
```

**Restore the whole agent cluster into a scratch dir:**
```bash
mkdir -p /tmp/agent-restore
git archive archive/agent-product-2026-06 \
  lib/agent-protocol lib/void-agent-sdk lib/agent-spike artifacts/coordination-demo-video \
  | tar -x -C /tmp/agent-restore
```

**Full reintegration (high level):**
1. `git checkout archive/agent-product` (or cherry-pick the package dirs into a feature branch).
2. Re-add the four package paths to `pnpm-workspace.yaml`; `pnpm install`.
3. Re-add the dormant hooks in §7 (RoomType enum, voidPhrase agent-secret branch,
   helloEnvelope agent branch, `/agents` route).
4. Re-add the `.replit` workflows + Dockerfile `ENABLE_AGENT_ROOMS` + GitHub path filters in §8.
5. Re-add `scripts/check-publish-boundary.mjs` agent-import boundary if keeping VOID/agent split.
6. Run `crypto-tests` and the spike to confirm the §5 vectors still match — this is the
   regression gate proving the crypto wasn't disturbed.
7. Reconcile the documentation guards (signaling-envelope audit, threat-model, doc-code-drift,
   feature-policy-sync, onion-mirror-sync) — they were de-agented during removal and must be
   re-agented in lockstep with the restored code.

**Start reading from:** `lib/agent-spike/` (smallest correct reference + the vectors), then
`lib/agent-protocol/PROTOCOL.md` + `void-agent-mode.json` (the contract), then
`lib/void-agent-sdk/src/agent.ts` (the production runtime).
