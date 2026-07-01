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

import DocsHowItWorksPage from "@/pages/docs/DocsHowItWorksPage";

// /docs/how-it-works long-form wonkish page (renamed from /docs/why).
// Presence checks on stable load-bearing prose and the eight section
// anchors that inbound deep links and the /why#<anchor> redirect both
// rely on.

describe("DocsHowItWorksPage long-form prose", () => {
  it("renders the philosophy section with its load-bearing quote", () => {
    const { container } = render(<DocsHowItWorksPage />);
    expect(container.querySelector("#philosophy")).not.toBeNull();
    expect(
      screen.getByText(/Do not turn a room into a building/),
    ).toBeInTheDocument();
  });

  it("renders every long-form section anchor used by inbound deep links", () => {
    const { container } = render(<DocsHowItWorksPage />);
    for (const id of [
      "philosophy",
      "the-void-phrase",
      "encryption",
      "video-filters",
      "voice-masks",
      "stateless-architecture",
      "what-we-log",
    ]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("keeps the promise-vs-proof opening prose, now attributed to Jeff Swanson on first use", () => {
    render(<DocsHowItWorksPage />);
    expect(
      screen.getByText(
        /Jeff Swanson distinguishes between promises and proofs\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders the reinstated STATELESS ARCHITECTURE and WHAT WE LOG sections", () => {
    render(<DocsHowItWorksPage />);
    expect(screen.getByText(/A database is a liability\./)).toBeInTheDocument();
    expect(screen.getByText(/KEPT — ROTATED OUT WITHIN 5 DAYS/)).toBeInTheDocument();
    expect(screen.getByText(/NEVER KEPT/)).toBeInTheDocument();
  });

  it("renders an SVG key-derivation diagram in the ENCRYPTION section", () => {
    const { container } = render(<DocsHowItWorksPage />);
    const encryption = container.querySelector("#encryption");
    expect(encryption).not.toBeNull();
    const svg = encryption!.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("aria-labelledby")).toMatch(/kdf-title/);
  });
});
