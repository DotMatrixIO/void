# Base image is pinned by version tag here for the dev-loop. The release
# pipeline (.github/workflows/release.yml) rewrites this FROM line to the
# digest form `node:22.12.0-slim@sha256:<digest>` recorded in
# .docker-base-digest before building the published image, so the
# released bytes are reproducible from a known digest even though the
# floating tag may move under us between releases.
FROM node:22.12.0-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213 AS base
# The base image is pinned by digest (manifest-list / OCI image index)
# from `.docker-base-digest`, which is the single source of truth.
# The release workflow asserts the FROM line and `.docker-base-digest`
# agree before building; rotation is a coordinated edit of both.
#
# pnpm version MUST match `packageManager` in package.json and the
# `pnpm/action-setup` version pinned across every workflow under
# .github/workflows/. A mismatch produces silently-different lockfile
# resolutions and breaks reproducibility. The release workflow asserts
# `pnpm --version` matches `packageManager` and fails closed otherwise.
# node:22.12.0-slim bundles corepack 0.29.4, which predates pnpm's npm
# registry signing-key rotation and fails `corepack prepare` with
# "Internal Error: Cannot find matching keyid". Pin a corepack that carries
# the rotated keys (updated upstream in corepack 0.31.0) BEFORE enabling it,
# so package-manager signature verification stays intact — we deliberately
# do NOT disable it with COREPACK_INTEGRITY_KEYS=0 (a supply-chain
# regression). Keep this pin in lockstep with the same install in
# README-selfhost.md's rebuild recipe and .github/workflows/release.yml.
RUN npm install -g corepack@0.34.5 && corepack enable && corepack prepare pnpm@10.26.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/void-client/package.json artifacts/void-client/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-client-react/package.json lib/api-client-react/
# void-client depends on these two workspace packages (workspace:*); their
# manifests must be present so `pnpm install` creates the node_modules symlinks
# it resolves at build time. Omitting them leaves @workspace/wire-core and
# @workspace/signaling-types unresolved when the frontend bundles.
COPY lib/wire-core/package.json lib/wire-core/
COPY lib/signaling-types/package.json lib/signaling-types/
RUN pnpm install --frozen-lockfile --prod=false

FROM deps AS frontend
COPY artifacts/void-client/ artifacts/void-client/
# Repo-root build inputs the void-client build reads directly (they are NOT
# under artifacts/void-client/): sync-fragments.mjs splices
# docs/_fragments/*.md into VOID_TECHNICAL_OVERVIEW.md, and the `@docs` Vite
# alias resolves to repo-root docs/ (pages import @docs/_fragments/*.md?raw).
# Without these the frontend build fails with ENOENT on the fragment files.
COPY docs/ docs/
COPY VOID_TECHNICAL_OVERVIEW.md ./
# artifacts/void-client/tsconfig.json does `extends: "../../tsconfig.base.json"`;
# esbuild/vite resolve that during the build, so the repo-root base tsconfig
# must be present or the build fails resolving the "extends" chain.
COPY tsconfig.base.json ./
# Source of the workspace packages void-client bundles. Their `exports` map
# points straight at ./src/index.ts (no prebuilt dist), so Vite compiles them
# from source and needs the actual sources here — the deps stage only supplied
# their package.json for symlinking. Vite also parses each symlinked package's
# tsconfig.json while loading config, so a missing one ENOENTs the build; copy
# all of lib/ so every resolvable package carries its tsconfig.
COPY lib/ lib/
ENV PORT=3000
ENV BASE_PATH=/
# NODE_ENV defaults to production — the canonical / release build path, where
# the onion-bake guard below is ON and fails closed on a missing onion host.
# docker-compose forwards the operator's .env NODE_ENV into this arg so a
# local clearnet-only smoke test (NODE_ENV=development, the Quick Start) can
# build without an onion address: the guard relaxes only when NODE_ENV is not
# "production" (see artifacts/void-client/vite.config.ts).
ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV
# Bake the v3 .onion mirror host into the production bundle. The build guard
# (artifacts/void-client/src/lib/onionHost.ts, wired in vite.config.ts) fails
# LOUDLY when this is unset/malformed under NODE_ENV=production, so a clearnet
# release that forgot the onion mirror cannot ship a silently-inert affordance.
# docker-compose forwards this from VITE_VOID_ONION_HOST in your .env; for a
# manual build supply: docker build --build-arg VITE_VOID_ONION_HOST=<56-char-base32>.onion
ARG VITE_VOID_ONION_HOST=""
ENV VITE_VOID_ONION_HOST=$VITE_VOID_ONION_HOST
# Absolute origin baked into social-card metadata (og:image / og:url). The OG
# page generator (artifacts/void-client/scripts/gen-og-pages.mjs) fails closed
# under NODE_ENV=production if neither PUBLIC_ORIGIN nor REPLIT_DOMAINS is set,
# because relative OG URLs are rejected by Facebook/X/Slack/iMessage and would
# silently break every social preview. docker-compose forwards this from
# PUBLIC_ORIGIN in your .env; for a manual build supply:
# docker build --build-arg PUBLIC_ORIGIN=https://your-domain.example
ARG PUBLIC_ORIGIN=""
ENV PUBLIC_ORIGIN=$PUBLIC_ORIGIN
RUN pnpm --filter @workspace/void-client run build

