# Marketing Claims Audit

**Status:** living document. Updated when marketing copy changes or when the
technical truth changes. The two must not drift.

<!-- last-reviewed: 2026-07-03 -->
**Last reviewed:** `2026-07-03` (ISO 8601). This date is the anchor used by the
recurring marketing-audit process to scope "what changed since the last audit."
When a new audit pass closes, update both the HTML comment marker above and the
date on this line, and record the pass below.

Most recent pass: Task #1084 (2026-07-03) — bumped the product version label
from `OPEN BETA · v0.5` to `OPEN BETA · v0.6` across all user-facing surfaces,
and corrected the "stateless" marketing claim to the accurate "no accounts and
no room content stored" / "ephemeral" wording. Literal statelessness is an
overclaim narrower than the truth: the server keeps a minimal paid-room metadata
snapshot across restart (never room content) — see `VOID_TECHNICAL_OVERVIEW.md`
§3.5. See the "Version label" and "Why page" sections below.
Prior pass: Task #803 (2026-06-05) — WATCH-row re-walk. Re-verified every
WATCH-status claim against current shipped copy; all grades held (no escalation,
no relabel). See the "Audit pass log" section below for the per-row outcomes.
Prior pass: Task #323 — added the v0.5 / open beta version label across landing,
install prompt, threat-model header, and why pages; see the "Version label"
section below for that claim ledger entry.

**Source-of-truth docs (canonical):**
- `VOID_TECHNICAL_OVERVIEW.md` — what the system actually does
- `docs/threat-model.md` — what the system protects you from and what it does not
- `docs/security-audit-public-2026-04.md` — the canonical security audit findings
- `docs/security-audit-public-2026-04.md` — published copy of the same audit
  with status annotations next to each H/M finding
- `lib/wire-core/src/argon2.ts` — canonical room-key derivation primitive
  (Argon2id, m=64 MiB, t=3, p=1, fixed 32-byte salt). The Argon2id parameters
  now live solely in this module, so it is the single source of truth for the
  derivation.

