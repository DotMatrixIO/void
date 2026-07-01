// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import { sectionStyle as cardStyle } from "@/components/longFormStyles";

// A plain-language on-ramp for the person who was handed a VOID link and
// just wants to get into the call. Voice follows the /why register: short
// sentences, second person, plain words. No fiat path — joining is free,
// only hosting costs sats. The host walkthrough lives on /host and the
// IP-hiding / Tor walkthrough lives on /tor; this page is the guest's
// join path only.
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

const strongStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  fontWeight: 700,
};

const inlineLinkStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  textDecoration: "underline",
  textDecorationColor: "var(--teal)",
  textUnderlineOffset: "2px",
};

export default function InvitedPage() {
  return (
    <PageShell>
      <div style={columnStyle}>
        <h1 style={headingStyle}>Welcome.</h1>

        <p style={bodyStyle}>Someone invited you to use VOID.</p>

        <p style={bodyStyle}>
          You don’t need an account and there’s nothing to install. There are two
          ways in.
        </p>

        {/* Path 1 — the join link. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>If you have a link</h2>
          <ol style={stepListStyle}>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                1
              </span>
              <p style={bodyStyle}>
                Open the link in your browser. On a phone, tap the link.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                2
              </span>
              <p style={bodyStyle}>
                Allow camera and microphone when your browser asks. The call
                needs both to work.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                3
              </span>
              <p style={bodyStyle}>
                Check yourself in the preview. Pick a mask for your face or voice
                if you want a mask. Then press ENTER. You’re in the room.
              </p>
            </li>
          </ol>
        </div>

        {/* Path 2 — the six-word passphrase. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>If you have six words</h2>
          <p style={bodyStyle}>
            Some hosts share a passphrase instead of a link. The password is six
            plain words, and they open the same room in a different way.
          </p>
          <ol style={stepListStyle}>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                1
              </span>
              <p style={bodyStyle}>
                Go to the VOID home page, and choose <strong>JOIN A ROOM</strong>.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                2
              </span>
              <p style={bodyStyle}>
                Type the six words in order. Then allow your camera and
                microphone.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                3
              </span>
              <p style={bodyStyle}>
                Check the preview, and press ENTER.
              </p>
            </li>
          </ol>
        </div>

        {/* Free to join. No fiat path; only hosting needs sats. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>Joining is free</h2>
          <p style={bodyStyle}>
            You pay nothing to join. The host already paid a small amount to
            open the room.
          </p>
        </div>

        {/* What to expect once inside the room. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>What to expect in the room</h2>
          <p style={bodyStyle}>
            A room holds up to four people, including you. It’s a live call, and
            the app is incapable of recording or creating a transcript.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>
              Two words to check.
            </span>{" "}
            When you connect, you and each of the other attendees will see two
            words next to each other’s video. Compare them — if they match, tap
            WORDS MATCH. That’s how you know no one is sitting in the middle of
            the call. If they don’t match, tap DON’T MATCH and hang up.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>
              A countdown.
            </span>{" "}
            The room lasts as long as the host paid for. A timer shows how much is
            left and warns before it ends.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>
              Leaving and burning.
            </span>{" "}
            You can leave whenever you want. Anyone in the room can also burn the
            call — that ends the call for everyone at once, and the room can’t be
            re-used.
          </p>
        </div>

        <p style={dimStyle}>
          Want to hide your IP from the server?{" "}
          <Link href="/tor" style={inlineLinkStyle}>
            Use Tor
          </Link>
          . Setting up your own call? See{" "}
          <Link href="/host" style={inlineLinkStyle}>
            how to host a room
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}
