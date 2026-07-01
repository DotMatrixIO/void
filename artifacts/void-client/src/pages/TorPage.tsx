// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import OnionMirrorLink from "@/components/OnionMirrorLink";
import { sectionStyle as cardStyle } from "@/components/longFormStyles";

// The IP-hiding / Tor walkthrough, split off the /invited guest on-ramp so
// each page does one job. Voice follows the /why register: short sentences,
// second person, plain words. Accurate to the `Onion-Location` auto-prompt
// UX. No media-over-Tor claim — Tor hides the IP you reach VOID from, not
// the WebRTC media path between peers.
//
// Presentation matches the long-form /how-it-works page: the dark concrete
// card from longFormStyles, gold display heading, burnt mono sub-heads, and
// light serif body on the dark surface (--fg-on-dark).

const columnStyle: React.CSSProperties = {
  ...cardStyle,
  margin: "0 auto",
  display: "flex",
  flexDirection: "column",
  gap: "28px",
};

const headingStyle: React.CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontWeight: 400,
  fontSize: "clamp(32px, 8vw, 36px)",
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "var(--gold)",
  lineHeight: 1.05,
  margin: 0,
};

const subheadingStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "2px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  margin: 0,
};

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: "16px",
  lineHeight: 1.85,
  color: "var(--fg-on-dark)",
  margin: 0,
};

const dimStyle: React.CSSProperties = {
  ...bodyStyle,
  color: "#9C8E7A",
};

const sectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const stepListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "16px",
};

const stepItemStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  alignItems: "flex-start",
};

const stepNumStyle: React.CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontSize: "22px",
  lineHeight: 1.1,
  color: "var(--burnt)",
  minWidth: "24px",
  textAlign: "right",
};

const inlineLinkStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  textDecoration: "underline",
  textDecorationColor: "var(--teal)",
  textUnderlineOffset: "2px",
};

const stepActionStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  fontWeight: 700,
};

export default function TorPage() {
  return (
    <PageShell backHref="/invited" backLabel="← INVITED">
      <div style={columnStyle}>
        <h1 style={headingStyle}>Hide your IP Address with Tor.</h1>

        <p style={bodyStyle}>
          By default, the server can see the IP address you connect from. Tor
          closes that gap. If a .onion mirror is available, it closes the gap
          completely. Your connection terminates inside the Tor network, and no
          IP address for you arrives at the server at all.
        </p>

        <p style={bodyStyle}>
          If you want to reach VOID without the server learning where you are,
          take these three steps:
        </p>

        {/* Tor walkthrough — accurate to the Onion-Location auto-prompt UX. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>Reaching VOID over Tor</h2>
          <ol style={stepListStyle}>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                1
              </span>
              <p style={bodyStyle}>
                <span style={stepActionStyle}>Install Tor Browser.</span> Get it
                from the official Tor Project page:{" "}
                <a
                  href="https://www.torproject.org/download/"
                  rel="noopener noreferrer"
                  target="_blank"
                  style={inlineLinkStyle}
                >
                  torproject.org/download
                </a>
                . Don’t download it from anywhere else.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                2
              </span>
              <p style={bodyStyle}>
                <span style={stepActionStyle}>Open VOID in Tor Browser.</span> If
                a{" "}
                <span style={stepActionStyle}>
                  .onion
                </span>{" "}
                address is available, Tor Browser shows a button or notice in the
                address bar offering to switch to it. Use it to switch to the
                .onion version.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                3
              </span>
              <p style={bodyStyle}>
                <span style={stepActionStyle}>Join the room</span> the same way
                you would in any other browser.
              </p>
            </li>
          </ol>
        </div>

        {/* Media-path limit — what Tor does and does not cover. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>What Tor does not cover</h2>
          <p style={bodyStyle}>
            Tor hides your IP address from the VOID servers. It does not hide the
            IP address attached to the video and audio in the VOID call. Your
            video and audio travel separately, between you and the other people
            in the room, over your normal network. This means the people in the
            room can still see each other’s IP addresses. If that matters to you,
            ask the host to turn on “relay-only”, which routes the call through a
            relay instead. Calls will feel slower that way, but they will be
            slightly more private. Tor was not built for live video.
          </p>
          <p style={bodyStyle}>
            Note: a VPN will not give you the same privacy level as Tor. A VPN
            hides your IP address from the server by asking you to trust a VPN
            company, and it does nothing to hide your IP address from the people
            on the call. If you want to hide your IP address from people on the
            call, ask the host to turn the “relay-only” switch on.
          </p>
        </div>

        {/* If this deployment publishes an .onion mirror, surface it here. */}
        <div style={sectionStyle}>
          <OnionMirrorLink />
        </div>

        <p style={dimStyle}>
          New to all this?{" "}
          <Link href="/invited" style={inlineLinkStyle}>
            How to join a room
          </Link>
          . Want the longer story?{" "}
          <Link href="/threat-model" style={inlineLinkStyle}>
            Read the threat model
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}
