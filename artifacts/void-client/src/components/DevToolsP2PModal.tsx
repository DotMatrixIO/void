// SPDX-License-Identifier: AGPL-3.0-or-later
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";

// Modal explaining how a user can verify in their own browser that media
// flows directly between peers, not through any VOID server. Opened from
// the DIRECT P2P badge in the in-room header. Plain prose only — no
// screenshots in v1, that's deferred per the task's out-of-scope notes.
//
// State (open/closed) lives in the parent so the badge controls visibility.
// Closes on Escape, on backdrop click, and on the explicit close button.
// No persistence — the modal does not remember it was opened before.

interface Props {
  open: boolean;
  onClose: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: "16px",
};

const panelStyle: React.CSSProperties = {
  background: "var(--bg)",
  border: "3px solid var(--teal)",
  maxWidth: "520px",
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
  fontSize: "22px",
  letterSpacing: "3px",
  /* Task #1114: was var(--teal) on the var(--bg) panel (2.08:1, hard to
     read). --fg passes AA; the 3px teal panel border keeps the accent. */
  color: "var(--fg)",
  textTransform: "uppercase",
  margin: 0,
};

const stepStyle: React.CSSProperties = {
  fontSize: "12px",
  lineHeight: 1.7,
  color: "var(--fg-dim)",
  letterSpacing: "0.5px",
};

const stepNumStyle: React.CSSProperties = {
  display: "inline-block",
  minWidth: "24px",
  /* Task #1114: was var(--teal) on var(--bg) (2.08:1). --fg passes AA. */
  color: "var(--fg)",
  fontWeight: 700,
  letterSpacing: "1px",
};

export default function DevToolsP2PModal({ open, onClose }: Props) {
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    active: open,
  });

  if (!open) return null;

  return (
    <div
      style={overlayStyle}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-testid="devtools-p2p-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="devtools-p2p-heading"
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="devtools-p2p-heading" style={headingStyle}>
          PROVE IT YOURSELF
        </h2>
        <p style={{ ...stepStyle, color: "var(--fg)" }}>
          The badge says DIRECT P2P. Don’t trust the badge. Confirm it.
        </p>
        <ol
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <li style={stepStyle}>
            <span style={stepNumStyle}>1.</span>
            Open your browser’s developer tools.
            {" "}<span style={{ color: "var(--burnt)" }}>F12</span> on most
            desktop browsers, or right-click the page and pick INSPECT.
          </li>
          <li style={stepStyle}>
            <span style={stepNumStyle}>2.</span>
            In Chrome or Edge, open a new tab and visit{" "}
            <span style={{ color: "var(--gold)", background: "var(--surface-dark)", padding: "1px 6px" }}>chrome://webrtc-internals</span>.
            In Firefox, visit{" "}
            <span style={{ color: "var(--gold)", background: "var(--surface-dark)", padding: "1px 6px" }}>about:webrtc</span>.
            Safari does not expose WebRTC internals to users.
          </li>
          <li style={stepStyle}>
            <span style={stepNumStyle}>3.</span>
            Find the active connection. Look at the selected ICE candidate
            pair. The <span style={{ color: "var(--teal)" }}>remote</span>{" "}
            address is your peer’s IP, not a VOID server. If you see{" "}
            <span style={{ color: "var(--burnt)" }}>typ relay</span>, you
            went through TURN — the room is in relay-only mode and this
            badge would not be showing.
          </li>
        </ol>
        <p
          style={{
            ...stepStyle,
            /* contrast-exception: sits on the modal's var(--bg) panel
               (--fg-dim = 6.56:1); the scanner pairs it with the sibling
               burnt/teal chips inside the list above. */
            color: "var(--fg-dim)",
            fontStyle: "italic",
            borderTop: "1px solid var(--fg-dim)",
            paddingTop: "12px",
            marginBottom: 0,
          }}
        >
          The badge only renders when at least one peer is connected and
          relay-only is off. We don’t claim a fact about a connection that
          doesn’t exist.
        </p>
        <button
          type="button"
          className="void-btn"
          onClick={onClose}
          data-testid="devtools-p2p-modal-close"
          style={{
            alignSelf: "flex-end",
            fontSize: "12px",
            padding: "8px 16px",
            letterSpacing: "1.5px",
          }}
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}
