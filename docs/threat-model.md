# VOID — Threat Model

**Audience:** security researchers, future external audit firms, technically literate operators.
**User-facing mirror:** `artifacts/void-client/src/pages/ThreatModelPage.tsx`. The two surfaces must not drift on substantive claims; this document is permitted to be more technical, but every property asserted here must also be reflected in plain language on the user-facing page.
**Scope of this document:** the four properties of the current design that the April 2026 internal audit flagged as worth disclosing on the user-facing page. It does not duplicate the full threat-model copy already present on the user page; it complements it.

**Client-side companion:** the parallel enumeration of attacker positions that materialise at the *client* (the browser tab a VOID user runs the room inside) lives at `docs/client-threat-model.md`. Where this document enumerates properties of the design and what the operator can/cannot observe, the client-side document enumerates positions an adversary can occupy (hostile peer, hostile knocker, hostile network, malicious extension, compromised bundle, hostile signaling server, hostile TURN, coerced host) and what each can/cannot do given the defenses currently in the client tree. The drift policy in §7 of this document applies equally to that mirror.

**Audit references:** the published copy of the audit — with a status marker next to each High and Medium finding and the May 2026 re-audit (R-series) appended — lives at `docs/security-audit-public-2026-04.md`. A plain-language summary of the audit and its findings is published as the `/audit` page on the void-client artifact (source: `artifacts/void-client/src/pages/AuditPage.tsx`).

---

## 0. Framing

VOID is well-designed for the documented adversary model: corporate data collection, casual surveillance, server-side compulsion, an active man-in-the-middle on the signaling channel that does not know the phrase, a malicious peer (limited to what any peer can do), and a malicious TURN operator (limited to traffic-pattern observation, no plaintext access).

VOID is not vetted, today, as a journalist-grade tool for life-safety threat models. The journalist-grade claim requires both:

1. The audit's High and Medium findings shipping (H-01, H-05, M-01 through M-05 — see the audit document).
2. A human audit by a recognized external firm.

