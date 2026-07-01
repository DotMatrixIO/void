// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import { sanitizeDrop, DROP_MAX_BYTES } from "@/lib/dropSanitize";

/**
 * DropSlot — Task #443 + #518.
 *
 * The shared DROP slot UI. A single plain-text value (≤2 KB UTF-8) that
 * every participant in the room sees and that any participant can
 * atomically overwrite for everyone. There is no chat history, no
 * per-peer view, no formatting, no auto-linkify. See
 * `docs/signaling-envelope-audit.md` Table 2 row 5 for the on-the-wire
 * shape and `ThreatModelPage.tsx` "THE SHARED DROP SLOT" for the
 * design rationale.
 *
 * Layout (task #518):
 *   - Defaults to a compact single-row bar showing the DROP label and
 *     the current value (truncated) plus an expand affordance. Tapping
 *     it expands to the full editor.
 *   - Expanded mode is the textarea + label + byte counter + hint.
 *   - Expand/collapse state is persisted to sessionStorage so it
 *     survives navigations within the session but resets between
 *     sessions.
 *   - Incoming changes pulse the border in both modes. They do NOT
 *     auto-open a collapsed slot — collapsed stays collapsed.
 *
 * Submit model:
 *   - Enter submits (atomic overwrite for everyone).
 *   - Shift+Enter inserts a newline.
 *   - Paste is read as text/plain only and submits atomically.
 *
 * Screen-share interlock:
 *   - While the local user is the active screen presenter, the input
 *     is replaced with a `[DISABLED DURING SCREEN SHARE]` placeholder.
 *
 * Accessibility:
 *   - The rendered slot has `role="status"` and `aria-live="polite"`.
 */
export interface DropSlotProps {
  value: string;
  onSubmit: (text: string) => void;
  screenShareActive: boolean;
}

const SESSION_STORAGE_KEY = "void_drop_slot_expanded";

function readInitialExpanded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistExpanded(expanded: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (expanded) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, "1");
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export function DropSlot({ value, onSubmit, screenShareActive }: DropSlotProps) {
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);
  const [expanded, setExpandedState] = useState<boolean>(readInitialExpanded);
  const lastValueRef = useRef<string>(value);

  const setExpanded = (next: boolean) => {
    setExpandedState(next);
    persistExpanded(next);
  };

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [value]);

  const submit = (raw: string) => {
    const { text, mutated } = sanitizeDrop(raw);
    setHint(mutated ? "(some invisible characters were removed)" : null);
    onSubmit(text);
    setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(draft);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    // Hard constraint: read text/plain ONLY.
    const text = e.clipboardData.getData("text/plain");
    if (text === "") return;
    e.preventDefault();
    submit(text);
  };

  const disabled = screenShareActive;
  const byteLen = new TextEncoder().encode(draft).length;
  const overBudget = byteLen > DROP_MAX_BYTES;

  const goldLabelStyle = {
    display: "inline-block",
    fontSize: "10px",
    letterSpacing: "2px",
    color: "var(--gold, #e8a200)",
    background: "var(--surface-dark)",
    border: "1px solid var(--gold, #e8a200)",
    padding: "3px 6px",
    flexShrink: 0,
  } as const;

  if (!expanded) {
    // Compact mode — single low-profile bar with the label and the
    // truncated current value. The whole bar is the expand affordance
    // (click / Enter / Space), so there is no separate EXPAND button.
    // Still pulses on incoming changes, still respects the screen-share
    // interlock (tapping to expand stays available so the user can read
    // the full incoming value, but the editor itself remains gated).
    return (
      <div
        data-testid="drop-slot"
        data-mode="compact"
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-controls="drop-slot-editor"
        aria-label="Expand the shared DROP slot editor"
        title="Tap to expand the shared DROP slot"
        onClick={() => setExpanded(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(true);
          }
        }}
        style={{
          border: pulse ? "2px solid var(--gold, #e8a200)" : "2px solid var(--teal, #2ec4b6)",
          transition: "border-color 200ms ease",
          padding: "4px 8px",
          marginTop: "6px",
          fontFamily: "var(--font-mono, monospace)",
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          minHeight: "28px",
          cursor: "pointer",
        }}
      >
        <style>{`@media (prefers-reduced-motion: reduce) {
          [data-testid="drop-slot"] { transition: none !important; }
        }`}</style>
        <span style={goldLabelStyle}>DROP</span>
        <span
          data-testid="drop-slot-value"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            color: "var(--text, #ddd)",
            fontSize: "12px",
          }}
        >
          {value === "" ? (
            <span style={{ opacity: 0.5 }}>(empty)</span>
          ) : (
            value
          )}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="drop-slot"
      data-mode="expanded"
      id="drop-slot-editor"
      style={{
        border: pulse ? "2px solid var(--gold, #e8a200)" : "2px solid var(--teal, #2ec4b6)",
        transition: "border-color 200ms ease",
        padding: "12px",
        marginTop: "12px",
        fontFamily: "var(--font-mono, monospace)",
        background: "rgba(0,0,0,0.4)",
      }}
    >
      <style>{`@media (prefers-reduced-motion: reduce) {
        [data-testid="drop-slot"] { transition: none !important; }
      }`}</style>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
          gap: "8px",
        }}
      >
        <div style={goldLabelStyle}>DROP — SHARED SLOT</div>
        <button
          type="button"
          data-testid="drop-slot-collapse"
          aria-expanded={true}
          aria-controls="drop-slot-editor"
          onClick={() => setExpanded(false)}
          style={{
            background: "transparent",
            color: "var(--gold, #e8a200)",
            border: "1px solid var(--gold, #e8a200)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase",
            padding: "2px 6px",
            cursor: "pointer",
          }}
        >
          COLLAPSE
        </button>
      </div>
      <div
        data-testid="drop-slot-value"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={{
          minHeight: "1.4em",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          color: "var(--text, #ddd)",
          fontSize: "13px",
          marginBottom: "10px",
        }}
      >
        {value === "" ? (
          <span style={{ opacity: 0.5 }}>(empty)</span>
        ) : (
          value
        )}
      </div>
      {disabled ? (
        <div
          data-testid="drop-slot-disabled"
          style={{
            color: "var(--gold, #e8a200)",
            background: "var(--surface-dark)",
            fontSize: "11px",
            letterSpacing: "1.5px",
            padding: "6px 8px",
            border: "1px dashed var(--gold, #e8a200)",
          }}
        >
          [DISABLED DURING SCREEN SHARE]
        </div>
      ) : (
        <>
          <label
            htmlFor="drop-slot-input"
            style={{
              display: "block",
              fontSize: "10px",
              letterSpacing: "1px",
              color: "var(--text-dim, #888)",
              marginBottom: "4px",
            }}
          >
            OVERWRITE — Enter sends, Shift+Enter newline, paste sends
          </label>
          <textarea
            id="drop-slot-input"
            data-testid="drop-slot-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={2}
            aria-label="Shared DROP slot — overwrites for everyone in the room"
            style={{
              width: "100%",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "16px",
              padding: "6px 8px",
              background: "rgba(0,0,0,0.4)",
              color: "var(--text, #ddd)",
              border: overBudget
                ? "1px solid #d9534f"
                : "1px solid var(--teal, #2ec4b6)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "var(--text-dim, #888)",
              marginTop: "4px",
            }}
          >
            <span data-testid="drop-slot-hint">{hint ?? ""}</span>
            <span data-testid="drop-slot-bytes">
              {byteLen} / {DROP_MAX_BYTES} bytes
            </span>
          </div>
        </>
      )}
    </div>
  );
}
