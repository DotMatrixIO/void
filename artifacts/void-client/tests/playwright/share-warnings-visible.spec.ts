// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Task #738 — Real-browser proof that the share-sheet cautions are
// actually on-screen, not merely present in the DOM.
//
// The jsdom component tests (PhraseShareModal.test.tsx /
// RoomShareSheet.test.tsx) already assert each caution renders and even
// call `toBeVisible()`, but jsdom has no layout engine: it cannot tell
// whether a caution is hidden by CSS (display:none, opacity:0, zero
// height, scrolled/positioned off-screen) or painted behind another
// element. This spec mounts the real components in a real browser via
// the DEV-only `/__test/share-warnings` route and proves, with genuine
// layout, that each caution is visible to a user.
//
// Both surfaces carry two cautions wired to literal-pinned element ids:
//   • the link-mangling ("channel") caution  — *-channel-caution
//   • the fragment-leak caution              — *-fragment-caution
// The route renders one modal per load (`?which=phrase|room`) so the two
// position:fixed overlays never stack and obscure each other.
//
// Runs under its own Chromium project in playwright.config.ts (see the
// `share-warnings-chromium` project) so it executes once and is not
// double-run by the engine-tuned phone-viewport layout projects.

import { test, expect, type Locator } from "@playwright/test";

interface Surface {
  name: string;
  query: string;
  cautions: { label: string; id: string; text: RegExp }[];
}

const SURFACES: Surface[] = [
  {
    name: "PhraseShareModal",
    query: "?which=phrase",
    cautions: [
      {
        label: "link-mangling caution",
        id: "phrase-share-modal-channel-caution",
        text: /Some messengers and proxies \(Slack, LinkedIn\) can mangle the link\. Share the QR or read the six words aloud instead\./,
      },
      {
        label: "fragment-leak caption",
        id: "phrase-share-modal-fragment-caution",
        text: /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
      },
    ],
  },
  {
    name: "RoomShareSheet",
    query: "?which=room",
    cautions: [
      {
        label: "link-mangling caution",
        id: "room-share-sheet-channel-caution",
        text: /Some messengers and proxies \(Slack, LinkedIn\) can mangle the link\. Share the QR or read the six words aloud instead\./,
      },
      {
        label: "fragment-leak caption",
        id: "room-share-sheet-fragment-caution",
        text: /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
      },
    ],
  },
];

// Robust, real-layout visibility check that closes the specific gaps the
// task names — gaps `toBeVisible()` alone does NOT all cover:
//   • non-empty box + not display:none/visibility:hidden  (toBeVisible)
//   • computed opacity > 0          (toBeVisible treats opacity:0 as visible)
//   • the element's centre lies inside the viewport (not scrolled/positioned
//     off-screen)
//   • the element (or its own text node / a descendant) is the top-most thing
//     painted at its centre — i.e. it is NOT hidden behind another element
async function assertGenuinelyVisible(locator: Locator, label: string) {
  // (1) Playwright's own layout-aware visibility (box + display/visibility).
  await expect(locator, `${label} should pass toBeVisible()`).toBeVisible();

  const probe = await locator.evaluate((el: Element) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    return {
      opacity: Number(style.opacity),
      width: rect.width,
      height: rect.height,
      inViewport:
        cx >= 0 &&
        cy >= 0 &&
        cx <= window.innerWidth &&
        cy <= window.innerHeight,
      // True when the caution itself sits at its own centre point, or
      // when it contains whatever is painted there (its own text node
      // resolves to the element; a child span would be a descendant).
      topMostIsSelfOrDescendant:
        !!topEl && (topEl === el || el.contains(topEl)),
    };
  });

  expect(probe.width, `${label} must have a non-zero width`).toBeGreaterThan(0);
  expect(probe.height, `${label} must have a non-zero height`).toBeGreaterThan(0);
  expect(
    probe.opacity,
    `${label} must not be transparent (opacity:0)`,
  ).toBeGreaterThan(0);
  expect(
    probe.inViewport,
    `${label} centre must lie inside the viewport (not scrolled/positioned off-screen)`,
  ).toBe(true);
  expect(
    probe.topMostIsSelfOrDescendant,
    `${label} must be the top-most element at its centre (not painted behind another element)`,
  ).toBe(true);
}

test.describe("share-sheet cautions are genuinely visible in a real browser", () => {
  for (const surface of SURFACES) {
    test(`${surface.name} link-mangling and fragment-leak cautions are on-screen`, async ({
      page,
    }) => {
      await page.goto(`/__test/share-warnings${surface.query}`);

      // The dialog must mount before we measure its cautions.
      await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15_000 });

      for (const caution of surface.cautions) {
        const byId = page.locator(`#${caution.id}`);
        const byText = page.getByText(caution.text);

        // The literal-pinned element and the user-visible copy must be the
        // same node — proves the wording isn't stranded in a dead/unmounted
        // branch while a differently-styled empty element carries the id.
        await expect(
          byText,
          `${surface.name} ${caution.label} copy must render`,
        ).toHaveAttribute("id", caution.id);

        await assertGenuinelyVisible(byId, `${surface.name} ${caution.label}`);
      }
    });
  }
});
