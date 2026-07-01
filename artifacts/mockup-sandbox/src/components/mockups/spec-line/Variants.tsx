// SPDX-License-Identifier: AGPL-3.0-or-later
const DARK = "#14110D";
const CONCRETE = "#BEB3A2";
const FG = "#1E1A14";
const FG_DIM = "#352D20";
const BURNT_BAND = "#B85000";
const MONO = "'JetBrains Mono', 'Courier New', monospace";

const COPY = "stateless P2P · no accounts · E2E encrypted · ephemeral keys · AGPLv3";

const concreteBg: React.CSSProperties = {
  backgroundColor: CONCRETE,
  backgroundImage:
    "linear-gradient(rgba(190,179,162,0.82), rgba(190,179,162,0.82)), url(/__mockup/images/concrete.jpeg)",
  backgroundSize: "cover",
  backgroundPosition: "center",
};

function DarkBandTop() {
  // bottom slice of the dark-asphalt demo band above the seam
  return (
    <div
      style={{
        height: 64,
        backgroundColor: DARK,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 12,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: "rgba(255,255,255,0.30)",
          textTransform: "uppercase",
        }}
      >
        ↑ dark demo band
      </span>
    </div>
  );
}

function ConcreteBelow() {
  // top slice of the light-concrete refusal section below the seam
  return (
    <div style={{ ...concreteBg, height: 96, padding: "18px 24px 0" }}>
      <div
        style={{
          fontFamily: "'Staatliches', system-ui, sans-serif",
          fontSize: 30,
          lineHeight: 1.05,
          letterSpacing: 1,
          color: FG,
        }}
      >
        NO ACCOUNTS.
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 1,
          color: FG_DIM,
          marginTop: 6,
          opacity: 0.75,
        }}
      >
        nothing to log into. nothing to leak.
      </div>
    </div>
  );
}

function Label({ tag, title, note }: { tag: string; title: string; note: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 2,
          color: FG,
          background: "rgba(30,26,20,0.08)",
          border: "1px solid rgba(30,26,20,0.25)",
          padding: "3px 8px",
          textTransform: "uppercase",
        }}
      >
        {tag}
      </span>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.5,
          color: FG,
          marginLeft: 12,
        }}
      >
        {title}
      </span>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: 0.3,
          color: FG_DIM,
          opacity: 0.8,
          marginTop: 5,
        }}
      >
        {note}
      </div>
    </div>
  );
}

function VariantBlock({
  tag,
  title,
  note,
  children,
}: {
  tag: string;
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 40 }}>
      <Label tag={tag} title={title} note={note} />
      <div style={{ border: "1px solid rgba(30,26,20,0.18)", overflow: "hidden" }}>
        <DarkBandTop />
        {children}
        <ConcreteBelow />
      </div>
    </div>
  );
}

export function Variants() {
  return (
    <div style={{ ...concreteBg, minHeight: "100vh", padding: "36px 28px 48px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "'Staatliches', system-ui, sans-serif",
            fontSize: 34,
            letterSpacing: 1,
            color: FG,
            margin: "0 0 6px",
          }}
        >
          ARCHITECTURE SPEC LINE — 3 TREATMENTS
        </h1>
        <p
          style={{
            fontFamily: MONO,
            fontSize: 12,
            letterSpacing: 0.3,
            color: FG_DIM,
            margin: "0 0 28px",
            lineHeight: 1.5,
          }}
        >
          Same shortened one-liner, shown at the dark→light seam. Copy:{" "}
          <span style={{ color: FG, fontWeight: 700 }}>{COPY}</span>
        </p>

        {/* A — Quiet footnote: no band, muted mono line on the light side */}
        <VariantBlock
          tag="A"
          title="Quiet footnote"
          note="No band. Hard dark→light edge, then a muted spec line sits on the concrete as a credits-style footnote. Most played-down. Tradeoff: loses the orange divider entirely."
        >
          <div style={{ ...concreteBg, padding: "14px 20px 0" }}>
            <div
              style={{
                borderTop: "1px solid rgba(30,26,20,0.22)",
                paddingTop: 12,
                textAlign: "center",
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  letterSpacing: 1.5,
                  color: FG_DIM,
                  opacity: 0.85,
                  whiteSpace: "nowrap",
                }}
              >
                {COPY}
              </span>
            </div>
          </div>
        </VariantBlock>

        {/* B — Desaturated divider: muted clay band, still a structural border */}
        <VariantBlock
          tag="B"
          title="Desaturated divider"
          note="Keeps a full-bleed band so it still reads as the dark→light border, but swaps bright orange for a muted clay tone with quiet off-white text. Calmer, still structural."
        >
          <div
            style={{
              backgroundColor: "#8A5A3C",
              padding: "9px 20px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 11,
                letterSpacing: 1.5,
                color: "#F2EADF",
                whiteSpace: "nowrap",
              }}
            >
              {COPY}
            </span>
          </div>
        </VariantBlock>

        {/* C — Minimal change: current bright orange band, shortened to one line */}
        <VariantBlock
          tag="C"
          title="Minimal change (current look)"
          note="Keeps the bright orange band exactly as it is now — just the shorter copy on one line, white text. Loudest; reads as a headline, not a footnote."
        >
          <div
            style={{
              backgroundColor: BURNT_BAND,
              padding: "9px 20px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 12,
                letterSpacing: 2,
                color: "#FFFFFF",
                whiteSpace: "nowrap",
              }}
            >
              {COPY}
            </span>
          </div>
        </VariantBlock>
      </div>
    </div>
  );
}
