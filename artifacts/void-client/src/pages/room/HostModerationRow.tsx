// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

// Visually-hidden but exposed to assistive tech. Used for the polite knock
// announcement so a screen-reader user hears that someone is knocking without
// the on-screen mono/letter-spaced banner being read out character by
// character.
const srOnly: CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

// Render the short guest tag the same way the visible banner does, so the
// audible announcement and the on-screen label refer to the same person.
function knockLabel(peerId: string): string {
  return peerId.slice(-6).toUpperCase();
}

interface HostModerationRowProps {
  pendingKnocks: string[];
  handleApproveKnock: (pid: string) => void;
  handleDenyKnock: (pid: string) => void;
  isHost: boolean;
  pendingRelayRequests: string[];
  handleRespondRelayRequest: (pid: string, accept: boolean) => void;
}

export default function HostModerationRow({
  pendingKnocks,
  handleApproveKnock,
  handleDenyKnock,
  isHost,
  pendingRelayRequests,
  handleRespondRelayRequest,
}: HostModerationRowProps) {
  return (
    <>
      {/* Knock notifications. Wrapped in a labelled region so a screen-reader
          user can find the incoming-knock controls, and paired with a polite
          visually-hidden live region (Task #309 deliberately left these
          banners un-trapped — passive notifications mid-call must not steal
          keyboard focus from the host — so the audible cue is delivered via
          aria-live="polite" rather than a focus trap). */}
      {pendingKnocks.length > 0 && (
        <div
          role="region"
          aria-label="Incoming knock requests"
          data-testid="knock-region"
          style={{
            background: "var(--surface)",
            borderBottom: "2px solid var(--gold)",
            padding: "8px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {/* Visually-hidden polite announcement. Re-rendering the current
              pending list as natural-language sentences means each newly
              added knock changes this node's content and is read aloud,
              without trapping focus or relying on the mono/letter-spaced
              visible banner. */}
          <div role="status" aria-live="polite" data-testid="knock-announcement" style={srOnly}>
            {pendingKnocks.map((kp) => (
              <p key={kp}>{`Guest ${knockLabel(kp)} is knocking and waiting to be let in.`}</p>
            ))}
          </div>
          {pendingKnocks.map((kp) => (
            <div key={kp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              {/* Task #1114: was var(--gold) on var(--surface) (1.21:1,
                  unreadable). --fg passes AA; the gold bottom border keeps
                  the accent. */}
              <div aria-hidden="true" style={{ fontSize: "12px", letterSpacing: "2px", color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
                {knockLabel(kp)} IS KNOCKING
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="void-btn void-btn--teal active"
                  onClick={() => handleApproveKnock(kp)}
                  aria-label={`Admit guest ${knockLabel(kp)}`}
                  style={{ fontSize: "12px", padding: "4px 10px", letterSpacing: "1px" }}
                >
                  ADMIT
                </button>
                <button
                  className="void-btn void-btn--red active"
                  onClick={() => handleDenyKnock(kp)}
                  aria-label={`Deny guest ${knockLabel(kp)}`}
                  style={{ fontSize: "12px", padding: "4px 10px", letterSpacing: "1px" }}
                >
                  DENY
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Host-side accept/decline prompts for incoming relay-only
          requests (Task #106). Mirrors the knock-prompt pattern. */}
      {isHost && pendingRelayRequests.length > 0 && (
        <div
          data-testid="relay-only-request-prompt"
          style={{
            background: "var(--surface)",
            borderBottom: "2px solid var(--teal)",
            padding: "8px 16px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {pendingRelayRequests.map((rp) => (
            <div key={rp} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
              {/* Task #1114: was var(--teal) on var(--surface) (1.28:1,
                  unreadable). --fg passes AA; the teal bottom border keeps
                  the accent. */}
              <div style={{ fontSize: "12px", letterSpacing: "2px", color: "var(--fg)", fontFamily: "var(--font-mono)" }}>
                {rp.replace(/^peer-/, "PEER-").toUpperCase()} ASKS FOR RELAY ONLY
              </div>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  className="void-btn void-btn--teal active"
                  onClick={() => handleRespondRelayRequest(rp, true)}
                  data-testid={`relay-only-accept-${rp}`}
                  style={{ fontSize: "12px", padding: "4px 10px", letterSpacing: "1px" }}
                >
                  ACCEPT
                </button>
                <button
                  className="void-btn void-btn--red active"
                  onClick={() => handleRespondRelayRequest(rp, false)}
                  data-testid={`relay-only-decline-${rp}`}
                  style={{ fontSize: "12px", padding: "4px 10px", letterSpacing: "1px" }}
                >
                  DECLINE
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
