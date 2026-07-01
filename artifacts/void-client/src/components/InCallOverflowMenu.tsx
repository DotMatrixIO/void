// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { uiClick } from "@/lib/uiSounds";
import UiSoundsToggle from "@/components/UiSoundsToggle";

// Task #594 / #597: in-call overflow ("kebab") menu. Echoes the
// landing-page HamburgerMenu — same top-right corner, same
// click-to-open / outside-click-to-close / Escape-to-close behaviour —
// but holds the secondary in-room controls that used to crowd the
// header, in this canonical order:
//   - SHARE / SHOW QR (always — the phrase row is now a tap-to-mask
//     label only, so sharing always lives here)
//   - SOUND FX toggle
//   - host-only KNOCK / LOCK moderation toggles
// REVOKE UNMASK PERMISSION moved into the MASKS sheet (task #597).
// Keeping these one tap away reclaims header width for the call itself.

interface InCallOverflowMenuProps {
  isHost: boolean;
  hostPresent: boolean;
  knockMode: boolean;
  roomLocked: boolean;
  handleToggleKnock: () => void;
  handleToggleLock: () => void;
  /** Share affordance (SHARE + SHOW QR + caption). Built by
   *  RoomHeaderBar so the fragment-leak caption stays in one place. */
  shareAffordance: ReactNode | null;
  btnStyle: CSSProperties;
  pausedStyle: CSSProperties | undefined;
}

export default function InCallOverflowMenu({
  isHost,
  hostPresent,
  knockMode,
  roomLocked,
  handleToggleKnock,
  handleToggleLock,
  shareAffordance,
  btnStyle,
  pausedStyle,
}: InCallOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // When the menu opens, move keyboard focus to its first control so a
  // keyboard / screen-reader user lands inside the menu instead of being
  // left on the trigger. Closing via Escape returns focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const FOCUSABLE =
      'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const first = menuRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        // Return focus to the trigger on keyboard dismissal.
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const moderationDisabled = !isHost && !hostPresent;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="incall-overflow-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="More controls"
        title="More controls"
        className={`void-btn${open ? " void-btn--gold active" : ""}`}
        onClick={() => {
          uiClick();
          setOpen((v) => !v);
        }}
        style={{ ...btnStyle, letterSpacing: "2px", fontWeight: 700 }}
      >
        ⋮
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          data-testid="incall-overflow-menu"
          className="incall-overflow-menu"
          role="menu"
          aria-label="More controls"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            // Always anchor to the right edge of the button (which sits at the
            // right edge of the header) and clamp the panel to the viewport so
            // it can never spill off the left edge on narrow/mobile screens.
            right: 0,
            left: "auto",
            minWidth: "min(200px, calc(100vw - 24px))",
            maxWidth: "calc(100vw - 24px)",
            background: "var(--bg)",
            border: "2px solid var(--gold)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
            padding: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            zIndex: 200,
          }}
        >
          {shareAffordance}

          <UiSoundsToggle role="menuitem" style={{ ...btnStyle, width: "100%" }} />

          <button
            type="button"
            role="menuitem"
            className={`void-btn${knockMode ? " void-btn--gold active" : ""}`}
            onClick={handleToggleKnock}
            disabled={moderationDisabled}
            aria-disabled={moderationDisabled}
            title={
              moderationDisabled
                ? "Knock is paused until the original host rejoins to restore moderation."
                : undefined
            }
            style={{ ...btnStyle, width: "100%", ...(pausedStyle ?? {}) }}
          >
            {knockMode ? "KNOCK ON" : "KNOCK"}
          </button>
          <button
            type="button"
            role="menuitem"
            className={`void-btn${roomLocked ? " void-btn--gold active" : ""}`}
            onClick={handleToggleLock}
            disabled={moderationDisabled}
            aria-disabled={moderationDisabled}
            title={
              moderationDisabled
                ? "Lock is paused until the original host rejoins to restore moderation."
                : undefined
            }
            style={{ ...btnStyle, width: "100%", ...(pausedStyle ?? {}) }}
          >
            {roomLocked ? "LOCKED" : "LOCK"}
          </button>
        </div>
      )}
    </div>
  );
}
