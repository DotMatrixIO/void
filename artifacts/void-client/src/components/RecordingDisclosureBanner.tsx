// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

// Combined in-call reminder. Two honest nudges share a single transient
// surface so they never stack as two separate page-pushing bars:
//
//   1. Recording honesty (always): we cannot prevent screen recording at
//      the OS or hardware layer (analog hole, OS framebuffer, HDMI
//      capture). The honest response is to keep the room visibly aware
//      that any participant could be recording.
//   2. Headphones / echo (secondary, when `headphonesHint`): with two or
//      more open mics, speakers leak each other's audio back, which
//      echoes for everyone else.
//
// The reminder is a FLOATING overlay (position: fixed) so it adds no
// layout height and never pushes the call chrome around. It is anchored
// in the button-free band above the bottom control bar so it never sits
// on top of an interactive control (verified by the Playwright
// reminder-safe-zone spec across three viewports). It appears on initial
// entry, auto-dismisses after a short window so it does not become
// wallpaper, re-surfaces whenever a new peer joins (because "anyone here"
// just got bigger), and offers a single × to dismiss both lines at once.
//
// State is intentionally per-mount and per-`triggerKey`. We do not
// persist dismissal across rooms — every fresh room session shows the
// reminder again. No localStorage, no cookies, consistent with the
// no-storage policy.

interface Props {
  // When this value changes (e.g. on each new peer join), the reminder
  // re-shows for `autoDismissMs`. It also shows on initial mount because
  // the very first render counts as "the local user just joined".
  triggerKey: number;
  // Auto-dismiss delay; defaults to ~5s. The reminder can also be
  // manually dismissed earlier via the × button.
  autoDismissMs?: number;
  // When true, the secondary headphones/echo line is shown beneath the
  // recording line. Driven by RoomPage's echo heuristic (2+ open mics).
  headphonesHint?: boolean;
}

export default function RecordingDisclosureBanner({
  triggerKey,
  autoDismissMs = 5_000,
  headphonesHint = false,
}: Props) {
  // Start hidden and reveal via requestAnimationFrame so that the
  // position:fixed overlay never appears before the browser has
  // committed the first layout pass. On WebKit (Safari) the in-flow
  // peer SAS chips are positioned one paint behind fixed elements
  // during initial layout settling, which caused a brief transient
  // overlap. Deferring to the next animation frame guarantees the
  // layout is stable before we composite the floating banner on top.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let raf: number;
    let id: number;
    raf = requestAnimationFrame(() => {
      setVisible(true);
      id = window.setTimeout(() => setVisible(false), autoDismissMs);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(id);
    };
  }, [triggerKey, autoDismissMs]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="recording-disclosure-banner"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "112px",
        zIndex: 60,
        maxWidth: "min(92vw, 360px)",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        padding: "8px 12px",
        background: "var(--surface-dark)",
        border: "2px solid var(--gold)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        color: "var(--gold)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          style={{
            flex: 1,
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          ANYONE HERE CAN BE RECORDING
        </span>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss reminder"
          data-testid="recording-disclosure-dismiss"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--gold)",
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
      {headphonesHint && (
        <div
          data-testid="recording-disclosure-headphones"
          style={{
            fontSize: "10px",
            lineHeight: 1.3,
            letterSpacing: "0.6px",
            color: "var(--fg-on-dark)",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          Headphones recommended (helps prevent echo for others)
        </div>
      )}
    </div>
  );
}
