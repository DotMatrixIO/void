// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect } from "react";
import { Link } from "wouter";
import OpenBetaCaption from "@/components/OpenBetaCaption";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  leadStyle as subheadStyle,
  tealText,
  burntText,
} from "@/components/longFormStyles";
import ReadMoreButton from "@/components/short-form/ReadMoreButton";
import SectionBreadcrumb from "@/components/short-form/SectionBreadcrumb";
import { threatModelAnchorRedirectTarget } from "@/components/short-form/anchorRedirects";

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

const listStyle: React.CSSProperties = {
  listStyle: "none",
  padding: "0 0 0 0",
  margin: "0 0 4px",
};

const listItemStyle: React.CSSProperties = {
  marginBottom: "14px",
  paddingLeft: "0",
};

export default function ThreatModelPage() {
  useEffect(() => {
    const target = threatModelAnchorRedirectTarget(
      window.location.hash,
      import.meta.env.BASE_URL,
    );
    if (target) {
      window.location.replace(target);
    }
  }, []);

  return (
    <PageShell backHref="/" backLabel="← BACK">
      {/* v0.5 / open beta acknowledgement — sits under the hamburger
          in the normal scrollable flow (not sticky). Pinned by
          __tests__/v05OpenBetaLabel.test.tsx. */}
      <OpenBetaCaption data-testid="threat-model-v05-acknowledgement" />

      <div style={sectionStyle}>
        <div style={headingStyle}>THE VOID THREAT MODEL</div>
        <div style={subheadStyle}>
          WHAT WE PROTECT YOU FROM. AND WHAT WE DON’T.
        </div>

        <p style={{ margin: "0 0 12px" }}>
          A man named Howard bought a lock for his door.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          It was a good lock. Howard felt safe.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Howard’s neighbor came through the window. This is how some
          days go.
        </p>

        <p style={sectionHeaderStyle}>WHAT A THREAT MODEL IS</p>
        <p style={{ margin: "0 0 12px" }}>
          A threat model is a list of what a tool does, and a list of
          what it doesn’t.
        </p>
        <p style={{ margin: "0 0 0" }}>
          Most companies don’t publish them. Admitting limitations is
          uncomfortable when you are trying to sell a thing. We are
          trying to sell a thing. We are publishing a threat model anyway.
        </p>

        <p style={sectionHeaderStyle}>WHAT VOID PROTECTS YOU FROM</p>
        <ul style={listStyle} data-testid="threat-model-protects-list">
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>Companies watching you.</span>{" "}
            VOID has no account, no email, no profile, no record of you.
            There is nothing to sell, and no stored conversation to leak.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>Subpoenas.</span>{" "}
            A government can ask us for your records. We have none to give.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>Bulk surveillance.</span>{" "}
            Your video and audio are encrypted on your device before they
            leave it. Anyone watching the wire sees noise.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>Biometric harvesting.</span>{" "}
            Your face is pixelated or contoured by your own computer before
            transmission. Your voice is shifted or scrambled the same way.
            What travels is not a clean asset. It cannot easily train a
            model of you.
          </li>
          <li style={listItemStyle} data-testid="threat-model-duet-rekey">
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>Impersonation.</span>{" "}
            Two people on a call read two words aloud. If the words match
            on both screens, the connection is clean. We call this the
            Duet. It takes five seconds. It defeats the man in the middle.
            A verified Duet is not permanent: if a peer reconnects or their keys
            change mid-call in a way VOID cannot tie back to the session you
            verified, VOID drops your earlier check and prompts you to run the
            Duet again. A scheduled rotation VOID can prove came from the same
            verified peer is carried forward silently, with no re-check.
          </li>
          <li style={{ ...listItemStyle, marginBottom: "0" }}>
            <span style={burntText}>→</span>{" "}
            <span style={tealText}>The future reading the past.</span>{" "}
            Each call generates fresh keys that are destroyed when the call
            ends. A leak a year from now does not unlock a conversation
            from last week.
          </li>
        </ul>

        <p style={sectionHeaderStyle}>WHAT VOID DOES NOT PROTECT YOU FROM</p>
        <ul style={listStyle} data-testid="threat-model-doesnt-protect-list">
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={burntText}>The person in the room.</span>{" "}
            If someone in your call is recording with a second phone, VOID
            cannot help you.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={burntText}>A compromised device.</span>{" "}
            If there is malware on your computer, the malware wins.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={burntText}>The fact that a call happened.</span>{" "}
            The server sees that you connected. It does not see what you
            said. If you need to hide the connection itself, use Tor — and
            read what Tor does and does not do for the media path.
          </li>
          <li style={listItemStyle}>
            <span style={burntText}>→</span>{" "}
            <span style={burntText}>The phrase you share carelessly.</span>{" "}
            The VOID Phrase is the door. Whoever holds it walks in. Share
            it over a channel you trust.
          </li>
          <li style={{ ...listItemStyle, marginBottom: "0" }}>
            <span style={burntText}>→</span>{" "}
            <span style={burntText}>A nation-state with a budget.</span>{" "}
            If a national intelligence agency is specifically after you,
            please call a professional. A band-aid is a good tool, but it
            is not a hospital.
          </li>
        </ul>

        <p style={sectionHeaderStyle}>WHAT THE SERVER SEES</p>
        <p style={{ margin: "0 0 12px" }}>
          Connection times. IP addresses. The fact that a VOID room exists.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          Two of those sit together. At the same moment, the server can see
          your IP address and which room you are in — so a dishonest operator
          could note that this IP was in that room. Tor is what takes your IP
          out of that pairing. Nothing else does.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          What the server does not see: your face, your voice, your words,
          the phrase, the keys.
        </p>
        <p style={{ margin: "0 0 0" }}>
          The server is a relay. It passes encrypted noise between people.
          It does not and cannot know what is inside the noise. This is a
          property of the math.
        </p>

        <p style={sectionHeaderStyle}>WHAT HAPPENS WHEN YOU PRESS BURN</p>
        <p style={{ margin: "0 0 12px" }}>
          Every camera and microphone is released. Every connection is
          closed. Every key is dropped. The page navigates away.
        </p>
        <p style={{ margin: "0 0 0" }}>
          What BURN cannot reach: anything already screenshotted, anything
          synced to another device before you pressed it, anything malware
          already exfiltrated. BURN closes the door. It does not rewrite
          the past.
        </p>

        <p style={sectionHeaderStyle}>ONE LAST THING</p>
        <p style={{ margin: "0 0 12px" }}>
          VOID is a lock. It is a good lock, and we are proud of it.
        </p>
        <p style={{ margin: "0 0 12px" }}>
          But locks do what they do, and not what they don’t.
        </p>
        <p style={{ margin: "0 0 28px" }}>
          Howard should have closed the window.
        </p>

        <ReadMoreButton href="/docs/threat-model" />

        <SectionBreadcrumb
          sections={[
            "What a Threat Model Is",
            "What VOID Protects",
            "What It Doesn’t",
            "What the Server Sees",
            "BURN",
          ]}
        />
      </div>

      {/* For security researchers — load-bearing cross-links + the
          journalist-grade caveat that the check:threat-model-drift
          gate requires on every threat-model surface. The full
          enumeration lives on the long page; this footer exists so
          the page itself stays honest about what it is not. */}
      <div
        style={{
          ...sectionStyle,
          marginTop: "24px",
          fontSize: "12px",
          color: "#9C8E7A",
        }}
        data-testid="threat-model-researcher-footer"
      >
        <p style={{ margin: "0 0 12px", color: "var(--burnt)", letterSpacing: "1px" }}>
          FOR SECURITY RESEARCHERS
        </p>
        <p style={{ margin: "0 0 12px" }}>
          The technical mirror of this page lives at{" "}
          <span style={tealText}>docs/threat-model.md</span>, and the
          client-side enumeration of attacker positions at{" "}
          <span style={tealText}>docs/client-threat-model.md</span>. The
          long version of this page —{" "}
          <Link href="/docs/threat-model" style={{ color: "var(--teal)", textDecoration: "underline" }}>
            /docs/threat-model
          </Link>{" "}
          — is the plain-language mirror; the three surfaces stay in
          sync by drift check.
        </p>
        <p style={{ margin: 0 }}>
          VOID is well-designed for a sovereign host and people who
          already trust one another. It is{" "}
          <span style={{ color: "var(--burnt)" }}>not vetted, today,</span>{" "}
          as a <em>journalist-grade</em> tool — that claim requires both
          the audit’s High and Medium fixes shipping AND an{" "}
          external/human audit by an outside firm. We are working on
          the first. We have not commissioned the second.
        </p>
      </div>
    </PageShell>
  );
}
