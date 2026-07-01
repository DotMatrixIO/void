// SPDX-License-Identifier: AGPL-3.0-or-later
// Real-viewport companion to the jsdom gate in
// `RoomPage.layout.test.tsx` (task #585). jsdom owns button count and
// CSS intent; this owns rendered layout (no scroll, no wrap, no
// clipping, font floor, real equal widths). The two tests do not
// duplicate any assertion. Driven via the DEV-only
// `/__test/joined-call` route (added in #587), which mounts RoomPage
// with mocked media tracks and bypasses the real join sequence.

import { test, expect, type Locator } from "@playwright/test";

const ROUTE = "/__test/joined-call";
const TOLERANCE_PX = 1;
const FONT_FLOOR_PX = 10;

async function describeChild(child: Locator): Promise<string> {
  const testid = await child.getAttribute("data-testid");
  if (testid) return `[data-testid="${testid}"]`;
  const label = (await child.textContent())?.trim().slice(0, 32) ?? "";
  return label || "<unlabelled child>";
}

test.describe("in-call control bar layout", () => {
  test("fits the viewport with no scroll, wrap, clipping, or sub-floor labels", async ({
    page,
  }) => {
    await page.goto(ROUTE);

    const bar = page.getByTestId("room-control-bar");
    await bar.waitFor({ state: "visible", timeout: 15_000 });

    const barBox = await bar.boundingBox();
    expect(barBox, "control bar must have a bounding box").not.toBeNull();
    if (!barBox) return;

    // 1. No horizontal scroll on document or on the bar itself.
    const docScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      docScroll.scrollWidth - docScroll.clientWidth,
      `document horizontal overflow ${docScroll.scrollWidth} > ${docScroll.clientWidth}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    const barScroll = await bar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      barScroll.scrollWidth - barScroll.clientWidth,
      `control bar horizontal overflow ${barScroll.scrollWidth} > ${barScroll.clientWidth}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    // Enumerate direct children once.
    const children = bar.locator(":scope > *");
    const childCount = await children.count();
    expect(childCount, "control bar must have at least one child").toBeGreaterThan(0);

    const tops: number[] = [];
    const widths: number[] = [];

    for (let i = 0; i < childCount; i++) {
      const child = children.nth(i);
      const box = await child.boundingBox();
      const name = await describeChild(child);
      expect(box, `child ${name} must have a bounding box (not clipped to 0)`).not.toBeNull();
      if (!box) continue;

      // 3. No clipping: width > 0 and fully inside the bar's rect.
      expect(box.width, `child ${name} has zero rendered width`).toBeGreaterThan(0);
      expect(
        box.x + TOLERANCE_PX,
        `child ${name} left edge ${box.x} escapes bar left ${barBox.x}`,
      ).toBeGreaterThanOrEqual(barBox.x);
      expect(
        box.x + box.width,
        `child ${name} right edge ${box.x + box.width} escapes bar right ${barBox.x + barBox.width}`,
      ).toBeLessThanOrEqual(barBox.x + barBox.width + TOLERANCE_PX);

      tops.push(box.y);
      widths.push(box.width);
    }

    // 2. No wrap: all direct children share the same top within 1px.
    const minTop = Math.min(...tops);
    const maxTop = Math.max(...tops);
    expect(
      maxTop - minTop,
      `control bar children wrapped (top spread ${maxTop - minTop}px > ${TOLERANCE_PX}px tolerance)`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    // 4. Rendered equal widths within 1px.
    const minWidth = Math.min(...widths);
    const maxWidth = Math.max(...widths);
    expect(
      maxWidth - minWidth,
      `control bar children widths unequal: min ${minWidth}, max ${maxWidth}`,
    ).toBeLessThanOrEqual(TOLERANCE_PX);

    // 5. Font floor: computed font-size on every <button> label inside
    //    the bar is at least FONT_FLOOR_PX.
    const buttons = bar.locator("button");
    const buttonCount = await buttons.count();
    expect(buttonCount, "control bar must contain at least one button").toBeGreaterThan(0);
    for (let i = 0; i < buttonCount; i++) {
      const btn = buttons.nth(i);
      const fontSize = await btn.evaluate(
        (el) => parseFloat(window.getComputedStyle(el).fontSize),
      );
      const name = await describeChild(btn);
      expect(
        fontSize,
        `button ${name} font-size ${fontSize}px is below ${FONT_FLOOR_PX}px floor`,
      ).toBeGreaterThanOrEqual(FONT_FLOOR_PX);
    }
  });
});
