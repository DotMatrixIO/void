// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef } from "react";

interface Props {
  onDismiss: () => void;
  autoDismissMs?: number;
  // When BURN had to skip a cleanup step (a track.stop() threw, the
  // pipeline failed mid-frame, etc.) we surface a short, user-visible
  // reason so the user knows the call ended for a reason and can act
  // on it (e.g. force-quit the tab if the OS recording dot stays on).
  reason?: string | null;
  // Task #450: separate, security-grade warning rendered when the
  // persisted host token could not be cleared during BURN. The token
  // is encrypted at rest with the phrase, but a host who explicitly
  // BURNED a room should never be left wondering whether the disk
  // still holds the reclaim credential. The literal
  // "BURN INCOMPLETE — TOKEN MAY PERSIST" is locked by the
  // marketing-voice literals gate so a future tone edit cannot soften
  // the warning into hedge-soup.
  tokenWarning?: boolean;
}

export const BURN_AUTO_DISMISS_MS = 3000;

export default function BurnedOverlay({ onDismiss, autoDismissMs = BURN_AUTO_DISMISS_MS, reason, tokenWarning = false }: Props) {
  // One-shot guard: ESC and the auto-dismiss timer can both fire (e.g. if
  // the parent doesn't unmount us synchronously after `onDismiss`), but
  // the burn screen is a single-use exit affordance — never call
  // `onLeave` more than once per mount.
  const firedRef = useRef(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  // Move focus onto the terminal overlay so a keyboard / screen-reader user is
  // not stranded on a now-removed in-call control. role="alertdialog" +
  // assertive live region announce the content; this anchors focus to it.
  useEffect(() => {
    overlayRef.current?.focus();
  }, []);
  useEffect(() => {
    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onDismiss();
    };
    const timer = setTimeout(fire, autoDismissMs);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearTimeout(timer);
        fire();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss, autoDismissMs]);

  return (
    <div
      ref={overlayRef}
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="burn-dialog-title"
      aria-describedby="burn-dialog-desc"
      data-testid="burned-overlay"
      tabIndex={-1}
      className="void-overlay"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "16px",
        background: "#0A0908",
      }}
    >
      <h2
        id="burn-dialog-title"
        style={{
          fontSize: "28px",
          letterSpacing: "8px",
          /* contrast-exception: --red on the overlay's #0A0908 background is
             3.60:1, below body AA. The headline is 28px bold (qualifies as
             WCAG large text, threshold 3:1) and the only red-colored element
             on the overlay — it is the alarm signal, paired with the
             pulse animation and the role="alertdialog" semantics. The
             informational reason line below uses --bg (~9:1). */
          color: "var(--red)",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          textTransform: "uppercase",
          animation: "void-pulse 1.4s ease-in-out 1",
          margin: 0,
        }}
      >
        ROOM BURNED
      </h2>
      <div
        id="burn-dialog-desc"
        style={{
          fontSize: "12px",
          letterSpacing: "3px",
          color: "var(--fg-dim)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
        }}
      >
        ALL KEYS DESTROYED
      </div>
      {reason ? (
        <div
          data-testid="burned-overlay-reason"
          role="status"
          style={{
            maxWidth: "560px",
            padding: "0 24px",
            fontSize: "11px",
            letterSpacing: "2px",
            // Task #406: --red on #0A0908 = 3.60:1 fails AA for 11px body
            // text. The pulsing 28px ROOM BURNED headline above is the
            // alarm signal; the reason line is informational copy and uses
            // --bg (~9:1) so users actually read why the call ended.
            color: "var(--bg)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          {reason}
        </div>
      ) : null}
      {tokenWarning ? (
        <div
          data-testid="burned-overlay-token-warning"
          role="alert"
          style={{
            maxWidth: "560px",
            padding: "8px 24px",
            fontSize: "13px",
            letterSpacing: "2px",
            // Task #450: persisted-host-token cleanup failure is a
            // separate, security-grade signal — not informational. We
            // use the same --bg high-contrast color as the reason line
            // (the ROOM BURNED headline above remains the alarm
            // signal) and a slightly larger size to distinguish this
            // warning from the optional cleanup reason text.
            color: "var(--bg)",
            border: "1px solid var(--red)",
            background: "rgba(0, 0, 0, 0.35)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.5,
            fontWeight: 700,
          }}
        >
          BURN INCOMPLETE — TOKEN MAY PERSIST
        </div>
      ) : null}
      <div
        style={{
          fontSize: "11px",
          letterSpacing: "2px",
          color: "var(--fg-dim)",
          fontFamily: "var(--font-mono)",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        PRESS ESC TO CLOSE
      </div>
    </div>
  );
}
