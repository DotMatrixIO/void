// SPDX-License-Identifier: AGPL-3.0-or-later
// Real-viewport guard for the combined in-call reminder
// (RecordingDisclosureBanner, task #597). The reminder is a FLOATING
// overlay pinned in the button-free band above the bottom control bar.
// Its whole reason for being position:fixed is that it must never sit on
// top of an interactive control — if it overlapped a button it would
// both hide the control and steal its taps. This spec proves the
// no-overlap invariant at three viewport widths by asserting the
// reminder's rendered box does not intersect ANY visible button box.
//
// Driven via the DEV-only `/__test/joined-call` route (added in #587),
// which mounts RoomPage with mocked media tracks and bypasses the real
// join sequence. The reminder shows on initial entry and auto-dismisses
// after ~5s, so the test captures its box well within that window.

import { test, expect } from "@playwright/test";

const ROUTE = "/__test/joined-call";
const TOLERANCE_PX = 1;

const VIEWPORTS = [
  { name: "mobile", width: 360, height: 640 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 720 },
];

// All measurement happens in a single in-page snapshot so the reminder's
// ~5s auto-dismiss timer can never race the per-button measurement (which
// would otherwise leave a stale locator waiting until the suite timeout).
// Returns the reminder rect plus every overlapping NON-own button — the
// reminder's own dismiss button is part of the overlay and excluded.
function snapshotOverlaps(tolerance: number) {
  const reminder = document.querySelector(
    "[data-testid='recording-disclosure-banner']",
  ) as HTMLElement | null;
  if (!reminder) return { found: false as const };

  const r = reminder.getBoundingClientRect();
  const reminderBox = { x: r.x, y: r.y, width: r.width, height: r.height };

  const intersects = (a: DOMRect): boolean =>
    r.x < a.x + a.width - tolerance &&
    r.x + r.width - tolerance > a.x &&
    r.y < a.y + a.height - tolerance &&
    r.y + r.height - tolerance > a.y;

  const buttons = Array.from(document.querySelectorAll("button"));
  let buttonCount = 0;
  const offenders: { name: string; box: DOMRect }[] = [];
  for (const btn of buttons) {
    if (reminder.contains(btn)) continue;
    const style = window.getComputedStyle(btn);
    if (style.display === "none" || style.visibility === "hidden") continue;
    const box = btn.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    buttonCount += 1;
    if (intersects(box)) {
      const testid = btn.getAttribute("data-testid");
      const name = testid
        ? `[data-testid="${testid}"]`
        : (btn.textContent?.trim().slice(0, 32) || "<unlabelled button>");
      offenders.push({ name, box });
    }
  }
  return { found: true as const, reminderBox, buttonCount, offenders };
}

test.describe("in-call reminder safe zone", () => {
  for (const vp of VIEWPORTS) {
    test(`reminder never overlaps a button at ${vp.name} (${vp.width}x${vp.height})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(ROUTE);

      // The reminder shows on entry; assert it within its auto-dismiss
      // window so we are measuring the real on-screen box.
      await page
        .getByTestId("recording-disclosure-banner")
        .waitFor({ state: "visible", timeout: 4_000 });

      const result = await page.evaluate(snapshotOverlaps, TOLERANCE_PX);
      expect(result.found, "reminder must be present").toBe(true);
      if (!result.found) return;

      expect(
        result.buttonCount,
        "page must render at least one non-reminder button",
      ).toBeGreaterThan(0);

      const detail = result.offenders
        .map((o) => `${o.name} ${JSON.stringify(o.box)}`)
        .join("; ");
      expect(
        result.offenders.length,
        `reminder ${JSON.stringify(result.reminderBox)} overlaps: ${detail}`,
      ).toBe(0);
    });
  }
});
