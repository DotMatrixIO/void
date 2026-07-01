# VOID — Research: Can We Scale Rooms Past Four Without Becoming a Different Product?

**Audience:** the VOID team — engineering, product, and whoever owns the
marketing/positioning claims. Written so a non-specialist can read the
summary and walk away with a decision.
**Scope:** a research spike, not an implementation. No production code,
topology, or crypto changes are made by this task. The 4-participant cap
(`MAX_USERS` in `artifacts/api-server/src/rooms/types.ts:12`) is untouched.
**Companion artifact:** a disposable proof-of-concept at
`docs/research/scaling-poc/sframe-sfu-spike.mjs`, run with
`node docs/research/scaling-poc/sframe-sfu-spike.mjs`. It is self-contained
(Node WebCrypto only, no app imports, outside every pnpm workspace glob) and
is meant to be deleted once this document is accepted.
**Status:** findings + recommendation. The architecture decision itself is a
separate task, to be informed by this document.

---

## 0. TL;DR (read this first)

VOID caps rooms at four because of **full-mesh P2P fan-out**, not because of
any cryptographic limit. The standard way the industry breaks that ceiling —
an **SFU relay** + **SFrame application-layer E2EE** + **simulcast/SVC with
active-speaker switching** — is **technically viable on top of VOID's existing
key machinery**. The spike confirms the single riskiest claim: frame
encryption rides on an SFU while leaving the relay unable to decrypt, reusing
the exact P-384 ECDHE → HKDF → AES-GCM approach VOID already ships.

**But the cost is not paid in code. It is paid in identity.** An SFU is a
*second server in the media path for the entire duration of the call*, where
today there is none. It introduces a real, enumerable metadata surface and a
juicier target. Of VOID's six load-bearing public claims, **one breaks
outright** ("no server in the media path") and **three bend** under an SFU —
even a zero-knowledge one.

**Recommendation: do not ship an SFU now. Adopt the "stay mesh" path for the
current launch window, and keep the optional self-hostable-SFU middle path on
file as a deferred, post-launch decision** — revisited only once VOID has
operational maturity and a concrete, audience-aligned demand for rooms of
5–32. The honest answer to the title question is: *yes we technically can, but
not without changing what VOID claims to be — so not now.*

---

## 1. Why four today

VOID uses a **full-mesh** WebRTC topology: every participant opens a dedicated
`RTCPeerConnection` to every other participant
(`artifacts/void-client/src/lib/webrtc.ts`, per-peer factory in
`webrtcPerPeer.ts`). There is no media server. The signaling relay forwards
opaque encrypted SDP/ICE during setup and then steps out of the media path
entirely.

The cost of mesh is **quadratic fan-out**. In a room of N, each participant:

- **uploads N−1 copies** of their own camera/mic stream (one per peer), and
- **runs N−1 encode + N−1 decode pipelines** simultaneously.

| Room size N | Upstreams per peer | Encode+decode pipelines per peer | Total PC links in room |
| ----------- | ------------------ | -------------------------------- | ---------------------- |
| 2           | 1                  | 2                                | 1                      |
| 3           | 2                  | 4                                | 3                      |
| 4           | 3                  | 6                                | 6                      |
| 5           | 4                  | 8                                | 10                     |
| 8           | 7                  | 14                               | 28                     |

Upload bandwidth and per-frame encode/decode are the binding constraints. On
real consumer devices — especially mobile, low-power, and the older hardware a
privacy-conscious user base disproportionately runs — mesh video stays usable
to about **4–6 participants** and then degrades into dropped frames, fan
spin-up, and battery drain. VOID picked **4** as the product-defined ceiling
(see the load-bearing comment at `rooms/types.ts:2-12` and
`docs/code-quirks-index.md`), small enough that mesh stays comfortable on the
weakest device in the room.

