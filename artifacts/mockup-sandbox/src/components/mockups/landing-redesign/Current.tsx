import { useState } from "react";
import "./_group.css";

// Static visual replica of the VOID landing page (artifacts/void-client/src/pages/LandingPage.tsx).
// All behavior is stubbed: wouter Link -> <a href="#">, crypto/socket/payment logic stripped,
// getOnionMirrorUrl -> truthy string, showInstall -> true. Pixel-identical at desktop width.

const CONCRETE = "/__mockup/images/concrete.jpeg";

const NAV_LINKS = [
  { label: "WHY", href: "/why" },
  { label: "INVITED?", href: "/invited" },
  { label: "WHY NOT ZOOM", href: "/compare" },
  { label: "THREAT MODEL", href: "/threat-model" },
  { label: "HOW IT WORKS", href: "/how-it-works" },
  { label: "AUDIT", href: "/audit" },
  { label: "BIOMETRIC MASKING", href: "/biometric-masking" },
  { label: "PRICING", href: "/pricing" },
  { label: "LIMITS", href: "/limits" },
];

const toggleBtnStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  background: "var(--surface-dark)",
  border: "1px solid var(--gold)",
  color: "var(--gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "16px",
  letterSpacing: "2px",
  padding: "6px 12px",
  cursor: "pointer",
  textTransform: "uppercase",
};

function HamburgerMenu() {
  const [open, setOpen] = useState(false);
  const [wordsOpen, setWordsOpen] = useState(true);

  return (
    <>
      <button
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "absolute",
          top: "6px",
          right: "6px",
          zIndex: 1000,
          background: "var(--gold)",
          border: "none",
          cursor: "pointer",
          padding: "0",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          alignItems: "center",
          justifyContent: "center",
          width: "30px",
          height: "30px",
        }}
      >
        {open ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "16px",
              color: "var(--surface-dark)",
              lineHeight: 1,
              letterSpacing: 0,
            }}
          >
            ✕
          </span>
        ) : (
          <>
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
            <div style={{ width: "14px", height: "2px", background: "var(--surface-dark)" }} />
          </>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "240px",
            zIndex: 999,
            backgroundColor: "var(--surface-dark)",
            backgroundImage: `linear-gradient(rgba(20,17,13,0.96), rgba(20,17,13,0.96)), url('${CONCRETE}')`,
            backgroundSize: "auto, 400px auto",
            backgroundRepeat: "repeat",
            borderLeft: "3px solid var(--gold)",
            display: "flex",
            flexDirection: "column",
            paddingTop: "72px",
            paddingBottom: "32px",
            paddingLeft: "0",
            paddingRight: "0",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            <button
              type="button"
              aria-expanded={wordsOpen}
              onClick={() => setWordsOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: "16px",
                fontWeight: 700,
                letterSpacing: "3px",
                textTransform: "uppercase",
                color: "var(--gold)",
                padding: "10px 28px",
                borderBottom: "1px solid rgba(232,162,0,0.18)",
              }}
            >
              <span>
                <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
                WORDS
              </span>
              <span aria-hidden="true" style={{ color: "var(--burnt)" }}>
                {wordsOpen ? "▾" : "▸"}
              </span>
            </button>

            {wordsOpen && (
              <div>
                {NAV_LINKS.map((link) => (
                  <a
                    key={link.href}
                    href="#"
                    style={{
                      display: "block",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      fontWeight: 700,
                      letterSpacing: "3px",
                      textTransform: "uppercase",
                      color: "var(--fg-on-dark)",
                      textDecoration: "none",
                      padding: "16px 28px 16px 44px",
                      borderBottom: "1px solid rgba(232,162,0,0.18)",
                      transition: "color 0.1s, background 0.1s",
                    }}
                  >
                    <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <a
            href="#"
            style={{
              display: "flex",
              alignItems: "center",
              width: "100%",
              fontFamily: "var(--font-mono)",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "3px",
              textTransform: "uppercase",
              color: "var(--gold)",
              textDecoration: "none",
              padding: "10px 28px",
              borderBottom: "1px solid rgba(232,162,0,0.18)",
            }}
          >
            <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
            MEDIA
          </a>

          <div
            style={{
              padding: "10px 28px 14px",
              borderTop: "1px solid rgba(232,162,0,0.18)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "3px",
                textTransform: "uppercase",
                color: "#A89E90",
              }}
            >
              <span style={{ color: "var(--burnt)", marginRight: "10px" }}>▌</span>
              PREFERENCES
            </div>
            <button type="button" style={toggleBtnStyle}>
              UI SOUNDS: ON
            </button>
            <button type="button" style={toggleBtnStyle}>
              ALLOW UNMASKED VIDEO
            </button>
            <button type="button" style={toggleBtnStyle}>
              ALLOW UNMASKED VOICE
            </button>
          </div>

          <div
            style={{
              padding: "0 28px",
              fontSize: "12px",
              letterSpacing: "2px",
              color: "#A89E90",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            © 2026 VOID
          </div>
        </div>
      )}

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 998,
            background: "rgba(0,0,0,0.45)",
          }}
        />
      )}
    </>
  );
}

