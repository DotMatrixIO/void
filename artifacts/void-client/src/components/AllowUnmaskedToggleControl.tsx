// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useState } from "react";
import ConfirmDialog from "@/components/ConfirmDialog";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";
import { uiClick } from "@/lib/uiSounds";
import {
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
  setAllowUnmaskedVideo,
  setAllowUnmaskedVoice,
  subscribeMaskingPrefs,
} from "@/lib/maskingPrefs";

// Task #582: shared control + confirm dialogs for the two
// ALLOW UNMASKED * preference toggles. Used by HamburgerMenu,
// PreviewGate, and RoomPage so the confirm copy, the
// OFF→ON-needs-confirm / ON→OFF-immediate semantics, and the live
// `subscribeMaskingPrefs` sync all stay in lock-step across the
// three callsites.

// Copy is calibrated for the preview-screen / about-to-join moment
// where a user is most likely to tap through without reading. The
// hamburger menu inherits the same wording — single source of truth.
export const ALLOW_UNMASKED_VIDEO_CONFIRM_BODY =
  "Your unmodified face will be visible to everyone in this call. The video mask will not run.";
export const ALLOW_UNMASKED_VOICE_CONFIRM_BODY =
  "Your unmodified voice will be audible to everyone in this call. The voice mask will not run.";

type PendingConfirm = "video" | "voice" | null;

export interface AllowUnmaskedToggleControl {
  allowVideo: boolean;
  allowVoice: boolean;
  /** OFF→ON opens the ConfirmDialog. ON→OFF flips immediately. */
  handleVideoToggleClick: () => void;
  handleVoiceToggleClick: () => void;
  /** Render the two ConfirmDialogs once near the root of the consumer. */
  confirmDialogs: React.ReactNode;
}

export function useAllowUnmaskedToggleControl(): AllowUnmaskedToggleControl {
  const [allowVideo, setAllowVideoState] = useState<boolean>(() =>
    typeof window !== "undefined" ? getAllowUnmaskedVideo() : false,
  );
  const [allowVoice, setAllowVoiceState] = useState<boolean>(() =>
    typeof window !== "undefined" ? getAllowUnmaskedVoice() : false,
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  useEffect(() => {
    return subscribeMaskingPrefs(() => {
      setAllowVideoState(getAllowUnmaskedVideo());
      setAllowVoiceState(getAllowUnmaskedVoice());
    });
  }, []);

  function handleVideoToggleClick() {
    uiClick();
    if (allowVideo) {
      setAllowUnmaskedVideo(false);
      setAllowVideoState(false);
      return;
    }
    setPendingConfirm("video");
  }

  function handleVoiceToggleClick() {
    uiClick();
    if (allowVoice) {
      setAllowUnmaskedVoice(false);
      setAllowVoiceState(false);
      return;
    }
    setPendingConfirm("voice");
  }

  function confirmPending() {
    if (pendingConfirm === "video") {
      setAllowUnmaskedVideo(true);
      setAllowVideoState(true);
    } else if (pendingConfirm === "voice") {
      setAllowUnmaskedVoice(true);
      setAllowVoiceState(true);
    }
    setPendingConfirm(null);
  }

  function cancelPending() {
    setPendingConfirm(null);
  }

  const confirmDialogs = (
    <>
      <ConfirmDialog
        open={pendingConfirm === "video"}
        testId="allow-unmasked-video-confirm"
        title="ALLOW UNMASKED VIDEO?"
        body={ALLOW_UNMASKED_VIDEO_CONFIRM_BODY}
        confirmLabel="ALLOW"
        cancelLabel="CANCEL"
        onConfirm={confirmPending}
        onCancel={cancelPending}
      />
      <ConfirmDialog
        open={pendingConfirm === "voice"}
        testId="allow-unmasked-voice-confirm"
        title="ALLOW UNMASKED VOICE?"
        body={ALLOW_UNMASKED_VOICE_CONFIRM_BODY}
        confirmLabel="ALLOW"
        cancelLabel="CANCEL"
        onConfirm={confirmPending}
        onCancel={cancelPending}
      />
    </>
  );

  return {
    allowVideo,
    allowVoice,
    handleVideoToggleClick,
    handleVoiceToggleClick,
    confirmDialogs,
  };
}

// Task #586: combined ALLOW CLEAR AUDIO AND VIDEO header toggle for
// the in-call header. ON means at least one of the two prefs is on;
// OFF means both prefs are off. OFF → ON opens a single dialog with
// two checkboxes (both checked by default); the user can deselect
// either side before confirming. ON → OFF flips both prefs OFF
// immediately and surfaces a brief polite status note describing
// the snap-back (the snap-back itself is performed by RoomPage's
// subscribeMaskingPrefs effect).

const SNAP_NOTE_TIMEOUT_MS = 4000;

export interface CombinedAllowUnmaskedHeaderControl {
  /** True if either pref is currently on. */
  allow: boolean;
  /** OFF→ON opens the dialog; ON→OFF flips both immediately. */
  handleToggleClick: () => void;
  /** Render the single combined dialog and any snap-back note. */
  dialog: React.ReactNode;
  snapNote: React.ReactNode;
}

const checkboxRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  padding: "8px 0",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "var(--fg)",
  cursor: "pointer",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
  lineHeight: 1.4,
  textTransform: "uppercase",
  letterSpacing: "1px",
};

