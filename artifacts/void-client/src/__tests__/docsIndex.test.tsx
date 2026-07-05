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

import DocsIndexPage from "@/pages/docs/DocsIndexPage";

describe("DocsIndexPage (tasks #545, #550, #551)", () => {
  it("lists entries for every shipped long-form doc page", () => {
    render(<DocsIndexPage />);
    const entries = screen.getAllByTestId("docs-index-entry");
    expect(entries.length).toBeGreaterThanOrEqual(7);
    const hrefs = entries.map((e) => e.getAttribute("href"));
    for (const href of [
      "/docs/how-it-works",
      "/docs/threat-model",
      "/docs/compare",
      "/docs/audit",
      "/docs/biometric",
      "/docs/pricing",
      "/docs/limits",
      "/docs/faq",
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it("renders the HOW IT WORKS entry with title and updated date", () => {
    render(<DocsIndexPage />);
    const entries = screen.getAllByTestId("docs-index-entry");
    const entry = entries.find(
      (e) => e.getAttribute("href") === "/docs/how-it-works",
    );
    expect(entry).toBeDefined();
    expect(within(entry!).getByText("HOW IT WORKS")).toBeInTheDocument();
    expect(
      within(entry!).getByText(/UPDATED \d{4}-\d{2}-\d{2}/),
    ).toBeInTheDocument();
  });

  it("renders the THREAT MODEL entry with title and updated date", () => {
    render(<DocsIndexPage />);
    const entries = screen.getAllByTestId("docs-index-entry");
    const tmEntry = entries.find(
      (e) => e.getAttribute("href") === "/docs/threat-model",
    );
    expect(tmEntry).toBeDefined();
    expect(within(tmEntry!).getByText("THREAT MODEL")).toBeInTheDocument();
    expect(
      within(tmEntry!).getByText(/UPDATED \d{4}-\d{2}-\d{2}/),
    ).toBeInTheDocument();
  });
});
