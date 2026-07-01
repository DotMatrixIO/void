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

// Task #550 mockup. Mirrors the hybrid voice of why-bullets/Hybrid
// (uppercase mono CLAIM in gold over 1–3 sentences of Vonnegut-cadence
// prose) but for the THREAT MODEL page. THREAT MODEL has clinical
// source material (formal enumeration of attacker positions), so the
// risk this mockup is meant to surface is the hybrid reading
// clinical-and-cold rather than clinical-and-correct. Show this to a
// reviewer cold; ask one question — clinical-and-correct ships,
// clinical-and-cold means fall back to straight voice for this page
// only.

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
  fontSize: "clamp(16px, 3.4vw, 22px)",
  marginBottom: "24px",
};

const introStyle: React.CSSProperties = { margin: "0 0 28px", color: PANEL_FG };

const bulletListStyle: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "0 0 28px",
  display: "flex",
  flexDirection: "column",
  gap: "22px",
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

const bulletBodyStyle: React.CSSProperties = { color: PANEL_FG, lineHeight: 1.7 };

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

type Bullet = { marker: string; claim: string; body: React.ReactNode };

const bullets: Bullet[] = [
  {
    marker: "01",
    claim: "A lock is a lock. Not a force field.",
    body: (
      <>
        A man named Howard once bought the best lock his money could buy.
        His neighbor came through the window. A threat model is the thing
        nobody bothers to write, which is why most software promises what
        it cannot deliver. We are going to tell you, in plain language,
        exactly where this lock stops.
      </>
    ),
  },
  {
    marker: "02",
    claim: "What the server never learns",
    body: (
      <>
        Room codes the server sees are a{" "}
        <span style={{ color: TEAL }}>32-character lowercase hex</span>{" "}
        derivative of the VOID Phrase — never the phrase itself. The
        encryption keys live on the two devices in the call. Your video
        and voice ride a peer-to-peer channel the server is not party
        to. There is nothing for a subpoena to hand over because there
        is nothing there.
      </>
    ),
  },
  {
    marker: "03",
    claim: "What it will not protect you from",
    body: (
      <>
        A compromised device. A hostile participant who is already in
        the room. A second camera pointed at the screen. A screen
        recorder the OS hands out for free. These are operational
        problems with operational answers; no encryption fixes any of
        them, and we will not pretend otherwise.
      </>
    ),
  },
  {
    marker: "04",
    claim: "Tor protects the signaling. Not the media.",
    body: (
      <>
        Reaching VOID over an <span style={{ color: TEAL }}>.onion</span>{" "}
        address hides who you are from the relay. WebRTC still gathers
        connection candidates on your underlying network, so peers can
        learn your clearnet IP unless relay-only is enabled. We default
        the toggle on for onion visitors and tell you when we cannot
        promise more.
      </>
    ),
  },
  {
    marker: "05",
    claim: "Browser-level surfaces are the price of a browser",
    body: (
      <>
        DNS resolvers see the domain. Browser sync sees the URL.
        Extensions with all-sites permission see the room page.
        Enterprise-managed browsers log camera and mic grants. None of
        these are VOID bugs — they are six surfaces that ship with any
        modern browser. The long version names each one and what you
        can do about it.
      </>
    ),
  },
  {
    marker: "06",
    claim: "What v0.5 won't fix yet — named, not buried",
    body: (
      <>
        Persistent rooms widen the window. Lightning payments stay
        observable on the Lightning network. Screen recording by
        participants stays unsolvable in a browser. We are shipping{" "}
        <span style={{ color: TEAL }}>OPEN BETA · v0.5</span> early and
        honest; the won't-fix list is on the long page in full so nobody
        is surprised later.
      </>
    ),
  },
];

export default function Hybrid() {
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
        <div style={headingStyle}>THE VOID THREAT MODEL</div>
        <div style={subheadStyle}>
          WHAT WE PROTECT YOU FROM. AND WHAT WE DON'T.
        </div>

        <p style={v05Style}>
          OPEN BETA · v0.5 — early and honest, not finished and polished.
          The won't-fix bullet below names the limits we have decided to
          live with in this release.
        </p>

        <p style={introStyle}>
          VOID is a small video room with no memory. Here are six true
          things about its security — what it does, and what it doesn't.
          None of them are promises. Promises can be broken by people in
          suits. These cannot. They are how the thing is built, and
          where the thing stops.
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
          Howard · Server-blind · Won't-protect · Tor & media · Browser
          surfaces · Won't-fix in v0.5 · Supply chain
        </p>
      </div>
    </div>
  );
}
