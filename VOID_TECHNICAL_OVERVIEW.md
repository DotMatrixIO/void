# VOID — Technical Architecture Overview

**Version:** 0.6
**Date:** May 2026
**Status:** Functional prototype with E2E encryption, ECDHE perfect forward secrecy, SAS verification UX, sovereign TURN relay (no third-party STUN fallback), rate limiting, multi-backend Lightning paywall, single-sharer screen sharing, BURN session control, 6-mode WebGL2 shader engine, 5-mode voice masking, an operator-provisioned `.onion` mirror with Tor Browser `Onion-Location` auto-discovery and an audited fail-open posture (Task #385, `docs/onion-fail-open-audit.md`), a soft Tor-default surface that strongly prefers the published `.onion` path and makes clearnet an explicit, visible opt-down with graceful fallback rather than a silent default (Task #1022, surface variant — the hard redirect default is deliberately held, see `docs/tor-default-path-decision.md`), a runtime onion-only posture attestation at `/api/proof/posture` that lets a reader *verify* the published build's Tor posture rather than trust it (Task #1023), and a reproducible build with client-side bundle-hash verification at `/proof/runtime` (Task #383).

---

## 1. Executive Summary

VOID is an **ephemeral, peer-to-peer video conferencing PWA** built for privacy-first communication. Its hard constraint is **no accounts and no room-content storage** — the accurate claim, narrower than literal "statelessness": the only server-side persistence is a minimal paid-room metadata snapshot (host payment hashes, the paid window, tier and room type, and the `relayOnly` / `locked` moderation flags — never room content or peer identities) that survives an operator restart so a host who refreshes mid-window need not re-pay (§3.5). Operational logs are minimal with a 5-day ceiling (§3.5). Rooms are capped at 4 participants and last a maximum of 65 minutes on the standard tier or 24 hours on the paid DAY tier (`ROOM_TTL_MS` / `ROOM_TTL_DAY_MS`, §3.5). Hosting a session is gated behind a Lightning Network L402-style paywall (1,000 sats/hour); joining is free.

The server's role is minimized to two functions: **WebRTC signaling relay** and **payment verification**. All media flows peer-to-peer. If the server goes down mid-session, established calls continue uninterrupted.

Sessions are initiated with a **6-word BIP-39 VOID Phrase** that simultaneously derives the encrypted room ID and the signaling encryption key. Per-peer ECDH key exchanges upgrade phrase-derived keys to ephemeral session keys (ECDHE perfect forward secrecy), and a 2-word SAS derived from the same shared secret enables in-call peer verification. Video is processed through a 6-mode WebGL2 shader engine; audio is processed through a 5-mode unified voice mask AudioWorklet.

---

## 2. Monorepo Structure

PNPM workspace with catalog-managed dependency versions.

```
/
├── artifacts/
│   ├── void-client/            # Frontend PWA (React 19 + Vite)
│   ├── api-server/             # Signaling + Paywall API (Express 5 + Socket.io)
│   └── mockup-sandbox/         # Design prototyping environment
├── lib/
│   ├── api-spec/               # OpenAPI 3.x contract (covers the full public HTTP surface)
│   ├── api-zod/                # Generated Zod validators (server-side)
│   └── api-client-react/       # Generated TanStack Query hooks (client-side)
├── scripts/                     # Utility scripts
├── coturn/                     # Coturn TURN relay config example
├── Dockerfile                  # Multi-stage production build
├── docker-compose.yml          # App + Coturn containers
├── umbrel-app.yml              # Umbrel app store manifest
├── manifest.yaml               # StartOS/Start9 manifest (Tor + LAN)
├── README-selfhost.md          # Self-hosting guide
├── pnpm-workspace.yaml
└── package.json
```

### Contract-First API Design

The API surface is defined in `lib/api-spec/openapi.yaml`. Orval generates:
- **Server-side** Zod schemas (`lib/api-zod`) for request/response validation
- **Client-side** React Query hooks (`lib/api-client-react`) for type-safe data fetching

This eliminates client/server contract drift at build time.

### Spec Discovery Endpoints

Both spec files are served as static endpoints from any running VOID server instance, enabling external SDK authors and tooling to fetch the contracts without cloning the repo:

| Endpoint | Content |
|---|---|
| `GET /api/openapi.yaml` | OpenAPI 3.1 YAML — describes the full public HTTP surface (`/healthz`, `/paywall/*`, `/ice-servers`, `/openapi.yaml`, `/asyncapi.yaml`) |
| `GET /api/asyncapi.yaml` | AsyncAPI 3.0 YAML — describes the bidirectional Socket.io signaling channel at `/api/socket.io` |

Both endpoints respond with `Content-Type: application/yaml` and `Cache-Control: public, max-age=3600`. The YAML content is bundled into the server binary at build time (esbuild text loader), so no filesystem access is required at runtime and self-hosted deployments always serve the spec that matches the running binary.

---

## 3. Networking & WebRTC

### 3.1 Topology

**Full mesh.** Every participant maintains a direct `RTCPeerConnection` to every other participant. With a hard cap of 4 users, the maximum connection count is 6 (n×(n-1)/2), which is well within browser limits.

### 3.2 Signaling Flow

Signaling uses Socket.io (mounted at `/api/socket.io`). The server is a pure relay — it never inspects or stores media.

```
Joiner                    Server                    Existing Peer
  │                         │                            │
  ├─ join-room(code) ──────>│                            │
  │<── peers[] ─────────────┤                            │
  │                         │                            │
  │  (for each peer):       │                            │
  ├─ relay-signal(offer) ──>├─ relay-signal(offer) ─────>│
  │                         │<── relay-signal(answer) ───┤
  │<── relay-signal(answer)─┤                            │
  │                         │                            │
  │<── ICE candidates ─────>│<── ICE candidates ────────>│
  │                         │                            │
  ├═══════ Direct P2P media stream (no server) ═════════>│
```

### 3.3 End-to-End Encrypted Signaling

All SDP offers/answers and ICE candidates are encrypted client-side before traversing the server:

- **Algorithm:** AES-GCM with 256-bit keys
- **IV:** 12 random bytes per message, prepended to ciphertext
- **Key derivation:** A **6-word BIP-39 mnemonic** ("VOID Phrase") is entered by the host. `Argon2id` with memory cost **m = 64 MiB** (`memorySize: 65_536` KiB), time cost **t = 3 passes**, parallelism **p = 1**, and a fixed 32-byte salt derives **48 bytes**: 16 bytes → hex room ID (32 hex chars), 32 bytes → AES-GCM phrase key. The canonical parameters and salt live in `lib/wire-core/src/argon2.ts` (`ARGON2ID_ROOM_PARAMS`, `ROOM_DERIVATION_SALT`) and are imported verbatim by the browser client (`artifacts/void-client/src/lib/voidPhrase.ts`). The API server itself does not derive room credentials; it only sees the already-derived hex room ID. There is no negotiated downgrade path. The salt is intentionally fixed and public: a per-room salt is structurally impossible because the phrase is the only shared secret between participants who never reveal an identity to the server (see `argon2.ts` comment and `docs/security-audit-public-2026-04.md` §1.1).
- **Key sharing:** The phrase is shared via URL fragment (`#word1-word2-word3-word4-word5-word6`), which is never sent to the server.
- **Entropy:** ~2^66 combinations for a 6-word BIP-39 phrase drawn from a 2048-word wordlist. This entropy floor is the load-bearing defense, not the KDF parameters. Phrase generation in `voidPhrase.ts` (`generateVoidPhrase()`) draws its word indices exclusively from `crypto.getRandomValues(new Uint32Array(6))` — there is no `Math.random` fallback path, and the function throws if `crypto.getRandomValues` is unavailable rather than silently degrading.
- **What the salt does and does not do:** `ROOM_DERIVATION_SALT` is a fixed, public 32-byte constant (see §3.3 prose above and `lib/wire-core/src/argon2.ts`). A fixed public salt means an attacker can precompute a single rainbow table of phrase → room-ID once and reuse it forever against every VOID deployment; no per-room or per-server salt re-randomizes the search space. The defense against that precomputation is the entropy floor in the previous bullet (2^66 phrases × 64 MiB × 3 passes per guess), not the salt itself. Memory-hardness raises GPU/ASIC brute-force cost meaningfully above pure-CPU — it does not "defeat" GPUs or ASICs, and we do not claim it does. A per-room salt is structurally impossible because the phrase is the only shared secret between participants who never reveal an identity to the server; this is documented at the constant.
- **Mismatch handling:** If a peer joins without the key (or with a wrong key), `decryptSignal()` throws on `AES-GCM` authentication failure. The `handleRelay` method catches the error and silently drops the payload — the WebRTC connection simply never establishes. There are no explicit error codes emitted to the UI for this case; the peer appears as perpetually "connecting." This is intentional — the server cannot distinguish "wrong phrase" from "no peer yet" without leaking room existence to a probe.

Implementation: `signalCrypto.ts` (encrypt/decrypt), `voidPhrase.ts` (key derivation + phrase generation/validation).

### 3.3.1 ECDHE Perfect Forward Secrecy and SAS Verification

After the phrase-derived AES key establishes an initial encrypted channel, peers perform an **Elliptic Curve Diffie-Hellman Ephemeral (ECDHE)** key exchange to upgrade to per-peer session keys, providing perfect forward secrecy:

1. **Key pair generation:** Each peer generates a P-384 (`ECDH`, `namedCurve: "P-384"`) ephemeral key pair at connection time.
2. **Signed-Hello key-exchange envelope:** The raw ECDH public key is base64url-encoded and carried inside a **Signed-Hello envelope** — an `Ed25519` signature (`signHello`) over a canonical payload that binds the `ecdhPublicKey`, its SHA-256 `ecdhFingerprint`, a 24-byte `nonce`, a `timestamp`, the `roomId`, the `roomType`, and the peer identity. The whole envelope is then transmitted as a `key-exchange` signal message, AES-GCM-encrypted under the phrase-derived key for transport. On receipt, `verifySignedHello` re-checks the Ed25519 signature, the fingerprint, a ±5-minute timestamp-skew window, a per-peer nonce cache (same-sender replay defense), the `roomId` bind, and — when the verifier supplies an `expectedRoomType` — the signed `roomType` bind, **before** the ECDH public key is ever used to derive a session key; any failure throws `HelloVerificationError` and the channel fails closed (`hello_invalid`). The browser derives the `expectedRoomType` *locally from the 6-word phrase invite* (always `human`) and never from the server, so a forged or relay-tampered hello that advertises a different room type to weaken policy is rejected with `room_type_mismatch`. Shared source of truth: `lib/wire-core/src/hello-envelope.ts`.
3. **Shared secret derivation:** `crypto.subtle.deriveBits` produces 384 bits of shared secret from the ECDH operation.
4. **HKDF-SHA256 session key:** The shared secret is fed into `HKDF-SHA256` with info string `"VOID-ECDHE-v1"` to produce a 256-bit AES-GCM session key. All subsequent signaling for that peer pair uses this session key instead of the phrase key.
5. **SAS (Short Authentication String):** A separate HKDF pass with info string `"VOID-SAS-v1"` produces 32 bits used to select two BIP-39 words. Both peers display this 2-word SAS so users can verbally verify identity.
6. **Fail-closed (no silent downgrade):** There is **no** phrase-key fallback for the live channel and no fallback timeout. The phrase-derived AES key only ever carries the `key-exchange` handshake messages themselves (step 2, `relayWithPhraseKey`); once ECDHE completes, `installSessionKey()` swaps every subsequent signal to the per-peer session key. If the exchange cannot be completed — missing local key, `hello` signature / room-ID verification failure, or any ECDH-derivation error — `WebRTCManager.failSecureChannel(peerId, "ecdhe_failed")` (or `"hello_invalid"`) closes the `RTCPeerConnection`, deletes that peer's session and ephemeral keys, marks the connection `failed`, and raises the user-visible secure-channel-failure overlay. The peer is never downgraded to the room-wide phrase key. This is the April 2026 audit's **M-01 no-silent-downgrade invariant**; source of truth is `handleKeyExchange` / `performKeyExchange` / `initiateOffer` in `webrtc.ts`.

**Why the Signed-Hello matters (and where it stops).** Because the ECDH public key is a *signed* field of the hello (step 2), a relay or on-path attacker cannot silently substitute a different ECDH key into the relayed `key-exchange` payload — any mutation invalidates the Ed25519 signature (or the fingerprint / skew / nonce / `roomId` checks) and the channel fails closed. The signature binds the ECDH key to a per-handshake Ed25519 identity; however that identity is **self-asserted** — the `signingKey` rides inside the envelope, with no PKI or cross-session pinning of the Ed25519 key in the browser path — so a *full* active MITM that forges an entire hello on each leg (its own Ed25519 + ECDH) is defeated by the out-of-band **SAS** comparison (step 5), not by the signature alone. The two mechanisms are complementary: the signature stops in-transit ECDH-key substitution; the SAS stops endpoint impersonation.

**SAS verification UX.** Each peer tile in the video grid carries a small verification chip with four states:

| State | Label | Meaning |
|---|---|---|
| pending | `SECURING…` | ECDHE handshake not yet complete |
| unverified | `TAP TO VERIFY` | SAS computed; user has not yet confirmed |
| verified | `YOU VERIFIED` | User has confirmed the 2-word SAS matches the remote peer |
| mismatch | `CHECK FAILED` | User explicitly marked the SAS as not matching |

Tapping the chip opens a portal-rendered popover (anchored to the chip on desktop, presented as a centered sheet on narrow viewports) that shows the 2-word SAS in large monospace, with `MATCH` and `NO MATCH` actions. An aggregate header chip above the grid shows `YOU VERIFIED N/M PEERS`. Verification state is **SAS-keyed and local-only** — it is never emitted over the wire, and it auto-invalidates whenever the SAS rotates (rekey, reconnect, or new peer joining). When the SAS for an already-verified peer changes mid-call, a click-to-reverify notice appears next to that peer's tile.

Implementation: `signalCrypto.ts` (`generateECDHKeyPair`, `exportECDHPublicKey`, `importECDHPublicKey`, `deriveSessionKey`, `deriveSAS`), `webrtc.ts` (`performKeyExchange`, `handleKeyExchange`), `RoomPage.tsx` (chip, popover, mobile sheet, aggregate counter, re-verify notice).

### 3.4 ICE Configuration

- **Sovereign TURN support:** `GET /api/ice-servers` returns time-limited ephemeral credentials when `TURN_URL` and `TURN_SECRET` env vars are set. Credentials are HMAC-SHA1 signed with a configurable TTL. The default TTL is `ROOM_TTL_SECONDS + 10-minute safety buffer` (4,500 seconds = 75 minutes), bounded by `MIN_TTL=300` and `MAX_TTL=86400` and overridable via `TURN_CREDENTIAL_TTL`.
- **Fallback (fail-closed):** When neither `TURN_URL` nor `STUN_URL` is configured, `GET /api/ice-servers` returns `{ iceServers: [] }` and clients negotiate with host candidates only — most cross-NAT calls then fail to connect. We deliberately do **not** fall back to third-party public STUN (e.g. Google's), because that would leak both peers' public IPs to a third party on every call. When only `STUN_URL` is set, that single entry is returned. Operators see a startup `WARN` (`ICE: no STUN_URL or TURN_URL configured …`) when both are unset.
- **Relay-only mode:** Rooms can be created with `relayOnly: true`, which sets `iceTransportPolicy: "relay"` on all peer connections, forcing all traffic through the TURN server. This hides peer IP addresses from each other at the cost of additional latency. The host opts in via a "HIDE MY IP ADDRESS FROM PEERS" toggle in the preview gate; the room policy is shared by all participants.
- **Rate limiting:** ICE server endpoint is rate-limited to 10 requests/IP/minute. The room-state proof endpoint (`GET /api/room-state/:code`, behind `/proof/server-state`) is rate-limited to 10 requests/IP/minute; over-limit requests get `429 { error: "RATE_LIMITED" }`. Normal manual use (a person pasting one code and reading the JSON) never approaches this ceiling; the limit prevents an attacker holding a set of harvested room codes from hammering the endpoint to track rooms in real time (proof-page-as-scraping-oracle).
- **Onion-aware ICE pinning:** When the page is loaded over a `.onion` origin, the client unconditionally pins `iceTransportPolicy: "relay"` for every local `RTCPeerConnection` it constructs — regardless of the host-chosen room policy. This prevents WebRTC from gathering host or srflx candidates that would otherwise expose the user's clearnet IP to peers on a network the user explicitly chose to access over Tor. The single source of truth is `initialIceTransportPolicy()` in `artifacts/void-client/src/lib/origin.ts`; `RoomPage` consumes it at first-join time.
- **Onion fail-open audit:** The list of outbound network hosts an onion-origin page can resolve has been audited end-to-end and pinned by a regression test (`__tests__/onion-no-clearnet-egress.test.ts`). The verbatim hostname inventory and methodology live in `docs/onion-fail-open-audit.md`. The audit found exactly one production behavioural difference between clearnet and onion: the sats→USD price hook (`hooks/useSatsToUsd.ts`) short-circuits to `null` on onion rather than calling `api.coingecko.com`, so the "≈ $0.xx" hint on the paywall and landing page is hidden when the page loads over Tor. The threat-model page (`ThreatModelPage.tsx` "TOR AND THE MEDIA PATH" section) carries the verbatim hostname list from the audit doc.
- **Onion-Location header:** The API server emits an `Onion-Location` HTTP response header on every clearnet HTTPS response when `ONION_HOSTNAME` is configured. Tor Browser reads this header and surfaces a one-click "switch to .onion?" prompt with no client-side UA sniffing. The header is path-equivalent (carries the same `originalUrl` the user was reading) and is suppressed on inbound `.onion` requests to avoid redirect loops. See §8.6 for the operator-side details.
- **Soft Tor-default surfacing (Task #1022, surface variant):** When a `.onion` mirror is published, the client *strongly surfaces* it as the preferred path and makes clearnet an explicit, visible state rather than a silent default — it never forces or redirects a user onto `.onion`. In a call, a non-alarming `CLEARNET PATH` indicator renders beside the E2E/relay badges when the session loaded over clearnet while a `.onion` mirror exists (suppressed when none is configured, and on the `.onion` origin itself, where the positive Tor badge already covers it). On clearnet info pages the footer `.onion` affordance names the current path, offers the one-click switch, and carries a bootstrap-honesty disclosure: the current visit already reached the server over the public internet, and opening `.onion` keeps the *signaling* layer behind a hidden service from then on — it does **not** retroactively hide that first contact, and it does **not** hide an IP from the other people on a call (media still relays via clearnet TURN; see the relay-only and onion-aware ICE pinning bullets above and `docs/privacy-non-goals.md`). The **hard** default — actually loading or connecting a fresh client over `.onion` — is deliberately **held** pending real target-network reachability evidence; the rationale and the gate that would flip it live in `docs/tor-default-path-decision.md`.
- **Onion-only posture attestation (Task #1023):** `GET /api/proof/posture` serves a `no-store` JSON attestation (`artifacts/api-server/src/lib/torPosture.ts`) so a user or source-protection desk can *verify* — not merely trust — the privacy posture the threat model discloses. It derives three facts from runtime config and the reproducible-build identity, never from a self-reported badge: `torOnly` (`TOR_ONLY=1` is in force), `iceStunSuppressed` (`/api/ice-servers` emits no STUN in either branch, so no STUN binding leaks a peer's IP to a clearnet third party), and `onionIngress` (a valid `.onion` `ONION_HOSTNAME` fronts ingress). `onionOnlyPostureActive` is true only when all three hold, and every field is bound to the `gitSha` / `releaseTag` a verifier confirms against the cosign-signed `SHA256SUMS` and the §7a cross-network rebuild ritual. The response `caveat` is load-bearing and states the non-claims plainly: it attests the *published, reproducible build's posture at read time*, **not** that the operator runs the un-modified attested binary, **not** that config did not change a moment after the read (a TOCTOU window), and **not** that no logging proxy sits upstream of the attested process. The honest claim is "verify the published build's posture," never "the operator structurally cannot ever see an IP." See §8.5 and `README-selfhost.md` §7a.

### 3.5 Room Lifecycle

Live room state — connected peers, socket IDs, host socket, pending knocks, screen-share reservations — is **in-memory only** (`Map<string, RoomState>` in `rooms/registry.ts`; `rooms.ts` is now just a barrel re-export after the Task #447 decomposition). No database, no Redis. The **durable contract of a paid room is persisted, however**: a minimal snapshot (`code`, `createdAt`, `expiresAt`, `tier`, `roomType`, `relayOnly`, `locked`, and the `hostReclaimTokenHashes` entitled to reclaim host) is written to `data/rooms.json` (override `ROOM_STATE_FILE`) by `roomsPersistence.ts` — debounced on every room mutation, flushed synchronously on shutdown — and rehydrated at startup so a `SIGTERM` → restart cycle does not strand existing peers or force the host to re-pay. The snapshot is bounded by the room's own paid TTL (≤ 24 h): expired records are dropped on rehydrate and the file is compacted or deleted when no room survives. Volatile per-socket state is never persisted; it dies with the sockets and peers reconnect. The persisted `hostReclaimTokenHashes` stores a *keyed* HMAC (`HMAC(PAYWALL_SECRET, reclaimToken)`) of a per-room **reclaim token** that is decoupled from the Lightning `paymentHash` entirely, so nothing payment-derived is written to disk; operational `warn`-level logs on two paywall paths likewise carry only a non-reversible digest of a `paymentHash`, never the raw value (see the disk inventory later in this section and the law-enforcement page).

Room IDs are 32-character lowercase hex strings derived deterministically from the VOID Phrase via Argon2id (see §3.3 for parameters). Peer IDs follow the pattern `peer-[a-z0-9]{6}`.

> **Canonical event reference:** the table below is a high-level
> summary. The machine-readable contract for every signaling event
> (request payload, ack callback shape, broadcast payload, and the
> shared error-code enum) lives in
> [`lib/api-spec/asyncapi.yaml`](./lib/api-spec/asyncapi.yaml)
> (AsyncAPI 3.0). Treat that file as the source of truth; this section
> is the prose companion.

**Timing constants:**
- **Room TTL:** 65 minutes for the standard tier (`ROOM_TTL_MS = 65 * 60 * 1000`); 24 hours for the paid DAY tier (`ROOM_TTL_DAY_MS = 24 * 60 * 60 * 1000`). The host pays for a window; the room exists for that full window whether or not anyone is currently connected — there is intentionally no "empty room prune" timer. This lets a host who refreshes mid-call, or steps away for a few minutes, return and rejoin via the phrase URL without paying again.
- **Per-room expiry timer:** Each room arms a `setTimeout` at creation that deletes it exactly at TTL.
- **Periodic GC sweep:** Every 30 seconds, any room that somehow outlived its expiry timer is forcibly deleted (`GC_INTERVAL_MS = 30 * 1000`).
- **Screen-share reservation TTL:** 12 seconds (`SCREEN_SHARE_RESERVATION_TTL_MS = 12_000`)

| Event | Behavior |
|---|---|
| `create-room` | Requires valid JWT. Validates hex-32 room ID. Initializes `RoomState` with host socket tracking and `roomType` (always `human`). |
| `join-room` | Validates room exists, not full (≤4), not locked. Adds peer, broadcasts `peer-joined`. |
| `leave-room` / disconnect | Removes peer, broadcasts `peer-left`. The room itself persists for the rest of its paid TTL even if the room is now empty. If the locker/knock-enabler departs, the room unlocks / disables knock mode. |
| `lock-room` / `unlock-room` | Host-only. Prevents/allows new joins. |
| `set-knock-mode` | Host-only. Enables knock-to-enter mode. |
| `approve-knock` / `deny-knock` | Host approves or rejects pending knock requests. |
| `request-screen-share` | Reserves the single screen-share slot for 12 seconds while the client opens `getDisplayMedia()`. Server replies with `screen-share-granted` or `screen-share-denied`. |
| `screen-share-started` | Promotes the reservation to the active screen share. Server broadcasts the new `screen-share-state` to all peers. |
| `screen-share-stopped` | Releases the slot. Server broadcasts the cleared `screen-share-state` to all peers. |

<!-- BEGIN GENERATED: server-observable (from docs/_fragments/server-observable.md) -->
#### What the server can see

A signaling relay is not a black box. Distinct from what it *stores*, here is the full inventory of what the server-side process observes in memory while a room is live:

- **Source IPs** of every connected socket (the L4 peer address; `req.ip` after the configured `trust proxy` hop). Required to enforce per-IP socket caps and per-IP rate buckets.
- **Connection timing.** When each socket connected, when it joined, when it left, when it disconnected — at millisecond resolution, because the event loop sees the events when they happen.
- **The 32-character lowercase hex room ID.** The phrase itself never reaches the server (it lives only in the URL fragment and the client-side KDF), but the derived room ID is the routing key for every signaling event and is therefore in plaintext in the process.
- **The peer-ID → socket-ID → IP mapping** for the duration of the connection. The server is the relay; it has to know which socket gets which broadcast.
- **Screen-share lifecycle events in plaintext.** `request-screen-share`, `screen-share-started`, `screen-share-stopped`, and the resulting `screen-share-state` broadcast all transit the server as structured events — the server knows exactly who is sharing and when they started or stopped. This one stays server-arbitrated by design: there is a single shared presenter slot, and the server is the only party positioned to arbitrate that mutual exclusion fairly across peers who cannot all see each other yet. The tradeoff is explicit — the cost of a fair, race-free presenter lock is that the server sees who is sharing and when.
- **Lock / unlock / knock-mode events and pending-knock metadata.** Same shape — host actions are server events.
- **Room metadata exposed by `/api/room-state/:code`.** Anything `/proof/server-state` will print back to a user is, by construction, something the server sees: peer count, host presence, lock state, knock-mode state, screen-share state, room type, TTL.

What this means in practice. **The server observes these events in real-time, on the wire.** Whether any of them reaches disk depends on the logging configuration. The current production access logger (`artifacts/api-server/src/lib/accessLog.ts`, Task #374) writes one line per HTTP request — method, scrubbed URL, status, duration, IP — and **does not persist screen-share lifecycle events**; those live only in memory and only for as long as the room exists. A server operator who modifies the logger to emit those events, an attacker who compromises the running process, or a passive observer of the wire who can de-TLS the signaling channel can reconstruct a transcript like: "Peer B started a screen share at minute 5, Peer A left at minute 7, the host locked the room at minute 8, a knock arrived from a new IP at minute 9." The pattern itself is on the wire whether or not we choose to write it down. Overclaiming that the server *stores* this would be cosplay; understating that the server *sees* it would also be cosplay. Both are stated honestly here.

Per-peer **camera / mic / voice-mask / Tor-origin state is deliberately absent from both lists above.** It used to be a plaintext `peer-media-state` envelope the server broadcast (and therefore saw) every time a peer toggled their mic or camera. As of Task #868 it rides a per-peer `void.media-state` WebRTC data channel over DTLS-over-SCTP — the same encrypted association as media — and the signaling server no longer relays, reads, or is even on the path for it. The mute/camera transcript line ("Peer A muted at minute 4") that the wire-observer could previously reconstruct is gone: that toggle never reaches the server in any form. See `docs/signaling-envelope-audit.md` Table 2 for the channel's full envelope.

#### What the server cannot see

By construction, the server is excluded from:

- **The VOID Phrase.** It lives only in the URL fragment and the host's local KDF inputs; it is never sent over the network in any form.
- **Decrypted SDP offers, answers, or ICE candidates.** All signaling payloads carried via `relay-signal` are E2E-encrypted under the phrase-derived AES-GCM key (and, after ECDHE upgrade, under per-peer session keys). The server forwards opaque ciphertext.
- **Media content.** Audio and video travel peer-to-peer over SRTP (WebRTC's default media encryption) and never touch the server. In `relayOnly` mode they still travel through Coturn, but Coturn relays UDP packets — it does not have the keys.
- **Per-peer verification state (SAS).** Whether a user tapped `MATCH` or `NO MATCH` on a verification chip is computed and stored locally in the browser; it is never emitted over the wire.
<!-- END GENERATED: server-observable -->

<!-- BEGIN GENERATED: disk-logs (from docs/_fragments/disk-logs.md) -->
#### What we currently write to disk

The relay keeps the bare minimum it takes to run a public service. Two things touch disk, with two different ceilings: short-lived **operational logs** (rotated out within five days) and a small **room-state snapshot** that lets paid rooms survive a restart (kept only until the room's paid window expires). This is the canonical disk inventory — the page surfaces that publish a disk policy import it verbatim so they cannot drift from one another or from the access logger in `artifacts/api-server/src/lib/accessLog.ts` and the room-state persistence in `artifacts/api-server/src/roomsPersistence.ts`.

**LOGS — KEPT, ROTATED OUT WITHIN 5 DAYS**

- Timestamp, client IP (used by the per-IP rate limiter), HTTP method, path, and status code for each request.
- Socket.io connection lifecycle events — a connect, a join, a leave, a disconnect, and the per-IP open-connection count at the time.
- The 32-character hex room ID on *error-path* lines only (4xx, 5xx, malformed-code rejections) so an operator triaging a real client error can correlate it with the room that failed.
- A short, non-reversible **digest** of the Lightning `paymentHash` — the first 12 hex characters of its SHA-256 — in place of the raw value wherever a payment identifier would otherwise reach a log line: on the two server-side `warn`-level paths (when the Lightning backend is unreachable on `/paywall/status`, and when a settled invoice has no in-memory tier mapping after a restart between invoice creation and settlement), and in the `info`-level HTTP access line, where the `paymentHash` appears as a path segment on `/paywall/status/:paymentHash` and is scrubbed to the same digest on **every** status code, by path position — so it covers the 64-hex hash of the default Lightning backend as well as a BTCPay backend's own identifier shape. The `warn` paths are on by default (`warn` log level); the access line needs `LOG_LEVEL=info`. The raw `paymentHash` is **never** written to a log. The digest lets an operator line up log lines about the same payment; note it is an *unkeyed* hash, so a party who already holds candidate payment hashes (for example a Lightning backend's own settlement records) can hash those and match the prefix — the digest removes the raw value and preserves triage, it does not by itself defeat a holder of the settlement set. Like everything in this bucket these rotate out within five days. (The room-state snapshot's `hostReclaimTokenHashes` below stores a *keyed* HMAC of a per-room **reclaim token** that is decoupled from the `paymentHash` entirely — so nothing payment-derived is written to disk in either bucket.)

**ROOM-STATE SNAPSHOT — KEPT UNTIL THE ROOM'S PAID WINDOW EXPIRES**

To survive a `SIGTERM` → restart cycle (or a crash) without stranding paying hosts, the relay persists a minimal per-room record to a JSON file (`data/rooms.json` by default, overridable via `ROOM_STATE_FILE`). It is written debounced on every room mutation, flushed synchronously on shutdown, and rehydrated at startup. For each room that has not yet expired it stores:

- The 32-character hex room code, its `createdAt` / `expiresAt` instants, the paid `tier` and `roomType`, the `relayOnly` privacy flag, and the `locked` moderation flag.
- `hostReclaimTokenHashes` — the set of host **reclaim tokens** entitled to reclaim host on rejoin, each stored as a **keyed HMAC** (`HMAC(PAYWALL_SECRET, reclaimToken)`), never the raw value. A reclaim token is a fresh per-paid-window random 32-byte value minted alongside the host-authorization JWT and decoupled from the Lightning `paymentHash` entirely — it is the *only* host-claim secret the room persists, and it carries no payment linkage. Reclaim HMACs the rejoining host's `reclaimToken` and compares; a stable `PAYWALL_SECRET` is required for it to work across a restart, which is the same precondition reclaim already had (the host-authorization JWT is verified under the same secret). Because nothing payment-derived is stored, a holder of a seized snapshot file — **even one who also holds `PAYWALL_SECRET`** — cannot correlate a room code against a Lightning backend's settlement records. (The JWT still carries the raw `paymentHash` to the client for the in-memory single-use replay guard, but that value never reaches disk.)

Volatile per-socket state — socket IDs, peer IDs, pending knocks, knock-mode, and screen-share reservations — is **never** persisted; it dies with the sockets and peers reconnect after a restart.

**NEVER KEPT**

- The six-word VOID Phrase. It is carried in the URL fragment and never sent to the server in the first place — there is nothing for the log to omit.
- WebRTC signaling payloads (SDP, ICE candidates). They pass through the relay end-to-end encrypted and are not written to disk.
- The 32-character hex room ID on *success-path* access lines and on success-path socket lifecycle lines. Where it would otherwise appear, the logger writes `<room-id>` in its place. This is enforced by tests on the access-log middleware and the socket lifecycle logger; remove the scrub and the build fails.
- Screen-share lifecycle events (`request-screen-share`, `screen-share-started`, `screen-share-stopped`). These are server-arbitrated envelopes — the relay sees them live, on the wire, but does not persist them under the current logger.
- Lock/unlock and knock-mode events. Same shape — server sees them live, does not persist.
- Per-peer **camera / mic / voice-mask / Tor-origin state.** As of Task #868 this no longer transits the server at all: it rides the per-peer `void.media-state` WebRTC data channel (DTLS-over-SCTP), so the relay neither sees it on the wire nor has anything to persist. It is listed here only to be explicit that the old plaintext `peer-media-state` broadcast is gone — not merely un-logged, but off the server path entirely.

**RETENTION CEILINGS**

- **Logs:** five days. The production box enforces it with `logrotate` (see `deploy/logrotate.d/void` in the source tree). Self-hosters who use `journald` instead set `MaxRetentionSec=5day` — same ceiling, different file.
- **Room-state snapshot:** the room's own paid TTL — at most 65 minutes (standard) or 24 hours (day tier). Expired records are skipped on rehydrate; the file is compacted within five minutes of a room aging out, and deleted entirely at startup when no room survives. This is a *shorter* ceiling than the log rotation, not a longer one.

**Framing — this list is not the live-observable list.** Server-visible room-routing events are not automatically equivalent to disk artifacts. The live-observable bucket (the §3.5 server-observable fragment) lists everything the server can in principle see while a room is up; this bucket lists what actually ends up on disk under the current operator configuration. An operator who modifies the logger, an attacker who compromises the running process, or a passive observer of the wire can capture everything in the live-observable bucket whether or not it ever reaches a file here.
<!-- END GENERATED: disk-logs -->

### 3.6 Knock-to-Enter

The host can enable `knockMode` on a room. When enabled:
1. New joiners are added to a `pendingKnocks` list instead of being admitted directly.
2. A `knock-request` event is sent to the host.
3. The host approves via `approve-knock` (peer joins room) or denies via `deny-knock` (peer is disconnected).
4. Knockers can cancel via `cancel-knock`.

### 3.7 Rate Limiting

| Scope | Limit |
|---|---|
| Socket connections per IP | 50 max |
| `create-room` events | 10/minute per socket |
| `join-room` events | 10/minute per socket |
| `join-room` per IP | 50/minute |
| `request-screen-share` events | 5/minute per socket |
| `relay-signal` events | 200/10 seconds per socket |
| Failed join attempts | 3 failures → exponential backoff (2s × 2^n, max 30s) |

### 3.8 Screen Sharing

Screen sharing follows a **two-phase reservation** pattern so that two peers cannot race the single screen-share slot.

1. The user clicks SCREEN; the client emits `request-screen-share`. The server attempts to reserve `{ peerId, socketId, expiresAt: now + 12s }` and replies with either `screen-share-granted` (success) or `screen-share-denied` (failure with one of `SLOT_OCCUPIED` — another peer is actively sharing — or `SLOT_RESERVED` — another peer is mid-reservation).
2. On grant, the client opens a pre-share warning modal (`SCREEN SHARE WARNING`) before invoking `navigator.mediaDevices.getDisplayMedia()`. The warning explains that the chosen window or screen will be visible to all peers.
3. When `getDisplayMedia()` resolves, the client emits `screen-share-started`. The server promotes the reservation to `activeScreenSharePeerId` and broadcasts the new `screen-share-state` to every peer in the room. The local display track **replaces the existing camera track on every `RTCPeerConnection`** via `WebRTCManager.replaceVideoTrack()` — peers see the screen *instead of* the camera while sharing is active.
4. If the reservation is not confirmed within 12 seconds (user dismisses the OS picker, takes too long, etc.), the server clears it automatically.
5. The control bar SCREEN button cycles through four labels: `SCREEN` (idle) → `…` (requesting) → `STOP SHARE` (sharing) → `IN USE` (another peer is sharing).
6. On `screen-share-stopped`, on the display track ending (e.g. user clicks the browser's "Stop sharing" toolbar), and on socket disconnect, the server clears the active state, broadcasts a fresh `screen-share-state`, and the client restores the camera track via `replaceVideoTrack()`.

### 3.9 Tor Posture (cross-reference)

VOID's Tor mechanisms are implemented across several architectural layers (transport, frontend, self-hosting, security). This subsection is the single entry point that tells the coherent story for a reader who wants "how does Tor work here, and what does it protect"; each claim links to the section where the mechanism is specified, and those sections remain self-contained.

**What Tor protects: the signaling path, not the P2P media path.** A user who reaches VOID over a Tor `.onion` address hides, from the signaling server, the IP and network they connected from. It does **not** tunnel the WebRTC media. By default WebRTC would still gather host and `srflx` ICE candidates on the user's underlying network and hand them to peers — which would expose the clearnet IP the user chose to access over Tor. The honest split (signaling protected, media path not Tor-tunneled) is the same one stated user-facing in the threat-model page's "TOR AND THE MEDIA PATH" section.

**Relay-only is on by default over `.onion`.** To close the candidate-leak gap above, the client unconditionally pins `iceTransportPolicy: "relay"` for every `RTCPeerConnection` it constructs when the page is loaded over an onion origin, regardless of the host-chosen room policy (see **§3.4**, "Onion-aware ICE pinning"; source of truth `lib/origin.ts`). Media then traverses the operator's TURN relay rather than going peer-to-peer — so peers do not see each other's IPs, though the TURN operator still does and the media itself is not carried inside Tor. The full inventory of outbound hosts an onion-origin page can reach is audited and regression-pinned (**§3.4**, "Onion fail-open audit"; `docs/onion-fail-open-audit.md`); the one behavioural difference from clearnet is the sats→USD price hook short-circuiting to `null`.

**Discovery is non-sniffing.** When `ONION_HOSTNAME` is set, the API server emits a path-equivalent `Onion-Location` header on every clearnet HTTPS response (suppressed on inbound `.onion` requests to avoid loops), and Tor Browser surfaces its own one-click "switch to the onion version" prompt — there is no client-side UA sniffing (**§3.4**, "Onion-Location header"). An always-visible `ALSO ON .ONION` footer affordance covers other Tor-aware browsers and link-sharing (**§6.2.1**). The operator-side provisioning, CSP parity, source-IP / rate-limit changes, and the CDN-fronted caveat live in the runbook (**§8.6**; `docs/onion-mirror-runbook.md`). Both mechanisms appear as paired wins/limitations rows in the security table (**§10**).

---

## 4. Lightning L402 Paywall

### 4.1 Design Philosophy

Inspired by the [L402 protocol](https://docs.lightning.engineering/the-lightning-network/l402) but simplified for a stateless context. The server issues a Lightning invoice, and upon payment confirmation, returns a short-lived JWT that authorizes room creation. No macaroons — the JWT *is* the bearer credential.

<!-- BEGIN GENERATED: pricing-logic (from docs/_fragments/pricing-logic.md) -->
The price of a thing in USD changes over time. Same with Bitcoin. So, a 1-hour room is the price of a pack of gum, and a 24-hour room is a bag of chips. It's a small amount. Hopefully, calls feel close to free. It's our attempt at stopping spam bots.
<!-- END GENERATED: pricing-logic -->

### 4.2 Adapter Pattern

The Lightning backend (`services/lightning.ts`) uses an adapter pattern supporting three backends, selected via `LIGHTNING_BACKEND` env var:

| Backend | Env Var | Required Config |
|---|---|---|
| `mock` (default) | `LIGHTNING_BACKEND=mock` | None — generates simulated invoices |
| `lnbits` | `LIGHTNING_BACKEND=lnbits` | `LNBITS_URL`, `LNBITS_API_KEY` |
| `btcpay` | `LIGHTNING_BACKEND=btcpay` | `BTCPAY_URL`, `BTCPAY_API_KEY`, `BTCPAY_STORE_ID` |

All adapters implement the same interface: `createInvoice(amountSats)` → `{invoice, paymentHash}` and `checkPayment(paymentHash)` → `boolean`. Invoice TTL is 15 minutes.

#### Lightning privacy — what VOID does and does not control

The privacy properties of the payment leg are dominated by the operator's Lightning node setup, not by VOID. Three properties are worth naming explicitly so an operator does not assume "Lightning" implies "private":

- **Invoice description leakage in bolt11.** The `description` (or its hash) is part of the signed invoice and is visible to anyone who sees the bolt11 string — at minimum the payer's wallet, every routing node that inspects the hop, and the operator's own backend. If an operator templates a per-room description like "VOID room <code>", that string leaks. VOID's mock adapter and the LNbits/BTCPay paths use generic, non-room-specific descriptions for this reason; an operator running a custom backend should keep descriptions generic.
- **Node announcement and routing-graph visibility.** A Lightning node that publishes channels into the public routing graph is, by definition, an entity routing nodes can build a directory of. A payer using a wallet that prefers shortest-route also reveals the destination node identity to every hop along the path. An operator who runs an unannounced (private) node accepting payments via wrapped/hop-hint invoices substantially reduces this surface; this is an operator-side choice and is recommended in the runbook.
- **Operator-side payer-pubkey knowledge.** When the operator runs their own LND/CLN/BTCPay-backed node, the settlement event the node sees carries the keysend/route-completion metadata; depending on the backend and the payer's wallet, the operator may learn the payer's node pubkey. The payer does *not* learn the host's identity through VOID — there is no host identity to learn — but the operator may learn the payer's. Custodial backends (Strike, Wallet of Satoshi) collapse this further and add a custodian to the trust list.

None of the three is changed by VOID's code; all three are determined by the LN backend, the node topology, and the wallet on either side. The operator-side recommendation is: run an unannounced node, keep invoice descriptions generic (the default), and treat the payer-pubkey trail as known-leaky if the backend exposes it. See the L402 reference in §4.1 for the underlying spec and `README-selfhost.md` for the operator-side recommendations.

### 4.3 Flow

```
Client                          Server                         Lightning Node
  │                               │                                  │
  ├─ POST /api/paywall/invoice ──>│                                  │
  │                               ├─ createInvoice(1000 sats) ──────>│
  │                               │<── bolt11 + paymentHash ─────────┤
  │<── { invoice, paymentHash } ──┤                                  │
  │                               │                                  │
  │  (user pays in wallet)        │                                  │
  │                               │                                  │
  ├─ GET /status/:hash (poll) ───>│                                  │
  │                               ├─ checkPayment(hash) ────────────>│
  │                               │<── paid: true ───────────────────┤
  │                               │                                  │
  │                               ├─ jwt.sign({authorized:true},     │
  │                               │    PAYWALL_SECRET, {expiresIn:1h})│
  │                               │  (mint token + recoveryCode,     │
  │                               │   stamp settled BEFORE sleeping)  │
  │                               ├─ sleep settlement→delivery jitter │
  │                               │   (10–60s default; M-04)          │
  │<── { paid:true, token:JWT } ──┤                                  │
  │                               │                                  │
  ├─ emit('create-room',          │                                  │
  │       { roomId, token })      │                                  │
  │<── { success: true } ─────────┤                                  │
```

On the **first** paid observation, the server inserts a random
settlement-to-delivery delay before returning the token (M-04 mitigation):
a uniformly-random jitter in `[PAYWALL_JITTER_MIN_MS, PAYWALL_JITTER_MAX_MS]`
(default **10–60 s**) so a passive observer cannot correlate "Lightning
payment settled at *T*" with "token delivered / room appeared at *T+ε*". The
token and `expiresAt` are computed and stamped *before* the sleep, so the
delay does **not** shrink the paid window the host purchased — it only delays
visibility. The jitter applies **only** to the first-paid branch: re-polls
(which return the cached token) and `/paywall/recover` (already delinked from
settlement time) bypass it. Self-hosters can disable it with
`PAYWALL_JITTER_DISABLE=1`; the bounds are tunable via `PAYWALL_JITTER_MIN_MS`
/ `PAYWALL_JITTER_MAX_MS` (if `MIN >= MAX` the jitter is treated as opt-out).

### 4.4 Dev Bypass

`POST /api/paywall/dev-pay/:paymentHash` manually marks invoices as paid for testing. **Automatically disabled when `NODE_ENV=production`.**

### 4.5 JWT Details

- **Signing secret:** `PAYWALL_SECRET` env var. If not set, an ephemeral secret is generated at startup via `crypto.randomBytes(32)` — all JWTs are invalidated on restart (by design for single-instance deployments).
- **Payload:** `{ authorized: true, tier: "standard" | "day", jti: string, reclaimToken: string }`. The `jti` is a fresh server-minted random id (`crypto.randomBytes(16)`) that the socket layer records once at `create-room` to enforce single-use (one invoice → one room; see §10's JWT row and `accessController.ts` `consumedRoomCreationTokens`). It deliberately replaces what used to be a raw Lightning `paymentHash` claim, so **no payment-derived value is ever shipped to the client** — the `paymentHash` stays server-side (invoice state, `/paywall/status/:paymentHash`, log digests) only.
- **Expiry:** 1 hour for `standard`, 24 hours for `day` (matches the room TTL of the tier).
- **Storage:** `sessionStorage` key `void_token` (cleared on tab close — intentional for ephemeral model).
- **Boundary:** The JWT gates *creation* of a paid room. Once the room exists, anyone with the phrase can join — the phrase is the security boundary.

### 4.6 Recovery Code (opt-in resume of unused paid windows)

At successful payment, alongside the JWT, the server also returns a one-time **recovery code** — 4 BIP-39 words (~44 bits of entropy). The PaywallModal displays it once on the PAID screen with explicit "this is your only chance" framing and an `I'VE WRITTEN IT DOWN` / `SKIP` affordance. We never write the code (or the JWT) to disk on the client; the only persistence is the user choosing to write the code down.

The code addresses one specific case: the host paid, closed the tab before creating the room, and now wants to use the unused paid budget without paying twice or persisting the JWT to localStorage. The StartScreen exposes a `RECOVER A PAID ROOM` link that opens a 4-word input; submitting it hits `POST /api/paywall/recover { code }`, which:

- Looks up the code in the in-memory `recoveryCodes` map (keyed by the code itself).
- Returns **404** if not found or already redeemed (the two cases are deliberately conflated so a code-holder cannot probe map membership).
- Returns **410** if the underlying paid window has expired.
- Returns **400** for malformed input (wrong word count, non-letters).
- On success: deletes the code (single-shot), then mints a fresh JWT whose `expiresIn` is clamped to the **remaining seconds** of the original window. Recovery never extends the window the host paid for.

#### Status-poll re-mint invariant

The `/paywall/status/:hash` route is intentionally **idempotent after first paid observation**. The server tracks each invoice in an `invoiceStates` map; the first paid poll mints the JWT + recovery code and stamps `settled = { token, expiresAt, recoveryCode, recoveryAcked: false }` onto the entry. Every subsequent poll of the same hash returns the **same** token and `expiresAt` — never a fresh mint. This is what prevents a host (or anyone with the payment hash) from extending their paid window — or downgrading `day` → `standard` — by re-polling the status endpoint. The invariant is covered by dedicated tests.

Recovery-code delivery is **ack-based** (Task #1143). The settled response **re-includes the same code** on every poll until the client acknowledges receipt via `POST /api/paywall/ack-recovery { paymentHash }` — the client fires this exactly when the host proceeds past the PAID screen, i.e. after the code has been on screen. The ack deletes the delivery copy from the settled state, so no later status poll can re-obtain the code. This closes the delivery race where the single reveal was lost to a dropped response, a page refresh, or a mid-flow unmount. Abuse posture: the ack is idempotent, returns an identical `{ ok: true }` for unknown/unpaid/already-acked hashes (no membership oracle), and never touches any expiry — delivery state and the paid window are fully decoupled. The redeemable copy in `recoveryCodes` is unaffected by the ack; redemption remains single-shot via `/paywall/recover`.

The code (and the per-invoice settled state) lives in memory only and is GC'd opportunistically on the next mint operation. No-op on server restart, by design — same trade-off as the JWT secret.

---

## 5. Media Pipeline

### 5.1 Video — WebGL2 Shader Engine

Camera input is processed through a real-time WebGL2 fragment shader before being sent over WebRTC. This is not a CSS filter — it's GPU-computed per-pixel processing.

**Pipeline:**
1. `getUserMedia()` → 640×480 @ 30fps raw camera stream
2. Render to offscreen `<video>` element
3. Upload each frame as WebGL texture (`texImage2D`)
4. Fragment shader processes based on `u_mode` uniform; `u_time` uniform (elapsed seconds) available for time-varying effects
5. `canvas.captureStream(15)` → processed stream at 15 FPS

**Output resolution:** 320×240 pixels.

**Shader modes (`u_mode`, 6 modes total):**

| Mode | Label | Algorithm |
|---|---|---|
| 0 | CLEAR | Raw passthrough — unmodified camera frame |
| 1 | GOLD | Duotone luminance mix: each pixel blends between dark (`#1E1A14`) and light (`#E8A200`) anchors based on BT.601 luminance |
| 2 | PIXEL | 40×30 grid pixelation: pixel color sampled from cell center, then duotone-mapped |
| 3 | CONTOUR | Sobel edge detection: 3×3 gradient kernel; edges above threshold 0.15 render white |
| 4 | SILHOUETTE | Smoothstep luminance mask (0.25–0.35): light-gray foreground (`vec3(0.85)`) over near-black background |
| 5 | ASCII | 3×5 pixel cell character atlas with 16 characters; luminance selects character index from a canvas-generated font atlas |

**Font atlas (ASCII mode):** `generateFontAtlas()` renders the character set `" .:-=+*#%@WMBN&$"` at 3×5px into a 48×5 canvas using the browser's monospace font. The atlas is uploaded as a GL texture (`u_font_atlas`) and sampled in the fragment shader.

**Luminance:** BT.601 formula: `dot(color.rgb, vec3(0.299, 0.587, 0.114))`

**Screen share audio policy (Task #404).** Screen share never captures system audio; only the voice-mask-processed microphone is forwarded. Both `getDisplayMedia()` callsites in `RoomPage.tsx` pass `audio: false` explicitly (not omitted, not `undefined`) so a browser that defaults the "Share system audio" checkbox to on cannot grant it, and any audio tracks the browser returns despite the constraint are immediately stopped and removed from the stream before it reaches a peer connection. This is intentional and load-bearing: OS audio (notifications, a YouTube tab, a Slack ping) would bypass the voice mask, noise gate, and formant shift, defeating the SILHOUETTE / voice-mask anonymity guarantee.

**Repo-wide enforcement (Task #412, widened in Task #420).** The two guarantees above — `audio: false` in the literal constraints object and a follow-up stop + remove of any audio tracks the browser returned anyway — are pinned by a static check at `artifacts/void-client/scripts/check-no-display-media-audio.mjs`. The check scans every `.ts` / `.tsx` file under **every** artifact source tree in the monorepo (`artifacts/*/src/`, excluding `*.test.*`), finds every `getDisplayMedia(` call, and fails the build if either (a) the literal constraints object does not contain `audio: false`, or (b) the next ~60 lines do not contain both `.getAudioTracks()` and `.removeTrack(` plus a `.stop()`. The scanner discovers artifact `src/` directories dynamically, so a future web artifact — an operator console, a separate mobile-web entry point, an embeddable widget — is held to the same no-system-audio guarantee the moment it is added, with no per-artifact wiring (`getDisplayMedia` is a browser-only API, so non-web artifacts such as the Node `api-server` simply contain no matching calls and pass trivially). It runs as `pnpm --filter @workspace/void-client run check:no-display-media-audio` and is wired into the `marketing-voice` CI workflow alongside the other repo-wide static checks. A future contributor who adds a new `getDisplayMedia()` entry point anywhere in the repo (e.g. for a "presenter music" or "share tab audio" feature, or in a brand-new artifact) and forgets the constraint cannot land that change without also disabling this check — which is exactly the signal the next code reviewer needs.

**Signaling envelope (Task #437).** Audio and video themselves never traverse the signaling WebSocket — they ride **DTLS-SRTP** (encrypted media, browser-to-browser). WebRTC data channels ride **DTLS-over-SCTP** on the same encrypted association. The signaling server forwards opaque ciphertext on either path; it cannot decrypt frames or data-channel bytes. The only user-derived payload that ever crosses the signaling WebSocket is the AES-GCM-encrypted `relay-signal` envelope (SDP + ICE), whose key is derived from the URL-fragment phrase the server never sees (see §3.3). Every other signaling event is room-state, connection-state, or moderation metadata — there is no `emit("chat", …)`, no `emit("transcript", …)`, no `emit("file", …)`, and no `emit("frame", …)` anywhere in the codebase, because VOID has no in-call chat, poll, or shared-document feature and this overview is not claiming E2EE for features that do not exist.

The complete enumeration is in `docs/signaling-envelope-audit.md`. For convenience, the **38** signaling events are: room lifecycle / moderation (`create-room`, `join-room`, `leave-room`, `destroy-room`, `burn-room`, `extend-room`, `lock-room`, `unlock-room`, `set-knock-mode`, `approve-knock`, `deny-knock`, `cancel-knock`, `request-relay-only`, `respond-relay-only-request`, `request-screen-share`, `screen-share-started`, `screen-share-stopped`); encrypted SDP/ICE relay (`relay-signal`, `peer-secure-channel-retry`); server-to-client state (`peer-joined`, `peer-left`, `room-locked`, `room-unlocked`, `room-destroyed`, `room-expired`, `room-extended`, `knock-request`, `knock-approved`, `knock-denied`, `knock-mode-changed`, `host-changed`, `screen-share-state`, `screen-share-granted`, `screen-share-denied`, `relay-only-requested`, `relay-only-request-declined`, `room-relay-mode-enabled`, `server-shutdown`). The **7** data-channel labels are: `void.control`, `void.rpc`, and `void.stream` (all reserved in the `lib/wire-core` signed-hello schema, no callsite today), `probe` (no-payload ICE-gathering trigger at `artifacts/void-client/src/lib/browserCapability.ts:174`), `drop` (the shared DROP slot — see below), `void.rekey` (the per-peer time-based PFS rekey control channel, human rooms only), and `void.media-state` (the per-peer camera/mic/voice-mask/onion indicator channel — Task #868, which moved that state off the former plaintext `peer-media-state` signaling broadcast onto DTLS-over-SCTP so the server can no longer see it).

**Shared DROP slot (Task #443).** The human meeting product has one — and only one — feature that puts user-typed content on a data channel: a single-slot, plain-text DROP that any participant can atomically overwrite for everyone. It is intentionally not a chat: there is no history, no per-peer view, no auto-linkify, no formatting, no markdown, no late-joiner replay. The slot is bounded at **2 KB UTF-8**, sanitized on both ends through `dropSanitize.ts` (NFC normalize; strip ASCII / C1 control bytes; strip zero-width and BIDI-override code points; truncate at the byte budget on a code-point boundary), rendered as a React text child (no `dangerouslySetInnerHTML`), and replaced atomically — the previous value is overwritten on every receiver as soon as a newer one arrives. Bytes ride a per-peer `RTCDataChannel("drop")` opened on the offerer side of every connection (and accepted on the answerer side via `pc.ondatachannel`), so they travel on the **DTLS-over-SCTP** association already established for the call. The signaling server never sees DROP contents — only the count of bytes that crossed the data channel, indistinguishably from any other SCTP stream. Disabling cases: while the local user is the active screen presenter, the local input is replaced with a `[DISABLED DURING SCREEN SHARE]` placeholder so a typed-text mistake cannot become a permanent frame of leaked sensitive content; the slot still renders incoming text from other peers. This feature widens the surface from "no in-call chat" to "exactly one shared plain-text slot"; the audit doc and the threat-model page name it explicitly so no reader is surprised.

A repo-wide static check at `artifacts/void-client/scripts/check-signaling-envelope.mjs` (run as `pnpm --filter @workspace/void-client run check:signaling-envelope`, wired into the `marketing-voice` CI workflow) scans every `.emit("…")`, `.on("…")`, and `.createDataChannel("…")` callsite under `artifacts/void-client/src/` and `artifacts/api-server/src/` and fails the build if any name appears that is not in the audit's whitelists — forcing the contributor to update the audit doc (or rework the feature to ride DTLS-over-SCTP) before the change lands.

### 5.2 Audio — Processing Chain

```
Mic → GainNode(0.8) → NoiseGate → Highpass(300Hz) → DynamicsCompressor
    → VoiceMaskNode → Lowpass(8000Hz) → AnalyserNode → MediaStreamDestination
```

**Noise gate** (`noise-gate-processor.js`, AudioWorklet):
- Threshold: -45 dB
- Attack: 5 ms
- Release: 50 ms
- Reports open/closed state + RMS level via `postMessage` every 10 render quanta for VU meter integration

**Voice mask** (`voice-mask-processor.js`, AudioWorklet):

All voice transformation modes are unified in a single `VoiceMaskProcessor` worklet. Mode is set via `port.postMessage({ type: "mode", value: N })`. All internal buffers reset on mode change to prevent cross-algorithm artifacts.

| Mode | Label | Algorithm |
|---|---|---|
| 0 | VOICE | Passthrough — audio unmodified |
| 1 | DEEP | OLA (Overlap-Add) granular pitch shift down |
| 2 | FORMANT | Two-pass OLA with LFO wobble for formant-like character |
| 3 | SCRAMBLE | Granular shuffle (8 grains) |
| 4 | COMBINED | DEEP + FORMANT + SCRAMBLE chained for maximum disguise |

OLA parameters: Hann window, grain size 512 samples, hop size 256 samples, ring buffer 16,384 samples.

**getUserMedia defaults:** `echoCancellation`, `noiseSuppression`, and `autoGainControl` are enabled. The `sampleRate` constraint has been removed from the default audio constraints.

**VU meter:** `AnalyserNode` with `fftSize: 2048` connected after lowpass, before output destination.

**SDP clamping:** Opus bitrate capped at 24 kbps (`maxaveragebitrate=24000`), forced mono (`stereo=0`, `sprop-stereo=0`). Applied to all offers and answers. VOID also requests Opus CBR (`cbr=1`) and disables DTX (`usedtx=0`) in SDP to reduce packet-size and silence side-channels against a passive on-path observer of SRTP packet shape (cf. "Spot Me If You Can", Wright et al. 2008); browser WebRTC implementations ultimately enforce the encoded behavior. The same `clampOpusBitrate` chokepoint also strips the `urn:ietf:params:rtp-hdrext:ssrc-audio-level` extmap, since VOID does not consume per-packet audio loudness and exposing it in cleartext RTP headers would be an orthogonal side-channel.

**Device selection:** Optional `audioDeviceId` with `exact` constraint.

---

## 6. Frontend Architecture

### 6.1 Stack

| Concern | Technology |
|---|---|
| Framework | React 19 |
| Bundler | Vite |
| Routing | Wouter |
| State/Fetching | TanStack React Query |
| Styling | CSS variables + inline styles (no CSS-in-JS) |
| Animation | Framer Motion |
| Icons | Lucide React |

### 6.2 Page Structure

Wouter handles top-level routing. The `/` route renders a `Home` component that switches between `LandingPage`, `StartScreen`, `PreviewGate`, and `RoomPage` based on launch state, standalone (PWA) mode, and the presence of a `#phrase` URL fragment. The other routes are flat info pages.

| Route | Component | Purpose |
|---|---|---|
| `/` | `Home` (state machine) | First visit → `LandingPage`; launched / PWA → `StartScreen`; pending room → `PreviewGate` (camera/mic preview, device selection, host-only relay-only toggle); active room → `RoomPage` |
| `/why` | `WhyPage` | Short-form WHY page — Vonnegut-cadence prose answering the actual "why this project exists" question ("Conversations belong to the people having them" + Gameboy origin). Bottom-of-page CTA is `← BACK TO HOME` (`/`) — the long-form HOW IT WORKS page is reachable from the global hamburger menu rather than via a per-page deep-link at the bottom of `/why`. Client-side redirects from the pre-existing `/why#<anchor>` deep links (`#encryption`, `#philosophy`, `#the-void-phrase`, `#video-filters`, `#voice-masks`) to `/docs/how-it-works#<same-anchor>` are still honored. |
| `/how-it-works` | `HowItWorksPage` | Short-form HOW IT WORKS page (Task #569) — seven Vonnegut-cadence bullets, one per long-page section (PHILOSOPHY → STATELESS ARCHITECTURE → WHAT WE LOG → THE VOID PHRASE → ENCRYPTION → VIDEO FILTERS → VOICE MASKS). `READ THE LONG VERSION →` deep-links to `/docs/how-it-works`. Reached from the hamburger menu's HOW IT WORKS entry. |
| `/docs` | `DocsIndexPage` | Flat index of long-form companion docs (Task #545). One entry per shipped vertical slice; designed for ~7 eventual entries. |
| `/docs/why` | `DocsWhyRedirect` | Tombstone for the retired `/docs/why` URL. Client-side replaces the location to `/docs/how-it-works`, preserving any inbound `#anchor` and the artifact base path. Kept registered so pre-existing external links and bookmarks resolve. |
| `/docs/how-it-works` | `DocsHowItWorksPage` | Long-form wonkish HOW IT WORKS page — Promise vs Proof opening, Philosophy, Stateless Architecture, What We Log, the VOID Phrase, Encryption (with hand-coded SVG key-derivation diagram), Video Filters, Voice Masks, Snowden closer. Anchor IDs (`#philosophy`, `#the-void-phrase`, `#encryption`, `#video-filters`, `#voice-masks`, `#stateless-architecture`, `#what-we-log`) preserved; the section ordering alternates pavement / no-pavement section backgrounds for visual rhythm. Replaces the prior `/docs/why` page — that URL is preserved as a client-side redirect to `/docs/how-it-works` via `DocsWhyRedirect`. |
| `/compare` | `ComparePage` | Short-form positioning page — heading `WHY NOT ZOOM? / FAIR QUESTION.`, one-sentence intro ("There are several perfectly good video tools in the world. Here is the honest score."), the eight-row comparison table itself (shared `CompareTable` component, also embedded in `/docs/compare`), and `READ THE LONG VERSION →` to `/docs/compare`. Bullets retired per user direction. No pre-existing `/compare#<anchor>` deep links exist, so no anchor-redirect plumbing is needed. |
| `/docs/compare` | `DocsComparePage` | Long-form COMPARE prose relocated from `/compare` (Task #551) — full eight-row comparison table, per-row prose for the five we win and the three we lose, the "when VOID is the wrong tool" list, and the one-last-thing closer. |
| `/threat-model` | `ThreatModelPage` | Short-form positioning page (Task #550) — 3–6 hybrid-voice bullets summarizing what the server can see, what it cannot, what VOID will not protect against, the Tor/media-path composition, browser-level surfaces, and the v0.6 won't-fix list. `READ THE LONG VERSION →` deep-link to `/docs/threat-model`, and client-side redirects from the pre-existing `/threat-model#<anchor>` deep links (`#lightning-ip-leak`, `#tor-wallet-shortlist`, `#browser-level-surfaces`, `#supply-chain`) to `/docs/threat-model#<same-anchor>`. |
| `/docs/threat-model` | `DocsThreatModelPage` | Long-form THREAT MODEL prose relocated from `/threat-model` (Task #550) — Howard opening, what a threat model is, what the server can see, network observers and IP visibility, browser-level surfaces, supply chain, the won't-fix list for v0.6, and the honest summary. Anchor IDs (`#lightning-ip-leak`, `#tor-wallet-shortlist`, `#browser-level-surfaces`, `#supply-chain`) preserved from the old `/threat-model#<anchor>` deep links. |
| `/audit` | `AuditPage` | Short-form positioning page (Task #551) — 3–6 hybrid-voice bullets summarizing the April 2026 internal audit (two High, six Medium; seven code fixes; M-04 documented), the static-vs-adversarial scope caveat, and a pointer to the published audit markdown. `READ THE LONG VERSION →` deep-link to `/docs/audit`. No pre-existing `/audit#<anchor>` deep links exist, so no anchor-redirect plumbing is needed. |
| `/docs/audit` | `DocsAuditPage` | Long-form AUDIT prose relocated from `/audit` (Task #551) — what an audit is and isn't, the status table for the two High and six Medium findings, per-finding summaries with code fixes or documentation links, what a static audit cannot tell you, and the deep-link to the published audit markdown. |
| `/proof/server-state` | `ServerStateProofPage` | Live "what the server sees" tool — paste a 32-char room code and read the literal JSON returned by `GET /api/room-state/:code` |
| `/proof/runtime` | `RuntimeProofPage` | Client-side reproducible-build verification (Task #383). Hashes the JS/CSS assets the current browser session actually loaded with `crypto.subtle.digest("SHA-256", …)` and diffs them against the published `sha256sums` map returned by `GET /api/proof/build`. Its probe fetches carry an `x-void-proof-bypass` header so the service worker passes them straight to the network instead of serving cache-first bytes (`cache: "no-store"` alone does not bypass the SW, which sits in front of the HTTP cache) — so the page hashes what the network served this load, not a possibly-stale or once-poisoned cache that could otherwise self-attest forever. **This SW-bypass only closes the accidental / stale-cache-divergence hole; it does not defend against an attacker who controls the bundle on every network path you check from — that attacker also controls the service worker and this page itself, so the cross-network rebuild-and-compare ritual in §7a of `README-selfhost.md` remains the only defense against a targeted attacker.** |
| `/pricing` | `PricingPage` | Short-form positioning page (Task #551) — the two Lightning price cards (1,000 sats / 65 min, 5,000 sats / 24 h) stay on the short page because price IS the headline, plus 3–6 hybrid-voice bullets explaining the two-tier rationale, one-shot Lightning payment, no-subscription posture, friction-as-signal, and the 24-hour ceiling. Closes with the Gerald paragraph. `READ THE LONG VERSION →` deep-link to `/docs/pricing`. No pre-existing `/pricing#<anchor>` deep links exist, so no anchor-redirect plumbing is needed. |
| `/docs/pricing` | `DocsPricingPage` | Long-form PRICING prose relocated from `/pricing` (Task #551) — why this price, why 24 hours is the longest tier, how the Lightning one-shot payment works, what the longer tier is not, and self-hosting for groups that need free rooms. Renders the shared `docs/_fragments/pricing-logic.md` fragment that previously lived on `/pricing`. |
| `/biometric-masking` | `BiometricPage` | Short-form positioning page (Task #551) — 3–6 hybrid-voice bullets summarizing why face/voice are biometric assets, on-device shader processing, the six video / five voice modes, the difference between reduced exposure and anonymity, and the deliberate role of CLEAR mode. `READ THE LONG VERSION →` deep-link to `/docs/biometric`. No pre-existing `/biometric-masking#<anchor>` deep links exist, so no anchor-redirect plumbing is needed. |
| `/docs/biometric` | `DocsBiometricPage` | Long-form BIOMETRIC prose relocated from `/biometric-masking` (Task #551) — what a biometric asset is, Patricia's story, the six video modes and the five voice modes with per-mode "preserves / destroys" breakdown, on-device shader pipeline, and reduced exposure vs anonymity. |
| `/limits` | `DocsLimitsPage` | Task #577 — the short-form LIMITS page was removed. `/limits` now renders the long-form `DocsLimitsPage` directly so the hamburger entry, inbound links, and the `/limits.html` OG card keep working without redirect plumbing. The same component is also served at the canonical `/docs/limits`. |
| `/docs/limits` | `DocsLimitsPage` | Canonical long-form LIMITS page. Opens with a `LIMITS` heading, a `▌ VOID IS FOR` brief, the fourteen-item `▌ VOID IS NOT FOR:` list, and the `▌ ACCESSIBILITY LIMITS` note on no live captions (Task #576). The six failure modes with per-mode recovery paths split off to `/docs/faq` (Task #575); FAQ discoverability lives in the `/docs` index. The same component is also rendered at `/limits` (Task #577) so the hamburger entry and inbound links keep working. |
| `/docs/faq` | `DocsFaqPage` | Technical-questions FAQ split off from `/docs/limits` (Task #575) — the six known failure modes and per-mode recovery paths: Lightning invoice paid but no room, peer connection drops mid-call, the 65-minute timer fires mid-conversation, wrong phrase entered, browser permissions denied, OS screen-share permission denied. |
| `/law-enforcement` | `LawEnforcementPage` | Law-enforcement guidelines: what the operator cannot produce, what the server can see live (shared §3.5 fragment), what is currently written to disk (shared `docs/_fragments/disk-logs.md` fragment), what could be compelled going forward, operator posture (process required + not-promised items marked as such), and what users can do themselves. Linked from `PageFooter.tsx`. |
| `/invited` | `InvitedPage` | Plain-language guest join walkthrough — for the person handed a VOID link who just wants to join. Renders inside `PageShell`. Two join paths (a link: open it → allow camera/mic → check the preview, optionally pick a mask, press ENTER; or six words: open VOID → JOIN A ROOM → type the phrase → allow camera/mic → ENTER), a "joining is free" reassurance (no fiat, no sats — only hosting costs Lightning), and a "what to expect in the room" section (up to four people, two-word SAS check via WORDS MATCH / DON'T MATCH, the countdown that warns before it ends, leaving, and any-participant BURN). Closes with links to `/tor` and `/host`. The host-facing share affordance, the Tor walkthrough, and `OnionMirrorLink` moved off this page to `/host` and `/tor` respectively. Reachable from the hamburger menu (`INVITED?`) and from the landing-page guest on-ramp. |
| `/host` | `HostPage` | Plain-language host walkthrough — for the person opening a room and running the call. Renders inside `PageShell`. A four-step PAY → OPEN → SHARE → RUN-THE-CALL flow (pay one-shot Lightning, links to `/pricing` for the two tiers and current amounts rather than restating them; room opens with a link + six-word phrase; share to up to three guests; run the call), a "your controls during the call" section (lock, knock-to-enter ADMIT/DENY, host-controlled / peer-requestable relay-only, any-participant BURN, and reclaim-host-without-paying on refresh/drop), a "paying with Lightning" section linking the Lightning Network Wikipedia article and an Aqua wallet YouTube walkthrough (both `target="_blank" rel="noopener noreferrer"`), and the host-facing share affordance (copies the `/invited` guest walkthrough link to send ahead of the call; pinned literals in `scripts/check-required-literals.mjs` #9). Reachable from the landing-page on-ramp accordion ("HOST A ROOM, click here for more information"). |
| `/tor` | `TorPage` | Plain-language IP-hiding / Tor walkthrough — moved off `/invited`. Renders inside `PageShell` with a `← INVITED` back link. A three-step walkthrough accurate to the `Onion-Location` auto-prompt UX (install Tor Browser from the official Tor Project download page → open VOID and use the ".onion available" address-bar switch → make the call) and the media-path limit (Tor hides your IP from the server while you reach VOID but does not cover the WebRTC media path; relay-only is the host's mitigation). Surfaces `OnionMirrorLink` when the deployment publishes an `.onion` mirror. Reachable from `/invited` and `/host`. |
| `/media` | `MediaPage` | Demo + refusal page — hosts the two demo-video embeds and the "What VOID refuses" NO-claims refusal band (`NO ACCOUNTS. / NO TRACKING. / NO FACESCANS. / NO BANKS.`) plus the "Why we built this" teaser link to `/why`. These were moved off the landing page so `/` stays a lean entry point. Renders inside `PageShell` with a `← BACK` link to `/`. Reachable from the top-level `MEDIA` hamburger entry (sibling of the `WORDS` umbrella). |
| ~~`/agents`~~ | ~~`AgentModePage`~~ | **Removed.** The public Agent Mode marketing page, hamburger entry, and footer link were removed in v0.5 (Task #321); the route, the `AgentModePage.tsx` component, and the agent protocol library + SDK have since been deleted entirely. Struck-through so the routes/nav drift checks confirm it stays absent. |
| (any unmatched) | `NotFound` | 404 page |

In addition, a small set of **DEV-only** routes (smoke-harness pages gated behind `import.meta.env.DEV`) exists for local testing. They are intentionally absent from the production surface and from this table; the routes-overview drift check (`pnpm --filter @workspace/void-client run check:routes-overview`) skips DEV-gated routes when diffing. (The former `/still/:variant` marketing-poster route was removed in Task #1125 — the social OG card is now a hand-chosen screenshot in `public/og`, never regenerated from source.)

`PreviewGate` is mounted only inside `Home` for the pending-room flow; the info pages (`/why`, `/compare`, `/threat-model`, etc.) render directly without it.

No persistent user accounts and no room-content storage (§3.5).

### 6.2.1 `OnionMirrorLink` Footer Affordance

When `VITE_VOID_ONION_HOST` is set at client build time (the Vite-exposed mirror of the server's `ONION_HOSTNAME`), `components/OnionMirrorLink.tsx` renders an `ALSO ON .ONION: <host>` row inside the shared `PageFooter` on every info page, and `StartScreen.tsx` surfaces a parallel onion-offer affordance on the landing page with the same URL. The component is intentionally **not UA-sniffed**: Tor Browser's own `Onion-Location` auto-prompt (§3.4, §8.6) is the primary discovery path for the audience that benefits most, and a small always-visible footer link covers users on other Tor-aware browsers, on Orbot-routed connections, and on regular browsers who want to share the address with someone else. The link hides itself when the page is already loaded over the onion origin (avoids a redundant self-link) and provides a copy button with a manual-select fallback for restricted clipboard contexts. The URL value is computed by `lib/onionMirror.ts`.

What counts as a valid `.onion` host is defined once, in `lib/onionHost.ts`: a Tor v3 address is exactly 56 base32 (`[a-z2-7]`) characters before the `.onion` TLD. The runtime origin check (`lib/origin.ts`'s `hostnameIsOnion`, used by `onionMirror.ts` and `StartScreen.tsx`) and the build-time **onion-bake inertness guard** in `vite.config.ts` both consume that single definition, so they can never disagree. Because the affordance fails closed — a missing or malformed `VITE_VOID_ONION_HOST` resolves to `null` and renders nothing — the build guard refuses to ship a "Tor-reachable" bundle whose onion link is silently inert: when an onion bake is expected (any `NODE_ENV=production` build, or a dev build run with `VOID_REQUIRE_ONION=1`), `vite build` fails loudly unless `VITE_VOID_ONION_HOST` is a valid v3 host. Ordinary dev builds and `vite` dev (serve) stay permissive.

### 6.3 Share Functionality

The **SHARE** button in `RoomPage` generates a link containing the VOID Phrase as a URL fragment:

- **Mobile (Web Share API):** On mobile browsers where `navigator.share` is available, the native share sheet is invoked with the room URL, title, and a short text prompt. The button label changes to "SENT" on success.
- **Desktop (clipboard fallback):** `navigator.clipboard.writeText` copies the link to the clipboard. The button label changes to "COPIED" on success.

The phrase fragment is never sent to the server — it is only present in the URL constructed client-side.

### 6.4 BURN Session Control

The control bar exposes a single-tap **BURN** button (`handleBurnSession`). Tapping it tears down the local session:

- Ends the call for everyone, regardless of who taps it. A host's BURN emits `destroy-room` (the host-only moderation teardown); a non-host participant's BURN emits `burn-room` (the membership-authorized teardown added in Task #696 — authorized by being a current member, not by host status). Both drop the room from server memory and broadcast `room-destroyed` to every remaining member (and any pending knockers), each of whom then runs this same local teardown. A plain `leave-room` (a single-peer departure that leaves the room live) is emitted only as a best-effort fallback if the `destroy-room` / `burn-room` ack reports failure — it is never the normal BURN path for a non-host.
- Calls `performLocalBurn()`, which destroys the `WebRTCManager` (closes every `RTCPeerConnection`), stops every track on the local camera/mic stream and on any active screen share, tears down the WebGL2 shader pipeline and the AudioWorklet voice mask, and clears all SAS / verification / phrase-change state.
- Renders a terminal "ROOM BURNED" / "ALL KEYS DESTROYED" overlay (`BurnedOverlay`) that auto-dismisses after `BURN_AUTO_DISMISS_MS` (3000 ms) — or immediately on ESC — and then invokes `onLeave()` to return the user to the start screen. (The Socket.io client itself is not disconnected, but the local stream and peer connections are gone.)

BURN is intended as a panic / emergency-exit affordance and as a test path for the P2P-only post-server-loss claim — after BURN, no media or peer traffic flows from the burnt client.

### 6.5 PWA Configuration

- **Service Worker** (`sw.js`): Cache-first with network-update for static assets (JS, CSS, fonts, images, audio); network-first with cache fallback for navigation. API calls (`/api/`) and Socket.io traffic are excluded from caching.
- **Manifest:** Standalone display mode, `#14110D` theme/background color, `void-icon.png` icons at 192px and 512px.
- **Offline:** Precaches root URL. The app can launch offline but requires network for signaling/payment.

---

## 7. Visual Design System — "Gold Voyager"

### 7.1 Design Language

**Vibrant Brutalist Terminal.** Hard edges (global `border-radius: 0 !important`), monospace typography, uppercase labels with wide letter-spacing, and a warm industrial palette. The aesthetic draws from hardware terminals, concrete architecture, and analog electronics.

### 7.2 Token System

```css
--bg:       #BEB3A2    /* Warm sand base */
--surface:  #A89E90    /* Darker surface for panels */
--fg:       #1E1A14    /* Deep warm black */
--fg-dim:   #5C5040    /* Muted text */
--gold:     #E8A200    /* Primary accent — VOID wordmark, highlights */
--burnt:    #C85A00    /* Burnt orange emphasis */
--red:      #CC2200    /* Action/alert */
--teal:     #0D9D8B    /* Secondary accent — local video indicator */
```

### 7.3 Typography

- **VOID wordmark / headers:** Staatliches (Google Fonts)
- **Body / labels:** JetBrains Mono (Google Fonts), uppercase, `letter-spacing: 2-3px`
- **Video rendering:** `image-rendering: pixelated` on all canvases

### 7.4 Concrete Texture System

A real photograph (`concrete.jpeg`) is tiled at `400px auto` across the page body and decorative elements, with warm-tinted `linear-gradient` overlays at varying opacities:

- **Body:** 88% tint — subtle, texture barely shows through
- **Decorative geometry:** 84% tint — slightly more visible
- **Dark concrete headers:** 82% tint over `#14110D` — rich, textured dark surface
- **Panels/buttons:** Flat solid colors — no texture, no blur, ensuring readability

### 7.5 Decorative Geometry

Absolute-positioned shapes (amber slabs, brown boxes, teal dots, pale gold ghost rects, red slash lines at 45°) create a structured, hardware-panel aesthetic behind the functional UI. These carry the concrete texture but never interfere with interactive elements.

---

## 8. Self-Hosting

### 8.1 Docker

**Dockerfile:** Multi-stage build producing a single image based on `node:22.12.0-slim`, pinned by digest (`@sha256:…`) directly in every `FROM` line. The committed digest is the multi-arch manifest-list digest tracked in `.docker-base-digest` (single source of truth); the release workflow asserts both `FROM` lines agree with that file and fails closed otherwise:
1. **deps** stage: installs pnpm dependencies (pnpm `10.26.1`, matching `packageManager` in `package.json` and every CI workflow)
2. **frontend** stage: builds Vite PWA → `dist/public`
3. **backend** stage: builds Express server → `dist` and writes `dist/BUILD_INFO.json` with `{ gitSha, builtAt, releaseTag, nodeVersion, sha256sums }` for the served bundle
4. **production** stage: copies built assets and `BUILD_INFO.json`, serves static frontend via Express (`SERVE_STATIC=1`), exposes port 3000

**docker-compose.yml:** Two services:
- `app` — the VOID container
- `coturn` — Coturn TURN relay container

### 8.2 Coturn Configuration

Example config at `coturn/turnserver.conf.example` (operators copy this to
`coturn/turnserver.conf`, which is gitignored to keep real secrets out of the
repo):
- Ephemeral HMAC-SHA1 credentials (matches VOID's `/api/ice-servers` implementation)
- Private IP range blocking (10.x, 172.16-31.x, 192.168.x, 127.x) for anti-SSRF
- Relay port range 49152–65535
- TLS listener on port 5349 (config placeholder for cert/key paths)

The API server refuses to start if `TURN_SECRET` is left at the example
placeholder (`YOUR_SECRET_HERE` and known variants). The check lives in
`artifacts/api-server/src/lib/turnSecret.ts` and runs before any port is bound,
so a misconfigured deploy fails loudly instead of silently running an open
relay.

### 8.3 Platform Manifests

- **Umbrel:** `umbrel-app.yml` for the Umbrel app store
- **StartOS/Start9:** `manifest.yaml` with Tor and LAN interfaces

### 8.4 Self-Hosting Guide

`README-selfhost.md` includes:
- Setup instructions and env var reference
- Nginx reverse proxy example with WebSocket upgrade
- Tor hidden service configuration
- Coturn setup steps
- §7a "Verifying the Build" — the copy-paste rebuild recipe, cosign verify command, and the cross-network-path ritual

### 8.5 Reproducible & Verifiable Build (Supply Chain)

The released bytes are auditable end-to-end, with the limits stated honestly in §7a of `README-selfhost.md`:

| Layer | What | Where |
|---|---|---|
| Toolchain pinning | Node `22.12.0` (`.nvmrc`, `engines.node`), pnpm `10.26.1` (`packageManager`, every CI workflow, Dockerfile), Docker base committed by digest in both `FROM` lines | `package.json`, `.nvmrc`, `.docker-base-digest`, `Dockerfile` |
| Drift gate | Release workflow fails closed if runner `node --version` / `pnpm --version` disagrees with the manifest | `.github/workflows/release.yml` `Toolchain drift gate` step |
| SHA256SUMS | Sorted, LC_ALL=C-stable per-file sha256 over `dist/public/` plus the Docker image digest | Release asset; emitted by `release.yml` |
| Keyless signing | cosign-signed via GitHub OIDC, no long-lived key custody | `SHA256SUMS.sig` + `SHA256SUMS.pem` assets |
| SLSA provenance | `actions/attest-build-provenance` attestation on the void-client bundle and on `SHA256SUMS` | Verifiable with `gh attestation verify` |
| Reproducibility check | Second CI job rebuilds from the same SHA in a clean container and diff-asserts byte-identity; arm64 rebuild job runs informationally for Pi-class targets | `release.yml` `reproducibility-check` jobs |
| Server-side claim | `GET /api/proof/build` returns `{ gitSha, builtAt, nodeVersion, sha256sums, caveat }` for the bundle this server is serving; rate-limited, cacheable; caveat travels with the response | `artifacts/api-server/src/routes/proof-build.ts` |
| Client-side check | `/proof/runtime` hashes the JS the current browser session actually loaded with `crypto.subtle.digest` and compares against `/api/proof/build` row-by-row | `artifacts/void-client/src/pages/RuntimeProofPage.tsx` |
| Posture attestation (Task #1023) | `GET /api/proof/posture` returns `{ torOnly, iceStunSuppressed, onionIngress, onionOnlyPostureActive, gitSha, releaseTag, caveat }` — runtime-config facts (not a self-reported badge) bound to the same build identity, served `no-store`. `/proof/runtime` renders the same facts under **POSTURE ATTESTATION** and degrades honestly when the posture is not the onion-only one. The `caveat` carries the non-claims (un-modified binary not proven, TOCTOU window, possible upstream logging proxy). | `artifacts/api-server/src/lib/torPosture.ts`, `artifacts/api-server/src/routes/proof-build.ts`; recipe in `README-selfhost.md` §7a |
| Cross-network ritual | See §6.2 (`/proof/runtime` row) for the canonical statement of what client-side hashing does and does not defend against. The rebuild-and-compare recipe in `README-selfhost.md` §7a is the only honest defeat of a targeted, edge-rewritten bundle. | `README-selfhost.md` §7a |
| Onion-bake divergence | `VITE_VOID_ONION_HOST` is a build-time input, so baking a canonical `.onion` address into the client changes the void-client bundle bytes — and therefore every per-file sha256 and the `SHA256SUMS`. This is correct, not corruption. For the verify-don't-trust chain to hold on the canonical instance, the release CI must build with the address already set so the signed/attested `SHA256SUMS` describes the *onion-baked* artifact (Posture A). A self-hoster who builds without it, or with a different address, gets different, equally-valid hashes and verifies against their own rebuild from the same commit rather than the canonical sums (Posture B). Hand-editing the address into an already-built bundle breaks every hash in the chain and is indistinguishable from tampering — the address goes in at build time or not at all. | `README-selfhost.md` §7a ("the onion bake changes your hashes") and §6e go-live runbook; `release.yml` `VITE_VOID_ONION_HOST` build env (inject the identical value into the build-and-sign and both reproducibility-check jobs; the clean-container reproducibility-check is the release-blocking diff, the arm64 job is advisory/`continue-on-error`) |

What is **not** claimed: whole-image Docker reproducibility across arbitrary build hosts. Kernel and glibc variation make that impractical; the published image digest is "what the canonical CI builder said" and is named as such in the doc. The void-client bundle, which is what the browser executes, **is** reproducible from the recipe.

### 8.6 Onion Mirror

Operators who already run a clearnet VOID deployment can additionally expose a Tor `.onion` mirror that points at the same backend. The end-to-end operator runbook lives at `docs/onion-mirror-runbook.md`; this section is the architectural summary.

| Concern | How it works |
|---|---|
| Configuration | Single env var: `ONION_HOSTNAME` (the `*.onion` host the operator's Tor hidden service is bound to). When unset, every onion-mirror surface in the codebase is inert. |
| `Onion-Location` header | Middleware inline in `artifacts/api-server/src/app.ts` (registered after helmet, before CORS) emits `Onion-Location: http://<ONION_HOSTNAME><req.originalUrl>` on every clearnet HTTPS response. Suppressed when the inbound request itself arrived via `.onion`, when the request is not HTTPS, or when `ONION_HOSTNAME` is malformed. `http://` scheme is correct — TLS is terminated inside Tor at the rendezvous point. |
| CSP parity | The helmet CSP (`app.ts` §helmet block) names **no clearnet hostnames anywhere** — every directive resolves over the onion origin via `'self'`, scheme keywords, or `'none'`. The `report-to` group resolves to the same-origin `/api/csp-report`, so violation reports stay inside the onion when posted from onion. Pinned by `__tests__/onion-location.test.ts`, which loads the CSP with a synthetic `.onion` Host header and asserts no `.com`/`.net`/`.io`/`.org` substring. |
| Client-side surfaces | Onion-aware ICE pinning (`lib/origin.ts`), the sats→USD short-circuit on onion (`hooks/useSatsToUsd.ts`), and the `OnionMirrorLink` footer affordance (§6.2.1). See §3.4 for the audit. |
| Tradeoffs and limits | What the mirror does and does not hide, the source-IP / rate-limit behaviour change, the reverse-proxy notes, and the verification ritual all live in `docs/onion-mirror-runbook.md`. |
| CDN-fronted clearnet caveat | If your clearnet origin sits behind a CDN you do not control, the `Onion-Location` header is as trusted as the CDN — the CDN can log it, rewrite it, or serve a different `.onion` to different users. |

---

## 9. Agent Mode (removed)

VOID is a single human-to-human product. An earlier side-quest explored a headless agent SDK (`lib/void-agent-sdk/`) over a shared `lib/agent-protocol/` library, with `agent` / `hybrid` room types and a `void-secret:` invite scheme. All of it — the SDK, the protocol library, the `agent-spike` harness, the room-type plumbing, the invite scheme, the `ENABLE_AGENT_ROOMS` gate, and the public `/agents` page — has been removed. The wire and crypto primitives the consumer product still depends on (signed-hello envelope, Argon2id derivation, branded secrets) now live in `lib/wire-core/`. The `void.control` / `void.rpc` / `void.stream` data-channel labels remain reserved in the wire-core signed-hello schema (the `channels` enum) with no callsite that opens them today; see §5.1 and `docs/signaling-envelope-audit.md` Table 2.

---

## 10. Security Considerations

Every row pairs **what the mechanism defends against** with **what it does not defend against**, so a reader cannot pick up a load-bearing claim without its caveat. Implementation pointers and §-references live in the third column.

| Mechanism | What it defends against | What it does not defend against | Where |
|---|---|---|---|
| Signaling encryption (AES-GCM 256, ECDHE-upgraded session keys, SRTP for media) | A passive or active server operator reading SDP, ICE candidates, or media in transit; a relay tampering with offers/answers (AES-GCM auth tag fails closed). | An endpoint that is already compromised (the keys live in that browser's memory); a precomputation attack against a weak phrase (the fixed public salt does not re-randomize the search space — see §3.3); the metadata enumerated in §3.5 "What the server can see," which is on the wire whether or not it reaches disk. | §3.3, §3.5; `signalCrypto.ts`. |
| ECDHE + per-peer session keys (P-384 ECDH, HKDF-SHA256 `"VOID-ECDHE-v1"`) | Compromise of a single past phrase rotation: a captured-then-decrypted phrase does not retroactively decrypt past sessions whose ephemeral keys have been discarded (perfect forward secrecy). | A peer that never completes the key exchange is **not** downgraded to the phrase key — the channel fails closed with `ecdhe_failed` / `hello_invalid` (`failSecureChannel`, the M-01 no-silent-downgrade invariant) and raises a secure-channel-failure overlay, so the trade-off is availability (that pair has no working channel until a fresh handshake succeeds), not a confidentiality downgrade. A live endpoint compromise during the call captures the session key directly. | §3.3.1; `signalCrypto.ts`, `webrtc.ts`. |
| Signed-Hello envelope authenticating the ECDH key (Ed25519 over a canonical payload binding `ecdhPublicKey` + its SHA-256 fingerprint, `nonce`, `timestamp`, `roomId`, `roomType`, identity) | A relay or on-path attacker tampering with the relayed `key-exchange` payload to swap the ECDH public key, replaying a hello from another room or time, or forging a hello that advertises a different `roomType` — any mutation breaks the Ed25519 signature, the fingerprint check, the ±5-minute skew window, the per-peer nonce cache, the `expectedRoomId` bind, or the locally-derived `expectedRoomType` bind (`room_type_mismatch`), and the channel fails closed with `hello_invalid`. The verifier's `expectedRoomType` is derived from the invite client-side, never trusted from the server. | The `signingKey` is self-asserted and travels in the envelope — there is no PKI or cross-session pinning of the Ed25519 identity, so a *full* active MITM that substitutes the entire hello (its own Ed25519 + ECDH on each leg) is not caught by the signature alone; that is what the out-of-band SAS (next row) exists to catch. | §3.3.1; `lib/wire-core/src/hello-envelope.ts`, `webrtc.ts`. |
| SAS verification (2-word HKDF from ECDH shared secret, per-peer chip UX) | A MITM that re-negotiates ECDHE with each peer separately — the SAS shown to each side will not match unless the attacker also controls both endpoints. | Users who do not actually compare the words out-of-band. The check is human-driven; nothing in code can prove they spoke the words aloud. State is local-only and re-invalidates on every rekey. | §3.3.1; `RoomPage.tsx`. |
| Sovereign TURN with ephemeral HMAC-SHA1 credentials (no third-party STUN fallback) | A third-party STUN/TURN operator (e.g. Google) learning every peer's IP. When unconfigured, the endpoint fails closed with `{ iceServers: [] }` and a startup `WARN`. | Operators who do not run a TURN server — cross-NAT calls then simply fail to connect. The TURN operator itself sees both peers' IPs by definition. | §3.4; `routes/ice-servers.ts`. |
| Relay-only mode (`iceTransportPolicy: "relay"`) | Peer-to-peer IP discovery between participants (the IPs go to the TURN server, not the other peer). Forced on for `.onion` origins. | The server / TURN operator (which still sees both IPs); fingerprinting via the encrypted media flow itself. Adds latency. | §3.4; `lib/origin.ts`. |
| Rate limiting (per-socket event limits, per-IP socket caps, exponential backoff on failed joins) | Single-IP brute-force of room IDs, signaling-flood DoS from one socket, and bursty connection attempts from one host. | A coordinated botnet with many IPs; an attacker who already holds a valid phrase. The `/paywall/recover` route adds its own dedicated per-IP bucket and a coarse global warn-threshold (see `routes/paywall.ts`). | §3.7; `socketHandlers.ts`. |
| Knock-to-enter | New joiners arriving unannounced — host explicitly approves or denies each one. | An attacker who already holds the phrase and the host approves them; collusion with an existing peer. Off by default; host enables per-room. | §3.6. |
| Screen-share slot reservation (12-second two-phase) | Two peers racing the single sharer slot; a stale reservation blocking the slot indefinitely. | A peer with a valid slot grant choosing to share something they should not. | §3.8. |
| BURN session control | A user who needs an immediate full teardown — peer connections, local stream, shader pipeline, AudioWorklet, SAS state — in one tap. Also the structural answer to an unwanted peer: BURN-and-rotate replaces the kick primitive (see paragraph below). | Forensic recovery of bytes already exchanged peer-to-peer before BURN; the Socket.io client connection itself (left intact deliberately). | §6.4. |
| JWT for room creation (HMAC-SHA256, `PAYWALL_SECRET`, `jti`-bound, `expiresIn` matches paid tier) | A non-paying client creating rooms; a single paid invoice being replayed to create many rooms (the server-minted random `jti` claim is enforced single-use at `create-room`, see `accessController.ts` `consumedRoomCreationTokens`). | **A stolen JWT being replayed to create rooms within the host's paid window.** The JWT lives in `sessionStorage` for 1–24 h and is exfiltrable by any XSS vector or supply-chain compromise in the bundle. **A stolen JWT cannot decrypt existing rooms — the phrase is the security boundary for room contents.** The JWT only gates *creation* of a paid room. Pinning JWTs to a peer-key fingerprint is tracked as future scope (no live task). | §4.5; `routes/paywall.ts`, `socketHandlers.ts`. |
| Dev-pay endpoint auto-disabled in production | A test-only `POST /api/paywall/dev-pay/:hash` short-circuit shipping to production. Guarded by `NODE_ENV !== "production"` at route-registration time. | An operator running with `NODE_ENV=development` in production (the gate is environmental, not cryptographic). | §4.4; `routes/paywall.ts`. |
| Argon2id key derivation (m = 64 MiB, t = 3, p = 1, fixed 32-byte salt, hash-wasm 4.12.0) | Pure-CPU brute force of a captured room ID — memory-hardness raises per-guess cost meaningfully above straight CPU. Parameters are the single source of truth in `lib/wire-core/src/argon2.ts` (`ARGON2ID_ROOM_PARAMS`). | A weak phrase. Memory-hardness raises cost; it does not "defeat" GPU or ASIC budgets. The **load-bearing defense is the 6-word entropy floor (~2^66)**, not these parameters. The fixed public salt means precomputation rainbow-tables are reusable across deployments — see §3.3. | §3.3, §3.5; `lib/wire-core/src/argon2.ts`. |
| Phrase generation entropy source | `generateVoidPhrase()` draws all six word indices from `crypto.getRandomValues(new Uint32Array(6))`. There is no `Math.random` path and no silent fallback. | A user who hand-picks phrases or copies one from somewhere predictable — the entropy floor is only valid for randomly-generated phrases. | §3.3; `voidPhrase.ts`. |
| Onion-aware ICE pinning + fail-open audit (Task #385) | Clearnet IP leakage to peers when the page is loaded over `.onion` — the client unconditionally pins `iceTransportPolicy: "relay"` regardless of the host-chosen policy. The full inventory of outbound hostnames reachable from an onion-origin page is enumerated in `docs/onion-fail-open-audit.md` and pinned by `__tests__/onion-no-clearnet-egress.test.ts`. | A future code change that introduces a new outbound host without updating the audit doc and the test — both have to be edited together to silently regress this. | §3.4; `lib/origin.ts`, `hooks/useSatsToUsd.ts`. |
| `Onion-Location` auto-discovery + CSP parity (Task #384) | Manual `.onion` URL transcription friction for Tor Browser users (one-click switch); cross-origin embedders and clearnet hostnames sneaking back into the CSP (pinned by `__tests__/onion-location.test.ts`). | A clearnet origin that sits behind a CDN the operator does not control — the `Onion-Location` header is then as trusted as the CDN (which can log, rewrite, or differentially serve it). See §8.6. | §3.4, §8.6; `artifacts/api-server/src/app.ts`. |
| Soft Tor-default surfacing (Task #1022, surface variant) | Clearnet being a *silent* default — the client surfaces the published `.onion` as the preferred path, marks a clearnet session with a `CLEARNET PATH` indicator, and offers a one-click switch with an honest bootstrap disclosure, so the privacy-preferred path is the visible one. | The first (bootstrap) contact, which has already reached the server over clearnet before any switch; peer-visible IP on a call (media still relays via clearnet TURN — relay-only is the control there); and a user who chooses to stay on clearnet. The **hard** redirect default is held (`docs/tor-default-path-decision.md`) — this is surfacing, not forcing. | §3.4; `lib/origin.ts`, `docs/tor-default-path-decision.md`. |
| Onion-only posture attestation (Task #1023) | An operator merely *claiming* the privacy posture the threat model assumes — `/api/proof/posture` lets a reader verify `TOR_ONLY`, no-STUN `/api/ice-servers`, and onion-fronted ingress as runtime facts bound to the reproducible-build identity, not a self-asserted badge. | A modified/un-attested binary (that is what the reproducible-build chain is for), a config change after the read (TOCTOU), and an upstream logging proxy recording IPs ahead of the attested process. It attests the published build's posture at read time — never "the operator structurally cannot ever see an IP." | §3.4, §8.5; `artifacts/api-server/src/lib/torPosture.ts`, `README-selfhost.md` §7a. |
| Reproducible build + `/proof/runtime` client-side hash check (Task #383) | Accidental drift between the published bundle and what a browser actually executed, and untargeted CDN compromise (one-bundle-rewrites-everywhere) — `crypto.subtle.digest` over the loaded JS diffs row-by-row against `/api/proof/build`'s `sha256sums`. | A targeted attacker who controls the bundle on every network path the user checks from — the same edge-rewriter can serve a matching `/api/proof/build` reply. The canonical wording for this caveat lives in §6.2 (`/proof/runtime` row); the honest defeat is the cross-network ritual in `README-selfhost.md` §7a. | §6.2, §8.5; `routes/proof-build.ts`, `RuntimeProofPage.tsx`. |

**BURN-and-rotate replaces the kick primitive.** VOID has no kick, mute-others, ban, or removal event of any kind, by design. The phrase is the credential and the credential is rotatable: when an unwanted peer is in the room, the host's structural answer is to BURN the session — which ends the call for everyone and discards the phrase-derived room ID — and re-share the freshly generated phrase out-of-band to only the people they want. The unwanted peer is then locked out for good, because the room they were in no longer exists and the new room ID is derived from a phrase they were never given. The honest trade-off is that BURN only stops them from continuing; it does not undo what they already saw, heard, or captured up to that moment. This is the structural alternative to soft moderation, and it also means there is no kick-log for the operator to produce — see the new "WHAT IF SOMEONE UNWANTED JOINS?" subsection on `ThreatModelPage.tsx` and the structural-absence bullet in §1 of `LawEnforcementPage.tsx`.

---

## 11. Key Files Reference

| File | Purpose |
|---|---|
| **Backend** | |
| `artifacts/api-server/src/index.ts` | Express server, Socket.io signaling, JWT verification, rate limiting |
| `artifacts/api-server/src/app.ts` | Express app setup, route mounting |
| `artifacts/api-server/src/routes/paywall.ts` | Invoice generation, payment status polling, dev-pay endpoint |
| `artifacts/api-server/src/routes/ice-servers.ts` | TURN/STUN credential generation with ephemeral HMAC-SHA1; no third-party STUN fallback (Task #372) |
| `artifacts/api-server/src/routes/proof-build.ts` | `GET /api/proof/build` — reproducible build provenance (gitSha, builtAt, sha256sums) for the served bundle (Task #383) |
| `artifacts/api-server/src/services/lightning.ts` | Lightning adapter pattern (mock, LNbits, BTCPay Server) |
| `artifacts/api-server/src/rooms/registry.ts` | In-memory room-state `Map`, capacity caps, GC sweep + counters (`rooms.ts` is a barrel re-export; membership/lock/unlock/knock and screen-share reservation live in `rooms/membership.ts` and `rooms/screenShare.ts` after the Task #447 decomposition) |
| **Frontend** | |
| `artifacts/void-client/src/App.tsx` | Root component, Wouter routing, VOID Phrase auto-join, relay-only toggle wiring |
| `artifacts/void-client/src/lib/mediaPipeline.ts` | WebGL2 shader pipeline (6 modes), audio processing chain |
| `artifacts/void-client/src/lib/webrtc.ts` | `WebRTCManager` class: peer connections, ECDHE key exchange, ICE restart, SDP clamping |
| `artifacts/void-client/src/lib/signalCrypto.ts` | AES-GCM encrypt/decrypt; ECDH key pair generation, public key export/import, HKDF session key and SAS derivation |
| `artifacts/void-client/src/lib/voidPhrase.ts` | BIP-39 6-word phrase generation/validation, Argon2id key derivation (delegates to `deriveRoomBytesArgon2id` in `lib/wire-core`), room ID derivation |
| `artifacts/void-client/src/lib/socket.ts` | Socket.io client, signaling event handlers |
| `artifacts/void-client/src/lib/sounds.ts` | Synthesized UI sound effects (bleeps, bloops, clicks, slide) — raw synthesizers; UI callsites do not invoke these directly, they go through `uiSounds.ts`. |
| `artifacts/void-client/src/lib/uiSounds.ts` | **Default-off** UI sound presence gate (Task #407). Single user-visible `SOUNDS` toggle in the room header persists to `localStorage["2bit_ui_sounds_enabled"]` (default OFF on every fresh install everywhere — no shader-based heuristic). Every UI-event callsite (`peer-joined`, `you-joined`, BURN confirmation tones, every click/slide in `RoomPage`, `PreviewGate`, `StartScreen`, `PhraseShareModal`, `App`) routes through `uiBleep` / `uiBloop` / `uiClick` / `uiSelectClick` / `uiSlide`, each of which consults `shouldPlayUiSound()` before reaching `sounds.ts`. The `2bit_ui_sounds_enabled` key (and the existing `2bit_music_enabled` key) are wiped by the BURN cleanup path via `clearVoidLocalStorage()` in `burnTeardown.ts`, scoped to the `2bit_` namespace so neighboring artifacts are not stomped. Rationale: a retro "peer joined" bleep from the device speaker would out a SILHOUETTE-shader user to bystanders in a high-discretion physical setting. |
| `artifacts/void-client/src/pages/RoomPage.tsx` | Video session UI, peer grid, connection orchestration, SAS verification chips and popover, screen sharing, BURN |
| `artifacts/void-client/src/pages/StartScreen.tsx` | Host/join flow, paywall trigger, phrase input |
| `artifacts/void-client/src/pages/LandingPage.tsx` | Marketing/info landing page |
| `artifacts/void-client/src/pages/PreviewGate.tsx` | Camera/mic preview gate, device selection, relay-only toggle |
| `artifacts/void-client/src/pages/WhyPage.tsx` | Long-form positioning page |
| `artifacts/void-client/src/pages/ComparePage.tsx` | Comparison vs other tools |
| `artifacts/void-client/src/pages/ThreatModelPage.tsx` | Threat model and server-visibility documentation |
| `artifacts/void-client/src/pages/docs/DocsPricingPage.tsx` | Lightning paywall pricing (long-form; rendered at both `/pricing` and `/docs/pricing`) |
| `artifacts/void-client/src/pages/BiometricPage.tsx` | Biometric / voice masking explainer |
| `artifacts/void-client/src/components/HamburgerMenu.tsx` | Top-level navigation menu |
| `artifacts/void-client/src/components/PageFooter.tsx` | Shared footer across info pages |
| `artifacts/void-client/src/components/OnionMirrorLink.tsx` | Persistent "ALSO ON .ONION" footer affordance — no UA sniffing. See §6.2.1 / §8.6. |
| `artifacts/void-client/src/lib/onionMirror.ts` | Computes the onion mirror URL (from `VITE_VOID_ONION_HOST`) consumed by `OnionMirrorLink` and the landing-page onion-offer in `StartScreen.tsx` |
| `artifacts/void-client/src/lib/origin.ts` | Onion-origin detection + `initialIceTransportPolicy()` (forces `"relay"` on `.onion`) |
| `artifacts/void-client/src/hooks/useSatsToUsd.ts` | Sats→USD price hook with a documented onion-origin short-circuit (the single onion behavioural difference) |
| `artifacts/void-client/src/pages/RuntimeProofPage.tsx` | `/proof/runtime` — client-side bundle hash verification (Task #383) |
| `artifacts/void-client/src/components/PaywallModal.tsx` | Lightning invoice modal with QR code |
| `artifacts/void-client/src/index.css` | Gold Voyager design tokens, concrete texture rules |
| `artifacts/void-client/public/sw.js` | Service worker (cache-first + network fallback) |
| `artifacts/void-client/public/voice-mask-processor.js` | AudioWorklet: 5-mode unified voice masking (VOICE / DEEP / FORMANT / SCRAMBLE / COMBINED) |
| `artifacts/void-client/public/noise-gate-processor.js` | AudioWorklet noise gate with VU meter reporting |
| `artifacts/void-client/public/manifest.json` | PWA manifest |
| **Wire core (shared)** | |
| `lib/wire-core/src/` | Shared signed-hello envelope, Argon2id derivation, branded secrets, and the signed-hello `channels` schema used by the browser and API server |
| `docs/onion-fail-open-audit.md` | Verbatim hostname inventory for an onion-origin page (Task #385); pinned by `__tests__/onion-no-clearnet-egress.test.ts` |
| `docs/onion-mirror-runbook.md` | Operator runbook for provisioning a Tor hidden service mirror in front of a clearnet deployment (Task #384) |
| **Infrastructure** | |
| `lib/api-spec/openapi.yaml` | OpenAPI 3.1 contract for the full public HTTP surface |
| `Dockerfile` | Multi-stage production build |
| `docker-compose.yml` | App + Coturn containers |
| `coturn/turnserver.conf.example` | Coturn TURN server configuration template (operator copies to `coturn/turnserver.conf`, which is gitignored) |
| `umbrel-app.yml` | Umbrel app store manifest |
| `manifest.yaml` | StartOS/Start9 manifest |
| `README-selfhost.md` | Self-hosting setup guide |

---

## 12. Source of Truth

This document is a point-in-time snapshot. Implementation details may drift; authoritative values live in the source files listed in §11. In particular, verify security-critical values (rate limits, crypto parameters, JWT configuration, TURN credential TTL) against the code before relying on them for operational decisions.

---

## 13. Open Items & Known Limitations

1. **Full mesh does not scale beyond 4.** The 4-user cap is appropriate for mesh, but any increase would require switching to an SFU (Selective Forwarding Unit) architecture.
2. **Room state is partially persisted, single-instance only.** Volatile per-socket state (peers, sockets, pending knocks, screen-share) is lost on restart, but the paid-room snapshot (`data/rooms.json` via `roomsPersistence.ts`, see §3.5 — including `hostReclaimTokenHashes`) is rehydrated so paid rooms survive a restart within their TTL. This JSON snapshot is a single-instance durability mechanism, not a shared one; for multi-instance deployment, room state would still need to move to Redis or a similar shared store.
3. **API spec coverage.** The HTTP surface is fully described by [`lib/api-spec/openapi.yaml`](./lib/api-spec/openapi.yaml) (OpenAPI 3.1) and the Socket.io signaling channel is fully described by [`lib/api-spec/asyncapi.yaml`](./lib/api-spec/asyncapi.yaml) (AsyncAPI 3.0). Both ship as the canonical reference for client / SDK authors; the prose in §3 is the companion summary.
4. **Codec negotiation is browser-default.** No explicit codec preferences (VP8/VP9/AV1) are set. At 320×240@15fps the bandwidth is negligible regardless, but explicit codec pinning would ensure consistent quality.
5. **Lightning defaults to mock.** Production deployments must set `LIGHTNING_BACKEND` to `lnbits` or `btcpay` with appropriate credentials for real payments.
6. **JWT secret is ephemeral by default.** `PAYWALL_SECRET` should be set in production to persist JWTs across server restarts.
7. **Mismatch UX is silent only initially.** A wrong phrase first looks identical to "no peer yet"; after `CRYPTO_MISMATCH_THRESHOLD` (3) consecutive AES-GCM decrypt failures from the same peer, a red `PHRASE MISMATCH / VERIFY VOID PHRASE` overlay is shown on that peer's tile (`webrtc.ts` + `RoomPage.tsx`). A planned UX hint also surfaces a generic "still waiting?" message after a timeout for the genuinely-no-peer case.
8. **Onion fail-open audit is code-read, not HAR-captured.** The audit in `docs/onion-fail-open-audit.md` enumerates every outbound request site in the client bundle and cross-checks it against the `'self'`-only CSP rather than capturing a live two-peer onion call via Playwright (the audit environment has no production onion deployment to point at). The regression test (`__tests__/onion-no-clearnet-egress.test.ts`) and the CSP-parity test together make a clearnet host structurally hard to introduce, but a real HAR capture against a deployed `.onion` mirror would be stronger primary evidence and is named as a tracked follow-up in the audit doc.

---

## 14. Changelog

### Post-v0.5 hardening cycle

- **Task #465 — H-03 SDP validation layer.** The highest-impact deferred item from the Tier-1 sweep (#464). A pure-function validator (`artifacts/void-client/src/lib/sdpValidator.ts`) filters inbound SDP to a known-safe subset (≤16 KiB, ≤200 lines, per-attribute ≤1 KiB, ≤30 ICE candidates per offer, a per-section codec allowlist — audio: `opus`, `g722`, `pcmu`, `pcma`, `telephone-event`, `cn`, `red`; video: `vp8`, `vp9`, `h264`, `av1`, `h265`, `rtx`, `red`, `ulpfec`, `flexfec-03` (see `sdpValidator.ts` for the canonical, current set — it deliberately admits the housekeeping/RTX/FEC payloads every real browser emits), SHA-256/384/512 DTLS fingerprint allowlist, link-local + loopback rejection, UTF-8 well-formedness) before either `setRemoteDescription` call or `addIceCandidate` in `webrtc.ts`. Failure routes through `failSecureChannel(fromPeerId, "sdp_validation_failed")`, parallel to the existing `decrypt_failed` teardown but with a distinct reason code so the two failure modes stay separable in the audit log. Pure-function; no rewriting (kept separate from the existing `clampOpusBitrate` path).
- **Task #466 — `RoomPage.tsx` real decomposition.** Hook-and-FSM extraction (`useRoomMedia`, `useRoomSignaling`, `useRoomCrypto`, `RoomStateMachine`, `ExpiryStateMachine`), each in its own file with its own test suite, targeting under 1,000 lines for `RoomPage.tsx` (cleaner cut prioritized over strict line count). Two deferred UI items folded in opportunistically because they touch the extracted modules anyway: `KNOCK_QUEUE_FULL` now surfaces as a specific user-facing error instead of the generic join-failure toast, and the per-peer ICE candidate counter (from #464 H-04) resets on remote-initiated ICE restart in addition to locally-initiated. No visual or UX changes; no new features. A wire-level-error-code coverage audit was produced as a follow-up table — obvious gaps surfaced as UI copy fixes in this task, the rest deferred.
- **Task #467 — Client-side threat model document.** New `docs/client-threat-model.md`, mirroring the structure of the server-side `docs/threat-model.md`, enumerating attacker positions (hostile peer, hostile knocker, hostile network, malicious extension, compromised bundle, hostile signaling server, hostile TURN, coerced host) with the four-column treatment (capabilities / what they can do / what they cannot do / current defenses with file:line citations). Closes the "server-defensive-depth outpacing client-surfacing" asymmetry. Descriptive, not prescriptive — gaps surfaced during enumeration are recorded under a "Follow-up candidates" §10, tagged `MARKETING CONTRADICTION` or `DEFENSE IN DEPTH`. Cross-linked from `docs/threat-model.md`.
- **Task #868 — Per-peer media-state off the signaling broadcast.** Camera-off / mic-muted / voice-mask-mode / Tor-`.onion`-origin state used to ride a plaintext `peer-media-state` signaling event the server relayed (and therefore saw) on every toggle. It now travels peer-to-peer on a per-peer `void.media-state` WebRTC data channel (DTLS-over-SCTP), opened on the offerer side in `webrtc.ts` and accepted via `pc.ondatachannel`. The server no longer relays, reads, or is on the path for it: the handler, registration, rate-limit entry, and AsyncAPI schema were all removed, and the signaling-types codegen + dist were rebuilt. Late joiners converge because the offerer replays its current snapshot on channel-open; the receiver strictly validates types (clamping `voiceMode` to `[0,16]`) and a partial update preserves the prior `voiceMode`/`viaOnion`. Pre-open and fail-closed tiles render a neutral "unknown" indicator rather than a false "unmuted / camera-on" claim. Screen-share lifecycle stays server-arbitrated by design (single shared presenter slot needs a fair, race-free lock the server is uniquely positioned to hold) and is documented as such. The envelope scanner whitelist, `docs/signaling-envelope-audit.md` (Table 1/Table 2 + counts), and the server-observable / disk-logs fragments were updated in lockstep.
- **Task #468 — Client threat model revision pass.** Targeted reviewer-feedback edits to `docs/client-threat-model.md`: §10 tag corrections on items 2, 5, 9 (hybrid / `MARKETING CONTRADICTION (mild)` tags where a public claim is in tension with the gap); §4 extension wording sharpened so a reader does not conclude extensions are sandboxed from decrypted media (named `world: "MAIN"` / `chrome.scripting.executeScript`); §6 same-sender replay analysis added (walks through `key-exchange` re-trigger, SDP signaling-state-machine ordering, ICE duplicate handling, and explicitly flags "no general-purpose same-sender replay defense at the VOID application layer"); §2 knock-queue-saturation math added (32-slot cap × 30/min); §7 cross-position correlation note (`TURN + network observer` or `TURN + signaling-log subpoena`); §9 fourth drift rule covering enumerated attacker positions; new §0.5 explicitly excluding three positions (dev-machine surface, browser memory-dump / device-seizure, DROP-slot Unicode-confusable micro-surface) with one-line rationales. No restructuring.

### v0.5 → v0.6

**0 wire changes; documentation honesty sweep only — no production rooms break, no test vectors move, no parameters re-derive.**

Sentence-and-paragraph-level edits to this overview so every load-bearing claim ships with its honest limitation in the same paragraph. No code, no parameters, no manifests changed.

- **§3.3 (Argon2id) — named the fixed-public-salt precomputation threat and stated explicitly that the load-bearing defense is the 6-word entropy floor, not the salt. Added a "What the salt does and does not do" bullet. Asserted that `voidPhrase.generateVoidPhrase()` draws word indices exclusively from `crypto.getRandomValues` with no `Math.random` fallback. Parameter values are unchanged (still m = 64 MiB / t = 3 / p = 1) — bumping memory is a breaking change that invalidates frozen cross-impl vectors and belongs to a dedicated migration task, not to a doc PR.
- **§3.5 (Room lifecycle) — added paired "What the server can see" / "What the server cannot see" subsections. The "can see" list enumerates source IPs, connection timing, the 32-char hex room ID, peer-ID / socket / IP mapping, `peer-media-state` events, screen-share lifecycle events, lock / unlock / knock events, and `/proof/server-state` metadata. The reconstructed-conversation paragraph distinguishes **observation on the wire in real-time** from **persistence to disk** — per Task #374 the production access logger does not write `peer-media-state` or screen-share events to disk; a server operator who modifies the logger or an attacker who compromises the process can capture the full pattern.
- **§4 (Lightning paywall) — added a Lightning privacy paragraph naming invoice-description leakage in bolt11, node-announcement / routing-graph visibility, and operator-side payer-pubkey knowledge. Recommendation: unannounced node + generic invoice descriptions. **No BOLT-12 recommendation** — neither the LNbits nor the BTCPay adapter currently exposes BOLT-12 offers in the code path we ship, and an aspirational mention is how cosplay drifts back in.
- **§6.2 (`/proof/runtime`) — canonical sharpened wording placed in the §6.2 row (the route definition). The §8.5 cross-network ritual row now *references* §6.2 rather than restating the claim — one canonical statement, one reference.
- **§8.6 (Onion mirror) — added a CDN-fronted clearnet caveat row: behind a CDN you do not control, the `Onion-Location` header is as trusted as the CDN.
- **§10 (Security considerations) — restructured into a paired wins/limitations table. Every row pairs "what it defends against" with "what it does not defend against." **Added a JWT row** with a scoped-impact cell that names the `sessionStorage` exfiltration surface and asserts a stolen JWT cannot decrypt existing rooms (the phrase is the security boundary for room contents). Dropped the stale unpaired AES-GCM row in favor of the paired version that also names the endpoint-compromise and precomputation limits.
- **§1 / §3.4 / §8.5 / §10 (Tor-default surface + posture attestation reconciliation) — synced the prose to the already-merged soft Tor-default surface (Task #1022, *surface* variant — `.onion` strongly surfaced as the preferred path with clearnet an explicit opt-down; the hard redirect default remains **held** per `docs/tor-default-path-decision.md`) and the onion-only posture attestation at `/api/proof/posture` (Task #1023), bound to the reproducible-build identity with its non-claims carried verbatim (un-modified binary not proven, TOCTOU window, possible upstream logging proxy). No wire, parameter, or manifest change — the features shipped under their own tasks; this is documentation catching up. The rotating/blinded rendezvous-handle work (Task #1024) is **not** merged and is deliberately not documented as live.
- **Agent Mode fully removed.** The headless agent SDK, the shared agent-protocol library, the `agent-spike` harness, the `agent` / `hybrid` room types, the `void-secret:` invite scheme, the `ENABLE_AGENT_ROOMS` gate, and the `/agents` marketing page are all deleted — VOID is now a single human-to-human product. The wire and crypto primitives the consumer product still uses moved to `lib/wire-core/`. The `void.control` / `void.rpc` / `void.stream` data-channel labels remain reserved in the wire-core schema with no callsite. (§9, §11, Table 2.)
- **§14 (this section) — added this v0.5 → v0.6 entry.

Tests that did not move and would have moved if any wire-level claim shifted: `artifacts/void-client/scripts/check-banned-phrases.mjs`, `artifacts/void-client/scripts/check-required-literals.mjs`.

### v0.4 → v0.5

This section summarises the architecturally-significant changes that landed in May 2026, with task refs so a future reader can recover the full context without re-deriving it from git log.

- **Task #321 — Agent Mode marketing surface deferred.** The `/agents` route, hamburger entry, and footer link were removed from the v0.5 public surface. `AgentModePage.tsx` was kept on disk at the time; the agent packages and that page have since been removed entirely (see the v0.5 → v0.6 changelog above). (§1, §6.2, §9.)
- **Task #372 — Sovereign-only STUN.** Removed the third-party public STUN fallback from `/api/ice-servers`; the endpoint now fails closed (`{ iceServers: [] }` + startup `WARN`) when neither `STUN_URL` nor `TURN_URL` is configured. (§3.4, §10.)
- **Tasks #373 / #374 / #376 — Marketing-voice and required-literal CI gates.** `check:phrases`, `check:literals`, `check:routes-overview`, `check:feature-policy-sync`, `check:onion-mirror-sync`, and `check:og-routes` run on every PR as the `marketing-voice` workflow — a banned-phrase regression or an unaccounted-for production route fails CI loudly. The workflow has since been extended with further structural gates that run in the same chain: `check:fragments-sync`, `check:contrast`, `check:no-display-media-audio`, `check:signaling-envelope`, `check:threat-model-drift`, `check:landing-fonts`, and `check:room-not-session`. The current authoritative gate list is the `marketing-voice` workflow definition itself; all of these live in `artifacts/void-client/package.json` (workspace scripts, not the repo-root manifest). This document is covered by `check:routes-overview`.
- **Task #383 — Reproducible build with client-side hash check.** `BUILD_INFO.json` is written into the production image at build time; `GET /api/proof/build` exposes it; `/proof/runtime` hashes what the current browser executed via `crypto.subtle.digest` and diffs it against the published map. The honest defeat of a targeted edge-rewritten bundle is the cross-network ritual in `README-selfhost.md` §7a. (§6.2, §8.5, §10, §11.)
- **Task #384 — `Onion-Location` auto-discovery + CSP parity.** Path-equivalent `Onion-Location` header on every clearnet HTTPS response when `ONION_HOSTNAME` is set; helmet CSP audited to name no clearnet hostnames; persistent `OnionMirrorLink` footer affordance with no UA sniffing. Operator runbook at `docs/onion-mirror-runbook.md`. (§3.4, §6.2.1, §8.6, §10, §11.)
- **Task #385 — Onion fail-open audit.** Enumerated every outbound request site reachable from an onion-origin page and pinned the result with a regression test. The single production behavioural difference is the sats→USD CoinGecko short-circuit. Audit doc at `docs/onion-fail-open-audit.md`. (§3.4, §10, §13.)
