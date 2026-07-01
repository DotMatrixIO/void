// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Link } from "wouter";
import UiSoundsToggle from "@/components/UiSoundsToggle";
import { useAllowUnmaskedToggleControl } from "@/components/AllowUnmaskedToggleControl";

const NAV_LINKS = [
  { label: "WHY", href: "/why" },
  { label: "INVITED?", href: "/invited" },
  { label: "WHY NOT ZOOM", href: "/compare" },
  { label: "THREAT MODEL", href: "/threat-model" },
  { label: "HOW IT WORKS", href: "/how-it-works" },
  { label: "AUDIT", href: "/audit" },
  { label: "BIOMETRIC MASKING", href: "/biometric-masking" },
  { label: "PRICING", href: "/pricing" },
  { label: "LIMITS", href: "/limits" },
];

const toggleBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "var(--surface-dark)",
  border: "1px solid var(--gold)",
  color: "var(--gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "16px",
  letterSpacing: "2px",
  padding: "6px 12px",
  cursor: "pointer",
  textTransform: "uppercase",
};

export default function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  // Task #599: the nav links now live under an expandable "WORDS"
  // umbrella heading at the top; PREFERENCES stays as-is below it.
  const [wordsOpen, setWordsOpen] = useState(true);
  // Task #582: the OFF→ON confirm flow / ON→OFF immediate flow and the
  // confirm-dialog copy are owned by `useAllowUnmaskedToggleControl`
  // so the HamburgerMenu, PreviewGate, and RoomPage stay in lock-step.
  const {
    allowVideo,
    allowVoice,
    handleVideoToggleClick,
    handleVoiceToggleClick,
    confirmDialogs,
  } = useAllowUnmaskedToggleControl();

  return (
    <>
      <button
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          top: "6px",
          right: "6px",
          zIndex: 1000,
          background: "var(--gold)",
          border: "none",
          cursor: "pointer",
          padding: "0",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "30px",
        }}
      >
        {open ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "16px",
              color: "var(--surface-dark)",
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            ✕
          </span>
        ) : (
          <>
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
          </>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "240px",
            zIndex: 999,
            backgroundColor: "var(--surface-dark)",
            backgroundImage:
              "linear-gradient(rgba(20,17,13,0.96), rgba(20,17,13,0.96)), url('/concrete.jpeg')",
            backgroundSize: "auto, 400px auto",
            backgroundRepeat: "repeat",
            borderLeft: "3px solid var(--gold)",
            display: "flex",
            flexDirection: "column",
            paddingTop: "72px",
            paddingBottom: "32px",
            paddingLeft: "0",
            paddingRight: "0",
            overflowY: "auto",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0",
            }}
          >
            <button
              type="button"
              data-testid="words-section-toggle"
              aria-expanded={wordsOpen}
              aria-controls="words-section-links"
              onClick={() => setWordsOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "16px",
                fontWeight: 700,
                letterSpacing: "3px",
                textTransform: "uppercase",
                color: "var(--gold)",
                padding: "10px 28px",
                borderBottom: "1px solid rgba(232,162,0,0.18)",
              }}
            >
              <span>
                <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
                WORDS
              </span>
              <span aria-hidden="true" style={{ color: "var(--burnt)" }}>
                {wordsOpen ? "▾" : "▸"}
              </span>
            </button>

            {wordsOpen && (
              <div id="words-section-links">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    style={{
                      display: "block",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "3px",
                      textTransform: "uppercase",
                      color: "var(--fg-on-dark)",
                      textDecoration: "none",
                      padding: "16px 28px 16px 44px",
                      borderBottom: "1px solid rgba(232,162,0,0.18)",
                      transition: "color 0.1s, background 0.1s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color = "var(--gold)";
                      (e.currentTarget as HTMLAnchorElement).style.background =
                        "rgba(232,162,0,0.06)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg-on-dark)";
                      (e.currentTarget as HTMLAnchorElement).style.background =
                        "transparent";
                    }}
                  >
                    <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* MEDIA: a top-level entry (sibling of the WORDS umbrella) for the
              demo videos + refusal band that now live on the /media page. */}
          <Link
            href="/media"
            data-testid="media-nav-link"
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "var(--gold)",
              textDecoration: "none",
              padding: "10px 28px",
              borderBottom: "1px solid rgba(232,162,0,0.18)",
            }}
          >
            <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
            MEDIA
          </Link>

          {/* PREFERENCES section. UI Sounds (task #420) lives here too;
              task #572 adds the two ALLOW UNMASKED toggles. Both new
              toggles default OFF; OFF → ON shows a ConfirmDialog so a
              stray tap can't expose the user's real face or voice.
              ON → OFF is immediate and the consumers (PreviewGate /
              RoomPage) revert any active NONE mode to the default
              mask via their maskingPrefs subscription. */}
          <div
            style={{
              padding: "10px 28px 14px",
              borderTop: "1px solid rgba(232,162,0,0.18)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "3px",
                textTransform: "uppercase",
                color: "#5C5040",
              }}
            >
              <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
              PREFERENCES
            </div>
            <UiSoundsToggle style={toggleBtnStyle} />
            <button
              type="button"
              data-testid="allow-unmasked-video-toggle"
              aria-label={
                allowVideo ? "Allow unmasked video on" : "Allow unmasked video off"
              }
              aria-pressed={allowVideo}
              onClick={handleVideoToggleClick}
              style={{
                ...toggleBtnStyle,
                ...(allowVideo
                  ? { background: "var(--gold)", color: "var(--surface-dark)" }
                  : {}),
              }}
              title={
                allowVideo
                  ? "Unmasked video is allowed. Click to disable. Any current NONE selection will snap back to the default mask."
                  : "Unmasked video is blocked (default). Click to allow; you’ll be asked to confirm."
              }
            >
              {allowVideo
                ? "✓ ALLOW UNMASKED VIDEO"
                : "ALLOW UNMASKED VIDEO"}
            </button>
            <button
              type="button"
              data-testid="allow-unmasked-voice-toggle"
              aria-label={
                allowVoice ? "Allow unmasked voice on" : "Allow unmasked voice off"
              }
              aria-pressed={allowVoice}
              onClick={handleVoiceToggleClick}
              style={{
                ...toggleBtnStyle,
                ...(allowVoice
                  ? { background: "var(--gold)", color: "var(--surface-dark)" }
                  : {}),
              }}
              title={
                allowVoice
                  ? "Unmasked voice is allowed. Click to disable. Any current NONE selection will snap back to the default mask."
                  : "Unmasked voice is blocked (default). Click to allow; you’ll be asked to confirm."
              }
            >
              {allowVoice
                ? "✓ ALLOW UNMASKED VOICE"
                : "ALLOW UNMASKED VOICE"}
            </button>
          </div>

          <div
            style={{
              padding: "0 28px",
              fontSize: "12px",
              letterSpacing: "2px",
              color: "#5C5040",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            © 2026 VOID
          </div>
        </div>
      )}

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 998,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      )}

      {confirmDialogs}
    </>
  );
}
