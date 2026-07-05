// SPDX-License-Identifier: AGPL-3.0-or-later
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  leadStyle as subheadStyle,
  tealText,
  burntText,
} from "@/components/longFormStyles";
import ReadMoreButton from "@/components/short-form/ReadMoreButton";

const sectionHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: "16px",
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  marginTop: "28px",
  marginBottom: "16px",
};

const findingStyle: React.CSSProperties = {
  margin: "0 0 16px",
  paddingLeft: "0",
};

export default function AuditPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div style={sectionStyle}>
        <div style={headingStyle}>THE AUDIT</div>
        <div style={subheadStyle}>
          WHAT WE CHECKED. WHAT WE FOUND. WHAT WE DID.
        </div>

        <p style={{ margin: "0 0 12px" }}>
          In April 2026, the VOID team read the code carefully, line by
          line, with the question “where could this go wrong?” held in
          mind.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          This was our first audit.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          We found two High-severity problems, six Medium-severity
          problems, and a handful of smaller things.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Every High and Medium finding has either been fixed in code or
          written down honestly on the threat-model page. That is the bar
          we set for publishing the audit. We have met it.
        </p>

        <p style={sectionHeaderStyle}>WHAT AN AUDIT IS, AND ISN’T</p>
        <p style={{ margin: "0 0 12px" }}>
          An audit is a slow, careful reading of the code by someone
          looking for trouble.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          This audit was <span style={tealText}>internal</span> — done
          by members of the team, not by an outside firm. It was{" "}
          <span style={tealText}>static</span> — a reading of the code,
          not a live attack on a running system.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          A careful reading can find logic bugs, missing checks, weak
          defaults, and places where the documentation and the code
          disagree with each other.
        </p>
        <p style={{ margin: "0 0 0" }}>
          A careful reading cannot tell you what a determined attacker
          with weeks to spend on a live target will find. That is a
          different kind of audit, by a different kind of person, and it
          has not been done yet. Treat what follows as{" "}
          <span style={tealText}>
            “well-designed for the documented threat model.”
          </span>{" "}
          Not as{" "}
          <span style={burntText}>“vetted for life-safety use.”</span>
        </p>

        <p style={sectionHeaderStyle}>THE TWO HIGH FINDINGS</p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>One IP could pretend to be many.</span>{" "}
          The rate limiter was reading the wrong end of an HTTP header —
          the end a client can forge. An attacker could rotate fake
          values to look like many different IPs and slip past the limit.{" "}
          <span style={tealText}>Fixed.</span>
        </p>
        <p style={{ ...findingStyle, marginBottom: "0" }}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>
            One paid invoice could open many rooms.
          </span>{" "}
          The payment token wasn’t marked used after it opened a room. A
          host who paid once could create rooms over and over within the
          token’s window.{" "}
          <span style={tealText}>Fixed. One payment, one room.</span>
        </p>

        <p style={sectionHeaderStyle}>THE SIX MEDIUM FINDINGS</p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>
            A quiet downgrade in the encryption.
          </span>{" "}
          Three places in the browser code caught crypto failures silently
          and fell back to weaker protection. The user would not know.{" "}
          <span style={tealText}>
            Fixed. Those paths now fail loudly — the peer connection
            tears down and a red overlay appears.
          </span>
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>
            The wrong person could claim host.
          </span>{" "}
          If the original host left and someone else rejoined first, that
          person became host. Everyone in the room already has the phrase,
          so this is not a content leak. It is a trust violation.{" "}
          <span style={tealText}>
            Fixed. The room now remembers who paid.
          </span>
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>
            The phrase URL stayed in browser history.
          </span>{" "}
          The phrase rides in the part of the URL after the #, which
          never reaches the server. But several exit paths left the phrase
          one entry back in history, recoverable by hitting Back.{" "}
          <span style={tealText}>
            Fixed. Every exit path now replaces the history entry instead
            of pushing a new one.
          </span>
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={burntText}>
            Lightning payments are observable on the Lightning network.
          </span>{" "}
          A patient adversary watching both the host’s wallet and the
          operator’s invoice timing can correlate them — “this host paid
          for a room at time T.” Not what was said. Not who was in it.
          The fact that hosting happened.{" "}
          <span style={burntText}>
            Documented. The threat-model page names this surface and
            lists what to do about it: route the payment over Tor, use a
            wallet that does not know you, or self-host.
          </span>
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>
            A placeholder secret was checked into the repo.
          </span>{" "}
          An operator who copied the code and ran it without reading the
          notes would deploy a publicly-known TURN credential — a free
          relay for anyone on the internet.{" "}
          <span style={tealText}>
            Fixed. The placeholder is gone. The server refuses to start
            with it.
          </span>
        </p>
        <p style={{ ...findingStyle, marginBottom: "0" }}>
          <span style={burntText}>→</span>{" "}
          <span style={tealText}>The container ran as root.</span>{" "}
          A vulnerability inside the container would have inherited root
          privileges.{" "}
          <span style={tealText}>
            Fixed. It runs as a non-root user now.
          </span>
        </p>

        <p style={sectionHeaderStyle}>
          WHAT A CAREFUL READING CANNOT TELL YOU
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The audit report includes our own limits at the end. We repeat
          them here.
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          No live system was attacked. A misconfiguration on the
          production server, a CDN that strips a header, or a proxy that
          behaves unexpectedly cannot be found by reading the code.
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          No fuzzing or red-team work was done. A determined attacker
          with weeks of time on a live system will find things a careful
          read will not.
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          The cryptographic math itself — AES-GCM, ECDH, Argon2id, HKDF
          — was assumed sound. The audit checked that we use these tools
          correctly. It did not re-derive their security.
        </p>
        <p style={findingStyle}>
          <span style={burntText}>→</span>{" "}
          The dependencies were inspected for known problems on the day
          of the audit. Supply-chain risk shifts over time. This is not
          a question you answer once.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          <span style={burntText}>→</span>{" "}
          An outside firm has not yet been commissioned to do an
          adversarial human audit, but that is the right next step.
        </p>

        <ReadMoreButton href="/docs/audit" />
      </div>
    </PageShell>
  );
}
