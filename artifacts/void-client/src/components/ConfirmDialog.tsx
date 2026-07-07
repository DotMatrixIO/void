// SPDX-License-Identifier: AGPL-3.0-or-later
import { useId } from "react";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";

// Reusable confirmation dialog (Task #572). Modeled on
// DevToolsP2PModal's overlay + focus-trap pattern. Escape is treated
// as Cancel; backdrop click is also Cancel. Body copy is wired to
// `aria-describedby` so the prompt is announced to screen readers.
//
// Used today only by the ALLOW UNMASKED VIDEO / VOICE preference
// toggles, but kept generic so future privacy-sensitive opt-ins can
// reuse it.

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional dataset hook for tests / styling. */
  testId?: string;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10000,
  padding: "16px",
};

const panelStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "3px solid var(--gold)",
  maxWidth: "420px",
  width: "100%",
  padding: "24px",
  fontFamily: "var(--font-mono)",
  color: "var(--fg)",
  display: "flex",
  flexDirection: "column",
  gap: "16px",
  boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
};

const headingStyle: React.CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontSize: "20px",
  letterSpacing: "3px",
  /* Task #1114: was var(--gold) on the var(--bg) panel (1.35:1, unreadable).
     --fg passes AA; the 3px gold panel border keeps the brand accent. */
  color: "var(--fg)",
  textTransform: "uppercase",
  margin: 0,
};

const bodyStyle: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: 1.6,
  color: "var(--fg)",
  letterSpacing: "0.5px",
  margin: 0,
};

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  testId,
}: Props) {
  const headingId = useId();
  const bodyId = useId();
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({
    onEscape: onCancel,
    active: open,
  });

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={onCancel}>
      <div
        ref={dialogRef}
        data-testid={testId ?? "confirm-dialog"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={bodyId}
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={headingId} style={headingStyle}>
          {title}
        </h2>
        <p id={bodyId} style={bodyStyle}>
          {body}
        </p>
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
            data-testid="confirm-dialog-cancel"
            onClick={onCancel}
            style={{
              fontSize: "16px",
              padding: "10px 18px",
              letterSpacing: "2px",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="void-btn void-btn--gold active"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            style={{
              fontSize: "16px",
              padding: "10px 18px",
              letterSpacing: "2px",
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
