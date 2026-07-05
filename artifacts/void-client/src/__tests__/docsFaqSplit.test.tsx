// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #575 / #576 / #577 guard. The six known failure modes used to
// live inside /docs/limits under a WHAT TO EXPECT subhead. #575 moved
// them to /docs/faq verbatim. #576 then removed the WHAT TO EXPECT
// pointer section from /docs/limits. #577 collapsed the short-form
// /limits page into the long-form so /limits now renders DocsLimitsPage
// — FAQ discoverability now flows through the /docs index only. This
// test locks both ends of that arrangement:
//   - /docs/faq must render all six failure-mode headings + body.
//   - /docs/limits must NOT render the failure-mode bodies anymore,
//     must NOT carry a WHAT TO EXPECT subhead, and must NOT link to
//     /docs/faq from this page.
// If a future refactor re-merges the content, splits the headings,
// rewords them, or re-introduces the pointer here, this test fails.

vi.mock("@/components/HamburgerMenu", () => ({ default: () => null }));
vi.mock("@/components/PageFooter", () => ({
  default: () => <div data-testid="page-footer" />,
}));

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

import DocsFaqPage from "@/pages/docs/DocsFaqPage";
import DocsLimitsPage from "@/pages/docs/DocsLimitsPage";

// Headings are checked in their original brutalist uppercase form,
// exactly as they shipped on /docs/limits before the split.
const FAILURE_HEADINGS = [
  "LIGHTNING INVOICE PAID, BUT THE ROOM DOES NOT APPEAR",
  "PEER CONNECTION DROPS MID-CALL",
  "THE 65-MINUTE TIMER FIRES MID-CONVERSATION",
  "WRONG PHRASE ENTERED",
  "BROWSER PERMISSIONS DENIED",
  "OPERATING SYSTEM SCREEN-SHARE PERMISSION DENIED",
] as const;

// One representative sentence per heading. If the body prose gets
// silently reworded during a future refactor, the targeted assertion
// catches it. These are not exhaustive snapshots — they are a load-
// bearing line of body text that uniquely identifies each block.
const FAILURE_BODY_SAMPLES: Array<[(typeof FAILURE_HEADINGS)[number], RegExp]> = [
  [
    "LIGHTNING INVOICE PAID, BUT THE ROOM DOES NOT APPEAR",
    /one-time recovery code, four words/,
  ],
  [
    "PEER CONNECTION DROPS MID-CALL",
    /sends every[\s\S]*packet through the TURN server/,
  ],
  [
    "THE 65-MINUTE TIMER FIRES MID-CONVERSATION",
    /DAY tier gives you a[\s\S]*24-hour window/,
  ],
  ["WRONG PHRASE ENTERED", /WE CAN’T DECRYPT THIS PEER’S MESSAGES/],
  [
    "BROWSER PERMISSIONS DENIED",
    /browser remembers this choice per site/,
  ],
  [
    "OPERATING SYSTEM SCREEN-SHARE PERMISSION DENIED",
    /screen-recording permission for your[\s\S]*browser/,
  ],
];

describe("DocsFaqPage (task #575 split-out)", () => {
  it("renders all six failure-mode headings", () => {
    render(<DocsFaqPage />);
    for (const heading of FAILURE_HEADINGS) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("renders a representative line of body prose under each heading", () => {
    const { container } = render(<DocsFaqPage />);
    const text = container.textContent ?? "";
    for (const [heading, sample] of FAILURE_BODY_SAMPLES) {
      expect(text, `body sample missing for ${heading}`).toMatch(sample);
    }
  });

  it("links back to /docs/limits in the opener", () => {
    render(<DocsFaqPage />);
    const back = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/docs/limits");
    expect(back).toBeDefined();
  });
});

describe("DocsLimitsPage after #575 split", () => {
  it("does NOT render the failure-mode runbook body anymore", () => {
    const { container } = render(<DocsLimitsPage />);
    const text = container.textContent ?? "";
    // The runbook used uniquely-identifying body prose; if any of it
    // reappears here, the split has regressed.
    expect(text).not.toMatch(/one-time recovery code, four words/);
    expect(text).not.toMatch(/sends every[\s\S]*packet through the TURN server/);
    expect(text).not.toMatch(/screen-recording permission for your[\s\S]*browser/);
    // The headings should also be gone; only the FAQ pointer remains.
    expect(text).not.toMatch(/PEER CONNECTION DROPS MID-CALL/);
    expect(text).not.toMatch(/THE 65-MINUTE TIMER FIRES MID-CONVERSATION/);
  });

  it("does NOT carry a WHAT TO EXPECT pointer link to /docs/faq (removed in #576)", () => {
    // Task #576 stripped the WHAT TO EXPECT pointer section from
    // /docs/limits. Discoverability of the FAQ lives only in the
    // /docs index (the short-form /limits page was also removed in
    // Task #577). If a future refactor re-introduces the pointer
    // here, this test fails.
    const { container } = render(<DocsLimitsPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/WHAT TO EXPECT/);
    const links = screen.queryAllByRole("link");
    const faqLink = links.find((a) => a.getAttribute("href") === "/docs/faq");
    expect(faqLink).toBeUndefined();
  });
});
