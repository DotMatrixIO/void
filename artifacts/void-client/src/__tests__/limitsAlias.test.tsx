// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #577 guard. The short-form /limits page was removed and the
// long-form DocsLimitsPage is now mounted at BOTH /limits and
// /docs/limits. If a future refactor breaks the /limits alias
// (e.g. by deleting the route, redirecting to a 404, or
// reintroducing a separate short-form page), this test fails.

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

import DocsLimitsPage from "@/pages/docs/DocsLimitsPage";

describe("DocsLimitsPage shared by /limits and /docs/limits (task #577)", () => {
  it("renders the long-form LIMITS opener", () => {
    render(<DocsLimitsPage />);
    expect(screen.getByText("LIMITS")).toBeInTheDocument();
    expect(screen.getByText(/VOID IS FOR/)).toBeInTheDocument();
    expect(screen.getByText(/VOID IS NOT FOR/)).toBeInTheDocument();
  });

  it("renders the ACCESSIBILITY LIMITS section", () => {
    render(<DocsLimitsPage />);
    expect(screen.getByText(/ACCESSIBILITY LIMITS/)).toBeInTheDocument();
  });

  it("top-of-page back link points to / (not /limits)", () => {
    render(<DocsLimitsPage />);
    const back = screen
      .getAllByRole("link")
      .find((a) => (a.textContent ?? "").trim() === "← BACK");
    expect(back).toBeDefined();
    expect(back?.getAttribute("href")).toBe("/");
  });
});

describe("App router /limits alias (task #577)", () => {
  it("App.tsx registers /limits as a route pointing at DocsLimitsPage", async () => {
    // Source-level assertion is intentional: it's cheap, deterministic,
    // and survives any future change to wouter's testing surface.
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const appPath = resolve(here, "..", "App.tsx");
    const src = readFileSync(appPath, "utf8");
    expect(src).toMatch(
      /<Route\s+path="\/limits"\s+component=\{DocsLimitsPage\}\s*\/>/,
    );
    expect(src).toMatch(
      /<Route\s+path="\/docs\/limits"\s+component=\{DocsLimitsPage\}\s*\/>/,
    );
    expect(src).not.toMatch(/from\s+"@\/pages\/LimitsPage"/);
  });
});
