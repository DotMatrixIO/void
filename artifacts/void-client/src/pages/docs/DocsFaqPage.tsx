// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle,
  dividerStyle,
  tealText,
  goldText,
  linkStyle,
} from "@/components/longFormStyles";

// Task #575 split-out. The six known failure modes + per-mode recovery
// paths used to live inside /docs/limits under a "WHAT TO EXPECT"
// subhead. They are technical-support questions, not part of the
// positioning brief that /docs/limits carries (what VOID is not for,
// the captions decision, etc.), so they belong on their own FAQ page.
// Reached from the /docs index. (Task #577 removed the short-form
// /limits page; FAQ discoverability now flows through /docs only.)

const failureLabelStyle: React.CSSProperties = {
  ...sectionHeadingStyle,
  fontSize: "12px",
  marginTop: "0",
  marginBottom: "4px",
};

export default function DocsFaqPage() {
  return (
    <PageShell backHref="/docs" backLabel="← BACK TO DOCS">
      {/* Opening */}
      <div style={sectionStyle}>
        <div style={headingStyle}>FAQ</div>
        <div
          style={{
            ...headingStyle,
            color: "var(--teal)",
            fontSize: "clamp(14px, 3vw, 18px)",
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            marginBottom: "28px",
          }}
        >
          Technical questions.
        </div>

        <p style={{ marginBottom: "16px" }}>
          Real things break. Here are the failures we know about, and what
          to do about each one.
        </p>
        <p style={{ marginBottom: "0" }}>
          For what VOID is and is not for, see{" "}
          <Link href="/docs/limits" style={linkStyle}>
            /docs/limits
          </Link>
          .
        </p>
      </div>

      <div style={dividerStyle} />

      {/* WHAT TO EXPECT — failure modes */}
      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> WHAT TO EXPECT
        </div>

        {/* Lightning paid but no room */}
        <p style={failureLabelStyle}>
          LIGHTNING INVOICE PAID, BUT THE ROOM DOES NOT APPEAR
        </p>
        <p style={{ marginBottom: "16px" }}>
          Sometimes the Lightning invoice is paid but the room doesn’t appear.
          When that happens, the time window is still good. Note — the PAID
          screen shows a one-time recovery code, four words, and we tell you
          it is your only chance to write it down. If you wrote it down, open
          the start screen and use{" "}
          <span style={tealText}>RECOVER A PAID ROOM</span> to redeem it. If
          you did not write it down, the unused window is gone. We do not keep
          it for you. So, you will have to pay again.
        </p>

        {/* Peer connection drops */}
        <p style={failureLabelStyle}>
          PEER CONNECTION DROPS MID-CALL
        </p>
        <p style={{ marginBottom: "16px" }}>
          A peer can fall off the call for seemingly no reason — networks do
          this. The room itself is fine and stays open for the rest of its
          paid window. The peer who dropped should reload the same link — the
          URL should put them back in the same room. If reconnecting keeps
          failing, the host can toggle{" "}
          <span style={tealText}>RELAY-ONLY</span> mode, which sends every
          packet through the TURN server and works in places where direct
          peer-to-peer does not. It costs a little latency.
        </p>

        {/* Timer fires mid-conversation */}
        <p style={failureLabelStyle}>
          THE 65-MINUTE TIMER FIRES MID-CONVERSATION
        </p>
        <p style={{ marginBottom: "16px" }}>
          A standard room lasts 65 minutes from creation. When the window
          ends, the room ends. If the conversation has more to do, the host
          can pay again and start a new room with a new phrase. If you know in
          advance the conversation will run longer, the DAY tier gives you a
          24-hour window for the same room.
        </p>

        {/* Wrong phrase entered */}
        <p style={failureLabelStyle}>
          WRONG PHRASE ENTERED
        </p>
        <p style={{ marginBottom: "16px" }}>
          A wrong phrase does not produce a clear error. The signaling looks
          like it is connecting and then never finishes — your tile sits at{" "}
          <span style={tealText}>SECURING…</span> or the call simply does not
          form. This is by design: the server cannot tell “wrong phrase” from
          “no peer yet” without leaking which rooms exist. Check every word
          against the source you got it from. The wordlist is fixed (BIP-39),
          so a typo on a word in the wordlist will be caught at input. A word
          that is on the wordlist, but not the right word, will not.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you and a peer somehow reach the same room ID with different
          phrases (for example, if a host-shared link was corrupted), VOID
          will show a bright red overlay:{" "}
          <span style={{ color: "var(--red)", fontWeight: 700 }}>
            WE CAN’T DECRYPT THIS PEER’S MESSAGES
          </span>
          . That is the louder form of the same problem. First, hit{" "}
          <span style={tealText}>RETRY SECURE CHANNEL</span> once. If the
          error reappears after retry, leave the room immediately — no audio
          or video has leaked, but the room is likely compromised.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Compare the phrase word by word against the original source — not
          copy-paste, eyes on each word.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If the phrase matches perfectly on both sides and the error still
          came back: do not rejoin the same room. Generate a new room and
          share the new phrase through a different channel than you used the
          first time (if you used SMS, use Signal; if you used Signal, use a
          phone call, etc.).
        </p>
        <p style={{ marginBottom: "16px" }}>
          The old room ID is now suspect. Even if you fix the phrase, a
          persistent failure suggests an active third party in your signaling
          path.
        </p>

        {/* Browser permissions denied */}
        <p style={failureLabelStyle}>
          BROWSER PERMISSIONS DENIED
        </p>
        <p style={{ marginBottom: "16px" }}>
          If the browser blocks camera or microphone access, VOID has nothing
          to send. The browser remembers this choice per site, so re-asking
          inside the page will not help. Open your browser’s site settings for
          this domain, set camera and microphone to{" "}
          <span style={tealText}>ALLOW</span>, and reload. On a phone, the
          same applies in the operating system’s app permissions.
        </p>

        {/* OS screen-share permission denied */}
        <p style={failureLabelStyle}>
          OPERATING SYSTEM SCREEN-SHARE PERMISSION DENIED
        </p>
        <p style={{ marginBottom: "0" }}>
          On macOS, Windows, and most Linux desktop environments, screen
          sharing requires a separate operating-system-level permission
          beyond what the browser asks for. If you click{" "}
          <span style={tealText}>SCREEN</span> and the picker never appears or
          the share immediately ends, the OS is the one saying no. Open
          system settings, find the screen-recording permission for your
          browser, turn it on, then quit and relaunch the browser. The browser
          must be fully restarted for the change to take effect.
        </p>
      </div>
    </PageShell>
  );
}
