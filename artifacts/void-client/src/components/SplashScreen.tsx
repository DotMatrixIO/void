// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, useCallback } from "react";

// First-visit splash. Runs ONCE per browser (gated by localStorage),
// skipped entirely for `prefers-reduced-motion`, skipped on any tap /
// click / key press. Total runtime target ~6s; tune the timing table
// below in one place.
//
// The post-splash page absorbs the marketing pitch as DOM. The splash
// is the *first-impression* surface, not the source of truth for any
// copy that has to remain reachable later — anything reachable later
// lives in the page itself or its sub-pages.

export const SPLASH_SEEN_KEY = "void:splash-seen";

interface Props {
  onDone: () => void;
}

interface Line {
  /** Milliseconds after splash mount when this line should reveal. */
  at: number;
  /** Visual group; lines in the same group share a column so they
   *  read as a unit rather than as a stack. */
  group: 1 | 2 | 3 | 4 | 5;
  text: string;
  /** Optional emphasis tag — applied via inline styles below. */
  variant?: "brand" | "badge" | "rough" | "headline" | "burn" | "kicker" | "pillar" | "price";
}

// Timing in ms from splash mount. Reveal phase ends at 5000 ms;
// groups 1–4 fade out at PRICE_CLEAR_AT; the price line appears
// solo at PRICE_REVEAL_AT against a darker vignette, lingers
// PRICE_LINGER_MS, then the splash fades out as a unit (500 ms).
const SCRIPT: Line[] = [
  { at: 100,  group: 1, text: "V  []  I  D",                              variant: "brand" },
  { at: 600,  group: 1, text: "OPEN BETA · v0.5",                         variant: "badge" },
  { at: 1100, group: 1, text: "(EARLY AND UNFINISHED)",                   variant: "rough" },

  { at: 1900, group: 2, text: "Send anyone a link.",                      variant: "headline" },
  { at: 2400, group: 2, text: "They click. You talk.",                    variant: "headline" },
  { at: 2900, group: 2, text: "The room burns down.",                     variant: "burn" },

  { at: 3500, group: 3, text: "Private video rooms",                      variant: "kicker" },

  { at: 4100, group: 4, text: "No accounts",                              variant: "pillar" },
  { at: 4250, group: 4, text: "No signups",                               variant: "pillar" },
  { at: 4400, group: 4, text: "No transcripts",                           variant: "pillar" },
  { at: 4550, group: 4, text: "No AI summaries",                          variant: "pillar" },
  { at: 4700, group: 4, text: "No call logs",                             variant: "pillar" },
  { at: 4850, group: 4, text: "No downloads",                             variant: "pillar" },
  { at: 5000, group: 4, text: "No records of what was said",              variant: "pillar" },

  { at: 5800, group: 5, text: "A CUP OF COFFEE = ONE ROOM",             variant: "price" },
];

// Solo-price beat: everything from groups 1-4 fades out at
// PRICE_CLEAR_AT, the price line appears at PRICE_REVEAL_AT against
// a darker centered vignette, lingers PRICE_LINGER_MS, then the
// splash fades as a unit during the last 500 ms.
const PRICE_CLEAR_AT = 5400;
const PRICE_REVEAL_AT = 5800;
const PRICE_LINGER_MS = 1000;
const FINAL_FADE_MS = 750;
const TOTAL_RUNTIME_MS = PRICE_REVEAL_AT + PRICE_LINGER_MS + FINAL_FADE_MS;

// Hardcoded bright colors for the splash. Cannot use the theme
// CSS vars here: in the Gold-Voyager palette, `--fg` is #1E1A14 and
// `--fg-dim` is #352D20 — both near-black, designed to sit on the
// tan #BEB3A2 surface. On the splash's #0A0908 backdrop they would
// disappear. These constants give the splash type the high-contrast,
// vibrant feel the rest of the app gets from light-on-tan.
const SPLASH_FG = "#F5F1E8";    // off-white, primary type
const SPLASH_FG_DIM = "#B8B0A0"; // warm grey, secondary type
const SPLASH_GOLD = "#FFC542";   // brighter gold than --gold (#E8A200)
const SPLASH_BURNT = "#FF8A3D";  // brighter burnt than --burnt (#C85A00)

