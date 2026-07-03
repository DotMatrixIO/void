// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import OpenBetaCaption from "@/components/OpenBetaCaption";
import KeyDerivationDiagram from "@/components/short-form/KeyDerivationDiagram";
import {
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  sectionStyle,
  plainSectionStyle,
  withScrollOffset,
  tealText,
  goldText,
  burntText,
} from "@/components/longFormStyles";

// Long-form HOW IT WORKS page. Replaced the prior /docs/why page —
// /why now carries the short "Conversations belong to the people having
// them" prose (Gameboy origin), and this page is the wonkish details
// (Promise vs Proof, Philosophy, Stateless Architecture, What We Log,
// VOID Phrase, Encryption, Video Filters, Voice Masks, Closing).
//
// Anchor IDs match the prior /docs/why anchors so the redirect from
// /why#<anchor> → /docs/how-it-works#<anchor> (via anchorRedirects.ts)
// and any direct /docs/why#<anchor> bookmark continue to land on the
// right section.

// Body type comes from the shared long-form module so it can't drift from
// the rest of the docs. The only page-specific need is a scroll offset:
// every section here is a deep-link target (/docs/how-it-works#<anchor>),
// so we wrap the shared recipes with withScrollOffset() instead of
// re-declaring the type scale locally.
const pavementSection = withScrollOffset(sectionStyle);
const plainSection = withScrollOffset(plainSectionStyle);

const wonkishDividerStyle: React.CSSProperties = {
  maxWidth: "680px",
  width: "100%",
  padding: "32px 24px 12px",
  backgroundColor: "var(--surface-dark)",
  textAlign: "center",
  color: "var(--gold)",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "4px",
  textTransform: "uppercase",
  borderTop: "1px solid rgba(232,162,0,0.4)",
  borderBottom: "1px solid rgba(232,162,0,0.4)",
  marginTop: "16px",
};

const redText: React.CSSProperties = { color: "var(--red)" };

const snowdenBoxStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  lineHeight: "1.5",
  color: "var(--gold)",
  border: "2px solid var(--gold)",
  backgroundColor: "rgba(232,162,0,0.04)",
  whiteSpace: "pre",
  letterSpacing: "0",
  overflow: "auto",
  padding: "16px",
};

