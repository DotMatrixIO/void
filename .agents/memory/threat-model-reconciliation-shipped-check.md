---
name: Threat-model "match shipped feature X" tasks — verify the merge first
description: Doc-reconciliation tasks can presuppose behavior that hasn't merged into this environment; verify against code before asserting it in a security doc.
---

A task that says "reconcile the threat model to match shipped feature X" can be
written *ahead* of X actually merging into the working environment (parallel
task agents, sequencing slippage). The framing is aspirational; the code is
ground truth.

**Why:** A threat model is the worst place to assert behavior that doesn't
exist — a researcher who checks the doc against the code finds the gap and the
whole doc's credibility collapses. The honesty discipline these docs enforce
(see `docs/threat-model.md` §0.1, the `check-threat-model-drift` gate) means
you must describe what the code does *now*, not what a plan says it will do.

**How to apply:** Before rewriting §1.x to "narrowed to <new property>",
confirm the property in code. Cheap ground-truth probes used here:
- routing still keyed on the stable phrase-derived room code (envelope audit
  shows `create-room {roomId}` / `join-room {code}`; `buildJoinUrl` uses
  `phraseToHash`) ⇒ "blinded/ephemeral handle" did NOT ship.
- no `/api/proof/*` route carries a runtime-posture fact (only build identity
  + `effectiveConfig` *startup log* banner) ⇒ user-checkable "posture
  attestation" did NOT ship.
- onion is only *surfaced* (`OnionMirrorLink`, `onionReachability`, Onion-
  Location) with onion-origin relay-only auto-pin; no hard default flip /
  redirect ⇒ "Tor by default" is surfacing, not a default.

If the feature isn't present, reconcile the doc to the *current* behavior and
fold the intended narrowing in as a **sequenced, trigger-gated direction**
(cross-link a roadmap doc) rather than asserting it as fact. Flag the deviation
loudly in `drift_reason`.
