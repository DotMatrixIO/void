// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  WHY_REDIRECT_ANCHORS,
  whyAnchorRedirectTarget,
} from "@/components/short-form/anchorRedirects";

// Task #545 (originally) + WHY-IA rework: every pre-existing
// /why#<anchor> deep link must resolve to
// /docs/how-it-works#<same-anchor>. The destination renamed from
// /docs/why → /docs/how-it-works when the wonkish content split from
// the new short Gameboy-origin WHY prose. The mapping lives in a
// single shared module so the redirect (WhyPage.tsx) and the test
// agree on the set.

describe("WHY anchor redirects", () => {
  it("covers the five major pre-existing /why anchors", () => {
    for (const hash of [
      "#encryption",
      "#philosophy",
      "#the-void-phrase",
      "#video-filters",
      "#voice-masks",
    ]) {
      expect(WHY_REDIRECT_ANCHORS.has(hash)).toBe(true);
    }
  });

  it("maps a known anchor to /docs/how-it-works with the same anchor", () => {
    expect(whyAnchorRedirectTarget("#encryption", "/")).toBe(
      "/docs/how-it-works#encryption",
    );
    expect(whyAnchorRedirectTarget("#philosophy", "/")).toBe(
      "/docs/how-it-works#philosophy",
    );
  });

  it("respects a non-trivial base path", () => {
    expect(whyAnchorRedirectTarget("#video-filters", "/void/")).toBe(
      "/void/docs/how-it-works#video-filters",
    );
  });

  it("returns null for unknown anchors and the empty hash", () => {
    expect(whyAnchorRedirectTarget("", "/")).toBeNull();
    expect(whyAnchorRedirectTarget("#nope", "/")).toBeNull();
  });
});
