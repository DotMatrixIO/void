// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CSSProperties } from "react";

export interface HeroVariantProps {
  portraitFile: string;
  label: string;
  altDesc: string;
}

const base = import.meta.env.BASE_URL.endsWith("/")
  ? import.meta.env.BASE_URL
  : import.meta.env.BASE_URL + "/";

// Text shadow profile that has to work against two backgrounds at once:
// (1) the dark pavement band on the left half, and (2) the portrait on
// the right half — which ranges from black-and-white through bright
// gold to burnt-orange across the 5 candidates. A heavy multi-stop
// shadow gives a halo dark enough to survive even on the gold/orange
// portraits without changing the foreground type color.
const READABILITY_SHADOW =
  "0 0 4px rgba(20,17,13,0.95), 0 0 10px rgba(20,17,13,0.95), 0 0 18px rgba(20,17,13,0.85), 0 1px 2px rgba(0,0,0,0.95)";

export default function HeroVariant({ portraitFile, label, altDesc }: HeroVariantProps) {
  const portraitSrc = base + "portraits/" + portraitFile;

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
        "--gold": "#E8A200",
        "--bg": "#F0E6D2",
      } as CSSProperties}
    >
      {/* Variant label badge (mockup-only) */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          fontSize: 10,
          letterSpacing: 2,
          color: "var(--gold)",
          textTransform: "uppercase",
          opacity: 0.7,
          zIndex: 40,
        }}
      >
        {label}
      </div>

      {/* Portrait — sits on the right half */}
      <div
        role="img"
        aria-label={altDesc}
        style={{
          position: "absolute",
          right: "8%",
          top: "50%",
          transform: "translateY(-50%)",
          width: 420,
          height: 420,
          backgroundImage: `url("${portraitSrc}")`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          zIndex: 10,
          pointerEvents: "none",
          filter: "drop-shadow(0 0 32px rgba(0,0,0,0.65))",
        }}
      />

      {/* Copy column — straddles the picture / pavement boundary
          (left half on pavement, right half overlapping picture). */}
      <figure
        style={{
          position: "relative",
          zIndex: 31,
          margin: 0,
          padding: "80px 24px 56px",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          minHeight: 720,
          boxSizing: "border-box",
        }}
      >
        <aside
          aria-hidden="true"
          style={{
            position: "relative",
            textTransform: "uppercase",
            fontSize: 14,
            letterSpacing: 2,
            lineHeight: 1.6,
            color: "var(--bg)",
            display: "flex",
            flexDirection: "column",
            gap: 22,
            textAlign: "left",
            width: "70%",
            maxWidth: 560,
            // Anchor the words just left of center, so the right
            // edge of each line lands on top of the portrait.
            marginLeft: "8%",
            marginTop: "auto",
            marginBottom: "auto",
            textShadow: READABILITY_SHADOW,
          }}
        >
          <p style={{ margin: 0 }}>
            <span style={{ color: "var(--gold)" }}>RIGHT NOW</span>
            <br />
            YOU ARE IN A VIDEO CALL.
          </p>
          <p style={{ margin: 0 }}>
            <span style={{ color: "var(--gold)" }}>
              THE SERVERS CAN'T SEE YOUR VIDEO
            </span>
            <br />
            AND THEY CAN'T HEAR WHAT YOU SAY.
          </p>
          <p style={{ margin: 0, color: "#D8CCB4" }}>
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
            color: "#D8CCB4",
            textTransform: "uppercase",
            textAlign: "center",
            lineHeight: 1.7,
            textShadow: READABILITY_SHADOW,
          }}
        >
          The room. The countdown. Then nothing.
        </figcaption>
      </figure>
    </section>
  );
}
