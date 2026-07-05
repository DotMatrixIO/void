// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/OnionMirrorLink", () => ({ default: () => null }));
vi.mock("@/components/BuildProvenanceBadge", () => ({ default: () => null }));

import PageFooter from "@/components/PageFooter";

// Task #545: PageFooter must carry a DOCS link to /docs in both
// background modes (tan and on-pavement) so the docs index is
// discoverable from every info page that mounts the shared footer.

describe("PageFooter DOCS link (task #545)", () => {
  it("renders a DOCS link to /docs", () => {
    render(<PageFooter />);
    const link = screen.getByTestId("footer-docs-link");
    expect(link.getAttribute("href")).toBe("/docs");
    expect(link.textContent).toMatch(/DOCS/);
  });

  it("renders the DOCS link in onPavement mode too", () => {
    render(<PageFooter onPavement />);
    expect(screen.getByTestId("footer-docs-link").getAttribute("href")).toBe(
      "/docs",
    );
  });
});
