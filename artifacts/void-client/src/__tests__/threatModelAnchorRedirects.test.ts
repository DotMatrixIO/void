// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  THREAT_MODEL_REDIRECT_ANCHORS,
  threatModelAnchorRedirectTarget,
} from "@/components/short-form/anchorRedirects";

// Task #550: every pre-existing /threat-model#<anchor> deep link must
// resolve to /docs/threat-model#<same-anchor> after the route flip.
// The mapping lives in a single shared module so the redirect
// (ThreatModelPage.tsx) and the test agree on the set.

describe("THREAT MODEL anchor redirects (task #550)", () => {
  it("covers the four pre-existing referenced /threat-model anchors", () => {
    for (const hash of [
      "#lightning-ip-leak",
      "#tor-wallet-shortlist",
      "#browser-level-surfaces",
      "#supply-chain",
    ]) {
      expect(THREAT_MODEL_REDIRECT_ANCHORS.has(hash)).toBe(true);
    }
  });

  it("maps a known anchor to /docs/threat-model with the same anchor", () => {
    expect(
      threatModelAnchorRedirectTarget("#browser-level-surfaces", "/"),
    ).toBe("/docs/threat-model#browser-level-surfaces");
    expect(
      threatModelAnchorRedirectTarget("#lightning-ip-leak", "/"),
    ).toBe("/docs/threat-model#lightning-ip-leak");
  });

  it("respects a non-trivial base path", () => {
    expect(
      threatModelAnchorRedirectTarget("#supply-chain", "/void/"),
    ).toBe("/void/docs/threat-model#supply-chain");
  });

  it("returns null for unknown anchors and the empty hash", () => {
    expect(threatModelAnchorRedirectTarget("", "/")).toBeNull();
    expect(threatModelAnchorRedirectTarget("#nope", "/")).toBeNull();
  });
});
