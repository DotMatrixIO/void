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

const lossClaimStyle: React.CSSProperties = {
  ...claimStyle,
  color: BURNT,
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

type Bullet = {
  marker: string;
  claim: string;
  claimStyle?: React.CSSProperties;
  body: React.ReactNode;
};

// COMPARE — hybrid voice. Adversarial-but-honest. Five rows we win,
// three rows we lose. The bullets carry the score; the long page
// carries the eight-by-six table and the per-row prose.
const bullets: Bullet[] = [
  {
    marker: "01",
    claim: "Eight rows. Six tools. We win five. We lose three.",
    body: (
      <>
        That is the whole headline. The table on the long version is the
        receipts. The five we win are philosophy. The three we lose are
        limits. We are not going to soften either set.
      </>
    ),
  },
  {
    marker: "02",
    claim: "No account, ever. Self-hostable. Ephemeral by default.",
    body: (
      <>
        An account is a handle the platform uses to remember you. We did
        not want to remember you, so we did not build the thing that
        would. The whole stack runs on your own hardware if you want it
        to. Rooms live in memory and die on a timer. None of this
        happened by accident.
      </>
    ),
  },
  {
    marker: "03",
    claim: "Biometric masking on by default. Lightning to pay.",
    body: (
      <>
        The shader runs on your GPU before a single frame leaves your
        device. The host pays a small invoice over the{" "}
        <span style={{ color: TEAL }}>Lightning Network</span>; joiners
        pay nothing. No credit card. No KYC. A small amount of friction
        that stops automated abuse without capturing anything about who
        caused it.
      </>
    ),
  },
  {
    marker: "04",
    claim: "Four people, hard cap. If you need fifty, use Jitsi.",
    claimStyle: lossClaimStyle,
    body: (
      <>
        VOID uses full mesh WebRTC. Every participant maintains a direct
        connection to every other participant. The mesh holds at four.
        At five it starts to fray. Adding a media relay would fix this.
        It would also break the privacy model. We stop the room at four
        and tell you to use a different tool.
      </>
    ),
  },
  {
    marker: "05",
    claim: "No native mobile apps. No recording. No transcript.",
    claimStyle: lossClaimStyle,
    body: (
      <>
        VOID is a browser PWA. We would rather ship a thing we can audit
        end-to-end than native apps that depend on review pipelines we
        do not control. There is no record button on our end and there
        will not be one. If you need a recorded meeting, this is the
        wrong tool, by design.
      </>
    ),
  },
  {
    marker: "06",
    claim: "Most privacy tools ask you to trust them. We are trying to make trust irrelevant.",
    body: (
      <>
        Not because we are untrustworthy — we believe we are reasonably
        trustworthy, as far as that goes. But a system that structurally
        cannot retain your data is more valuable than a system that
        promises not to. We didn't make a promise. We made a proof. We
        thought you should know.
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
        <div style={headingStyle}>WHY NOT ZOOM?</div>
        <div style={subheadStyle}>FAIR QUESTION.</div>

        <p style={introStyle}>
          There are several perfectly good video tools in the world. VOID
          is one of them on five rows, and not on three. Here is the
          honest score before you read the table.
        </p>

        <ul style={bulletListStyle}>
          {bullets.map((b) => (
            <li key={b.marker} style={bulletStyle}>
              <span style={markerStyle}>{b.marker}</span>
              <div style={bulletBodyStyle}>
                <span style={b.claimStyle ?? claimStyle}>{b.claim}</span>
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
          The Table · Five Rows We Win · Three Rows We Lose · When VOID
          Is the Wrong Tool · One Last Thing
        </p>
      </div>
    </div>
  );
}
