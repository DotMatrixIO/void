# VOID Discipline Timeline

## Purpose

This document is an evidence artifact for anyone auditing VOID's engineering
discipline. Rather than asserting "we have good CI" at a single point in time,
it presents the project's **structural CI gates chronologically** — each with
the date it was first introduced and the reason it exists — so a reader can see
that the discipline was enforced *longitudinally over the project's history*,
not bolted on at the end.

The emphasis here is deliberately on **structural / behavioral guards**: checks
that enforce architectural invariants, security posture, privacy, and
provenance. These are the load-bearing part of the story. The copy- and
vocabulary-level guards (banned phrases, required marketing literals,
room-vs-session wording, fonts, contrast) are the *weakest* evidence of
discipline — they keep prose consistent but enforce no invariant about how the
software behaves — so they are collapsed into a single grouped entry at the end
rather than given per-check rows.

Dates are the first commit that introduced each guard script, workflow, or
validation entry. Rationale is grounded in the corresponding audit, runbook, or
threat-model doc where one exists.

## Timeline (oldest → newest)

| Date | Gate | Category | Rationale |
| --- | --- | --- | --- |
| 2026-05-01 | `api-spec-drift` workflow | Spec drift | Re-runs OpenAPI codegen and fails on any drift, then boots the API server and validates every documented response body against its generated Zod schema — the HTTP contract cannot silently diverge from the spec. |
| 2026-05-02 | `asyncapi-spec-drift` workflow | Spec drift | Diffs the actual Socket.io `emit`/`on` call sites against `asyncapi.yaml` so the live signaling surface stays equal to its documented contract. |
| 2026-05-02 | `check:feature-policy-sync` | Spec drift | Pins the served feature/permissions policy to its documented source so a capability cannot be added or relaxed without the doc moving in lockstep. |
| 2026-05-02 | CVE appendix release gate | Supply chain | Generates a per-release, lockfile-complete snapshot of every advisory `pnpm audit` returns; the `--strict` mode blocks a release tag when any High/Critical advisory has no audit-ledger entry. See `docs/security-audit-cve-appendix.md`. |
| 2026-05-03 | `check:still-poster` | Media integrity | Byte-exact drift guard for the generated still poster, so the shipped image always matches what the build produces from source. |
| 2026-05-05 | `check:onion-mirror-sync` | Onion posture | Keeps the advertised `.onion` mirror hint and its configuration in sync across the surfaces that reference it, preventing a stale or contradictory mirror address. See `docs/onion-fail-open-audit.md`. |
| 2026-05-20 | `onion-smoke` workflow | Onion posture | Post-deploy and daily smoke proving the live origin both *advertises* an `.onion` and that the advertised address is *actually reachable over Tor* — catches an `ONION_HOSTNAME` dropped in a secret rotation, which unit tests cannot see. See `docs/onion-mirror-runbook.md`. |
| 2026-05-20 | `check:no-display-media-audio` | Privacy | Static guard that screen-share capture never requests display *audio*, so a screen share cannot silently exfiltrate system or tab sound. See `docs/privacy-non-goals.md`. |
| 2026-05-21 | `check:signaling-envelope` | Wire contract | Every Socket.io event and WebRTC data-channel label must carry a documented row plus a whitelist entry, so no undocumented wire surface can ship. See `docs/signaling-envelope-audit.md`. |
| 2026-05-22 | SRI canary workflow | Provenance | Out-of-band, two-network-path canary against the live origin: re-derives the SRI hashes of every served asset and cross-checks them against the service-worker hash table and `/api/provenance.json`. Path divergence flags a targeted edge attack. See `docs/sri-canary-runbook.md`. |
| 2026-05-22 | `check:threat-model-drift` | Spec drift | Keeps the threat-model rows consistent across the docs and the in-app threat-model page, so the published model and the code's claimed model cannot drift apart. See `docs/threat-model.md`. |
| 2026-05-31 | `check:biometric-video-drift` | Media integrity | Byte-exact guard that the recorded demo MP4 matches the bytes re-rendered from its source, closing the door on an out-of-date or tampered shipped video. |
| 2026-06-05 | `check:log-ip-room-correlation` | Privacy | Static guard that server logs never co-locate a client IP with a room identifier, so logs cannot become a correlation handle linking who-talked-to-whom. See `docs/log-correlation-audit.md`. |
| 2026-06-11 | `check:payment-hash-log` | Privacy | Forbids the Lightning payment hash from ever reaching a log line, severing a would-be link between a payment and a room. See `docs/log-correlation-audit.md`. |
| 2026-06-11 | `check:doc-code-drift` | Spec drift | Pins load-bearing runtime constants (GC interval, SDP codec allowlists) to their documented values in the technical overview and signaling audit, so a code change and its doc move together. See `docs/code-quirks-index.md`. |
| 2026-06-11 | `overview-http-drift` (`check-overview-http`) | Spec drift | Asserts the HTTP surface enumerated in the technical overview matches `openapi.yaml`, so the human-readable overview cannot describe routes the spec does not. |
| 2026-06-12 | `check:publish-doc-hygiene` | Boundary isolation | Converts the manual pre-publish grep into CI: no shippable doc may contain the old org slug, an internal scratch-tree path, or a grant-application name. See `docs/pre-publish-scrub-2026-06.md`. |
| 2026-06-12 | `check:security-key-fingerprint` | Provenance | Pins the security-contact key fingerprint (and its expiry) so the published contact key cannot be silently swapped or allowed to lapse unnoticed. |
| 2026-06-13 | `check:publish-cross-links` | Boundary isolation | The complement to doc-hygiene: no shipping doc or source file may *point at* a never-ship private doc or the agent-memory tree, which would become a dangling reference once the snapshot strips it. See `docs/pre-publish-scrub-2026-06.md`. |
| 2026-06-18 | `check:publish-boundary` | Boundary isolation | Makes the agent-surface removal a one-way door: fails the build if a deleted agent package, the `ENABLE_AGENT_ROOMS` flag, or the old invite grammar is reintroduced into the protected human/shared surface. |
| 2026-06-19 | `check:wire-protocol-name` | Wire contract | The signed-hello protocol string is hashed into every Ed25519 signature; this guard pins `PROTOCOL_VERSION` and the signing contexts to the neutral `void-wire/1` and forbids the old agent-prefixed names from reappearing in handshake source. |
| 2026-06-27 | `check:publish-inventory` | Boundary isolation | Fail-closed backstop for the publish scrub: every tracked top-level entry must be explicitly classified SHIP or STRIP in one manifest, so a newly added root file can never ship by omission. See `docs/pre-publish-scrub-2026-06.md`. |

