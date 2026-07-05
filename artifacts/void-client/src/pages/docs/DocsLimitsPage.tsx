// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle,
  dividerStyle,
  goldText,
  burntText,
  linkStyle,
} from "@/components/longFormStyles";

const fragmentItemStyle: React.CSSProperties = {
  marginBottom: "8px",
  letterSpacing: "1px",
};

export default function LimitsPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      {/* Opening */}
      <div style={sectionStyle}>
        <div style={headingStyle}>
          LIMITS
        </div>

        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> VOID IS FOR
        </div>
        <p style={{ marginBottom: "16px" }}>
          VOID is for <strong>short conversations</strong> between{" "}
          <strong>a few people</strong> who would{" "}
          <strong>rather not leave a record</strong>.
        </p>
        <p style={{ marginBottom: "0" }}>
          The things VOID is not for — that list is longer.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* NOT FOR */}
      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> VOID IS NOT FOR:
        </div>

        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "20px",
          }}
        >
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> 50-person webinars.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Recorded meetings.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Transcribed calls.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> People who need captions.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> AI summaries, action items,
            meeting notes.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Persistent team chat.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> File transfer or document
            sharing.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Anything you need to reference
            later.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Anything legally requiring
            retention.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> People who need a corporate help
            desk.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Scheduled, recurring, calendared
            meetings.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Cross-session identity, contacts,
            or directories.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Webinars, polls, breakout rooms,
            attendance reports.
          </li>
          <li style={fragmentItemStyle}>
            <span style={burntText}>→</span> Whiteboards you can save.
          </li>
        </ul>

        <p style={{ marginBottom: "16px" }}>
          If any of those is what you came here for, this is the wrong tool.
        </p>

        <p style={{ marginBottom: "0" }}>
          For a side-by-side of what VOID does and does not include — and what
          the alternatives do — see the{" "}
          <Link href="/compare" style={linkStyle}>
            comparison page
          </Link>
          .
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ACCESSIBILITY LIMITS */}
      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> ACCESSIBILITY LIMITS
        </div>
        <p style={{ marginBottom: "16px" }}>
          There are no live captions. This is the accessibility decision that
          will cost some users the most, and we are sorry for that impact.
          Here is why we made it: captions are durable text. Even when
          rendered live and discarded immediately, the moment a transcript
          exists in any form, the next request is to save it, then to export
          it, then to search it. We are not willing to walk down that road,
          and the price of that refusal is paid by users who need captions to
          participate. We know this is a real cost. We are naming it directly
          rather than hoping nobody notices.
        </p>
        <p style={{ marginBottom: "0" }}>
          If captions are required for your conversation to happen, VOID is
          the wrong tool.
        </p>
      </div>
    </PageShell>
  );
}
