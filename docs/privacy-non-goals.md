# Privacy / Security Non-Goals — "Not Doing, and Why"

**Type:** Decision record. A published list of privacy/security measures VOID
has **deliberately decided not to pursue**, with the reasoning. Its purpose
is to stop these from being re-litigated every analysis cycle and to keep the
honesty discipline (`docs/marketing-claims-audit.md`) intact — we name what we
do *not* do, not just what we do.
**Status:** Stable. **Do not revisit an item unless the threat model
(`docs/threat-model.md` / `docs/client-threat-model.md`) materially changes.**
**Last reviewed:** 2026-06-05.

**Reconciles with:**
`docs/threat-model.md`, `docs/client-threat-model.md`,
`docs/tor-video-positioning.md` (Tor / media-path honesty),
`artifacts/void-client/scripts/check-banned-phrases.mjs` (the media-over-Tor
claims gate).

---

## Non-goals

### N-1. Routing call media over Tor
**Decision: not doing.** WebRTC real-time media over Tor is unusable in
practice (latency, jitter, and Tor's TCP transport make live A/V break down).
VOID fronts the **signaling** layer with Tor (`.onion`), forces relay-only so
peers don't see each other's IPs, and relays media via **clearnet TURN**. The
TURN operator sees media-layer metadata; that is disclosed, not hidden.
**Why it stays closed:** this is an architectural reality, not a missing
feature; the conclusion is backed by the TURN-over-Tor research spike. The
product must never *claim* media is routed/tunneled over Tor — enforced by the
banned-phrases gate. Revisit only if a transport that makes real-time media
over an anonymizing network viable becomes real.

### N-2. Cover traffic / traffic-analysis padding
**Decision: not doing.** Constant-rate padding or decoy traffic to resist
traffic analysis imposes large, continuous bandwidth and UX costs for
marginal gain against a **global passive adversary** — a threat VOID does not
claim to defeat and does not put in its threat model. Mesh P2P + relay-only
already hide peer IPs from each other; the residual timing/volume metadata at
the relay is disclosed (N-1). **Why it stays closed:** it would be security
theater relative to the stated threat model and would degrade call quality for
every user. Revisit only if a global-passive-adversary position is explicitly
added to the threat model.

### N-3. Eliminating TURN-operator media-layer metadata via an in-app feature
**Decision: not doing as a product feature.** When media is relayed (always,
over `.onion`; opt-in otherwise), the TURN operator necessarily sees the
5-tuple / timing / volume of the relayed flow. There is no in-app toggle that
removes this while still relaying. **The structural fix is self-hosting the
TURN relay**, which VOID already supports (sovereign coturn, no third-party
STUN fallback). **Why it stays closed:** it is inherent to relaying; the
answer is operator sovereignty (consistent with Read B — additive, not a guest
prerequisite), not an app feature that would only pretend to remove it.

---

## Deferred (not declined)

These are **not** non-goals — they are parked pending a trigger, kept here so
the distinction is explicit:

- **Higher-entropy SAS mode** (longer than the current 22-bit / two-word
  "Duet"): **deferred unless the external audit raises SAS strength as a
  finding.** The current SAS is defensible (single-shot, mismatch is loud);
  a longer mode trades verification UX for marginal MITM resistance. Decide
  after the audit, not before.
- **Operator-blindness architectural arcs** (split-trust ingress, relay
  diversity, decentralized / federated rendezvous): **deferred, each gated on
  its own trigger.** These are the structural narrowings of the
  operator-correlation root residual (`docs/threat-model.md` §0.1 / §1.1 /
  §1.2). Their full decision record — triggers, sequencing, and the open
  Sybil/eclipse research question for a decentralized rendezvous — lives in
  `docs/operator-blindness-roadmap.md`. Where that roadmap overlaps these
  non-goals (relay diversity vs **N-3**, media-over-Tor vs **N-1**,
  cover-traffic vs **N-2**), **this document is authoritative** and the roadmap
  defers to it.
