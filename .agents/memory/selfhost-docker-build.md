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

## Known residual gap (out of scope, propose as follow-up)
release.yml has ZERO onion handling; its production Docker build + reproducibility check
(and the README "Rebuild from the recipe" snippet at NODE_ENV=production) will fail the
onion guard once a production onion host is expected. Wiring VITE_VOID_ONION_HOST into
release.yml + the rebuild recipe is a separate task.
