# Operator-Blindness Roadmap — "Named, Not Built, and Why Not Yet"

**Type:** Decision record (roadmap). The sequenced answer to the
operator-correlation root residual named in `docs/threat-model.md` §0.1. It
records the architectural directions VOID has **deliberately named but is not
building now**, each gated on an explicit trigger, in the same fence
discipline as the padding non-goal (`docs/privacy-non-goals.md` N-2). Its
purpose is to stop these from being re-litigated every analysis cycle and to
keep "operator-blind-by-construction" framed honestly — as a *direction*, not
an already-solved claim, and with **no delivery dates**.
**Status:** Stable. **Do not revisit an arc unless its named trigger fires**,
or the threat model (`docs/threat-model.md` / `docs/client-threat-model.md`)
materially changes.
**Last reviewed:** 2026-06-17.

**Reconciles with:**
`docs/threat-model.md` §0.1 (the root residual), §1.1 (signaling IP↔room
correlation), §1.2 (`TOR_ONLY` relay traffic-correlation); and
`docs/privacy-non-goals.md` **N-1 / N-2 / N-3**. Where this document and
`privacy-non-goals.md` overlap (media-over-Tor, cover-traffic/padding,
TURN-operator media metadata), **`privacy-non-goals.md` is authoritative** and
this document defers to it rather than restating it.

---

## 0. Framing — a direction, not a closed claim

`docs/threat-model.md` §0.1 states the single root assumption beneath VOID's
two disclosed operator-correlation residuals: the operator sits in a
correlation position the code can *narrow* but not fully *close*. The in-memory
IP↔room correlation a clearnet operator can perform (§1.1) and the relay
traffic-correlation position a `TOR_ONLY` operator's coturn occupies (§1.2) are
two manifestations of that one truth.

"Operator-blind-by-construction" is the north star that points at narrowing
that position further. It is a **roadmap direction**, not a property VOID
claims today. Nothing in this document is a commitment that the gap is closed,
nor a delivery date for closing it. Each arc below is written down so that the
*default* answer to "should we build this now?" is a documented **no, and here
is the trigger that would change the answer** — exactly the pre-commitment
fence N-2 establishes for padding/CBR.

### 0.1 The "now": the near-term operator-blindness layer — now shipped

The layer that narrows §1.1/§1.2 ahead of the arcs in this document is three
pieces of near-term work, sequenced *before* anything here. **All three have now
shipped**, completing this layer; what remains deferred are the deeper
architectural arcs in §1:

