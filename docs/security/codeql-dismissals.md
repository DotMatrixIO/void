# CodeQL Alert Dismissals

Committed record of the GitHub CodeQL alerts that were reviewed and
deliberately dismissed rather than "fixed". Each entry carries a one-line
justification suitable for pasting into the GitHub code-scanning UI when
dismissing the alert. Alerts not listed here were fixed in code — see the
commit that introduced this file.

| Alert | Rule | Disposition | Justification |
| --- | --- | --- | --- |
| #14 | Use of a broken or weak cryptographic hashing algorithm (HMAC-SHA1) | Dismiss — false positive / interop requirement | HMAC-SHA1 is mandated by the TURN REST credential mechanism (coturn `static-auth-secret`); it is a wire-interop requirement producing a short-lived credential MAC, not a hash of secret-at-rest data. |
| #13 | Code construction from library input (`mockupPreviewPlugin.ts`) | Dismiss — not exploitable | Build-time dev tooling for the local design sandbox; input is the local filesystem only, no attacker-controlled data. Verified `artifacts/mockup-sandbox/mockupPreviewPlugin.ts` is NOT in the publish inventory SOURCE manifest (`scripts/publish-inventory-manifest.mjs` lists only two mockup-sandbox image assets), so the file never ships. |
| #10 | Missing rate limiting on the self-host SPA catch-all | Dismiss — accepted risk | The catch-all serves fixed static files exactly as any web server does; a rate limiter in a self-host/NAT context would throttle legitimate users behind shared IPs for negligible DoS benefit. |
| #9 | Incomplete URL substring sanitization (test file) | Dismiss — test-only | Fetch-mock interceptor substring match in a unit test; no security boundary, no attacker. |
| #7 | Incomplete URL substring sanitization (test file) | Dismiss — test-only | Fetch-mock interceptor substring match in a unit test; no security boundary, no attacker. |
| #6 | Incomplete URL substring sanitization (test file) | Dismiss — test-only | URL assertion in a unit test; no security boundary, no attacker. |

## Fixed alerts (for cross-reference)

- #12 (SSRF) — route-boundary charset validation for BTCPay invoice IDs plus
  `encodeURIComponent` at every interpolation site in both Lightning adapters.
- #11 (CORS reflection) — self-host CORS now fails closed; allowlist derived
  from `PUBLIC_ORIGIN` / `ONION_HOSTNAME` where configured.
- #1 (workflow permissions) — `lint-secrets.yml` now declares
  `permissions: contents: read`.
- #8, #5, #4, #3, #2 — cosmetic/code-smell fixes (redundant service-worker
  check, escaping order, no-op replace, non-backtracking trailing-slash strip).