FROM deps AS backend
# Build-time provenance inputs consumed by artifacts/api-server/build.mjs
# (task #383). When unset, build.mjs falls back to `git rev-parse` (which
# is unavailable inside this stage because .dockerignore excludes .git)
# and writes `gitSha: "unknown"` plus an empty `sha256sums`. The release
# workflow MUST pass these via `--build-arg` so the BUILD_INFO.json baked
# into the image matches what the server is actually serving — without
# them, `/api/proof/build` returns a useless placeholder.
ARG GIT_SHA=""
ARG GIT_SHA_SHORT=""
ARG RELEASE_TAG=""
ARG BUILD_TIMESTAMP=""
ENV GIT_SHA=$GIT_SHA
ENV GIT_SHA_SHORT=$GIT_SHA_SHORT
ENV RELEASE_TAG=$RELEASE_TAG
ENV BUILD_TIMESTAMP=$BUILD_TIMESTAMP
# Pull in the void-client bundle the backend will be serving, so
# build.mjs can hash it and inline the per-file sha256 map into
# dist/BUILD_INFO.json. CLIENT_DIST_DIR points build.mjs at the absolute
# path inside this stage.
COPY --from=frontend /app/artifacts/void-client/dist/public ./artifacts/void-client/dist/public
ENV CLIENT_DIST_DIR=/app/artifacts/void-client/dist/public
COPY artifacts/api-server/ artifacts/api-server/
# All workspace lib sources api-server bundles. Their `exports` point at
# ./src/index.ts (no prebuilt dist), and api-server imports @workspace/wire-core
# (plus api-zod/api-spec/api-client-react/signaling-types), so esbuild resolves
# them from source here. Repo-root tsconfig.base.json is the `extends` target of
# those packages' tsconfig.json — without it esbuild warns and drops its config.
COPY tsconfig.base.json ./
COPY lib/ lib/
RUN pnpm --filter @workspace/api-server run build

FROM node:22.12.0-slim@sha256:35531c52ce27b6575d69755c73e65d4468dba93a25644eed56dc12879cae9213 AS production
WORKDIR /app
COPY --from=backend /app/artifacts/api-server/dist ./dist
COPY --from=frontend /app/artifacts/void-client/dist/public ./client
# StartOS config shim. Plain-Docker / Umbrel deployments keep using the CMD
# below (env comes straight from docker-compose), so this file sits unused for
# them. On StartOS the manifest's `main.entrypoint` runs this shim instead: it
# reads the operator's settings written by `config.set` to
# /root/start9/config.yaml and exports them as env vars before importing the
# server. See manifest.yaml `config:` and assets/config_spec.yaml.
COPY deploy/startos/docker_entrypoint.mjs ./docker_entrypoint.mjs
# Build provenance: copied into the image so /proof/build can serve them
# without re-reading from a mutable filesystem location at request time.
COPY --from=backend /app/artifacts/api-server/dist/BUILD_INFO.json ./BUILD_INFO.json
ENV NODE_ENV=production
ENV SERVE_STATIC=1
ENV CLIENT_DIST=./client
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node
CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
