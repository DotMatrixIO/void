// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

// Task #530: in-app operator banner shown when the API server reports
// `no_turn_configured: true` on /api/ice-servers. The server already
// fails closed (no public-STUN fallback, see #372), but historically
// the only signal to the operator was a single startup WARN line.
// Operators have reported "VOID is broken for some of my users" when
// the real cause was just an unconfigured TURN. This banner surfaces
// the misconfiguration from the running app itself so it is
// discoverable without scraping logs.
//
// Visibility rules:
//   - Only rendered to the room host (caller gates on `isHost`).
//     Guests never see operator-config noise.
//   - Dismissal persists per-browser (localStorage) so a host who has
//     already acknowledged the warning is not nagged on every join.
//   - Keyed by `window.location.origin` so a host who operates more
//     than one deployment (or tries the same browser against a fixed
//     server later) gets a fresh banner per origin.

const STORAGE_KEY_PREFIX = "void:no-turn-dismissed:";

function storageKey(): string {
  const origin =
    typeof window !== "undefined" && window.location
      ? window.location.origin
      : "unknown";
  return `${STORAGE_KEY_PREFIX}${origin}`;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(storageKey()) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(storageKey(), "1");
  } catch {
    // Storage may be unavailable (private mode, quota). Silent
    // fallback: the banner will reappear next session, which is the
    // least-surprising failure mode for an operator-facing nag.
  }
}

interface Props {
  // When true, render the banner (subject to per-origin dismissal).
  // The caller is responsible for gating this on `isHost` so guests
  // never see it.
  show: boolean;
}

export default function NoTurnBanner({ show }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  // If the operator clears localStorage in DevTools the banner should
  // reappear on next mount; we re-read on `show` transitions so a
  // late-arriving /api/ice-servers response also re-evaluates.
  useEffect(() => {
    if (show) setDismissed(readDismissed());
  }, [show]);

  if (!show || dismissed) return null;

  function handleDismiss() {
    writeDismissed();
    setDismissed(true);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="no-turn-banner"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "10px",
        padding: "8px 14px",
        background: "#2A1810",
        borderBottom: "2px solid var(--burnt, #C04A1A)",
        color: "var(--burnt, #C04A1A)",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        fontWeight: 700,
        letterSpacing: "1.2px",
        textTransform: "uppercase",
      }}
    >
      <span style={{ flex: 1, textAlign: "center" }}>
        OPERATOR: NO TURN CONFIGURED — CROSS-NAT CALLS MAY FAIL. SEE
        README-SELFHOST §4A.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss no-TURN operator banner"
        data-testid="no-turn-banner-dismiss"
        style={{
          background: "transparent",
          border: "none",
          color: "var(--burnt, #C04A1A)",
          fontFamily: "var(--font-mono)",
          fontSize: "16px",
          fontWeight: 700,
          cursor: "pointer",
          padding: "0 4px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
