// SPDX-License-Identifier: AGPL-3.0-or-later
// Real-viewport guard that the /compare and /docs/compare capability
// tables stay readable on a phone. Task #687 fixed a 375px clip by
// wrapping each wide table in a horizontal-scroll region with an edge
// cue (`src/components/ScrollableTable.tsx`). Without a guard, a future
// layout change could silently push the VOID column back off the right
// edge with no affordance to reach it. This spec proves, at ~375px,
// that (a) the table region actually overflows horizontally (so the
// scroll wrapper has a job to do), (b) the VOID column starts clipped,
// and (c) the VOID column can be scrolled fully into view.
//
// The scroll region is the `role="region"` + `aria-label` that
// ScrollableTable already exposes; both pages share the same label.
// This spec runs under the existing Chromium/WebKit phone layout
// projects (it overrides the viewport to a precise 375px so the gate is
// width-stable regardless of which project drives it).

import { test, expect } from "@playwright/test";

const PHONE = { width: 375, height: 812 };

const REGION_LABEL =
  "Video tool capability comparison. Scroll sideways to reach every column, including VOID.";

const PAGES = [
  { name: "/compare", path: "/compare" },
  { name: "/docs/compare", path: "/docs/compare" },
];

// Single in-page snapshot so the scrollLeft write and every rect read
// happen in the same synchronous layout pass. Reports whether the region
// overflows (is scrollable), whether the VOID header starts clipped off
// the right edge, and whether it lands fully inside the region's visible
// box after scrolling to the far right.
function probeVoidColumn(label: string) {
  const region = Array.from(
    document.querySelectorAll<HTMLElement>("[role='region']"),
  ).find((el) => el.getAttribute("aria-label") === label);
  if (!region) return { found: false as const };

  const maxScroll = region.scrollWidth - region.clientWidth;

  const voidHeader = Array.from(region.querySelectorAll("th")).find(
    (th) => th.textContent?.trim() === "VOID",
  );
  if (!voidHeader) return { found: true as const, voidHeaderFound: false as const };

  // Reset to the left edge and confirm the VOID column is clipped off the
  // right — otherwise the guard would be vacuous (nothing to scroll to).
  region.scrollLeft = 0;
  const regionRectBefore = region.getBoundingClientRect();
  const voidRectBefore = voidHeader.getBoundingClientRect();
  const clippedInitially = voidRectBefore.right > regionRectBefore.right + 1;

  // Scroll to the far right and re-measure.
  region.scrollLeft = maxScroll;
  const regionRect = region.getBoundingClientRect();
  const voidRect = voidHeader.getBoundingClientRect();
  const voidVisible =
    voidRect.width > 0 &&
    voidRect.left >= regionRect.left - 1 &&
    voidRect.right <= regionRect.right + 1;

  return {
    found: true as const,
    voidHeaderFound: true as const,
    maxScroll,
    clippedInitially,
    voidVisible,
    detail: {
      region: { left: regionRect.left, right: regionRect.right },
      voidCol: { left: voidRect.left, right: voidRect.right },
    },
  };
}

test.describe("comparison table stays readable on a phone", () => {
  for (const p of PAGES) {
    test(`${p.name} table is horizontally scrollable and reveals the VOID column at ${PHONE.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(PHONE);
      await page.goto(p.path);

      const region = page.getByRole("region", { name: REGION_LABEL });
      await region.waitFor({ state: "visible", timeout: 15_000 });

      const result = await page.evaluate(probeVoidColumn, REGION_LABEL);

      expect(result.found, "comparison-table scroll region must be present").toBe(true);
      if (!result.found) return;

      expect(result.voidHeaderFound, "VOID column header must exist").toBe(true);
      if (!result.voidHeaderFound) return;

      // The table must overflow its container at phone width — that is the
      // whole reason the scroll wrapper exists.
      expect(
        result.maxScroll,
        `table region is not horizontally scrollable (maxScroll=${result.maxScroll}px)`,
      ).toBeGreaterThan(1);

      // And it must genuinely be clipped before scrolling, else the guard
      // proves nothing.
      expect(
        result.clippedInitially,
        "VOID column should start clipped off the right edge at phone width",
      ).toBe(true);

      // After scrolling to the end, the VOID column must be fully reachable.
      expect(
        result.voidVisible,
        `VOID column not fully in view after scroll: ${JSON.stringify(result.detail)}`,
      ).toBe(true);
    });
  }
});
