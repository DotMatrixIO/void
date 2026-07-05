// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import { sectionStyle as cardStyle } from "@/components/longFormStyles";

// Host walkthrough — for the person opening a room and running the call.
// Split off the /invited guest on-ramp so each page does one job. Voice
// follows the /why register: short sentences, second person, plain words.
// Pricing amounts are NOT restated here — the server is the source of
// truth and /pricing owns the numbers. This page links there.
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

const docLinkStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  textDecoration: "underline",
  textDecorationColor: "var(--gold)",
  textUnderlineOffset: "3px",
};

/** Absolute URL of this VOID deployment's guest walkthrough, for sharing. */
function getInvitedUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const base = import.meta.env.BASE_URL || "/";
    return new URL(`${base}invited`, window.location.origin).href;
  } catch {
    return `${window.location.origin}/invited`;
  }
}

export default function HostPage() {
  const inviteUrl = useMemo(() => getInvitedUrl(), []);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Restricted clipboard contexts (no gesture, insecure origin,
      // permissions policy) reject the write. Surface the raw URL so it
      // can be selected and copied by hand.
      setCopied(false);
      setCopyFailed(true);
    }
  }, [inviteUrl]);

  return (
    <PageShell>
      <div style={columnStyle}>
        <h1 style={headingStyle}>Host a room.</h1>

        <p style={bodyStyle}>
          You open the room, pay once, and run the call. There’s no account or
          anything to install. When you’re done, the room burns down, and nothing
          about it is kept.
        </p>

        {/* PAY → OPEN → SHARE → RUN THE CALL */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>How hosting works</h2>
          <ol style={stepListStyle}>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                1
              </span>
              <p style={bodyStyle}>
                <span style={strongStyle}>Pay.</span>{" "}
                Opening a room costs one small Lightning payment, paid once, with
                no subscription. You choose how long the room lasts (1 hour or 24
                hours) when you pay. See{" "}
                <Link href="/pricing" style={docLinkStyle}>
                  pricing
                </Link>{" "}
                for current amounts.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                2
              </span>
              <p style={bodyStyle}>
                <span style={strongStyle}>
                  Open.
                </span>{" "}
                Once the payment clears, the room opens. You get a link and six
                words. Either one lets in your guests.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                3
              </span>
              <p style={bodyStyle}>
                <span style={strongStyle}>
                  Share.
                </span>{" "}
                Send the link to your guests, or share the six words. A room holds
                up to four people including you — so up to three guests. Joining
                is free for them.
              </p>
            </li>
            <li style={stepItemStyle}>
              <span style={stepNumStyle} aria-hidden="true">
                4
              </span>
              <p style={bodyStyle}>
                <span style={strongStyle}>
                  Run the call.
                </span>{" "}
                Each user on the call should see two words next to the video of
                each other user. Encourage everyone to read them aloud. Almost
                always, the words will match, signaling that you’re all connected
                to the right people, with no one in the middle of your call. If
                the words don’t match, someone may be listening. We advise burning
                the call and starting over if that happens (this should almost
                never happen). A countdown shows how much time the room has left.
              </p>
            </li>
          </ol>
        </div>

        {/* Privacy controls a host owns during the call. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>Your controls during the call</h2>
          <p style={bodyStyle}>
            You have a few controls while the call is running.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>Lock the room.</span>{" "}
            Once everyone you’re expecting has arrived, lock the room. This
            ensures that no one else can join, even using the link or passphrase.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>
              Admit by knock.
            </span>{" "}
            Turn on knock-to-enter, and new arrivals will wait outside the room
            until you admit or deny each one.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>
              Relay-only.
            </span>{" "}
            By default, video and audio travel directly between people in the
            room — which means everyone in the room can learn each other’s IPs.
            Turn on relay-only to route the call through a relay instead. The call
            may feel slightly slower, but no one in the room will be able to see
            anyone else’s IP address. Anyone can ask for this; you decide whether
            to switch it on.
          </p>
          <p style={bodyStyle}>
            <span style={strongStyle}>Burn it.</span>{" "}
            Anyone in the room can end the call. Burning destroys the room for
            everyone at once. The app is incapable of recording or creating a
            transcript, so if someone burns the call, there’s nothing left to
            delete.
          </p>
          <p style={dimStyle}>
            Drop off or refresh by accident? Open the same link, or enter the
            same six words, to come back as the host — no second payment.
          </p>
        </div>

        {/* Lightning + wallet — required external references. */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>Paying with Lightning</h2>
          <p style={bodyStyle}>
            You pay for VOID over the{" "}
            <a
              href="https://en.wikipedia.org/wiki/Lightning_Network"
              rel="noopener noreferrer"
              target="_blank"
              style={inlineLinkStyle}
            >
              Lightning Network
            </a>{" "}
            — a fast, low-fee way to send tiny Bitcoin payments. One payment per
            room without using cards, accounts, or recurring charges.
          </p>
          <p style={bodyStyle}>
            If you don’t have a Lightning wallet yet, Aqua is a free phone wallet
            that’s beginner-friendly. This walkthrough shows how to set it up:{" "}
            <a
              href="https://www.youtube.com/watch?v=x3Q9mEdelK4"
              rel="noopener noreferrer"
              target="_blank"
              style={inlineLinkStyle}
            >
              Understanding Aqua Wallet (YouTube)
            </a>
            .
          </p>
        </div>

        {/* Host-facing share affordance. Points OUTWARD — the host sends the
            guest walkthrough to the guest — unlike the in-room share sheet,
            which shares the join link/phrase. Pinned literals (heading +
            caption) live in scripts/check-required-literals.mjs (#9). */}
        <div style={sectionStyle}>
          <h2 style={subheadingStyle}>
            Hosting someone? Send them this page ahead of the call
          </h2>
          <p style={bodyStyle}>
            New guests do better with a heads-up. Copy the guest walkthrough, and
            send it before you meet — it shows them how to join.
          </p>
          <button
            type="button"
            onClick={handleCopy}
            data-testid="host-copy-invite-link"
            style={{
              alignSelf: "flex-start",
              background: "transparent",
              border: "1px solid var(--teal)",
              color: "var(--fg-on-dark)",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "2px",
              textTransform: "uppercase",
              padding: "12px 18px",
              cursor: "pointer",
            }}
          >
            {copied ? "Link copied" : "Copy guest walkthrough link"}
          </button>
          {copyFailed && (
            <input
              type="text"
              readOnly
              value={inviteUrl}
              data-testid="host-copy-fallback"
              aria-label="Guest walkthrough link (copy failed — select manually)"
              ref={(el) => {
                if (el) {
                  el.focus();
                  el.select();
                }
              }}
              style={{
                fontSize: "16px",
                color: "var(--fg-on-dark)",
                letterSpacing: "1px",
                border: "1px solid var(--teal)",
                padding: "8px 10px",
                fontFamily: "var(--font-mono)",
                background: "transparent",
                maxWidth: "min(80vw, 420px)",
                minWidth: "200px",
              }}
            />
          )}
          <p style={{ ...dimStyle, fontSize: "12px" }}>
            {"Copies the link to the guest walkthrough so you can send it to your guest."}
          </p>
        </div>

        <p style={dimStyle}>
          Just here to join? See{" "}
          <Link href="/invited" style={inlineLinkStyle}>
            how to join a room
          </Link>
          . Want to hide your IP?{" "}
          <Link href="/tor" style={inlineLinkStyle}>
            Use Tor
          </Link>
          .
        </p>
      </div>
    </PageShell>
  );
}
