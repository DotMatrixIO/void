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

const priceCardWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "10px",
  marginBottom: "24px",
};

const priceCard = (accent: string): React.CSSProperties => ({
  border: `3px solid ${accent}`,
  padding: "14px 18px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: "8px",
});

type Bullet = {
  marker: string;
  claim: string;
  body: React.ReactNode;
};

// PRICING — hybrid voice. The risk is sounding flippant about money;
// the antidote is naming exactly what is and is not bought. The price
// cards stay on the short page because price IS the headline. Long
// page carries the why-this-price prose fragment and the self-hosting
// section.
const bullets: Bullet[] = [
  {
    marker: "01",
    claim: "Two tiers, because rooms come in two lengths.",
    body: (
      <>
        That is the entire difference between them. Same architecture,
        same phrase, same end-to-end encryption, same four-peer cap. The
        longer room costs more because it lives longer. It is not a
        feature tier. It is arithmetic.
      </>
    ),
  },
  {
    marker: "02",
    claim: "One-shot, over Lightning. No account. No KYC.",
    body: (
      <>
        You pay over the{" "}
        <span style={{ color: TEAL }}>Lightning Network</span>. No name,
        no email, no credit card, no billing identity of any kind. The
        sats move, a room token is issued, and the connection between
        the payer and the room is mathematical rather than bureaucratic.
      </>
    ),
  },
  {
    marker: "03",
    claim: "No subscription. No auto-renew. No \"we've updated our pricing\" email.",
    body: (
      <>
        When the room expires, it is gone. If you want another one, you
        make another one. That is the whole loop. There is no annual
        plan, no enterprise tier, no "contact sales." There is a room,
        and a small amount of Bitcoin, and that is the entire
        relationship.
      </>
    ),
  },
  {
    marker: "04",
    claim: "A small cost is not a barrier. It is a signal.",
    body: (
      <>
        A thousand satoshis is roughly a dollar. Small enough that we
        debated whether to round it to zero. We did not, because the
        friction is the point. It is the difference between a room that
        exists because someone wanted it to exist, and a room that
        exists because clicking "new room" cost nothing.
      </>
    ),
  },
  {
    marker: "05",
    claim: "24 hours is the ceiling. The phrase is the boundary.",
    body: (
      <>
        A leaked phrase for a 65-minute room is exploitable for at most
        65 minutes. A leaked phrase for a 24-hour room is exploitable
        for up to a day. The wider the window, the more an ephemeral
        tool stops being one. A day is the longest lifetime that still
        feels like a single working stretch.
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
        <div style={headingStyle}>PRICING</div>
        <div style={subheadStyle}>TWO LENGTHS. ONE PRICE EACH.</div>

        <div style={priceCardWrap}>
          <div style={priceCard(GOLD)}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: "clamp(20px, 5vw, 28px)",
                  letterSpacing: "3px",
                  color: GOLD,
                  lineHeight: 1,
                }}
              >
                1,000 SATS
              </div>
              <div style={{ fontSize: "12px", letterSpacing: "2px", color: "#9C8E7A" }}>
                ≈ $1
              </div>
            </div>
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: PANEL_FG,
                textTransform: "uppercase",
              }}
            >
              STANDARD · 65 MIN
            </div>
          </div>
          <div style={priceCard(TEAL)}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: "clamp(20px, 5vw, 28px)",
                  letterSpacing: "3px",
                  color: TEAL,
                  lineHeight: 1,
                }}
              >
                5,000 SATS
              </div>
              <div style={{ fontSize: "12px", letterSpacing: "2px", color: "#9C8E7A" }}>
                ≈ $5
              </div>
            </div>
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: PANEL_FG,
                textTransform: "uppercase",
              }}
            >
              24-HOUR
            </div>
          </div>
        </div>

        <p style={introStyle}>
          USD figures are approximate and move with the price of
          Bitcoin. Same room. Same encryption. Same four-peer cap. The
          longer one lives longer. That is the entire difference.
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

        <p
          style={{
            marginBottom: "24px",
            color: "#9C8E7A",
            fontStyle: "italic",
          }}
        >
          A man named Gerald once paid $47.99 per month for a video
          conferencing subscription he used twice. The subscription
          renewed automatically for nineteen months. Gerald is fine.
          Gerald does not think about it anymore.
        </p>
        <p style={{ marginBottom: "28px", color: GOLD }}>
          Gerald is not our customer.
        </p>

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
          Two Lengths · Why This Price · Why 24 Hours Is the Ceiling ·
          How It Works · What the Longer Tier Is Not · Self-Hosting ·{" "}
          <span style={{ color: BURNT }}>The Full Price</span>
        </p>
      </div>
    </div>
  );
}