**This is a topology cost, not a crypto cost.** Nothing in the P-384 ECDHE,
signed-Hello, or SAS machinery cares how many peers are in the room. That
matters for everything below: the ceiling is an *engineering* artifact, which
is exactly why the industry has well-trodden ways around it.

---

## 2. The three building blocks

Raising the ceiling is not one change; it is three, and each buys a different
thing. You need roughly all three to make 20–32 *usable* — any one alone is
insufficient.

### 2.1 SFU (Selective Forwarding Unit) — kills the fan-out

An SFU is a media relay. Each participant uploads **one** copy of their stream
to the SFU; the SFU forwards it to the others. Upstream drops from N−1 to **1**.
This is the single change that breaks the quadratic curve and is the
foundation FaceTime (32), Zoom, Meet, and Jitsi all stand on.

- **Buys:** the upload-bandwidth ceiling disappears; one upstream regardless of
  room size.
- **Costs:** *a server in the media path.* This is the entire philosophical
  problem (§6). Without further work the SFU also sees plaintext media —
  unacceptable for VOID — which is what building block 2 fixes.

### 2.2 SFrame / Insertable Streams with a sender-key group model — keeps the relay blind

WebRTC's default SRTP encryption terminates **at the SFU** (hop-by-hop), so a
naive SFU decrypts your video. **SFrame** (RFC 9605) adds a *second*,
application-layer encryption applied to each media frame *before* it reaches
the SFU, via the browser's **Insertable Streams / `RTCRtpScriptTransform`**
API. The SFU forwards opaque ciphertext; only participants hold the keys.

The keys come from a **sender-key group model**: each participant generates its
own symmetric "sender key", encrypts media frames under it, and distributes
that key to the other participants over an already-authenticated channel.
**VOID already has that channel** — the per-pair ECDHE secure channel in
`webrtc.ts`. (Detailed reuse map in §4.)

- **Buys:** the SFU becomes *zero-knowledge* — it routes ciphertext and never
  holds media keys. This is what makes an SFU compatible with VOID at all.
- **Costs:** group-key *lifecycle* — rotation on join/leave, forward secrecy,
  group SAS (§4). These are the genuinely hard parts, and they are protocol
  problems, not API problems.

### 2.3 Simulcast / SVC + active-speaker switching — makes 20–32 actually usable

Even with an SFU, a client receiving 31 full-resolution streams would melt.
**Simulcast** (sender uploads multiple quality layers) or **SVC** (a single
layered stream) lets the SFU forward a *high-res* copy of only the few
**active speakers** and *low-res thumbnails* (or nothing) for everyone else.
The client decodes a handful of tiles, not N.

- **Buys:** decode/render cost becomes bounded by *forwarded-stream count*
  (a handful), not room size. This is what turns "technically connected to 32
  people" into "a call you can actually run."
- **Costs:** encode cost on the sender (multiple layers), and — for VOID
  specifically — the **active-speaker decision is made by the SFU**, which
  means the SFU learns *who is speaking when* (a metadata leak, §7), and SFrame
  must be layer-aware so dropping a layer at the relay doesn't break decryption.

---

## 3. Browser / platform reality check

What is actually shippable across VOID's target browsers (baseline support
documented in `docs/browser-compatibility.md`).

| Platform | Insertable Streams / Encoded Transform | Practical status |
| -------- | -------------------------------------- | ---------------- |
| Chrome / Edge / Chromium | `RTCRtpScriptTransform` + legacy `createEncodedStreams` | **Shippable.** Mature; this is where SFrame demos live. |
| Firefox | `RTCRtpScriptTransform` (the standardized API) | **Shippable**, on the standards-track API. |
| Safari / WebKit (desktop + iOS) | `RTCRtpScriptTransform` supported in recent WebKit | **Conditionally shippable.** Historically the laggard; transforms run in a worker, and iOS power/autoplay/background-suspend caveats (already documented for VOID in `browser-compatibility.md` Tier 2) compound. Must be tested on real devices, not assumed. |
| Tor Browser | Based on Firefox ESR; API may exist, but WebRTC is **disabled by default** on Safer/Safest (`browser-compatibility.md` Tier 1) | **Not the real question** — see §3.1. |

