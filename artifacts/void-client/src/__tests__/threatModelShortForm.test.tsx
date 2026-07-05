// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

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

import ThreatModelPage from "@/pages/ThreatModelPage";

// Task #550: behavioral tests for the short-form THREAT MODEL page.
// Counts and link targets, not snapshots — the page is brutalist
// inline-style and a snapshot would either be flaky or trivial.

describe("ThreatModelPage short-form vertical slice (task #550)", () => {
  it("renders 6 items in the protects list and 5 in the doesn't-protect list", () => {
    render(<ThreatModelPage />);
    const protects = screen.getByTestId("threat-model-protects-list");
    const doesnt = screen.getByTestId("threat-model-doesnt-protect-list");
    expect(within(protects).getAllByRole("listitem").length).toBe(6);
    expect(within(doesnt).getAllByRole("listitem").length).toBe(5);
  });

  it("renders a READ THE LONG VERSION → link that resolves to /docs/threat-model", () => {
    render(<ThreatModelPage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/READ THE LONG VERSION/);
    expect(link.getAttribute("href")).toBe("/docs/threat-model");
  });

  it("carries the journalist-grade caveat (drift-check companion)", () => {
    render(<ThreatModelPage />);
    const footer = screen.getByTestId("threat-model-researcher-footer");
    const text = footer.textContent ?? "";
    expect(text).toMatch(/journalist-grade/);
    expect(text).toMatch(/vetted/);
    expect(text).toMatch(/external\/human audit/);
    expect(text).toContain("docs/threat-model.md");
    expect(text).toContain("docs/client-threat-model.md");
  });
});
