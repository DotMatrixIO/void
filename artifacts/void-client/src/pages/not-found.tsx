// SPDX-License-Identifier: AGPL-3.0-or-later
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        flexDirection: "column",
        gap: "24px",
        padding: "20px",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div
        style={{
          fontFamily: "system-ui, sans-serif",
          fontWeight: 900,
          fontSize: "80px",
          color: "var(--red)",
          letterSpacing: "-2px",
          lineHeight: 1,
        }}
      >
        404
      </div>
      <div
        style={{
          fontSize: "13px",
          color: "var(--fg-dim)",
          letterSpacing: "4px",
          textTransform: "uppercase",
        }}
      >
        NOT FOUND
      </div>
      <button
        onClick={() => setLocation("/")}
        className="void-btn void-btn--red active"
        style={{ fontSize: "13px", padding: "14px 32px", letterSpacing: "2px", background: "var(--red)", color: "var(--fg)" }}
      >
        HOME
      </button>
    </div>
  );
}