function variantStyle(variant: Line["variant"]): React.CSSProperties {
  switch (variant) {
    case "brand":
      return {
        fontFamily: "'Staatliches', system-ui, sans-serif",
        fontSize: "clamp(48px, 13vw, 96px)",
        letterSpacing: "clamp(2px, 1.5vw, 8px)",
        color: SPLASH_GOLD,
        lineHeight: 1,
        textTransform: "uppercase",
      };
    case "badge":
      return {
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        letterSpacing: "3px",
        color: SPLASH_BURNT,
        textTransform: "uppercase",
        border: `1px solid ${SPLASH_BURNT}`,
        display: "inline-block",
        padding: "4px 10px",
      };
    case "rough":
      return {
        fontFamily: "var(--font-mono)",
        fontSize: "10px",
        letterSpacing: "3px",
        color: SPLASH_FG_DIM,
        textTransform: "uppercase",
      };
    case "headline":
      return {
        fontFamily: "'Staatliches', system-ui, sans-serif",
        fontSize: "clamp(22px, 5.6vw, 32px)",
        lineHeight: 1.2,
        letterSpacing: "1px",
        color: SPLASH_FG,
        textTransform: "uppercase",
      };
    case "burn":
      return {
        fontFamily: "'Staatliches', system-ui, sans-serif",
        fontSize: "clamp(22px, 5.6vw, 32px)",
        lineHeight: 1.2,
        letterSpacing: "1px",
        color: SPLASH_BURNT,
        textTransform: "uppercase",
      };
    case "kicker":
      return {
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        letterSpacing: "3px",
        color: SPLASH_FG,
        textTransform: "uppercase",
      };
    case "pillar":
      return {
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        letterSpacing: "2px",
        color: SPLASH_FG,
        textTransform: "uppercase",
      };
    case "price":
      return {
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        letterSpacing: "3px",
        color: SPLASH_GOLD,
        textTransform: "uppercase",
      };
    default:
      return {};
  }
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function markSplashSeen() {
  try {
    localStorage.setItem(SPLASH_SEEN_KEY, "1");
  } catch {
    // Storage failure is non-fatal — worst case the splash plays
    // again on next visit. That's a recoverable cosmetic outcome,
    // never a correctness or security issue.
  }
}

export function shouldShowSplash(): boolean {
  // Reduced-motion users skip the splash entirely. Holding an OS
  // accessibility setting hostage on the first page of a "we respect
  // you" app is a bad look — and we record the flag below so the
  // skip is permanent, not re-evaluated every visit.
  if (prefersReducedMotion()) return false;
  try {
    return localStorage.getItem(SPLASH_SEEN_KEY) !== "1";
  } catch {
    // Storage failure: err on the side of showing the splash once
    // and silently failing to remember. First impression matters.
    return true;
  }
}

export default function SplashScreen({ onDone }: Props) {
  const [now, setNow] = useState(0);
  const startRef = useRef<number>(Date.now());
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    markSplashSeen();
    onDone();
  }, [onDone]);

  useEffect(() => {
    // Reduced-motion users must never see the splash. The host page
    // already guards on `shouldShowSplash()`, but defend in depth in
    // case a future caller mounts us unconditionally.
    if (prefersReducedMotion()) {
      finish();
      return;
    }

    let frame = 0;
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      setNow(elapsed);
      if (elapsed >= TOTAL_RUNTIME_MS) {
        finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finish]);

  useEffect(() => {
    function onKey() { finish(); }
    function onPointer() { finish(); }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [finish]);

  // Group lines by their `group` field so we can render each as a
  // vertical block with consistent spacing. A line is visible iff
  // `now >= line.at`. The whole splash fades out as a unit in the
  // last 500 ms via opacity easing.
  const groups: Record<number, Line[]> = {};
  for (const line of SCRIPT) {
    (groups[line.group] ||= []).push(line);
  }
  const groupKeys = Object.keys(groups).map(Number).sort((a, b) => a - b);

  const fadeStart = TOTAL_RUNTIME_MS - FINAL_FADE_MS;
  const fadeOpacity = now >= fadeStart
    ? Math.max(0, 1 - (now - fadeStart) / FINAL_FADE_MS)
    : 1;

  // Solo-price beat. Groups 1–4 are the marketing reveal; group 5 is
  // the final pricing line that must appear alone against a darker
  // backdrop. Once `now >= PRICE_CLEAR_AT` we collapse the marketing
  // groups (opacity 0, 300 ms) and ramp up the vignette so the price
  // line is centered against a deeper-black box for ~1 s.
  const vignetteOpacity = now >= PRICE_CLEAR_AT
    ? Math.min(1, (now - PRICE_CLEAR_AT) / 400)
    : 0;

  return (
    <div
      role="presentation"
      aria-hidden="true"
      data-testid="splash-screen"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        // Dark concrete texture, matching the rest of the app's
        // dark sections (see HamburgerMenu, threat-model cards). The
        // #0A0908 base + a heavy near-black overlay keeps it dark
        // enough for the gold wordmark to read while still letting
        // the grain show through. Must NOT use `var(--bg)`: in the
        // Gold-Voyager palette `--bg` is the tan #BEB3A2.
        backgroundColor: "#0A0908",
        backgroundImage:
          "linear-gradient(rgba(10,9,8,0.88), rgba(10,9,8,0.88)), url('/concrete.jpeg')",
        backgroundSize: "auto, 600px auto",
        backgroundRepeat: "repeat",
        color: "var(--fg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "32px",
        padding: "40px 24px",
        fontFamily: "var(--font-mono)",
        cursor: "pointer",
        opacity: fadeOpacity,
        transition: "opacity 120ms linear",
        overflow: "hidden",
      }}
    >
      {/* Marketing reveal: groups 1–4. Collapse to opacity 0 at
          PRICE_CLEAR_AT so the price line gets the stage to itself. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "32px",
          opacity: now >= PRICE_CLEAR_AT ? 0 : 1,
          transform: now >= PRICE_CLEAR_AT ? "scale(0.98)" : "scale(1)",
          transition: "opacity 300ms ease-out, transform 300ms ease-out",
        }}
      >
        {groupKeys.filter((k) => k !== 5).map((key) => (
          <div
            key={key}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: key === 4 ? "6px" : "12px",
              textAlign: "center",
            }}
          >
            {groups[key].map((line, i) => {
              const visible = now >= line.at;
              return (
                <div
                  key={`${key}-${i}`}
                  style={{
                    ...variantStyle(line.variant),
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(6px)",
                    transition:
                      "opacity 220ms ease-out, transform 220ms ease-out",
                  }}
                >
                  {line.text}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Solo-price beat. Vignette is a radial darken layered above
          the (already-fading) marketing groups so the eye lands on
          the gold price line with no competing chrome. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse at center, #000 0%, #000 22%, rgba(0,0,0,0.85) 45%, rgba(0,0,0,0.4) 75%, rgba(0,0,0,0) 100%)",
          opacity: vignetteOpacity,
          transition: "opacity 400ms ease-out",
        }}
      />
      {groups[5] && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          {groups[5].map((line, i) => {
            const visible = now >= line.at;
            return (
              <div
                key={`5-${i}`}
                style={{
                  ...variantStyle(line.variant),
                  textAlign: "center",
                  padding: "20px 28px",
                  opacity: visible ? 1 : 0,
                  transform: visible ? "translateY(0)" : "translateY(6px)",
                  transition:
                    "opacity 320ms ease-out, transform 320ms ease-out",
                  textShadow: "0 0 24px rgba(0,0,0,0.9)",
                }}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