export function useCombinedAllowUnmaskedHeaderControl(): CombinedAllowUnmaskedHeaderControl {
  const [allowVideo, setAllowVideoState] = useState<boolean>(() =>
    typeof window !== "undefined" ? getAllowUnmaskedVideo() : false,
  );
  const [allowVoice, setAllowVoiceState] = useState<boolean>(() =>
    typeof window !== "undefined" ? getAllowUnmaskedVoice() : false,
  );
  const [open, setOpen] = useState(false);
  const [pendingVideo, setPendingVideo] = useState(true);
  const [pendingVoice, setPendingVoice] = useState(true);
  const [snapMessage, setSnapMessage] = useState<string | null>(null);

  useEffect(() => {
    return subscribeMaskingPrefs(() => {
      setAllowVideoState(getAllowUnmaskedVideo());
      setAllowVoiceState(getAllowUnmaskedVoice());
    });
  }, []);

  useEffect(() => {
    if (!snapMessage) return;
    const t = window.setTimeout(() => setSnapMessage(null), SNAP_NOTE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [snapMessage]);

  const allow = allowVideo || allowVoice;

  function handleToggleClick() {
    uiClick();
    if (allow) {
      setAllowUnmaskedVideo(false);
      setAllowUnmaskedVoice(false);
      setAllowVideoState(false);
      setAllowVoiceState(false);
      setSnapMessage("MASKS RESTORED — VIDEO: ASCII · VOICE: SCRAMBLE");
      return;
    }
    setPendingVideo(true);
    setPendingVoice(true);
    setOpen(true);
  }

  function handleConfirm() {
    if (pendingVideo) {
      setAllowUnmaskedVideo(true);
      setAllowVideoState(true);
    }
    if (pendingVoice) {
      setAllowUnmaskedVoice(true);
      setAllowVoiceState(true);
    }
    setOpen(false);
  }

  function handleCancel() {
    setOpen(false);
  }

  return {
    allow,
    handleToggleClick,
    dialog: (
      <CombinedAllowUnmaskedDialog
        open={open}
        videoChecked={pendingVideo}
        voiceChecked={pendingVoice}
        onVideoChange={setPendingVideo}
        onVoiceChange={setPendingVoice}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ),
    snapNote: snapMessage ? (
      <div
        role="status"
        aria-live="polite"
        data-testid="header-allow-clear-snap-note"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          letterSpacing: "1px",
          color: "var(--gold)",
          textTransform: "uppercase",
          fontWeight: 700,
          padding: "2px 6px",
        }}
      >
        {snapMessage}
      </div>
    ) : null,
  };
}

interface CombinedDialogProps {
  open: boolean;
  videoChecked: boolean;
  voiceChecked: boolean;
  onVideoChange: (v: boolean) => void;
  onVoiceChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function CombinedAllowUnmaskedDialog({
  open,
  videoChecked,
  voiceChecked,
  onVideoChange,
  onVoiceChange,
  onConfirm,
  onCancel,
}: CombinedDialogProps) {
  const headingId = useId();
  const bodyId = useId();
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({
    onEscape: onCancel,
    active: open,
  });

  if (!open) return null;

  const neitherSelected = !videoChecked && !voiceChecked;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: "16px",
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        data-testid="allow-clear-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={bodyId}
        style={{
          background: "var(--bg)",
          border: "3px solid var(--gold)",
          maxWidth: "440px",
          width: "100%",
          padding: "24px",
          fontFamily: "var(--font-mono)",
          color: "var(--fg)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={headingId}
          style={{
            fontFamily: "'Staatliches', system-ui, sans-serif",
            fontSize: "20px",
            letterSpacing: "3px",
            /* Task #1114: was var(--gold) on the var(--bg) panel (1.35:1,
               unreadable). --fg passes AA; the 3px gold panel border keeps
               the brand accent. */
            color: "var(--fg)",
            textTransform: "uppercase",
            margin: 0,
          }}
        >
          ALLOW CLEAR AUDIO AND VIDEO?
        </h2>
        <p
          id={bodyId}
          style={{
            fontSize: "13px",
            lineHeight: 1.6,
            color: "var(--fg)",
            letterSpacing: "0.5px",
            margin: 0,
          }}
        >
          Selecting either option lets you turn off the corresponding mask
          during this call. Your unmodified face / voice will be visible /
          audible to everyone in this room. Uncheck a box to keep that
          mask locked on.
        </p>
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            data-testid="allow-clear-confirm-video-checkbox"
            checked={videoChecked}
            onChange={(e) => onVideoChange(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16 }}
          />
          <span style={checkboxLabelStyle}>
            <span style={{ fontWeight: 700 }}>Allow clear video</span>
            <span style={{ opacity: 0.8, fontSize: "11px" }}>
              Your real face will be visible.
            </span>
          </span>
        </label>
        <label style={checkboxRowStyle}>
          <input
            type="checkbox"
            data-testid="allow-clear-confirm-voice-checkbox"
            checked={voiceChecked}
            onChange={(e) => onVoiceChange(e.target.checked)}
            style={{ marginTop: 2, width: 16, height: 16 }}
          />
          <span style={checkboxLabelStyle}>
            <span style={{ fontWeight: 700 }}>Allow clear audio</span>
            <span style={{ opacity: 0.8, fontSize: "11px" }}>
              Your real voice will be audible.
            </span>
          </span>
        </label>
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="void-btn"
            data-testid="allow-clear-confirm-cancel"
            onClick={onCancel}
            style={{ fontSize: "16px", padding: "10px 18px", letterSpacing: "2px" }}
          >
            CANCEL
          </button>
          <button
            type="button"
            className="void-btn void-btn--gold active"
            data-testid="allow-clear-confirm-confirm"
            onClick={onConfirm}
            disabled={neitherSelected}
            style={{
              fontSize: "16px",
              padding: "10px 18px",
              letterSpacing: "2px",
              opacity: neitherSelected ? 0.4 : 1,
              cursor: neitherSelected ? "not-allowed" : "pointer",
            }}
          >
            ALLOW
          </button>
        </div>
      </div>
    </div>
  );
}
