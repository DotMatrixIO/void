// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";

// Task #550: the long-form THREAT MODEL prose was relocated here from
// /threat-model. Test the load-bearing sections present + every
// anchor ID preserved + the Network observers section (previously
// pinned by the now-removed pages/ThreatModelPage.test.tsx).

describe("DocsThreatModelPage relocated long-form prose (task #550)", () => {
  it("renders the network observers section heading and the three case labels", () => {
    render(<DocsThreatModelPage />);
    expect(
      screen.getByText(/NETWORK OBSERVERS AND IP VISIBILITY/),
    ).toBeInTheDocument();
    expect(screen.getByText("DEFAULT MODE")).toBeInTheDocument();
    expect(screen.getByText("RELAY-ONLY MODE")).toBeInTheDocument();
    expect(
      screen.getAllByText("TOR AND THE MEDIA PATH").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders the BROWSER-LEVEL SURFACES section with all six surface labels", () => {
    render(<DocsThreatModelPage />);
    expect(screen.getByText(/BROWSER-LEVEL SURFACES/)).toBeInTheDocument();
    expect(
      screen.getByText(/DNS LOOKUPS REVEAL THE DOMAIN/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/THE CLIPBOARD IS READABLE BY EXTENSIONS/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/NOTIFICATIONS ARE READABLE BY EXTENSIONS/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /EXTENSIONS WITH ALL-SITES PERMISSION READ THE ROOM PAGE/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /WEBRTC METADATA IS READABLE BY DEBUGGER-CAPABLE EXTENSIONS/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /ENTERPRISE-MANAGED BROWSERS LOG CAMERA AND MIC GRANTS/,
      ),
    ).toBeInTheDocument();
  });

  it("preserves every anchor ID that the /threat-model#<anchor> redirects land on", () => {
    const { container } = render(<DocsThreatModelPage />);
    for (const id of [
      "lightning-ip-leak",
      "tor-wallet-shortlist",
      "browser-level-surfaces",
      "supply-chain",
    ]) {
      expect(
        container.querySelector(`#${id}`),
        `expected #${id} on /docs/threat-model so the anchor redirect resolves`,
      ).not.toBeNull();
    }
  });

  it("links back to the short /threat-model page via the header BACK affordance", () => {
    render(<DocsThreatModelPage />);
    const back = screen.getByText(/← BACK TO SHORT VERSION/);
    expect(back.getAttribute("href")).toBe("/threat-model");
  });
});