function PageFooter({ onPavement = false }: { onPavement?: boolean }) {
  const textColor = onPavement ? "#A89E90" : "var(--fg-dim)";
  const linkColor = onPavement ? "var(--gold)" : "#B84A00";
  return (
    <div
      style={{
        padding: "24px 16px 24px",
        textAlign: "center",
        fontSize: "12px",
        color: textColor,
        letterSpacing: "2px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <div style={{ fontSize: "11px", color: textColor, letterSpacing: "1px", maxWidth: "32rem" }}>
        AGPLV3 · §13: THE EXACT BUILD RUNNING HERE IS VERIFIABLE BELOW
      </div>
      <div>
        <a href="#" style={{ color: linkColor, textDecoration: "none", letterSpacing: "2px" }}>
          LAW ENFORCEMENT →
        </a>
      </div>
      <div>
        <a href="#" style={{ color: linkColor, textDecoration: "none", letterSpacing: "2px" }}>
          DOCS →
        </a>
      </div>
      <div
        style={{
          marginTop: "4px",
          maxWidth: "440px",
          fontSize: "11px",
          letterSpacing: "1px",
          lineHeight: 1.7,
          color: "color-mix(in srgb, currentColor 85%, transparent)",
        }}
      >
        P2P · no accounts · no room content stored · opens from a link · E2E encrypted · ephemeral
        keys · AGPLv3 · © 2026 VOID
      </div>
    </div>
  );
}

// Reproduces StartScreen's rendered chromeless markup (HOST / JOIN / RECOVER
// controls). All handlers are no-ops; only the default (!joinMode && !recoverMode)
// view is rendered since that is the landing default.
function StartScreen() {
  return (
    <div
      style={{
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          gap: "24px",
          position: "relative",
          zIndex: 20,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "340px" }}>
          <button
            className="void-btn void-btn--gold active"
            style={{ width: "100%", fontSize: "16px", padding: "18px", letterSpacing: "2px" }}
          >
            HOST A ROOM
          </button>
          <button
            className="void-btn void-btn--teal active"
            style={{ width: "100%", fontSize: "16px", padding: "18px", letterSpacing: "2px" }}
          >
            JOIN A ROOM
          </button>
          <button
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: "16px",
              padding: "4px 10px",
              marginTop: "4px",
              cursor: "pointer",
              letterSpacing: "2px",
              textDecoration: "underline",
              textUnderlineOffset: "3px",
              alignSelf: "center",
            }}
          >
            RECOVER A PAID ROOM
          </button>
        </div>
      </div>
    </div>
  );
}

