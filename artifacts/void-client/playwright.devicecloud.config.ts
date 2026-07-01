// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "@playwright/test";

/**
 * Task #667 — Device-cloud Safari WebRTC config.
 *
 * Separate from `playwright.config.ts` because this suite does NOT launch a
 * local browser or a local dev server. It connects Playwright to a *real*
 * Safari/WebKit on a device-cloud provider (BrowserStack by default) via
 * `webkit.connect()` and drives a publicly reachable target URL (the cloud
 * browser cannot see `localhost`). See tests/playwright/lib/device-cloud.ts.
 *
 * The default config's local projects (chromium/firefox/webkit) and its
 * `webServer` are intentionally absent here — the spec owns its own remote
 * connection and skips cleanly when the device cloud is unconfigured, so
 * this config is safe to run anywhere.
 *
 * Run with:
 *   pnpm --filter @workspace/void-client run test:playwright:devicecloud
 */

const DEVICE_CLOUD_SPEC = /safari-webrtc-devicecloud\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/playwright",
  testMatch: DEVICE_CLOUD_SPEC,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Remote grid boot + real-device sessions are slow; the spec also sets
  // its own per-test timeout. This is the outer ceiling.
  timeout: 180_000,
  reporter: [["list"]],
  use: {
    trace: "off",
  },
});