**Net:** the *API* surface is broadly available in 2026 across Chromium,
Firefox, and recent WebKit. Insertable Streams is no longer the aspirational
part. The aspirational parts are (a) Safari/iOS behaving under real load and
(b) the Tor experience, below.

### 3.1 Tor as a first-class platform (not a checkbox)

VOID treats Tor as a supported privacy path, so "does the API exist in Tor
Browser" is the wrong test. The right test is "does the *experience* hold up on
a Tor circuit," and for an SFU the answer is uncomfortable:

- **(a) CPU on a typical Tor user's device.** SFrame crypto cost is negligible
  (§5), so this is not the constraint. ✓ Not a blocker.
- **(b) SFU forwarding over Tor latency/jitter.** Real-time media over Tor is
  already marginal today for *mesh*; an SFU adds a forwarding hop. High latency
  and jitter degrade active-speaker switching and jitter buffers. **Likely
  poor.** ✗
- **(c) Reaching the SFU itself over Tor.** If the SFU is on clearnet, it
  becomes a **clearnet anchor in the call path** — exactly the kind of
  fixed-infrastructure correlation point VOID's mesh design avoids. An
  `.onion` SFU is possible but inherits onion-service latency/reachability
  constraints and is a substantial operational lift (cf.
  `docs/onion-mirror-runbook.md`). ✗ / hard.
- **(d) Bandwidth budget.** Tor users often have constrained budgets; an SFU
  changes the upstream story favorably (one upstream) but the SVC/simulcast
  sender cost and the relay hop cut the other way. Mixed.

**Conclusion:** the SFU middle path has a real risk of being a *good* experience
for clearnet users and a *degraded or anchoring* one for Tor users. That is not
a footnote for VOID — it is a first-order objection, because the Tor user is
part of who VOID is for.

---

## 4. Reuse assessment: how far does today's key machinery stretch?

VOID's per-pair machinery is unusually well-suited as the *bootstrap* for a
group-key model. The gaps are all in group-key *lifecycle*, not in primitives.

