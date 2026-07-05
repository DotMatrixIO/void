// SPDX-License-Identifier: AGPL-3.0-or-later
// Single dead-room screen for INVALID CODE, ROOM NOT FOUND,
// ROOM EXPIRED, ROOM DESTROYED. The collapse is intentional — never-
// existed must look identical to burned.

import { useDialogFocusTrap } from "../lib/useDialogFocusTrap";

interface Props {
  onBack: () => void;
}

export const DEAD_ROOM_COPY =
  "Room destroyed — this URL is gone. If you refresh, it should stay gone.";

export const DEAD_ROOM_ERROR_STRINGS = [
  "ROOM EXPIRED",
  "INVALID CODE",
  "ROOM NOT FOUND",
  "ROOM DESTROYED",
] as const;

export type DeadRoomErrorString = (typeof DEAD_ROOM_ERROR_STRINGS)[number];

export function isDeadRoomError(error: string | null): error is DeadRoomErrorString {
  return error !== null && (DEAD_ROOM_ERROR_STRINGS as readonly string[]).includes(error);
}

export default function DeadRoomOverlay({ onBack }: Props) {
  // alertdialog (rather than dialog) because this overlay announces a
  // failure state — the room is irrecoverably gone — and the only
  // affordance is acknowledging it via "BACK TO MENU". Escape is wired
  // to the same action so keyboard users can dismiss without tabbing.
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onEscape: onBack });

  return (
    <div className="void-overlay">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dead-room-dialog-title"
        data-testid="dead-room-overlay"
        style={{
          textAlign: "center",
          background: "var(--surface)",
          padding: "32px 28px",
          border: "3px solid var(--red)",
          maxWidth: "360px",
          width: "100%",
        }}
      >
        <div
          id="dead-room-dialog-title"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "16px",
            color: "var(--fg)",
            marginBottom: "24px",
            letterSpacing: "0.5px",
            lineHeight: 1.6,
            textTransform: "none",
          }}
        >
          {DEAD_ROOM_COPY}
        </div>
        <button
          className="void-btn void-btn--red active"
          onClick={onBack}
          style={{ width: "100%", fontSize: "16px", padding: "14px" }}
        >
          BACK TO MENU
        </button>
      </div>
    </div>
  );
}
