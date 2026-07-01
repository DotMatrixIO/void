// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  dividerStyle,
  linkStyle,
  tealText,
  goldText,
  burntText,
} from "@/components/longFormStyles";

const findingTitleStyle: React.CSSProperties = {
  ...subheadingStyle,
  fontSize: "12px",
  marginTop: "0",
  marginBottom: "4px",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginBottom: "20px",
  fontSize: "11px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 6px",
  borderBottom: "2px solid var(--gold)",
  color: "var(--gold)",
  fontWeight: 700,
  letterSpacing: "1.5px",
  textTransform: "uppercase",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid rgba(232,162,0,0.18)",
  verticalAlign: "top",
};

const fixedBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  background: "var(--teal)",
  color: "#0A0908",
  fontWeight: 700,
  letterSpacing: "1.5px",
  fontSize: "10px",
};

const documentedBadge: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 6px",
  background: "var(--burnt)",
  color: "#0A0908",
  fontWeight: 700,
  letterSpacing: "1.5px",
  fontSize: "10px",
};

const findings: Array<{
  id: string;
  sev: string;
  title: string;
  whatItIs: string;
  whatChanged: string;
  status: "FIXED" | "DOCUMENTED";
  statusNote: string;
}> = [
  {
    id: "H-01",
    sev: "High",
    title: "Spoofable per-IP throttle",
    whatItIs:
      "The signaling layer’s per-IP rate limit was reading the wrong end of an HTTP header that a client can forge. A single attacker could rotate fake values to look like many different IPs and slip past the limit.",
    whatChanged:
      "A single shared helper now reads the trustworthy end of the header (the one the reverse proxy appends, not the one the client supplies). Both the Socket.io and HTTP paths route through it.",
    status: "FIXED",
    statusNote: "Task #168",
  },
  {
    id: "H-05",
    sev: "High",
    title: "One paid invoice could create many rooms",
    whatItIs:
      "The payment token issued after a Lightning invoice settled was not marked consumed when used. A host who paid one invoice could call create-room with that same token over and over within its window — hundreds of rooms, sometimes thousands. The paywall as written did not actually enforce “one payment, one room.”",
    whatChanged:
      "The token now carries the invoice’s payment hash; the server tracks which payment hashes have been used and rejects reuse with a clear error. One payment, one room.",
    status: "FIXED",
    statusNote: "Task #169",
  },
  {
    id: "M-01",
    sev: "Medium",
    title: "Silent crypto downgrade between peers",
    whatItIs:
      "Three places in the browser code caught crypto failures quietly and fell back to using the room-wide phrase key for traffic that was supposed to be protected by a per-pair forward-secret key. A user would not know the protection had been weakened.",
    whatChanged:
      "Those three silent paths were replaced with a loud failure: the affected peer connection is torn down and a red overlay appears on that peer’s tile. A signed identity envelope was added so each side can verify the other’s key before media flows.",
    status: "FIXED",
    statusNote: "Task #170",
  },
  {
    id: "M-02",
    sev: "Medium",
    title: "Empty-room host claim",
    whatItIs:
      "If the original host left a room and any other phrase-holder rejoined first, that rejoiner became host — and could destroy the room or kick others. Everyone in the room already shares the phrase, so this is not a content leak. It is a trust violation: the person who paid could lose host on a network blip.",
    whatChanged:
      "The room now remembers the payment hash of whoever created it. Host is granted on rejoin only when the rejoining peer presents a token whose payment hash matches.",
    status: "FIXED",
    statusNote: "Task #171",
  },
  {
    id: "M-03",
    sev: "Medium",
    title: "Phrase URL retained in browser history after leaving",
    whatItIs:
      "The room phrase lives in the part of the URL after the # — that part never reaches the server, by design. But several leave paths kept the phrase-bearing URL one entry back in browser history. Hitting Back returned to it; a local actor with shoulder-access or history-extracting malware could recover the phrase of a room the user already left.",
    whatChanged:
      "Every leave path (button, BURN, kick, timer expiry, route change, abandoned reconnect) now replaces the history entry instead of pushing a new one. The phrase URL is not retained in browser history after the user leaves. BURN additionally wipes VOID’s sessionStorage entries (including the paid-room JWT), deletes VOID’s runtime service-worker caches, revokes every blob URL the room created, and hard-navigates the tab to the landing page so the React tree and in-memory stream references are discarded with it.",
    status: "FIXED",
    statusNote: "in-tree (App.tsx)",
  },
  {
    id: "M-04",
    sev: "Medium",
    title: "Lightning payment is observable on the Lightning network",
    whatItIs:
      "The Lightning payment that opens a room carries no room metadata, but the timing of “payment settles → room becomes joinable” is tight. An adversary who can watch both the host’s Lightning identity and the operator’s invoice timing can correlate them: “this host paid for a room at time T.” Not what was said. Not who was in it. The fact that hosting happened.",
    whatChanged:
      "No code fix shipped. The original audit explicitly accepted documentation in plain language as a correct outcome for this finding. We took that path. Item §2 of the threat-model page (“THE LIGHTNING PAYMENT IS OBSERVABLE ON THE LIGHTNING NETWORK”) names the surface, names who it matters for, and lists the operator-side mitigations available today: routing the payment over Tor, using a wallet that does not know the user, having a third party pay, or self-hosting on the host’s own LNbits or BTCPay node.",
    status: "DOCUMENTED",
    statusNote: "threat-model item §2",
  },
  {
    id: "M-05",
    sev: "Medium",
    title: "Coturn placeholder secret committed",
    whatItIs:
      "The Coturn TURN-server config was checked into the repo with a placeholder shared secret. An operator who copied the repo and ran docker-compose up without reading the deployment notes would deploy a publicly-known TURN credential — anyone on the internet could use that operator’s TURN server as a free relay.",
    whatChanged:
      "The file was removed from the repo and replaced with an .example template; the operator’s working copy is gitignored. The API server now refuses to start when the configured TURN secret matches a known placeholder, with a specific error message telling the operator how to generate a new one.",
    status: "FIXED",
    statusNote: "Task #174",
  },
  {
    id: "M-06",
    sev: "Medium",
    title: "Dockerfile ran as root",
    whatItIs:
      "The container images ran the Node.js process as the root user. If a vulnerability were ever exploited inside the container, the attacker would inherit root privileges in that container.",
    whatChanged:
      "Both the production image and the agent-pilot image were converted to run as a dedicated non-root user.",
    status: "FIXED",
    statusNote: "Tasks #173 / #193",
  },
];

