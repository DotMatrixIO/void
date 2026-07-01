# Signaling Envelope Audit

**Scope.** Every event that crosses VOID's Socket.IO signaling channel, and
every WebRTC `RTCDataChannel` label this codebase ever opens or accepts. The
purpose is to prove — by exhaustive enumeration, not by hand-wave — that the
signaling WebSocket carries **no user content**: no audio frames, no video
frames, no chat messages, no transcripts, no shared documents. The only
user-derived bits that ride this channel are (1) **encrypted** SDP/ICE blobs
whose key the server never sees, and (2) **connection-state flags** (mute,
cam-off, voice-mode index, screen-share lifecycle).

Last full enumeration: 2026-05-21. Pinned by
`artifacts/void-client/scripts/check-signaling-envelope.mjs`, which fails the
`marketing-voice` CI workflow if a new `.emit("…")`, a new `.on("…")`, or a
new `.createDataChannel("…")` callsite appears anywhere under
`artifacts/void-client/src/` or `artifacts/api-server/src/` with a name
that is not in the whitelists below.

## Transport reminders (precise wording)

- The **signaling WebSocket** is plain Socket.IO over TLS (`wss://`). The
  server can read everything it carries unless the payload is encrypted
  client-side first.
- **WebRTC media** rides DTLS-SRTP — encrypted browser-to-browser, the
  signaling server cannot decrypt audio or video frames.
- **WebRTC data channels** ride DTLS-over-SCTP — encrypted browser-to-browser
  on the same DTLS association as media. The signaling server cannot decrypt
  bytes that flow through a data channel either.

Throughout this document, "user content" means the payloads a participant
created or spoke (microphone audio, camera frames, chat messages, file
attachments, document contents). Connection-state flags (mute on/off,
voice-mode index) are not user content; they are knobs the UI sets on the
local pipeline and the other side mirrors as overlays.

## Scope of static check vs. this document

The static check at `artifacts/void-client/scripts/check-signaling-envelope.mjs`
scans every `.ts` / `.tsx` file (excluding `*.test.*` and `__tests__/`) under:

- `artifacts/void-client/src/`
- `artifacts/api-server/src/`

Two whitelists exist in the script, mirroring this document exactly:

- `ALLOWED_SIGNALING_EVENTS` — the **38** signaling event names in Table 1
  below.
- `ALLOWED_DATA_CHANNEL_LABELS` — the **7** data-channel labels in Table 2
  below.

A third small allow-list, `ALLOWED_NON_SIGNALING_ON_NAMES`, exists in the
script only to ignore legitimate non-signaling `.on()` callsites in
production code that happen to share the `.on(string, handler)` shape:

| Name | Where | Why it is not a signaling event |
|---|---|---|
| `connect`, `connect_error`, `disconnect`, `reconnect` | `artifacts/api-server/src/socketHandlers.ts:1202`; `artifacts/void-client/src/pages/RoomPage.tsx:1479` (`socket.io.on("reconnect")`) | Socket.IO client/manager/server lifecycle. Transport state only, no payload. |
| `connection` | `artifacts/api-server/src/socketHandlers.ts:364` (`io.on(…)`) | Socket.IO server accept hook, fires once per socket. |
| `SIGTERM`, `SIGINT` | `artifacts/api-server/src/index.ts:154-155` (`process.on(…)`) | Node.js process signal handlers. |
| `finish` | `artifacts/api-server/src/lib/accessLog.ts:41` (`res.on(…)`) | Node.js HTTP response stream completion. |

Adding a new name to that allow-list requires the same kind of code-review
explanation as adding a new signaling event row to Table 1.

## Table 1 — Signaling events (exhaustive)

Every `.emit("…")` and `.on("…")` event name used in production code under
the scanned roots, with **every** sending callsite and **every** listening
callsite enumerated by `file:line`. (Server-side `socket.on("…")` handlers
in `socketHandlers.ts` are registered inside one per-socket handler block
opened at `io.on("connection", …)` on line 364; the line numbers below
point at the specific `socket.on("name", …)` line.)

