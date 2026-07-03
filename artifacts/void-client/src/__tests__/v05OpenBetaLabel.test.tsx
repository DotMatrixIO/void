// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// LandingPage's PWA-install effect calls window.matchMedia at mount;
// jsdom doesn't ship one. Stub it so the component mounts.
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

vi.mock("@/components/HamburgerMenu", () => ({ default: () => null }));
vi.mock("@/components/PageFooter", () => ({
  default: () => <div data-testid="page-footer" />,
}));
vi.mock("@/components/DemoVideoEmbed", () => ({
  default: () => <div data-testid="demo-video-embed" />,
}));
vi.mock("@/hooks/useSatsToUsd", () => ({
  useSatsToUsd: () => null,
}));

import LandingPage from "@/pages/LandingPage";
import ThreatModelPage from "@/pages/ThreatModelPage";
import WhyPage from "@/pages/WhyPage";

// Task #323. The product version label `OPEN BETA · v0.6` is pinned
// across the user-visible surface (landing-page hero, PWA install
// prompt, threat-model header, why page). The label is load-bearing —
// it sets the expectation that this is the first publicly-supported
// release and that bugs in the first 90 days are read as "early and
// honest" rather than as a referendum on whether the product should
// have shipped at all.
//
// Note: the WhyPage, ThreatModelPage, DocsHowItWorksPage and
// DocsThreatModelPage acknowledgements all render the standardized
// sentence "This is OPEN BETA · v0.6 — We expect to find bugs for a
// while." (Task #565). The assertions below match on the presence of
// the "OPEN BETA" and "v0.6" tokens rather than the full sentence —
// the load-bearing contract is that each page names the version,
// not the exact wording of the surrounding sentence.
//
// Failure of this test usually means a future contributor renamed v0.5
// to v0.6 / v1.0 in one place but not the others. The loud failure
// message below is the reminder to update all three sites together.

const BADGE = "OPEN BETA · v0.6";

const FAILURE_MESSAGE =
  "\n\n" +
  "================================================================\n" +
  "v0.6 / OPEN BETA label assertion failed.\n" +
  "================================================================\n" +
  "\n" +
  "If you are renaming v0.5 to v0.6 / v1.0, update\n" +
  "the internal launch checklist, the threat-model won't-fix section\n" +
  "(WHAT VOID WON'T FIX IN v0.6), and the marketing-claims-audit\n" +
  "ledger (docs/marketing-claims-audit.md \"Version label\" section)\n" +
  "together — in the same commit. The protocol-version identifiers\n" +
  "(VOID-ECDHE-v1, VOID-SAS-v1, VOID-INVITE-v1) are frozen wire\n" +
  "contracts and must NOT be touched; the product version is\n" +
  "separate from the protocol version.\n" +
  "\n" +
  "Do not delete this assertion. The whole point of pinning the\n" +
  "version label is that future contributors who see a failing\n" +
  "test usually delete the assertion. If the badge string genuinely\n" +
  "changed, update the BADGE constant in this file in the same\n" +
  "commit that changed the pages.\n" +
  "================================================================\n";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("v0.6 / OPEN BETA framing", () => {
  it("LandingPage carries the OPEN BETA · v0.6 badge near the hero", () => {
    render(<LandingPage onJoinRoom={() => {}} />);
    const badge = screen.queryByTestId("open-beta-badge");
    if (badge === null || normalize(badge.textContent ?? "") !== BADGE) {
      throw new Error(
        `Expected LandingPage to render the verbatim badge "${BADGE}". ` +
          `Got: ${badge === null ? "(no element with data-testid=\"open-beta-badge\")" : JSON.stringify(normalize(badge.textContent ?? ""))}.` +
          FAILURE_MESSAGE,
      );
    }
  });

  it("ThreatModelPage header carries the v0.6 acknowledgement consistent with the won't-fix section", () => {
    render(<ThreatModelPage />);
    const ack = screen.queryByTestId("threat-model-v05-acknowledgement");
    const text = normalize(ack?.textContent ?? "");
    if (ack === null || !text.includes("OPEN BETA · v0.6")) {
      throw new Error(
        `Expected ThreatModelPage header to acknowledge OPEN BETA · v0.6. ` +
          `Got: ${ack === null ? "(no element with data-testid=\"threat-model-v05-acknowledgement\")" : JSON.stringify(text)}.` +
          FAILURE_MESSAGE,
      );
    }
  });

  it("WhyPage carries a one-line v0.6 acknowledgement", () => {
    render(<WhyPage />);
    const ack = screen.queryByTestId("why-v05-acknowledgement");
    const text = normalize(ack?.textContent ?? "");
    if (ack === null || !text.includes("OPEN BETA") || !text.includes("v0.6")) {
      throw new Error(
        `Expected WhyPage to acknowledge OPEN BETA and v0.6 in one line. ` +
          `Got: ${ack === null ? "(no element with data-testid=\"why-v05-acknowledgement\")" : JSON.stringify(text)}.` +
          FAILURE_MESSAGE,
      );
    }
  });
});