export default function AuditPage() {
  return (
    <PageShell backHref="/audit" backLabel="← BACK TO SHORT VERSION">
      <div style={dividerStyle} />

      {/* Hero */}
      <div style={sectionStyle}>
        <h1 style={headingStyle}>The audit</h1>
        <p style={{ marginBottom: "16px" }}>
          In April 2026 a member of the VOID engineering team performed an
          internal security and resilience audit of the codebase. It
          surfaced two High findings, six Medium findings, and a handful of
          smaller items. Every High and Medium finding has either shipped
          a code fix or has been disclosed in plain language on the{" "}
          <Link href="/threat-model" style={linkStyle}>
            threat-model page
          </Link>
          . That is the bar we set for publishing the audit, and we have
          met it.
        </p>
        <p style={{ marginBottom: "16px" }}>
          The full audit, with the publication preamble and inline status
          markers next to each finding, lives at{" "}
          <span style={tealText}>docs/security-audit-public-2026-04.md</span>{" "}
          in the source tree. This page is a plain-language summary for a
          reader who wants to know what was checked, what was found, and
          what we did about it — without reading 600 lines of technical
          notes.
        </p>
        <p style={{ marginBottom: "0" }}>
          A note up front. This audit was internal. A separate, larger
          piece of work — commissioning a recognized external firm to do
          an adversarial human audit — has not yet been done. The
          threat-model page names that gap directly. Treat the present-day
          claim as “well-designed for the documented threat model” and not
          “vetted for life-safety use.” That is the honest framing.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* What an audit is */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT AN AUDIT IS, AND ISN&apos;T
        </div>
        <p style={{ marginBottom: "16px" }}>
          An audit is a careful, slow read of the code with the question
          “where could this go wrong?” held in mind on every line. The
          April audit was static: read-only review of the source, no live
          deployment was probed, no penetration testing was performed.
        </p>
        <p style={{ marginBottom: "16px" }}>
          A static audit can find logic bugs, missing checks, weak
          defaults, places where the documentation and the code disagree.
          It cannot tell you what a determined attacker with weeks to
          spend on a live target will find. That is what an external
          adversarial audit is for. We are saying explicitly that the
          April audit is the first kind, not the second.
        </p>
        <p style={{ marginBottom: "0" }}>
          The audit also published its own limitations — what a static
          read could not establish — alongside its findings. Those
          limitations are preserved verbatim in the published copy
          (section 11). We think they are part of what makes an audit
          honest.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Status table */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT THE AUDIT FOUND
        </div>
        <p style={{ marginBottom: "16px" }}>
          Eight findings were rated High or Medium. Two High and six
          Medium. Their status today:
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Sev</th>
                <th style={thStyle}>Finding</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td style={{ ...tdStyle, color: "var(--gold)", fontWeight: 700 }}>
                    {f.id}
                  </td>
                  <td style={tdStyle}>{f.sev}</td>
                  <td style={tdStyle}>{f.title}</td>
                  <td style={tdStyle}>
                    <span
                      style={
                        f.status === "FIXED" ? fixedBadge : documentedBadge
                      }
                    >
                      {f.status}
                    </span>{" "}
                    <span style={{ color: "#9C8E7A" }}>{f.statusNote}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ marginBottom: "0" }}>
          Findings rated Informational or Low in the body of the audit
          were addressed where the fix was small (algorithm pinning,
          fetch deadlines, server timeouts) and otherwise carried into
          existing tracked work.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Per-finding summaries */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT EACH FINDING WAS, IN PLAIN LANGUAGE
        </div>

        {findings.map((f, idx) => (
          <div
            key={f.id}
            style={{ marginBottom: idx === findings.length - 1 ? 0 : "28px" }}
          >
            <div style={findingTitleStyle}>
              <span style={burntText}>▌</span> {f.id} — {f.title.toUpperCase()}
            </div>
            <p style={{ marginBottom: "10px" }}>
              <span style={{ color: "#9C8E7A" }}>What it was: </span>
              {f.whatItIs}
            </p>
            <p style={{ marginBottom: "10px" }}>
              <span style={{ color: "#9C8E7A" }}>What changed: </span>
              {f.whatChanged}
            </p>
            <p style={{ marginBottom: 0 }}>
              <span
                style={
                  f.status === "FIXED" ? fixedBadge : documentedBadge
                }
              >
                {f.status}
              </span>{" "}
              <span style={{ color: "#9C8E7A" }}>— {f.statusNote}</span>
            </p>
          </div>
        ))}
      </div>

      <div style={dividerStyle} />

      {/* What a static audit cannot tell you */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHAT A STATIC AUDIT CANNOT TELL YOU
        </div>
        <p style={{ marginBottom: "16px" }}>
          The published audit closes with a list of its own limits. We
          repeat the highlights here because they are part of why we
          treat this as a starting point and not a finish line.
        </p>
        <ul style={{ paddingLeft: "20px", marginBottom: "16px" }}>
          <li style={{ marginBottom: "8px" }}>
            No live target was probed. A static read cannot detect
            misconfiguration in a running deployment, a CDN that strips
            an expected header, or a reverse-proxy hop that does not
            behave the way the code assumes.
          </li>
          <li style={{ marginBottom: "8px" }}>
            No fuzzing or red-team exercise was performed. A determined
            attacker with weeks of time on a live system will find
            things a careful read will not.
          </li>
          <li style={{ marginBottom: "8px" }}>
            Cryptographic primitives (AES-GCM, ECDH P-384, argon2id,
            HKDF-SHA256) were assumed sound. The audit checked that
            VOID uses them correctly; it did not re-derive their
            security properties.
          </li>
          <li style={{ marginBottom: "8px" }}>
            Dependencies were inspected for known advisories at the
            commit audited. Supply-chain risk in transitive packages
            shifts over time and is not a one-shot question.
          </li>
          <li style={{ marginBottom: "0" }}>
            An external adversarial audit by a recognized firm has not
            been commissioned. That is the right next step and we are
            naming it directly here and on the threat-model page.
          </li>
        </ul>
        <p style={{ marginBottom: "0" }}>
          The full list of limitations, written by the auditor at the
          time, is preserved as section 11 of the published audit.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* Read the full audit */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> READ THE FULL AUDIT
        </div>
        <p style={{ marginBottom: "16px" }}>
          The full published audit — the audit text as written, plus a
          publication preamble and inline status markers next to each
          High and Medium finding — is at{" "}
          <span style={tealText}>docs/security-audit-public-2026-04.md</span>{" "}
          in the source tree. The technical companion that the
          threat-model page mirrors lives at{" "}
          <span style={tealText}>docs/threat-model.md</span>.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you find something the audit missed, or something this page
          glosses over, please file an issue. We would rather hear it
          from you than discover it from someone else.
        </p>
        {/* Task #1034 — point the verification-minded reader at the live
            attestations. The audit is a point-in-time read; /proof/runtime
            is what the running deployment claims right now. Same
            verify-don't-trust framing, same named limits. */}
        <p style={{ marginBottom: "0" }} data-testid="audit-verify-live-paragraph">
          The audit is a point-in-time read. To check the deployment you
          are using <em>right now</em>, the in-app{" "}
          <Link href="/proof/runtime" style={linkStyle}>
            /proof/runtime
          </Link>{" "}
          page hashes the bundle your browser actually loaded and shows a{" "}
          <span style={tealText}>POSTURE ATTESTATION</span> block —{" "}
          <span style={tealText}>/api/proof/posture</span> — reporting,
          bound to the build identity, whether the Tor-only / onion-ingress
          posture is in force. Verify it rather than trust it, and read the
          caveat: it does not prove the operator runs the un-modified
          attested binary, that the config didn’t change after you read it
          (a time-of-check / time-of-use window), or that no logging proxy
          sits in front recording IPs upstream.
        </p>
      </div>

    </PageShell>
  );
}
