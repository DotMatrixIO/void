---
name: Self-host Docker build (docker compose up --build)
description: Non-obvious constraints of the staged Dockerfile / docker-compose self-host path for VOID
---

# Self-host container build & first-run

The canonical self-host path is `docker compose up -d --build` from a fresh checkout,
serving at localhost:3000 with ONLY `.env` edits (no Dockerfile/compose hand-patching).
release.yml builds the same Dockerfile, so a breakage here reddens releases identically.

## corepack signing-key failure
`node:22.12.0-slim` bundles corepack 0.29.4, which predates pnpm's npm-registry
signing-key rotation and dies with "Cannot find matching keyid" on
`corepack prepare pnpm@10.26.1`. Fix = `npm install -g corepack@0.34.5` BEFORE
`corepack enable` (rotated keys landed in corepack 0.31.0). Keep signature
verification ON (do NOT set COREPACK_INTEGRITY_KEYS=0). This same line must stay in
lockstep in THREE places: Dockerfile base stage, README-selfhost rebuild recipe,
and release.yml's "Install build deps in the clean container" step.

## Staged build needs repo-root + all workspace lib SOURCE, not just void-client
The `frontend`/`backend` stages copy per-package, which repeatedly under-copies:
- `docs/` + `VOID_TECHNICAL_OVERVIEW.md` (sync-fragments + `@docs` alias read them).
- `tsconfig.base.json` — void-client AND lib tsconfigs `extends: "../../tsconfig.base.json"`;
  esbuild/vite resolve it during config load (warning in backend, fatal for frontend).
- **All `lib/` SOURCE** (`COPY lib/ lib/`). Workspace pkgs export `./src/index.ts`
  (no prebuilt dist, and `.dockerignore` excludes dist anyway), so vite/esbuild compile
  them from source. Vite ALSO parses every symlinked workspace pkg's tsconfig.json while
  loading config → a missing one ENOENTs the frontend build even for pkgs void-client
  doesn't import directly (e.g. api-client-react).
- deps stage must `COPY` the package.json of EVERY workspace pkg the targets depend on
  (void-client → wire-core + signaling-types were missing) so pnpm creates the
  node_modules symlinks; otherwise `@workspace/*` is unresolved at bundle time.

## Runtime NODE_ENV must stay production in the container
The production image is an esbuild-bundled artifact with NO node_modules. The pino logger
uses a `pino-pretty` worker-thread transport whenever `NODE_ENV !== "production"`, which
requires resolving pino-pretty from node_modules at runtime → MODULE_NOT_FOUND crash loop
(symptom surfaces as thread-stream `_flushSync took too long (10s)`, swallowing the real
log). So docker-compose pins runtime `NODE_ENV: production`. The operator's `.env`
`NODE_ENV` instead flows into the BUILD arg only, where it drives the onion-bake guard:
`development` relaxes the guard for a clearnet-only smoke build; `production` fails closed
without `VITE_VOID_ONION_HOST`. Build knob vs. runtime posture are deliberately separate.

## Onion guard is fail-closed by design
`vite.config.ts` → `assertOnionBake(VITE_VOID_ONION_HOST)` throws when
`NODE_ENV==="production" || VOID_REQUIRE_ONION==="1"` and the host is unset/not a valid
v3 (56 base32) host. There is intentionally NO "disable" escape — the only relax lever is
`NODE_ENV != production`. compose forwards `VITE_VOID_ONION_HOST` from `.env` as a build arg.

## Production build has a CHAIN of fail-closed guards, not just the onion one
Under `NODE_ENV=production` the void-client build fails closed in sequence, each needing a
distinct env var wired through Dockerfile ARG/ENV + compose build.args (compose only
forwards the args it lists — `.env` alone never reaches a build stage):
- `VITE_VOID_ONION_HOST` — onion-bake guard (vite.config).
- `PUBLIC_ORIGIN` — `gen-og-pages.mjs` refuses relative og:image/og:url when
  `NODE_ENV=production || OG_STRICT=1` and neither PUBLIC_ORIGIN nor REPLIT_DOMAINS is set.
  There is NO relax lever that keeps the onion bake (OG_STRICT=0 doesn't help — production
  alone arms it). Was UNWIRED originally (Dockerfile/compose/README never mentioned it), so
  the documented canonical production build was impossible; now wired.
- `PORT` — vite.config reads it at CONFIG-LOAD time (before the build), so even a local
  `pnpm --filter void-client build` throws "PORT environment variable is required" without
  it. Dockerfile sets `ENV PORT=3000`, so the container build is fine; only bare local runs
  trip this. To validate a prod build locally: set NODE_ENV=production PORT=3000 BASE_PATH=/
  VITE_VOID_ONION_HOST=<56 a's>.onion PUBLIC_ORIGIN=https://x.example.

## Byte-affecting production build inputs must match across ALL release contexts
`VITE_VOID_ONION_HOST` (onion affordance) and `PUBLIC_ORIGIN` (OG page HTML) are both
baked into void-client bundle bytes, and a production build fails closed without them.
Rule: source each from a public GitHub repo VARIABLE (`vars.*`, not a secret — both
ship publicly) and inject the IDENTICAL value into every release build context — each
release.yml build step (build-and-sign, both reproducibility-check rebuilds), the Docker
build-args, and void-client-sri.yml — or the byte-for-byte reproducibility diff fails
for configuration skew rather than true nondeterminism. Any new production build path
must carry BOTH. Operator must have the `PUBLIC_ORIGIN` repo variable set.