## Copy / vocabulary guards (the least load-bearing layer)

A second, deliberately de-emphasized family of checks keeps user-facing prose
consistent but enforces no behavioral or architectural invariant. These are the
**weakest** evidence of discipline and are listed here only for completeness,
collectively rather than per-check:

- `check:phrases` (banned-phrase scan, 2026-04-30)
- `check:literals` (required marketing literals, 2026-05-03)
- `check:contrast` (text/background contrast tokens, 2026-05-20)
- `check:landing-fonts` (landing typography, 2026-06-02)
- `check:room-not-session` (room-vs-session vocabulary, 2026-06-09)

Their rationale is editorial consistency, sourced from `docs/marketing-claims-audit.md`
and `docs/contrast-audit.md`. A green run of these checks says the words on the
page are consistent; it says nothing about what the software does. They should
not be read as the substance of VOID's engineering discipline.

## How the structural gates compound

Read together, the structural gates form overlapping layers rather than a list
of independent checks. The **spec-drift** guards keep the documented contract
equal to the running code; the **wire-contract** guards keep that contract's
most security-sensitive surface (the signed handshake and the signaling
envelope) from changing silently; the **privacy** guards keep the operational
byproducts (logs, screen-share, payment metadata) from becoming correlation
handles; the **onion** guards keep the no-clearnet-egress posture honest against
the live deployment; the **provenance / supply-chain / media-integrity** guards
keep the bytes a user actually receives tied to the bytes the build produced;
and the **boundary-isolation** guards keep removed surfaces removed and keep the
publish scope fail-closed. Each closes a gap the others cannot see, and each has
been in force since the date above — which is the point of this document.
