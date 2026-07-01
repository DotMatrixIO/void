// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

// Iteration A — based on the first-batch "centered" layout, using the
// gold-ASCII portrait. Brighter copy on top of the picture, with
// blurred dark-gray plates behind the dense text blocks so they read
// against both the dark pavement on the left/right margins and the
// gold-ASCII portrait in the middle.

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : import.meta.env.BASE_URL + "/";

const portraitSrc = base + "portraits/self-portrait02_1779993532975.png";

const PLATE: CSSProperties = {
  display: "inline-block",
  padding: "8px 14px",
  background: "rgba(20,17,13,0.78)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  borderRadius: 2,
};

export default function IterationA() {
  return (
    <section
      aria-label="Hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: 760,
        overflow: "hidden",
        backgroundColor: "#14110D",
        backgroundImage:
          "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('" +
          base +
          "concrete.jpeg')",
        backgroundSize: "auto, 400px auto",
        backgroundRepeat: "repeat",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        "--gold": "#E8A200",
        "--bg": "#F0E6D2",
      } as CSSProperties}
    >
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: 10,
          letterSpacing: 2,
          color: "#E8A200",
          textTransform: "uppercase",
          opacity: 0.7,
          zIndex: 40,
        }}
      >
        ITERATION A · GOLD ASCII · CENTERED
      </div>

      {/* Portrait — centered, sits behind copy */}
      <div
        role="img"
        aria-label="Biometric-masked self-portrait, gold ASCII / dot-matrix rendering."
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -45%)",
          width: 460,
          height: 460,
          backgroundImage: `url("${portraitSrc}")`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          zIndex: 10,
          pointerEvents: "none",
          filter: "drop-shadow(0 0 32px rgba(0,0,0,0.65))",
        }}
      />

      {/* Obscure the white peer-id lettering baked into the bottom-left
          of the portrait PNG. The plate is sized to cover the
          "YOU [PEER-…]" + "F2T636 · 14:32:49 · PEER-…" baseline. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "calc(50% - 210px)",
          top: "calc(50% + 130px)",
          width: 230,
          height: 80,
          background: "rgba(20,17,13,0.92)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          zIndex: 20,
          pointerEvents: "none",
        }}
      />

      <figure
        style={{
          position: "relative",
          zIndex: 31,
          margin: 0,
          padding: "72px 24px 56px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          minHeight: 760,
          boxSizing: "border-box",
          textAlign: "center",
        }}
      >
        {/* Top lines — sit on the dark pavement above the portrait */}
        <div
          style={{
            textTransform: "uppercase",
            fontSize: 15,
            letterSpacing: 2,
            lineHeight: 1.55,
            color: "#FFF3D9",
            fontWeight: 600,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          <p style={{ margin: 0 }}>
            <span style={{ color: "#FFC83D" }}>RIGHT NOW</span>
            <br />
            YOU ARE IN A VIDEO CALL.
          </p>
          <p style={{ margin: 0 }}>
            <span style={{ color: "#FFC83D" }}>
              THE SERVERS CAN'T SEE YOUR VIDEO
            </span>
            <br />
            AND THEY CAN'T HEAR WHAT YOU SAY.
          </p>
        </div>

        {/* Lower paragraph — overlaps portrait. Single plate behind
            both lines. */}
        <div style={{ marginTop: 120 }}>
          <div
            style={{
              ...PLATE,
              padding: "12px 18px",
              color: "#FFFFFF",
              fontWeight: 600,
              textTransform: "uppercase",
              fontSize: 15,
              letterSpacing: 2,
              lineHeight: 1.7,
              border: "1px solid rgba(168,158,144,0.35)",
            }}
          >
            <div>NO RECORDING. NO TRANSCRIPTS.</div>
            <div>NO ARCHIVES. NO LOGS.</div>
          </div>
        </div>

        <figcaption style={{ marginTop: "auto" }}>
          <span
            style={{
              ...PLATE,
              padding: "6px 12px",
              fontSize: 12,
              letterSpacing: 2,
              color: "#E8DCC4",
              textTransform: "uppercase",
              lineHeight: 1.7,
              border: "1px solid rgba(168,158,144,0.25)",
            }}
          >
            The room. The countdown. Then nothing.
          </span>
        </figcaption>
      </figure>
    </section>
  );
}
