// SPDX-License-Identifier: AGPL-3.0-or-later
import { Fragment, type ReactNode } from "react";
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  dividerStyle,
  tealText,
  goldText,
  burntText,
  linkStyle,
} from "@/components/longFormStyles";
// Shared §3.5 server-observable fragment — same bytes as the overview
// and ThreatModelPage. Drift caught by check:server-observable-sync.
import serverObservableMd from "@docs/_fragments/server-observable.md?raw";
// Disk-logs fragment — the canonical inventory of what the operator
// actually persists, mirroring the rule the access logger enforces in
// artifacts/api-server/src/lib/accessLog.ts. Imported here so this
// page's "what we write to disk" bucket cannot drift from the policy
// the relay actually executes.
import diskLogsMd from "@docs/_fragments/disk-logs.md?raw";

const closingLineStyle: React.CSSProperties = {
  marginBottom: "0",
  fontStyle: "italic",
  color: "#9C8E7A",
};

// Minimal markdown renderer — mirrors the one in ThreatModelPage so the
// shared fragments render with the same typography on both surfaces
// without pulling in a full markdown library. Supports h4 headings, bullet
// lists, paragraphs, and inline `**bold**` / `*italic*` / `` `code` ``.
function renderInlineMarkdown(text: string): ReactNode {
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
        <code key={`md-${key++}`} style={{ color: "var(--gold)" }}>
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

function FragmentProse({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (trimmed.startsWith("#### ")) {
          return (
            <p
              key={i}
              style={{
                ...subheadingStyle,
                fontSize: "12px",
                marginTop: i === 0 ? "0" : "20px",
                marginBottom: "8px",
              }}
            >
              {renderInlineMarkdown(trimmed.slice(5))}
            </p>
          );
        }
        if (trimmed.startsWith("- ")) {
          const items = trimmed
            .split(/\n(?=- )/)
            .map((line) => line.replace(/^- /, ""));
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

export default function LawEnforcementPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      {/* Opening */}
      <div style={sectionStyle}>
        <div style={headingStyle}>LAW ENFORCEMENT GUIDELINES</div>
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
          What we can produce.
          <br />
          And what we can’t.
        </div>

        <p style={{ marginBottom: "16px" }}>
          This page is for users being investigated, and also for the
          officers, prosecutors, lawyers, and process servers on the other
          side of those investigations, who have arrived here because a VOID
          room is mentioned in something they are investigating.
        </p>
        <p style={{ marginBottom: "16px" }}>
          There are three buckets, not two. The server can{" "}
          <em>see</em> more in memory than it actually{" "}
          <em>writes</em> to disk.
        </p>
        <p style={closingLineStyle}>
          Nothing on this page is legal advice. It is an honest description
          of what the running system can and cannot produce under current
          operator configuration.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* 1. WHAT WE CANNOT PRODUCE, EVER */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 1 · WHAT WE CANNOT PRODUCE, EVER (bucket 1)
        </div>
        <p style={{ marginBottom: "16px" }}>
          The items below are architectural, not policy. There is nothing
          for the operator to hand over because the data does not exist on
          the operator’s side of the system, full stop. A subpoena, a
          trap-and-trace order, a pen register, or a National Security
          Letter cannot compel the production of bytes the operator never
          had.
        </p>

        <ul
          data-testid="le-cannot-produce-list"
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
        >
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Plaintext media.</strong> In direct peer-to-peer calls,
            the audio and video never traverse the signaling server at all
            — the packets flow browser-to-browser over SRTP. In TURN-relayed
            calls (or in onion / relay-only mode), the encrypted SRTP
            packets pass through the TURN server, but the operator does not
            hold the SRTP keys and cannot decrypt them.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Decrypted SDP, ICE candidates, or signaling payloads</strong>{" "}
            after end-to-end negotiation. All <code style={{ color: "var(--gold)" }}>relay-signal</code>{" "}
            envelopes are AES-GCM ciphertext under the phrase-derived key
            (and per-peer ECDHE session keys after the key exchange
            completes). The relay forwards opaque bytes.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>VOID phrase contents.</strong> The six-word phrase is
            never sent to the server. The relay sees a 32-character
            lowercase hex room ID derived from the phrase by the client’s
            Argon2id KDF — it is not the phrase and it is not a stored hash
            of the phrase. The operator cannot reverse the room ID to the
            phrase, and cannot produce the phrase to a requester even if
            ordered to.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Call recordings or transcripts.</strong> VOID does not
            record. There is no per-call file, no per-call transcript, no
            per-call summary, no per-call retention setting. None of those
            features exist in the running system.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>DROP-slot history.</strong> The shared DROP slot
            (Task #443) is a single plain-text value that any participant
            can atomically overwrite for everyone. It rides a per-peer
            data channel over DTLS-over-SCTP — the server does not see
            the bytes. There is no history, no per-peer view, no
            late-joiner replay, and no server-side record of what the
            slot ever contained. A subpoena for “the DROP contents at
            HH:MM” finds no file to produce because no file is written.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Kick, mute-others, ban, or any moderation log.</strong>{" "}
            The absence here is structural — there is no kick event for
            us to produce because the mechanism does not exist. VOID has
            no removal primitive at all; the host’s structural answer to
            an unwanted peer is to BURN the session and re-share the
            freshly generated phrase out-of-band to only the people they
            want, which rotates the room ID derived from the phrase. No
            “X kicked Y at HH:MM” record is generated on either side of
            that flow because no such event is emitted.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Account identity.</strong> There are no accounts. There
            is no username, no email, no display name, no avatar, no
            password, no profile, no contact list, no friend graph, and no
            cross-session identifier. A subpoena that asks for “the account
            associated with” anything will find no record to attach to.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Payer identity.</strong> The API server holds no KYC,
            no card details, no billing name, no billing address, and no
            wallet account. Hosting is paid in Lightning sats and the
            operator’s Lightning backend stores a payment hash — see bucket
            4 below for the honest caveat on what that hash can correlate
            with outside VOID.
          </li>
        </ul>

        <p style={{ marginBottom: "0", color: "var(--gold)", letterSpacing: "1px" }}>
          ONE-LINE SUMMARY
        </p>
        <p style={{ marginBottom: "0" }}>
          Connection metadata only; no media, no phrase, no decrypted
          signaling payloads, no account, no billing identity.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* 2. WHAT THE SERVER CAN SEE LIVE */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 2 · WHAT THE SERVER CAN SEE LIVE (bucket 2)
        </div>
        <p style={{ marginBottom: "16px" }}>
          A signaling relay is not a black box. The list below is the same
          canonical §3.5 server-observable fragment used in the technical
          overview and the threat model — imported here verbatim so this
          surface cannot drift from the other two. Read it as{" "}
          <em>what is on the wire in memory while a room is up</em>, not as
          what is written down.
        </p>
        <p
          style={{
            marginBottom: "16px",
            padding: "10px 14px",
            border: "1px solid var(--burnt)",
            background: "rgba(0,0,0,0.25)",
            color: "var(--burnt)",
            letterSpacing: "1px",
            fontSize: "11px",
            textTransform: "uppercase",
          }}
        >
          ▌ SEE-LIVE ≠ WRITE-TO-DISK. SEE BUCKET 3 FOR WHAT IS ACTUALLY
          PERSISTED.
        </p>
        <div data-testid="le-server-observable-fragment">
          <FragmentProse source={serverObservableMd} />
        </div>
      </div>

      <div style={dividerStyle} />

      {/* 3. WHAT WE CURRENTLY WRITE TO DISK */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 3 · WHAT WE CURRENTLY WRITE TO DISK (bucket 3)
        </div>
        <p style={{ marginBottom: "16px" }}>
          The published log-retention policy, imported verbatim from the
          shared disk-logs fragment so this page, the{" "}
          <Link href="/why" style={linkStyle}>
            WHY
          </Link>{" "}
          page’s “WHAT WE LOG” section, and the access logger itself stay
          aligned.
        </p>
        <p
          style={{
            marginBottom: "16px",
            padding: "10px 14px",
            border: "1px solid var(--burnt)",
            background: "rgba(0,0,0,0.25)",
            color: "var(--burnt)",
            letterSpacing: "1px",
            fontSize: "11px",
            textTransform: "uppercase",
          }}
        >
          ▌ SERVER-VISIBLE ROOM-ROUTING EVENTS ARE NOT AUTOMATICALLY
          EQUIVALENT TO DISK LOGS. BUCKET 2 LISTS WHAT THE SERVER CAN IN
          PRINCIPLE SEE; THIS BUCKET LISTS WHAT ACTUALLY ENDS UP ON DISK
          UNDER CURRENT OPERATOR CONFIGURATION.
        </p>
        <div data-testid="le-disk-logs-fragment">
          <FragmentProse source={diskLogsMd} />
        </div>
      </div>

      <div style={dividerStyle} />

      {/* 4. WHAT WE COULD BE COMPELLED TO LOG GOING FORWARD */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 4 · WHAT WE COULD BE COMPELLED TO
          LOG GOING FORWARD
        </div>
        <p style={{ marginBottom: "16px" }}>
          A pen register, a trap-and-trace order, or a similar prospective
          surveillance instrument can compel the operator to begin
          recording — going forward, not retroactively — anything in bucket
          2 that the running process is in a position to observe. The
          honest list of what falls inside that window is below. Naming it
          here is not an invitation; it is the disclosure a serious
          requester is entitled to before drafting an order, and the
          disclosure a serious user is entitled to before relying on the
          system.
        </p>

        <ul
          data-testid="le-could-be-compelled-list"
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
        >
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Future source IPs associated with a specific room ID
            or connection window.</strong> The relay sees the source IP of
            every socket that connects; ordered to record per-room IP
            attribution, the operator can begin doing so for the room ID
            and time window named in the order. Past sessions are out of
            reach because past sessions were not recorded under this rule.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Future connection timings for a specified room ID.</strong>{" "}
            Per-socket connect / join / leave / disconnect timestamps at
            millisecond resolution; the event loop sees them when they
            happen.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Future room-membership counts</strong> for a specified
            room ID — how many peers were in the room at each moment, and
            how that count changed. This is in-memory state on the relay
            today; an order can compel persisting the transitions.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>The specific Lightning payment hash used to authorize
            a specific room creation.</strong> The API server can correlate
            an inbound paywall payment with the room ID created against
            that payment. Cross-reference: depending on the operator’s
            Lightning backend (LND, Core Lightning, NWC, etc.) and node
            setup, that payment hash may already be part of a financial
            trail that lives <em>outside</em> VOID — at the operator’s
            node, at the payer’s wallet, and at any custodial party in
            between. See §4 of the technical overview for the per-backend
            specifics.
          </li>
        </ul>

        <p style={closingLineStyle}>
          We use “specific room ID or connection window” rather than “named
          peer” because there are no named peers — see bucket 1, account
          identity.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* 5. OPERATOR POSTURE */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 5 · OPERATOR POSTURE
        </div>
        <p style={{ marginBottom: "16px" }}>
          What the operator of <em>this</em> deployment will and will not
          do on receipt of a request. Self-hosted deployments make their
          own decisions here — this page describes the posture of the
          deployment serving it.
        </p>

        <p style={{ marginBottom: "8px", color: "var(--gold)", letterSpacing: "1px" }}>
          PROCESS REQUIRED
        </p>
        <ul
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "20px" }}
        >
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span> Formal, signed legal process
            from a jurisdiction with authority over the operator. Informal
            requests — emails from an officer’s personal address, screenshots
            of badges, phone calls — receive no response.
          </li>
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span> The order must name a specific
            room ID or a specific connection window. Requests for “all
            traffic,” “all users,” or “all rooms” cannot be complied with —
            see buckets 1 and 3 for why.
          </li>
          <li>
            <span style={burntText}>→</span> Emergency-disclosure requests
            are handled by the same channel as formal process. There is no
            faster-than-process path.
          </li>
        </ul>

        <p style={{ marginBottom: "8px", color: "var(--burnt)", letterSpacing: "1px" }}>
          DEFERRED — NOT PROMISED
        </p>
        <p style={{ marginBottom: "12px" }}>
          The items below are <strong>deferred, not promised</strong>. In
          the same voice as the §14 changelog in the technical overview:
          decision-deferred is not a soft commitment. If the operator is
          not in a position to actually do these things, this page will not
          pretend otherwise.
        </p>
        <ul
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
        >
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>User notice on receipt of an order.</strong> Deferred.
            There is no account to notify; there may also be no lawful path
            to notify a non-party. Building either is a separate decision
            from documenting it.
          </li>
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Jurisdictional challenge as a default posture.</strong>{" "}
            Deferred. The operator may or may not litigate an order on the
            user’s behalf depending on the request, the jurisdiction, and
            the operator’s own counsel.
          </li>
          <li style={{ marginBottom: "8px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>Transparency report.</strong> Deferred. No periodic
            published count of requests received exists today. Building one
            is a separate task.
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <strong>Warrant canary.</strong> Deferred. There is no signed,
            periodically refreshed canary statement at this time. A real
            canary requires an operational schedule and a legally durable
            commitment to stop refreshing it on receipt of a gag order;
            asserting one without that commitment would be worse than
            silence.
          </li>
        </ul>
        <p style={closingLineStyle}>
          If any of these moves from “deferred” to “implemented,” this
          page will be the place it is announced — not a press release.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* 6. WHAT USERS CAN DO THEMSELVES */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> 6 · WHAT USERS CAN DO THEMSELVES
        </div>
        <p style={{ marginBottom: "16px" }}>
          The architecture leaves the user with most of the meaningful
          levers. Three of them in particular.
        </p>
        <ul
          style={{ listStyle: "none", padding: "0 0 0 16px", marginBottom: "16px" }}
        >
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>The .onion mirror.</strong> When this deployment
            publishes an onion address, reaching VOID over Tor moves the
            “source IP” the relay sees from your real IP to a Tor exit on
            the operator’s side. The footer link below carries the address
            when one is published; see the{" "}
            <Link href="/threat-model" style={linkStyle}>
              threat model
            </Link>{" "}
            “TOR AND THE MEDIA PATH” section for the honest caveats about
            what Tor does and does not cover for real-time media.
          </li>
          <li style={{ marginBottom: "10px" }}>
            <span style={burntText}>→</span>{" "}
            <strong>BURN.</strong> The host can BURN a room mid-call — the
            room ID is invalidated on the relay, every connected peer is
            evicted, and the entry is removed from in-memory state. BURN
            does not retroactively erase anything bucket 3 already wrote;
            it does close the window in which the live-observable items in
            bucket 2 can be captured.
          </li>
          <li>
            <span style={burntText}>→</span>{" "}
            <strong>The phrase is client-generated.</strong> The six-word
            VOID phrase is drawn from <code style={{ color: "var(--gold)" }}>crypto.getRandomValues</code>{" "}
            in your browser. The operator does not see it, does not store
            it, and cannot regenerate it. Sharing it through a channel you
            trust, and treating the URL the same way you would treat the
            phrase itself, is the user-side decision the system depends on.
          </li>
        </ul>

        <p style={{ marginBottom: "16px" }}>
          For the longer walk-through of what each surface protects and
          what it doesn’t, the{" "}
          <Link href="/threat-model" style={linkStyle}>
            threat model
          </Link>{" "}
          is the canonical reference.
        </p>
      </div>
    </PageShell>
  );
}
