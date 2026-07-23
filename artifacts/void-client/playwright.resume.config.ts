// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Separate Playwright configuration for the paywall resume-flow end-to-end
// test (paywall-resume-flow.spec.ts). Kept isolated from the main
// playwright.config.ts because this suite requires a running API server
// alongside the Vite dev server — the main config's webServer array has
// no API server, and adding one there would spin it up for every spec,
// including the many that intercept /api/* routes and would be affected.
//
// What this config provides:
//   webServer[0] — Vite dev server (same as the main config, PORT=5173)
//   webServer[1] — API server in mock-Lightning / jitter-disabled / dev mode
//                   so the /api/paywall/* routes, including the test-only
//                   POST /api/paywall/dev-pay/:hash endpoint, are live and
//                   the payment simulation needs no fetch-level interception.
//
// Run with:
//   pnpm --filter @workspace/void-client run test:playwright:resume
//
// The spec is intentionally excluded from the main config (it appears in
// testIgnore of every layout project, and there is no paywall-resume project
// in the main config). This config is the only way to execute it.

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 5173);
const BASE_PATH = process.env.BASE_PATH ?? "/";

// API_PORT must match vite.config.ts's hardcoded API_PORT = 8080.
const API_PORT = 8080;

const PAYWALL_RESUME_SPEC = /paywall-resume-flow\.spec\.ts/;

export default defineConfig({
  globalSetup: "./scripts/bridge-playwright-browsers.mjs",
  testDir: "./tests/playwright",
  testMatch: PAYWALL_RESUME_SPEC,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"], ["./scripts/min-specs-reporter.mjs"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH.replace(/\/$/, "")}`,
    trace: "off",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "paywall-resume-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      // Vite dev server — same command as the main config so both
      // reuseExistingServer: true correctly detects a running instance.
      command: `PORT=${PORT} BASE_PATH=${BASE_PATH} pnpm run dev`,
      url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // API server in mock-Lightning / jitter-disabled / development mode.
      // PORT=API_PORT (8080) matches the hardcoded API_PORT in vite.config.ts
      // so the Vite proxy at /api → http://localhost:API_PORT routes to it.
      // PAYWALL_JITTER_DISABLE=1 skips the 10–60s M-04 settlement delay so
      // the spec does not hang waiting for a random jitter window.
      // NODE_ENV=development is needed so the api-server script exports it
      // (the api-server dev script sets it itself, but the pnpm filter form
      // runs in a child shell where the outer env is the parent).
      command: `LIGHTNING_BACKEND=mock PAYWALL_JITTER_DISABLE=1 NODE_ENV=development PAYWALL_ALLOW_EPHEMERAL_SECRET=1 PORT=${API_PORT} pnpm --filter @workspace/api-server run dev`,
      url: `http://127.0.0.1:${API_PORT}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      // api-server dev = build (esbuild, fast) + start; allow extra time.
      timeout: 90_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