1. **Make Tor the privacy-maximizing path of least resistance.** **Shipped —
   surface variant (Task #1022).** The client now surfaces and encourages the
   `.onion` ingress so the common-case user is nudged onto the path that removes
   their clearnet IP from the operator's socket, rather than leaving Tor as an
   obscure opt-in: a `CLEARNET PATH` in-call indicator and a footer affordance
   that names the current path and offers a one-click switch. This is the
   **soft** default — the *hard* redirect default (actually loading/connecting a
   fresh client over `.onion`) is deliberately **held** pending real
   target-network reachability evidence; see `docs/tor-default-path-decision.md`
   for the decision and the trigger that would flip it. **Honest caveat
   (unchanged):** a first-time user who arrives via a clearnet URL unavoidably
   touches clearnet at the *first contact / bootstrap* rendezvous before the
   client can prefer onion — so the §1.1 residual still applies to that initial
   hop even for Tor-preferring users. The default must never be described as
   removing clearnet exposure entirely.
2. **Attest the deployment's posture.** **Shipped (Task #1023).** A reviewer can
   verify the running build's identity (reproducible-build provenance) and the
   operator's onion-only privacy posture at `GET /api/proof/posture`
   (`torOnly` / `iceStunSuppressed` / `onionIngress`, bound to the
   reproducible-build identity) — turning "trust the disclosure" into "verify the
   published build." **Precise limits (these must never be overstated):**
   attestation binds a claim to the *published, reproducible build at
   attestation time*. It does **not** prove the operator is not running a
   modified or un-attested binary, did not change configuration after
   attestation (a TOCTOU window), and did not place a logging proxy upstream of
   the attested process. The honest claim is "verify the published build's
   posture," **not** "prove the operator structurally cannot ever see an IP."
3. **Blind the room handle the operator routes on.** **Shipped (Task #1024).**
   Signaling for **human rooms** now routes on a per-epoch rendezvous handle —
   `HKDF-SHA256(durable roomId, epoch)`, rotating every 24h
   (`artifacts/void-client/src/lib/rendezvous.ts`) — degrading the operator's
   in-memory view from `IP ↔ stable room` toward `IP ↔ ephemeral token`. HKDF is
   one-way and the server holds neither the phrase nor the durable roomId, so a
   handle cannot be linked across epochs or inverted to a durable id. This is the
   defense-in-depth narrowing that still helps the user who *cannot* use Tor (a
   blocked or locked-down network), the population the Tor-default work leaves
   behind. **Honest limits (unchanged):** within an epoch the IP↔handle
   co-location remains; and the first-contact clearnet hop still applies.

This near-term layer **narrows** §1.1/§1.2; it does not **close** the §0.1
position. The three arcs below are the deeper architectural narrowings that
*could* — each one sequenced after this layer and gated on a trigger, because
building any of them earlier is gold-plating a residual VOID currently
discloses rather than solves.

---

## 1. Deferred arcs (named, not built)

### Arc A — Split-trust ingress
**The genuine next architectural narrowing of §1.1.** Place an IP-terminating
tier in front of a separate rendezvous tier such that **no single process
co-locates a client's IP with the room it joined.** The IP tier sees the socket
but not the room; the rendezvous tier sees the room but not the IP. This is the
structural way to remove the in-memory `IP↔room` correlation §1.1 describes
without relying on the user reaching the deployment over Tor.

**What it actually buys, stated honestly.** Against a *solo* operator who
controls both tiers, split-trust ingress buys an **architectural guarantee plus
latent option value** (a second party could later operate one tier), not an
immediate correlation-breaking win — a single operator who runs both tiers can
still join the two views. Its real payoff arrives only once the tiers are
operated by *different* parties, or once "we are structurally split-trust" is
itself a verifiable differentiator.

**Trigger (build it when ANY of these is true):**
- concrete, committed demand for tier-separation — a partner organisation, a
  second jurisdiction, or an external-audit recommendation; **or**
- attestation-of-tier-separation becoming a real product differentiator.

**Explicitly NOT a trigger:** "a second operator is already serving traffic."
That trigger can never fire — no one stands up a second tier before the seam to
plug into exists. Sequencing this on a precondition that depends on the work
already being done is how a roadmap item becomes permanently stuck.

**Sequencing:** after the near-term layer (§0.1). Because against a solo
operator it is mostly option value, it does not jump ahead of the shipping
focus.

### Arc B — Relay diversity
**Narrows §1.2.** Route the two legs of a call through *different*
relays/operators so that **no single coturn sees both envelopes** of the same
conversation. This directly attacks the traffic-correlation position a
`TOR_ONLY` operator's relay occupies in §1.2 (where forcing relay/relay
concentrates both legs at one party).

**Trigger:** the same multi-operator-ecosystem / state-level trigger that gates
N-2 (cover traffic) and N-3 (TURN-operator media metadata). Until a
multi-operator relay ecosystem exists *and* a user with a state-level threat
model requires it, building relay diversity is **gold-plating a
disclose-not-solve residual**: §1.2 is a disclosure, not a defect, and N-2/N-3
already establish that the structural answer to relay-layer metadata is
operator sovereignty (self-hosting the relay), not an in-app feature.

**Authority note:** where relay diversity touches the TURN-operator
media-metadata surface, **`privacy-non-goals.md` N-3 is authoritative**; this
arc is the *optionally additive* future direction, not a contradiction of N-3.

**Sequencing:** after the near-term layer, and not before the multi-operator
trigger fires.

### Arc C — Decentralized / federated rendezvous (the long-horizon north star)
Replace the single accountable rendezvous operator with a decentralized or
federated lookup (e.g. a DHT-based announce/lookup, or a federation of
independent rendezvous nodes), so there is no single party occupying the §0.1
correlation position at all.

This is the long-horizon direction, and it carries **open research questions
that must be written down honestly rather than assumed away:**

- **Metadata leakage of the lookup itself.** A DHT announce/lookup is a
  network operation with its own observable surface — who announced which key,
  who queried for it, and from where. Decentralizing the *routing* can
  re-introduce correlation at the *lookup* layer.
- **Sybil / eclipse resistance.** A public DHT is structurally exposed to an
  adversary who floods it with nodes (Sybil) or surrounds a target's view of
  the network (eclipse). Without a cost to participation, a well-resourced
  adversary can position itself astride the very lookups this arc is meant to
  protect.
- **The decentralization ≠ operator-blindness trap.** Removing a *named,
  accountable* operator is not automatically a privacy win. Swapping one
  accountable correlation position for an *unaccountable, distributed* one can
  be a net safety **downgrade** against a targeted adversary: the accountable
  operator can be audited, compelled-and-disclose, jurisdictionally
  challenged, and held to a published posture; an anonymous DHT participant who
  has eclipsed a target can be none of these. This trap is the reason this arc
  is a research direction and not a queued feature.

**Trigger:** a credible answer to the three research questions above —
specifically, a rendezvous design whose lookup-layer metadata and
Sybil/eclipse posture are *at least as good* as the accountable-operator model
it replaces — **plus** the same no-central-operator / state-level demand that
gates the other arcs.

### Open research question (elevated — not a footnote)

**Can VOID's Lightning-payment anti-Sybil primitive supply the Sybil/eclipse
resistance that a public DHT rendezvous structurally lacks?**

VOID already gates room creation behind a Lightning payment. A public DHT's
deepest structural weakness (Arc C) is the *absence of a cost to
participation* that Sybil/eclipse resistance requires. VOID's paywall is
exactly such a cost primitive. If announce/participation in a decentralized
rendezvous could be bound to a Lightning-proof-of-payment — a per-announce or
per-node economic cost that an attacker must pay to occupy lookup positions —
the paywall VOID built for monetisation could double as the anti-Sybil
foundation a permissionless rendezvous needs.

This is framed as an **explicit research question, not a settled plan.** It is
potentially VOID's most original contribution to the field: most
decentralized-rendezvous designs import a generic proof-of-work or
proof-of-stake anti-Sybil layer; VOID already has a live, low-friction payment
primitive that could serve the same role natively. Whether it actually
delivers Sybil/eclipse resistance without re-introducing payment-correlation
metadata (see `docs/threat-model.md` §2, Lightning paywall observability) is
the open question.

---

## 2. Sequencing (explicit, no dates)

```
   the now  →  Arc A  →  Arc B / Arc C
```

1. **The now** (§0.1): make Tor the encouraged path, attest the build's
   posture (with its precise limits), and blind the room handle — **all
   shipped** (Tasks #1022 / #1023 / #1024). This layer is complete; everything
   in §1 is sequenced after it.
2. **Arc A — split-trust ingress**, when committed tier-separation demand
   appears (partner org / second jurisdiction / audit recommendation) or
   attestation-of-tier-separation becomes a differentiator — **not** because "a
   second operator is already serving traffic."
3. **Arc B — relay diversity** and **Arc C — decentralized / federated
   rendezvous**, when the multi-operator-ecosystem / no-central-operator /
   state-level trigger fires — the same trigger family that gates N-2/N-3 — and
   (for Arc C) a credible answer to the lookup-metadata and Sybil/eclipse
   research questions exists.

No arc carries a delivery date. The triggers, not a calendar, decide.

---

## 3. Relationship to the privacy non-goals

`docs/privacy-non-goals.md` records measures VOID has decided **not** to
pursue. This document records measures VOID has decided **not to build *yet***,
with the trigger that would start them. The distinction is deliberate:

- **N-1** (media over Tor) and **N-2** (cover traffic / padding) are *closed*
  unless their own triggers fire; this roadmap does not re-open them.
- **N-3** (TURN-operator media metadata) is closed *as an in-app feature*; Arc
  B (relay diversity) is the *additive, multi-operator* future direction that
  does not contradict N-3's "the structural answer is operator sovereignty."
- Where this document and `privacy-non-goals.md` overlap, **`privacy-non-goals.md`
  is authoritative**; the arcs here are sequenced directions layered on top of
  those settled non-goals, never a reversal of them.
