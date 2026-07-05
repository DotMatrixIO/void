// SPDX-License-Identifier: AGPL-3.0-or-later
// Media page content gate. The two demo-video embeds and the NO-claims
// refusal band were moved off the landing page and now live only on
// /media (see MediaPage.tsx). A jsdom component test (MediaPage.test.tsx)
// pins their DOM order and copy, but it cannot see real-browser routing
// or layout. This e2e guard navigates to /media in a real engine and
// asserts that the route actually renders:
//
//   1. The "What VOID refuses" refusal band.
//   2. The biometric split-screen demo embed, surfaced as its
//      click-to-play poster button.
//
// It mirrors the way cross-engine-flow.spec.ts guards the landing
// host/join controls — catching routing or layout regressions jsdom
// can't. It runs under the dedicated media-chromium / media-webkit
// projects (playwright.config.ts); Firefox is not installed on Replit,
// so it is intentionally not part of this gate.

import { test, expect } from "@playwright/test";

// The demo embed renders in its poster (click-to-play) state on load.
// DemoVideoEmbed surfaces each poster as a button labelled
// `Play ${ariaLabel}`, so we match on that exact aria-label.
const BIOMETRIC_DEMO_LABEL =
  "Play Split-screen demo: a normal webcam call on the left, what VOID transmits on the right";

// After a poster is clicked DemoVideoEmbed swaps the poster button for a
// sandboxed <iframe title={ariaLabel} src={iframeSrc}>. We match the iframe
// by its title (the ariaLabel without the "Play " prefix) and assert its src
// resolves to the expected demo-video artifact route.
const BIOMETRIC_DEMO_TITLE =
  "Split-screen demo: a normal webcam call on the left, what VOID transmits on the right";

// The MediaPage wires the embed to the demo-video artifact at this route
// (see MediaPage.tsx). DemoVideoEmbed passes iframeSrc straight through to the
// iframe's src, so the mounted element's src must contain this path.
const BIOMETRIC_IFRAME_SRC = "/biometric-demo-video/";

test.describe("media page content", () => {
  test("renders the refusal band and the demo embed", async ({ page }) => {
    await page.goto("/media");

    // The refusal band: the NO-claims surface moved off the landing page.
    // It is the load-bearing reason /media exists, so if the route fails
    // to render it the page is broken.
    await expect(
      page.getByRole("region", { name: "What VOID refuses" }),
    ).toBeVisible({ timeout: 15_000 });

    // The demo embed, surfaced as its click-to-play poster button.
    await expect(
      page.getByRole("button", { name: BIOMETRIC_DEMO_LABEL }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // The poster→iframe transition is the load-bearing behaviour: the
  // click-to-play state is inert until clicking the poster actually mounts the
  // playing iframe. The render-only guard above passes even if that swap is
  // broken (or the iframeSrc route is wrong), leaving users on a dead poster.
  // This test clicks the poster and proves the iframe mounts with the
  // expected demo-video src.
  test("clicking the demo poster mounts the playing iframe", async ({
    page,
  }) => {
    await page.goto("/media");

    // ── Biometric demo ──
    const biometricPoster = page.getByRole("button", {
      name: BIOMETRIC_DEMO_LABEL,
    });
    await expect(biometricPoster).toBeVisible({ timeout: 15_000 });
    await biometricPoster.click();

    // The poster button is replaced by the iframe (it is no longer rendered).
    await expect(biometricPoster).toHaveCount(0);
    const biometricIframe = page.locator(
      `iframe[title="${BIOMETRIC_DEMO_TITLE}"]`,
    );
    await expect(biometricIframe).toBeVisible({ timeout: 15_000 });
    await expect(biometricIframe).toHaveAttribute(
      "src",
      new RegExp(BIOMETRIC_IFRAME_SRC),
    );
  });
});
