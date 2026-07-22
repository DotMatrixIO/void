---
name: CSP change fan-out & WASM requirement
description: What must move in lockstep when the api-server helmet CSP changes, and why script-src needs 'wasm-unsafe-eval' + startup-computed inline hashes.
---

# CSP change fan-out

Changing any helmet CSP directive in the api-server fans out to ALL of:

- Two byte-exact `EXPECTED_CSP` pins: `src/__tests__/security-headers.test.ts` and `security-headers-proxy.test.ts` (both run WITHOUT `SERVE_STATIC`, so they never contain the inline-script hashes).
- `scripts/smoke-serve-static.mjs` — asserts the served header end-to-end (including the exact sha256 of its sentinel inline script).
- `docs/client-threat-model.md` — quotes the CSP value AND hardcodes `app.ts` line ranges in §3/§4/§5 tables; inserting lines into app.ts silently stales those refs.
- Onion parity: every source must stay host-free (`'self'`, scheme keywords, quoted keywords, sha256 hashes — base64 has no dots) or `onion-location.test.ts` fails on TLD substrings.

# Why script-src is not just 'self'

`script-src 'self'` alone bricks every single-origin (`SERVE_STATIC=1`) install:

- **Why:** room-key derivation runs argon2id compiled to WebAssembly (hash-wasm); browsers refuse WASM compilation without `'wasm-unsafe-eval'` (WASM-only — JS eval stays blocked). Also the built index.html carries an inline SRI-diagnostic script that needs a `'sha256-…'` hash (no `'unsafe-inline'`). Dev (Vite, no helmet) never shows the bug.
- **How to apply:** inline hashes are computed once at startup from `CLIENT_DIST/*.html`; a client rebuild needs a server restart to refresh them (noted in README-selfhost). Tests without SERVE_STATIC see no hashes by design.
