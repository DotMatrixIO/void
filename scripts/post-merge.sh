#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push

# Build the composite shared libs (signaling-types, api-zod, api-client-react)
# up front. Their declaration output lives in gitignored `dist/` dirs, so a
# fresh checkout has none. Consuming packages typecheck against those built
# .d.ts files (not the libs' source), so any per-artifact typecheck gate would
# otherwise fail with TS6305 until someone ran a manual lib build. Each
# artifact's `typecheck` script also rebuilds the libs first, so this is a
# belt-and-suspenders warm-up — `tsc --build` is incremental and no-ops once
# the dist is fresh.
pnpm run typecheck:libs

# Task #664: the void-client Playwright suite has an OPT-IN cross-engine
# flow gate under Firefox. Firefox is not on the base image (Chromium and
# WebKit are) and crashes navigating the joined-call route on this
# container even once installed, so the `flow-firefox` project only runs
# when PLAYWRIGHT_FIREFOX=1 is set (see
# artifacts/void-client/playwright.config.ts). Match that here: only fetch
# the binary when Firefox is actually enabled, so the canonical merge stays
# fast and does not pull an engine it cannot run. `playwright install` is
# idempotent — it no-ops when the binary is already cached.
if [ "${PLAYWRIGHT_FIREFOX:-}" = "1" ]; then
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
    pnpm --filter @workspace/void-client exec playwright install firefox
fi
