// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #1042 — Real-browser gate for the home-screen CLEARNET PATH badge +
// one-click .onion switch (added to the StartScreen header in Task #1027).
//
// Task #1054 — Extended to run under WebKit (Safari engine) too, not just
// Chromium. VOID's most security-sensitive target is Safari, so the same
// behaviour must be verified there. The `.onion`-origin suppression case
// used to depend on Chromium's `--host-resolver-rules` flag (WebKit has no
// equivalent); it now uses Playwright request interception, which works
// identically in every engine — see `routeOnionOriginToLocalhost` below.
//
// Task #1027 was covered only by jsdom unit tests
// (src/__tests__/clearnetPathIndicator.test.tsx, against RoomPage's in-call
// header). jsdom has no real layout, so a badge could be hidden by CSS and
// still pass `toBeVisible()` there, and the `.onion`-origin suppression path
// could only be faked by overwriting `window.location`. This spec proves, in
// a genuine browser, that:
//
//   1. On a CLEARNET origin with a `.onion` mirror published, the home-screen
//      header renders the `clearnet-path-indicator` ("CLEARNET PATH") badge
//      and the `onion-copy-offer` ("Copy our .onion") switch TOGETHER, the
//      positive `tor-onion-indicator` is absent, and (Chromium only) the copy
//      switch writes the mirror URL to the clipboard (the one-click switch
//      works).
//   2. On the `.onion` ORIGIN, the clearnet badge + copy switch are
//      suppressed and the positive `tor-onion-indicator` ("Connected via Tor
//      onion") badge shows instead.
//
// How the two origins are produced (see playwright.config.ts):
//   - The dev server for this gate runs with VITE_VOID_ONION_HOST set to a
//     real v3 `.onion` host, so the mirror affordance is live.
//   - Case 1 loads the server over `http://127.0.0.1:<port>` (clearnet).
//   - Case 2 navigates to the SAME server over `http://<onion-host>:<port>`.
//     The browser would normally fail to resolve that host; instead a
//     Playwright route handler (`routeOnionOriginToLocalhost`) intercepts
//     every request to the `.onion` origin BEFORE the browser performs DNS
//     and transparently re-fetches it from 127.0.0.1. The page still sees
//     `window.location.hostname` === the onion host, so `isOnionOrigin()`
//     returns true — and unlike `--host-resolver-rules`, this works in
//     Chromium AND WebKit.
//
// The header only renders in StartScreen's full-frame (non-chromeless) form;
// the landing page embeds it `chromeless` (header hidden), so the spec drives
// the DEV-only `/__test/start-screen` route (registered in src/App.tsx) which
// mounts the full-frame StartScreen with the real global stylesheet.

import { test, expect, type Page } from "@playwright/test";

// Mirror the derivation in playwright.config.ts so the spec can build the
// `.onion`-origin URL against the onion-mirror dev server.
const PORT = Number(process.env.PORT ?? 5173);
const ONION_PORT = PORT + 100;
const BASE_PATH = process.env.BASE_PATH ?? "/";
const ONION_HOST =
  "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";

const ROUTE = `${BASE_PATH.replace(/\/$/, "")}/__test/start-screen`;
// The expected mirror URL the copy switch writes: onionMirrorUrl in
// StartScreen normalises the env value (no scheme) to `http://<host>/`.
const EXPECTED_MIRROR_URL = `http://${ONION_HOST}/`;
// Full URL that loads the onion-mirror server over the `.onion` origin.
// `routeOnionOriginToLocalhost` re-points it at 127.0.0.1 at the network
// layer (the host itself never resolves).
const ONION_ORIGIN_URL = `http://${ONION_HOST}:${ONION_PORT}${ROUTE}`;

// Engine-agnostic replacement for Chromium's `--host-resolver-rules` trick.
// Intercept every request the page makes to the `.onion` origin and
// transparently re-fetch it from the local onion-mirror dev server on
// 127.0.0.1. Playwright pauses each request BEFORE the browser performs
// DNS, so the non-resolvable `.onion` host never reaches the network — yet
// the document is loaded under the onion URL, so `window.location.hostname`
// is the onion host and `isOnionOrigin()` returns true. Works the same in
// Chromium and WebKit, so the `.onion` suppression case is verified on both
// without any Chromium-only flag.
//
// Scoped to the onion host on ONION_PORT (the nav + Vite asset/module
// requests). The header's onion-reachability probe fetches the mirror on
// port 80, which is deliberately NOT intercepted, so it stays inconclusive
// (no "requires Tor Browser" hint) — matching the Chromium baseline where
// nothing listens on 127.0.0.1:80 either.
async function routeOnionOriginToLocalhost(page: Page): Promise<void> {
  await page.route(
    (url) =>
      url.hostname === ONION_HOST && url.port === String(ONION_PORT),
    async (route) => {
      const local = new URL(route.request().url());
      local.hostname = "127.0.0.1";
      const response = await route.fetch({ url: local.toString() });
      await route.fulfill({ response });
    },
  );
}

test.describe("home-screen clearnet path indicator + .onion switch", () => {
  test("clearnet origin: CLEARNET PATH badge and the copy-.onion switch render together and the switch works", async ({
    page,
    browserName,
  }) => {
    // baseURL points at the onion-mirror dev server on 127.0.0.1 (clearnet).
    await page.goto(ROUTE);

    const badge = page.getByTestId("clearnet-path-indicator");
    const copyOffer = page.getByTestId("onion-copy-offer");

    // The badge and the one-click switch must be genuinely on-screen together.
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveText(/CLEARNET PATH/);
    await expect(copyOffer).toBeVisible();
    await expect(copyOffer).toHaveText(/Copy our \.onion/);

    // The positive Tor badge must NOT also fire on a clearnet origin.
    await expect(page.getByTestId("tor-onion-indicator")).toHaveCount(0);

    // The one-click switch copies the .onion mirror URL to the clipboard and
    // flips to its confirmed state. localhost is a secure context, so the
    // real clipboard path (not the fallback) is exercised. The clipboard
    // round-trip is verified on Chromium only: WebKit/Playwright does not
    // support the clipboard-read/-write permissions this assertion needs, so
    // under WebKit the badge+switch render coverage above is the gate (the
    // clipboard write path itself is unit-tested in
    // src/__tests__/clearnetPathIndicator.test.tsx).
    if (browserName === "chromium") {
      await copyOffer.click();
      await expect(copyOffer).toHaveText(/Copied \.onion/, { timeout: 5_000 });
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      expect(clip).toBe(EXPECTED_MIRROR_URL);
    }
  });

  test(".onion origin: the clearnet badge is suppressed and the positive Tor badge shows instead", async ({
    page,
  }) => {
    // Load the SAME dev server over the `.onion` origin; the route handler
    // re-points every request at 127.0.0.1 (works in Chromium and WebKit).
    await routeOnionOriginToLocalhost(page);
    await page.goto(ONION_ORIGIN_URL);

    // The positive "Connected via Tor onion" badge confirms isOnionOrigin().
    const torBadge = page.getByTestId("tor-onion-indicator");
    await expect(torBadge).toBeVisible({ timeout: 15_000 });
    await expect(torBadge).toHaveText(/Connected via Tor onion/);

    // On the .onion origin the clearnet badge + copy switch are suppressed —
    // the positive badge covers the path state instead.
    await expect(page.getByTestId("clearnet-path-indicator")).toHaveCount(0);
    await expect(page.getByTestId("onion-copy-offer")).toHaveCount(0);
  });
});
