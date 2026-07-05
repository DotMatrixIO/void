// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect } from "react";
import { Link } from "wouter";
import HamburgerMenu from "@/components/HamburgerMenu";
import StartScreen from "@/pages/StartScreen";
import PageFooter from "@/components/PageFooter";
import { getOnionMirrorUrl } from "@/lib/onionMirror";

// Merged landing + start screen. Before the merge, LandingPage was a
// marketing-only page whose ENTER button promoted to a separate
// StartScreen with the host/join/recover controls. Now both pages live
// here: the marketing chrome wraps an embedded `<StartScreen
// chromeless />` so the user lands directly on the functional controls
// without an intermediate step. The animated first-visit splash
// (SplashScreen.tsx) carries the once-per-browser pitch — the pricing
// card and "VOID is not for everyone" footer link that used to live on
// this page were moved into the splash (pricing) or dropped entirely.

interface Props {
  onJoinRoom: (
    roomId: string,
    e2eKey: CryptoKey,
    voidPhrase: string,
    isHost: boolean,
  ) => void;
  sessionNotice?: string | null;
  onDismissNotice?: () => void;
}

export default function LandingPage({
  onJoinRoom,
  sessionNotice,
  onDismissNotice,
}: Props) {
  const [showInstall, setShowInstall] = useState(false);
  // Guest on-ramp accordion: only the heading shows by default; the
  // reassurance copy + links live behind a "+" expand affordance.
  const [onRampOpen, setOnRampOpen] = useState(false);
  // Task #792 — the worried-guest Tor sentence is gated on a baked
  // `.onion` mirror, the same signal the footer OnionMirrorLink uses.
  // "Reach us at our .onion" is only a true claim when this build has
  // one; an onion ORIGIN is what triggers VOID's relay-only ICE pin.
  const onionUrl = getOnionMirrorUrl();

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;

    if (!isStandalone) {
      setShowInstall(true);
    }
  }, []);

  return (
    <>
    <div
      style={{
        minHeight: "100svh",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 24px 0",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
        gap: "32px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <HamburgerMenu />
      {/* ── Decorative background layer ──
          All the Gold Voyager geometry PLUS the .landing-haze veil live in one
          absolutely-positioned wrapper at zIndex:-1 — behind every text block
          and control (which paint in the normal / positive-z layers above).
          The haze (last child) blurs + tints only this decorative geometry; it
          never sits on the text itself, so it cannot reintroduce the per-span
          vanish bug (see .landing-haze in index.css). */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none" }}>
      {/* ── Gold Voyager decorative geometry ── */}
      <div style={{ position: "absolute", top: 0, left: 0, width: "260px", height: "230px", background: "rgba(232,162,0,0.82)", zIndex: 1, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "-125px", left: "230px", width: "200px", height: "160px", background: "rgba(200,90,0,0.485)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "220px", right: 0, width: "33px", height: "460px", background: "rgba(90,82,72,0.35)", zIndex: 1, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, width: "110px", height: "100px", background: "rgba(232,162,0,0.5)", clipPath: "polygon(0 0, 0 100%, 100% 100%)", zIndex: 2, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "230px", left: 0, width: "14px", height: "220px", background: "rgba(240,184,0,0.975)", zIndex: 4, pointerEvents: "none" }} />
      {/* Red vertical rule — sits BEHIND the dark pavement bands (hero +
          install/footer bg divs at z=0) and BEHIND the demo video
          placeholders (DemoVideoEmbed inside hero content wrapper at
          z=31). Visible only against the tan body bg in the gaps
          between pavement zones. zIndex:-1 places it below all other
          z=0+ children of LandingPage but still inside the root
          stacking context, so the body's concrete bg shows through
          beneath it. */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: "112px", width: "3px", background: "rgba(204,34,0,0.45)", zIndex: -1, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "0", right: "18px", width: "90px", height: "200px", background: "rgba(212,160,64,0.22)", zIndex: 1, pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "92px", right: "8px", width: "16px", height: "16px", background: "rgba(13,157,139,0.9)", zIndex: 30, pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: "280px", right: "36px", width: "10px", height: "10px", background: "rgba(204,34,0,0.7)", zIndex: 30, pointerEvents: "none" }} />
      {/* Horizontal gold divider — same coordinate system as the red
          vertical rule above (LandingPage root, position:absolute), so
          left:112px is GUARANTEED to be flush with the red line's
          left:112px. Vertical position sits between the install card's
          "ZERO TRACKING" line and the PageFooter's "© 2026 VOID" line.
          bottom value matches PageFooter intrinsic height (~190px for
          6 link rows + provenance badge + 24/24 padding) plus a
          small breathing gap. zIndex:5 matches the red rule so they
          read as the same decorative layer. */}
      <div style={{ position: "absolute", left: "112px", right: 0, bottom: "178px", height: "2px", background: "rgba(232,162,0,0.5)", zIndex: 5, pointerEvents: "none" }} />
        {/* Single frosted veil over all the decorative geometry above. */}
        <div className="landing-haze" />
      </div>

      {/* Content wrapper has NO position/zIndex so the brand header
          (zIndex:10), hero bg (zIndex:0) and hero content (zIndex:31) stack
          in the normal / positive-z layers — all ABOVE the decorative
          background wrapper (zIndex:-1) and its .landing-haze veil. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "32px", width: "100%" }}>
        {/* ── Brand header card ── */}
        <div style={{
          textAlign: "center",
          width: "100%",
          padding: "32px 24px 28px",
          backgroundColor: "var(--surface-dark)",
          backgroundImage: "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
          backgroundSize: "auto, 400px auto",
          backgroundRepeat: "repeat",
          position: "relative",
          zIndex: 10,
        }}>
          <div
            style={{
              fontFamily: "'Staatliches', system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "clamp(48px, 13vw, 88px)",
              letterSpacing: "clamp(2px, 1.5vw, 8px)",
              textTransform: "uppercase",
              color: "var(--gold)",
              lineHeight: 1,
            }}
          >
            V&nbsp;&nbsp;[]&nbsp;&nbsp;I&nbsp;&nbsp;D
          </div>
          {/* Thesis line — the whispered premise, moved up onto the dark
              asphalt brand card so it reads as a subtitle directly beneath
              the V[]ID wordmark (white on #14110D, registered as
              "white/headerBg (thesis)" in scripts/check-contrast.mjs). This
              is its ONLY placement on the page; pinned by LandingPage.test.tsx
              to render exactly once, before the tagline. */}
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "14px",
              letterSpacing: "1px",
              lineHeight: 1.6,
              color: "#FFFFFF",
              marginTop: "12px",
            }}
          >
            Conversations belong to the people having them.
          </div>
          {/* v0.6 / open beta framing. Pinned by
              __tests__/v05OpenBetaLabel.test.tsx — see that file's loud
              failure message before renaming this string. Sits below the
              thesis line, intentionally small and pushed down so it reads as
              a quiet version stamp, not a headline. */}
          <div
            data-testid="open-beta-badge"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "2px",
              color: "var(--burnt)",
              textTransform: "uppercase",
              marginTop: "20px",
              border: "1px solid var(--burnt)",
              display: "inline-block",
              padding: "3px 8px",
            }}
          >
            OPEN BETA · v0.6
          </div>
        </div>

        {/* ── Three-line tagline + kicker ──
            No panel: the text sits crisp in the content layer (position
            relative + zIndex:31) while the decorative geometry behind it is
            softened by the global .landing-haze veil (see index.css). */}
        <div
          style={{
            textAlign: "center",
            maxWidth: "440px",
            width: "100%",
            padding: "12px 8px",
            position: "relative",
            zIndex: 31,
          }}
        >
          <div
            style={{
              fontFamily: "'Staatliches', system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "clamp(22px, 5.6vw, 32px)",
              lineHeight: 1.2,
              letterSpacing: "1px",
              color: "var(--fg)",
              textTransform: "uppercase",
            }}
          >
            Send anyone a link.
          </div>
          <div
            style={{
              fontFamily: "'Staatliches', system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "clamp(22px, 5.6vw, 32px)",
              lineHeight: 1.2,
              letterSpacing: "1px",
              color: "#642D00",
              textTransform: "uppercase",
              marginTop: "10px",
            }}
          >
            They click. You talk.
          </div>
          <div
            style={{
              fontFamily: "'Staatliches', system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "clamp(22px, 5.6vw, 32px)",
              lineHeight: 1.2,
              letterSpacing: "1px",
              color: "var(--burnt)",
              textTransform: "uppercase",
              marginTop: "10px",
            }}
          >
            The room burns down.
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              letterSpacing: "2px",
              color: "var(--fg)",
              lineHeight: 1.7,
              textTransform: "uppercase",
              marginTop: "18px",
            }}
          >
            Ephemeral rooms · opens from a link, no install · up to 4 people
          </div>
        </div>

        {/* ── Embedded HOST / JOIN / RECOVER controls. StartScreen
            renders its own full-page frame by default; the chromeless
            prop suppresses the duplicate brand block + header + footer
            so the marketing chrome above is the page's only header. ── */}
        <StartScreen
          chromeless
          onJoinRoom={onJoinRoom}
          sessionNotice={sessionNotice}
          onDismissNotice={onDismissNotice}
        />

        {/* Spear-tip thesis, promoted from /docs/compare's "ONE LAST
            THING" closer onto the landing page below the embedded
            HOST / JOIN / RECOVER controls. Additive — the /docs/compare
            copy is unchanged. Rendered as --fg body text on the light
            --bg (8.37:1, AA). */}
        <div
          style={{
            textAlign: "center",
            maxWidth: "520px",
            width: "100%",
            padding: "12px",
            position: "relative",
            zIndex: 31,
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "clamp(14px, 3.6vw, 16px)",
              lineHeight: 1.65,
              letterSpacing: "0.3px",
              color: "var(--fg)",
              margin: 0,
            }}
          >
            No action is required to protect your privacy here. Privacy is the
            default.
          </p>
        </div>

        {/* ── Plain-language "is this for me?" on-ramp ──
            Everything around this block speaks in the brutalist
            machine voice (all-caps mono, "the room burns down", the four
            NO claims). That voice reads as competent and serious to a
            technical visitor, but to the anxious, non-technical guest the
            privacy promise most serves — a journalist contacting a source,
            a parent in a custody dispute, someone coordinating support — it
            can read as "a hacker tool: am I sophisticated enough to be
            here?". This calm, sentence-case aside is the antidote, placed
            just below the HOST / JOIN controls so the guest meets
            reassurance near the controls. It is strictly ADDITIVE: it
            weakens none of the honest claims around it, and it foregrounds
            the two facts the shipped copy never says on Landing — joining a
            call needs no account and is free, and what to do if you can't
            pay to host. Borrows the Why page's warm register onto Landing
            so the guest doesn't have to find /why first. */}
        <section
          aria-label="Is this for you?"
          style={{
            width: "100%",
            maxWidth: "440px",
            padding: "0 8px",
            position: "relative",
            left: "12px",
            zIndex: 31,
          }}
        >
          <div
            style={{
              borderLeft: "3px solid var(--teal)",
              padding: "12px 14px 12px 16px",
              textAlign: "left",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <button
              type="button"
              data-testid="on-ramp-toggle"
              aria-expanded={onRampOpen}
              aria-controls="on-ramp-details"
              onClick={() => setOnRampOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                width: "100%",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "var(--font-body)",
                fontSize: "14px",
                fontWeight: 700,
                letterSpacing: "0.3px",
                color: "var(--fg)",
                lineHeight: 1.4,
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: "1ch", flexShrink: 0, visibility: "hidden" }}
              >
                {onRampOpen ? "–" : "+"}
              </span>
              <span style={{ flex: 1, textAlign: "center" }}>
                New here? Or were you sent a link?
              </span>
              <span
                aria-hidden="true"
                style={{ color: "var(--teal)", fontWeight: 700, flexShrink: 0 }}
              >
                {onRampOpen ? "–" : "+"}
              </span>
            </button>
            {onRampOpen && (
              <div
                id="on-ramp-details"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: "var(--fg)",
                    lineHeight: 1.7,
                  }}
                >
                  You’re in the right place.
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: "var(--fg)",
                    lineHeight: 1.7,
                  }}
                >
                  <div>Have a passphrase?</div>
                  <div style={{ marginLeft: "16px" }}>
                    Tap <strong>JOIN A ROOM</strong> above, and enter the
                    passphrase. Joining a room is always free.
                  </div>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: "var(--fg)",
                    lineHeight: 1.7,
                  }}
                >
                  <div>Have a link?</div>
                  <div style={{ marginLeft: "16px" }}>
                    Click the link, allow your camera and microphone, and
                    you’re in.
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "8px",
                    alignSelf: "flex-start",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "12px",
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      color: "var(--fg)",
                    }}
                  >
                    More details:
                  </span>
                  <Link
                    href="/invited"
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: "12px",
                      letterSpacing: "2px",
                      textTransform: "uppercase",
                      color: "var(--fg)",
                      textDecoration: "underline",
                      textDecorationColor: "var(--gold)",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    How to join →
                  </Link>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    letterSpacing: "0.2px",
                    color: "var(--fg)",
                    lineHeight: 1.7,
                  }}
                >
                  If you want to{" "}
                  <Link
                    href="/host"
                    style={{
                      color: "var(--fg)",
                      textDecoration: "underline",
                      textDecorationColor: "var(--gold)",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    HOST A ROOM, click here for more information.
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Task #792 — one honest Tor sentence for the worried guest.
            Gated on a baked `.onion` mirror (getOnionMirrorUrl), same as
            the footer OnionMirrorLink: an onion ORIGIN is what triggers
            VOID's relay-only ICE pin, so "reach us at our .onion" is only
            a true claim when this build actually has one. The scope limit
            (not anonymous, doesn't hide you from the other people in the
            room) sits in the same breath as the promise — comfort and
            honesty pull opposite ways here and honesty wins, because the
            reader is making a safety decision. Links to /tor; no inline
            how-to (that drift surface is what prior reviews flagged). */}
        {onionUrl && (
          <section
            aria-label="Worried someone is watching the network?"
            style={{
              width: "100%",
              maxWidth: "440px",
              padding: "0 8px",
              position: "relative",
              left: "12px",
              zIndex: 31,
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                letterSpacing: "0.2px",
                color: "var(--fg)",
                lineHeight: 1.7,
                textAlign: "left",
                margin: 0,
              }}
            >
              Worried someone is watching the network?{" "}
              Reach VOID at its .onion address in Tor Browser — that hides which network you joined from, from our server.{" "}
              It does not make the call anonymous or hide you from the other people in the room.{" "}
              <Link
                href="/tor"
                style={{
                  color: "var(--fg)",
                  textDecoration: "underline",
                  textDecorationColor: "var(--gold)",
                  textUnderlineOffset: "3px",
                }}
              >
                What Tor does and doesn’t cover →
              </Link>
            </p>
          </section>
        )}

      </div>

      {/* ── Install prompt + footer on shared pavement band ──
          The dark surface IS the divider — the inner install card sheds
          its own bg / dashed border so it doesn't read as a card-on-a-card.
          When showInstall is false the band still renders so the footer
          still sits on pavement.
          Same bg (z=0) + content (z=31) split as the hero pavement so
          the Gold Voyager decoratives (gold/orange blocks, red vertical
          rule, teal/red dots) layer ON TOP of the pavement surface but
          under the install copy + footer links. */}
      <section
        aria-label="Install and footer"
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
            backgroundImage: "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
            backgroundSize: "auto, 400px auto",
            backgroundRepeat: "repeat",
            zIndex: 0,
          }}
        />
        <div
          style={{
            position: "relative",
            zIndex: 31,
            padding: "56px 24px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "32px",
          }}
        >
        {showInstall && (
          <div
            data-testid="install-prompt"
            style={{
              fontSize: "12px",
              letterSpacing: "1px",
              color: "var(--gold)",
              lineHeight: "1.8",
              maxWidth: "320px",
              textAlign: "center",
              fontWeight: 700,
              border: "1px solid var(--gold)",
              padding: "14px 18px",
            }}
          >
            <div style={{ color: "var(--burnt)", marginBottom: "6px", letterSpacing: "2px", fontWeight: 700, fontSize: "12px", textTransform: "uppercase" }}>
              INSTALL VOID AS AN APP:
            </div>
            <div style={{ color: "#A89E90", fontWeight: 400, letterSpacing: "0.5px", textTransform: "none" }}>
              Click <span style={{ color: "var(--gold)" }}>“Add to Home Screen”</span> in your browser’s menu.
            </div>
          </div>
        )}

          <PageFooter onPavement />
        </div>
      </section>
    </div>
    </>
  );
}
