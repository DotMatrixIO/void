// SPDX-License-Identifier: AGPL-3.0-or-later
interface ExpiryWarningToastProps {
  isHost: boolean;
  expiryWarningPhase: string;
  expiresAtWallClock: number | null;
  remainingMs: number | null;
  roomTier: "standard" | "day" | null;
  extendInFlight: boolean;
  expiryWarningSnoozeUsed: boolean;
  formatWallClock: (epochMs: number) => string;
  formatRemaining: (ms: number) => string;
  handleOpenExtend: () => void;
  snoozeExpiryWarning: () => void;
  dismissExpiryWarning: () => void;
}

export default function ExpiryWarningToast({
  isHost,
  expiryWarningPhase,
  expiresAtWallClock,
  remainingMs,
  roomTier,
  extendInFlight,
  expiryWarningSnoozeUsed,
  formatWallClock,
  formatRemaining,
  handleOpenExtend,
  snoozeExpiryWarning,
  dismissExpiryWarning,
}: ExpiryWarningToastProps) {
  if (!(isHost && expiryWarningPhase === "showing" && expiresAtWallClock !== null)) {
    return null;
  }
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="expiry-warning-toast"
      style={{
        background: "var(--surface)",
        borderBottom: "2px solid var(--gold)",
        color: "var(--gold)",
        fontSize: "12px",
        letterSpacing: "2px",
        padding: "8px 12px",
        fontFamily: "var(--font-mono)",
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
      }}
    >
      <span style={{ textAlign: "center" }}>
        ROOM ENDS AT {formatWallClock(expiresAtWallClock)}
        {remainingMs !== null ? ` · ${formatRemaining(remainingMs)} LEFT` : ""} — WRAP IT UP OR EXTEND THE ROOM
      </span>
      {(roomTier === "standard" || roomTier === "day") && (
        <button
          type="button"
          onClick={handleOpenExtend}
          disabled={extendInFlight}
          aria-label="Extend this room by paying another invoice"
          data-testid="expiry-warning-extend"
          style={{
            background: "var(--gold)",
            border: "1px solid var(--gold)",
            color: "var(--surface-dark)",
            padding: "2px 10px",
            fontSize: "12px",
            letterSpacing: "2px",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            cursor: extendInFlight ? "wait" : "pointer",
            opacity: extendInFlight ? 0.6 : 1,
          }}
        >
          {extendInFlight ? "EXTENDING…" : "EXTEND"}
        </button>
      )}
      {!expiryWarningSnoozeUsed && (
        <button
          type="button"
          onClick={snoozeExpiryWarning}
          aria-label="Snooze room ending warning for 5 minutes"
          data-testid="expiry-warning-snooze"
          style={{
            background: "transparent",
            border: "1px solid var(--gold)",
            color: "var(--gold)",
            padding: "2px 8px",
            fontSize: "12px",
            letterSpacing: "2px",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          SNOOZE 5M
        </button>
      )}
      <button
        type="button"
        onClick={dismissExpiryWarning}
        aria-label="Dismiss room ending warning"
        data-testid="expiry-warning-dismiss"
        style={{
          background: "transparent",
          border: "1px solid var(--gold)",
          color: "var(--gold)",
          padding: "2px 8px",
          fontSize: "12px",
          letterSpacing: "2px",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        DISMISS
      </button>
    </div>
  );
}
