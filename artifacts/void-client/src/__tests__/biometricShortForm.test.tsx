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

import BiometricPage from "@/pages/BiometricPage";

// Prose-section rewrite of the short-form biometric page.
// Checks heading, memorable key phrases from each section, and the
// READ THE LONG VERSION → CTA. Not snapshots.

const KEY_PHRASES = [
  /A woman named Patricia went to a protest in 2025/,
  /A face, in high definition, is a reusable identification package/,
  /maps your face onto two colors/,
  /turns you into text on a screen/,
  /breaks your audio into small grains/,
  /The video mask runs on your GPU/,
  /You cannot hand over what you do not have/,
  /not designed to defeat your sister/,
  /The goal is not to hide\. The goal is to be present/,
];

describe("BiometricPage short-form prose sections", () => {
  it("renders without crashing and shows the BIOMETRIC MASKING heading", () => {
    render(<BiometricPage />);
    expect(screen.getByText(/^BIOMETRIC MASKING$/)).toBeInTheDocument();
  });

  it("renders each key phrase from the new prose", () => {
    render(<BiometricPage />);
    for (const phrase of KEY_PHRASES) {
      expect(screen.getByText(phrase)).toBeInTheDocument();
    }
  });

  it("renders a READ THE LONG VERSION → link that resolves to /docs/biometric", () => {
    render(<BiometricPage />);
    const link = screen.getByTestId("read-more-button");
    expect(link.textContent).toMatch(/READ THE LONG VERSION/);
    expect(link.getAttribute("href")).toBe("/docs/biometric");
  });
});