export function Current() {
  const [onRampOpen, setOnRampOpen] = useState(false);
  const onionUrl = "http://voidexampleonionaddress.onion/";
  const showInstall = true;

  return (
    <div
      className="void-landing-root"
      style={{
        minHeight: "100svh",
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
      {/* ── Decorative background layer ── */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: 0, left: 0, width: "260px", height: "230px", background: "rgba(232,162,0,0.82)", zIndex: 1, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "-125px", left: "230px", width: "200px", height: "160px", background: "rgba(200,90,0,0.485)", zIndex: 2, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "220px", right: 0, width: "33px", height: "460px", background: "rgba(90,82,72,0.35)", zIndex: 1, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 0, left: 0, width: "110px", height: "100px", background: "rgba(232,162,0,0.5)", clipPath: "polygon(0 0, 0 100%, 100% 100%)", zIndex: 2, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "230px", left: 0, width: "14px", height: "220px", background: "rgba(240,184,0,0.975)", zIndex: 4, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: "112px", width: "3px", background: "rgba(204,34,0,0.45)", zIndex: -1, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "0", right: "18px", width: "90px", height: "200px", background: "rgba(212,160,64,0.22)", zIndex: 1, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "92px", right: "8px", width: "16px", height: "16px", background: "rgba(13,157,139,0.9)", zIndex: 30, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "280px", right: "36px", width: "10px", height: "10px", background: "rgba(204,34,0,0.7)", zIndex: 30, pointerEvents: "none" }} />
        <div style={{ position: "absolute", left: "112px", right: 0, bottom: "178px", height: "2px", background: "rgba(232,162,0,0.5)", zIndex: 5, pointerEvents: "none" }} />
        <div className="landing-haze" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "32px", width: "100%" }}>
        {/* ── Brand header card ── */}
        <div
          style={{
            textAlign: "center",
            width: "100%",
            padding: "32px 24px 28px",
            backgroundColor: "var(--surface-dark)",
            backgroundImage: `linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('${CONCRETE}')`,
            backgroundSize: "auto, 400px auto",
            backgroundRepeat: "repeat",
            position: "relative",
            zIndex: 10,
          }}
        >
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
          <div
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

        {/* ── Three-line tagline + kicker ── */}
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

        {/* ── Embedded HOST / JOIN / RECOVER controls (StartScreen chromeless) ── */}
        <StartScreen />

        {/* Spear-tip thesis */}
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
            No action is required to protect your privacy here. Privacy is the default.
          </p>
        </div>

        {/* ── Plain-language "is this for me?" on-ramp ── */}
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
              aria-expanded={onRampOpen}
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
              <span aria-hidden="true" style={{ width: "1ch", flexShrink: 0, visibility: "hidden" }}>
                {onRampOpen ? "–" : "+"}
              </span>
              <span style={{ flex: 1, textAlign: "center" }}>New here? Or were you sent a link?</span>
              <span aria-hidden="true" style={{ color: "var(--teal)", fontWeight: 700, flexShrink: 0 }}>
                {onRampOpen ? "–" : "+"}
              </span>
            </button>
            {onRampOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", letterSpacing: "0.2px", color: "var(--fg)", lineHeight: 1.7 }}>
                  You’re in the right place.
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", letterSpacing: "0.2px", color: "var(--fg)", lineHeight: 1.7 }}>
                  <div>Have a passphrase?</div>
                  <div style={{ marginLeft: "16px" }}>
                    Tap <strong>JOIN A ROOM</strong> above, and enter the passphrase. Joining a room is
                    always free.
                  </div>
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", letterSpacing: "0.2px", color: "var(--fg)", lineHeight: 1.7 }}>
                  <div>Have a link?</div>
                  <div style={{ marginLeft: "16px" }}>
                    Click the link, allow your camera and microphone, and you’re in.
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px", alignSelf: "flex-start" }}>
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
                  <a
                    href="#"
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
                  </a>
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: "13px", letterSpacing: "0.2px", color: "var(--fg)", lineHeight: 1.7 }}>
                  If you want to{" "}
                  <a
                    href="#"
                    style={{
                      color: "var(--fg)",
                      textDecoration: "underline",
                      textDecorationColor: "var(--gold)",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    HOST A ROOM, click here for more information.
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Tor sentence (gated on onion mirror) */}
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
              Worried someone is watching the network? Reach VOID at its .onion address in Tor Browser
              — that hides which network you joined from, from our server. It does not make the call
              anonymous or hide you from the other people in the room.{" "}
              <a
                href="#"
                style={{
                  color: "var(--fg)",
                  textDecoration: "underline",
                  textDecorationColor: "var(--gold)",
                  textUnderlineOffset: "3px",
                }}
              >
                What Tor does and doesn’t cover →
              </a>
            </p>
          </section>
        )}
      </div>

      {/* ── Install prompt + footer on shared pavement band ── */}
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
            backgroundImage: `linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('${CONCRETE}')`,
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
                Click <span style={{ color: "var(--gold)" }}>“Add to Home Screen”</span> in your
                browser’s menu.
              </div>
            </div>
          )}

          <PageFooter onPavement />
        </div>
      </section>
    </div>
  );
}
