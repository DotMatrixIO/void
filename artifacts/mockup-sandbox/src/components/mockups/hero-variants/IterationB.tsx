// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

// Iteration B — based on the second-batch "portrait right / copy left"
// layout, using the 1-bit hi-contrast line portrait. Text column
// stretched so roughly the right ~50% of each line lands on the
// portrait; lettering bolder and brighter; the white peer-id lettering
// baked into the bottom-left of the portrait PNG is obscured by a
// dark plate that lives inside the portrait wrapper so it tracks the
// image exactly.

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : import.meta.env.BASE_URL + "/";

const portraitSrc = base + "portraits/self-portrait04_1779993532974.png";

const READABILITY_SHADOW =
  "0 0 4px rgba(20,17,13,1), 0 0 12px rgba(20,17,13,1), 0 0 22px rgba(20,17,13,0.95), 0 1px 3px rgba(0,0,0,1)";

const PORTRAIT_SIZE = 420;

export default function IterationB() {
  return (
    <section
      aria-label="Hero"
      style={{
        position: "relative",
        width: "100%",
        minHeight: 720,
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
        ITERATION B · 1-BIT LINE · COPY 50% OVER IMAGE
      </div>

      {/* Portrait wrapper on the right; obscure-plate lives inside so it
          tracks the image exactly regardless of container width. */}
      <div
        style={{
          position: "absolute",
          right: "4%",
          top: "50%",
          transform: "translateY(-50%)",
          width: PORTRAIT_SIZE,
          height: PORTRAIT_SIZE,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        <div
          role="img"
          aria-label="Biometric-masked self-portrait, 1-bit high-contrast line rendering."
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${portraitSrc}")`,
            backgroundSize: "contain",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
            filter: "drop-shadow(0 0 32px rgba(0,0,0,0.7))",
          }}
        />
        {/* Cover the white "YOU [PEER-…] / F2T636 · 14:…" lettering
            baked into the bottom-left of the portrait PNG. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "4%",
            bottom: "6%",
            width: "55%",
            height: 64,
            background: "rgba(20,17,13,0.95)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
          }}
        />
      </div>

      <figure
        style={{
          position: "relative",
          zIndex: 31,
          margin: 0,
          padding: "80px 0 56px",
          minHeight: 720,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <aside
          aria-hidden="true"
          style={{
            position: "relative",
            textTransform: "uppercase",
            fontSize: 18,
            letterSpacing: 2,
            lineHeight: 1.5,
            fontWeight: 800,
            color: "#FFFFFF",
            display: "flex",
            flexDirection: "column",
            gap: 24,
            textAlign: "left",
            // Anchor on the left edge and stretch wide so each line's
            // right ~50% lands on top of the portrait.
            marginLeft: "14%",
            width: "78%",
            marginTop: "auto",
            marginBottom: "auto",
            textShadow: READABILITY_SHADOW,
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
          <p style={{ margin: 0, color: "#FFF3D9" }}>
            NO RECORDING
            <br />
            NO TRANSCRIPTS
            <br />
            NO ARCHIVES
            <br />
            NO LOGS
          </p>
        </aside>

        <figcaption
          style={{
            marginTop: 36,
            fontSize: 12,
            letterSpacing: 2,
            color: "#F0E6D2",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.7,
            fontWeight: 600,
            textShadow: READABILITY_SHADOW,
          }}
        >
          The room. The countdown. Then nothing.
        </figcaption>
      </figure>
    </section>
  );
}
