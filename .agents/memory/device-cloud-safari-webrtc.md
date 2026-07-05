---
name: Device-cloud Safari WebRTC
description: How/why void-client automates genuine Safari WebRTC on a device cloud instead of headless WebKit.
---
Headless Linux WebKit (Playwright's WPE/GTK port) does NOT gather ICE candidates, so the local
cross-engine flow gate must skip the loopback RTCPeerConnection probe on WebKit. Genuine Safari
WebRTC is automated by connecting Playwright to a real Safari on a device cloud
(`webkit.connect(wsEndpoint)`), default provider BrowserStack (`cdp.browserstack.com/playwright`,
`browser: playwright-webkit`, real macOS).

**Why macOS Safari, not iOS:** Playwright-over-CDP does not drive real iOS devices — iOS needs
Appium/App Automate. macOS Safari is the portable default and is still genuine WebKit.

**How to apply:**
- The suite (`tests/playwright/safari-webrtc-devicecloud.spec.ts`, config
  `playwright.devicecloud.config.ts`, script `test:playwright:devicecloud`) reads credentials +
  target URL from env and SKIPS cleanly (exit 0, never a false PASS) when unconfigured. Don't make
  it hard-fail on missing secrets.
- The cloud browser can't see localhost — it needs a public target URL (DEVICE_CLOUD_TARGET_URL or
  REPLIT_DEV_DOMAIN). The masked-output assertion needs the DEV-only `/__test/joined-call` route, so
  it self-skips against a production target.
- The spec lives in the same testDir as the local specs; exclude it from the default config's local
  layout projects via `testIgnore: [FLOW_SPEC, DEVICE_CLOUD_SPEC]` or the layout projects pick it up.
