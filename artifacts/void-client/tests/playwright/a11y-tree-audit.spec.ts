// SPDX-License-Identifier: AGPL-3.0-or-later
// Accessibility-tree audit — executable evidence for the screen-reader
// hand-test runbook (docs/screen-reader-manual-test.md).
//
// A real VoiceOver / NVDA pass is a human task (see the runbook) and
// stays the source of truth for *subjective* announcement quality. This
// spec covers the *objective*, machine-checkable half of that runbook by
// driving the real in-call UI in a browser and asserting the
// accessibility-tree properties a screen reader actually consumes
// (roles, accessible names, ARIA state, focus movement, Escape focus
// return). It runs against the DEV-only `/__test/joined-call` route,
// which mounts the production RoomPage with mocked media — no camera,
// no signaling.
//
// What this does NOT cover (human-only, in the runbook): whether the SAS
// words are *spoken* on dialog open across VO/NVDA, pronunciation of the
// natural words, and overall comprehensibility. The SAS dialog itself is
// not reachable from this harness (it needs live per-peer SAS state), so
// its accessible-description structure is asserted by the jsdom unit test
// in src/components/a11y.test.tsx ("SAS dialog screen-reader
// announcement").

import { test, expect } from "@playwright/test";

const JOINED_CALL_ROUTE = "/__test/joined-call";
const MENU_TID = "incall-overflow-menu";

test.describe("a11y-tree audit — in-call overflow menu", () => {
  test("trigger semantics, focus-in on open, menuitem roles, Escape returns focus", async ({
    page,
  }) => {
    await page.goto(JOINED_CALL_ROUTE);

    const trigger = page.getByTestId("incall-overflow-button");
    await expect(trigger).toBeVisible({ timeout: 20_000 });

    // Trigger is announced as a button that opens a menu, collapsed.
    await expect(trigger).toHaveAccessibleName("More controls");
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Container is a menu with an accessible name.
    const menu = page.getByRole("menu", { name: "More controls" });
    await expect(menu).toBeVisible();

    // Focus moved INTO the menu (keyboard / SR user is not stranded on
    // the trigger).
    const focusInsideMenu = await page.evaluate((tid) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      return !!el && el.contains(document.activeElement);
    }, MENU_TID);
    expect(focusInsideMenu).toBe(true);

    // Every actionable child is announced as a menu item — SHARE, SHOW
    // QR, the SOUND FX toggle, and the host KNOCK / LOCK controls.
    const menuitems = page.getByRole("menuitem");
    expect(await menuitems.count()).toBeGreaterThanOrEqual(5);
    for (const name of [/SHARE/i, /QR/i, /SOUND/i, /KNOCK/i, /LOCK/i]) {
      await expect(menu.getByRole("menuitem", { name })).toHaveCount(1);
    }

    // No focusable child escapes the menu role as a bare button — a real
    // SR-navigation bug if it did (role=menu requires menuitem children).
    const bareButtons = await page
      .locator(`[data-testid="${MENU_TID}"] button:not([role="menuitem"])`)
      .count();
    expect(bareButtons).toBe(0);

    // Escape closes the menu and returns focus to the trigger.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("a11y-tree audit — burn overlay", () => {
  test("alertdialog role + assertive live region, focus moved onto it", async ({
    page,
  }) => {
    await page.goto(JOINED_CALL_ROUTE);

    const burn = page.getByRole("button", { name: "BURN" });
    await expect(burn).toBeVisible({ timeout: 20_000 });
    await burn.click();

    // The terminal overlay auto-announces (assertive live region) and is
    // an alertdialog named by its headline; assert before the ~3s
    // auto-dismiss reloads the page.
    const overlay = page.getByTestId("burned-overlay");
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveAttribute("aria-live", "assertive");
    await expect(overlay).toHaveAccessibleName(/ROOM BURNED/i);
    await expect(page.getByRole("alertdialog")).toBeVisible();

    // Focus is moved onto the overlay so the user is not stranded on a
    // now-removed in-call control.
    await expect(overlay).toBeFocused();
  });
});
