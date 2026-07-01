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

type Bullet = { marker: string; claim: string; body: React.ReactNode };

const bullets: Bullet[] = [
  {
    marker: "01",
    claim: "There is no record",
    body: (
      <>
        No accounts. No recording. No transcript. When the room ends, the
        server forgets. There is nothing to subpoena because there is
        nothing there. So it goes.
      </>
    ),
  },
  {
    marker: "02",
    claim: "The server is on purpose ignorant",
    body: (
      <>
        Your video and your voice travel directly from your machine to the
        other person's machine. The server in the middle relays the
        handshake and then politely looks away. It never holds your keys.
        It never sees what you said.
      </>
    ),
  },
  {
    marker: "03",
    claim: "Six words. That is the whole key.",
    body: (
      <>
        A room is opened by six ordinary words, drawn from a list called{" "}
        <span style={{ color: TEAL }}>BIP-39</span>. The words live after
        the <span style={{ color: TEAL }}>#</span> in the address bar,
        which is the part of a web address the browser is not allowed to
        send to anyone. So we don't get them. Nobody on the wire gets them.
        You say them out loud to the person you want in the room. This is
        how doors used to work.
      </>
    ),
  },
  {
    marker: "04",
    claim: "The past is sealed against the future",
    body: (
      <>
        Each call invents new keys and destroys them on the way out. A
        recording of today's encrypted call cannot be opened tomorrow, or
        the year after, or ever. Cryptographers call this Perfect Forward
        Secrecy. It means what is done is done.
      </>
    ),
  },
  {
    marker: "05",
    claim: "Your face is rearranged before it leaves",
    body: (
      <>
        Video and voice are filtered on your own machine, on your own
        graphics card, before a single frame or sample reaches the
        network. You can be made of gold, or pixels, or punctuation. You
        can sound like someone at the bottom of a well. You can also look
        and sound like yourself. It is up to you. We are not in the
        judging business.
      </>
    ),
  },
];

export default function Vonnegut() {
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
          OPEN BETA · v0.5 — early and unfinished. We will fix it in the
          open, because that is the only honest place to fix things.
        </p>

        <p style={introStyle}>
          VOID is a small video room with no memory. Here are five true
          things about it, none of which are promises. Promises can be
          broken by people in suits. These cannot, because they are not
          promises. They are how the thing is built.
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
