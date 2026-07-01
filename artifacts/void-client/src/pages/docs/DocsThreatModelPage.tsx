// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, useEffect, type ReactNode } from "react";
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import OpenBetaCaption from "@/components/OpenBetaCaption";
import OnionMirrorLink from "@/components/OnionMirrorLink";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  dividerStyle,
  tealText,
  goldText,
  burntText,
} from "@/components/longFormStyles";
// Task #550. Long-form THREAT MODEL prose relocated here from
// /threat-model. The short bullets now own /threat-model; this is
// where deep links to specific long sections (#lightning-ip-leak,
// #tor-wallet-shortlist, #browser-level-surfaces, #supply-chain) land
// — both directly and via the client-side redirect from
// /threat-model#<anchor>.
// Canonical §3.5 server-observable block. Single source of truth shared
// with VOID_TECHNICAL_OVERVIEW.md (spliced in by
// artifacts/void-client/scripts/sync-server-observable.mjs at build time).
// Drift is caught by check:server-observable-sync in marketing-voice CI.
import serverObservableMd from "@docs/_fragments/server-observable.md?raw";
import { REPO_URL } from "@/lib/repo";

// All body content on this page is rendered inside `sectionStyle` blocks
// (the #14110D concrete cards). The accent colors used for inline emphasis
// throughout the page (--gold for <code> spans and link text, --teal/--burnt
// for callouts, --red for the "NOT PROTECTED" line) all clear AA on this
// dark surface:
//   --gold  on #14110D = 8.60:1
//   --teal  on #14110D = 5.57:1
//   --burnt on #14110D = 4.41:1 (exempted as an ornament in
//                                 docs/contrast-audit.md)
//   --red   on #14110D = 3.40:1 (exempted as a status-flag glyph; the
//                                 sibling --burnt arrow + uppercase label
//                                 carry the meaning).
// A new accent-on-light usage on this page (rendered outside `sectionStyle`)
// would land on --bg = #BEB3A2 and fail body AA — those must be wrapped in
// `sectionStyle`, recolored to --fg with the accent as
// border/underline, or carry a per-instance
// /* contrast-exception: <reason> */ comment per docs/contrast-audit.md.
const redText: React.CSSProperties = { color: "var(--red)" };

const closingLineStyle: React.CSSProperties = {
  marginBottom: "0",
  fontStyle: "italic",
  color: "#9C8E7A",
};

/**
 * Render the canonical §3.5 server-observable markdown fragment as styled
 * JSX. Deliberately minimal — only the markdown features used by the
 * fragment are implemented (h4 headings, bullet lists, paragraphs, and
 * inline `**bold**` / `*italic*` / `` `code` ``). This keeps the page
 * style consistent with the rest of ThreatModelPage without pulling in a
 * full markdown renderer, and lets the fragment serve as the single
 * source of truth for both this surface and VOID_TECHNICAL_OVERVIEW.md.
 */
function renderInlineMarkdown(text: string): ReactNode {
  // Tokenize on `**bold**`, `*italic*`, and `` `code` `` — the only three
  // inline markers the §3.5 fragment uses.
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={`md-${key++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(
        <code
          key={`md-${key++}`}
          /* contrast-exception: this helper only renders inside ThreatModelPage
             sections, which all wrap their content in the #14110D `sectionStyle`
             card. --gold on #14110D is 8.60:1 (AA pass for body). The same
             inline-style color appears at every other <code> use site on this
             page for the same reason — see the section-level surface note at
             the top of the file. */
          style={{ color: "var(--gold)" }}
        >
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={`md-${key++}`}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function ServerObservableProse({ source }: { source: string }) {
  // Split on blank lines into blocks. Each block is either an h4 heading
  // (`#### …`), a bullet list (contiguous lines starting with `- `), or a
  // paragraph.
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (trimmed.startsWith("#### ")) {
          return (
            <p
              key={i}
              style={{ ...subheadingStyle, fontSize: "12px", marginTop: i === 0 ? "0" : "20px", marginBottom: "8px" }}
            >
              {renderInlineMarkdown(trimmed.slice(5))}
            </p>
          );
        }
        if (trimmed.startsWith("- ")) {
          const items = trimmed.split(/\n(?=- )/).map((line) => line.replace(/^- /, ""));
          return (
            <ul
              key={i}
              style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
            >
              {items.map((item, j) => (
                <li key={j} style={{ marginBottom: "8px" }}>
                  <span style={burntText}>→</span>{" "}
                  {renderInlineMarkdown(item.replace(/\s+/g, " ").trim())}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ marginBottom: "16px" }}>
            {renderInlineMarkdown(trimmed.replace(/\s+/g, " "))}
          </p>
        );
      })}
    </>
  );
}

const protectedStyle: React.CSSProperties = {
  color: "var(--teal)",
  fontWeight: 700,
  letterSpacing: "1px",
};

const notProtectedStyle: React.CSSProperties = {
  color: "var(--red)",
  fontWeight: 700,
  letterSpacing: "1px",
};

const partialStyle: React.CSSProperties = {
  color: "var(--gold)",
  fontWeight: 700,
  letterSpacing: "1px",
};

