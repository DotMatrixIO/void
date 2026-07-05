# Operator Runbook: SRI Canary Failures

The SRI canary (`.github/workflows/sri-canary.yml`) is the out-of-band
post-deploy integrity check for a clearnet VOID deployment. It runs on
a GitHub-hosted runner — not in any user's browser — and fails loudly
when the live bundle stops matching what we published.

This runbook is what to do when the workflow opens an `sri-canary`
GitHub issue against your deployment.

## What the canary checks

For the configured `vars.CANARY_TARGET_ORIGIN`, the canary:

1. Fetches `/index.html` and parses every
   `<script integrity="…">` and `<link rel="stylesheet|modulepreload"
   integrity="…">` tag.
2. Re-fetches each referenced asset from the same origin and computes
   `sha384` over the bytes. Asserts the computed hash equals the
   declared `integrity` attribute.
3. Fetches `/sw-known-hashes.json` (the service-worker integrity
   baseline emitted by `gen-sw-known-hashes.mjs`). Asserts every
   asset hash agrees with the SW baseline.
4. Fetches `/api/provenance.json` (the build-time provenance surface
   served by the api-server). Asserts every shared key in
   `sriDigests` agrees with the bytes the origin just served.

Any divergence is a failure. The canary does not use any private
credential — it sees what an unauthenticated client sees.

## Most-likely causes (and the operator response for each)

### 1. CDN edge cached a stale build past a deploy

**Symptom.** The canary reports asset hashes that match neither
`sw-known-hashes.json` nor `/api/provenance.json`, but the values in
both of those files agree with each other (and with the latest
release's `provenance.json`). One or more CDN edges is still serving
the *previous* bundle's bytes for `/assets/*` while the dynamic
`/index.html` and `/api/provenance.json` already describe the new
bundle.

**Response.** Purge the affected paths from the CDN (`/assets/*`, and
`/index.html` for good measure). If your CDN supports a "purge
everything" button and the origin is small enough, that is the
fastest answer; otherwise purge the specific paths the canary
listed. Re-run the canary via `workflow_dispatch` to confirm green.

### 2. Reverse proxy or WAF is rewriting asset bytes

**Symptom.** The canary reports a hash mismatch on a specific asset
even though no deploy happened, and the mismatch persists across CDN
purges. The recomputed hash is stable across re-runs (i.e. it is not
flapping). Often shows up after a proxy / WAF config change.

**Response.** Check for byte-mangling middleware on the path between
the api-server and the public internet:
- HTML minification or "optimization" features in the CDN/WAF
  (Cloudflare Auto Minify, Rocket Loader, etc.) that rewrite served
  bytes inline. Disable for `/assets/*` and `/index.html`.
- Reverse-proxy modules that inject analytics or rewrite URLs (e.g.
  some `mod_pagespeed` or NGINX `sub_filter` configs).
- WAF rules that decode/re-encode bodies they consider "suspicious".

The fix is to make the proxy pass `/assets/*` and `/index.html`
through untouched. Re-run the canary to confirm.

### 3. Actual supply-chain tamper

**Symptom.** Asset bytes diverge from both the SW baseline *and*
`/api/provenance.json`'s `sriDigests`, and the divergence cannot be
explained by (1) or (2). The api-server's `/api/provenance.json`
`commit` field still matches the release you intended to deploy.

**Response.** Treat as an incident:
1. Take the deployment offline (or roll it back to the previous
   known-good image by digest from `SHA256SUMS`).
2. Compare the canary's reported `actual` hashes against the
   cosign-signed `provenance.json` release asset for the same
   `commit` — see the verify recipe in `README-selfhost.md` §7a. If
   the release asset's hashes match what `/api/provenance.json`
   served and the bytes on the wire diverge from both, the tamper
   is in the edge layer between the origin's storage and the
   public internet.
3. Cross-check from a second network path (mobile data, a friend's
   machine, a Tor exit). The `/proof/runtime` page in a fresh
   browser session will hash what your browser actually loaded — if
   that second path also diverges from the cosign-signed release
   asset, the tamper has reached more than one observer.
4. Open the incident in `docs/incident-response.md` and rotate any
   credentials (Lightning provider tokens, deploy keys) that touch
   the build pipeline.

### 4. Targeted edge attack — one path sees clean bytes, another sees tampered bytes

**Symptom.** The canary opens a **divergence** issue
(title: "sri-canary: paths disagree on served bytes (suspected
targeted edge attack)", marker `<!-- sri-canary-divergence -->`)
rather than the usual mismatch issue. Each individual path leg's
self-consistency check passed — `/index.html`'s declared `integrity`,
`/sw-known-hashes.json`, and `/api/provenance.json` all agree
*within each path's view* — but the two paths observed **different
SHA-384 hashes** for the same asset URL.

This is the signature that a single-runner canary cannot catch and
why task #499 added the second network path: an attacker who can
identify the canary's egress IP range (or any narrow IP range, e.g.
"not from this country", "not from this ASN") can serve a clean
bundle to that range and a tampered bundle to everyone else. A
single-runner check would happily report green because everything
inside its own view is consistent.

**Response.** Treat as an incident — this is a stronger signal than
cause #3 because it implies the attacker has both tampered with the
bundle *and* deliberately wired up IP-aware serving to hide from
monitoring:

1. Take the deployment offline (or roll back to the previous
   known-good image by digest from `SHA256SUMS`).
2. Pull the `cross-check-report.json` artifact from the failed run.
   The `divergences` array lists, per asset, what each path saw.
   Compare each side against the cosign-signed `provenance.json`
   release asset for the deployed `commit` — see the verify recipe
   in `README-selfhost.md` §7a. Whichever side matches the signed
   release is the "clean" view; the other side is the tampered
   view. That tells you which egress range is being served the
   bad bytes.
3. Inspect the CDN / edge configuration for IP-aware routing,
   geo-routing, A/B serving, or "challenge" rules that conditionally
   rewrite responses. Recently-added rules are the most likely
   culprit. Also check whether the origin's TLS certificate or
   reverse-proxy config differs across the divergent paths — a
   man-in-the-middle on the path that saw tampered bytes would
   present a different cert chain.
4. Re-fetch from at least one more independent vantage (mobile
   data, a friend's machine, a Tor exit). If a *third* path agrees
   with one of the canary's two paths, you have stronger evidence
   about which side is the clean one.
5. Open the incident in `docs/incident-response.md`, rotate any
   credentials (Lightning provider tokens, deploy keys, CDN API
   tokens) that touch the build or edge layer, and notify users
   via the out-of-band channels listed there. Unlike cause #3,
   not all users were necessarily served the bad bundle — note
   in the user-facing advisory which egress ranges were affected
   if you can determine it.

If both paths' reports cannot be downloaded (the cross-check job
notes "one or both per-path reports were missing"), that is *not*
a divergence — it is a per-path outage. Re-run via
`workflow_dispatch`; if a single path is reliably missing reports,
check that runner's egress and the `upload-artifact` step's logs.

## How to silence the canary intentionally

The canary is opt-in per repository: it no-ops with a `::notice::`
when `vars.CANARY_TARGET_ORIGIN` is unset. Forks and freshly-cloned
repos do not need to do anything to silence it.

If you operate a clearnet deployment and want to stop running the
canary against it (e.g. you are decommissioning), unset
`vars.CANARY_TARGET_ORIGIN` in the repository Variables. Do not
leave a stale origin pointed at a dead deployment — the canary will
fail every run and bury real failures on your other deployments
under the noise.
