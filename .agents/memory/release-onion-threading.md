---
name: release.yml onion-host threading
description: How VITE_VOID_ONION_HOST must be threaded through the release pipeline and why.
---

# release.yml onion-host threading

release.yml builds void-client at NODE_ENV=production in **four** places, all of
which trip the onion-bake guard (onionHost.ts via vite.config.ts, fails closed):
`build-and-sign` void-client build, the api-server **Docker build-arg** (frontend
stage builds prod), `reproducibility-check` clean rebuild, and the advisory
`reproducibility-check-arm64` rebuild.

**Rule:** VITE_VOID_ONION_HOST is a single workflow-level `env:` sourced from a
repo **variable** (`${{ vars.VITE_VOID_ONION_HOST }}` — public address, NOT a
secret) and referenced identically in all four paths + the docker build-arg.

**Why:** the value is an input to the bundle bytes, so any divergence between the
build-and-sign job and the clean rebuild breaks the byte-for-byte
reproducibility diff and the release refuses to publish. Keep it in lockstep the
same way the corepack pin (0.34.5) is kept across Dockerfile/README/release.

**How to apply:** if the variable is unset the release fails closed by design;
operator sets it to the canonical .onion. The README §7a "Rebuild from the
recipe" must also pass the host (a bare NODE_ENV=production rebuild trips the
guard). Dockerfile already declares `ARG VITE_VOID_ONION_HOST` in the frontend
stage.