**Pages audited:**
- `artifacts/void-client/src/pages/LandingPage.tsx`
- `artifacts/void-client/src/pages/WhyPage.tsx`
- `artifacts/void-client/src/pages/ComparePage.tsx`
- `artifacts/void-client/src/pages/BiometricPage.tsx`
- `artifacts/void-client/src/pages/PricingPage.tsx`
- `artifacts/void-client/src/pages/ThreatModelPage.tsx`
- `artifacts/void-client/src/pages/AuditPage.tsx`
- `artifacts/void-client/src/pages/LimitsPage.tsx` (no drift found)
- `artifacts/void-client/src/pages/StartScreen.tsx` (added Task #250 — see "Start screen" section below for the first-paste clipboard-readability toast; Task #262 — Tor-wallet prompt above the HOST button, see "Start screen" section below)

The remaining marketing copy lives inside the room UI (`RoomPage.tsx`,
`PreviewGate.tsx`, etc.) and is descriptive of in-room state rather than
making product-level claims; it is out of scope for this audit until those
copies make new product claims.

---

## What this document is

A row-per-claim ledger. For each material claim VOID makes on a marketing
page, this records:

- **Claim** — the user-facing wording (or its compressed essence).
- **Page** — where the claim is rendered.
- **Source** — which canonical doc authorises it (or which audit finding
  qualifies it).
- **Status** — `OK`, `TIGHTENED`, or `WATCH`.
- **Note** — what we changed, or what we are watching.

`OK` means the canonical docs back the claim verbatim and the wording does
not need a caveat. `TIGHTENED` means the wording was edited in this pass to
close a drift. `WATCH` means the claim is correct today but is the kind of
claim that drifts the moment a feature changes; the next person to touch
that feature has to re-check this row.

---

## The six drifts this pass closes

These are the categories of overclaim that the audit specifically targeted.
Every `TIGHTENED` row below traces back to one of them.

1. **"No persistent server-side state" overstated as "no logs / no traces".**
   The server sees room codes, peer IDs, IP addresses, packet timing, and
   join/leave timestamps for the lifetime of a room. It does not retain
   that record durably (no DB, no transcripts, no recordings), but the
   in-flight metadata is observable. Source: `docs/threat-model.md`
   §"WHAT THE SERVER SEES" and `ThreatModelPage` item §1
   (audit §2.1). Code: `artifacts/api-server/src/lib/clientIp.ts`,
   `artifacts/api-server/src/routes/paywall.ts:176`.

2. **Biometric masking treated as uniform across modes.** The six video
   modes and five voice modes are not equivalent. CONTOUR and ASCII strip
   the most biometric utility; GOLD/PIXEL/SILHOUETTE reduce without
   erasing; CLEAR transmits the face unmodified. VOICE is a passthrough
   that preserves the voiceprint. Source: per-mode "What it preserves /
   What it destroys" tables on `BiometricPage`.

3. **Ephemerality presented as if it prevents recording.** End-of-room
   destruction protects against future server-side disclosure of stored
   media. It does not protect against a participant pointing a second
   device at their screen, against a screen recorder running on the same
   device, or against malware on a compromised device. Source:
   `BiometricPage` "WHAT THIS DOES NOT DO".

4. **Self-hosting framed as a binary.** Running the relay on your own
   hardware closes the relay's metadata surface against us, but most
   self-hosters still use someone else's Lightning node, so the Lightning
   correlation surface stays where it was. Tor routing further reduces
   network metadata. Self-hosting is a gradient, not a switch. Source:
   `ThreatModelPage` item §2 (audit §10.2, finding M-04).

5. **Undefendable superlatives.** "Each one removes…" applied to all six
   video modes when one (CLEAR) does not. "It does not know who you are"
   said of a server that observes IP addresses. "The only proof a room
   ever existed is the memory of the people who were in it" said of a
   system that emits a Lightning payment and serves IP-bound rate limits.

6. **Stale cryptographic-primitive names.** The room key derivation was
   migrated from PBKDF2-SHA256 (600,000 iterations) to Argon2id (m=64 MiB,
   t=3, p=1) in lib/wire-core. The migration landed in
   `lib/wire-core/src/argon2.ts` — now the single source of truth for the
   derivation parameters — but did not propagate to the marketing pages,
   which still named PBKDF2. Rows below carry the rename for `WhyPage` and
   `ThreatModelPage`. `VOID_TECHNICAL_OVERVIEW.md` §3.3 was tracked on the
   WATCH list at the time of the Task #211 audit pass and was subsequently
   reconciled in Task #237: §3.3, §3.5, §9.4, the §10 security table, and
   the §11 file index now name Argon2id with the canonical `m=64 MiB`,
   `t=3`, `p=1`, fixed-32-byte-salt parameters from `argon2.ts`.

---

## Claim ledger

### Landing page — `LandingPage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| `No accounts.` | `VOID_TECHNICAL_OVERVIEW.md` §"Identity-free architecture" | OK | No account system exists, anywhere. |
| `No sign-ups.` | Same | OK | |
| `No transcripts.` | Tech overview §"Ephemeral by design" | OK | No transcript code path exists. |
| `No AI summaries.` | Same | OK | |
| ~~`No logs.`~~ → `No call logs.` | Threat model §"WHAT THE SERVER SEES" | TIGHTENED | Drift #1. Server emits operational logs (rate-limit denials, IP-bound throttles, paywall events). It keeps no log of what was said. Tightened to "no call logs." |
| `No downloads.` | Tech overview §"Ephemeral by design" | OK | No file-download surface exists in-room. |
| ~~`No traces.`~~ → `No record of what was said.` | Threat model item §1, §2 | TIGHTENED | Drift #1, #5. Lightning payments leave a network trace; URL fragment leaves a browser-history trace until M-03 ships; IPs are observable to the relay. The room contents leave no record. Tightened to that narrower claim. |
| `1,000 sats per room` | Tech overview §"Lightning paywall" | OK | Matches `PRICING_SATS=1000` default. |
| `Bypass the app store. Zero tracking.` (PWA install) | PWA serves directly from the void-client artifact; no third-party analytics in the manifest | OK | Verified no analytics SDK is loaded. |
| Hero image alt text — ~~"There will be no log of who was in it."~~ → "There will be no archive of what was said." | Threat model §"WHAT THE SERVER SEES" | TIGHTENED | Drift #1. The relay does observe who connected (IPs, peer IDs, timing) while a room is live. The scoped claim — no archive of content — is accurate. |

### Why page — `WhyPage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| ~~`Stateless, encrypted, peer-to-peer.`~~ → reworded to `ephemeral, encrypted, peer-to-peer` (HowItWorksPage / DocsHowItWorksPage). | Tech overview §"Architecture"; §3.5 | TIGHTENED | Task #1084. "Stateless" overclaims — the server keeps a minimal paid-room metadata snapshot across restart (never room content, §3.5). "Ephemeral" is the accurate, defensible adjective and is the word the canonical overview §1 uses. |
| ~~"There are no accounts, and there are no logs. There are no records of who spoke to whom, or when, or for how long…"~~ → narrowed to "no recording, no transcript, no record of what was said," with explicit acknowledgement that the relay sees IPs/room codes/timing while a room is live. | Threat model §"WHAT THE SERVER SEES"; audit §2.1 | TIGHTENED | Drift #1. The original sentence implied the relay had no record of who connected when. The relay does have an in-flight view of that. |
| Server cannot decrypt signaling; never receives media; PFS prevents past-session decryption. | Tech overview §"Signal envelopes & ECDHE"; threat model item §4 | OK | Architectural; provable from code. |
| BIP-39 six-word phrase carries ~66 bits of entropy. | `voidPhrase.ts`; tech overview §"VOID Phrase" | OK | |
| ~~"PBKDF2, with 600,000 iterations"~~ → "Argon2id — a memory-hard function that requires 64 megabytes of RAM and three sequential passes per attempt." Plus the in-page ASCII diagram boxes updated from `PBKDF2 / 600,000 iter` to `ARGON2ID / 64 MIB / 3 PASS`. | `lib/wire-core/src/argon2.ts` (`ARGON2ID_ROOM_PARAMS`); `voidPhrase.ts:2098` (`deriveRoomBytesArgon2id`) | TIGHTENED | Drift #6. The phrase KDF was migrated to Argon2id; the marketing page still named the previous primitive. Both the prose and the diagram now name Argon2id and its memory/time cost. The downstream paragraph about HKDF domain separation producing `VOID-ECDHE-v1` and `VOID-SAS-v1` was left as written — those keys are derived in the ECDHE step that runs over the phrase-keyed channel, and the page already says "from this" in a way that reads as the broader pipeline rather than a direct claim about Argon2id output. Watching this row in case the wording stops working in a future copy edit. |
| Phrase travels in the URL fragment and is not transmitted. | Tech overview §"VOID Phrase URL fragment" | OK | The local-actor surface (browser history, shoulder-access) is named directly on the threat model page, item §3. |
| ~~"Six modes are available. Each one removes something a surveillance system would find scrumptious."~~ → "Five of them remove something… The sixth — CLEAR — does not." Plus an explicit mode-strength paragraph after the list. | Per-mode tables on `BiometricPage` | TIGHTENED | Drift #2, #5. CLEAR transmits the face. Mode strength is now stated rather than implied. |
| Five voice modes — added a closing "A note on strength" paragraph stating VOICE is passthrough and the others progressively remove voiceprint. | Per-mode tables on `BiometricPage` | TIGHTENED | Drift #2. |
| ~~"It does not know who you are. It cannot know what you said."~~ → narrowed: cannot decrypt, never receives media, does see IP/room code/timing. | Threat model §"WHAT THE SERVER SEES" | TIGHTENED | Drift #1, #5. |
| ~~"After the room closes, even that fades from memory."~~ → "After the room closes, the relay's in-memory room state is gone. Network-layer traces (IP logs at routing nodes, Lightning payment records) are outside the relay's control and may persist elsewhere." | Tech overview §3.5 "Timing constants"; threat model §"WHAT THE SERVER SEES" | TIGHTENED | The original read as if all observability disappears on room close. Scoped explicitly to relay-side in-memory state; network-layer and Lightning traces are called out as outside relay control. |
| L402 paywall, "no name, no account, no face attached. The sats move, and the door opens." | Tech overview §"Lightning paywall"; threat model item §2 | OK | Lightning correlation surface acknowledged on the threat model page. |
| ~~"The only proof a room ever existed is the memory of the people who were in it."~~ → narrower: contents are gone; shape (connection timing, IPs, the Lightning payment) was observable while live and is documented. | Threat model item §1, item §2 | TIGHTENED | Drift #1, #3, #5. The previous wording read as if no observation was possible at all. |
| Per-call ephemeral keys; PFS for past sessions. | `signalCrypto.ts`; tech overview §"Forward secrecy" | OK | |

### Compare page — `ComparePage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| Comparison table values for VOID. | Tech overview §"Architecture", §"Lightning paywall", §"4-peer cap" | OK | |
| `BIOMETRIC MASKING BUILT IN: YES` | Tech overview §"Local masking" | OK | The cell is true: VOID ships built-in local masking. The footnote on the table now states explicitly that the strength is mode-dependent and points to the biometric page. |
| ~~"the whole product is built on the premise that you cannot [record]"~~ → "VOID cannot prevent a participant from pointing a second device at their screen — no software can. What VOID does not do is provide the infrastructure for it." | `BiometricPage` §"WHAT THIS DOES NOT DO"; this audit drift #3 | TIGHTENED | The original wording implied participants are architecturally prevented from recording. They are not. VOID does not provide a record button; it does not stop a second device. |
| `EPHEMERAL BY DEFAULT: YES` | Tech overview §"Ephemeral rooms" | OK | Footnote already qualifies what "ephemeral by default" means. |
| `MAX PARTICIPANTS: 4` | Tech overview §"Mesh topology" | OK | Hard cap, defended in copy. |
| `RECORDING / TRANSCRIPTS: NO` | Tech overview §"No recording surface" | OK | |
| Comparison table footnote — extended to add: "Biometric masking built in" means VOID ships local video and audio masking modes; the strength varies by mode and is detailed on the biometric page. | This audit, drift #2 | TIGHTENED | |
| Self-hostable: YES. | Repo is public; Node.js relay runs on commodity hardware. | OK | |
| `If your life depends on the call, talk to a security professional first. VOID has not been independently audited.` | This is already the honest disclaimer required by drift #5. | OK | |

### Biometric page — `BiometricPage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| ~~Hero subheading "VOID makes both of them useless."~~ → "In most modes, VOID makes both significantly harder to exploit. The strength depends on the mode you choose." | Tech overview §"Local masking"; drift #2 | TIGHTENED | Absolute claim incompatible with CLEAR (video passthrough) and VOICE (audio passthrough). Scoped to the accurate "most modes / strength depends on mode" framing. |
| All processing local (GPU shader, audio worklet on dedicated thread). | Tech overview §"Local masking pipeline" | OK | |
| Per-mode "What it preserves / What it destroys" tables. | Tech overview §"Video modes" / §"Voice modes" | OK | Already honest at the per-mode level. The drift was that the page never said it out loud at the section level. |
| New mode-strength paragraph added at the top of THE SIX VIDEO MODES, naming CONTOUR and ASCII as strongest, GOLD/PIXEL/SILHOUETTE as intermediate, CLEAR as none. | Per-mode tables, this page | TIGHTENED | Drift #2. |
| New mode-strength paragraph added at the top of THE FIVE VOICE MODES, naming VOICE as passthrough and COMBINED as strongest. | Per-mode tables, this page | TIGHTENED | Drift #2. |
| `WHAT THIS DOES NOT DO` — does not protect against screen recording, against a compromised device, does not reduce exposure to zero. | Threat model item §1; audit §10 | OK | Already named directly. Drift #3 is fully covered by this section. |
| `Reduced exposure, not anonymity.` | Tech overview §"Threat boundary"; threat model §"WHAT VOID DOES NOT PROTECT AGAINST" | OK | |

### Pricing page — `PricingPage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| Two tiers, one-shot, no subscription. | Tech overview §"Lightning paywall"; `paywall.ts` | OK | |
| 1,000 sats / 65 min and 5,000 sats / 24 hours. | Tech overview §"Pricing"; `paywall.ts` `PRICING_SATS` | OK | |
| `Server never sees your video or audio.` | Tech overview §"P2P media"; `webrtc.ts` | OK | Media is peer-to-peer; only TURN-relayed flows traverse the relay's outbound TURN, and even those are end-to-end encrypted. |
| ~~"Nobody learns anything about you except that someone had a few satoshis and wanted a room."~~ → "VOID does not learn who you are. Your Lightning node, routing nodes, and network-level metadata (IP, timing) are observable surfaces the payment crosses — the same ones named in the threat model." | Threat model §"WHAT THE SERVER SEES", §2 Lightning correlation | TIGHTENED | Drift #1, #5. The absolute "nobody learns anything" conflicts with routing-node observability and relay IP/timing metadata. Scoped to what VOID itself does not collect. |
| ~~`No logs. No recording. No summary.`~~ → `No call-content logs. No recording. No summary.` (in WHAT YOU GET list) | Tech overview §"Ephemeral by design"; threat model §"WHAT THE SERVER SEES" | TIGHTENED | Drift #1. "No logs" read as absolute. Scoped to "call-content logs" — no log of what was said, by whom, in what tone. Operational rate-limit and IP-based throttle state exists while the room is live. |
| ~~`Seven voice modes`~~ → `Five voice modes` (in WHAT YOU GET list) | Tech overview §"Voice modes"; `BiometricPage` §"THE FIVE VOICE MODES" | TIGHTENED | Concrete count was wrong. Five modes: VOICE, DEEP, FORMANT, SCRAMBLE, COMBINED. |
| ~~"If everyone leaves, the room is pruned from memory after three minutes — but the same phrase will recreate the same room until the absolute lifetime expires."~~ → "If everyone leaves, the room stays open — there is no empty-room prune timer." | Tech overview §3.5 "Timing constants"; `rooms.ts` `leave-room` handler | TIGHTENED | Architecturally false claim. The technical overview explicitly states there is intentionally no empty-room prune timer; the room persists for the full paid TTL whether or not anyone is connected. |
| Self-hosting section — added a sentence stating self-hosting is a gradient: most self-hosters do not also run their own Lightning node and that is normal. | Threat model item §2 (audit §10.2, M-04) | TIGHTENED | Drift #4. |
| `If we disappeared tomorrow… the tool would continue to work exactly as designed for anyone who chose to run it.` | Repo public; relay self-contained. | OK | True for the relay. The Lightning side requires a node — either ours, theirs, or a third party's. The new sentence makes that explicit. |

### Threat model page — `ThreatModelPage.tsx`

| Claim | Source | Status | Note |
|---|---|---|---|
| `WHAT THE SERVER SEES` — IPs, room codes, peer IDs, timing. | Threat model doc; `clientIp.ts`; `paywall.ts` | OK | This page is the primary truth surface; other pages link here. |
| ~~"Room IDs are 32 characters of lowercase hex derived from your VOID Phrase via PBKDF2 with 600,000 iterations."~~ → "…via Argon2id (64 MiB of memory, three sequential passes per attempt)." | `lib/wire-core/src/argon2.ts` | TIGHTENED | Drift #6. Same primitive rename as the WhyPage row above; the room-ID space (~3.4 × 10^38) and brute-force argument are unchanged because they depend on output length, not on which KDF produced the bytes. |
| `THE DUET` — SAS verification math, ~1 in 4 million collision. | `signalCrypto.ts` `VOID-SAS-v1` derivation; tech overview §"SAS" | OK | |
| `VOICE MASKING AND THE DUET` — voice masking degrades verbal SAS confirmation; verify before masking. | `BiometricPage` voice mode descriptions | OK | |
| `FOUR THINGS WORTH NAMING DIRECTLY` — server-observable metadata, Lightning observability, fragment local-actor surface, SAS as property of phrase encryption. | `docs/security-audit-public-2026-04.md` (audit findings M-03, M-04, §2.1, §10.1, §10.2, §10.3) | OK | Direct mirror of the audit; the most important drift-prevention surface in the whole product. |
| `A SHORTLIST OF WALLETS THAT ROUTE OVER TOR` (sub-section under FOUR THINGS WORTH NAMING DIRECTLY → item §2, anchor `id="tor-wallet-shortlist"` — the hyphenated form omits "routed" so the `banned-phrases.mjs` guard (whose lookahead exception requires whitespace, not a hyphen, before "wallet") does not flag the id; the user-facing heading still reads "WALLETS THAT ROUTE OVER TOR"). Three named options: **Zeus** (Android/iOS — bundles a Tor daemon and routes the node connection over Tor; source `https://docs.zeusln.com/category/tor`); **Phoenix** (Android — Tor mode in settings proxies wallet connections through Orbot, with an explicit "iOS does not currently expose this setting" caveat; source `https://phoenix.acinq.co/faq`); **BitBanana** (Android — open-source remote LND/CLN controller with documented Tor support via Orbot; source `https://github.com/michaelWuensch/BitBanana/wiki/Tor`). The list opens with a non-endorsement preamble ("we do not endorse a wallet… verify against the linked project docs before you install anything, because wallet behaviour changes faster than this page does") and closes with a paragraph naming two adjacent options that are not specific wallets but are correct Tor postures: a custodial wallet loaded in Tor Browser (you trade the operator's surface for the custodian's), and paying through your own Lightning node reachable via a hidden service (the strongest of these because it removes the operator-side correlation surface entirely). | The three named wallets each carry their own project's Tor documentation as the cited primary source — VOID is intentionally not the source of truth for whether a third-party wallet routes over Tor. The umbrella claim that paying from a Tor-routed wallet closes the operator-side IP-correlation surface comes from `docs/security-audit-public-2026-04.md` §6 limitations and §8 (already cited by the parent §2 paragraph and by the Start screen Tor-wallet prompt row below). | WATCH | New sub-section added in Task #271 to close the actionability gap on the room-creation form's Tor-wallet prompt: prior to this row the Tor-wallet prompt deep-linked only to `#lightning-ip-leak`, so the user landed on a paragraph that told them what surface to close but not which wallet to install. **Task #363 update:** the PaywallModal `onion-tor-wallet-hint` now carries a `See wallet options` micro-link (`data-testid="onion-tor-wallet-shortlist-link"`) that deep-links straight to `#tor-wallet-shortlist`, landing the host on this list in one click; the `/threat-model` short-form page client-redirects that anchor to `/docs/threat-model#tor-wallet-shortlist`. (Drift note for Task #363: the StartScreen Tor-wallet prompt referenced by the original task no longer exists — it was removed in the LandingPage merge and its coverage moved to PaywallModal, so PaywallModal is now the only Tor-wallet prompt and the only surface that needed the new link.) The list is **a snapshot, not an endorsement** — it is the kind of claim that drifts the moment a wallet ships a release that removes Tor support, drops a platform, or pivots its custody model. The next person to touch this section must re-verify each entry against the linked project doc before re-publishing; if a wallet has dropped Tor support, strike it from the list rather than soften the description. The non-endorsement preamble and the final "your own node over `.onion`" paragraph are both load-bearing register choices — VOID does not vouch for third-party Lightning wallets and does not pretend the wallet shortlist is the strongest available answer. The new anchor `id="tor-wallet-shortlist"` is internal-use today (not yet linked from elsewhere); leaving it stable lets a future copy point a more specific deep-link at it (e.g. a "see the wallet shortlist" link on the StartScreen prompt itself if reviewer feedback asks for it). The `Tor-routed wallet` and `Tor-routed node` phrasing here is the canonical use the `banned-phrases.mjs` lookahead is allowed for — see the Task #238 row below. Pointer note: this sub-section moved off the short `ThreatModelPage.tsx` in the Task #545 short-form / long-form IA split and now renders on the long-form `/docs/threat-model` page (`artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx`, `A SHORTLIST OF WALLETS THAT ROUTE OVER TOR` heading ~line 1698) with the wording carried over verbatim. **Pinned by `artifacts/void-client/src/__tests__/threatModelTorWalletShortlist.test.tsx` (Task #364)**: the test asserts the `#tor-wallet-shortlist` anchor and `tor-wallet-shortlist` data-testid still exist, that each named wallet (Zeus, Phoenix, BitBanana) still appears, and that each wallet's cited primary-source URL is still present (`https://docs.zeusln.com/category/tor`, `https://phoenix.acinq.co/faq`, `https://github.com/michaelWuensch/BitBanana/wiki/Tor`). It carries a loud failure message reminding the next contributor to re-verify each entry against its linked project doc (strike a wallet rather than soften its description if it has dropped Tor support) and to update THIS row in the same commit before re-running — so the ledger and the pin stay in lockstep. |
| `BROWSER-LEVEL SURFACES` — DNS lookups, clipboard, notifications, extension DOM access, WebRTC `getStats()`, managed-browser `getUserMedia` permission logging, with a directly-actionable user-side mitigation in each paragraph. | `docs/security-audit-public-2026-04.md` §R-10 / §11 item 11; `docs/threat-model.md` §6 (technical mirror). | TIGHTENED | New section added to address external reviewer feedback that the prior page acknowledged TLS-observer and metadata-correlation surfaces but was silent on adjacent browser-level surfaces a privacy-claiming web app inherits. None are VOID code defects; the mitigations are configuration choices on the user's end. The first-paste clipboard toast notification was explicitly considered and deferred as a separate code-level UX change rather than folded into this disclosure pass — that toast subsequently shipped in Task #250 (see the "Start screen" section below for its claim ledger row). The section header now carries `id="browser-level-surfaces"` so the toast's "READ MORE" link can deep-link straight to it; renaming or removing that id will break the toast's anchor link. The May 2026 audit's §11 limitations list now names these six surfaces in item 11 as the canonical documented-known-limitations register, pointing back at this section. Watching this row in case the marketing-voice register slips in a future copy edit (the per-item paragraphs lean technical and could become softer if a future editor "smooths" them — the mitigations are load-bearing and must remain blunt). |
| `WHAT VOID WON'T FIX IN v0.6` — published won't-fix list naming the 4-user room cap, the residual browser-fragment leak, signaling-server connection metadata, host-side Lightning route observability, screen recording by participants, media-path Tor coverage, and Mobile Safari's post-BURN indicator behaviour. Closes with the verbatim line "If your threat model requires any of the above, VOID v0.6 is not the right tool for you. We would rather lose your trust by being honest than earn it by being vague." | Task #319 brief; the launch checklist (#316) inverse-list reconcile clause; per-item sources: 4-user cap → tech overview §"Mesh topology"; fragment leak → audit §4.1, §R-9 (M-03 closed, residual local-actor surface); signaling metadata → threat model §"WHAT THE SERVER SEES"; Lightning observability → audit M-04 + Task #282 (random invoice memos); screen recording → `BiometricPage` §"WHAT THIS DOES NOT DO"; media-path Tor → Task #261 (`threatModelTorComposition.test.tsx`); Mobile Safari indicator → Task #280 (BURN section caveat) | TIGHTENED | New section pinned by `artifacts/void-client/src/__tests__/threatModelWontFix.test.tsx`. The section heading and the verbatim "screen recording by participants" paragraph are both pinned with a custom failure message that reminds the contributor to update **all three** sites (this ledger, the launch checklist, and the page) before re-running. The reconcile contract: every item on this won't-fix list has an inverse on the launch checklist — when something moves off won't-fix because we fixed it, it appears on the checklist; when something moves off the checklist because we deferred it, it appears here. Watching this row because the brutalist register on the section is exactly the kind of voice that gets "smoothed" in a future copy edit; the load-bearing words are "WON'T", "screen recording", and the closing sentence — those are the lines that, if softened, would turn the section into the marketing hand-wave it is meant to replace. |
| `THE HONEST SUMMARY → VOID is well-designed for: Preventing biometric capture at the network layer` → tightened to add `(strength varies by mode — see the biometric page)`. | This audit, drift #2 | TIGHTENED | |
| `THE HONEST SUMMARY → Providing ephemerality as an architectural guarantee rather than a policy promise` → tightened to `Providing ephemerality of server-side state as an architectural guarantee (does not prevent participants from recording locally)`. | This audit, drift #3; `BiometricPage` `WHAT THIS DOES NOT DO` | TIGHTENED | |
| `VOID is not designed for: Hiding the fact that a connection occurred` | Threat model §"WHAT THE SERVER SEES" | OK | |
| `VOID is not designed for: Protecting against a compromised device` | `BiometricPage` `WHAT THIS DOES NOT DO` | OK | |
| `VOID is not designed for: Protecting against a malicious participant in the room` | Threat model §"WHAT VOID DOES NOT PROTECT AGAINST" | OK | |
| `VOID is not designed for: Providing the level of assurance required for life-safety threat models` | Audit §"present-day claim is well-designed for the documented threat model and not vetted for life-safety use" | OK | |
| ~~OVER TOR OR A VPN section: "The VOID server sees only your exit IP… You move trust, not eliminate it… Your VPN provider sees what we used to see. The Tor network distributes the trust across volunteer relays… Privacy is layered."~~ → unified paragraph: **"Tor protects how you reach VOID's signaling layer. It does not protect the media path. WebRTC gathers connection candidates on your underlying network regardless of how this page loaded — so calls reached via `.onion` will still leak your clearnet IP to other peers unless relay-only is enabled, and even then will fall back to TURN relay with degraded latency. Tor was not designed for real-time media. If you need both peer-IP privacy and call quality, those are competing requirements; choose accordingly."** | May 2026 Tor-posture review (Task #261); WebRTC ICE behaviour (`webrtc.ts`). | TIGHTENED | The previous bullets framed Tor as a clean IP swap and never said the WebRTC media path leaks around it — the composition gap the reviewer flagged. Pinned verbatim by `artifacts/void-client/src/__tests__/threatModelTorComposition.test.tsx`. The companion `.onion` auto-default sentence specified in the task brief was intentionally **not** added to the page in this row: it would document a privacy default the client does not yet honour (PreviewGate still initialises `relayOnly` to `false`). The sentence lands together with the auto-relay-only-on-`.onion` implementation task; the regression test currently asserts the page does **not** contain "relay-only is enabled by default" so a future copy edit cannot re-introduce the unimplemented promise. The operator-side source for "you can host a `.onion` mirror" is the runbook at `docs/onion-mirror-runbook.md` (Task #270), which the unified Tor paragraph now points users to via the TOR AND THE MEDIA PATH section of `ThreatModelPage`. The `Tor-by-default StartOS` WATCH row below (and the network-metadata paragraph it tracks) is owned by Task #238 and is intentionally out of scope. The Lightning-over-Tor mentions (Lightning §, item §2) and the DNS-over-Tor mention (browser-level surfaces §1) describe Tor's role on different surfaces and are compatible with the unified paragraph; the network-metadata paragraph now carries an inline cross-reference back to TOR AND THE MEDIA PATH so the broader "you need Tor" wording on the page no longer reads in isolation. |

### Audit page — `AuditPage.tsx`

This page is the user-facing summary of `docs/security-audit-public-2026-04.md`
(published in Task #197). It is intentionally a near-verbatim restatement of the
published audit; drift would mean the page diverges from its own source
document, which is checked by reading the doc.

| Claim | Source | Status | Note |
|---|---|---|---|
| All eight High and Medium findings shipped before publication. | `docs/security-audit-public-2026-04.md` §0 status table; per-finding inline status badges. | OK | Each finding's mitigation is named on the page and points at the commit/ticket that closed it. |
| Audit was a static read by an internal reviewer; not an external adversarial assessment. | `docs/security-audit-public-2026-04.md` §11 limitations (preserved verbatim). | OK | The "starting point not a finish line" framing is the right honesty register. |
| Cryptographic primitives named: AES-GCM, ECDH P-384, argon2id, HKDF-SHA256. | `lib/wire-core/src/argon2.ts`; `signalCrypto.ts` | OK | Already names argon2id correctly — this page is the only marketing surface that tracked the primitive migration. The other surfaces are now aligned (see WhyPage and ThreatModelPage rows above). |
| Static read could miss runtime/CDN/reverse-proxy misconfiguration; no fuzzing or red-team performed; no external adversarial audit commissioned. | `docs/security-audit-public-2026-04.md` §11 limitations | OK | Stated as "the right next step" rather than as a closed item; this is the correct framing. As of 2026-05-02 the external audit is tracked as Task #247 with a written scope of work; the user-facing copy on `AuditPage.tsx` ("has not been commissioned") and on `ThreatModelPage.tsx` ("we have not commissioned the second yet") remains accurate because the engagement has not been signed. The next person to touch either page must not promote those lines to "commissioned" or "audit underway" until the engagement letter is signed and the commissioned date is recorded in the audit-doc preambles — see WATCH list below. |

### Start screen — `StartScreen.tsx`

The start screen is mostly UI chrome (HOST / JOIN / SCAN / RECOVER buttons,
the BIP-39 input grid, transient session notices) and was historically
out of audit scope because none of its strings made product-level claims.
Task #250 added the first user-facing security-disclosure copy on this
page — the one-time clipboard-readability toast that fires when a user
pastes a phrase into the join grid for the first time per browser. That
copy is mirrored from the canonical wording on `ThreatModelPage.tsx` →
"BROWSER-LEVEL SURFACES → 2. THE CLIPBOARD IS READABLE BY EXTENSIONS"
(this audit file's row above), so the two surfaces have to be edited
together if the underlying claim ever shifts.

| Claim | Source | Status | Note |
|---|---|---|---|
| Tor-wallet info row above the HOST button — "Paying from a Tor-routed wallet hides your IP from the operator's Lightning node. Continue from a regular wallet?" with a `READ MORE` deep-link to `/threat-model#lightning-ip-leak` and a single `DISMISS` button. The row is dismissible per session: a `sessionStorage` flag under key `void:tor-wallet-prompt-dismissed` is set on dismiss and read at mount, so a returning operator on the same tab does not see it again, while a fresh tab gets the prompt back (the choice of wallet is per-session, so the reminder is too). The row is informational only — it does not block room creation and does not gate the HOST button. It does not appear on the JOIN flow, the RECOVERY flow, or inside `PaywallModal` (the BOLT11 invoice screen). Placement decision: the original Tor-posture conversation suggested putting the prompt next to the BOLT11 invoice; the reviewer corrected that — by the time the invoice renders, the host has already opened a wallet and committed to paying from it, so a prompt at that point is informational at best and does not change behaviour. The prompt belongs on the room-creation form, before the invoice is generated, where the host can still choose which wallet to open. The placement is locked by two regression tests: `StartScreen.test.tsx` "Tor-wallet prompt" describe block asserts the row appears above the HOST button and is absent from the JOIN/RECOVERY flows, and `PaywallModal.test.tsx` asserts the row is absent from the invoice screen and that no contradictory wallet-choice prompt is rendered there. | `ThreatModelPage.tsx` "FOUR THINGS WORTH NAMING DIRECTLY → 2. THE LIGHTNING PAYMENT IS OBSERVABLE ON THE LIGHTNING NETWORK" (anchor `id="lightning-ip-leak"`); `docs/security-audit-public-2026-04.md` §6 limitations and §8 (Lightning operator IP exposure). | OK | New code-level UX surface added in Task #262. The toast is purely informational — it does not change cryptography or the create-room flow, only the user-facing disclosure. The deep-link target is the `id="lightning-ip-leak"` anchor on `ThreatModelPage.tsx` (sibling pattern to the Task #250 `id="browser-level-surfaces"` anchor); renaming or removing that id breaks this row's `READ MORE` link, which is why the regression test asserts the href substring rather than just the link's presence. WATCH this row in case a future copy edit softens the wording — both the named threat (operator's Lightning node sees the payer's IP if the wallet isn't Tor-routed) and the user-side mitigation (choose a Tor-routed wallet before continuing) are load-bearing and must remain plain. |
| First-paste clipboard toast — "What you just pasted lives on the system clipboard. Any browser extension installed with the `clipboardRead` permission can read it. To mitigate, copy a neutral character over the clipboard, or use a clean browser profile with no extensions installed." With a `READ MORE` deep-link to `/threat-model#browser-level-surfaces` and a single `DISMISS` button. The toast is strictly one-time per browser: a `localStorage` flag under key `void:clipboard-warning-shown` is set synchronously the first time the toast renders, and on every subsequent paste that flag is checked first and the toast is suppressed. | `ThreatModelPage.tsx` "BROWSER-LEVEL SURFACES → 2. THE CLIPBOARD IS READABLE BY EXTENSIONS"; `docs/threat-model.md` §6.2 (technical mirror); `docs/security-audit-public-2026-04.md` §R-10 / §11 item 11. | OK | New code-level UX surface added in Task #250. The toast is purely informational — it does not change the cryptography or the join flow, only the user-facing disclosure. The wording is a compressed mirror of the threat-model page's clipboard paragraph (same surface named, same mitigation, same plain register); the toast is shorter because it is contextual to the action just taken. WATCH this row in case a future copy edit softens the wording — the surface and the mitigation are both load-bearing and must remain plain. The toast fires only on multi-word pastes (`Bip39PhraseGrid.handlePaste`'s existing distribute path), and only on the join phrase grid — not on the recovery-code grid, which is a separate UX surface and was deliberately scoped out of Task #250. One-time-per-browser is enforced by writing the `void:clipboard-warning-shown` flag *before* the toast renders so even an immediate refresh cannot cause a second auto-display; the `DISMISS` button only closes the in-memory toast (the suppression has already been persisted). The deep-link target is the `id="browser-level-surfaces"` anchor on `ThreatModelPage.tsx`; that anchor is documented in the `BROWSER-LEVEL SURFACES` row above as load-bearing for this toast. |

### Version label — `LandingPage.tsx`, `ThreatModelPage.tsx`, `WhyPage.tsx` (Task #323)

Until Task #323, no version label existed anywhere on the user-facing
surface. Reviewer #13 + #4 pushed for shipping the first public release
as **OPEN BETA · v0.5** rather than 1.0 so that the first 90 days of bugs
are read as "early and honest" rather than as a referendum on whether
the product should have shipped at all. Task #323 added the label to the
landing-page hero, the PWA install prompt, the threat-model page header
(consistent with the won't-fix section's existing v0.5 references from
Task #319), and a one-sentence acknowledgement on the why page. The
**protocol-version identifiers (`VOID-ECDHE-v1`, `VOID-SAS-v1`,
`VOID-INVITE-v1`) are NOT touched** — those are frozen wire contracts in
`lib/wire-core/` and the rows above continue to reference them
verbatim. The product version is now v0.6 (bumped from v0.5 in Task #1084); the
protocol version stays v1.

| Claim | Source | Status | Note |
|---|---|---|---|
| Landing page carries the verbatim badge `OPEN BETA · v0.6` near the V[]ID hero. | Task #323 brief; the launch checklist top-of-file version-label field; `ThreatModelPage` won't-fix section heading (Task #319). | OK | Truth-claim: this is the first publicly-supported release; we expect to find bugs in the first 90 days; we are committed to fixing them publicly. Pinned by `artifacts/void-client/src/__tests__/v05OpenBetaLabel.test.tsx` with a loud failure message: *"If you are renaming v0.5 to v0.6 / v1.0, update the internal launch checklist, the threat-model won't-fix section, and the marketing-claims-audit ledger together."* The PWA install prompt carries the same `(OPEN BETA · v0.6)` label so installed-app users see consistent framing. Cross-link: the launch checklist (#316), `ThreatModelPage` won't-fix (#319). |
| ThreatModelPage header carries a one-line v0.6 acknowledgement matching the landing-page label. | Same. | OK | Tone match: the existing won't-fix paragraph from #319 is the reference voice. The won't-fix section heading already says "WHAT VOID WON'T FIX IN v0.6" — this header line keeps the framing consistent for first-time readers who land directly on the page. Pinned by the same regression test. |
| WhyPage carries the standardized one-sentence acknowledgement: *"This is OPEN BETA · v0.6 — We expect to find bugs for a while."* | Same; Task #565 standardized the sentence across the WhyPage, ThreatModelPage header, Docs → How It Works, and Docs → Threat Model pages. | OK | Single sentence, not a banner. The same verbatim sentence is now rendered on all four pages so the open-beta framing reads identically wherever a user lands. Pinned by the same regression test (which asserts the OPEN BETA / v0.6 tokens, satisfied by the new sentence). |

### WATCH list — claims correct today, but adjacent to active drift

| Claim | Where | Why it's a WATCH |
|---|---|---|
| `Docs → How It Works` "From this, HKDF domain separation produces two distinct keys: VOID-ECDHE-v1, VOID-SAS-v1." | `artifacts/void-client/src/pages/docs/DocsHowItWorksPage.tsx` ENCRYPTION section (~line 382) + `artifacts/void-client/src/components/short-form/KeyDerivationDiagram.tsx`. (Moved off `WhyPage.tsx` in the Task #545 short-form / long-form IA split; wording carried over verbatim.) | Strictly speaking, those two keys are derived from the ECDHE shared secret, not from the Argon2id output of the phrase. The page reads this as a pipeline summary ("from this") and the claim is not false at a flow level — the phrase bootstraps the channel inside which ECDHE happens — but the wording is one copy edit away from becoming inaccurate. If a future edit drops the "from this" framing in favour of something more direct, this row needs to be re-examined and either tightened or relabelled. |
| ~~`ThreatModelPage` "Self-hosting on StartOS routes traffic through Tor by default. Use it if this matters to you."~~ **Tightened 2026-05-03 (Task #238).** Page now reads: "The StartOS and Umbrel packages are `.onion`-reachable — they can advertise a Tor hidden-service address that reaches the signaling layer — but they are not *Tor-routed end-to-end*: the WebRTC media path still gathers ICE candidates on your underlying network regardless of how the page loaded." | `artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx` "Network metadata" paragraph (~line 1028). (Moved off the short `ThreatModelPage.tsx` in the Task #545 IA split; the `.onion`-reachable + media-path copy now lives only on the long-form `/docs/threat-model` page.) | ~~Forward-looking distribution claim that StartOS routed through Tor by default; no in-tree code proved that behaviour and the manifest in fact advertises both `tor-config` and `lan-config` interfaces side-by-side.~~ **Closed (Task #238):** the claim is replaced everywhere — `ThreatModelPage.tsx`, `manifest.yaml` interfaces comment, `umbrel-app.yml` releaseNotes, `README-selfhost.md` §6c — with `.onion`-reachable plus a media-path caveat. A regression rule in `artifacts/void-client/scripts/banned-phrases.mjs` now flags any reintroduction of "Tor-by-default" or "Tor-routed" in the scanned scope (pages, og-routes, index.html); legitimate user-facing recommendations about a "Tor-routed wallet" or "Tor-routed node" are excluded by lookahead. The matching strikethrough lands in §11 limitation 9 of both audit docs. |
| `ThreatModelPage` "We are working on the first. We have not commissioned the second yet." (the journalist-grade caveat under FOUR THINGS WORTH NAMING DIRECTLY) and `AuditPage` "An external adversarial audit by a recognized firm has not been commissioned." | Short pages: `ThreatModelPage.tsx` ~line 254; `AuditPage.tsx` ~line 212. Long-form pages: `artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx` ~line 1585; `artifacts/void-client/src/pages/docs/DocsAuditPage.tsx` ~line 359. (The Task #545 IA split added the long-form `/docs/*` surfaces; the caveat now renders on both the short and long pages, so all four must stay in sync.) | Both lines are factually correct as of 2026-05-02 and must remain factually correct until the external audit engagement is actually signed. Task #247 has produced a written scope of work, but the SOW being drafted is not the same thing as the engagement being signed — promoting either line to "we have commissioned" or "audit is underway" without the engagement letter being signed and the commissioned date being recorded in the audit-doc preambles is the exact category of marketing drift this document exists to prevent. When the engagement is signed, both lines and the AuditPage limitation bullet are updated in the same commit that updates the audit-doc preambles. |
| Landing social-card title — `"VOID \| Ephemeral, Zero-Knowledge Video Rooms"` in `artifacts/void-client/scripts/og-routes.mjs` (the `/` route). | OG metadata only; the LandingPage body itself does not use the phrase "zero-knowledge." | Same concern as the `/why` row below. "Zero-knowledge" has a specific cryptographic meaning (zero-knowledge proofs); VOID uses end-to-end encryption with Argon2id-derived keys, not ZKPs. The phrase reads as informal "the server cannot decrypt the call" shorthand — accurate about content but imprecise about the primitive. Watch this and the `/why` row together. If a future edit lifts the phrase into the rendered page body, escalate to TIGHTENED and replace with "ephemeral, end-to-end encrypted" or similar. |
| `/why` social-card title — `"VOID \| The Case for Ephemeral, Zero-Knowledge Video"` (added by Task #223 in `artifacts/void-client/scripts/og-routes.mjs`; "Stateless" → "Ephemeral" in Task #1084). | OG metadata only; the WhyPage body itself does not use the phrase "zero-knowledge." | "Zero-knowledge" has a specific cryptographic meaning (zero-knowledge proofs). VOID does not use ZKPs — it uses end-to-end encryption with Argon2id-derived keys, and the relay still observes IP/room-code/timing while a room is live (see Threat model §"WHAT THE SERVER SEES"). The phrase reads as informal "the server cannot decrypt anything" shorthand, which is true of the content but not literally the cryptographic primitive. The body of WhyPage uses the more accurate "no record of what was said" framing this audit tightened in Drift #1. If a future copy edit lifts "zero-knowledge" out of OG metadata and into page body, escalate to TIGHTENED and replace with "ephemeral, end-to-end encrypted" or similar. |

---

## Audit pass log

Dated record of each closed audit pass. Newest first. A pass entry states what
was re-walked, the status outcome per claim, and any drift recorded for a
follow-up. Editing page copy is out of scope for a re-walk pass — drift is
recorded here and corrected in a separate, dedicated change.

### 2026-06-05 — WATCH-row re-walk (Task #803)

Re-walked every WATCH-status claim against current shipped copy. **All grades
held — nothing escalated to `TIGHTENED`, nothing relabelled, nothing newly
broken.** Per-row outcome:

- **Tor-wallet shortlist** (claim ledger row, `A SHORTLIST OF WALLETS THAT
  ROUTE OVER TOR`) — **WATCH held.** All three named options (Zeus, Phoenix,
  BitBanana), the non-endorsement preamble, and the closing "your own node over
  `.onion`" paragraph are still present and unchanged, each carrying its own
  project's Tor doc as the cited source. Now rendered on the long-form
  `/docs/threat-model` page (`DocsThreatModelPage.tsx`).
- **HKDF two-key "from this" framing** (WATCH list: `"From this, HKDF domain
  separation produces two distinct keys: VOID-ECDHE-v1, VOID-SAS-v1."`) —
  **WATCH held.** The exact wording is intact, so the "one copy edit away from
  becoming inaccurate" concern is unchanged. The claim has moved off
  `WhyPage.tsx` (now short-form prose) to the `ENCRYPTION` section of
  `/docs/how-it-works` (`DocsHowItWorksPage.tsx`) and its `KeyDerivationDiagram`
  component.
- **StartOS Tor posture** (WATCH list, Closed 2026-05-03 / Task #238) —
  **still Closed.** Re-confirmed the `.onion`-reachable + media-path caveat copy
  is present (now on `DocsThreatModelPage.tsx`) and the `banned-phrases.mjs`
  guard against "Tor-by-default" / "Tor-routed" reintroduction is still active.
- **External-audit "not commissioned" caveat** (WATCH list) — **WATCH held and
  must stay held until the engagement is signed.** The "not commissioned"
  framing is still factually correct on `ThreatModelPage.tsx`, `AuditPage.tsx`,
  and the long-form `DocsThreatModelPage.tsx` / `DocsAuditPage.tsx`.
- **Landing social-card "Zero-Knowledge" title** (WATCH list) — **WATCH held.**
  The phrase still appears only in `og-routes.mjs` (the `/` route), never in a
  rendered page body.
- **`/why` social-card "Zero-Knowledge" title** (WATCH list) — **WATCH held.**
  Still only in `og-routes.mjs` (the `/why` route); a full re-read of
  `WhyPage.tsx` confirms the phrase is absent from the page body.

**Drift recorded (no page-copy change — correction deferred):** since the
2026-05-03 anchor, the short-form / long-form IA split (Task #545 plus the
`/docs/*` pages) relocated several WATCH-row claims off the short pages
(`WhyPage.tsx`, `ThreatModelPage.tsx`) onto the `/docs/*` long-form pages. The
claim text carried over verbatim, so every grade holds — but the affected rows'
"Where" / "Source" pointers still reference the old short-page locations and
line numbers and are now stale. Refreshing those pointers is a separate,
dedicated edit (a re-walk pass does not rewrite ledger rows); filed as a
follow-up.

---

## Process — how to keep this from drifting again

When you change marketing copy:

1. Find the row above. If your change adds, removes, or rewords a claim,
   update that row in the same commit.
2. If the claim is new, add a row. State the source. If there is no source,
   either find one in `VOID_TECHNICAL_OVERVIEW.md` / `docs/threat-model.md`
   first, or do not ship the claim.
3. Run `pnpm --filter void-client run check:phrases` before opening a PR.
   The banned-phrase list in `artifacts/void-client/scripts/banned-phrases.mjs`
   enforces the register described in the internal marketing-vision doc (Part V.B).

When you change a feature in the technical overview or the threat model:

1. Search this document for any row whose source is the section you
   touched.
2. Re-read the page that renders the claim. If the claim no longer matches
   the source, either tighten the page copy or change this row's status to
   `WATCH` and open a follow-up to fix it.

When in doubt, the order of authority is:

1. The code.
2. `VOID_TECHNICAL_OVERVIEW.md`.
3. `docs/threat-model.md`.
4. This audit doc.
5. The marketing pages.

The marketing pages must never be the most authoritative description of
what VOID does.
