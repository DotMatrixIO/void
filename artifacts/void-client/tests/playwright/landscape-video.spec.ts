// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #594 — landscape video real-estate gate. Companion to the
// portrait control-bar gate in `control-bar-layout.spec.ts`. In short
// landscape (a phone held sideways, here 640×360) the video grid must
// keep the majority of the screen: reclaiming in-call space means the
// call itself — not the chrome — owns the viewport. We assert the grid
// occupies at least 60% of the viewport height. Driven via the same
// DEV-only `/__test/joined-call` route the portrait gate uses.

import { test, expect } from "@playwright/test";

const ROUTE = "/__test/joined-call";
const LANDSCAPE = { width: 640, height: 360 };
const MIN_FRACTION = 0.6;
const TOLERANCE_PX = 1;

test.use({ viewport: LANDSCAPE });

test.describe("in-call landscape video real estate", () => {
  test("video grid owns at least 60% of the viewport height at 640×360", async ({
    page,
  }) => {
    await page.goto(ROUTE);

    const grid = page.locator(".void-video-grid");
    await grid.first().waitFor({ state: "visible", timeout: 15_000 });

    const box = await grid.first().boundingBox();
    expect(box, "video grid must have a bounding box").not.toBeNull();
    if (!box) return;

    const minHeight = LANDSCAPE.height * MIN_FRACTION;
    expect(
      box.height + TOLERANCE_PX,
      `video grid height ${box.height}px is below ${MIN_FRACTION * 100}% of the ${LANDSCAPE.height}px viewport (${minHeight}px)`,
    ).toBeGreaterThanOrEqual(minHeight);

    // The grid must not be pushed off-screen: its top stays within the
    // viewport and it does not force document scroll.
    expect(box.y, "video grid top escapes the viewport").toBeGreaterThanOrEqual(-TOLERANCE_PX);
    const docScroll = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(
      docScroll.scrollHeight - docScroll.clientHeight,
      `document vertical overflow ${docScroll.scrollHeight} > ${docScroll.clientHeight}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);
  });
});
