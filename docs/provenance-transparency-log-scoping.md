# Transparency-Log-Anchored Provenance — Scoping

**Type:** Scoping / decision-pending. No code is changed by this document.
It scopes a proposed hardening of VOID's build-provenance trust model.
**Status:** SCOPING. Not committed to build. Produced to answer four
questions before any implementation task is opened: implementation
complexity, client-side cost, self-host story, Read B fit.
**Last reviewed:** 2026-06-05.

**Reconciles with:**
`docs/client-threat-model.md` (the "operator/edge serves malicious client
code" position this addresses),
`docs/tor-video-positioning.md` §4 (Read B — improvements to the public
instance, not safety-contingent-on-self-host),
`artifacts/api-server/src/routes/provenance.ts`,
`artifacts/api-server/src/routes/proof-build.ts`,
`artifacts/void-client/scripts/add-sri.mjs`,
`artifacts/void-client/public/sw.js` + `sw-integrity.js`.

---

## 1. The threat this closes

VOID is a browser-delivered E2EE app. The party that serves `index.html`
and the service worker on a user's **first load** is trusted to deliver
honest crypto code. The current defenses against a malicious/edge-rewritten
bundle are:

- **SRI** on every asset (SHA-384), stamped into `index.html` by
  `add-sri.mjs`.
- **Service-worker byte verification** against a build-time manifest
  (`sw-known-hashes.json`), with a hard-fail tamper overlay.
- **`/api/provenance.json`** — per-asset SRI digests + commit + release tag.
- **`/api/proof/build`** — sha256 of every served file.
- **cosign-signed releases** (image + `SHA256SUMS`).

The residual gap is stated in the code's own caveat
(`provenance.ts`, `proof-build.ts`):

> "Even with full provenance, an edge attacker can rewrite both the bundle
> and this response on a single network path — cross-verify by fetching from
> a second network path and by comparing against the cosign-signed
> provenance.json release asset."

So today the defense against a **targeted single-path forgery** (operator or
edge serves one victim a forged bundle *and* forged provenance) is **user
discipline**: the user must manually fetch from a second network path and/or
compare against the GitHub release. Almost no at-risk user will do this.

**Anchoring the build's signed digest set in a public append-only
transparency log (Sigstore Rekor)** lets the *client itself* verify, on
load, that the digest set it is running was published to the log for that
commit/release by the expected CI identity. That converts a user-discipline
mitigation into a structural one — exactly the named position in
`docs/client-threat-model.md`.

**Honest limit (state it up front):** anchoring helps only if the verifier
code **and its pinned trust roots** are themselves delivered with integrity.
On a cold first load the operator still serves the verifier. So this does
not eliminate first-load trust; it **shrinks** it from "TOFU the entire app
+ rely on manual user discipline" to "TOFU a small, auditable verifier +
pinned roots, everything else checked against an append-only public log."
That is a real, large reduction — but it is a reduction, not elimination.
Any copy derived from this must say so (claims discipline, see #817).

---

## 2. Current state (grounding)

- `/api/provenance.json` schema: `{ schemaVersion, commit, builtAt, builder,
  sriDigests: {asset -> sha384}, releaseTag, caveat }`. Cache 1h. Dev builds
  emit a loud placeholder so the route never 500s.
- `/api/proof/build` schema: `{ gitSha, sha256sums: {file -> sha256},
  releaseTag, nodeVersion, caveat }`. Per-IP rate-limited (10/min). Cache 5m.
- Releases are already **cosign-signed**. Sigstore keyless signing already
  writes entries to **Rekor** as a side effect — so the public log entries
  may already exist for signed release artifacts; what's missing is
  (a) signing a canonical *digest manifest* the client can check, and
  (b) any **client-side** verification against the log.

---

## 3. Design options

### Option A — Anchor at release, verify client-side (the real feature)
1. **CI (release.yml):** after build, emit a canonical manifest = the sorted
   `sriDigests` map + `commit` + `releaseTag`. Sign it with cosign keyless
   (OIDC identity = the release workflow). Capture the Rekor **logIndex**,
   **inclusion proof**, and a **signed checkpoint**, plus the Fulcio cert.
2. **Publish** those alongside the bundle and surface them in
   `provenance.json` (`rekorLogIndex`, `inclusionProof`, `checkpoint`,
   `cert`).
3. **Client on load:** (a) confirm running-bundle digests == `sriDigests`
   (already possible); (b) verify the Fulcio cert chain + SCT and that the
   cert identity == the expected canonical release identity; (c) verify the
   signature over the manifest; (d) verify the Rekor inclusion proof against
   the pinned Rekor key / checkpoint. Surface result on the existing Proof
   page badge.

### Option B (Phase 0, cheap, do regardless of A)
Ship the cosign cert + Rekor logIndex + inclusion proof + checkpoint as
release assets and in `provenance.json`, **without** a browser verifier.
This immediately lets anyone with a CLI verify the running build against the
append-only log (no second-network-path dance), and lets us write honest
"verify against the public log" docs. Low complexity, **zero client cost**,
immediate honesty upgrade. Strongly recommended as a first step even if A is
deferred.

---

## 4. The four questions

### 4.1 Implementation complexity
- **CI: moderate-low.** cosign/Rekor are already in the release path. Adding
  a canonical signed digest manifest + capturing logIndex/inclusion-proof/
  checkpoint is incremental. The fiddly part is defining the **canonical
  manifest bytes** once and never letting build nondeterminism change them.
- **Client: moderate-high, and security-sensitive.** Browser verification of
  a Sigstore bundle means: Fulcio cert-chain + SCT verification, identity
  check, signature verify (ECDSA P-256 via WebCrypto — fine), and Merkle
  **inclusion-proof + checkpoint** verification against a pinned Rekor key.
  Two paths: adopt a subset of `sigstore-js` (`@sigstore/verify`,
  `@sigstore/bundle`) — Node-oriented, browser/bundle-size risk — or
  hand-roll a minimal verifier (small, but it is exactly the kind of code
  that must be in the external audit scope).

### 4.2 Client-side cost
- **Bundle size:** `sigstore-js` subset likely +100–300 KB; a hand-rolled
  verifier is a few KB but more audit surface. Either way the verifier **and
  the pinned trust roots (Fulcio/Rekor keys, expected OIDC identity) must be
  covered by SRI + the SW manifest** — otherwise the operator just forges the
  anchors. This couples to the existing integrity pipeline.
- **Offline / Tor:** Rekor must NOT be a hard network dependency — a `.onion`
  / censored / offline user can't reach it. Shipping the inclusion proof +
  signed checkpoint **as release assets** lets the client verify **offline**
  against the pinned Rekor key with no call to Rekor. This is required for
  the Tor story, not optional.
- **Failure UX:** align with the existing tamper overlay. Recommendation:
  SRI/SW mismatch stays a **hard fail**; log-anchor verification failure or
  unreachability should **warn + badge**, not brick, to avoid a Rekor outage
  taking down every session.

### 4.3 Self-host story
- **Official-release self-hosters** (running a cosign-verifiable image): the
  canonical Rekor entry applies; client verification works exactly as on the
  public instance. No downside.
- **Source/fork builds:** there is no canonical Rekor entry for their bundle.
  The verifier must be **configurable / degradable**: either the operator
  supplies their own signing identity + anchor, or the log-anchor gate falls
  back to the existing `/proof/build` + manual model. It must **never
  hard-fail and brick a self-hosted fork**. This is the load-bearing
  self-host requirement.

### 4.4 Read B fit
**Strong — this is the archetypal Read B improvement.** Read B
(`tor-video-positioning.md` §4) commits to the public, content-blind
instance being production-safe for guests who don't run infrastructure. The
single biggest residual trust on that hosted path is "the operator/edge
serves honest code." Transparency-log anchoring hardens **exactly that
residual for the hosted path**, directly serving the Read B audience
(survivors / sources / field journalists who use the public instance). It is
**additive**: it strengthens the public instance without making self-host
worse, and it does **not** make safety contingent on self-hosting.

---

## 5. Recommendation

1. **Do Phase 0 (Option B) regardless.** Cheap, no client cost, immediate
   honesty upgrade, unblocks "verify against the public log" docs.
2. **Scope Phase 1 (Option A) as a real, audit-gated build** — the browser
   verifier is security-sensitive and should land within the external
   audit's scope (the audit being the standing #1 priority anyway).

## 6. Open questions to settle before a build task
- Browser verifier: `sigstore-js` subset vs. hand-rolled minimal verifier
  (bundle size vs. audit surface).
- Trust-root rotation: Sigstore TUF root updates without a network call on a
  long-lived pinned client — pin with an expiry + refresh on each release?
- Exact degrade behavior for forks / Rekor outages (warn-not-brick).
- Confirm the verifier + roots are themselves under SRI + SW coverage.
