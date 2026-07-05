// SPDX-License-Identifier: AGPL-3.0-or-later
const GOLD = "#E8A200";
const TEAL = "#0D9D8B";
const BURNT = "#C85A00";
const FG = "#1E1A14";
const FG_DIM = "#352D20";
const BG = "#BEB3A2";
const DARK = "#14110D";
const PANEL_FG = "#BEB3A2";
const FONT_MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const FONT_DISPLAY = "'Staatliches', system-ui, sans-serif";

const sectionStyle: React.CSSProperties = {
  maxWidth: "680px",
  width: "100%",
  padding: "32px 28px",
  backgroundColor: DARK,
  color: PANEL_FG,
  fontFamily: FONT_MONO,
  fontSize: "13px",
  lineHeight: 1.8,
  letterSpacing: "0.5px",
};

const headingStyle: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 400,
  fontSize: "clamp(28px, 6vw, 42px)",
  letterSpacing: "4px",
  textTransform: "uppercase",
  color: GOLD,
  lineHeight: 1.1,
  marginBottom: "8px",
};

const subheadStyle: React.CSSProperties = {
  ...headingStyle,
  color: TEAL,
  fontSize: "clamp(20px, 4.5vw, 28px)",
  marginBottom: "24px",
};

const introStyle: React.CSSProperties = {
  margin: "0 0 28px",
  color: PANEL_FG,
};

const bulletListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 28px",
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

const bulletStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "14px",
  alignItems: "start",
};

const markerStyle: React.CSSProperties = {
  color: GOLD,
  fontFamily: FONT_MONO,
  fontSize: "13px",
  fontWeight: 700,
  letterSpacing: "1px",
  lineHeight: 1.8,
  whiteSpace: "nowrap",
};

const bulletBodyStyle: React.CSSProperties = {
  color: PANEL_FG,
  lineHeight: 1.7,
};

const claimStyle: React.CSSProperties = {
  display: "block",
  color: GOLD,
  fontFamily: FONT_MONO,
  fontWeight: 700,
  fontSize: "13px",
  letterSpacing: "2px",
  textTransform: "uppercase",
  marginBottom: "4px",
};

const readMoreStyle: React.CSSProperties = {
  display: "inline-block",
  fontFamily: FONT_MONO,
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: GOLD,
  textDecoration: "none",
  border: `2px solid ${GOLD}`,
  padding: "12px 18px",
  backgroundColor: "rgba(232,162,0,0.04)",
  marginTop: "8px",
};

const v05Style: React.CSSProperties = {
  marginBottom: "20px",
  color: BURNT,
  letterSpacing: "1px",
  fontSize: "12px",
};

type Bullet = {
  marker: string;
  claim: string;
  body: React.ReactNode;
};

const bullets: Bullet[] = [
  {
    marker: "01",
    claim: "Stateless by architecture",
    body: (
      <>
        No accounts. No recording. No transcript. When the room closes the
        relay forgets — there is no archive to subpoena.
      </>
    ),
  },
  {
    marker: "02",
    claim: "End-to-end encrypted, peer-to-peer",
    body: (
      <>
        Video and audio travel directly between peers over WebRTC. The server
        relays signaling only. It never sees your keys, your media, or your
        decrypted content.
      </>
    ),
  },
  {
    marker: "03",
    claim: "Six words. 66 bits. Never sent to us.",
    body: (
      <>
        Rooms are keyed by a six-word{" "}
        <span style={{ color: TEAL }}>BIP-39</span> phrase carried in the URL
        fragment — the part after <span style={{ color: TEAL }}>#</span> that
        the browser never transmits. Argon2id hardens it against guessing.
      </>
    ),
  },
  {
    marker: "04",
    claim: "Perfect Forward Secrecy",
    body: (
      <>
        Fresh ephemeral keys per session, destroyed when the room ends.
        Ciphertext captured today cannot be decrypted tomorrow, even if the
        phrase leaks a year later.
      </>
    ),
  },
  {
    marker: "05",
    claim: "Biometric scrubbing runs on your device",
    body: (
      <>
        Video filters (GOLD, PIXEL, CONTOUR, SILHOUETTE, ASCII) and voice
        masks (DEEP, FORMANT) process locally — in a WebGL shader and an
        audio worklet — before a single frame or sample leaves your machine.
      </>
    ),
  },
];

export default function Bulleted() {
  return (
    <div
      style={{
        minHeight: "100svh",
        background: BG,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 16px 60px",
        fontFamily: FONT_MONO,
        color: FG,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "680px",
          padding: "0 0 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            background: DARK,
            color: GOLD,
            display: "grid",
            placeItems: "center",
            fontFamily: FONT_DISPLAY,
            letterSpacing: "2px",
            fontSize: 14,
          }}
        >
          V
        </div>
        <div
          style={{
            fontSize: "12px",
            letterSpacing: "2px",
            color: FG_DIM,
            textTransform: "uppercase",
          }}
        >
          ← BACK
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={headingStyle}>WE DIDN'T MAKE A PROMISE.</div>
        <div style={subheadStyle}>WE MADE A PROOF.</div>

        <p style={v05Style}>
          OPEN BETA · v0.5 — early and unfinished. Bugs will be fixed in the
          open.
        </p>

        <p style={introStyle}>
          VOID is a stateless, encrypted, peer-to-peer video room. Five
          things are true of it by architecture, not by promise:
        </p>

        <ul style={bulletListStyle}>
          {bullets.map((b) => (
            <li key={b.marker} style={bulletStyle}>
              <span style={markerStyle}>{b.marker}</span>
              <div style={bulletBodyStyle}>
                <span style={claimStyle}>{b.claim}</span>
                {b.body}
              </div>
            </li>
          ))}
        </ul>

        <a href="#" style={readMoreStyle}>
          READ THE LONG VERSION →
        </a>

        <p
          style={{
            marginTop: "16px",
            color: FG_DIM,
            fontSize: "12px",
            letterSpacing: "1px",
          }}
        >
          Philosophy · VOID Phrase · Encryption · Video Filters · Voice
          Masks · Threat Model
        </p>
      </div>
    </div>
  );
}
