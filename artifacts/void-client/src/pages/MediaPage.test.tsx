// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { expectNoAxeViolations } from "@/test/axe";

// MediaPage hosts the two demo-video embeds and the NO-claims refusal band
// that used to live on the landing page. These tests pin the order
// (refusal band first, demos below), the load-bearing refusal copy, and the
// "Why we built this" teaser link so the moved sections can't silently drift.

vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
  uiBleep: vi.fn(),
  getUiSoundsEnabled: vi.fn(() => false),
  setUiSoundsEnabled: vi.fn(),
}));

import MediaPage from "./MediaPage";

describe("MediaPage", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  function renderMedia() {
    return render(
      <Router>
        <MediaPage />
      </Router>,
    );
  }

  function precedes(first: Element, second: Element): boolean {
    return Boolean(
      first.compareDocumentPosition(second) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
  }

  const CLAIMS = ["NO ACCOUNTS.", "NO TRACKING.", "NO FACESCANS.", "NO BANKS."];

  it("has no axe violations", async () => {
    const { container } = renderMedia();
    await expectNoAxeViolations(container);
  });

  it("renders the refusal band before the demos in DOM order", () => {
    renderMedia();

    const refusal = screen.getByRole("region", { name: "What VOID refuses" });
    const demos = screen.getByRole("region", { name: "Demos" });
    expect(
      precedes(refusal, demos),
      `Expected the "What VOID refuses" refusal band to appear BEFORE the ` +
        `"Demos" section on the Media page.`,
    ).toBe(true);
  });

  it("renders the four refusal claims inside the refusal region", () => {
    renderMedia();

    const refusal = screen.getByRole("region", { name: "What VOID refuses" });
    for (const claim of CLAIMS) {
      expect(within(refusal).getByText(claim)).toBeInTheDocument();
    }
  });

  it("points the \"Why we built this\" link at /why", () => {
    renderMedia();

    const link = screen.getByRole("link", { name: /Why we built this/i });
    expect(link.getAttribute("href")).toBe("/why");
  });
});
