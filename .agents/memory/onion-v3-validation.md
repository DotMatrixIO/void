---
name: onion v3 validation + build guard
description: Where the single-source-of-truth .onion v3 host check lives and the test-fixture fan-out a stricter rule triggers.
---

# Onion v3 host validation (single source of truth)

`artifacts/void-client/src/lib/onionHost.ts` is the ONE definition of a valid
Tor v3 `.onion` host: exactly 56 base32 `[a-z2-7]` chars before `.onion`
(`ONION_V3_LABEL_RE`). It is consumed by BOTH:
- runtime: `lib/origin.ts` `hostnameIsOnion` (→ `onionMirror.ts`, `StartScreen.tsx`)
- build time: `vite.config.ts` onion-bake guard (`assertOnionBake`).

**Build guard shape:** `vite.config.ts` is `defineConfig(async ({ command }) => ...)`
and can import TS from `./src/lib/...` directly (esbuild bundles the config). The
guard fires only when `command === "build" && (NODE_ENV==="production" ||
VOID_REQUIRE_ONION==="1")`.

**CRITICAL — the validation harness injects `NODE_ENV=production` into every build.**
A bare `npx vite build` from the shell has NODE_ENV unset (guard dormant), so it is
NOT a faithful reproduction. But `void-client-tests` (`STRICT_SRI=1 … run test`,
which does `pnpm run build` first) runs under harness `NODE_ENV=production`, so any
production-gated build guard FIRES in that smoke build. To reproduce locally,
prefix with `NODE_ENV=production`. Same applies to the Dockerfile frontend stage
(`ENV NODE_ENV=production`) and the autoscale deploy build.
**How CI is satisfied (mirrors check-repo-url):** the `void-client` `test` script
defaults `VITE_VOID_ONION_HOST` to the canonical 56-char example (alongside its
`PORT`/`BASE_PATH` defaults) so the smoke build passes; the Dockerfile exposes
`ARG VITE_VOID_ONION_HOST` (empty default → still fail-closed) so a real release
supplies it via `--build-arg`. Real production with the value unset still fails
loudly — the guard stays unconditionally active, CI just feeds it a value, exactly
as a real `REPO_URL` in source satisfies the production-gated check-repo-url.

**Why fail-closed:** the onion affordance returns `null` on a missing/malformed
`VITE_VOID_ONION_HOST` and renders nothing — a "Tor-reachable" bundle whose onion
link is silently inert. The guard converts that into a loud build failure.

## Gotcha: tightening the rule fans out across ~8 test files
`.onion` host fixtures are scattered. The api-server side (`app.ts`
`/^[a-z2-7]{16,}\.onion$/i`) is SEPARATE and out of scope. The canonical valid v3
fixture already used in several specs is
`voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion` (56 chars) — reuse
it. When making the client rule stricter, audit every `*.test.*` for onion host
literals (scan label-before-`.onion` length + base32) and replace short/long/
non-base32 ones, or those suites break. `opts.onion` matches are false positives
(`opts.onionOrigin`); prose like `auto-relay-only-on-.onion` is not a host.
