// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import DemoVideoEmbed from "@/components/DemoVideoEmbed";

// Media page (/media). Holds the two demo-video embeds and the NO-claims
// refusal band that used to live on the landing page. The refusal band is
// placed first (top), the demo band below it. Both are full-bleed sections
// moved verbatim from LandingPage; the only adaptation is the wrapping
// `position: relative; overflow: hidden` container below — on Landing the
// refusal band's 100000px-tall decorative teal band was clipped by the
// landing root's overflow:hidden, which PageShell's container does not set.
// The wrapper restores that clipping so the band cannot create runaway
// scroll on this page.

export default function MediaPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "32px",
        }}
      >
        {/* ── Refusal band on the page's light-concrete background ──
            Transparent full-bleed block: it lets the body's own light
            concrete show through (no extra overlay). Typography-led:
            a diagonal staircase of the four NO phrases over a three-beat
            closer; phrases use dark ink with brown / burnt-orange accents.

            Layer stack:
              z=1   decorative orange square (upper-left)
              z=10  decorative teal band (right edge → clipped by wrapper)
              z=31  copy column */}
        <section
          aria-label="What VOID refuses"
          style={{
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            position: "relative",
          }}
        >
          {/* Small decorative orange square in the upper-left corner.
              Purely decorative (aria-hidden); this section has no background
              of its own, so the page's light-concrete body shows through. The
              25% tint is baked into the rgba fill (not `opacity`) to avoid
              spawning an offscreen compositing layer. #C85A00 = rgb(200,90,0). */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "clamp(16px, 4vw, 40px)",
              left: "clamp(16px, 4vw, 40px)",
              width: "clamp(48px, 9vw, 80px)",
              height: "clamp(48px, 9vw, 80px)",
              backgroundColor: "rgba(200, 90, 0, 0.25)",
              zIndex: 1,
            }}
          />
          {/* Teal band, pinned to the right edge. Its top is anchored to a line
              measured up from the bottom of this section by the orange square's
              height; the height is set far beyond any page height and the
              wrapping container's overflow:hidden clips it precisely. Purely
              decorative (aria-hidden), drawn above the body (z=0) but below all
              copy (z=31). The 25% tint is baked into the rgba background rather
              than set via `opacity`: an opacity < 1 would render this tall
              element to its own offscreen compositing layer, which intermittently
              broke the backdrop-filter on frosted demo-video labels nearby (text
              vanished until a repaint forced recomposite). #2A9D8F = rgb(42,157,143). */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "calc(100% - clamp(48px, 9vw, 80px))",
              right: "clamp(16px, 4vw, 64px)",
              width: "clamp(110px, 16vw, 240px)",
              height: "100000px",
              backgroundColor: "rgba(42, 157, 143, 0.25)",
              zIndex: 10,
            }}
          />
          {/* Typography-led surveillance copy — natural vertical flow,
              no reserved image height. Document order (setup → four NO
              phrases → three closer beats) carries the full meaning for
              a screen reader; the staircase indent and the left/right/
              center closer offsets are a purely visual flourish. */}
          <div
            style={{
              width: "100%",
              maxWidth: "880px",
              margin: "0 auto",
              padding: "44px 24px 52px",
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "clamp(48px, 8vw, 88px)",
              position: "relative",
              zIndex: 31,
            }}
          >
            {/* Diagonal staircase, split into two stamped clusters. Each
                line is still indented further than the one above it (the
                descending staircase), but the four lines are now grouped as
                two pairs: the top pair (NO RECORDINGS / NO TRANSCRIPTS) is
                nudged left and the bottom pair (NO ARCHIVES / NO LOGS) is
                nudged right, with a tight vertical gap inside each pair and a
                wider gap between the pairs so they read as two deliberate
                clusters. The container is fit-content and centered so the
                block sits centered as a unit. Every offset is a clamp so the
                step scales with the viewport and never clips at 280–390px. */}
            <div
              style={{
                width: "fit-content",
                maxWidth: "100%",
                margin: "0 auto",
                textAlign: "left",
                display: "flex",
                flexDirection: "column",
                gap: "clamp(16px, 4vw, 30px)",
              }}
            >
              {[
                [
                  { text: "NO ACCOUNTS.", color: "var(--fg)" },
                  { text: "NO TRACKING.", color: "var(--fg)" },
                ],
                [
                  { text: "NO FACESCANS.", color: "#5C3A1E" },
                  { text: "NO BANKS.", color: "#5C3A1E" },
                ],
              ].map((pair, p) => (
                <div
                  key={p === 0 ? "top-pair" : "bottom-pair"}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "clamp(6px, 1.6vw, 11px)",
                    // Layout-neutral horizontal nudge via position/left instead
                    // of `transform`: a 2D transform promotes a compositing
                    // layer near text, which is exactly what reintroduces the
                    // vanish bug (see .landing-haze rule in index.css). relative
                    // + left is a paint offset with no layer/stacking context.
                    position: "relative",
                    left:
                      p === 0
                        ? "calc(-1 * clamp(16px, 5.5vw, 52px))"
                        : "clamp(16px, 5.5vw, 52px)",
                  }}
                >
                  {pair.map((phrase, i) => {
                    const stairIndex = p * 2 + i;
                    return (
                      <div
                        key={phrase.text}
                        style={{
                          paddingLeft: `calc(${stairIndex} * clamp(18px, 6vw, 56px))`,
                          fontFamily:
                            "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
                          fontSize: "clamp(15px, 4.4vw, 24px)",
                          fontWeight: 700,
                          letterSpacing: "1px",
                          lineHeight: 1.25,
                          textTransform: "uppercase",
                          color: phrase.color,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {phrase.text}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Three-beat closer — left → right → center, a fuse burning
                down. Each beat is a full-width block whose text alignment
                pins it to its edge, so the offsets stay deliberate at any
                width; the vertical stack reads the same on phones. */}
            <div
              style={{
                width: "100%",
                maxWidth: "480px",
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              {[
                {
                  text: "A room.",
                  align: "left" as const,
                  color: "var(--fg)",
                  marginTop: 0,
                  fontSize: "clamp(24px, 6.5vw, 40px)",
                  fontFamily: "'Staatliches', system-ui, sans-serif",
                  fontStyle: "normal" as const,
                  textTransform: "uppercase" as const,
                  fontWeight: 400,
                },
                {
                  text: "Then a countdown.",
                  align: "right" as const,
                  color: "#5C3A1E",
                  marginTop: 0,
                  fontSize: "clamp(24px, 6.5vw, 40px)",
                  fontFamily: "'Staatliches', system-ui, sans-serif",
                  fontStyle: "normal" as const,
                  textTransform: "uppercase" as const,
                  fontWeight: 400,
                },
                {
                  // Lowercase flowing script: the one beat that breaks the
                  // shouting all-caps machine voice — a quiet, hand-written aside.
                  // Self-hosted Gloria Hallelujah, a single upright handwritten
                  // weight (cursive/serif fallback), so no italic/light styling applies.
                  text: "Then nothing.",
                  align: "center" as const,
                  color: "var(--burnt)",
                  marginTop: "clamp(32px, 8vw, 72px)",
                  fontSize: "clamp(30px, 8.4vw, 52px)",
                  fontFamily: "'Gloria Hallelujah', 'Cormorant Garamond', cursive, serif",
                  fontStyle: "normal" as const,
                  textTransform: "none" as const,
                  fontWeight: 400,
                },
              ].map((beat) => (
                <div
                  key={beat.text}
                  style={{
                    textAlign: beat.align,
                    textTransform: beat.textTransform,
                    fontFamily: beat.fontFamily,
                    fontStyle: beat.fontStyle,
                    fontSize: beat.fontSize,
                    letterSpacing: "1px",
                    lineHeight: 1.05,
                    color: beat.color,
                    fontWeight: beat.fontWeight,
                    marginTop: beat.marginTop,
                  }}
                >
                  {beat.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Demo videos on a full-bleed dark-asphalt band ──
            The two demos sit on a dark pavement surface so the "watch it
            work" moment reads as a distinct, cinematic zone. The asphalt
            recipe (concrete + dark gradient) is copied from the header. ── */}
        <section
          aria-label="Demos"
          style={{
            width: "100vw",
            marginLeft: "calc(50% - 50vw)",
            marginRight: "calc(50% - 50vw)",
            position: "relative",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "var(--surface-dark)",
              backgroundImage:
                "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
              backgroundSize: "auto, 400px auto",
              backgroundRepeat: "repeat",
              zIndex: 0,
            }}
          />
          <div
            style={{
              position: "relative",
              zIndex: 31,
              display: "flex",
              flexDirection: "column",
              gap: "32px",
              alignItems: "center",
              width: "100%",
              maxWidth: "680px",
              margin: "0 auto",
              padding: "72px 24px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}
            >
              <DemoVideoEmbed
                onDark
                solidLabel
                label="Enough presence to trust. Not enough to surveil."
                src="biometric-demo.mp4"
                poster="biometric-demo-poster.png"
                ariaLabel="Split-screen demo: a normal webcam call on the left, what VOID transmits on the right"
                iframeSrc="/biometric-demo-video/?autoplay=1"
              />
              {/* Expanded Gameboy-origin teaser — the low-res, pixelated
                  picture framed as a small act of refusal, with a link to
                  the full /why story. Light text for the dark band. */}
              <div style={{ textAlign: "center", padding: "0 4px" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    lineHeight: 1.7,
                    letterSpacing: "0.3px",
                    color: "#EFE7D6",
                  }}
                >
                  Pixelated on purpose — reads as you, useless for
                  face-recognition.
                  <br />A small act of refusal.
                </span>
                <div style={{ marginTop: "10px" }}>
                  <Link
                    href="/why"
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      color: "var(--gold)",
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    Why we built this →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
