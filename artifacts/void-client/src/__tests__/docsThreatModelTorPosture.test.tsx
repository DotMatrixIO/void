// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";
import DocsAuditPage from "@/pages/docs/DocsAuditPage";

// Task #1034: the in-app long-form docs must carry (a) the shipped soft
// Tor-default surface in user terms (CLEARNET PATH indicator, footer
// one-click switch, honest bootstrap disclosure) WITHOUT implying clearnet
// exposure is removed or that the user is forced onto .onion (hard default
// held — see docs/tor-default-path-decision.md), and (b) a verify-don't-trust
// pointer to /api/proof/posture / the POSTURE ATTESTATION block on
// /proof/runtime carrying the same non-claims the server's caveat names
// (un-modified binary not proven, TOCTOU window, possible upstream logging
// proxy). Pinned so a future copy edit can't silently regress either.

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("DocsThreatModelPage — soft Tor-default surface (#1034)", () => {
  it("explains the .onion path is preferred with clearnet as an explicit choice", () => {
    render(<DocsThreatModelPage />);
    const p = normalize(
      screen.getByTestId("tor-soft-default-paragraph").textContent ?? "",
    );
    expect(p).toContain("preferred path");
    // The footer one-click switch names the current path.
    expect(p).toContain("You are on the clearnet path");
    // The reachability-aware downgrade.
    expect(p).toContain("requires Tor Browser");
  });

  it("names the in-call CLEARNET PATH indicator", () => {
    const { container } = render(<DocsThreatModelPage />);
    expect(normalize(container.textContent ?? "")).toContain("CLEARNET PATH");
  });

  it("keeps the bootstrap disclosure honest (no false IP-hiding claim)", () => {
    render(<DocsThreatModelPage />);
    const p = normalize(
      screen.getByTestId("tor-bootstrap-honesty-paragraph").textContent ?? "",
    );
    expect(p).toContain("already reached us over the public internet");
    expect(p).toContain("does not hide your IP from the other people");
  });

  it("states the hard default is held: clearnet not removed, user not forced", () => {
    render(<DocsThreatModelPage />);
    const p = normalize(
      screen.getByTestId("tor-soft-default-not-forced-paragraph").textContent ??
        "",
    );
    expect(p).toContain("you are not forced onto .onion");
    expect(p).toContain("clearnet exposure is not removed");
    expect(p).toContain("still loads over clearnet by default");
  });

  it("points to the posture attestation as a verify-don't-trust affordance", () => {
    render(<DocsThreatModelPage />);
    const p = normalize(
      screen.getByTestId("tor-posture-verify-paragraph").textContent ?? "",
    );
    expect(p).toContain("/api/proof/posture");
    expect(p).toContain("POSTURE ATTESTATION");
    expect(p).toContain("/proof/runtime");
  });

  it("carries the posture non-claims verbatim in spirit (TOCTOU, binary, proxy)", () => {
    render(<DocsThreatModelPage />);
    const p = normalize(
      screen.getByTestId("tor-posture-nonclaims-paragraph").textContent ?? "",
    );
    expect(p).toContain("un-modified");
    expect(p).toContain("time-of-check");
    expect(p).toContain("logging proxy");
    expect(p).toContain("structurally cannot ever see an IP");
  });

  it("exposes the deep-link anchors the in-app switch and posture block target (#1039)", () => {
    const { container } = render(<DocsThreatModelPage />);
    // The footer .onion switch (OnionMirrorLink) and the /proof/runtime
    // POSTURE ATTESTATION block deep-link to these exact ids; if a copy edit
    // renames or drops a heading without the id, those links silently break.
    expect(
      container.querySelector("#how-void-surfaces-the-onion-path"),
    ).not.toBeNull();
    expect(container.querySelector("#verify-the-posture")).not.toBeNull();
  });
});

describe("DocsAuditPage — live posture verify pointer (#1034)", () => {
  it("points the verification-minded reader at /proof/runtime and the posture", () => {
    render(<DocsAuditPage />);
    const p = normalize(
      screen.getByTestId("audit-verify-live-paragraph").textContent ?? "",
    );
    expect(p).toContain("/proof/runtime");
    expect(p).toContain("POSTURE ATTESTATION");
    expect(p).toContain("/api/proof/posture");
    // Verify-don't-trust framing plus the named limits.
    expect(p).toContain("Verify it rather than trust it");
    expect(p).toContain("time-of-check");
  });
});
