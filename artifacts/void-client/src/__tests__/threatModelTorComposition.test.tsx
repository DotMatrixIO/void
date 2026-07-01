// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";

// Pins the unified Tor / media-path paragraph on ThreatModelPage so a
// copy edit cannot quietly reintroduce the older "Tor as a clean IP
// swap" framing. Also pins the .onion auto-default paragraph now that
// the auto-relay-only-on-.onion behaviour is implemented in
// PreviewGate — the page's promise is no longer aspirational.

const UNIFIED_PARAGRAPH =
  "Tor protects how you reach VOID’s signaling layer. It does not " +
  "protect the media path. WebRTC gathers connection candidates on " +
  "your underlying network regardless of how this page loaded \u2014 " +
  "so calls reached via .onion will still leak your clearnet IP to " +
  "other peers unless relay-only is enabled, and even then will fall " +
  "back to TURN relay with degraded latency. Tor was not designed " +
  "for real-time media. If you need both peer-IP privacy and call " +
  "quality, those are competing requirements; choose accordingly.";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("DocsThreatModelPage \u2014 Tor composition paragraph", () => {
  it("renders the unified Tor / media-path paragraph verbatim", () => {
    render(<DocsThreatModelPage />);
    const paragraph = screen.getByTestId("tor-composition-paragraph");
    expect(normalize(paragraph.textContent ?? "")).toBe(UNIFIED_PARAGRAPH);
  });

  it("does not contain the older Tor / VPN fragments that were replaced", () => {
    const { container } = render(<DocsThreatModelPage />);
    const body = container.textContent ?? "";
    expect(body).not.toContain("Privacy is layered. We give you the layer we can.");
    expect(body).not.toContain("The VOID server sees only your exit IP.");
    expect(body).not.toContain("You move trust, not eliminate it.");
    expect(body).not.toContain(
      "Your VPN provider sees what we used to see. The Tor network distributes the trust across volunteer relays.",
    );
    expect(body).not.toContain(
      "If your threat model includes hiding from the VOID server itself, relay-only is not enough.",
    );
  });

  it("renders the .onion auto-default paragraph now that PreviewGate implements the behaviour", () => {
    render(<DocsThreatModelPage />);
    const paragraph = screen.getByTestId("tor-onion-default-paragraph");
    const text = normalize(paragraph.textContent ?? "");
    // The page-level promise: reaching VOID over .onion pre-checks the
    // host toggle. PreviewGate's `relayOnly` initialiser is the code
    // half of this contract — keep them aligned.
    expect(text).toContain(
      "If you reached VOID over a Tor .onion address, relay-only is on by default.",
    );
    expect(text).toContain("The host’s toggle is pre-checked");
  });
});