The first is now complete: H-01 (Task #168), H-05 (Task #169), M-01 (Task #170), M-02 (Task #171), M-03 (in-tree, see `App.tsx` `M-03` comments), M-04 (Task #226 — see §2 below), M-05 (Task #174), and M-06 (Tasks #173 / #193) all have shipped code fixes. The audit was published on 2026-05-02 at `docs/security-audit-public-2026-04.md` once that bar was met.

The second — an external adversarial audit by a recognized firm — has not yet been commissioned at time of writing. As of 2026-05-02 it is tracked as Task #247 with a written scope of work; the engagement, budget envelope, and firm selection are pending business decisions per the task body. The user-facing page continues to state this in plain terms ("we have not commissioned the second yet") and will be updated once the engagement is signed, not earlier.

### 0.1 The operator-correlation root residual

VOID minimizes but does not eliminate operator-side correlation. The trust boundary is the operator, and Tor mode (`.onion`-fronted signaling) plus per-instance isolation narrow it but do not remove it. **VOID is not an anonymizing system.**

This is the single root assumption beneath the two operator-correlation residuals this document discloses. They are not two separate problems. The in-memory IP↔room correlation a clearnet operator can perform (§1.1) and the relay traffic-correlation position a `TOR_ONLY` operator's coturn occupies (§1.2) are two concrete manifestations of one underlying truth: the operator sits in a correlation position the code can *narrow* but not fully *close*. Each residual below is tagged as an instance of this principle rather than presented as a standalone surprise, so a reviewer reads the root assumption first and the symptoms second.

The same sentence is what makes "operator-blind-by-construction" a *roadmap direction* rather than an already-solved claim: the honest threat-model residual and the longer-term product goal describe the same gap from two directions — one disclosing it, one pointing at narrowing it further. Nothing here should be read as a commitment that the gap is closed, nor as a delivery date for closing it.

**The sequenced answer.** The direction has a written, trigger-gated roadmap: `docs/operator-blindness-roadmap.md`. Its near-term narrowing layer — make Tor the encouraged path, attest the deployment's posture within its precise limits, and blind the room handle the operator routes on — has now **shipped** (Tasks #1022 / #1023 / #1024), narrowing §1.1 and making §1.1/§1.2's onion-only posture user-verifiable; it does not *close* the §0.1 position. Sequenced after it are three deeper architectural arcs, still named-but-not-built — **split-trust ingress** (the structural narrowing of §1.1), **relay diversity** (the structural narrowing of §1.2), and **decentralized / federated rendezvous** (the long-horizon north star, with its open lookup-metadata and Sybil/eclipse research questions). Each arc carries the explicit trigger that would start it, so this residual is neither overstated as solved nor left as an open-ended aspiration.

---

## 1. Server-observable metadata, even when content is end-to-end encrypted

**Audit reference:** §2.1 (server-observed envelope), §2.7 (server-retained state).

The server is structurally unable to read signaling content (every relay payload is AES-GCM encrypted client-side under either the phrase-derived `e2eKey` or the per-pair ECDHE-derived session key) and is structurally unable to read media (WebRTC peer-to-peer, with DTLS-SRTP keys exchanged inside encrypted relay payloads). This is verified in the audit and is the property the user-facing page calls "what privacy actually is."

It does not extend to the envelope. The server observes:

- The 32-character lowercase hex room code on every `relay-signal`, `join-room`, `leave-room`, `lock-room`, `knock`, `screen-share-*`, and `extend-room` event.
- Per-peer ephemeral peer IDs for the duration of the connection (`fromPeerId` / `toPeerId`).
- The cardinality of peers in a room over time, derivable from `join-room` / `leave-room` events and `peer-list` broadcasts.
- Packet timing on the signaling socket: handshake cadence, ICE candidate volume, screen-share toggles, knock arrivals.
- Room creation and expiry timestamps, and the room's tier (`standard` / `day`) and `roomType` (`human` / `hybrid` / `agent`).
- The TLS-level connection metadata: source IP (subject to the `getSocketIp` correction tracked as audit finding H-01), TLS handshake timing, and approximate bytes transferred on the signaling socket.

A passive observer with TLS-equivalent visibility (the operator, an upstream proxy, a compelled disclosure of server logs if the operator chose to retain any) can reconstruct the *shape* of every call: who connected, in what room, for how long, with how many other peers, and at what cadence. The *content* — SDP, ICE, media, application data — is opaque.

The user-mental-model framing on the user-facing page ("the server sees the metadata of the call but not the content") is the correct framing for an end-to-end encrypted system. It is not the framing for an anonymizing system. VOID is not an anonymizing system. The honest path to anonymity over this layer is Tor, documented in the user-facing "Network Observers and IP Visibility" section and not within scope of this document to expand.

**No mitigation is proposed for this item.** The metadata surface is intrinsic to running a relay-based signaling protocol over TCP. Reducing it (e.g., padding, cover traffic, mixnet-style relaying) is a different product, not a fix to this one.

### 1.1 Signaling IP↔room correlation — instance of the §0.1 root residual

This is the first concrete manifestation of the §0.1 operator-correlation root residual.

**Affirmative correction — signaling does not see your IP via SDP.** A common misframing holds that WebRTC SDP "leaks" the user's IP to the signaling server. On VOID it does not: SDP, ICE candidates, and ECDHE public keys all travel inside `relay-signal` payloads that are AES-GCM encrypted client-side under the phrase-derived `e2eKey` or the per-pair session key. The server sees opaque ciphertext, not the SDP, and therefore learns no IP, host candidate, or `srflx` address from the signaling *content*.

**The actual residual, now narrowed.** The server nonetheless sees the client's source IP, for one structural reason: it terminates the client's TCP/WebSocket socket. The source socket IP is visible at the transport layer — and is used to enforce the per-IP connection cap — while at runtime, in memory, the server also holds the *wire token* the socket has joined under. A malicious or compromised operator can therefore still correlate IP↔(wire token) *at runtime, in process*: not from SDP, but from occupying both ends of the socket. This is the operator-side correlation position §0.1 names; the near-term layer (§0.1) **narrows** it but cannot close it without removing the operator from the IP's path entirely (Tor).

What the near-term layer changed is *what that wire token is*. The token the operator routes on is no longer the durable, phrase-derived room id but a per-epoch **rendezvous handle** — `HKDF-SHA256(IKM = durable roomId, salt = epoch, info = "VOID-rendezvous-handle-v1")`, 16 bytes → 32 hex, shape-identical to the legacy room code (`artifacts/void-client/src/lib/rendezvous.ts`, Task #1024). The epoch is 24h, so the handle rotates daily; a live call spans at most one boundary, and joiners probe the neighbouring epochs to tolerate it. HKDF is one-way and the server never holds the phrase or the durable roomId, so the operator's in-memory view degrades from `IP ↔ stable room` to `IP ↔ ephemeral token`: it cannot link a handle across epochs, nor invert it back to a durable room or phrase. **Honest limits, which must never be overstated:** within a single epoch the IP↔handle co-location still exists; and the *first-contact / bootstrap* hop a clearnet user makes before the client can prefer onion still touches clearnet (see `docs/operator-blindness-roadmap.md` §0.1).

**The residual is now verifiable, not merely trusted.** Until recently the disclosure "use Tor; the operator can otherwise correlate IP↔room" had to be taken on faith — a user had no way to confirm the operator actually runs onion-only ingress and suppresses STUN. `GET /api/proof/posture` (`artifacts/api-server/src/lib/torPosture.ts`, Task #1023) now attests `torOnly`, `iceStunSuppressed`, and `onionIngress` (and an `onionOnlyPostureActive` that is true only when all three hold), each **bound to the reproducible-build identity** (`gitSha` / `releaseTag`). **Precise limits, which must never be overstated:** the attestation binds a claim to the *published, reproducible build at attestation time* only. It does **not** prove the operator is running the un-modified attested binary, that the config did not change after the response was read (a time-of-check/time-of-use window), or that no logging proxy sits upstream recording IPs. The honest claim is "verify the published build's posture," **not** "the operator structurally cannot ever see an IP." These non-claims travel verbatim in the response `caveat`.

**Mitigations, stated as mitigations and not as elimination.** The `socket-connect` lifecycle log line records the IP but *not* the wire token (`artifacts/api-server/src/socketHandlers.ts` — there is no room at connect time, and the disconnect line is matched on the same fields); room/handle ids are scrubbed from 2xx access-log URLs; payment hashes are digested before they reach disk. These shrink what survives to logs and disk; the rendezvous handle shrinks the *durability and linkability* of the in-memory token; neither removes the in-memory IP↔handle correlation a live operator can perform within an epoch. Only Tor — terminating the socket at a `.onion` hostname rather than at the user's clearnet IP — removes the IP from the operator's view.

> **Auditor one-liner.** Signaling never sees your IP via SDP — it's encrypted. It sees your IP because it terminates your socket, and a per-epoch handle it cannot link across days or back to your phrase. Use Tor to remove the IP, and `/api/proof/posture` to verify the operator's onion-only posture.

**We claim X; here is the test that fails the build if X regresses.**

- *No user content can be added to the signaling envelope* — so nothing new can smuggle an IP, room-linkable payload, or content field into the clear: `artifacts/void-client/scripts/check-signaling-envelope.mjs` pins the 38-entry signaling-event whitelist and the data-channel-label whitelist against `docs/signaling-envelope-audit.md`; a new `.emit("…")` / `.on("…")` / `createDataChannel("…")` name outside those whitelists fails the build.
- *No single log line co-locates a client IP and a room ID* — so the IP↔room correlation is never promoted from in-memory to on-disk: `artifacts/void-client/scripts/check-log-ip-room-correlation.mjs` fails on any structured log object that carries both an IP field and a room-ID field with dynamic values.
- *No raw Lightning payment hash is logged* — it appears verbatim in settlement records and would re-link a host: `artifacts/void-client/scripts/check-payment-hash-log.mjs` fails on any `paymentHash` log field, directing the contributor to the non-reversible digest instead.
- *The human-room wire handle rotates per epoch and is one-way* — so the operator's token cannot be linked across days or inverted to the durable room/phrase: `artifacts/void-client/src/lib/rendezvous.test.ts` asserts the handle differs per epoch and per room, and is shape-identical to the legacy code.
- *The posture attestation reports onion-only only when every fact holds* — so it cannot over-state the operator's posture: `artifacts/api-server/src/__tests__/tor-posture.test.ts` asserts `onionOnlyPostureActive` is true only when `torOnly`, `iceStunSuppressed`, and `onionIngress` all hold, and that the facts are bound to the build identity.

**Deliberate surface-shrink.** Per-peer mute, camera-off, voice-mask, and onion-status indicators were moved *off* the signaling envelope onto the encrypted `void.media-state` data channel (Task #868), so the operator no longer sees even these small per-peer state transitions broadcast through signaling. This narrows the §0.1 position; it does not eliminate it.

**The architectural narrowing, sequenced not promised.** The structural way to remove the in-memory `IP↔room` correlation without relying on the user reaching the deployment over Tor is **split-trust ingress** — an IP-terminating tier in front of a separate rendezvous tier, so no single process co-locates a client's IP with its room. It is named, not built: against a *solo* operator who runs both tiers it buys an architectural guarantee plus latent option value rather than an immediate win, so it is gated on a concrete tier-separation trigger and sequenced after the near-term layer. See `docs/operator-blindness-roadmap.md` Arc A.

### 1.2 TOR_ONLY relay traffic-correlation — instance of the §0.1 root residual

This is the second concrete manifestation of the §0.1 root residual, and it stands fully: it is a disclosure, not an apology.

Under `TOR_ONLY=1` (the runtime posture in `artifacts/api-server/src/lib/torOnly.ts`), every call is forced relay/relay — no STUN candidate is offered in either branch of `/api/ice-servers`, so both legs of every call traverse the operator's coturn. The operator's TURN relay therefore occupies a **traffic-correlation position**: it sees the timing and bitrate envelopes of both legs of each call even though it cannot see the peers' IPs (they arrive via Tor) and cannot read media or signaling content (DTLS-SRTP and AES-GCM respectively).

This is the deliberate tradeoff of `TOR_ONLY`, not a defect. The clearnet IP graph — who-talks-to-whom by network address — is *collapsed into a single trusted-operator traffic-analysis position*. A clearnet deployment spreads correlation across the network path; `TOR_ONLY` concentrates it at one party the operator already controls and the user has already chosen to trust by running their room there. It removes per-peer IP exposure at the cost of making the operator's relay the one place where timing/volume correlation across both legs is possible.

**The posture is now verifiable, not merely trusted.** That `TOR_ONLY` is actually in force — and with it the relay/relay forcing and STUN suppression this section describes — no longer has to be taken on faith: `GET /api/proof/posture` attests `torOnly` and `iceStunSuppressed`, bound to the reproducible-build identity (see §1.1 and `artifacts/api-server/src/lib/torPosture.ts`, Task #1023). The same precise limits apply — it verifies the *published build's* posture at read time, not that the operator's relay cannot perform the traffic correlation this section discloses. The residual stands; what changed is that a user can now confirm the deployment runs the posture this disclosure assumes.

The canonical decision records for the surrounding choices live in `docs/privacy-non-goals.md`: **N-1** (VOID fronts the *signaling* layer with a Tor hidden service; the media path always gathers ICE on the user's underlying network and relays via clearnet TURN) and **N-3** (the TURN-operator media-layer metadata cannot be removed by an in-app feature — the structural answer is self-hosting the relay). This section names the residual those non-goals imply; it does not restate them.

**We claim X; here is the test that fails the build if X regresses.** *The operator's relay cannot be quietly co-opted as an open relay* — which would let unrelated third-party traffic mint credentials against it and muddy or expand this position: `artifacts/api-server/src/lib/turnSecret.ts` refuses to boot when `TURN_SECRET` is a known placeholder or shorter than 16 characters, so ephemeral TURN credentials cannot be minted against a guessable secret.

**The architectural narrowing, sequenced not promised.** The structural narrowing of this position is **relay diversity** — routing the two legs of a call through *different* relays/operators so no single coturn sees both envelopes of the same conversation. It is named, not built: until a multi-operator relay ecosystem exists *and* a user with a state-level threat model requires it, building it is gold-plating a disclose-not-solve residual, so it is gated on the same multi-operator / state-level trigger family as N-2 and N-3. See `docs/operator-blindness-roadmap.md` Arc B; where it touches TURN-operator media metadata, **N-3 remains authoritative.**

### 1.3 Padding / CBR is a non-goal, with its trigger condition

Constant-bitrate output or traffic-padding / cover traffic would blunt the timing/bitrate-envelope visibility in §1.1 and §1.2, and it is **intentionally not implemented**. It carries a real, continuous performance and bandwidth cost for marginal gain against an adversary VOID does not claim to defeat (a global passive observer / traffic-analysis-capable adversary), and it is out of scope for the current threat model.

This is a pre-commitment fence: the default answer to "should we add padding/CBR now?" is a documented **no, and here is why.** It becomes a goal only under one explicit trigger — *a user with a state-level threat model actually requires it and contracts for it.* Absent that trigger, re-proposing padding is re-litigating a settled decision.

The canonical decision record is `docs/privacy-non-goals.md` **N-2** (cover traffic / traffic-analysis padding). This section states the non-goal and its trigger and cross-links to N-2 rather than competing with it; if the two ever disagree, **N-2 is authoritative.**

---

## 2. Lightning paywall observability

**Audit reference:** §10.2, finding M-04 (`artifacts/api-server/src/services/lightning.ts:82`).

The host's BOLT11 invoice carries no room metadata. The audit confirms the invoice memo does not encode `roomId`, phrase material, or peer identity. The payment hash is internal to the LNbits/BTCPay backend the operator has configured and to the routing nodes along the payment path; it is not exposed to other peers in the room or to the relay's signaling protocol.

The leak surface is **temporal correlation between two observable events**:

- The Lightning payment itself, observable on (a) the host's wallet, (b) any routing node along the payment path, (c) the recipient node operated by the VOID operator, and (d) any party with subpoena or shared-operator access to any of the above.
- The `create-room` event on the VOID server, observable to the operator and to anyone with access to the operator's logs (which the default deployment does not retain, but which an operator may retain).

An adversary who can observe both events and correlate the timing within a small window can link a Lightning payer identity to "this party hosted a VOID room at time T." This is a metadata-side correlation; it does not reveal the contents of the room, the peers in it, or the phrase.

For most threat models this correlation is irrelevant. For a journalist-source threat model where the host's Lightning identity is itself the fact the adversary is trying to learn (e.g., "did this source pay for a private call this week"), the correlation matters.

**Code-level mitigation (Task #226):** `artifacts/api-server/src/routes/paywall.ts` now inserts a uniformly-random delay of 10–60 seconds (configurable via `PAYWALL_JITTER_MIN_MS` / `PAYWALL_JITTER_MAX_MS`; opt-out with `PAYWALL_JITTER_DISABLE=1`) between the moment settlement is first detected and the moment `/paywall/status` delivers `paid: true` with a token. The token and `expiresAt` are computed at settlement time, so the paid window the host purchased begins at settlement, not at delivery. The jitter is applied only on the first-paid path; re-polls (which return a cached token) and `/paywall/recover` (which is already temporally delinked from settlement) are not delayed.

This does not eliminate the temporal correlation attack — a sufficiently patient adversary with a long observation window can average the delay out — but it raises the cost from a single-sample correlation to one that requires multi-sample statistical analysis across a jittered window of up to 60 seconds. For the journalist-source threat model where the adversary is watching for a specific payment within a narrow window, the mitigation materially increases the difficulty.

**Residual risk:** an adversary with access to both the Lightning node's settle log and the VOID operator's server logs over a long window can still correlate statistically. The jitter is a partial mitigation, not elimination. The recommended user-facing mitigations below remain the strongest defense for high-sensitivity use cases.

**Recommended user-facing mitigations** (documented on the user-facing page):

- Route the Lightning payment over Tor.
- Use a wallet that does not require KYC and is not linkable to the host's name.
- Have a third party pay the invoice on the host's behalf.
- Self-host VOID with a self-hosted LNbits/BTCPay instance, eliminating the operator-side observation surface entirely.

**Not in scope here:** rewriting the paywall to be Chaumian-blind, integrating Cashu / Fedimint, or routing all payments through a mix. Those are valid paths and may become future work; they are not the point of this document.

---

## 3. URL fragment local-disclosure surface

**Audit reference:** §10.3, finding M-03 (`artifacts/void-client/src/App.tsx:160, 186`).

The VOID Phrase is embedded in the URL fragment (`#phrase-here`). RFC 3986 §3.5 specifies that fragments are not transmitted to servers; this is honored by every conformant browser. The audit verifies via reading the client signaling code that the phrase is never serialized to a request line or header, and via reading the server signaling handlers that no field on any inbound payload would carry it. The phrase does not reach the network. This holds.

The phrase **is** present in:

- The browser's address bar, visible to anyone with shoulder-access to the screen or any screen-recording tool.
- The `window.location.hash` JavaScript value, readable by any extension with `host_permissions` for the origin (or `<all_urls>`), and by any code injected into the page (XSS, malicious browser extension, in-page script-injection by a hostile network appliance terminating TLS — out of scope for the standard adversary model but in scope for some real-world threat models).
- The browser history database on disk, where it persists until the user clears history, until the browser's history-retention window expires, or until the M-03 fix replaces the fragment-bearing entry with a clean one on leave (`history.replaceState`). The fix closes the *post-leave* exposure; the *in-room* exposure on the screen is intrinsic.
- The OS-level page-share / screenshot / "share to app" surfaces, which receive the full URL including the fragment and may forward it to receiving applications. (Documented in M-03 as a sub-finding.)
- Password managers and history-syncing services, depending on browser configuration.

The boundary this defines is: **VOID protects against network actors. It does not protect against local actors with read access to the device's browser surface.** The user-facing page states this in plain language; this document records the surface enumeration.

**Mitigations:**

- M-03 (`replaceState` on leave) is tracked as a separate audit finding. When it ships, the post-leave history exposure is closed. The in-room exposure is by design — the phrase has to be reachable to the joining client to be usable.
- Operational guidance on the user-facing page: do not photograph or share-screen a phrase URL; close the tab when done.
- A future architectural alternative — moving the phrase out of the URL into a separate prompt / paste field — would trade convenience for surface reduction. Not currently recommended; it would significantly degrade the join UX (the URL-as-handoff is the design's main usability property).

---

## 4. SAS is a derived property of phrase encryption, not an independent layer

**Audit reference:** §10.1, with supporting analysis in §1.3 (SAS) and §2.2 (server cannot inject a forged peer).

The Short Authentication String (SAS, "the Duet" on the user-facing page) is two BIP-39 words derived via HKDF-SHA256 from the ECDH shared secret. Two 11-bit words = 22 bits of search space, ~21 bits effective when accounting for phonetic confusability between BIP-39 entries. This is below the search space at which a brute-force attack is intractable in isolation.

The attack the SAS is defending against is a man-in-the-middle of the signaling channel: an attacker positioned between two peers who substitutes their own ECDH public key for each peer's, completing two separate key-exchanges and decrypting/re-encrypting the rest of the session. Without a verification step, both peers see "ECDHE completed" and proceed.

The reason the 22-bit SAS is sufficient against this attack: the ECDH messages are themselves carried inside `relay-signal` envelopes encrypted with the phrase-derived `e2eKey`. An MITM who does not know the phrase cannot read those envelopes, cannot inject substitute ECDH public keys, and therefore cannot grind ephemeral ECDH keypairs in real time until the resulting SAS happens to match a target value. The attack the SAS appears to defend against is structurally not available to an attacker who lacks the phrase.

An attacker who **does** know the phrase has full peer status: they can derive the room code, complete the join, complete the ECDHE handshake, and read every subsequent payload. The SAS verification then succeeds (correctly — the cryptography is intact) but the attacker is inside the room and the verification was the wrong question.

So:

- **Without the phrase, the SAS is a verification step that succeeds because the underlying handshake was carried in a phrase-encrypted envelope.** The SAS confirms that the phrase-derived channel was not subverted in transit. This is a real and useful property.
- **With the phrase, the SAS is not a defense.** It cannot defend against an attacker who is already a legitimate peer.

The user-facing page states this as: "the Duet is not an independent layer of defense stacked on top of the phrase. It is a verification that the phrase-derived channel was not subverted." This is the correct user mental model.

**A SAS verdict is bound to a key fingerprint, not held forever.** The verdict the user issues is stored against the SAS fingerprint it was checked against (`useRoomCrypto`'s `peerVerification`, keyed by `sasFingerprint`). When a peer completes a fresh ECDHE handshake mid-call and their key fingerprint changes, `WebRTCManager` fires `onRekey` (`artifacts/void-client/src/lib/webrtc.ts`), `useRoomCrypto.handleRekey` (`artifacts/void-client/src/hooks/useRoomCrypto.ts`) discards the prior verdict for that peer, and `PeerTileGrid.tsx` raises a persistent "KEYS ROTATED / RE-VERIFY SAS" banner that stays until the user issues a fresh verdict. This is a deliberate security behaviour: a stale "verified" badge must not vouch for keys the user never checked, and an attacker who substituted at the moment of rotation would produce a different SAS. Both user-facing surfaces disclose it in plain language — a verified Duet does not survive a mid-call key rotation, and the user is prompted to re-verify. (The per-pair scope of this re-prompt, and the gap where a third peer is not notified of an A↔B rekey, is enumerated in `docs/client-threat-model.md`.)

**Defense-in-depth recommendations** (audit-tracked, not within this document's scope to specify):

- M-01: Add a signed `hello` envelope on the browser side mirroring the agent SDK design (Ed25519 ephemeral identity key signs the ECDH public-key fingerprint), so that the SAS-defends-against-MITM property no longer depends solely on phrase-encrypted envelopes.
- Replace the `webrtc.ts` silent-decrypt-fallback paths (catch on per-pair session-key decrypt → retry with phrase-derived key) with explicit close + user-visible error, so per-pair forward secrecy is not silently abandoned on transient ECDHE failure. Tracked under M-01.

These changes do not alter the user-facing claim today; they would change the *basis* of the claim from "depends on phrase secrecy" to "depends on phrase secrecy AND a signed identity binding." For the present-day documentation, the dependency on phrase secrecy is the truth, and the user-facing page states it.

---

## 5. Public REST endpoint room-existence timing audit

Task #159 hardened `GET /api/room-state/:code` so that the never-existed,
expired, and destroyed branches collapse to the same `{}` body **and** take
roughly the same compute (one `Map.get` + one property read + one
`Date.now` compare on every null path) — see the block comment on
`getRoomState` in `artifacts/api-server/src/rooms.ts` and the regression
benchmark in `artifacts/api-server/src/__tests__/room-state-timing.test.ts`.

Task #165 reviewed every other public, no-auth REST route on the API
server for the same class of bug — i.e. a route that reads from the
in-memory rooms map (or a sibling map keyed by a public identifier) and
collapses multiple states into a single uniform body, where the
codepath taken is nonetheless distinguishable by wall-clock latency.

| Route | Reads `rooms` map? | Verdict |
|---|---|---|
| `GET /api/health`, `GET /api/healthz` | No | Static payload, no map access. |
| `GET /api/ice-servers` | No | HMAC-derives credentials from env vars; per-IP rate-limit bucket only. |
| `GET /api/room-state/:code` | Yes | Already equalized in Task #159 (see above). |
| `POST /api/paywall/invoice` | No | Touches `invoiceStates`, never `rooms`. Body shape is uniform success/error; no state-collapse on the success branch. |
| `GET /api/paywall/status/:paymentHash` | No | Touches `invoiceStates`, never `rooms`. The body **intentionally varies** across `paid:false`, first-paid (`recoveryCode` present), and re-poll (`recoveryCode` absent) branches — distinguishability is on the wire, so timing-equalization adds nothing. The branch is also dominated by the async `checkPayment` I/O hop, which is orders of magnitude larger than any in-process branching. |
| `POST /api/paywall/recover` | No | Touches `recoveryCodes`, never `rooms`. The 404 branch ("unknown or already-used") is reached by the same `Map.get` returning `undefined` on both sub-cases — codepath is uniform. The 410 ("expired") branch is intentionally distinguishable by both status code and body and is documented inline as a deliberate UX choice (the alternative would tell a legitimate user "wrong code" when their window simply ended). |
| `POST /api/paywall/dev-pay/:paymentHash` | No | Gated on `NODE_ENV !== "production"`; not in the production attack surface. |
| `GET *` static catch-all | No | Only mounted in self-host (`SERVE_STATIC=1`) mode; serves static HTML by path lookup, no map access. |

**Out of scope, by design.** The Socket.IO `join-room` / `create-room`
handlers do condition on `rooms` map presence, but they are not
public-no-auth REST endpoints — they require an established WebSocket
session, are governed by the per-socket rate limiter, and live behind
the room phrase (which the server never sees, per §3.7 of the
2026-04 internal audit). They are not in this audit's scope; the
phrase-correctness side channel is analyzed separately in that audit
section.

**Conclusion.** No additional public REST endpoint exhibits the
"uniform body, divergent codepath" shape that Task #159 fixed.
`/api/room-state/:code` remains the only route on which a coarse
timing-equalization is meaningful; everything else either does not
touch the `rooms` map at all, or already exposes the relevant branch
on the wire.

## 6. Browser-level surfaces

**Audit reference:** May 2026 re-audit, §R-10 (`docs/security-audit-public-2026-04.md`); user-facing mirror at `ThreatModelPage.tsx` "BROWSER-LEVEL SURFACES".

The four items in §1–§4 are properties of VOID's design. The six items below are properties of the browser any VOID client runs inside. They are recorded here because an external reviewer would flag their absence, and because they constrain the maximum privacy a VOID room can offer regardless of how the relay or the cryptography behave.

### 6.1 DNS-level fingerprinting

When a client opens a VOID room, the browser issues a DNS lookup for the operator's domain through whichever resolver the device is configured to use (system resolver, browser-level DoH provider, captive-portal resolver, VPN-tunneled resolver). That resolver and any upstream observer with retention learn that the device queried VOID at time T. The query is independent of, and observable separately from, the TLS handshake.

The disclosure surface is the resolver chain itself. ISPs that retain query logs, captive-portal resolvers operated by the network owner, and DNS-over-HTTPS providers that log are all in scope. A VPN does not eliminate this — DNS leaks (the OS bypassing the tunnel for the resolver) are common enough that most VPN clients ship a leak-check.

**Mitigation, user-side:** enable browser- or OS-level DNS-over-HTTPS / DNS-over-TLS to a resolver chosen on its retention policy; on a VPN, verify the tunnel actually carries DNS; for the strongest posture, route through Tor (which carries DNS internally). Documented inline on the user-facing page.

### 6.2 Clipboard surface

`navigator.clipboard.readText()` and the older `document.execCommand("paste")` path expose clipboard contents to any extension granted the `clipboardRead` permission, on a per-extension basis at install time. When a user pastes a VOID Phrase into the join form, that phrase sits on the system clipboard until overwritten; every `clipboardRead`-permissioned extension running in the browser at that moment can sample it. The same applies to SAS comparison strings if a user ever copies them.

The realistic adversary is not a state actor. It is the install base of free browser extensions that requested `clipboardRead` for a benign-sounding reason and were granted it because the user clicked through the install prompt. The exposure is multi-tenant: any extension installed in the same browser profile observes the paste.

**Mitigation, user-side:** use a separate browser profile with no extensions installed for high-sensitivity rooms, or manually clear the clipboard after the paste by copying a single neutral character over it. A hardware password manager does not address this — it protects vault contents, not the post-paste clipboard.

### 6.3 Notification API surface

When VOID emits a `Notification` (guest arrival, knock pending, last-chance room warning), the notification body and its origin are visible to extensions with notification-API access on the same profile. The notification text frequently includes contextual information (peer count, time-remaining warnings) that a passive extension can correlate over time.

**Mitigation, user-side:** deny VOID the notification permission in browser site settings and rely on the in-tab UI; or, equivalently, use a profile with no notification-capable extensions.

### 6.4 Extension page-content access

Any browser extension installed with `<all_urls>` host permission has DOM-level read access to every page in the profile, including the VOID room page. That includes the displayed phrase (when shown by the host), the SAS words rendered on screen, the peer list, and any text the room UI renders. Canvas readback (the masked video frames) is gated by the same-origin policy in some browsers but is not a uniform protection.

**Mitigation, user-side:** install no extensions in the VOID-using profile, or use a clean profile. Private windows deny extension access by default unless the user has explicitly enabled them in incognito.

### 6.5 WebRTC `getStats()` and debugger API

Browser extensions with the `debugger` permission, or with page-content access, can call `RTCPeerConnection.getStats()` on any active WebRTC connection in the page. The returned stats include ICE candidate types (host / srflx / relay), bytes-received, jitter, packet-loss, frame rate, and other connection metadata. The keys and the media are not exposed; the shape of the call is. The same data is reachable to anyone with the developer-tools panel open on the room tab.

**Mitigation, user-side:** use a profile with no debugger-capable extensions for sensitive rooms; do not present a screen share with the WebRTC internals panel open.

### 6.6 Managed-browser `getUserMedia` permission logging

Some browsers — and most enterprise-managed deployments (Chrome Enterprise, Edge for Business, MDM-installed profiles, Mobile-Device-Management policy on iOS/Android) — log `getUserMedia` permission grants with timestamp and origin. The log may be shipped to the enterprise admin, the browser vendor, or both. The fact that a particular employee authorized camera/mic for the VOID origin at a particular time is in the record, even though the call's contents are not.

**Mitigation, user-side:** do not use an employer-managed browser for personal-privacy use. Use a personal browser profile on a personal device. There is no software fix to a managed browser doing what its policy tells it to do.

---

## 7. Drift policy

The user-facing `ThreatModelPage.tsx` and this document share substantive claims. They are permitted to differ in:

- **Voice.** The user-facing page is plainspoken and avoids security jargon. This document uses the technical vocabulary appropriate to its audience.
- **Depth.** This document enumerates surfaces and cites code paths. The user-facing page summarizes.
- **Cross-references.** This document points at audit section numbers and finding IDs. The user-facing page mentions the audit by name and links to the source-tree path.

They must not differ in:

- **What is claimed to be protected.** A property called "protected" on one surface must be at least as protected (and never claimed-but-not-actually-protected) on the other.
- **What is claimed to be a limitation.** A limitation disclosed in one place must be disclosed in the other. This is the entire reason for the mirror.
- **The journalist-grade caveat.** Both surfaces must state that VOID is not vetted today as a journalist-grade tool and that the journalist-grade claim requires both audit fixes shipping and an external human audit.

If you find a substantive disagreement between this document and the user-facing page, treat it as a bug. The two were synced at the time the four documented limitations were added; they should be re-synced on every subsequent change to either.
