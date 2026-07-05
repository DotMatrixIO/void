# Default Connection Path — `.onion` vs Clearnet (Decision Record)

**Type:** Decision record. Captures the choice made for "make Tor/`.onion` the
default connection path" (Task #1022) so it is not re-litigated, and so the
gating condition for changing it is written down rather than tribal.

**Status:** Active — surface variant shipped; hard default **held**
(re-evaluated and reaffirmed 2026-06-17, see "Re-evaluation" below).
**Last reviewed:** 2026-06-17.

**Reconciles with:**
`docs/privacy-non-goals.md` (N-1, media stays on clearnet TURN),
`docs/threat-model.md` / `docs/client-threat-model.md` (IP visibility),
`docs/onion-mirror-runbook.md` (operator-side `.onion` deployment),
`artifacts/void-client/scripts/banned-phrases.mjs` (the Tor-routing / media
claims gates).

---

## The goal

Today the `.onion` address is an opt-in mirror and clearnet is the default
path. The goal of Task #1022 is to **prefer `.onion`** when one is published
and reachable, make clearnet an **explicit, visible** state rather than a
silent default, keep a **graceful clearnet fallback**, and **disclose the
first-contact clearnet exposure honestly**.

## The gate (why this is not a free flip)

"Default" has two meanings here, and only one of them is safe to change from a
development / CI environment:

1. **Soft default (surface).** Strongly surface the `.onion` path, give a
   one-click switch, name the current path, and disclose the bootstrap
   exposure. This is reversible UI and copy — no user is silently routed
   anywhere they did not choose.

2. **Hard default (behavior).** Make a fresh client actually *load and connect
   over `.onion` by default* — e.g. redirect / origin-flip on first contact —
   rather than clearnet.

The hard default must only flip behind a **real target-org reachability
validation**: evidence that the actual locked-down environments this is meant
to protect (newsroom / enterprise machines that the operator controls) can in
fact reach the published `.onion` on the networks they live on. Flipping the
hard default on the strength of a **synthetic / dev-CI probe is explicitly
insufficient** — a probe that passes in this environment says nothing about
whether a real, restricted target network can route `.onion`, and a wrong flip
strands exactly the users it is supposed to help (Tor blocked → fail-to-connect
instead of graceful clearnet fallback).

## Decision

- **Hard default: HELD.** This development / CI environment cannot supply real
  target-org reachability evidence, so the precondition for the hard flip is
  unmet. We do **not** flip which origin a fresh client loads.
- **Soft default: SHIPPED.** We implemented the "strongly surface `.onion` +
  one-click switch" variant instead, which is what the task prescribes when the
  real-environment validation is unavailable.

### Re-evaluation — 2026-06-17 (behavioral-flip follow-up)

The behavioral-flip follow-up was picked up and the gate re-checked. The
precondition is **still unmet**: this development / CI environment cannot
produce real reachability evidence from the protected target networks, and
this record is explicit that a synthetic / dev-CI probe does not qualify (see
"The gate" above). No real target-org evidence was available from the
deploying operator at evaluation time, so there is nothing to validate the
flip against.

**Outcome: hold reaffirmed — behavior unchanged.** A fresh client still loads
over whichever origin it was given; nothing about which origin a client loads
or connects over was changed. The shipped surface variant (strong `.onion`
surfacing, the one-click switch, and the honest bootstrap disclosure) remains
the user-facing default. The hold will be lifted only when the owner named in
"Who can lift the hold" below supplies real target-network reachability
evidence; until then this is a documentation update, **not** a behavior
change, and re-doing the flip without that evidence would strand exactly the
users it is meant to protect.

### Who can lift the hold

The hard flip is owned by whoever operates the target deployment and can
produce real reachability evidence from the protected environments (the
self-host operator running the `.onion` per `docs/onion-mirror-runbook.md`, in
coordination with the target org's IT). When that evidence exists, the flip can
be designed with a measured fallback (probe → prefer `.onion` → fall back to
clearnet with a surfaced downgrade), validated against those real networks, and
this record updated.

## What shipped (surface variant)

- **Explicit clearnet state in the session.** A non-alarming `CLEARNET PATH`
  indicator renders next to the E2E / relay badges in a call when a `.onion`
  mirror is published but the session loaded over clearnet, so clearnet is a
  known choice rather than an invisible default. It is suppressed when no
  `.onion` is configured (no alternative to offer) and on the `.onion` origin
  (the positive "Connected via Tor onion" badge covers that).
- **Explicit clearnet state + one-click switch on every clearnet page.** The
  footer `.onion` affordance now names the current path ("You are on the
  clearnet path"), keeps the existing one-click link/copy to the `.onion`
  address, and keeps the reachability-aware "requires Tor Browser" downgrade.
- **Bootstrap-honesty disclosure.** The footer affordance states plainly that
  the current visit already reached us over the public internet, and that
  opening the `.onion` address keeps the **signaling** layer behind a hidden
  service from then on — it does **not** hide an IP from the other people on a
  call. This stays consistent with `docs/privacy-non-goals.md` N-1 (media
  always relays via clearnet TURN) and never claims media is routed over Tor.

## Scope boundaries

- Routing call **media** over Tor stays out of scope (`docs/privacy-non-goals.md`
  N-1).
- A Tor-only runtime posture / attestation is tracked separately and is not
  part of this change.
- The IP↔room residual wording in `docs/threat-model.md` §1.1 is owned
  elsewhere and is not edited here.
