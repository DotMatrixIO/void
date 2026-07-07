// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { Link } from "wouter";
import HamburgerMenu from "@/components/HamburgerMenu";
import PageFooter from "@/components/PageFooter";

// "What the server sees" proof page. Hits GET /api/room-state/:code and
// renders the literal JSON. No localStorage, loud-fail on every error.

const BASE_URL = import.meta.env.BASE_URL ?? "/";
function apiUrl(path: string) {
  return BASE_URL.replace(/\/$/, "") + path;
}

const ROOM_CODE_RE = /^[0-9a-f]{32}$/;

const sectionStyle: React.CSSProperties = {
  maxWidth: "680px",
  width: "100%",
  padding: "28px 24px",
  backgroundColor: "var(--surface-dark)",
  backgroundImage:
    "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
  backgroundSize: "auto, 400px auto",
  backgroundRepeat: "repeat",
  color: "var(--fg-on-dark)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: "1.9",
  letterSpacing: "0.5px",
};

const headingStyle: React.CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontWeight: 400,
  fontSize: "clamp(28px, 6vw, 36px)",
  letterSpacing: "4px",
  textTransform: "uppercase",
  color: "var(--gold)",
  lineHeight: 1.1,
  marginBottom: "20px",
};

const subheadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  marginBottom: "16px",
  marginTop: "28px",
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: "var(--bg)",
  border: "2px solid var(--gold)",
  color: "var(--fg)",
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: "16px",
  letterSpacing: "1.5px",
  textTransform: "lowercase",
  outline: "none",
};

const buttonStyle: React.CSSProperties = {
  background: "var(--gold)",
  /* Task #1114: was var(--bg) on the gold button (1.35:1, unreadable).
     --fg on --gold is the audited 7.91:1 pairing. */
  color: "var(--fg)",
  border: "2px solid var(--gold)",
  padding: "10px 16px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "2px",
  textTransform: "uppercase",
  cursor: "pointer",
};

const jsonBoxStyle: React.CSSProperties = {
  background: "#0A0908",
  border: "2px solid var(--teal)",
  color: "var(--teal)",
  padding: "16px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: 1.6,
  letterSpacing: "0.5px",
  whiteSpace: "pre",
  overflowX: "auto",
  marginTop: "16px",
};

const errorBoxStyle: React.CSSProperties = {
  background: "#0A0908",
  border: "2px solid var(--red)",
  color: "var(--red)",
  padding: "16px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: 1.6,
  letterSpacing: "1px",
  marginTop: "16px",
  textTransform: "uppercase",
};

export default function ServerStateProofPage() {
  const [code, setCode] = useState("");
  const [snapshot, setSnapshot] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSnapshot(null);
    setError(null);

    // Trim only — never lowercase. The user's typed code must reach
    // the server unchanged or the proof is a lie.
    const trimmed = code.trim();
    if (!ROOM_CODE_RE.test(trimmed)) {
      setError("INVALID CODE — must be 32 lowercase hex characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/room-state/${trimmed}`));
      if (!res.ok) {
        setError(`SERVER RETURNED ${res.status} — proof unavailable.`);
        return;
      }
      const body = await res.json();
      setSnapshot(body);
    } catch (err) {
      setError(
        `FETCH FAILED — ${err instanceof Error ? err.message : "unknown error"}.`,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100svh",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 16px 60px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
      }}
    >
      <HamburgerMenu />
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          padding: "20px 0",
          paddingRight: "52px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", lineHeight: 0 }}>
          <img
            src="/void-icon.png"
            alt="VOID"
            style={{ width: "36px", height: "36px", imageRendering: "pixelated" }}
          />
        </Link>
        <Link
          href="/threat-model"
          style={{
            fontSize: "12px",
            letterSpacing: "2px",
            color: "var(--fg-dim)",
            textDecoration: "none",
            textTransform: "uppercase",
          }}
        >
          ← THREAT MODEL
        </Link>
      </div>

      <div style={sectionStyle}>
        <div style={headingStyle}>WHAT THE SERVER SEES</div>
        <div
          style={{
            ...headingStyle,
            color: "var(--teal)",
            fontSize: "clamp(14px, 3vw, 18px)",
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            marginBottom: "28px",
            letterSpacing: "1px",
          }}
        >
          Type a room code. Read the server’s literal answer.
        </div>

        <p>
          This page hits the same endpoint anyone with curl can hit:{" "}
          <code style={{ color: "var(--gold)" }}>GET /api/room-state/&lt;code&gt;</code>.
          What you see below is the entire object the server holds for that
          code — there is no second view, no admin panel, no shadow record.
          If you don’t see it here, it isn’t there.
        </p>
        <p>
          Empty <code style={{ color: "var(--gold)" }}>{"{}"}</code> means the
          server has nothing under that code: never created, expired, or
          burned. The server cannot tell those apart, and neither can this
          page. That collapse is the property.
        </p>

        <div style={subheadingStyle}>QUERY</div>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}
        >
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="32-char hex room code"
            data-testid="server-state-input"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            style={inputStyle}
          />
          <button
            type="submit"
            data-testid="server-state-submit"
            disabled={loading}
            style={{ ...buttonStyle, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "READING..." : "READ"}
          </button>
        </form>

        {error && (
          <div data-testid="server-state-error" style={errorBoxStyle}>
            {error}
          </div>
        )}

        {snapshot !== null && !error && (
          <div data-testid="server-state-json" style={jsonBoxStyle}>
            {JSON.stringify(snapshot, null, 2)}
          </div>
        )}

        <div style={subheadingStyle}>WHAT THESE FIELDS MEAN</div>
        <p>
          <code style={{ color: "var(--gold)" }}>exists</code> — whether a
          live room maps to the code right now.
          <br />
          <code style={{ color: "var(--gold)" }}>tier</code> —{" "}
          <code style={{ color: "var(--gold)" }}>free</code>,{" "}
          <code style={{ color: "var(--gold)" }}>paid_24h</code>, or{" "}
          <code style={{ color: "var(--gold)" }}>paid_7d</code>, the paywall
          tier the room was opened on.
          <br />
          <code style={{ color: "var(--gold)" }}>expiresAt</code> — the
          wall-clock millisecond at which the room burns down on its own.
          <br />
          <code style={{ color: "var(--gold)" }}>participantCount</code> —
          a number, not a list. No peer IDs, no IPs, no nicknames, no
          handles. There is nothing else to show.
        </p>
      </div>

      <PageFooter />
    </div>
  );
}
