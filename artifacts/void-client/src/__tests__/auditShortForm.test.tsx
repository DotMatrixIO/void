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

import AuditPage from "@/pages/AuditPage";

// Prose-section rewrite of the short-form audit page.
// Checks heading, memorable key phrases from each section, and the
// READ THE LONG VERSION → CTA. Not snapshots.

const KEY_PHRASES = [
  /One IP could pretend to be many/,
  /One paid invoice could open many rooms/,
  /A quiet downgrade in the encryption/,
  /Lightning payments are observable on the Lightning network/,
  /A placeholder secret was checked into the repo/,
  /The container ran as root/,
  /An outside firm has not yet been commissioned/,
];

describe("AuditPage short-form prose sections", () => {
  it("renders without crashing and shows the THE AUDIT heading", () => {
    render(<AuditPage />);
    expect(screen.getByText(/^THE AUDIT$/)).toBeInTheDocument();
  });

  it("renders each finding phrase", () => {
    render(<AuditPage />);
    for (const phrase of KEY_PHRASES) {
      expect(screen.getByText(phrase)).toBeInTheDocument();
    }
  });

  it("renders a READ THE LONG VERSION → link that resolves to /docs/audit", () => {
    render(<AuditPage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/READ THE LONG VERSION/);
    expect(link.getAttribute("href")).toBe("/docs/audit");
  });
});