| Existing mechanism | Where | Extends to group model? | Notes / gap |
| ------------------ | ----- | ----------------------- | ----------- |
| Per-pair **ECDHE** (P-384) + HKDF-SHA256 → AES-GCM-256 | `signalCrypto.ts` `deriveSessionKey` | **Reuses directly** | This is exactly the authenticated channel over which each sender key is distributed. The spike does this verbatim. |
| **Signed Hello** envelope (Ed25519, roomId binding, nonce, ±5min skew) | `helloEnvelope.ts` / `@workspace/wire-core` | **Reuses directly** | Authenticates group membership and binds sender-key distribution to the room. No change to the envelope needed for bootstrap. |
| **SAS** (2 BIP-39 words, `VOID-SAS-v1`) | `signalCrypto.ts` `deriveSessionKey`; `SasVerificationDialog.tsx` | **Bends — needs a group story** | Today SAS authenticates *one pair*. A 32-person room has 496 pairs; nobody verifies 496 SAS strings. Needs a **group SAS** construction (e.g. a commitment over all members' keys yielding one phrase the room compares). This is a real protocol design item, not a tweak. |
| **Replay/IV caches** (`peerSeenIvs`, `peerSeenHelloNonces`, cap 4096, loud-fail on overflow) | `webrtc.ts` | **Extends, per-sender** | Maps cleanly onto per-sender frame counters (the spike uses `from|keyGen|ctr` as AES-GCM AAD). Frame-rate volume is higher than signaling, so the bound/eviction policy needs re-thinking for the media path. |
| **Loud-fail teardown** (`failSecureChannel`) | `webrtc.ts:420` | **Concept reuses; semantics change** | In mesh, tearing one pair down is contained. In a group, a single member's bad key gen must not nuke the room — failure handling becomes per-sender, not per-room. |

**The genuine gaps (all group-key lifecycle, all hard):**

1. **Rekey on join.** A joiner must receive current sender keys; existing
   members may rotate to deny the joiner past frames (forward secrecy for
   history). The spike shows distribution is cheap (reuses pairwise channels).
2. **Rekey on leave / forward secrecy.** When a member leaves, remaining
   senders must rotate sender keys so the departed member cannot decrypt future
   frames. **The spike validates this works** and measures it (~56 ms to rotate
   + redistribute across a group of 7). At larger N and higher churn this is
   the operationally awkward part.
3. **Post-compromise security.** True PCS (healing after a key compromise) is
   what **MLS (RFC 9420)** exists to provide, via its tree-based rekeying.
   Sender-keys give cheap distribution but weaker PCS than MLS. VOID would be
   choosing the simpler, weaker model deliberately — which is defensible for an
   *ephemeral* product (rooms are short-lived; `ROOM_TTL`), but must be a
   conscious decision, documented like every other VOID limitation.
4. **Group SAS** (see table) — the human-verification story for >2 people.

**Bottom line on reuse:** VOID is *better positioned than most* to add group
E2EE because the authenticated pairwise channel and signed membership already
exist. The crypto primitives are a non-issue. The work is group-key lifecycle
design (rotation policy, PCS posture, group SAS) — weeks of careful protocol
work and review, not a weekend.

---

## 5. The proof-of-concept and what it measured

**Effort budget:** ~1 day, deliberately bounded. *If the riskiest claim could
not be validated within a day, that itself would have been a finding* (it would
mean the engineering cost is higher than expected and the recommendation should
weigh that). It validated in a single self-contained file — which is itself the
finding that **the crypto is the easy part.**

The spike (`docs/research/scaling-poc/sframe-sfu-spike.mjs`) reimplements
VOID's P-384 ECDHE → HKDF → AES-GCM approach standalone, builds a sender-key
group, runs frames through a simulated SFU, and probes whether the relay can
decrypt. Measured on this Replit container (Node 24, single core, AES-GCM via
WebCrypto):

| Claim under test | Result |
| ---------------- | ------ |
| **SFrame rides on SFU, relay stays blind** (group of 8: every recipient decrypts; relay holding only the envelope cannot) | **PASS** — 7/7 recipients OK, relay `RELAY_BLIND` |
| **Forward secrecy on leave** (rotate + redistribute sender keys; departed member's retained key can't read post-rekey frames) | **PASS** — old key blocked; rekey+redistribute ≈ **56 ms** for a group of 7 |
| **Per-frame crypto cost** (AES-GCM-256, 6 KB ≈ 720p@1.5 Mbps avg frame) | enc ≈ 640 µs, dec ≈ 525 µs *(conservative: WebCrypto per-call overhead-dominated; a real worker/WebCodecs path is typically far lower)* |
| **Receiver decode ceiling** (decrypt-only, 30 fps, single core) | ~6 streams @10% of a core, ~15 @25%, ~**31 @50%** |

**Interpretation:** even at the *conservative* measured cost, a single core can
decrypt ~31 forwarded streams at 30 fps using half its budget — and with
active-speaker + simulcast the SFU forwards only a *handful* of high-res
streams to each client anyway. **SFrame crypto is not the bottleneck.** The
real ceiling is decode/render of forwarded tiles (building block 3) and, above
all, the non-technical costs in §6–§8.

**What the spike deliberately did NOT do:** stand up a real SFU, touch
`void-client` or `api-server`, handle network reality (loss, jitter, NAT),
implement group SAS, or measure on target devices/Tor. It produces a *signal*,
not a system.

---

## 6. Philosophical analysis — does this ask VOID to inhabit a different landscape?

"Different landscape" is too impressionistic to decide on. Instead we audit
each of VOID's **load-bearing public claims** against an *optional,
zero-knowledge, self-hostable SFU* and tag each: **survives**, **bends** (true
only with an explicit caveat), or **breaks** (the claim must be changed,
qualified, or retired).

| # | Load-bearing claim | Verdict | Why |
| - | ------------------ | ------- | --- |
| 1 | **No server in the media path** | **BREAKS** | An SFU is, by definition, a server in the media path. SFrame keeps it from seeing *content*, but "encrypted forwarding ≠ media custody" is a *lawyer's* distinction, not the *user's* mental model. The plain claim VOID makes today ("the server relays setup, then steps out of the media path") becomes false for SFU rooms. This is a **marketing change, not a feature toggle.** |
| 2 | **Server-minimized / single blind relay** | **BENDS** | Today there is one server (signaling) with a small, bounded role. An SFU is a *second* server with a *different, larger* trust profile (in the media path, for the whole call). Even optional, it dilutes the architectural simplicity reviewers and users value. Caveat-able ("only if you opt into a large room on a relay you host"), not free. |
| 3 | **Self-hostable / sovereign** | **BENDS (and cuts both ways)** | Self-hosting today is a signaling server + optional TURN. An SFU adds real media infrastructure (CPU, bandwidth, ops) to be sovereign. This *raises the bar for who can realistically self-host* — which slightly betrays "sovereign" while *technically* preserving it. The middle path's whole bet is that "someone you trust hosts it" is good enough; that bet is the crux. |
| 4 | **Bearer-like access, no durable account layer** | **BENDS** | Group-key rekey on join/leave introduces *membership state* the room must track over its lifetime (who holds which key generation). It is ephemeral (dies with the room) and not an account — but it is *identity-adjacent group state* that mesh's per-pair model never needed. Defensible, but new. |
| 5 | **A temporary utility, not a permanent intermediary** | **BENDS toward BREAKS** | An SFU is *durable shared infrastructure with media-flow visibility*. Even forwarding only ciphertext, it sits in every call for its full duration and sees who-speaks-when (§7). That is closer to "permanent intermediary" than "temporary utility." For an *operator-hosted* relay this is the sharpest tension with VOID's ethos. |
| 6 | **BURN destroys the room** | **SURVIVES (with diligence)** | BURN (`useRoomTeardown.ts`, `burnTeardown.ts`) destroys client/room state. An SFU is soft-state (forwarding buffers, no media at rest if built correctly), so BURN can extend to "tell the SFU to drop the room." Survives *if* the SFU is built stateless-by-design and BURN is wired to it — a requirement, not a freebie. |

**Reading the scorecard:** one claim **breaks**, four **bend**, one **survives
with work**. A claim that breaks is, in VOID's own brutally-honest register
(see the "WHAT VOID WON'T FIX" list in `docs/marketing-claims-audit.md`), a
*positioning change* — the kind of thing VOID has historically refused to
paper over. That is the real price of an SFU, and it is paid in trust, not
engineering hours.

---

## 7. The metadata surface, enumerated

The most important honest accounting. **What does an SFU see that today's
signaling relay does not?**

**Today (signaling relay only):** per `docs/threat-model.md` §1, the server
sees source IPs and TLS metadata *during room setup and ongoing socket
traffic*, plus a small amount of signaling. Critically, **after WebRTC
negotiates, media bypasses the server entirely.** The observable surface is
small and bounded in *time* (setup + light signaling) and in *content* (no
media path at all).

**With an SFU in the media path, the relay additionally learns:**

| Surface | Signaling relay today | SFU |
| ------- | --------------------- | --- |
| **(a) Participant IPs** | At setup + light ongoing socket | **For the entire call duration**, continuously, for every participant |
| **(b) Active-speaker timing** | Not visible | **Visible** — to do active-speaker forwarding the SFU must know who is speaking when; this is a behavioral/biometric-adjacent signal over the whole call |
| **(c) Bandwidth / traffic shape** | Light socket traffic only | **Full per-stream bitrate patterns** — talk/silence rhythm, who's on video, screen-share events |
| **(d) Routing topology** | Room membership at setup | **Live who-forwards-to-whom graph** for the call's lifetime |
| **(e) Room shape over time** | Participant count at join/leave | **Continuous** size, churn, duration, simulcast layer activity |

This is **meaningfully more than today**, and it is more in the dimension VOID
cares about most: it is *continuous*, *whole-call*, and includes
*active-speaker timing* — a signal useful for traffic analysis and
de-anonymization that the mesh design simply does not expose to any server.
SFrame protects *content*; it does **nothing** for (a)–(e). The increase is
real and should be stated in exactly these terms to users, not waved at as
"but it's encrypted."

---

## 8. User-population check — who actually benefits from rooms past four?

The third leg of the stool: even if we *can* build it and *can* align it, does
it serve **who VOID is for**? VOID's own copy is explicit (`DocsLimitsPage.tsx`):
*"VOID is for short conversations between a few people who would rather not
leave a record,"* and the "VOID IS NOT FOR" list explicitly names *50-person
webinars, recorded meetings, persistent team chat, breakout rooms, attendance
reports.*

Enumerating the use cases a 5–32 ceiling unlocks:

| Use case unlocked by higher ceiling | Audience fit |
| ----------------------------------- | ------------ |
| Larger team meetings | **Pulls toward "worse Zoom"** — explicitly on the NOT-FOR list |
| Webinar / broadcast events | **Pulls away** — explicitly refused |
| Larger social gatherings (friends, family) | **Possibly aligned** — still "people who'd rather not leave a record" |
| Small-org activist / organizing coordination | **Aligned** — arguably the strongest case; 4 is genuinely limiting here |
| Bitcoin / Nostr community calls | **Possibly aligned** — fits the sovereign/privacy audience VOID courts |

**The risk:** a higher ceiling that *primarily* enables the uses VOID has
structurally refused (webinars, big team meetings) is **worse than no higher
ceiling**, because it changes *what VOID is* without serving *who VOID is for*.
The genuinely audience-aligned cases (activist coordination, privacy-community
calls) are real but narrower — and they are precisely the cases that most need
the **Tor experience to hold up**, which §3.1 flags as the weakest part of the
SFU story. The populations who most want past-four are the ones the SFU serves
*worst*.

---

## 9. The paths

### Path A — Stay mesh (do nothing to topology)

Keep the 4-cap. Continue to defend it in copy as a deliberate design choice
(as VOID already does).

- **Pros:** zero new metadata surface; all six load-bearing claims stay
  intact; no second server; Tor story unchanged; no group-key lifecycle risk;
  fully consistent with current launch posture and the "WON'T FIX in v0.5"
  list.
- **Cons:** activist-coordination and community-call audiences stay capped at
  4; VOID forgoes a real (if narrow) aligned use case.
- **Realistic ceiling:** **4** (today), maybe 5–6 if audio-only or with
  aggressive mesh tuning, at quality cost.

### Path B — Optional, self-hostable, zero-knowledge SFU (the middle path)

Mesh stays the **default** for small rooms. Past ~5 participants a room can
*opt into* an SFU — ideally one the host or someone they trust **self-hosts** —
with SFrame so the relay is zero-knowledge. Purists keep small mesh rooms;
larger rooms accept a relay they control.

- **Pros:** preserves small-room purity; unlocks 20–32 for the aligned cases;
  "you host the relay" keeps sovereignty *technically* intact; crypto is proven
  viable (§5).
- **Cons:** claim #1 **breaks** and #2–#5 **bend** (§6); a real new metadata
  surface (§7); the Tor experience degrades (§3.1); group-key lifecycle is
  weeks of careful protocol + audit work (§4); raises the self-hosting bar
  (§3, claim #3); and it serves the past-four audiences *worst* on Tor (§8).
- **Realistic ceilings:**

| Configuration | Realistic usable ceiling |
| ------------- | ------------------------ |
| Mesh only (today) | **4** (5–6 audio-only) |
| SFU + SFrame, no simulcast | ~**8–10** (decode of many full streams bites) |
| SFU + SFrame + simulcast/SVC + active-speaker | ~**20–32** (the FaceTime regime) |

### Path C (named, not recommended) — non-zero-knowledge SFU

A plain SFU without SFrame. **Rejected outright**: it puts plaintext media on a
server. Incompatible with VOID at the level of identity. Listed only so the
record shows it was considered and refused.

---

## 10. Recommendation

**Adopt Path A (stay mesh) for the current launch window. Keep Path B (optional
self-hostable SFU) on file as a deferred, post-launch decision — not a backlog
commitment.**

**Why:** the engineering is feasible and the crypto is proven (§5), so this is
*not* a "we can't" recommendation. It is a "the cost is paid in identity, and
now is the wrong time to pay it" recommendation:

- One load-bearing claim **breaks** and four **bend** (§6); VOID's whole brand
  is *not* papering over claims like that.
- The new metadata surface is real, continuous, and whole-call (§7) — the
  opposite of the bounded surface VOID advertises.
- The audiences who most want past-four (activists, privacy communities) are
  the ones the SFU serves *worst*, because of the Tor degradation (§3.1, §8).
- VOID is pre-/early-launch with a small team and no commissioned external
  audit yet (`docs/threat-model.md` §0). Adding a second server class and a
  novel group-key protocol *now* multiplies the audit and ops surface at the
  worst possible moment.

A research spike that concludes **"interesting, but not now — revisit once
launch is well behind us and we have operational maturity"** is a legitimate
and, here, the correct outcome. Defer; don't delete the idea.

---

## 11. Scoping-ready summary (lift this into a follow-up task)

If a future maintainer reads only this section, it should be enough to decide
whether to file the implementation task and how to scope it.

- **Recommended path:** *Stay mesh now; defer the optional self-hostable SFU.*
  Re-open only when (a) launch is behind us, (b) there is concrete
  audience-aligned demand for 5–32 (activist/community, not webinar), and (c)
  an external audit budget exists.
- **If Path B is ever taken, the 5 highest-risk items (in order):**
  1. **Group-key lifecycle** — rotation on join/leave, forward-secrecy policy,
     and an explicit PCS decision (sender-keys vs. MLS/RFC 9420). The protocol,
     not the crypto, is the risk.
  2. **Group SAS** — a human-verifiable authentication story for >2 people; the
     pairwise 2-word SAS does not scale to 496 pairs.
  3. **Zero-knowledge SFU build + BURN integration** — stateless-by-design,
     no media at rest, BURN must reach it (claim #6).
  4. **Tor experience** — must hold up on a circuit (latency/jitter forwarding,
     onion-vs-clearnet anchor); treat as a gate, not a checkbox.
  5. **Simulcast/SVC + SFrame layer-awareness** — so relay-side layer dropping
     doesn't break decryption; required for the 20–32 regime.
- **Marketing/positioning claims that must change first** (from §6): rewrite
  claim #1 ("no server in the media path") — it *breaks*; add explicit caveats
  to #2–#5; document the new metadata surface (§7) in the same brutally-honest
  register as the existing "WON'T FIX" list.
- **Tor constraints that must be honored:** real-time forwarding must survive
  Tor latency/jitter; the SFU must not become a clearnet anchor in a Tor user's
  call path; bandwidth budget must stay viable for constrained users.
- **Participant ceiling realistically unlocked:** ~**20–32** with the full
  stack (SFU + SFrame + simulcast/active-speaker); ~8–10 without simulcast;
  **4** if we stay mesh.
- **Disposable artifact to delete:** `docs/research/scaling-poc/` once this
  document is accepted.