| # | Event | Direction | Emit sites (file:line) | Listen sites (file:line) | Payload contents | Carries user content? |
|---|---|---|---|---|---|---|
| 1 | `create-room` | C→S | `artifacts/void-client/src/App.tsx:54` | `artifacts/api-server/src/socketHandlers.ts:385` | `{ roomId, token, relayOnly }`. `roomId` is the rotating per-epoch *rendezvous handle* (see "Rendezvous handle" note below), not the durable room ID — so a live operator sees `IP↔ephemeral token`, not `IP↔stable room`. The phrase itself never crosses the wire; `token` is the Lightning paywall JWT. | No. |
| 2 | `join-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1013,1403` | `artifacts/api-server/src/socketHandlers.ts:527` | `{ code, peerId, token? }`. `code` is the per-epoch rendezvous handle resolved by a windowed probe (`H(E)`, then `H(E-1)`, `H(E+1)`). `peerId` is a random `peer-XXXXXX` per-session ID; `token` (optional) is the persisted host JWT for reclaim. | No. |
| 3 | `leave-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1722,1776,1781` | `artifacts/api-server/src/socketHandlers.ts:761` | `{ code, peerId }`. | No. |
| 4 | `destroy-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1774` | `artifacts/api-server/src/socketHandlers.ts:790` | `{ code }`. Host BURN (host-only moderation). | No. |
| 5 | `burn-room` | C→S | `artifacts/void-client/src/hooks/useRoomTeardown.ts:283` | `artifacts/api-server/src/socketHandlers.ts:128` | `{ code, peerId }`. Any participant's BURN — authorized by room membership (not host) so a joiner's BURN also destroys the room for everyone. | No. |
| 6 | `extend-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:834` | `artifacts/api-server/src/socketHandlers.ts:816` | `{ code, token }`. Lightning extension JWT. | No. |
| 7 | `lock-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1579` | `artifacts/api-server/src/socketHandlers.ts:998` | `{ code }`. | No. |
| 8 | `unlock-room` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1577` | `artifacts/api-server/src/socketHandlers.ts:1009` | `{ code }`. | No. |
| 9 | `set-knock-mode` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1788` | `artifacts/api-server/src/socketHandlers.ts:661` | `{ code, enabled }`. | No. |
| 10 | `approve-knock` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1794` | `artifacts/api-server/src/socketHandlers.ts:672` | `{ code, peerId }`. | No. |
| 11 | `deny-knock` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1801` | `artifacts/api-server/src/socketHandlers.ts:708` | `{ code, peerId }`. | No. |
| 12 | `cancel-knock` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:516,2645` | `artifacts/api-server/src/socketHandlers.ts:724` | `{ code }`. | No. |
| 13 | `request-relay-only` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1826` | `artifacts/api-server/src/socketHandlers.ts:1027` | `{ code }`. Cooperative ask to flip the room to TURN-relayed ICE. | No. |
| 14 | `respond-relay-only-request` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:1855` | `artifacts/api-server/src/socketHandlers.ts:1089` | `{ code, peerId, accept }`. Host accept/decline of a peer's ask. | No. |
| 15 | `request-screen-share` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:2034` | `artifacts/api-server/src/socketHandlers.ts:1147` | `{ code, peerId }`. Reserves the single presenter slot. | No. |
| 16 | `screen-share-started` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:2233` | `artifacts/api-server/src/socketHandlers.ts:1174` | `{ code, peerId }`. Lifecycle marker. Actual screen pixels travel as a WebRTC video track over DTLS-SRTP. | No. |
| 17 | `screen-share-stopped` | C→S | `artifacts/void-client/src/pages/RoomPage.tsx:2002,2143,2152` | `artifacts/api-server/src/socketHandlers.ts:1188` | `{ code, peerId }`. Lifecycle marker. | No. |
| 18 | `relay-signal` | C→S, also S→C forward | C→S: `artifacts/void-client/src/lib/webrtc.ts:463,477`. S→C forward: `artifacts/api-server/src/socketHandlers.ts:963`. | `artifacts/void-client/src/lib/webrtc.ts:288` | `{ code, toPeerId, fromPeerId, payload }`. `payload` is an **AES-GCM-encrypted** envelope; the key is either the phrase-derived AES key (pre-ECDHE) or the per-pair ECDHE session key (post-handshake). The server forwards the opaque ciphertext byte-for-byte; it cannot decrypt SDP, ICE candidates, or the ECDHE public key exchange. | No (encrypted SDP/ICE only — see §3.3 of `VOID_TECHNICAL_OVERVIEW.md`). |
| 19 | `peer-secure-channel-retry` | C→S, also S→C forward | C→S: `artifacts/void-client/src/lib/webrtc.ts:724`. S→C forward: `artifacts/api-server/src/socketHandlers.ts:991`. | `artifacts/void-client/src/pages/RoomPage.tsx:1203` | `{ code, toPeerId, fromPeerId }`. Tells the remote peer to drop its failure entry so a fresh ECDHE offer is not silently dropped. | No. |
| 20 | `peer-joined` | S→C | `artifacts/api-server/src/socketHandlers.ts:635,702` | `artifacts/void-client/src/pages/RoomPage.tsx:1091` | `{ peerId }`. | No. |
| 21 | `peer-left` | S→C | `artifacts/api-server/src/socketHandlers.ts:775,1226` | `artifacts/void-client/src/pages/RoomPage.tsx:1143` | `{ peerId }`. | No. |
| 22 | `room-locked` | S→C | `artifacts/api-server/src/socketHandlers.ts:1004` | `artifacts/void-client/src/pages/RoomPage.tsx:1209` | `{}`. | No. |
| 23 | `room-unlocked` | S→C | `artifacts/api-server/src/socketHandlers.ts:1015,1228` | `artifacts/void-client/src/pages/RoomPage.tsx:1210` | `{}`. | No. |
| 24 | `room-destroyed` | S→C | `artifacts/api-server/src/socketHandlers.ts:806,807` | `artifacts/void-client/src/pages/RoomPage.tsx:1102` | `{}` (or no payload). | No. |
| 25 | `room-expired` | S→C | `artifacts/api-server/src/socketHandlers.ts:1252` | `artifacts/void-client/src/pages/RoomPage.tsx:1108` | `{}` (or no payload). | No. |
| 26 | `room-extended` | S→C | `artifacts/api-server/src/socketHandlers.ts:925` | `artifacts/void-client/src/pages/RoomPage.tsx:1117` (and `.off(…)` at `:1492`) | `{ expiresAt, serverNow, tier }`. Wall-clock + tier label. | No. |
| 27 | `knock-request` | S→C (host) | `artifacts/api-server/src/socketHandlers.ts:576` | `artifacts/void-client/src/pages/RoomPage.tsx:1216` | `{ peerId, code }`. | No. |
| 28 | `knock-approved` | S→C (knocker) | `artifacts/api-server/src/socketHandlers.ts:701` | `artifacts/void-client/src/pages/RoomPage.tsx:1304` | `{ code, peers, relayOnly, roomType, tier, expiresAt, serverNow, screenSharePeerId, screenShareReservedByPeerId, hostPresent, hostPeerId }`. | No. |
| 29 | `knock-denied` | S→C (knocker) | `artifacts/api-server/src/socketHandlers.ts:716` | `artifacts/void-client/src/pages/RoomPage.tsx:1349` | `{ code }`. | No. |
| 30 | `knock-mode-changed` | S→C | `artifacts/api-server/src/socketHandlers.ts:667` | `artifacts/void-client/src/pages/RoomPage.tsx:1300` | `{ enabled }`. | No. |
| 31 | `host-changed` | S→C | `artifacts/api-server/src/socketHandlers.ts:642,782,1236` | `artifacts/void-client/src/pages/RoomPage.tsx:1368` | `{ hostPresent, hostPeerId }`. | No. |
| 32 | `screen-share-state` | S→C | `artifacts/api-server/src/socketHandlers.ts:786,1165,1181,1195,1240,1248` | `artifacts/void-client/src/pages/RoomPage.tsx:1354` | `{ activeScreenSharePeerId, reservedByPeerId }`. | No. |
| 33 | `screen-share-granted` | S→C (requester) | `artifacts/api-server/src/socketHandlers.ts:1163` | Delivered as the ack callback of the `request-screen-share` emit at `artifacts/void-client/src/pages/RoomPage.tsx:2034` (Socket.IO ack pattern). | `{ code, nonce }`. Per-grant idempotency nonce. | No. |
| 34 | `screen-share-denied` | S→C (requester) | `artifacts/api-server/src/socketHandlers.ts:1167` | Delivered as the ack callback of the `request-screen-share` emit at `artifacts/void-client/src/pages/RoomPage.tsx:2034`. | `{ code, reason }`. Wire-level error code. | No. |
| 35 | `relay-only-requested` | S→C (host) | `artifacts/api-server/src/socketHandlers.ts:1078` | `artifacts/void-client/src/pages/RoomPage.tsx:1224` | `{ peerId }`. | No. |
| 36 | `relay-only-request-declined` | S→C (requester) | `artifacts/api-server/src/socketHandlers.ts:1133` | `artifacts/void-client/src/pages/RoomPage.tsx:1232` | `{}`. | No. |
| 37 | `room-relay-mode-enabled` | S→C | `artifacts/api-server/src/socketHandlers.ts:1063,1130` | `artifacts/void-client/src/pages/RoomPage.tsx:1241` | `{ requestedBy? }`. | No. |
| 38 | `server-shutdown` | S→C (broadcast) | `artifacts/api-server/src/shutdown.ts:75` | `artifacts/void-client/src/App.tsx:135` | `{ reason, drainMs }`. Sent during SIGTERM drain. | No. |

**Summary.** Of the **38** signaling events in production, exactly one
(`relay-signal`) carries any user-derived payload, and that payload is
AES-GCM ciphertext under a key derived from the URL-fragment phrase the
server never sees. Every other event is connection-state, room-state, or
moderation metadata. There is no `emit("chat", …)`, no `emit("transcript",
…)`, no `emit("file", …)`, and no `emit("frame", …)` anywhere in the
codebase. VOID has no in-call chat, poll, or shared-document feature; this
audit is not claiming E2EE for features that do not exist.

**Rendezvous handle (`code`/`roomId` field, human rooms only).** Every C→S
event in Table 1 that carries a `code` (or `roomId`) field routes signaling
on a *rendezvous handle* rather than on the durable, phrase-derived 32-char
room ID. The handle is `HKDF-SHA256(IKM = room ID bytes, salt =
"VOID-epoch-<N>", info = "VOID-rendezvous-handle-v1") → 16 bytes → 32 hex`,
where `N` is the current 24-hour epoch (`artifacts/void-client/src/lib/
rendezvous.ts`). The creator registers under `H(E_now)`; a joiner probes the
ordered window `H(E)`, then `H(E-1)`, `H(E+1)`, advancing only on
`ROOM_NOT_FOUND`, and freezes the winning handle for the lifetime of the
connection (including reconnects and the relay-flip handshake). The effect is
that a live signaling-server operator's wire view degrades from `IP ↔ stable
room` to `IP ↔ ephemeral token` that rotates daily and cannot be linked back
to the durable room without knowing the room ID. The server stays agnostic — it routes any 32-hex token
(`ROOM_CODE_RE = /^[0-9a-f]{32}$/`) and never learns whether a token is a
durable ID or an epoch handle.

## Table 2 — WebRTC `RTCDataChannel` labels (exhaustive)

Every label passed to `RTCPeerConnection.createDataChannel(…)` anywhere in
the scanned roots, plus the corresponding accept-side handler. Data channels
ride **DTLS-over-SCTP** on the same DTLS association as media — the
signaling server cannot read bytes that flow through any of these. **P2P
classification:** all data channels in this codebase are negotiated
browser-to-browser over the peer connection's DTLS association; none are
mediated by the signaling server.

| # | Label | Opened by (file:line) | Negotiation parameters | Accept-side handler | What flows through it | Carries user content? |
|---|---|---|---|---|---|---|
| 1 | `void.control` | Reserved in the wire-core schema (`lib/wire-core/src/schemas.ts`); not opened by any callsite in the scanned roots today. | N/A — no callsite currently. The label is in the whitelist (and the signed-hello `channels` enum) so a future `createDataChannel("void.control")` does not trip the check before reaching this audit doc. | N/A. | Reserved for control-plane envelopes in the shared wire schema. Max envelope 8 KiB. | No — control plane only; never opened in the human-to-human room flow. |
| 2 | `void.rpc` | Reserved in the wire-core schema (`lib/wire-core/src/schemas.ts`); not opened by any callsite in the scanned roots today. | N/A — no callsite currently. Same whitelist / `channels`-enum reservation as `void.control`. | N/A. | Reserved for structured request/response RPC envelopes in the shared wire schema. Max envelope 64 KiB. | No — never opened in the human meeting product. |
| 3 | `void.stream` | Reserved in the wire-core schema (`lib/wire-core/src/schemas.ts`); not opened by any callsite in the scanned roots today. | N/A — no callsite currently. The label is in the whitelist so a future `createDataChannel("void.stream")` does not trip the check before reaching this audit doc. | N/A. | Reserved for streaming chunks in the shared wire schema. Max envelope 16 KiB. | Listed for completeness — the wire schema reserves the label. |
| 4 | `probe` | `artifacts/void-client/src/lib/browserCapability.ts:174` (offerer side, browser-capability preflight) | `createDataChannel("probe")` with no options — defaults as above. The channel is created, never written to or read from, and the peer connection it lives on is closed when the preflight resolves. | No accept side. The probe peer connection is local to the browser tab; no remote answerer exists. | Nothing. The channel exists solely to force the `RTCPeerConnection` to begin ICE gathering during the screen-share preflight (an offer with no media tracks and no data channel would short-circuit in some browsers). | No. |
| 5 | `drop` | `artifacts/void-client/src/lib/webrtc.ts` inside `initiateOffer` (offerer side, opened with `pc.createDataChannel("drop")` before `pc.createOffer()` so the channel appears in the initial SDP) | `createDataChannel("drop")` with no options — browser defaults: `ordered=true`, no `maxRetransmits`/`maxPacketLifeTime` (reliable mode), `negotiated=false` (in-band negotiation), `id` auto-assigned by the SCTP stack. Ordered + reliable is required: the slot's contract is atomic-overwrite, so any reorder or drop would silently corrupt the visible text. | Accepted on the answerer via `pc.ondatachannel` (wired in `buildPC`), which dispatches on `event.channel.label === "drop"` and routes to `attachDropChannel(peerId, channel)`. | The shared DROP slot — a single UTF-8 string ≤2 KB that any participant can atomically overwrite for everyone in the room. Plain text only; no formatting, no auto-linkify, no markdown, no history, no per-peer view, no late-joiner replay. Pre-render sanitization (NFC, strip control / zero-width / RTL-override code points, byte-cap at 2 KB) runs on both the send and receive sides via `dropSanitize.ts`. | Yes — this carries user-typed text. Privacy is provided by **DTLS-over-SCTP** on the same encrypted DTLS association as media; the signaling server cannot decrypt it. This is the only data-channel label in the human meeting product that carries user content, and the audit's guarantee — "the signaling **WebSocket** carries no user content" — is preserved exactly because the bytes ride the encrypted P2P data channel, not the signaling socket. |
| 6 | `void.rekey` | `artifacts/void-client/src/lib/webrtc.ts` inside `initiateOffer` (offerer side, opened with `pc.createDataChannel("void.rekey")` before `pc.createOffer()` so the channel appears in the initial SDP; human rooms only — gated on `roomType === "human"`) | `createDataChannel("void.rekey")` with no options — browser defaults: `ordered=true`, reliable mode, `negotiated=false`, `id` auto-assigned. Ordered + reliable is required: a `rekey-offer`/`rekey-answer` pair must not be reordered or dropped mid-rotation. | Accepted on the answerer via `pc.ondatachannel` (wired in `buildPC`), which dispatches on `event.channel.label === "void.rekey"` and routes to `attachRekeyChannel(peerId, channel)`. | Time-based PFS rekey control envelopes: `{ t: "o" \| "a", pub, epoch }` — a fresh raw ECDH public key plus a per-peer monotonic epoch. **Each envelope is itself AES-GCM-encrypted under the CURRENT SAS-verified session key** (via the same `signalCrypto.ts` `encryptSignal`/`decryptSignal` used for relay-signal), so the bytes on the channel are doubly encrypted (the AES-GCM envelope inside DTLS-over-SCTP). The encryption-under-the-verified-key is a deliberate continuity binding: only the genuine, already-verified peer can read or forge a rotation, so the new key is established without re-verification and the rotation is silent. No user-typed content ever rides this channel. | No — control plane only (key material, not user content). The rotation is exchanged here precisely **because** DTLS alone is insufficient: a peer's DTLS fingerprint rides the signaling SDP and is therefore MITM-able by a phrase-knowing relay, whereas this channel's payload is bound to the verified session key the relay never holds. |

| 7 | `void.media-state` | `artifacts/void-client/src/lib/webrtc.ts` inside `initiateOffer` (offerer side, opened with `pc.createDataChannel("void.media-state")` before `pc.createOffer()` so the channel appears in the initial SDP) | `createDataChannel("void.media-state")` with no options — browser defaults: `ordered=true`, reliable mode, `negotiated=false`, `id` auto-assigned. Ordered + reliable is required: a sequence of state-toggle snapshots must not be reordered (an out-of-order delivery would leave a stale mute/cam indicator). | Accepted on the answerer via `pc.ondatachannel` (wired in `buildPC`), which dispatches on `event.channel.label === "void.media-state"` and routes to `attachMediaStateChannel(peerId, channel)`. | The per-peer media-state snapshot `{ camOff, micMuted, voiceMode?, viaOnion? }` — booleans + a small integer voice-mask mode index + a boolean self-advertised Tor-`.onion`-origin flag. On channel open the offerer replays its current snapshot so a late joiner converges. The receiver strictly validates types (and clamps `voiceMode` to `[0,16]`) before merging; a partial update preserves the prior cached `voiceMode`/`viaOnion`. | No. These are UI knob states, not audio/video frames. The voice mask itself runs in an `AudioWorklet` inside the browser; only the integer mode index travels so peers can render an overlay ("VOICE MODE: SCRAMBLE"). Privacy is provided by **DTLS-over-SCTP** on the same encrypted association as media; the signaling server cannot read it and — unlike the prior plaintext `peer-media-state` signaling broadcast — can no longer relay or observe its contents at all. |

**Summary.** The human-to-human meeting product (the browser client at
`artifacts/void-client/`) opens exactly **three** data channels in the call
path: the per-peer `drop` channel that backs the shared DROP slot
(Task #443), the per-peer `void.rekey` control channel that carries the
time-based PFS rotation, and the per-peer `void.media-state` channel that
carries each peer's camera/mic/voice-mask/onion indicator state
(Task #868). Only `drop` carries user-typed content — a single UTF-8
string ≤2 KB; `void.rekey` carries key material (a fresh ECDH public key
+ epoch) and `void.media-state` carries small boolean/integer UI knob
states — neither carries user text. All three are encrypted
browser-to-browser by DTLS-over-SCTP — the signaling server cannot read
them — and `void.rekey` additionally encrypts each envelope under the
verified session key. The screen-share preflight at
`browserCapability.ts:174` opens a no-payload `probe` channel solely as
an ICE-gathering trigger. Every other label belongs to the agent SDK
protocol and is not exercised in the human meeting flow. All **7**
whitelisted labels are P2P (negotiated and carried browser-to-browser
over DTLS-over-SCTP); none are mediated by the signaling server.

## Honesty rule (load-bearing)

If a future commit adds an `.emit("…")` or `.on("…")` that carries user
content (e.g. a chat-message payload, a typed transcript, a file blob), this
audit's guarantee is broken and a follow-up task must be filed before the
change lands. The static check
`artifacts/void-client/scripts/check-signaling-envelope.mjs` fails the
`marketing-voice` CI workflow on any new event name or data-channel label
not present in the whitelists above — which is exactly the signal the
next code reviewer needs to either (a) add the new name to the whitelist
**and** update this document with a row that honestly describes the new
payload and its file:line provenance, or (b) reject the change.
