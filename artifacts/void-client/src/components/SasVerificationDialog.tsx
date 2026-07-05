// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { SasProofCaption } from "./ProofCaptions";

export type SasVerifyState = "unverified" | "verified" | "mismatch" | "pending";

interface Props {
  sas: [string, string];
  vState: SasVerifyState;
  /**
   * Short, human-facing identifier for the peer being verified (e.g. "P1").
   * Used to give the dialog an accessible name that names the peer, so a
   * screen-reader user knows which participant they are verifying.
   */
  peerLabel: string;
  peerVoiceModeLabel: string | null;
  isNarrowViewport: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  onVerified: () => void;
  onMismatch: () => void;
  layoutTick?: number;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Visually-hidden but exposed to assistive tech. Used to prefix the SAS words
// with a spoken label so a screen-reader user knows what is being read aloud.
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

function computePanelStyle(
  isNarrowViewport: boolean,
  anchor: HTMLElement | null,
): CSSProperties {
  if (isNarrowViewport || !anchor || !anchor.isConnected) {
    return {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(92vw, 380px)",
      maxHeight: "calc(100dvh - 32px)",
      overflowY: "auto",
    };
  }
  const rect = anchor.getBoundingClientRect();
  const PANEL_WIDTH = 300;
  const GAP = 8;
  const margin = 8;
  let right = Math.max(margin, window.innerWidth - rect.right);
  right = Math.min(right, Math.max(margin, window.innerWidth - PANEL_WIDTH - margin));
  let bottom = window.innerHeight - rect.top + GAP;
  if (bottom + 240 > window.innerHeight - margin) {
    bottom = Math.max(margin, window.innerHeight - rect.bottom - GAP - 240);
  }
  return {
    position: "fixed",
    right: `${right}px`,
    bottom: `${bottom}px`,
    width: `${PANEL_WIDTH}px`,
    maxWidth: `calc(100vw - ${margin * 2}px)`,
  };
}

export default function SasVerificationDialog({
  sas,
  vState,
  peerLabel,
  peerVoiceModeLabel,
  isNarrowViewport,
  anchor,
  onClose,
  onVerified,
  onMismatch,
  layoutTick,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  void layoutTick;

  useEffect(() => {
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? anchor;
    const dialog = dialogRef.current;
    if (dialog) {
      const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const d = dialogRef.current;
      if (!d) return;
      const focusables = Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!active || active === firstEl || !d.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (!active || active === lastEl || !d.contains(active)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const prev = previouslyFocusedRef.current;
      if (prev && document.body.contains(prev)) {
        try {
          prev.focus();
        } catch {
          // ignore
        }
      }
    };
    // anchor identity changes invalidate focus restoration target; safe to
    // re-run because the parent re-mounts the dialog per opened peer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panelStyle = computePanelStyle(isNarrowViewport, anchor);

  return createPortal(
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: isNarrowViewport ? "rgba(10, 9, 8, 0.6)" : "transparent",
          zIndex: 9998,
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Verify SAS phrase pair with ${peerLabel}`}
        aria-describedby="sas-dialog-words sas-dialog-instructions"
        data-testid="sas-verification-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          ...panelStyle,
          background: "var(--bg)",
          border: "3px solid var(--fg-dim)",
          padding: isNarrowViewport ? "20px 22px" : "16px 18px",
          fontFamily: "var(--font-mono)",
          color: "var(--fg-dim)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          gap: isNarrowViewport ? "16px" : "12px",
          textAlign: "center",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        <h2
          id="sas-dialog-title"
          style={{
            fontSize: "12px",
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--fg-dim)",
            margin: 0,
            fontWeight: 700,
          }}
        >
          VERIFY SAS
        </h2>
        <div
          id="sas-dialog-words"
          style={{
            fontSize: isNarrowViewport ? "24px" : "20px",
            letterSpacing: "2px",
            color: "#0A0908",
            fontWeight: 700,
            textTransform: "lowercase",
            wordSpacing: "8px",
            lineHeight: 1.3,
          }}
        >
          {/* Spoken-only label so a screen-reader user hears the two words
              announced as natural words (e.g. "Verification words: abandon
              foam") when the dialog opens. Visual users see only the words. */}
          <span style={srOnly}>Verification words: </span>
          {sas[0]} {sas[1]}
        </div>
        <SasProofCaption />
        <div
          id="sas-dialog-instructions"
          style={{
            fontSize: "12px",
            lineHeight: 1.5,
            color: "var(--fg-dim)",
            textTransform: "none",
          }}
        >
          Compare these words with your peer using a trusted side channel or in
          person. If they match, mark verified.
        </div>
        {peerVoiceModeLabel && (
          <div
            role="alert"
            style={{
              border: "2px solid var(--gold)",
              background: "var(--surface-dark)",
              padding: isNarrowViewport ? "10px 12px" : "8px 10px",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: "4px",
            }}
          >
            <div
              style={{
                color: "var(--gold)",
                fontWeight: 700,
                fontSize: "12px",
                letterSpacing: "1.5px",
                textTransform: "uppercase",
              }}
            >
              VOICE MASK ACTIVE ({peerVoiceModeLabel})
            </div>
            <div
              style={{
                color: "var(--fg-dim)",
                fontSize: "12px",
                lineHeight: 1.5,
                textTransform: "none",
              }}
            >
              Your peer is reading these words through a transformed voice, so
              you can’t recognize the speaker. Ask them to switch back to VOICE
              for the verbal confirmation.
            </div>
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: isNarrowViewport ? "10px" : "8px",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="void-btn void-btn--teal"
            onClick={() => {
              onVerified();
              onClose();
            }}
            style={{
              fontSize: "12px",
              padding: isNarrowViewport ? "12px 16px" : "6px 10px",
              letterSpacing: "1.5px",
              minHeight: isNarrowViewport ? "44px" : undefined,
            }}
          >
            WORDS MATCH
          </button>
          <button
            type="button"
            className="void-btn void-btn--red"
            onClick={() => {
              onMismatch();
              onClose();
            }}
            style={{
              fontSize: "12px",
              padding: isNarrowViewport ? "12px 16px" : "6px 10px",
              letterSpacing: "1.5px",
              minHeight: isNarrowViewport ? "44px" : undefined,
            }}
          >
            DON’T MATCH
          </button>
        </div>
        {vState !== "unverified" && (
          <div
            style={{
              fontSize: "12px",
              letterSpacing: "1.5px",
              color: "var(--fg-dim)",
              textTransform: "uppercase",
            }}
          >
            CURRENT: {vState === "verified" ? "YOU VERIFIED" : "CHECK FAILED"} —
            REOPEN ANYTIME TO CHANGE
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
