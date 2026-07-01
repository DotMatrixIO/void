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

import HowItWorksPage from "@/pages/HowItWorksPage";

// Prose-section rewrite of the short-form how-it-works page.
// Checks heading, memorable key phrases from each section, and the
// READ THE LONG VERSION → CTA. Not snapshots — the page is brutalist
// inline-style and a snapshot would be trivial or flaky.

const KEY_PHRASES = [
  /Math does not have a legal team/,
  /The server has the memory of a goldfish/,
  /The past is sealed against the future/,
  /Do not turn a room into a building/,
  /A face is not neutral information/,
  /Your voice is as specific as your face/,
  /Five days is a ceiling, not an aspiration/,
];

describe("HowItWorksPage short-form prose sections", () => {
  it("renders without crashing and shows the HOW IT WORKS heading", () => {
    render(<HowItWorksPage />);
    expect(screen.getByText(/^HOW IT WORKS$/)).toBeInTheDocument();
  });

  it("renders each key phrase from the prose sections", () => {
    render(<HowItWorksPage />);
    for (const phrase of KEY_PHRASES) {
      expect(screen.getByText(phrase)).toBeInTheDocument();
    }
  });

  it("renders a READ THE LONG VERSION → link that resolves to /docs/how-it-works", () => {
    render(<HowItWorksPage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/READ THE LONG VERSION/);
    expect(link.getAttribute("href")).toBe("/docs/how-it-works");
  });
});
