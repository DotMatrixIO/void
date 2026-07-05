// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/HamburgerMenu", () => ({ default: () => null }));
vi.mock("@/components/PageFooter", () => ({
  default: () => <div data-testid="page-footer" />,
}));

import DocsAuditPage from "./DocsAuditPage";

describe("DocsAuditPage — long-form published security audit summary", () => {
  it("renders the page hero heading", () => {
    render(<DocsAuditPage />);
    expect(screen.getByRole("heading", { name: /the audit/i })).toBeInTheDocument();
  });

  it("renders all eight High and Medium finding IDs at least once", () => {
    render(<DocsAuditPage />);
    // Each finding ID appears in the status table and the per-finding
    // summary; at least one occurrence per ID is enough to confirm the
    // page lists the full High/Medium set.
    const ids = ["H-01", "H-05", "M-01", "M-02", "M-03", "M-04", "M-05", "M-06"];
    for (const id of ids) {
      expect(screen.getAllByText(new RegExp(`\\b${id}\\b`)).length).toBeGreaterThan(0);
    }
  });

  it("marks M-04 explicitly as a documented limitation rather than a code fix", () => {
    render(<DocsAuditPage />);
    // The finding-summary block carries the "DOCUMENTED" badge and the
    // status note pointing at the threat-model page item §2. Both must
    // be present so a reader of /audit cannot miss that M-04 has no
    // code fix.
    expect(screen.getAllByText(/DOCUMENTED/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/threat-model item §2/i).length).toBeGreaterThan(0);
  });

  it("links to the published audit markdown in the source tree", () => {
    render(<DocsAuditPage />);
    expect(
      screen.getAllByText(/docs\/security-audit-public-2026-04\.md/).length,
    ).toBeGreaterThan(0);
  });

  it("renders the 'WHAT A STATIC AUDIT CANNOT TELL YOU' limitations section", () => {
    render(<DocsAuditPage />);
    expect(
      screen.getByText(/WHAT A STATIC AUDIT CANNOT TELL YOU/),
    ).toBeInTheDocument();
  });
});