export default function DocsThreatModelPage() {
  // In-app deep links (e.g. the footer .onion switch → #how-void-surfaces-the-
  // onion-path, the /proof/runtime posture block → #verify-the-posture) arrive
  // via a wouter soft navigation that swaps the route without scrolling and
  // never fires the browser's native hash-jump. Read the hash on mount and
  // scroll the target section into view ourselves. Deferred to the next frame
  // so it runs after App's ScrollToTop has reset to the top.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;
    const id = decodeURIComponent(hash.slice(1));
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <PageShell backHref="/threat-model" backLabel="← BACK TO SHORT VERSION">
      {/* v0.5 / open beta acknowledgement — sits under the hamburger
          in the normal scrollable flow (not sticky). The won't-fix
          section below already references v0.5; this caption keeps
          the framing consistent with the landing page. Pinned by
          __tests__/v05OpenBetaLabel.test.tsx. */}
      <OpenBetaCaption data-testid="threat-model-v05-acknowledgement" />

      {/* Opening — Howard */}
      <div style={sectionStyle}>
        <div style={headingStyle}>
          THE VOID THREAT MODEL
        </div>
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
          What we protect you from.
          <br />
          And what we don’t.
        </div>

        <p style={{ marginBottom: "16px" }}>
          A man named Howard bought a lock for his door. It was a good lock.
          The best lock his money could buy.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Howard felt safe.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Howard’s neighbor, who had watched Howard leave for work at 8:47 a.m.
          for three years, waited until 8:48 a.m., and came through the window.
        </p>
        <p style={{ marginBottom: "0" }}>
          A lock is not a force field. A lock is a lock, and it does what it
          does. It doesn’t do what it doesn’t do.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What a Threat Model Is */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT A THREAT MODEL IS
        </div>
        <p style={{ marginBottom: "16px" }}>
          A threat model answers this question: “what, exactly, does this
          system protect you from, and what, exactly, does it not?”
        </p>
        <p style={{ marginBottom: "16px" }}>
          Most companies do not publish threat models, because threat models
          require admitting limitations, and admitting limitations is
          uncomfortable when you are trying to sell a thing.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We are trying to sell a thing.
        </p>
        <p style={{ marginBottom: "0" }}>
          That said, we would rather you understand VOID correctly than
          misunderstand it dangerously.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* The People Trying to Get In */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE PEOPLE TRYING TO GET IN
        </div>
        <p style={{ marginBottom: "24px" }}>
          Security people call these folks threat actors.
        </p>

        {/* The Corporation */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE CORPORATION
        </p>
        <p style={{ marginBottom: "16px" }}>
          The most common spy isn’t a spy. It is a business.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Businesses collect data about you because data is money. Your face
          and your voice and your patterns of communication and who you talk
          to and when and for how long — all of this is worth something to
          someone. It is fed into models. It is bought and sold and used to
          show you advertisements for things you discussed in private.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The corporation is not malicious like a villain. It is simply doing
          what corporations do, which is to extract value, in this case, from
          you.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID is designed primarily to stop this. We explain how below.
        </p>

        {/* The Subpoena */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE SUBPOENA
        </p>
        <p style={{ marginBottom: "16px" }}>
          A government or a lawyer may ask a tech company to hand over records.
          Companies with records hand them over, because the alternative is
          jail, and executives often prefer not jail.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID has no identifying records to hand over.
        </p>

        {/* The Bulk Collector */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE BULK COLLECTOR
        </p>
        <p style={{ marginBottom: "16px" }}>
          Somewhere, large systems are recording large amounts of internet
          traffic. This is not a conspiracy theory. It is a matter of public
          record, thanks to a man named Edward Snowden who gave up a great deal
          to make it so.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID encrypts everything that matters before it leaves your device.
          So, the bulk collector would see only noise.
        </p>

        {/* The Man in the Middle */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE MAN IN THE MIDDLE
        </p>
        <p style={{ marginBottom: "16px" }}>
          A sufficiently motivated attacker can position themselves between you
          and the person you are talking to, impersonating both sides
          simultaneously. This is called a man-in-the-middle attack, and it is
          the reason VOID has the Duet.
        </p>
        <p style={{ marginBottom: "24px" }}>
          More on this below. It is one of our favorite things about VOID. We
          think you will like it.
        </p>

        {/* The Person in the Room */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE PERSON IN THE ROOM
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is the threat most people forget.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The most dangerous person in your call is someone who has legitimately
          joined it and has bad intentions. They are inside the encryption. They
          can hear everything. They can screenshot everything. They can record
          everything with a phone pointed at their screen.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID cannot protect you from this person.
        </p>

        {/* The Compromised Device */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE COMPROMISED DEVICE
        </p>
        <p style={{ marginBottom: "16px" }}>
          If your device has malware on it — a keylogger or screen recorder,
          etc. — VOID cannot help you. The encryption is doing its job. The
          malware is doing its job. They do not interfere with each other. The
          malware wins.
        </p>
        <p>
          Clean your device please. We recognize this is not very specific
          advice.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What if someone unwanted joins? — task #436.
          VOID's structural answer to an unwanted peer is BURN-and-rotate,
          not a kick/mute/ban primitive. That answer was previously
          implicit; spelling it out here gives a reader who reaches for
          the threat model a paragraph they can point at, and names the
          honest trade-off (BURN stops the unwanted peer from continuing;
          it does not undo what they already saw or heard). */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT IF SOMEONE UNWANTED JOINS?
        </div>
        <p style={{ marginBottom: "16px" }}>
          Burn the session, and create a new room.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Other tools answer this with soft moderation — anyone can mute
          or kick anyone out. VOID has no kick, no mute-others, no ban,
          and no removal primitive at all. That is by design, not an
          oversight.
        </p>
        <p style={{ marginBottom: "0" }}>
          The phrase is the credential. The credential is rotatable. When
          the wrong person is in the room, the correct response is to BURN
          the session — which ends the call for everyone and discards the
          room ID derived from the phrase — and then re-share the
          freshly generated phrase out-of-band to only the people you
          want. The unwanted peer is locked out forever, because the room
          they were in no longer exists and the new room ID is derived
          from a phrase they were never given.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Task #443: the shared DROP slot. A single-slot plain-text
          surface so the call has somewhere to put a URL or a one-line
          handoff without us building a chat. We surface the design
          constraints honestly here — what it is, what it explicitly
          is not, and what the on-the-wire shape looks like. */}
      <div style={sectionStyle} data-testid="drop-slot-section">
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE SHARED DROP SLOT
        </div>
        <p style={{ marginBottom: "16px" }}>
          A live call sometimes needs to hand off one short string —
          a URL, a room code, a one-line note. We resisted adding
          chat for a long time and we still have not. What we did
          add is a single shared slot: every room holds exactly one
          plain-text value, capped at <span style={tealText}>2 KB</span>,
          and any participant can overwrite it for everyone at once.
          The previous value is gone the moment the next one arrives.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The list of things DROP is not, said out loud so the design
          cannot drift: not a chat history, not a transcript, not a
          per-peer view, not a file transfer, not a formatted message,
          not a link that auto-resolves, not a thing you scroll back
          through. There is one slot. It is empty for late joiners.
          It is empty after BURN. Pressing it on your machine
          overwrites it on everyone else’s machine. That is the whole
          feature.
        </p>
        <p style={{ marginBottom: "16px" }}>
          On the wire, DROP rides a per-peer{" "}
          <code style={{ color: "var(--gold)" }}>RTCDataChannel(“drop”)</code>{" "}
          on the same DTLS-over-SCTP association as the call’s audio
          and video. The signaling server does not see the bytes —
          it sees only that an SCTP stream exists, indistinguishable
          from any other data channel on the connection. The
          enumeration that proves this lives in{" "}
          <code style={{ color: "var(--gold)" }}>docs/signaling-envelope-audit.md</code>,
          Table 2, row 5; the static check at{" "}
          <code style={{ color: "var(--gold)" }}>check:signaling-envelope</code>{" "}
          fails the build if the label is opened anywhere not named in
          the audit doc.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Sanitization runs on both the send side and the receive
          side. Input is{" "}
          <span style={tealText}>NFC-normalized</span> so two
          visually-identical strings are the same string; ASCII and
          C1 control bytes are stripped; zero-width code points
          (U+200B–U+200D, U+2060, U+FEFF) are stripped because they
          are a known spoofing vector; bidirectional override
          characters (U+202A–U+202E, U+2066–U+2069 — the{" "}
          <span style={tealText}>Trojan Source</span> class) are
          stripped for the same reason; and the result is capped at
          2 KB UTF-8 at a code-point boundary. If anything was
          removed or truncated the local UI says so. Paste is
          accepted as <code style={{ color: "var(--gold)" }}>text/plain</code>{" "}
          only — no HTML, no rich-text, no image bytes — and the
          rendered slot is a React text child, never injected as
          HTML.
        </p>
        <p style={{ marginBottom: "0", ...burntText }}>
          The honest trade-off: DROP is the first feature in the
          human meeting product that puts user-typed content on a
          data channel. We are not pretending otherwise — the audit
          doc names it explicitly. The signaling{" "}
          <em>WebSocket</em> still carries no user content. The
          shared <em>data channel</em> now carries up to 2 KB of
          plain text, encrypted end-to-end, with no history. While
          you are the active screen presenter the local input is
          disabled (you will see{" "}
          <code style={{ color: "var(--gold)" }}>[DISABLED DURING SCREEN SHARE]</code>),
          because a typo into a slot that is also being mirrored to
          a recording is the exact mistake we should not invite.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What the Server Sees — body rendered verbatim from the shared
          §3.5 fragment so this surface and VOID_TECHNICAL_OVERVIEW.md
          stay byte-equivalent. Edit docs/_fragments/server-observable.md
          and re-run the void-client build (or sync-server-observable.mjs
          directly) to update both. */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT THE SERVER SEES
        </div>
        <div data-testid="server-observable-fragment">
          <ServerObservableProse source={serverObservableMd} />
        </div>

        {/* URL fragment leak vectors. The phrase travels in the URL
            fragment — never reaches our server — but it does reach a
            number of places people forget about. Naming them so the
            "fragment is private by design" framing on the rest of the
            page doesn't shade into overstatement. */}
        <p
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "20px" }}
        >
          THE PHRASE NEVER REACHES OUR SERVER. HERE IS WHERE IT DOES REACH.
        </p>
        <p style={{ marginBottom: "12px" }}>
          The VOID Phrase rides in the URL fragment (the part after the{" "}
          <span style={tealText}>#</span>), and browsers do not transmit
          fragments in HTTP requests. That part is true. The places below
          are everything else that can still see the URL on your device or
          in your account.
        </p>
        <ul
          data-testid="fragment-leak-list"
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
        >
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Browser history.</strong> The full URL, fragment
            included, is written to your local history unless you opened
            the link in a private/incognito window.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Browser sync.</strong> Chrome Sync, Firefox Sync, and
            Edge Sync upload your history (URLs and fragments) to the
            account holder’s cloud, where it is keyed to your account and
            mirrored to every other signed-in device.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Browser extensions.</strong> Any extension with the{" "}
            <code style={{ color: "var(--gold)" }}>&lt;all_urls&gt;</code>{" "}
            permission (or host permission for the deployment’s domain)
            can read the full URL of every tab, fragment included.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Screenshots and screen recordings.</strong> Whatever
            captures the screen captures the address bar, which captures
            the phrase.
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <strong>Clipboard reads.</strong> If you copy the URL to share
            it, every app that reads the clipboard sees the phrase. On
            some platforms a foreground app can poll the clipboard
            silently; on others a paste prompt is required.
          </li>
        </ul>
        <p style={{ marginBottom: "16px", fontStyle: "italic", color: "#9C8E7A" }}>
          Treat the URL the way you would treat the phrase itself, because
          it contains the phrase. Sharing a link in a sync’d tab group or
          a screenshot of the address bar shares the room.
        </p>

        {/* Live proof callout. The list above is a claim; this link
            sends the reader to a page where they can pin a room code and
            read the literal server response themselves. Without the
            callout the proof page is unfindable. */}
        <p
          style={{
            marginTop: "20px",
            padding: "12px 14px",
            border: "2px solid var(--teal)",
            background: "rgba(0,0,0,0.25)",
            color: "var(--teal)",
            letterSpacing: "1px",
            fontSize: "12px",
            textTransform: "uppercase",
          }}
        >
          ▌ DON’T TAKE OUR WORD FOR IT —{" "}
          <Link
            href="/proof/server-state"
            data-testid="server-state-proof-callout"
            style={{
              color: "var(--gold)",
              textDecoration: "none",
              borderBottom: "1px solid var(--gold)",
            }}
          >
            READ THE LITERAL SERVER RESPONSE FOR ANY ROOM CODE
          </Link>
          .
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Network observers and IP visibility */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> NETWORK OBSERVERS AND IP VISIBILITY
        </div>
        <p style={{ marginBottom: "16px" }}>
          Your IP address is not your name, but in the hands of someone with
          the right records, it can become one. It is worth being precise
          about who sees yours and when.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID has three relevant cases. Here they are, with no rounding.
        </p>

        {/* Default mode */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          DEFAULT MODE
        </p>
        <p style={{ marginBottom: "8px" }}>
          The host did not toggle relay-only. Peers connect directly to each
          other when their networks allow it.
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "24px",
          }}
        >
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <span style={notProtectedStyle}>Other peers see your IP.</span>{" "}
            This is how peer-to-peer works. Your browser and theirs exchange
            ICE candidates, which are network addresses, so the media can
            flow directly without our server in the middle.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <span style={notProtectedStyle}>The VOID server sees your IP.</span>{" "}
            Any TCP connection reveals an IP. The signaling socket is no
            exception.
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <span style={partialStyle}>The TURN server may or may not see your IP.</span>{" "}
            Only when a direct path fails and traffic falls back to the
            relay.
          </li>
        </ul>

        {/* Relay-only mode */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          RELAY-ONLY MODE
        </p>
        <p style={{ marginBottom: "8px" }}>
          The host toggled <span style={tealText}>RELAY-ONLY</span> in the
          preview gate. Every peer in the room sees a{" "}
          <span style={tealText}>RELAY ONLY</span> indicator next to the
          E2E badge. All peer connections force ICE transport policy{" "}
          <span style={tealText}>“relay”</span>.
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "16px",
          }}
        >
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <span style={protectedStyle}>Other peers do not see your IP.</span>{" "}
            They see the TURN server’s IP. The TURN server forwards the
            packets without ever seeing the keys or the contents.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span>{" "}
            <span style={notProtectedStyle}>The VOID server still sees your IP.</span>{" "}
            Relay-only changes who your peers see, not who the server sees.
            The signaling socket has not moved.
          </li>
          <li
            style={{ marginBottom: "6px" }}
            data-testid="tor-onion-default-paragraph"
          >
            <span style={burntText}>→</span>{" "}
            <span style={protectedStyle}>If you reached VOID over a Tor .onion address, relay-only is on by default.</span>{" "}
            The host’s toggle is pre-checked, disabling it requires a
            confirmation, and your local connection is forced to{" "}
            <span style={tealText}>“relay”</span> regardless of the room
            setting — so a room someone else created without relay-only
            still cannot pull your clearnet IP into ICE.
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <span style={notProtectedStyle}>The TURN server sees your IP.</span>{" "}
            That is how a relay works. It does not see the encrypted media
            it carries.
          </li>
        </ul>
        <p style={{ marginBottom: "24px", fontStyle: "italic", color: "#9C8E7A" }}>
          Relay-only is the right choice when you do not want a coworker, a
          stalker, or a stranger on the call to log your IP. It costs
          everyone in the room some latency. The host decides.
        </p>

        {/* Tor and the media path. */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          TOR AND THE MEDIA PATH
        </p>
        <p style={{ marginBottom: "16px" }} data-testid="tor-composition-paragraph">
          Tor protects how you reach VOID’s signaling layer. It does not
          protect the media path. WebRTC gathers connection candidates
          on your underlying network regardless of how this page loaded
          — so calls reached via <span style={tealText}>.onion</span>{" "}
          will still leak your clearnet IP to other peers unless
          relay-only is enabled, and even then will fall back to TURN
          relay with degraded latency. Tor was not designed for
          real-time media. If you need both peer-IP privacy and call
          quality, those are competing requirements; choose
          accordingly.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A VPN is the same trade. Your provider sees what we used to
          see, and the media path is still on your underlying network.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Operators who want to host a <span style={tealText}>.onion</span>{" "}
          mirror of their VOID instance — Tor hidden-service config,
          relay-only-by-default expectations, TURN caveats — should
          follow{" "}
          <code style={{ color: "var(--gold)" }}>docs/onion-mirror-runbook.md</code>.
          Deployments that set the <code style={{ color: "var(--gold)" }}>ONION_HOSTNAME</code>{" "}
          env var also emit the standard{" "}
          <code style={{ color: "var(--gold)" }}>Onion-Location</code>{" "}
          response header on https clearnet pages, so Tor Browser
          surfaces a one-click “switch to the onion version” prompt
          on its own — no UA sniffing, no banner.
        </p>

        {/* Task #1034 — surface the soft Tor-default in user terms.
            Mirrors the shipped surface (OnionMirrorLink, the CLEARNET PATH
            session indicator) and docs/tor-default-path-decision.md: the
            .onion path is PREFERRED and clearnet is an explicit, visible
            choice — but the hard default is held, so a fresh client still
            loads over clearnet and no one is silently sent onto .onion.
            Banned-phrase note: this is scanned copy — say "preferred path"
            / "soft default".
            banned-phrase-allow: rule explainer quoting the banned phrases
            verbatim so the writing rule is legible — never "Tor by default" or "Tor-routed". */}
        <p
          id="how-void-surfaces-the-onion-path"
          style={{
            marginBottom: "4px",
            ...subheadingStyle,
            fontSize: "12px",
            marginTop: "0",
            scrollMarginTop: "80px",
          }}
        >
          HOW VOID SURFACES THE .ONION PATH
        </p>
        <p style={{ marginBottom: "16px" }} data-testid="tor-soft-default-paragraph">
          When a deployment publishes a <span style={tealText}>.onion</span>{" "}
          mirror, VOID treats it as the preferred path and makes clearnet an
          explicit, visible choice rather than a silent default. On every
          clearnet page the footer names where you are —{" "}
          <span style={tealText}>You are on the clearnet path</span> — and
          offers a one-click switch to the .onion address (open it, or copy
          it to send to someone else). If your network can’t reach .onion,
          it says <span style={tealText}>requires Tor Browser</span> rather
          than failing silently.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Inside a call, if a mirror is published but this session loaded
          over clearnet, a <span style={tealText}>CLEARNET PATH</span>{" "}
          indicator sits beside the E2E and relay badges — so the path you
          are on is named, not hidden. It disappears on the .onion origin
          (the positive “Connected via Tor onion” badge covers that) and
          when no mirror exists (there is nothing else to offer).
        </p>
        <p style={{ marginBottom: "16px" }} data-testid="tor-bootstrap-honesty-paragraph">
          The surface is honest about the bootstrap. The footer says plainly
          that this visit already reached us over the public internet, and
          that opening the .onion address only keeps the{" "}
          <span style={tealText}>signaling</span> layer behind a hidden
          service from then on — it does not hide your IP from the other
          people on a call, whose media path stays on each peer’s own
          network (see <span style={tealText}>docs/privacy-non-goals.md</span>{" "}
          N-1).
        </p>
        <p style={{ marginBottom: "24px" }} data-testid="tor-soft-default-not-forced-paragraph">
          One thing this is not: you are not forced onto .onion, and your
          clearnet exposure is not removed. A fresh client still loads over
          clearnet by default; VOID surfaces and prefers the .onion path, it
          does not silently send you there. Flipping that hard default would
          need real evidence that the locked-down networks this protects can
          actually reach the published .onion — a check this development
          environment can’t supply, so it is deliberately held (the decision
          is recorded in{" "}
          <span style={tealText}>docs/tor-default-path-decision.md</span>).
        </p>

        {/* Task #1034 — verify-don't-trust pointer for the onion-only
            posture (task #1023). Carries the exact non-claims from
            torPosture.ts POSTURE_CAVEAT so a reader here sees the same
            limits the raw /api/proof/posture response names. */}
        <p
          id="verify-the-posture"
          style={{
            marginBottom: "4px",
            ...subheadingStyle,
            fontSize: "12px",
            marginTop: "0",
            scrollMarginTop: "80px",
          }}
        >
          VERIFY THE POSTURE — DON’T TRUST IT
        </p>
        <p style={{ marginBottom: "16px" }} data-testid="tor-posture-verify-paragraph">
          Everything above asks you to trust that the operator actually runs
          onion-only ingress. You don’t have to take that on faith.{" "}
          <span style={tealText}>GET /api/proof/posture</span> — and the{" "}
          <span style={tealText}>POSTURE ATTESTATION</span> block on the
          in-app{" "}
          <a
            href="/proof/runtime"
            style={{ color: "var(--gold)", textDecoration: "underline" }}
          >
            /proof/runtime
          </a>{" "}
          page — report, bound to the reproducible build identity, whether{" "}
          <span style={tealText}>TOR_ONLY</span> is in force, whether{" "}
          <span style={tealText}>/api/ice-servers</span> suppresses STUN, and
          whether ingress is onion-fronted. When the full posture is not
          active, the page says so plainly instead of implying it is.
        </p>
        <p style={{ marginBottom: "24px" }} data-testid="tor-posture-nonclaims-paragraph">
          Read what it can’t prove, because the response says so itself. It
          does not prove the operator is running the un-modified, attested
          binary — a modified binary can report whatever it likes, so bind
          the attestation to the build via the cosign-signed{" "}
          <span style={tealText}>SHA256SUMS</span> and the cross-network{" "}
          <span style={tealText}>/api/proof/build</span> ritual first. It
          does not prove the config didn’t change after you read it — that is
          a time-of-check / time-of-use window. And it does not prove no
          logging proxy sits in front of the process recording IPs upstream.
          The honest claim is “verify the published build’s posture,” not
          “the operator structurally cannot ever see an IP.”
        </p>

        <p style={closingLineStyle}>
          If this deployment publishes an .onion mirror, the address
          appears below. Reachable from inside the installed app, too.
        </p>
        <div style={{ marginTop: "12px" }}>
          <OnionMirrorLink />
        </div>

        {/* Task #385 — Onion fail-open audit.
            The list below is copy-pasted verbatim from
            docs/onion-fail-open-audit.md ("Verbatim hostname list").
            The audit is the maintainer's evidence; this is the
            published version of the same list of strings, so a user
            verifying the claim can see exactly what was audited.
            If the audit's hostname list changes, this block changes
            with it — they have to stay byte-equivalent. */}
        <p
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "28px" }}
        >
          WHAT THE NETWORK SEES OVER TOR — VERBATIM
        </p>
        <p style={{ marginBottom: "12px" }}>
          The full list of hostnames an onion-origin VOID page
          contacts during a two-peer call. Code-audited across every
          fetch site in the client (HAR capture against a deployed
          mirror pending — see audit doc), and pinned by a regression
          test that fails the build if a new clearnet hostname is
          silently introduced. Source:{" "}
          <code style={{ color: "var(--gold)" }}>
            docs/onion-fail-open-audit.md
          </code>
          .
        </p>
        <pre
          data-testid="onion-hostnames-verbatim"
          style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid var(--fg-dim)",
            padding: "12px 14px",
            color: "var(--teal)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            lineHeight: 1.6,
            letterSpacing: "0.5px",
            whiteSpace: "pre-wrap",
            overflow: "auto",
          }}
        >
{`<your-deployment>.onion         (same-origin — every fetch)
<operator-supplied TURN URL>    (if configured — the threat-
                                 model page already documents that
                                 the TURN server sees the user’s IP)`}
        </pre>
        <p style={{ marginTop: "8px", marginBottom: "0", fontStyle: "italic", color: "#9C8E7A" }}>
          Zero third-party hostnames after Task #385. The previous
          fail-open path (a third-party BTC→USD price endpoint used
          to render a small “≈ $0.80” hint) was closed in the same
          PR: on the onion mirror, that hint is simply omitted
          rather than fetched from clearnet.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What VOID Actually Protects */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={tealText}>▌</span>{" "}
          <span style={tealText}>WHAT VOID PROTECTS</span>
        </div>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Server-side surveillance: Protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          The VOID server is a relay. It passes encrypted signals between peers
          and does not store them. The server operator — us, or you, if you
          self-host — cannot read your signaling traffic. We cannot read your
          video or audio. We cannot tell what you said, what you looked like, or
          what the meeting was about.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is not because we promise not to look. It is because we
          structurally cannot. The signaling is encrypted client-side with keys
          derived from your VOID Phrase, which we never receive. The media
          travels peer-to-peer and never touches our server at all.
        </p>
        <p style={{ marginBottom: "24px" }}>
          There is nothing to breach or subpoena or leak.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Biometric capture via network: Protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          Your video is processed locally, on your device, by WebGL shaders
          running on your own GPU, before a single frame leaves your machine.
          What travels across the wire is not a face. It is a processed image —
          a gold duotone, a pixel grid, a contour map, an ASCII rendering —
          from which facial recognition systems cannot reconstruct you.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Your audio is processed locally by AudioWorklet processors running on
          your device’s dedicated audio thread. What travels is a shifted, bent,
          masked, or scrambled version of your voice. Not your voiceprint. Not
          the specific architecture of your throat.
        </p>
        <p style={{ marginBottom: "24px" }}>
          A network observer who somehow decrypted the stream would still not
          have a clean biometric asset. The degradation is applied at the
          source, before transmission.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Identity linkage via billing: Protected on our side.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          The host pays in Bitcoin over the Lightning Network. Lightning
          payments do not require a name, an email address, a phone number, or a
          billing address. There is no payment account linked to the room. There
          is no KYC ceremony. The sats move and the door opens. That is the
          entire transaction.
        </p>
        <p style={{ marginBottom: "24px" }}>
          What VOID never collects, VOID cannot leak. The Lightning Network
          itself has its own metadata story, which we cover honestly below.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Passive room enumeration: Protected.</span>
        </p>
        <p style={{ marginBottom: "24px" }}>
          Room IDs are 32 characters of lowercase hex derived from your VOID
          Phrase via Argon2id (64 MiB of memory, three sequential passes per
          attempt). There are approximately
          3.4 × 10<sup>38</sup> possible room IDs. A brute-force enumeration
          attack against room IDs is not a practical threat in this universe. It
          might be a practical threat in a universe where the laws of physics
          are substantially different. We are not aware of users in that
          universe.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Session persistence after tab close: Protected by design.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          The JWT that authorizes room creation is stored in sessionStorage,
          which is cleared when the tab closes. The VOID Phrase, once used to
          derive the room keys, is not stored persistently. When you close the
          tab, the credentials are gone. This is intentional. An ephemeral tool
          should leave ephemeral traces.
        </p>
        <p style={{ marginBottom: "24px" }}>
          One narrow exception: a host’s reclaim token is held in localStorage
          so that a 24-hour day-tier host who restarts their browser can still
          retake host on rejoin. The token is encrypted at rest under a key
          derived from the VOID Phrase, and lives in a slot whose name is
          also derived from the phrase, so without the phrase nothing on
          disk reveals which room was paid for or what tier was bought. The
          entry is wiped explicitly on BURN, on session expiry, and
          opportunistically once it is older than the maximum 24-hour
          window. No phrase, no payment hash, and no tier name is ever
          written in plaintext.
        </p>
        <p data-testid="pwa-install-residue" style={{ marginBottom: "24px" }}>
          A second narrow exception lives outside the browser tab entirely.
          Installing VOID as a PWA places an app icon in your operating
          system’s launcher — Start menu on Windows, Launchpad and Dock on
          macOS, the app drawer on Android, the home screen on iOS — that
          remains there until you remove it. The install itself stores no
          phrase, no payment hash, and no session state, but the icon is
          device-visible evidence that VOID was installed. If that matters
          for your situation, uninstall the PWA explicitly the way you
          would uninstall any other app.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Past sessions from future compromise: Protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          Even if an attacker obtains your VOID Phrase a year from now, they
          cannot decrypt a session that happened last week. Each session
          generates fresh ephemeral keys via ECDH. When the session ends, the
          keys are destroyed. The past is sealed against the future.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Cryptographers call this{" "}
          <span style={goldText}>Perfect Forward Secrecy</span>.
        </p>
        <p style={closingLineStyle}>
          Future captures of past sessions cannot be decrypted with keys
          obtained later. That is what the math gives you.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Camera and microphone after BURN: Best-effort.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          When you press BURN — or when the room timer expires — every
          local media track is explicitly stopped: the raw camera feed,
          the watermarked outgoing video, the microphone, and any
          screen-share track (including a queued share that was never
          confirmed). The WebGL compositor that produces the
          watermark is torn down, its textures and program deleted,
          and its drawing context released. The peer connections are
          destroyed and the in-memory ephemeral keys are dropped.
          What this means in practice: the operating system’s
          recording indicator turns off because the browser no longer
          holds the device.
        </p>
        <p style={{ marginBottom: "16px" }}>
          One thing BURN does not do, because no web app can. JavaScript
          runtimes do not provide memory zeroization primitives. Dropping
          a reference to a key tells the engine the bytes are eligible
          for garbage collection; it does not overwrite them. Past key
          material can sit in the V8 heap, in browser process memory,
          and in any heap snapshot the OS takes, until the tab is closed
          and the operating system reclaims the page. BURN drops every
          reference we hold, stops every device we acquired, tears down
          every cache and storage entry we wrote, and releases the page
          for the OS to reclaim. That is what we deliver.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Two browser-level caveats we are obligated to disclose, both
          inherited from the underlying platform and not under app
          control:
        </p>
        <p style={{ marginBottom: "16px" }}>
          On iOS Safari, the orange microphone dot in the status bar
          can linger for a few seconds after the track is stopped.
          The track is genuinely released — Safari’s indicator just
          updates on its own cadence. If the dot persists more than
          ten seconds after BURN, switch tabs or lock the device to
          force the system UI to refresh.
        </p>
        <p style={{ marginBottom: "24px" }}>
          On every browser, a managed environment (corporate MDM,
          parental-control profiles, browser extensions with the{" "}
          <span style={tealText}>desktopCapture</span> permission) can
          retain a separate audit trail of “this site requested
          camera/microphone at this time” that no app code can erase.
          BURN stops the live capture; it does not rewrite logs the
          OS or the browser already wrote to disk before BURN was
          pressed.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          WHAT BURN DOES NOT REMOVE
        </p>
        <p style={{ marginBottom: "16px" }}>
          BURN explicitly stops every local media track, tears down
          the WebGL compositor and peer connections, drops in-memory
          ephemeral keys, wipes VOID’s sessionStorage entries
          (including the paid-room JWT), deletes VOID’s runtime
          service-worker caches, revokes every blob URL the room
          created, and then hard-navigates the tab to the landing
          page so the React tree, AudioContext objects, and
          closure-captured stream references are discarded along
          with the page.
        </p>
        <p style={{ marginBottom: "24px" }}>
          What BURN cannot reach, because it lives outside the page:
          entries the browser already wrote into its own history
          before the on-leave URL replacement ran on the page that
          held the phrase; pixels still resident in the GPU’s VRAM
          until the GPU driver reuses those texture slots; memory
          pages the operating system already swapped to disk;
          anything you typed into another tab or another app;
          anything a screenshot tool or screen-recorder captured
          while the room was open; anything a browser-sync account
          replicated to other devices before BURN ran; and the
          browser process itself if it was already exfiltrated by
          malware running with your user privileges. BURN makes the
          page structurally hostile to recovery; it does not rewrite
          state that already left the page.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={protectedStyle}>Calls during operator restart: Protected.</span>
        </p>
        <p style={{ marginBottom: "24px" }}>
          When the signaling server restarts (deploy, host reboot,
          operator-initiated SIGTERM) it broadcasts a one-shot
          “shutdown” notice to every connected client and drains for
          a few seconds before exiting. The client surfaces a
          dismissible “SIGNALING SERVER OFFLINE — YOUR CALL CONTINUES
          P2P.” banner and{" "}
          <span style={goldText}>does not tear down peer connections</span>.
          Audio and video keep flowing browser-to-browser; new
          actions that need the relay (joining, knock-to-enter,
          extending) pause until the server returns and socket.io
          reconnects on its own. This is the whole point of running a
          stateless signaling server: brief outages do not interrupt
          live calls.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What VOID Does Not Protect */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={redText}>▌</span>{" "}
          <span style={redText}>WHAT VOID DOES NOT PROTECT</span>
        </div>
        <p style={{ marginBottom: "24px" }}>
          This is the more important list.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={notProtectedStyle}>Network metadata: Not protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          When you connect to the VOID server, the server knows your IP
          address. It knows what time you connected. It knows how long the
          connection lasted. It does not know who you are or what you said, but
          it knows a connection happened.
        </p>
        <p style={{ marginBottom: "24px" }}>
          If you need to hide the fact that a connection happened at all — not
          just what was communicated, but that any communication occurred — you
          need Tor. VOID has a Tor-compatible deployment option. The StartOS
          and Umbrel packages are{" "}
          <span style={tealText}>.onion-reachable</span> — they can advertise a
          Tor hidden-service address that reaches the signaling layer — but
          {/* banned-phrase-allow: canonical disclaimer wording per Task #238 */}
          they are not <em>Tor-routed end-to-end</em>: the WebRTC media path
          still gathers ICE candidates on your underlying network regardless
          of how the page loaded. Read the{" "}
          <span style={tealText}>TOR AND THE MEDIA PATH</span> note above
          before you do — Tor protects how you reach the signaling layer,
          not the WebRTC media path, and the trade-off is real. Operators
          running a clearnet deployment who want to add a
          <code style={{ color: "var(--gold)" }}> .onion</code> mirror in front
          of the same backend should follow the runbook in{" "}
          <code style={{ color: "var(--gold)" }}>docs/onion-mirror-runbook.md</code>;
          the mirror hides operator and visitor IPs at the signaling layer but
          does not change the media-path story above.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={notProtectedStyle}>The person in the room: Not protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          We said this above. We are saying it again because it is important
          enough to say twice.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The Duet protects you against an attacker who controls the
          signaling relay. It does not protect you against a participant in
          the call who screen-records, audio-records, or photographs their
          own screen. This is true of every video tool ever built. We state
          it because we owe you the truth.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If someone in your room is recording with a second device, VOID
          cannot help you. If someone in your room is taking screenshots, VOID
          cannot help you. If someone in your room is working against you, VOID
          cannot help you.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Trust the people in the room before you enter the room. VOID gives
          you knock-to-enter and host-controlled admission for exactly this
          reason. Use them.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={notProtectedStyle}>Your device: Not protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          If your device is compromised, the adversary is inside your encryption
          before it starts. The VOID Phrase lives in your browser’s address
          bar — in the fragment, the part after the{" "}
          <span style={tealText}>#</span> symbol, which is never transmitted
          over the network — so a passive network tap cannot capture it. But a
          keylogger watching your keyboard, or a screen recorder watching your
          browser, can. A microphone tap captures your actual voice before the
          voice mask ever touches it.
        </p>
        <p style={{ marginBottom: "24px" }}>
          VOID operates in the layer above your device. If that layer is
          poisoned, all bets are off. This is not a VOID problem. It is a prior
          problem that no video application can solve.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={notProtectedStyle}>The channel you use to share the VOID Phrase: Not protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          The VOID Phrase must travel from the host to the guests somehow. If it
          travels over a channel that is being monitored, an adversary can
          obtain the phrase and use it to join the room, or to decrypt signaling
          they have captured.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Share the phrase over a channel you already trust. Say it out loud.
          Use Signal if you trust Signal for this purpose. Write it on paper. Do
          not send it over the same platform you were trying to avoid by using
          VOID in the first place. This would be like hiding a key under the
          same mat you told everyone about.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={partialStyle}>Lightning payment metadata: Partially protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          Lightning is anonymous in the sense that VOID never sees who you
          are. Lightning is not anonymous in the sense that the payment
          itself vanishes from the world. Your Lightning node logs the
          invoices it pays. Routing nodes along the payment path may log
          the payment hash. Anyone who can correlate one of those logs to
          you — your wallet provider, a routing node operator, anyone with
          a subpoena to either — can learn that you paid <em>someone</em>{" "}
          a small amount at a particular time. If they also see VOID’s
          invoice records for the same time window, they can connect the two.
        </p>
        <p style={{ marginBottom: "24px" }}>
          For the vast majority of users this is not the threat that
          matters. If your threat model includes hiding the fact that you
          hosted a VOID room at all, route the Lightning payment over Tor,
          use a wallet that does not know you, or have a third party pay
          the invoice on your behalf. The default paywall is not built for
          that case and we will not pretend otherwise.
        </p>
        <p data-testid="lightning-overview-crosslink" style={{ marginBottom: "24px" }}>
          Lightning payment privacy ultimately depends on how the operator
          configured their LN node and which routing nodes the payment
          traverses — both of which are deployment-specific. For the
          architecture details of how the L402 paywall and invoice
          settlement actually work, see the{" "}
          <a
            href={`${REPO_URL}/blob/main/VOID_TECHNICAL_OVERVIEW.md#4-lightning-l402-paywall`}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--gold)",
              textDecoration: "none",
              borderBottom: "1px solid var(--gold)",
            }}
          >
            Lightning section of the technical overview
          </a>
          .
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={partialStyle}>A malicious TURN server: Partially protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you are using a TURN relay — because a direct peer-to-peer
          connection was not possible — the TURN server handles your media
          traffic. The media is encrypted and the TURN server cannot decrypt it.
          But a malicious TURN operator can observe traffic patterns, timing,
          and the volume of data you are sending, even without content.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Use a TURN server you control, or one operated by someone you trust.
          The self-hosting guide includes instructions for running your own
          Coturn instance. We included those instructions because we think you
          should run your own.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={partialStyle}>A compromised server operator: Partially protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you are using VOID’s hosted service and we are compromised, an
          attacker who controls our server can see the metadata of who connected
          when. They cannot read your signaling content. They cannot read your
          media. They can see that connections occurred and disrupt the service.
        </p>
        <p style={{ marginBottom: "24px" }}>
          If you cannot tolerate trusting us even to this limited degree,
          self-host. We mean this sincerely. The self-host option exists because
          we think you should use it.
        </p>

        <p style={{ marginBottom: "4px" }}>
          <span style={notProtectedStyle}>Nation-state level adversaries with full network access: Not reliably protected.</span>
        </p>
        <p style={{ marginBottom: "16px" }}>
          We want to be honest about the upper bound of VOID’s threat model.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A nation-state adversary with the capability to intercept and analyze
          large amounts of network traffic, correlate timing between
          connections, and apply significant computational resources to the
          problem can do things that VOID’s architecture does not fully prevent.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We are a small team who strongly value privacy. We are not a
          classified signals intelligence program. We do not have the
          resources of one.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If a nation-state adversary is specifically targeting you and has
          dedicated resources to do so, please contact a professional security
          organization rather than relying on any single tool, including VOID.
          A band-aid is a good tool, but it is not a hospital.
        </p>
        <p>
          For the vast majority of people reading this, the relevant threat
          actors are corporations, data brokers, casual surveillance, and legal
          compulsion. Against those threats, VOID is well-designed. Against a
          targeted nation-state attack, VOID is one layer of a defense that
          would need many more layers.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* When the Host Leaves */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={tealText}>▌</span>{" "}
          <span style={tealText}>WHEN THE HOST LEAVES</span>
        </div>
        <p style={{ marginBottom: "16px" }}>
          Most video tools treat the host as the meeting. When the host
          leaves, the meeting ends.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID does not work this way.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Once a peer connection is established, the media flows directly
          between devices. The server is not in the path. If the host
          disconnects mid-call — closes the laptop, loses Wi-Fi, walks out
          of the room — every existing peer connection continues,
          uninterrupted, until the participants choose to end it or the
          room hits its lifetime (65 minutes for the standard tier; longer
          for paid persistent rooms).
        </p>
        <p style={{ marginBottom: "16px" }}>
          The server is only required for two things: admitting a new
          joiner, or helping a peer reconnect after a network drop. While
          neither of those is happening, the server has nothing to do. You
          could turn it off and the conversation would not notice.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* The Phrase Is the Boundary */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE PHRASE IS THE BOUNDARY
        </div>
        <p style={{ marginBottom: "16px" }}>
          A reasonable person reading about the Lightning paywall might
          assume the payment receipt — a JWT stored in your browser — is
          what controls who can enter a room. It is not.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Room access control is the phrase, not the JWT. The JWT is a
          payment receipt that gates <em>creation</em> of a paid room. The
          host pays, the server signs the receipt, the receipt authorizes
          the create-room call, and then the JWT is finished. It does not
          gate joining. It does not gate anything inside the room.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Once the room exists, anyone holding the 6-word VOID Phrase can
          join, until the room fills (4 peers max) or its lifetime expires.
          There is no separate guest list. There is no per-user permission
          system. There is the phrase, and the phrase is the door.
        </p>
        <p style={closingLineStyle}>
          This is intentional. The phrase is the security boundary. Treat
          it that way and tell anyone you share it with to do the same.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Persistent rooms widen the window */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> LONGER-LIVED ROOMS WIDEN THE WINDOW
        </div>
        <p style={{ marginBottom: "16px" }}>
          The standard room expires 65 minutes after creation. The paid
          24-hour room lives for a day, on purpose, because the people
          running a cross-timezone standup or an all-day workshop should
          not have to redo the phrase six times an hour.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Honesty: a longer-lived room slightly weakens the ephemerality
          story. The phrase is the boundary, and a leaked phrase for a
          24-hour room is exploitable for up to a day. A leaked phrase for
          a 65-minute room is exploitable for at most 65 minutes. The
          window is wider in proportion to the lifetime.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is also why we cap the ceiling at 24 hours. We considered a
          7-day tier and removed it. A week-long room is a week-long
          window of exploitability for a single leaked phrase, and at that
          duration the tool stops behaving like an ephemeral one. A day is
          the longest lifetime that still feels like a single working
          stretch. Past that, the right answer is to make a new room.
        </p>
        <p style={{ marginBottom: "16px" }}>
          What you paid for is the window, not the connection. The room
          exists for its full lifetime whether or not anyone is currently
          connected. If you refresh, drop, or step away for a few minutes
          and come back, the phrase URL still opens the same room — no
          re-payment. When the window ends, the room ends.
        </p>
        <p style={{ marginBottom: "16px" }}>
          What does <span style={notProtectedStyle}>not</span> change: the
          server still cannot read media. There is still no account, no
          recording, no log of who said what. The phrase still derives the
          room ID and the encryption key on your device. Server restart
          still wipes everything in flight.
        </p>
        <p style={closingLineStyle}>
          Pick the shortest lifetime that fits the work. If 65 minutes
          fits, choose 65 minutes. The 24-hour tier exists because real
          meetings sometimes need it, not because longer is better.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Recovery code */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE RECOVERY CODE IS A PIECE OF PAPER
        </div>
        <p style={{ marginBottom: "16px" }}>
          When the Lightning payment confirms, we hand you a four-word
          recovery code. We show it once, on screen, with the words “this
          is your only chance.” We never write it to your device. We never
          show it again.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The code exists for a single, narrow case: you paid, you closed
          the tab before the room opened, and you want to use the unused
          paid window without paying twice. Submit the four words on the
          start screen and the server mints a fresh receipt for whatever
          time remains in the window you bought. The code is single-use.
          When the paid window ends, the code dies with it.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The trade-off is honest. If you choose to write the code down on
          a sticky note, that sticky note proves you paid for a VOID room
          at time T. It does not prove what you said in the room. It does
          not prove who you talked to. It proves a payment happened.
          Treat it accordingly: write it down if you need it, throw it
          away when you don’t, store it the way you would store any other
          short-lived credential.
        </p>
        <p style={closingLineStyle}>
          We could have skipped this feature and kept the surface smaller.
          We chose to ship it because the alternative — automatically
          saving the receipt to your browser — would have been a worse
          privacy trade made on your behalf. The recovery code is the
          option you opt into, not the default we pick for you.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* The Duet */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE DUET
        </div>
        <p style={{ marginBottom: "16px" }}>
          Here is one of our favorite things about VOID.
        </p>
        <p style={{ marginBottom: "16px" }}>
          When two peers connect, the cryptography does something beautiful.
          After the ECDH key exchange completes — after your devices have
          performed an intricate mathematical handshake across the wire,
          deriving a shared secret that neither side ever transmitted directly —
          VOID takes a small piece of that shared secret and turns it into two
          words.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Just two words. Drawn from the same BIP-39 list that gives you your
          VOID Phrase. Displayed on both screens simultaneously.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Then you read them aloud to each other.
        </p>
        <p style={{ marginBottom: "16px", color: "var(--gold)" }}>
          That is the Duet. Two voices. Two screens. The same two words.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If the words match, the connection is clean. The mathematics worked.
          Nobody is standing between you, impersonating both sides. You are
          talking to the person you think you are talking to.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If the words do not match, something is wrong. You should end the
          call.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is how you defeat the man in the middle. Not with more
          cryptography — there is already plenty of cryptography. With two human
          voices reading the same two words aloud at the same time and noticing
          whether they match.
        </p>
        <p style={{ marginBottom: "16px" }}>
          It takes five seconds.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Each word is selected from 2,048 possibilities. Two words together
          give you 2,048 times 2,048 possible combinations. That is
          approximately four million possible Duets. The mathematical
          probability of an attacker successfully forging a connection that
          produces the same two words as your legitimate session is
          approximately{" "}
          <span style={tealText}>one in four million</span>.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Those are good odds. We are comfortable with those odds.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Most people will perform the Duet and find that the words match and
          feel a small, quiet satisfaction that is difficult to name. The
          connection is clean.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A small number of people will perform the Duet and find that the
          words do not match. For those people, the Duet will be one of the
          most important five seconds of their day.
        </p>
        <p style={{ marginBottom: "16px", color: "var(--gold)" }}>
          One thing the Duet is not: permanent.
        </p>
        <p style={{ marginBottom: "16px" }} data-testid="duet-rekey-paragraph">
          If your peer’s device performs a fresh key exchange in the middle
          of a call that VOID cannot prove grew out of the session you already
          verified — a reconnect, an ICE restart, or a brand-new handshake that
          rides the signaling path and changes the fingerprint of their keys —
          VOID throws out your earlier verification for that peer. The chip
          that said you verified them disappears, and a notice appears on
          their tile: KEYS ROTATED, RE-VERIFY SAS. It stays there until you
          read the two words again and confirm they still match.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is on purpose. Those keys arrive over the signaling path, the
          one an attacker who knows your room phrase can stand in the middle
          of. The thing you checked a minute ago is no longer the thing on the
          wire, and an attacker who slipped in at the moment of the rotation
          would produce a different Duet. So we make you look again rather than
          let a stale chip vouch for keys you never checked. Tap the notice,
          read the two words, confirm. If they match, you are clean again. If
          they do not, end the call.
        </p>
        <p style={{ marginBottom: "0" }} data-testid="duet-silent-rekey-paragraph">
          There is one key change VOID does not make you re-verify: the
          scheduled, in-call rotation. About every fifteen minutes a verified
          pair quietly trades fresh keys over the encrypted channel you
          already verified — never over signaling — and each side wraps the new
          key under the keys you both already confirmed. Only the genuine peer
          you already checked holds those keys, so an attacker who was never in
          your verified session cannot read or forge the exchange. Because the
          new keys are proven continuous with the ones you verified, the
          verification carries forward: you see a brief keys rotated note and
          the two words quietly update, but you are not asked to read them
          again. There is nothing new to check.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Voice Masking and the Duet */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> VOICE MASKING AND THE DUET
        </div>
        <p style={{ marginBottom: "16px" }}>
          The Duet works because two people read two words aloud and each
          recognizes the other’s voice. If a stranger were impersonating
          one side, you would hear that the voice was wrong before you
          finished the second word.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Voice masking degrades that recognition. DEEP, FORMANT, SCRAMBLE,
          and COMBINED do exactly what they are built to do — they make a
          voice harder to identify — and the Duet pays the cost. The
          verbal-confirmation premise of SAS verification is degraded by
          the same property that makes voice masking useful.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Perform the Duet first, with voice masking off. Confirm the words
          match against the voice you know. Then turn voice masking on and
          use it for the rest of the call. If you skipped this step and
          want to verify mid-call, ask the peer to drop their voice mask
          for the five seconds it takes to read the two words aloud.
        </p>
        <p style={closingLineStyle}>
          Verify with the voice you know. Mask the voice afterwards.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* When Four Strangers Meet */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHEN FOUR STRANGERS MEET
        </div>
        <p style={{ marginBottom: "16px" }}>
          The Duet scales with the size of the call. Two peers means one
          Duet. Four peers means each participant has three other peers to
          verify, which is three Duets per person and twelve verifications
          across the room.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If those four people do not already know one another’s voices,
          the Duet is harder. If anyone is using voice masking during
          verification, harder still. We acknowledge the burden — it is
          real, not theoretical, and it grows with every additional peer.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The recommendation is to do one round of SAS verification at the
          start of the call, with voice masking off, while everyone is
          introducing themselves anyway. After that round is complete,
          masking can be turned back on and the conversation can proceed.
        </p>
        <p style={closingLineStyle}>
          Five seconds per peer. Done once, at the beginning. Then mask
          freely.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Four documented limitations from the April 2026 internal audit.
          These are properties of the current design that a sophisticated
          reader is going to notice anyway. We would rather they hear it
          from us first. The technical mirror of this section lives at
          docs/threat-model.md. The audit itself is at
          docs/security-audit-public-2026-04.md in the source tree. */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> FOUR THINGS WORTH NAMING DIRECTLY
        </div>
        <p style={{ marginBottom: "16px" }}>
          An internal security audit in April 2026 surfaced four properties
          of VOID that we already knew about, that are correct given the
          design, and that we would not want a sophisticated reader to
          learn about from a critic instead of from us. They live here.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The published copy of the audit — with a status marker next to
          each High and Medium finding — lives at{" "}
          <span style={tealText}>docs/security-audit-public-2026-04.md</span>{" "}
          in the source tree, and a plain-language summary lives at{" "}
          <Link
            href="/audit"
            style={{
              color: "var(--gold)",
              textDecoration: "none",
              borderBottom: "1px solid var(--gold)",
            }}
          >
            /audit
          </Link>
          . A technical mirror of this section, written for security
          researchers and a future external audit firm, lives at{" "}
          <span style={tealText}>docs/threat-model.md</span>, and the
          parallel enumeration of client-side attacker positions
          (hostile peer, hostile knocker, malicious extension,
          compromised bundle, hostile signaling server, hostile TURN,
          coerced host) lives at{" "}
          <span style={tealText}>docs/client-threat-model.md</span>. The
          three must not drift; if you are reading them and they
          disagree, please file an issue.
        </p>
        <p style={{ marginBottom: "24px" }}>
          A note before the four items. VOID is a strong privacy tool for
          a sovereign host and a small group of people who already trust
          one another. The journalist-grade story — the one where a source
          and a reporter who have never met use VOID under hostile
          observation — requires both the audit’s High and Medium fixes
          shipping <em>and</em> a human audit by a recognized outside
          firm. We are working on the first. We have not commissioned the
          second yet. Treat the present-day claim as “well-designed for
          the documented threat model” and not “vetted for life-safety
          use.”
        </p>

        {/* Item 1 — server-observable metadata */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          1. THE SERVER SEES METADATA, EVEN WHEN CONTENT IS ENCRYPTED
        </p>
        <p style={{ marginBottom: "16px" }}>
          Earlier on this page we listed what the server sees. We want to
          name the larger property behind that list, because it is the
          single thing most likely to be misunderstood.
        </p>
        <p style={{ marginBottom: "16px" }}>
          End-to-end encryption is a property of the <em>content</em> of a
          call, not of the <em>fact</em> that a call is happening. Every
          byte of media and signaling is encrypted on your device before
          it leaves. The metadata of the connection is not.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The server sees room codes, peer IDs, the count of peers in a
          room, room duration, packet timing, and the join and leave
          timestamps of every connection. The contents are encrypted. The
          shape of the conversation — who is talking to whom, when, and
          for how long — is observable to anyone with access to the
          relay.
        </p>
        <p style={{ marginBottom: "24px" }}>
          The right mental model is: the server sees the metadata of the
          call but not the content. That is the correct property of an
          end-to-end encrypted system. It is not the property of an
          invisible system. VOID is end-to-end encrypted. VOID is not
          invisible. <span style={{ color: "#9C8E7A" }}>(Audit §2.1.)</span>
        </p>

        {/* Item 2 — Lightning observability. The id below is the
            deep-link target for the room-creation form's Tor-wallet
            prompt (Task #262). Renaming it breaks that link. */}
        <p
          id="lightning-ip-leak"
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}
        >
          2. THE LIGHTNING PAYMENT IS OBSERVABLE ON THE LIGHTNING NETWORK
        </p>
        <p style={{ marginBottom: "16px" }}>
          The host’s Lightning payment carries no room metadata — it does
          not encode the room code, the phrase, or any peer identity. The
          audit does not treat it as a confidentiality leak against the
          call’s contents. We do not either.
        </p>
        <p style={{ marginBottom: "16px" }}>
          There is one specific surface worth naming directly. When your
          wallet sends the payment, it opens a network connection to the
          operator’s Lightning node. If the wallet is not routed through
          Tor, that connection carries your IP address: the operator’s
          Lightning node sees the payer’s IP. The room contents stay
          encrypted and the relay never learns who paid for which room,
          but the operator’s <em>Lightning</em> node has a record of an
          IP that paid an invoice at time T, and the operator’s
          <em>VOID</em> relay has a record of an IP that created a room
          at roughly the same time. A motivated operator with both logs
          can correlate the two. Paying from a Tor-routed wallet — or
          having someone else pay the invoice on your behalf — closes
          this surface.
        </p>
        <p style={{ marginBottom: "16px" }}>
          It does mean this: the <em>act of hosting a room at a particular
          time</em> is potentially correlatable through the Lightning
          network. A host whose Lightning identity is known to an
          adversary leaks “I hosted a room at time T.” Not what was said.
          Not who was in it. The fact that hosting happened.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We have shipped a partial code-level mitigation: the server
          inserts a random 10–60 second delay between detecting your
          payment and returning your room token. Your paid window starts
          at settlement — the delay does not cost you any of the time you
          paid for. What it does cost an adversary is the ability to do
          a simple one-sample timing correlation; they now need
          statistical analysis over a 60-second jitter window to link
          the payment to the room creation.
        </p>
        <p style={{ marginBottom: "16px" }}>
          This is a partial mitigation, not elimination. A patient
          adversary with a long observation window can still correlate
          statistically. The stronger defenses remain: route the payment
          over Tor, use a wallet that does not know you, or have someone
          else pay the invoice on your behalf. Self-hosting on your own
          LNbits or BTCPay node removes the operator-side surface
          entirely.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Self-hosters who do not need the jitter (e.g., a private
          instance where the host is the only user and the correlation
          is not a concern) can disable it.{" "}
          <span style={{ color: "#9C8E7A" }}>(Audit §10.2, finding M-04. Code fix: Task #226.)</span>
        </p>

        {/* Wallet shortlist for the room-creation form's Tor-wallet
            prompt (Task #271). The prompt's READ MORE link lands on
            the #lightning-ip-leak anchor above; the host then needs an
            actionable answer to "which wallets actually do this?".
            This list is a snapshot — each entry cites the project's
            own Tor documentation so the next reviewer can re-verify
            without VOID becoming the source of truth. Audited row in
            docs/marketing-claims-audit.md ("Tor-routed wallet
            shortlist"). */}
        <p
          id="tor-wallet-shortlist"
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}
        >
          A SHORTLIST OF WALLETS THAT ROUTE OVER TOR
        </p>
        <p style={{ marginBottom: "16px" }}>
          We do not endorse a wallet. We can name a few that document
          Tor support themselves, so you have a starting point that is
          not “go figure it out.” This is a snapshot from this audit
          pass — verify against the linked project docs before you
          install anything, because wallet behaviour changes faster
          than this page does.
        </p>
        <ul
          data-testid="tor-wallet-shortlist"
          style={{ marginBottom: "16px", paddingLeft: "20px" }}
        >
          <li style={{ marginBottom: "10px" }}>
            <strong>Zeus</strong> (Android, iOS) — connects to your
            own or a remote Lightning node and bundles a Tor daemon so
            that node connection routes over Tor. Source:{" "}
            <a
              href="https://docs.zeusln.com/category/tor"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >
              docs.zeusln.com — Tor configuration
            </a>
            .
          </li>
          <li style={{ marginBottom: "10px" }}>
            <strong>Phoenix</strong> (Android) — self-custodial
            Lightning wallet by ACINQ. Settings include a Tor mode
            that proxies the wallet’s connections through Orbot.
            Source:{" "}
            <a
              href="https://phoenix.acinq.co/faq"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >
              phoenix.acinq.co — FAQ (Tor section)
            </a>
            . The iOS build does not currently expose this setting;
            check the FAQ for the current platform answer.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <strong>BitBanana</strong> (Android) — open-source remote
            controller for your own LND or CLN node. Documents Tor
            support for the node connection via Orbot. Source:{" "}
            <a
              href="https://github.com/michaelWuensch/BitBanana/wiki/Tor"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--gold)", textDecoration: "underline", textUnderlineOffset: "3px" }}
            >
              github.com/michaelWuensch/BitBanana — Tor wiki
            </a>
            .
          </li>
        </ul>
        <p style={{ marginBottom: "24px" }}>
          A custodial wallet you load in Tor Browser also routes its
          requests over Tor — the wallet itself does not need to know
          about Tor for that to work — but you trade the operator’s
          surface for the custodian’s. If you have a Lightning node of
          your own reachable via a hidden service, paying through it
          (with the wallet pointed at the node’s <code>.onion</code>{" "}
          address) is the strongest of these options because it
          removes the operator-side correlation surface entirely.
        </p>

        {/* Item 3 — URL fragment local-actor surface */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          3. THE PHRASE IN THE URL IS VISIBLE TO THE DEVICE, NOT TO THE NETWORK
        </p>
        <p style={{ marginBottom: "16px" }}>
          The VOID Phrase travels in the URL fragment — the part after
          the <span style={tealText}>#</span> symbol. Browsers do not
          transmit fragments to servers, so the phrase never reaches the
          network. We have verified this. The audit confirms it.
        </p>
        <p style={{ marginBottom: "16px" }}>
          But the fragment is a string in your browser’s address bar.
          That makes it visible to anyone with shoulder-access to the
          device, to a browser extension that can read the URL, to
          malware that walks the browser history, and to a screen
          recorder that captures what is on the screen. These are
          local-actor threats, not network-actor threats, but they are
          real where they apply.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Treat the phrase the way you would treat any other visible
          secret on a screen. Do not present a phrase URL where it can be
          photographed. Close the tab when you are done. A separate fix
          (audit finding M-03) closes the post-leave browser-history
          exposure by replacing the fragment-bearing entry on departure.
          The in-room exposure on the screen remains by design — the
          phrase has to be reachable for the joiner to use it.{" "}
          <span style={{ color: "#9C8E7A" }}>(Audit §10.3, finding M-03.)</span>
        </p>

        {/* Item 4 — SAS is a property of phrase encryption, not an
            independent layer */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          4. THE DUET WORKS BECAUSE THE PHRASE ENCRYPTED THE HANDSHAKE
        </p>
        <p style={{ marginBottom: "16px" }}>
          We described the Duet earlier as a defense against a
          man-in-the-middle of the signaling channel. That is true, and
          the math is right. We owe you the dependency that makes it
          true.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The two SAS words are derived from the ECDH shared secret. The
          ECDH key exchange itself was carried inside envelopes encrypted
          with the key derived from your VOID Phrase. An attacker on the
          signaling path who does not know the phrase cannot read those
          envelopes, cannot substitute their own ECDH keys, and therefore
          cannot grind a forged handshake until the SAS happens to match.
        </p>
        <p style={{ marginBottom: "16px" }}>
          An attacker who <em>does</em> know the phrase has no need to
          attack the handshake — they are already inside the room. So
          the Duet is not an independent layer of defense stacked on top
          of the phrase. It is a verification that the phrase-derived
          channel was not subverted in transit.
        </p>
        <p style={closingLineStyle}>
          If the phrase leaks, the Duet does not save you. The phrase is
          the boundary. The Duet checks that the boundary held.{" "}
          <span style={{ color: "#9C8E7A" }}>(Audit §10.1.)</span>
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Browser-level surfaces */}
      {/*
        Anchor target for the join-screen first-paste clipboard toast
        (Task #250). The toast links here as
        `/threat-model#browser-level-surfaces` so a user who taps "READ MORE"
        lands on this section header. Renaming or removing this id will
        break that deep-link.
      */}
      <div id="browser-level-surfaces" style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> BROWSER-LEVEL SURFACES
        </div>
        <p style={{ marginBottom: "16px" }}>
          The four items above are about VOID. The six items below are
          about the browser in which VOID runs.
        </p>
        <p style={{ marginBottom: "24px" }}>
          None of these are VOID bugs. They are properties of running
          anything inside a modern web browser. The mitigations are
          configuration choices on your end, not code we can ship.
        </p>

        {/* DNS */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          1. DNS LOOKUPS REVEAL THE DOMAIN
        </p>
        <p style={{ marginBottom: "16px" }}>
          When your browser opens a VOID room, it first asks a DNS
          resolver where the operator’s domain lives. That resolver —
          your ISP, your mobile carrier, the captive Wi-Fi portal in the
          coffee shop, whoever your device is configured to ask — now
          has a record that your device looked up VOID at time T. The
          adversary is the local network or its upstream: an ISP
          retaining query logs, a workplace network logging DNS, an
          attacker on the same Wi-Fi running a hostile resolver.
        </p>
        <p style={{ marginBottom: "24px" }}>
          To mitigate, turn on DNS-over-HTTPS at the operating-system
          or browser level. Firefox: Settings → Privacy &amp; Security →
          DNS over HTTPS. Chrome and Edge: Settings → Privacy and
          security → Use secure DNS. On a VPN, confirm the VPN actually
          carries DNS through the tunnel rather than leaking it to the
          local resolver — most VPN clients have a “DNS leak” check
          or the same setting in their preferences. For the strongest
          posture, route through Tor, which carries DNS for you.
        </p>

        {/* Clipboard */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          2. THE CLIPBOARD IS READABLE BY EXTENSIONS
        </p>
        <p style={{ marginBottom: "16px" }}>
          When you paste a VOID Phrase into the join field, anything
          you copied lives on the system clipboard for as long as the
          clipboard holds it. Every browser extension installed with
          the <span style={tealText}>clipboardRead</span> permission
          can read it. The same applies to the two SAS words if you
          ever copy those. The realistic adversary is not a state
          actor — it is a free extension that asked for clipboard
          access at install time and got it because the user clicked
          “Add to Chrome.” There are tens of thousands of those.
        </p>
        <p style={{ marginBottom: "24px" }}>
          The honest mitigation is operational, not technical: use a
          separate browser profile with no extensions installed for
          high-sensitivity rooms, or manually clear the clipboard after
          paste by copying a single neutral character over it. A
          hardware password manager does <em>not</em> solve this — it
          protects the vault, not the clipboard contents after the
          paste happens.
        </p>

        {/* Notifications */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          3. NOTIFICATIONS ARE READABLE BY EXTENSIONS
        </p>
        <p style={{ marginBottom: "16px" }}>
          When VOID shows a desktop notification — a guest knocking, a
          last-chance room warning, a peer arriving — any browser
          extension with notification-API access can read the
          notification text and the origin that fired it. The adversary
          is the same as above: an extension installed for an
          unrelated reason that quietly observes notifications across
          every site.
        </p>
        <p style={{ marginBottom: "24px" }}>
          To mitigate, deny VOID the notification permission in the
          browser’s site settings and rely on the in-tab UI. The room
          is more attentive when the tab is in front anyway.
        </p>

        {/* Extension DOM */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          4. EXTENSIONS WITH ALL-SITES PERMISSION READ THE ROOM PAGE
        </p>
        <p style={{ marginBottom: "16px" }}>
          Any browser extension installed with{" "}
          <span style={tealText}>&lt;all_urls&gt;</span> host permission
          has DOM-level read access to every page in the browser,
          including the VOID room page. That includes the phrase as
          displayed in the address bar handler, the SAS words on
          screen, the peer list, and any text the UI is showing. The
          adversary is whoever ships that extension — which, again, is
          a long list of mostly-benign-looking software the user
          accepted at install time.
        </p>
        <p style={{ marginBottom: "24px" }}>
          The mitigation is structural: install no extensions in the
          browser profile you use for VOID, or use a clean profile —
          most browsers support multiple profiles, and creating one
          takes a minute. For the strongest posture, a private-window
          session denies extension access by default unless the user
          has explicitly enabled them in private windows.
        </p>

        {/* WebRTC getStats */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          5. WEBRTC METADATA IS READABLE BY DEBUGGER-CAPABLE EXTENSIONS
        </p>
        <p style={{ marginBottom: "16px" }}>
          Browser extensions with the{" "}
          <span style={tealText}>debugger</span> permission, or with
          page-content access to the room page, can call{" "}
          <span style={tealText}>RTCPeerConnection.getStats()</span> on
          any active WebRTC connection in the page context. That
          returns ICE candidate types, bytes-received, jitter, packet
          loss, frame rate, and other connection-level metadata. It
          does <em>not</em> give them the keys or the media. It does
          give them the shape of the call — peer counts, traffic
          patterns, whether a TURN relay is in use.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Same mitigation as the previous two items: use a profile
          with no debugger-capable extensions for sensitive rooms.
          Browser developer-tools panels can also call{" "}
          <span style={tealText}>getStats()</span> directly, which
          matters when sharing your screen — do not present a screen
          share with the WebRTC internals panel open.
        </p>

        {/* Managed-browser getUserMedia logging */}
        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          6. ENTERPRISE-MANAGED BROWSERS LOG CAMERA AND MIC GRANTS
        </p>
        <p style={{ marginBottom: "16px" }}>
          Some browsers — and most enterprise-managed deployments
          (Chrome Enterprise, Edge for Business, MDM-installed
          profiles) — log{" "}
          <span style={tealText}>getUserMedia</span> permission grants
          with timestamp and origin. That log may be shipped to the
          enterprise administrator, the browser vendor, or both. The
          adversary is the employer who can see “this employee
          authorized camera and mic for the VOID origin at 11:42 on
          Tuesday.” The fact of the call, and which origin asked for
          the mic, is in the record.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Do not use an employer-managed browser for personal-privacy
          use. Use a personal browser on a personal device — or, if
          the device itself is managed, use a different device. There
          is no software fix to a managed browser doing what its
          management policy tells it to do.
        </p>

        <p style={closingLineStyle}>
          We name these because we would rather you hear them from us
          than discover them after a call.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What VOID won't fix in v0.5.

          This section is the published inverse of the internal launch
          checklist (Task #316). Every item below corresponds to either a
          checked line on that checklist (we shipped a verification, not a
          fix) or an explicitly-deferred line. If you are editing this list,
          read the brief at the top of the internal launch checklist and the
          regression-test failure message in
          `__tests__/threatModelWontFix.test.tsx` before changing
          anything. */}
      <div style={sectionStyle} data-testid="wont-fix-section">
        <div style={subheadingStyle} data-testid="wont-fix-heading">
          <span style={goldText}>▌</span> WHAT VOID WON’T FIX IN v0.5
        </div>
        <p style={{ marginBottom: "16px" }}>
          We would rather ship the smallest version of VOID we are
          proud of than spend another year chasing every shape of
          private call we can imagine. The list below is the cost of
          that choice: real limitations of v0.5 that we know about,
          have decided not to close in this release, and are naming
          here on purpose. This list is the inverse of our internal
          launch checklist; the two are kept in sync — when something
          moves, it moves between them.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE 4-USER ROOM CAP
        </p>
        <p style={{ marginBottom: "24px" }}>
          Rooms are capped at four humans. Past four, the WebRTC mesh
          burns CPU and uplink on every participant — we would rather
          refuse a fifth peer than ship a five-person call that hisses
          and stutters on the laptops the average person owns. If your
          shape is many-to-one (a presenter to a quiet audience),
          v0.5 is not the right tool — VOID is built for small,
          symmetric calls. The underlying mesh-topology trade-off is
          documented in <code style={{ color: "var(--gold)" }}>VOID_TECHNICAL_OVERVIEW.md</code>{" "}
          §”Mesh topology”.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE BROWSER FRAGMENT LEAK (MITIGATED, NOT ELIMINATED)
        </p>
        <p style={{ marginBottom: "24px" }}>
          The VOID Phrase rides in the URL fragment — the bit after
          the <code style={{ color: "var(--gold)" }}>#</code>. Browsers
          do not transmit fragments to servers, and we replace the
          fragment-bearing entry from history when you leave (audit
          finding M-03, closed). What we cannot reach is anything that
          already snapshotted the URL while it was visible: a
          password-manager autofill capture, a screenshot tool, an OS
          share sheet’s “recent shares” list, a browser sync that
          mirrored a tab to another device. The full description is in{" "}
          <span style={tealText}>FOUR THINGS WORTH NAMING DIRECTLY</span>{" "}
          item 3 above; the underlying analysis lives in
          <code style={{ color: "var(--gold)" }}> docs/security-audit-public-2026-04.md </code>
          §4.1.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          SIGNALING-SERVER CONNECTION METADATA
        </p>
        <p style={{ marginBottom: "24px" }}>
          The signaling server cannot read any content — not the
          phrase, not the SAS, not the SDP, not a single audio frame.
          It can correlate connection metadata: which IP joined which
          room ID, when, and for how long. This is the price of being
          a relay; the full enumeration is in{" "}
          <span style={tealText}>WHAT THE SERVER SEES</span> at the
          top of this page. The operator-side option is the
          Tor-mirror runbook in
          <code style={{ color: "var(--gold)" }}> docs/onion-mirror-runbook.md </code>
          (Task #263), which moves the IP visibility off the
          signaling server. It does not eliminate the metadata; it
          changes who sees it.
        </p>

        <p
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}
          data-testid="signaling-envelope-heading"
        >
          THE SIGNALING WEBSOCKET CARRIES NO USER CONTENT
        </p>
        <p style={{ marginBottom: "12px" }} data-testid="signaling-envelope-body">
          “Cannot read any content” is a strong claim. Here is the
          proof shape. Every event that crosses our signaling
          WebSocket is one of three things: a room-lifecycle marker
          (<code style={{ color: "var(--gold)" }}>join-room</code>,
          {" "}<code style={{ color: "var(--gold)" }}>leave-room</code>,
          {" "}<code style={{ color: "var(--gold)" }}>room-extended</code>),
          a connection-state flag (mute on/off, cam on/off, voice-mode
          index, screen-share start/stop), or an AES-GCM-encrypted
          relay (<code style={{ color: "var(--gold)" }}>relay-signal</code>)
          whose key is derived from the URL-fragment phrase the server
          never sees. There is no{" "}
          <code style={{ color: "var(--gold)" }}>emit(“chat”, …)</code>,
          no <code style={{ color: "var(--gold)" }}>emit(“transcript”, …)</code>,
          no <code style={{ color: "var(--gold)" }}>emit(“file”, …)</code>,
          and no <code style={{ color: "var(--gold)" }}>emit(“frame”, …)</code>
          {" "}anywhere in the codebase. VOID has no in-call chat,
          poll, or shared-document feature; we are not claiming
          end-to-end encryption for features that do not exist.
        </p>
        <p style={{ marginBottom: "12px" }}>
          Audio and video themselves never touch the WebSocket at
          all. They ride{" "}
          <span style={tealText}>DTLS-SRTP</span> (encrypted media,
          browser-to-browser). The handful of data channels this
          codebase opens — the agent SDK’s{" "}
          <code style={{ color: "var(--gold)" }}>void.control</code>{" "}
          and <code style={{ color: "var(--gold)" }}>void.rpc</code>,
          plus a no-payload{" "}
          <code style={{ color: "var(--gold)" }}>“probe”</code>{" "}
          channel used only to trigger ICE gathering — ride{" "}
          <span style={tealText}>DTLS-over-SCTP</span> on the same
          encrypted association. The signaling server cannot decrypt
          either path; it forwards opaque ciphertext.
        </p>
        <p style={{ marginBottom: "24px" }}>
          The exhaustive enumeration — every event name, every
          payload, every data-channel label — is in{" "}
          <code style={{ color: "var(--gold)" }}>docs/signaling-envelope-audit.md</code>.
          A repo-wide static check
          (<code style={{ color: "var(--gold)" }}>check:signaling-envelope</code>,
          wired into the <code style={{ color: "var(--gold)" }}>marketing-voice</code>{" "}
          CI gate) fails the build if a new event name or
          data-channel label appears that is not in the audit’s
          whitelist. A future contributor who adds an{" "}
          <code style={{ color: "var(--gold)" }}>emit(“chat”, …)</code>{" "}
          cannot land that change without also updating the audit
          doc — which is the signal the next reviewer needs.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          LIGHTNING ROUTE OBSERVABILITY FOR THE HOST
        </p>
        <p style={{ marginBottom: "24px" }}>
          The Lightning paywall has random per-invoice memos (Task
          #282) and a 10–60 second jitter between settlement and
          room-creation (audit finding M-04), which together close
          the static-string and sub-second-timing leaks against a
          passive observer. What they do not close is the host’s own
          Lightning node — the node that receives the payment sees
          the incoming sat amount and timing in its own logs, the
          same way any merchant node would. If you are the operator
          and you are also the payee, your node knows you got paid.
          That is intrinsic to running a Lightning endpoint, not a
          VOID code defect.
        </p>

        <p
          style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}
          data-testid="wont-fix-screen-recording-heading"
        >
          SCREEN RECORDING BY PARTICIPANTS
        </p>
        <p style={{ marginBottom: "24px" }} data-testid="wont-fix-screen-recording">
          A participant in your call can press their OS screen
          recorder, point a second device at the screen, or run any
          number of local capture tools. There is no DRM model that
          solves this for browser-based video, and we will not
          pretend otherwise — the people who claim to solve it are
          shipping security theater. The honest version is on the
          biometric page under <span style={tealText}>WHAT THIS DOES NOT DO</span>:
          local masking reduces what a recording captures of you, but
          it does not stop the recording. If you do not trust the
          person on the other end of the call to behave, no software
          will fix that.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          MEDIA-PATH TOR COVERAGE
        </p>
        <p style={{ marginBottom: "24px" }}>
          Tor protects how you reach VOID’s signaling layer; it does
          not protect the WebRTC media path. ICE candidates are
          gathered on your underlying network regardless of how the
          page loaded, so peer-to-peer media still leaks your
          clearnet IP to other peers unless relay-only is enabled —
          and even then, TURN-relayed media costs latency. The
          unified explanation is the{" "}
          <span style={tealText}>TOR AND THE MEDIA PATH</span>{" "}
          paragraph above (Task #261). If you need both peer-IP
          privacy and call quality, those are competing requirements.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          MOBILE SAFARI INDICATOR BEHAVIOUR AFTER BURN
        </p>
        <p style={{ marginBottom: "24px" }}>
          When you press BURN on iOS Safari, the local microphone
          track is genuinely stopped — the browser releases the
          device. The orange microphone dot in the iOS status bar can
          linger for a few seconds afterwards because Safari refreshes
          the system indicator on its own cadence, not on ours. The
          long form is in <span style={tealText}>Camera and microphone after BURN</span>{" "}
          above (Task #280). The track is off; the indicator catches
          up shortly.
        </p>

        <p style={closingLineStyle}>
          If your threat model requires any of the above, VOID v0.5
          is not the right tool for you.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Supply chain — task #383 */}
      <div id="supply-chain" style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> SUPPLY CHAIN — VERIFYING THE BUNDLE
        </div>
        <p style={{ marginBottom: "16px" }}>
          Everything else on this page assumes the JavaScript your
          browser executed is the JavaScript we wrote. That assumption
          is not free. A self-host story is only worth the bytes it
          ships, so we publish the bytes and tell you how to check them.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          WHAT EVERY RELEASE PUBLISHES
        </p>
        <p style={{ marginBottom: "16px" }}>
          The Node and pnpm toolchain is pinned to exact versions
          (Node <span style={tealText}>22.12.0</span>, pnpm{" "}
          <span style={tealText}>10.26.1</span>) across the
          Dockerfile, every CI workflow, and{" "}
          <span style={tealText}>package.json</span>. The Docker base
          image is pinned by digest at release time. Each tagged
          release attaches a <span style={tealText}>SHA256SUMS</span>{" "}
          file covering every file in the client bundle, a cosign
          keyless signature bound to the GitHub release workflow that
          produced it, and SLSA build provenance you can verify with{" "}
          <span style={tealText}>gh attestation verify</span>. No
          long-lived signing key sits anywhere — the certificate is
          tied to the workflow run identity itself.
        </p>
        <p style={{ marginBottom: "24px" }}>
          A second CI job rebuilds the bundle in a clean container
          from the same git SHA and diff-asserts the resulting{" "}
          <span style={tealText}>SHA256SUMS</span> byte-for-byte
          against the released one. If a build-step non-determinism
          ever sneaks in, the release fails loudly rather than
          publishing an unverifiable bundle.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          WHAT THIS SERVER CLAIMS RIGHT NOW
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={tealText}>GET /api/proof/build</span> returns
          the git SHA, build timestamp, Node version, and the per-file
          sha256 map for the client bundle this server is currently
          serving. A short caveat travels with the response — read it.
          It says exactly what this endpoint can and cannot prove.
        </p>
        <p style={{ marginBottom: "24px" }}>
          The in-app{" "}
          <a
            href="/proof/runtime"
            style={{ color: "var(--gold)", textDecoration: "underline" }}
          >
            /proof/runtime
          </a>{" "}
          page goes further: it asks the browser to hash the JS and
          CSS your current session actually loaded (using{" "}
          <span style={tealText}>crypto.subtle.digest</span>) and
          compares each one against the published map, row by row. You
          are verifying what your browser ran, not what we said we
          shipped.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          BUILD PROVENANCE AND THE DEPENDENCY LIST (M-6 / M-7)
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={tealText}>GET /api/provenance.json</span> returns
          the commit, build timestamp, builder identity, and the SHA-384
          Subresource Integrity digest of every asset under{" "}
          <span style={tealText}>/assets/</span> in the bundle this
          server is currently serving — byte-identical to the{" "}
          <code style={{ color: "var(--gold)" }}>integrity=”sha384-…”</code>{" "}
          attributes stamped into the served{" "}
          <code style={{ color: "var(--gold)" }}>index.html</code>. The
          response is cacheable for one hour because provenance for a
          given commit is immutable. Cross-verify by comparing the
          fields against the cosign-signed{" "}
          <span style={tealText}>provenance.json</span> release asset
          for the same commit.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Each tagged release also attaches a CycloneDX Software Bill
          of Materials (<span style={tealText}>sbom.cdx.json</span>)
          enumerating the resolved dependency tree against the frozen
          lockfile. It is cosign-signed at release time using the same
          keyless OIDC flow as <span style={tealText}>SHA256SUMS</span>,
          so the verify recipe in{" "}
          <span style={tealText}>README-selfhost.md</span> §7a applies
          unchanged to <span style={tealText}>sbom.cdx.json.sig</span>{" "}
          / <span style={tealText}>sbom.cdx.json.pem</span>.
        </p>

        <p style={{ marginBottom: "4px", ...subheadingStyle, fontSize: "12px", marginTop: "0" }}>
          THE LIMIT, NAMED
        </p>
        <p style={{ marginBottom: "16px" }}>
          A targeted attacker who controls the network edge between
          you and this server can rewrite both the JS bundle and the{" "}
          <span style={tealText}>/api/proof/build</span> response
          together. Subresource integrity on the entry HTML protects
          asset-level tampering only as long as the entry HTML itself
          is honest. None of the layers above, on their own, defeat a
          bespoke malicious bundle delivered to one user.
        </p>
        <p style={{ marginBottom: "24px", color: "var(--teal)", letterSpacing: "1px" }}>
          The check that does defeat it is a ritual, not a feature:
          run <span style={tealText}>/proof/runtime</span> on a
          network you don’t normally use (mobile data, a friend’s
          machine, a Tor exit) and confirm both sessions report the
          same git SHA and the same matches against the cosign-signed{" "}
          <span style={tealText}>SHA256SUMS</span> for the same
          release tag. The full rebuild recipe is in §7a of{" "}
          <span style={tealText}>README-selfhost.md</span>.
        </p>

        <p style={{ marginBottom: "16px" }}>
          We name the limit because pretending it isn’t there would
          be the same kind of vagueness we said we wouldn’t trade in.
        </p>
        <p style={{ marginBottom: "0" }}>
          As a post-deploy detection layer complementing the
          in-browser integrity-failure overlay, an out-of-band canary
          (a scheduled CI job, not an in-page beacon) fetches the live
          origin from a clean runner and cross-checks every linked
          asset’s SHA-384 against <span style={tealText}>sw-known-hashes.json</span>{" "}
          and <span style={tealText}>/api/provenance.json</span>; a
          mismatch opens a tracked issue against the operator instead
          of waiting for a user to happen onto the broken page.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* The Honest Summary */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE HONEST SUMMARY
        </div>

        <p style={{ marginBottom: "12px", color: "var(--teal)", letterSpacing: "1px" }}>
          VOID is well-designed for:
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "24px",
          }}
        >
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Preventing server-side surveillance and data retention (see the{" "}
            <Link href="/why#what-we-log" style={{ color: "var(--teal)", textDecoration: "underline" }}>
              published log policy
            </Link>{" "}
            for the field-by-field breakdown and the ≤5-day rotation ceiling)
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Preventing biometric capture at the network layer (mode-dependent — see the{" "}
            <Link href="/docs/biometric" style={{ color: "var(--teal)", textDecoration: "underline" }}>biometric page</Link>{" "}
            for the per-mode breakdown)
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Preventing identity linkage through billing on our side — no account, no email, no card; the host pays in Lightning sats and that is the entire transaction. The Lightning network has its own correlation surface, named directly above.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Preventing passive room enumeration
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Providing ephemerality of server-side state as an architectural guarantee rather than a policy promise (does not prevent participants from recording locally)
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={tealText}>→</span> Protecting past sessions from future compromise
          </li>
          <li>
            <span style={tealText}>→</span> Detecting man-in-the-middle attacks through the Duet
          </li>
        </ul>

        <p style={{ marginBottom: "12px", color: "var(--red)", letterSpacing: "1px" }}>
          VOID is not designed for:
        </p>
        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "24px",
          }}
        >
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> Hiding the fact that a connection occurred
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> Protecting against a compromised device
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> Protecting against a malicious participant in the room
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> Providing the level of assurance required for life-safety threat models
          </li>
          <li>
            <span style={redText}>→</span> Replacing operational security practices that exist outside the tool
          </li>
        </ul>

        <p style={{ marginBottom: "16px" }}>
          A tool does what it does.
        </p>
        <p style={{ marginBottom: "16px" }}>
          We are the lock on the door, and we are a good lock. But we are not
          responsible for the window.
        </p>
        <p style={{ marginBottom: "24px", color: "var(--gold)" }}>
          Howard should have closed the window.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            justifyContent: "center",
          }}
        >
          <Link
            href="/"
            style={{
              border: "2px solid var(--gold)",
              padding: "12px 20px",
              color: "var(--gold)",
              textDecoration: "none",
              fontSize: "12px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            START A ROOM
          </Link>
          <Link
            href="/compare"
            style={{
              border: "2px solid var(--burnt)",
              padding: "12px 20px",
              color: "var(--burnt)",
              textDecoration: "none",
              fontSize: "12px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
            }}
          >
            WHY NOT ZOOM?
          </Link>
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            style={{
              border: "2px solid var(--fg-dim)",
              padding: "12px 20px",
              color: "var(--fg-dim)",
              textDecoration: "none",
              fontSize: "12px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              opacity: 0.6,
              cursor: "default",
            }}
          >
            SELF-HOST VOID
          </a>
        </div>
      </div>

    </PageShell>
  );
}
