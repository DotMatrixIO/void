---
name: TOR_ONLY runtime posture
description: What TOR_ONLY=1 actually does at runtime in the api-server, and the doc/guard surfaces that must move in lockstep.
---
The StartOS Tor-only switch's load-bearing part is still the manifest edit removing `lan-config`, but `TOR_ONLY=1` now keys runtime behavior in the api-server (it was previously a reserved no-op contract).

Behavior (in `artifacts/api-server/src/lib/torOnly.ts`, wired into `src/index.ts` + `src/routes/ice-servers.ts`):
- `isTorOnly` matches the LITERAL `"1"` only — not "true", not " 1 ". A typo must NOT silently flip ICE behavior.
- `/api/ice-servers` omits any configured `STUN_URL` under TOR_ONLY in BOTH branches (TURN-configured AND the no-TURN fail-closed branch). Rationale: a STUN binding request leaks each peer's public IP to a clearnet third party during ICE gathering, same disclosure class the no-Google-fallback rule (#372) prevents. TURN relay is still advertised.
- `turnUrlTerminatesOverTor` requires BOTH `turns:` scheme AND `.onion` host (Tor carries TCP; .onion keeps it off clearnet). Startup warns if TURN_URL set but fails this.

**Why:** an onion-only operator is trying to avoid clearnet IP disclosure; STUN/clearnet-TURN fallbacks defeat that.

**How to apply:** any NEW clearnet ICE source (e.g. the Cloudflare-TURN branch in ice-servers.ts — currently NOT gated, see follow-up) must also respect TOR_ONLY. The `TOR_ONLY` literal is pinned by `check-onion-mirror-sync.mjs` in manifest.yaml + umbrel-app.yml — keep the substring when editing those. Doc homes that describe the behavior: manifest-review-2026-05.md §4.2, README-selfhost.md §5 table + §6b, manifest.yaml alerts.start, umbrel-app.yml releaseNotes.

**Posture attestation surface (`lib/torPosture.ts` + `/api/proof/posture`):** the user-verifiable attestation derives `iceStunSuppressed` as EXACTLY `isTorOnly(env)` — it mirrors the ice-servers.ts suppression gate rather than asserting an independent flag, so if you ever change WHAT condition suppresses STUN you must change torPosture in lockstep or the attestation lies. The `.onion` host regex (`/^[a-z2-7]{16,}\.onion$/i`) is now SHARED: `isValidOnionHostname` lives in torPosture.ts and `app.ts` imports it (single source for Onion-Location emission + the attestation). The endpoint is served `Cache-Control: no-store` because posture is runtime-mutable (TOCTOU) — never cache it. The response `caveat` names the non-claims (un-modified binary, time-of-check/time-of-use, upstream logging proxy); the client surface is the POSTURE ATTESTATION block in RuntimeProofPage.tsx and the procedure doc is README-selfhost.md §7a "Verify the onion-only posture". `/proof/*` routes are NOT in openapi.yaml, so no overview-http-drift edit needed.