export default function DocsHowItWorksPage() {
  return (
    <PageShell backHref="/how-it-works" backLabel="← BACK TO SHORT VERSION">
      {/* v0.6 / open beta acknowledgement — sits under the hamburger
          in the normal scrollable flow (not sticky). */}
      <OpenBetaCaption data-testid="docs-how-v05-acknowledgement" />

      {/* Opening — promise-vs-proof framing prose, attributed to Jeff
          Swanson on first use (the rhetorical move is his). The explicit
          "PROMISE VS PROOF" subhead was removed per user request; the
          page title HOW IT WORKS now stands alone. Pavement. */}
      <div style={pavementSection}>
        <div style={headingStyle}>HOW IT WORKS</div>

        <p style={{ marginBottom: "16px" }}>
          Jeff Swanson distinguishes between promises and proofs.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A promise is something a corporation makes, in a document nobody
          reads, in language crafted by people who craft language. They mean
          it, sometimes, until the acquisition goes through and you notice
          the promise was very carefully worded.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A proof is different. A proof is more like math, and math does not
          have a legal team.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID is — technically speaking — an ephemeral, encrypted, peer-to-peer
          communication channel. No accounts. No recording. No transcript. No
          record of what was said by whom. This is not because we are
          trustworthy. It’s because the architecture makes retention
          impossible. There is a difference.
        </p>
        <p style={{ marginBottom: "16px" }}>
          For instance, there’s no chat or messenger. Instead, there’s a single
          shared field — <span style={goldText}>DROP</span>. It has no history,
          and all users can overwrite it. It exists so a URL or a room code can
          be passed from one user to the next. Nothing shared using DROP can be
          saved for later or searched next week.
        </p>
        <p style={{ marginBottom: "16px" }}>
          When a room is live, the relay sees what a relay must see — IP
          addresses, room codes, the timing of joins and leaves (see our{" "}
          <Link href="/threat-model" style={{ color: "var(--teal)", textDecoration: "underline" }}>
            threat model
          </Link>{" "}
          page). When the room closes, the relay forgets. There is no archive.
          Instead, the server has the memory of a goldfish.
        </p>
        <p style={{ marginBottom: "24px" }}>
          Also, the server does not see your video, hear your audio, or hold
          your encryption keys. It cannot decrypt your signaling. The
          compromise of one session does not unlock any previous or future
          session.
        </p>
        <p style={{ marginBottom: "0" }}>
          These are not promises or sincere intentions. They are provable. They
          are architectural constraints.
        </p>
      </div>

      {/* Philosophy — untouched at top, per IA spec. Pavement (keeps its
          existing visual treatment). */}
      <div id="philosophy" style={pavementSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> PHILOSOPHY
        </div>
        <p
          style={{
            fontFamily: "'Staatliches', system-ui, sans-serif",
            fontSize: "clamp(20px, 4.2vw, 30px)",
            letterSpacing: "2px",
            lineHeight: 1.25,
            color: "var(--gold)",
            textTransform: "uppercase",
            margin: "8px 0 24px",
            borderLeft: "4px solid var(--gold)",
            paddingLeft: "16px",
          }}
        >
          “Do not turn a room into a building.”
        </p>
        <p style={{ marginBottom: "20px" }}>
          The Feature Policy is our answer to{" "}
          <em>can you add just one more thing?</em> It names what VOID is for
          and what it will never be for — even when asked nicely.
        </p>
        <a
          href={import.meta.env.BASE_URL + "VOID-Feature-Policy.md"}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            fontFamily: "var(--font-mono)",
            fontSize: "14px",
            fontWeight: 700,
            letterSpacing: "3px",
            textTransform: "uppercase",
            color: "var(--gold)",
            textDecoration: "none",
            border: "2px solid var(--gold)",
            padding: "12px 18px",
            backgroundColor: "rgba(232,162,0,0.04)",
          }}
        >
          READ THE FEATURE POLICY →
        </a>
      </div>

      <div style={wonkishDividerStyle}>WONKISH DETAILS FOR OUR NERDY FRIENDS</div>

      {/* Stateless Architecture — pavement. Reinstated from pre-#545 prose. */}
      <div id="stateless-architecture" style={pavementSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> STATELESS ARCHITECTURE
        </div>
        <p style={{ marginBottom: "16px" }}>A database is a liability.</p>
        <p style={{ marginBottom: "16px" }}>
          It can be breached, subpoenaed, or leaked accidentally at three in
          the morning by a junior engineer.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID has a server. The server is a relay. It passes encrypted
          signals between peers and then forgets, the way a wire forgets the
          current that passed through it yesterday. It cannot decrypt your
          signaling. It never receives your media. It sees the IP that
          connected, the room code, and the timing — because that is what
          relays see (See{" "}
          <Link href="/threat-model" style={{ color: "var(--teal)", textDecoration: "underline" }}>
            threat model
          </Link>{" "}
          page). A <span style={tealText}>Lightning L402 paywall</span>{" "}
          receives a Bitcoin payment and opens a room. No names needed. No
          accounts required. The sats move, and the door opens.
        </p>
        <ul style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> No user accounts
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> No message history
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> No application-level metadata retention
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> Ephemeral 4-person rooms
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> Stateless JWT authentication
          </li>
          <li>
            <span style={burntText}>→</span> Lightning L402 paywall — pay to
            create, no identity required
          </li>
        </ul>
        <p style={{ marginBottom: "0" }}>
          Once the room closes, the relay intentionally forgets its in-memory
          room state.
          The shape — that a connection happened, between which IPs, at what
          time, and that a Lightning payment opened the door — was visible
          to the relay and to the network while the room was live. We find
          this reasonable.
        </p>
      </div>

      {/* What We Log — plain. Reinstated from pre-#545 prose (Task #374
          published log policy). */}
      <div id="what-we-log" style={plainSection} data-testid="what-we-log-section">
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT WE LOG
        </div>
        <p style={{ marginBottom: "16px" }}>
          The relay keeps the bare minimum it takes to run a public service
          and intentionally forgets it within five days. We publish the rule here so the
          policy matches the wire, and we enforce the ceiling with log
          rotation on the production box — not as a promise, as a setting.
        </p>

        <p style={{ marginBottom: "12px", color: "var(--teal)", letterSpacing: "1px" }}>
          KEPT — ROTATED OUT WITHIN 5 DAYS
        </p>
        <ul style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "20px" }}>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> Timestamp, client IP (used by the
            per-IP rate limiter), HTTP method, path, and status code for each
            request.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={burntText}>→</span> Socket.io connection lifecycle
            events — a connect, a join, a leave, a disconnect, and the per-IP
            open-connection count at the time.
          </li>
          <li>
            <span style={burntText}>→</span> The room code on{" "}
            <em>error-path</em> lines only (4xx, 5xx, malformed-code
            rejections) so an operator triaging a real client error can
            correlate it with the room that failed.
          </li>
        </ul>

        <p style={{ marginBottom: "12px", color: "var(--red)", letterSpacing: "1px" }}>
          NEVER KEPT
        </p>
        <ul style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "20px" }}>
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> The six-word{" "}
            <span style={tealText}>VOID Phrase</span>. It is carried in the
            URL fragment and never sent to the server in the first place —
            there is nothing for the log to omit.
          </li>
          <li style={{ marginBottom: "6px" }}>
            <span style={redText}>→</span> WebRTC signaling payloads (SDP,
            ICE candidates). They pass through the relay end-to-end encrypted
            and are not written to disk.
          </li>
          <li>
            <span style={redText}>→</span> The room code on{" "}
            <em>success-path</em> access lines and on success-path socket
            lifecycle lines. Where it would otherwise appear, the logger
            writes <span style={tealText}>&lt;room-id&gt;</span> in its place.
            This is enforced by tests on the access-log middleware and the
            socket lifecycle logger; remove the scrub and the build fails.
          </li>
        </ul>

        <p style={{ marginBottom: "12px", color: "var(--gold)", letterSpacing: "1px" }}>
          RETENTION CEILING
        </p>
        <p style={{ marginBottom: "16px" }}>
          Five days — compatible with the{" "}
          <span style={tealText}>EFF Do-Not-Track</span> retention model (see
          the threat model page for the longer walk-through). The production
          box enforces it with{" "}
          <span style={tealText}>logrotate</span> — see{" "}
          <code style={tealText}>deploy/logrotate.d/void</code> in the source
          tree. Self-hosters who use <span style={tealText}>journald</span>{" "}
          instead set <code style={tealText}>MaxRetentionSec=5day</code>;
          same ceiling, different file.
        </p>

        <p style={{ marginBottom: "0" }}>
          The longer, surface-by-surface walk-through — who sees what at each
          layer, including the parts the relay never touches — lives on the{" "}
          <Link href="/threat-model" style={{ color: "var(--teal)", textDecoration: "underline" }}>
            threat model
          </Link>{" "}
          page.
        </p>
      </div>

      {/* The VOID Phrase — pavement. */}
      <div id="the-void-phrase" style={pavementSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> THE VOID PHRASE
        </div>
        <p style={{ marginBottom: "16px" }}>Every session begins with six words.</p>
        <p style={{ marginBottom: "16px" }}>
          There are no usernames or passwords or nosy security questions about
          maiden names.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The six words are drawn from a list called{" "}
          <span style={tealText}>BIP-39</span>, carrying approximately{" "}
          <span style={tealText}>66 bits of chaos</span>, which is a way of
          saying that the number of possible phrases is so large that if you
          tried to guess one by brute force you would run out of time.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The phrase never leaves your machine. This is not a policy. It is a
          specification of the web itself. The portion of a web address that
          follows the <span style={tealText}>#</span> character is never
          transmitted in an HTTP request. Your server logs will not contain
          it. Our server won’t see it. A surveillance tap on the wire between
          you and us sees nothing usable. The phrase moves through the world
          the way a secret moves between people who trust each other.
        </p>
        <p style={{ marginBottom: "16px" }}>It is spoken. Then it is gone.</p>
        <p style={{ marginBottom: "16px" }}>
          You can share it the old way if you want to. Say it out loud. Write
          it on paper. Send it through some channel you already trust. Anyone
          with the phrase can enter the room. Anyone without it cannot.
        </p>
        <p style={{ marginBottom: "0", fontStyle: "italic", color: "#9C8E7A" }}>
          This is how things used to work, I am told, when we held the keys to
          our own doors.
        </p>
      </div>

      {/* Encryption — plain. SVG diagram replaces the prior ASCII block. */}
      <div id="encryption" style={plainSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> ENCRYPTION
        </div>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Perfect Forward Secrecy</span> means, in
          plain language, that the past is sealed against the future. What is
          done is done and cannot be undone, or truly known by anyone who
          wasn’t there.
        </p>
        <p style={{ marginBottom: "20px", fontStyle: "italic", color: "#9C8E7A" }}>
          This strikes us as civilized.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The VOID Phrase is processed through something called{" "}
          <span style={tealText}>Argon2id</span> — a memory-hard function that
          requires 64 megabytes of RAM and three sequential passes per
          attempt. This is a deliberate, expensive computation. It is designed
          to ensure that brute-force attacks cost more time, memory, and
          electricity than they are worth. This is our way of being rude to
          people who want to break in.
        </p>
        <p style={{ marginBottom: "16px" }}>
          From this, HKDF domain separation produces two distinct keys:
        </p>
        <ul style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}>
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>VOID-ECDHE-v1</span> — Session encryption
            key (ECDHE Perfect Forward Secrecy)
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>VOID-SAS-v1</span> — Short Authentication
            String for visual peer verification
          </li>
        </ul>
        <p style={{ marginBottom: "20px" }}>
          Every call generates fresh, ephemeral keys. When the room closes,
          those keys are destroyed. No archives exist. No recovery paths
          exist. A recording of your encrypted session captured from the wire
          today cannot be decrypted tomorrow, even if someone obtains the
          phrase a year from now.
        </p>

        <KeyDerivationDiagram />
      </div>

      {/* Video Filters — pavement. */}
      <div id="video-filters" style={pavementSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> VIDEO FILTERS
        </div>
        <p style={{ marginBottom: "16px" }}>
          Here is something most people do not think about until they have
          reason to.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A face is not neutral information. It carries geography and age and
          the specific geometry of bone that lets a machine locate you in a
          database of ten million strangers in approximately four seconds.
          This capability exists right now. It is being used. It will not
          stop being used because we find it uncomfortable.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID processes all video locally, through{" "}
          <span style={tealText}>WebGL shaders</span> running on your own
          hardware, before a single frame reaches the network. Six modes.
          Five of them remove something a surveillance system would very much
          like to have. The sixth — <span style={tealText}>CLEAR</span> —
          does not. The protection is the choice you make when you pick a
          mode.
        </p>

        <p style={{ marginBottom: "12px" }}>
          <span style={goldText}>GOLD</span> — The signature look. Luminance
          mapped to a warm gold-and-dark palette. Beautiful, and stripped of
          the color gradients that render things like the frequencies of your
          home’s LED lights as identifiable, and often locatable on a map. We
          are fond of this one. It makes everyone look like they are worth
          knowing.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={burntText}>PIXEL</span> — Your image reduced to a 40×30
          grid of color-quantized cells. Presence without detail. A person in
          a room.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={{ color: "#fff" }}>CONTOUR</span> — Sobel edge
          detection draws only the outlines of your form in white against
          black. The silhouette of a human being. Very strange — not the raw
          material of facial recognition.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={{ color: "#d9d9d9" }}>SILHOUETTE</span> — A grayscale
          threshold mask. Shape remains. Features do not. You are a
          person-shaped thing in a room.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={goldText}>ASCII</span> — We like this one. Your image
          converted in real time through a 16-character font atlas. You become
          text on a screen. There is something funny and correct about
          turning a human face into punctuation. We are all such characters.
        </p>
        <p style={{ marginBottom: "16px" }}>
          And finally: <span style={tealText}>CLEAR</span> — Your unmodified
          camera feed. No filters, no stylization. Still rendered at 320×240
          at 15 frames per second, which is below the fidelity that renders
          you easily searchable, but enough to see a face. Use it when you
          want to be seen as you are. We will not judge you. We are not in
          the judging business.
        </p>
        <p style={{ marginBottom: "0", color: "#9C8E7A", fontStyle: "italic" }}>
          A note on strength. The modes are not equivalent.{" "}
          <span style={{ color: "#fff" }}>CONTOUR</span> and{" "}
          <span style={goldText}>ASCII</span> strip the most biometric
          utility. <span style={goldText}>GOLD</span>,{" "}
          <span style={burntText}>PIXEL</span>, and{" "}
          <span style={{ color: "#d9d9d9" }}>SILHOUETTE</span> reduce that
          utility without erasing it.{" "}
          <span style={tealText}>CLEAR</span> transmits your face. The{" "}
          <Link href="/biometric-masking" style={{ color: "var(--teal)", textDecoration: "underline", fontStyle: "normal" }}>
            biometric page
          </Link>{" "}
          has the per-mode breakdown.
        </p>
      </div>

      {/* Voice Masks — plain. */}
      <div id="voice-masks" style={plainSection}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> VOICE MASKS
        </div>
        <p style={{ marginBottom: "16px" }}>
          Your voice is as specific to you as your face.
        </p>
        <p style={{ marginBottom: "16px" }}>
          Its timbre, resonance, and cadences can be matched and searched by
          machines that are very good at this. This is also not going to stop.
        </p>
        <p style={{ marginBottom: "16px" }}>
          VOID’s audio processing runs on a dedicated thread that never
          touches the main application. Five modes:
        </p>

        <p style={{ marginBottom: "12px" }}>
          <span style={tealText}>CLEAR VOICE</span> — Your unmodified voice.
          Use it when you are secure.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={redText}>DEEP</span> — Extreme pitch displacement. The
          voice that comes out is not yours by any measure.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={redText}>FORMANT</span> — Dual-LFO pitch modulation
          over a synthetic carrier. Human in shape. Alien in character. The
          result is the kind of voice that you might hear in a dream.
        </p>
        <p style={{ marginBottom: "12px" }}>
          <span style={redText}>SCRAMBLE</span> — Granular time-shuffling
          with mild pitch shift. Speech stays understandable, but your
          acoustic signatures do not survive. What you mean gets through.
          Who you are does not.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={redText}>COMBINED</span> — DEEP + FORMANT + SCRAMBLE.
          Maximum voice destruction. What comes out is barely recognizable.
        </p>
        <p style={{ marginBottom: "0", color: "#9C8E7A", fontStyle: "italic" }}>
          A note on strength. <span style={tealText}>CLEAR VOICE</span> is a
          passthrough — your unmodified voiceprint goes over the wire. The
          other four progressively destroy that voiceprint, ending in{" "}
          <span style={redText}>COMBINED</span>, which destroys nearly
          everything except the fact of human speech. The{" "}
          <Link href="/biometric-masking" style={{ color: "var(--teal)", textDecoration: "underline", fontStyle: "normal" }}>
            biometric page
          </Link>{" "}
          has the per-mode breakdown.
        </p>
      </div>

      {/* Closing + Snowden box — pavement. */}
      <div style={pavementSection}>
        <p style={{ marginBottom: "24px", color: "#9C8E7A" }}>
          For the cases VOID is not for, the failure modes you should expect,
          and the accessibility tradeoffs of how it looks, see{" "}
          <Link
            href="/limits"
            style={{
              color: "var(--gold)",
              textDecoration: "none",
              borderBottom: "1px solid var(--gold)",
            }}
          >
            what to expect
          </Link>
          .
        </p>

        <pre style={snowdenBoxStyle}>
{`  ┌─────────────────────────────────────────────────────────────────┐
  │                                                                 │
  │   "PRIVACY IS NOT ABOUT SOMETHING TO HIDE.                     │
  │    PRIVACY IS ABOUT SOMETHING TO PROTECT."                      │
  │                                                                 │
  │                              — EDWARD SNOWDEN                   │
  │                                                                 │
  └─────────────────────────────────────────────────────────────────┘`}
        </pre>
      </div>

    </PageShell>
  );
}
