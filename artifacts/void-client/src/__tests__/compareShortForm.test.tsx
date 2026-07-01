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

import ComparePage from "@/pages/ComparePage";

// /compare short-form. Per user direction (post-#551 simplification):
// heading + FAIR QUESTION subhead + one-sentence "There are several
// perfectly good video tools in the world. Here is the honest score."
// + the eleven-row comparison table + READ THE LONG VERSION →. No
// bullets, no breadcrumb, no other prose.

describe("ComparePage short-form", () => {
  it("renders the WHY NOT ZOOM heading and FAIR QUESTION subhead", () => {
    render(<ComparePage />);
    expect(screen.getByText("WHY NOT ZOOM?")).toBeInTheDocument();
    expect(screen.getByText("FAIR QUESTION.")).toBeInTheDocument();
  });

  it("renders the one-sentence honest-score intro", () => {
    render(<ComparePage />);
    expect(
      screen.getByText(
        /There are several perfectly good video tools in the world\. Here\s+is the honest score\./,
      ),
    ).toBeInTheDocument();
  });

  it("renders the comparison table with all eleven rows and six tools", () => {
    render(<ComparePage />);
    const table = screen.getByTestId("compare-table");
    expect(table).toBeInTheDocument();
    // Eleven capability rows, each rendered as a row-scope <th>.
    expect(within(table).getAllByRole("rowheader")).toHaveLength(11);
    // Six tool columns plus the CAPABILITY label = seven column headers.
    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);
    for (const tool of ["ZOOM", "MEET", "FACETIME", "SIGNAL", "JITSI", "VOID"]) {
      expect(within(table).getByText(tool)).toBeInTheDocument();
    }
  });

  it("renders a READ THE LONG VERSION → link that resolves to /docs/compare", () => {
    render(<ComparePage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/READ THE LONG VERSION/);
    expect(link.getAttribute("href")).toBe("/docs/compare");
  });

  it("does not render any short-form bullets (bullets retired)", () => {
    render(<ComparePage />);
    expect(screen.queryByTestId("compare-bullet-list")).toBeNull();
    expect(screen.queryAllByTestId("short-form-bullet")).toHaveLength(0);
  });
});
