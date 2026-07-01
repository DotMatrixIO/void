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

import WhyPage from "@/pages/WhyPage";

// /why short-form WHY prose, now a first-person "founder's note". These
// tests assert the load-bearing sentences and the bottom-of-page CTA
// (now ← BACK TO HOME → /, not a deep-link to the long form), not
// snapshots.

describe("WhyPage short-form prose", () => {
  it("renders the load-bearing 'nothing in it to take' line", () => {
    render(<WhyPage />);
    expect(
      screen.getByText(
        /the room can’t betray you, because there is nothing in it to take/,
      ),
    ).toBeInTheDocument();
  });

  it("renders the Gameboy origin paragraph", () => {
    render(<WhyPage />);
    expect(
      screen.getByText(/A while back I built a coding project that imagined what Zoom/),
    ).toBeInTheDocument();
  });

  it("renders the closing 'enough presence to trust' line", () => {
    render(<WhyPage />);
    expect(
      screen.getByText(/Enough presence to trust\. Not enough to surveil\./),
    ).toBeInTheDocument();
  });

  it("renders the honest IP caveat with a /tor pointer (no baked .onion)", () => {
    // With no VITE_VOID_ONION_HOST baked (the default in tests), the
    // .onion-specific remedy must NOT render — telling a worried reader
    // to reach an address this build does not have would be a false
    // safety promise (Task #792). The honest IP caveat and a link to the
    // /tor walkthrough render instead.
    render(<WhyPage />);
    expect(
      screen.getByText(/If you need that hidden too, see/),
    ).toBeInTheDocument();
    const torLink = screen.getByRole("link", { name: /how Tor helps/ });
    expect(torLink.getAttribute("href")).toBe("/tor");
    // A high-risk reader must be routed to the FULL scoping, not the short
    // /threat-model summary — so the caveat links the long-form doc in every
    // build, onion-baked or not (Task #792).
    const threatLink = screen.getByRole("link", { name: /threat model/ });
    expect(threatLink.getAttribute("href")).toBe("/docs/threat-model");
    expect(
      screen.queryByText(/its \.onion address in Tor Browser/),
    ).not.toBeInTheDocument();
  });

  it("renders a ← BACK TO HOME link that resolves to /", () => {
    // The short-form WHY page used to deep-link to the long-form
    // /docs/how-it-works page via "READ THE LONG VERSION →". That
    // long-form page is now reachable from the global hamburger
    // menu (HOW IT WORKS), so the bottom-of-page CTA was repointed
    // back to the landing page instead.
    render(<WhyPage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/BACK TO HOME/);
    expect(link.getAttribute("href")).toBe("/");
  });
});
