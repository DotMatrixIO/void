// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/OnionMirrorLink", () => ({ default: () => null }));
vi.mock("@/components/BuildProvenanceBadge", () => ({ default: () => null }));

const SAMPLE_REPO_URL = "https://codeberg.org/void/void-client";

// Mutable mock state so each test can flip the placeholder-vs-real decision.
// REPO_URL is read at render time (in JSX), so toggling between renders works.
const repoState = vi.hoisted(() => ({
  url: "[[TO BE ADDED]]",
  hasRepo: false,
}));

vi.mock("@/lib/repo", () => ({
  REPO_URL_PLACEHOLDER: "[[TO BE ADDED]]",
  get REPO_URL() {
    return repoState.url;
  },
  hasPublicRepo: () => repoState.hasRepo,
}));

import PageFooter from "@/components/PageFooter";

// Task #719: lock in PageFooter's hide-when-unpublished source link. While
// REPO_URL is the placeholder the SOURCE / SELF-HOST line must not render at
// all (no broken link, no literal "[[TO BE ADDED]]"); once a real repo-root
// URL is set it renders as a label-only link to that URL.

describe("PageFooter SOURCE / SELF-HOST link (task #719)", () => {
  beforeEach(() => {
    repoState.url = "[[TO BE ADDED]]";
    repoState.hasRepo = false;
  });

  it("renders no source link or placeholder text while REPO_URL is the placeholder", () => {
    repoState.url = "[[TO BE ADDED]]";
    repoState.hasRepo = false;

    render(<PageFooter />);

    expect(screen.queryByText("SOURCE / SELF-HOST")).toBeNull();
    expect(screen.queryByText(/TO BE ADDED/)).toBeNull();
  });

  it("renders a label-only SOURCE / SELF-HOST link to the repo root once a real URL is set", () => {
    repoState.url = SAMPLE_REPO_URL;
    repoState.hasRepo = true;

    render(<PageFooter />);

    const link = screen.getByText("SOURCE / SELF-HOST");
    expect(link.tagName).toBe("A");
    expect(link.textContent).toBe("SOURCE / SELF-HOST");
    expect(link.getAttribute("href")).toBe(SAMPLE_REPO_URL);
  });
});
