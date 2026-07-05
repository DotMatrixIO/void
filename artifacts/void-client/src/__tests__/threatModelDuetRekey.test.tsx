// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";
import ThreatModelPage from "@/pages/ThreatModelPage";

// Task #805: the "KEYS ROTATED / RE-VERIFY SAS" behaviour ships as a real
// security feature — WebRTCManager fires onRekey after a completed ECDHE
// handshake whose key fingerprint changed (src/lib/webrtc.ts),
// useRoomCrypto.handleRekey invalidates the prior SAS verdict for that peer
// (src/hooks/useRoomCrypto.ts), and PeerTileGrid surfaces the persistent
// re-verify banner (src/pages/room/PeerTileGrid.tsx). Both threat-model
// surfaces must disclose that a NON-continuous mid-call key rotation resets a
// Duet verification, so a copy edit cannot quietly reintroduce the "a verified
// Duet stays clean forever" implication the read-aloud gate flagged.
//
// Time-based PFS rekey (Option A): WebRTCManager ALSO performs a scheduled,
// in-call key rotation over the encrypted `void.rekey` data channel, with each
// new key wrapped under the CURRENT verified session key (src/lib/webrtc.ts).
// Because that rotation is cryptographically proven continuous with the
// already-verified session, it carries the verdict forward and fires the SILENT
// onSilentRekey callback instead of the loud re-verify (src/hooks/useRoomCrypto.ts;
// subtle indicator in src/pages/room/PeerTileGrid.tsx). Both surfaces must keep
// these two paths DISTINCT: a discontinuous key change forces re-verify, a
// continuity-bound scheduled rotation does not.

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("Duet re-verify vs silent rekey disclosure (tasks #805 + PFS rekey)", () => {
  it("discloses on the long page that a non-continuous rekey invalidates the prior verification and prompts re-verify", () => {
    render(<DocsThreatModelPage />);
    const paragraph = normalize(
      screen.getByTestId("duet-rekey-paragraph").textContent ?? "",
    );
    // The verification is thrown out on a discontinuous mid-call key change.
    expect(paragraph).toContain("fresh key exchange in the middle");
    expect(paragraph).toContain("throws out your earlier verification");
    // The persistent re-verify banner literal the user actually sees.
    expect(paragraph).toContain("KEYS ROTATED");
    expect(paragraph).toContain("RE-VERIFY SAS");
    // It must scope the reset to the NON-continuous case (over signaling), not
    // every mid-call key change — otherwise it contradicts the silent rotation.
    expect(paragraph).toContain("cannot prove grew out of the session you already");
  });

  it("discloses on the long page that the scheduled continuity-bound rotation is silent and needs no re-verify", () => {
    render(<DocsThreatModelPage />);
    const paragraph = normalize(
      screen.getByTestId("duet-silent-rekey-paragraph").textContent ?? "",
    );
    // Scheduled, in-call, over the already-verified encrypted channel.
    expect(paragraph).toContain("does not make you re-verify");
    expect(paragraph).toContain("scheduled");
    // The continuity binding: new keys wrapped under the verified keys.
    expect(paragraph).toContain("under the keys you both already confirmed");
    // The verdict carries forward silently — no re-read.
    expect(paragraph).toContain("carries forward");
    expect(paragraph).toContain("not asked to read them");
  });

  it("states on the long page that the Duet is not permanent", () => {
    const { container } = render(<DocsThreatModelPage />);
    const body = normalize(container.textContent ?? "");
    expect(body).toContain("One thing the Duet is not: permanent.");
  });

  it("discloses both paths in plain language on the short page Duet bullet", () => {
    render(<ThreatModelPage />);
    const bullet = normalize(
      screen.getByTestId("threat-model-duet-rekey").textContent ?? "",
    );
    expect(bullet).toContain("A verified Duet is not permanent");
    // Loud path: discontinuous change / reconnect prompts re-verify.
    expect(bullet).toContain("prompts you to run the Duet again");
    // Silent path: proven-continuous scheduled rotation carried forward.
    expect(bullet).toContain("carried forward silently");
  });
});
