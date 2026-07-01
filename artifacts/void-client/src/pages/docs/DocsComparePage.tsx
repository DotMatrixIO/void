// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import ScrollableTable from "@/components/ScrollableTable";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle as subheadingStyle,
  dividerStyle,
  tealText,
  goldText,
  burntText,
} from "@/components/longFormStyles";

const dimText: React.CSSProperties = { color: "#9C8E7A" };

const closingLineStyle: React.CSSProperties = {
  marginBottom: "0",
  fontStyle: "italic",
  color: "#9C8E7A",
};

type CellValue = "YES" | "NO" | string;

const tools = ["ZOOM", "MEET", "FACETIME", "SIGNAL", "JITSI", "VOID"] as const;

type Tool = (typeof tools)[number];

interface Row {
  label: string;
  values: Record<Tool, CellValue>;
}

const rows: Row[] = [
  {
    label: "NO ACCOUNT REQUIRED",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "YES",
      VOID: "YES",
    },
  },
  {
    label: "NO PERSISTENT USER GRAPH",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "DEPENDS",
      VOID: "YES",
    },
  },
  {
    label: "SELF-HOSTABLE",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "YES",
      VOID: "YES",
    },
  },
  {
    label: "OPEN SOURCE",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "YES",
      JITSI: "YES",
      VOID: "YES",
    },
  },
  {
    label: "EPHEMERAL BY DEFAULT",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "YES",
      VOID: "YES",
    },
  },
  {
    label: "BIOMETRIC MASKING BUILT IN",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "NO",
      VOID: "YES",
    },
  },
  {
    label: "LIGHTNING-NATIVE PAYMENT",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "NO",
      VOID: "YES",
    },
  },
  {
    label: "PEER-TO-PEER MEDIA",
    values: {
      ZOOM: "NO",
      MEET: "NO",
      FACETIME: "YES",
      SIGNAL: "NO",
      JITSI: "NO",
      VOID: "YES",
    },
  },
  {
    label: "MAX PARTICIPANTS",
    values: {
      ZOOM: "1000",
      MEET: "500",
      FACETIME: "32",
      SIGNAL: "50",
      JITSI: "100",
      VOID: "4",
    },
  },
  {
    label: "NATIVE MOBILE APPS",
    values: {
      ZOOM: "YES",
      MEET: "YES",
      FACETIME: "YES",
      SIGNAL: "YES",
      JITSI: "YES",
      VOID: "NO",
    },
  },
  {
    label: "RECORDING / TRANSCRIPTS",
    values: {
      ZOOM: "YES",
      MEET: "YES",
      FACETIME: "NO",
      SIGNAL: "NO",
      JITSI: "YES",
      VOID: "NO",
    },
  },
];

function cellColor(value: CellValue, tool: Tool): string {
  if (value === "DEPENDS") return "var(--gold)";
  if (tool === "VOID") {
    if (value === "YES") return "var(--teal)";
    if (value === "NO") return "var(--burnt)";
    return "var(--teal)";
  }
  if (value === "YES") return "var(--fg-on-dark)";
  if (value === "NO") return "#6B6354";
  return "var(--fg-on-dark)";
}

const tableCellBase: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #2A241B",
  borderRight: "1px solid #2A241B",
  textAlign: "center",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  letterSpacing: "1px",
  whiteSpace: "nowrap",
};

const labelCellBase: React.CSSProperties = {
  ...tableCellBase,
  textAlign: "left",
  color: "var(--fg-on-dark)",
  fontSize: "12px",
  letterSpacing: "1.5px",
  textTransform: "uppercase",
  whiteSpace: "normal",
  minWidth: "180px",
  paddingRight: "12px",
};

const headerCellBase: React.CSSProperties = {
  ...tableCellBase,
  fontWeight: 700,
  fontSize: "12px",
  letterSpacing: "2px",
  color: "var(--burnt)",
  borderBottom: "2px solid var(--gold)",
  borderTop: "2px solid var(--gold)",
  background: "rgba(0,0,0,0.25)",
};

export default function ComparePage() {
  return (
    <PageShell backHref="/compare" backLabel="← BACK TO SHORT VERSION">
      {/* Opening */}
      <div style={sectionStyle}>
        <div style={headingStyle}>
          WHY NOT ZOOM? OR MEET, OR FACETIME, OR SIGNAL, OR JITSI?
        </div>
        <div
          style={{
            ...headingStyle,
            color: "var(--teal)",
            fontSize: "clamp(14px, 3vw, 18px)",
            fontFamily: "var(--font-mono)",
            fontWeight: 400,
            marginBottom: "20px",
          }}
        >
          Fair question. Here is the table.
        </div>
        <p style={{ marginBottom: "0", ...dimText }}>
          Eleven rows. Six tools. We win eight. We lose three.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* THE TABLE */}
      <div style={{ ...sectionStyle, paddingLeft: "12px", paddingRight: "12px" }}>
        <ScrollableTable ariaLabel="Video tool capability comparison. Scroll sideways to reach every column, including VOID.">
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              borderTop: "2px solid var(--gold)",
              borderLeft: "1px solid #2A241B",
              fontFamily: "var(--font-mono)",
            }}
          >
            <thead>
              <tr>
                <th
                  style={{
                    ...headerCellBase,
                    textAlign: "left",
                    minWidth: "180px",
                    color: "var(--gold)",
                  }}
                  scope="col"
                >
                  CAPABILITY
                </th>
                {tools.map((tool) => (
                  <th
                    key={tool}
                    style={{
                      ...headerCellBase,
                      color: tool === "VOID" ? "var(--teal)" : "var(--burnt)",
                    }}
                    scope="col"
                  >
                    {tool}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th style={labelCellBase} scope="row">
                    {row.label}
                  </th>
                  {tools.map((tool) => {
                    const value = row.values[tool];
                    return (
                      <td
                        key={tool}
                        style={{
                          ...tableCellBase,
                          color: cellColor(value, tool),
                          fontWeight: tool === "VOID" ? 700 : 400,
                          background:
                            tool === "VOID" ? "rgba(0,0,0,0.25)" : "transparent",
                        }}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
        <p
          style={{
            marginTop: "16px",
            marginBottom: "0",
            fontSize: "12px",
            letterSpacing: "1px",
            color: "#6B6354",
            textTransform: "uppercase",
            lineHeight: 1.7,
          }}
        >
          VOID cells cross-referenced against the VOID technical overview.
          Competitor values reflect each product&apos;s default consumer
          offering as of April 2026.{" "}
          <span style={{ textTransform: "none", letterSpacing: "0.5px" }}>
            &ldquo;Ephemeral by default&rdquo; means the platform is built
            around the assumption that the meeting / room / conversation is
            not retained — no persistent meeting ID, no account-bound
            history, no recording or transcript by default. Jitsi public
            rooms qualify; self-hosted Jitsi behavior depends on the
            operator.{" "}
            &ldquo;Biometric masking built in&rdquo; means VOID ships local
            video and audio masking modes; their strength varies by mode and
            is detailed on the{" "}
            <Link href="/docs/biometric" style={{ color: "var(--teal)", textDecoration: "underline" }}>
              biometric page
            </Link>
            . &ldquo;Peer-to-peer media&rdquo; means call audio and video
            travel directly between participants with no media server in the
            path. The server-based tools relay every stream; Signal sends
            group calls through a forwarding server; FaceTime keeps a small
            call direct, as VOID does.{" "}
            &ldquo;No persistent user graph&rdquo; means the platform does not
            accumulate a durable record of who met whom across calls. VOID&rsquo;s
            signaling server sees participant IP addresses while a room is live
            and keeps nothing after it ends; Jitsi depends on the operator&rsquo;s
            logging and deployment, hence DEPENDS. &ldquo;Open source&rdquo; means
            the source is published under a license that lets you read, run, and
            modify it — VOID and Signal under the AGPL, Jitsi under Apache; the
            proprietary tools publish nothing.
          </span>
        </p>
      </div>

      <div style={dividerStyle} />

      {/* THE EIGHT ROWS WE WIN */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={tealText}>▌</span> THE EIGHT ROWS WE WIN
        </div>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>No account required.</span> An account is
          a method the platform uses to remember you. We do not want to
          remember you. No offense.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>No persistent user graph.</span> Other tools
          remember who met whom — the contact list, the call history, the org
          chart that accretes over months. That graph is the thing that gets
          subpoenaed. VOID never builds it. The signaling server sees IP
          addresses while a room is live and forgets them when it dies. There
          is no record of who you talked to, because there is no record at all.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Self-hostable.</span> The whole stack runs
          on your own hardware — Umbrel, StartOS, bare metal. If we
          disappear, the tool does not disappear with us. A tool that
          depends on us being around in five years is not, strictly
          speaking, a tool you own.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Open source.</span> The whole client is
          published under the AGPL. You do not have to trust our description of
          what the code does — you can read the code and check. The corporate
          tools ask you to trust a privacy policy. We would rather you trust a
          diff.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Ephemeral by default.</span> Rooms die on
          a timer. There is no database, no recording, no transcript, and
          no AI summary. This is the whole point.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Biometric masking built in.</span> The
          mask runs on your GPU before a single frame leaves your device.
          What goes over the wire is enough presence to trust someone, but
          not enough to build a file on them.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={goldText}>Lightning-native payment.</span> The host
          pays a small invoice, and joiners pay nothing. No credit card, no
          billing identity, no KYC. A small amount of friction stops
          automated abuse without capturing anything about who caused it.
        </p>
        <p style={{ marginBottom: "0" }}>
          <span style={goldText}>Peer-to-peer media.</span> Audio and video
          flow straight from one participant to another. Nothing routes
          through a server we run, so there is no media box in the middle to
          wiretap, subpoena, or breach. The big platforms relay every stream
          through their own infrastructure; FaceTime is the one mainstream
          tool that keeps a small call direct. This is also the reason the
          next number is so small.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* THE THREE ROWS WE LOSE */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={burntText}>▌</span> THE THREE ROWS WE LOSE
        </div>
        <p style={{ marginBottom: "16px" }}>
          The last three rows are limits. Each is also a decision.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={burntText}>Four people, hard cap.</span> VOID uses
          full mesh WebRTC. Every participant maintains a direct connection
          to every other participant. The mesh holds at four. At five it
          starts to fray. Adding a media relay server would fix this. It
          would also break the privacy model. We stop the room at four. If
          you need fifty people in a room, we are the wrong tool.
        </p>
        <p style={{ marginBottom: "16px" }}>
          <span style={burntText}>No native mobile apps.</span> VOID is a
          browser PWA. It installs to your home screen and works offline,
          but it is not a native iOS or Android binary. We would rather
          ship a PWA we can audit end-to-end than native apps that depend
          on review pipelines we do not control.
        </p>
        <p style={{ marginBottom: "0" }}>
          <span style={burntText}>No recording, no transcripts.</span> We
          don&apos;t like being included in searchable histories. So, there
          is no record button on our end, and there will not be one.
        </p>
      </div>

      <div style={dividerStyle} />

      {/* WHEN VOID IS THE WRONG TOOL */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> WHEN VOID IS THE WRONG TOOL
        </div>
        <p style={{ marginBottom: "16px" }}>
          If you need fifty people in a room, use{" "}
          <span style={goldText}>Jitsi</span>. Self-hosted if you can run a
          server, public if you cannot.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you need a recurring weekly team standup with the same room
          and the same link every Tuesday, use{" "}
          <span style={goldText}>anything else</span>. VOID rooms burn down
          on a timer, and the links aren&apos;t reusable. Continuing means
          paying for and creating a fresh room with a fresh URL. That is
          wrong for a recurring company meeting.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you need a recorded meeting, use{" "}
          <span style={goldText}>Zoom</span>,{" "}
          <span style={goldText}>Meet</span>, or self-hosted{" "}
          <span style={goldText}>Jitsi</span>.
        </p>
        <p style={{ marginBottom: "16px" }}>
          If you need to call your mother, use{" "}
          <span style={goldText}>FaceTime</span> or{" "}
          <span style={goldText}>Signal</span>. She does not need her face
          turned into ASCII characters. Also, she knows what you look like.
        </p>
        <p style={closingLineStyle}>
          Finally, if your life depends on the call, talk to a security
          professional before you talk to us. VOID has not yet been
          externally audited. We have written down what we believe is true
          on the threat model page. The code is available for inspection.
          Still, a small team with good values is not a substitute for a
          formal assurance review. We are in the process of funding such a
          review, but until then, please use an externally audited
          communication strategy (e.g., Signal).
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ONE LAST THING */}
      <div style={sectionStyle}>
        <div style={subheadingStyle}>
          <span style={goldText}>▌</span> ONE LAST THING
        </div>
        <p style={{ marginBottom: "24px" }}>
          A system that structurally cannot retain your data is more
          valuable than a system that promises not to.
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
            href="/threat-model"
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
            READ THE THREAT MODEL
          </Link>
          <span
            aria-disabled="true"
            title="Self-hosting is not yet available"
            style={{
              border: "2px dashed var(--fg-dim)",
              padding: "12px 20px",
              color: "var(--fg-dim)",
              fontSize: "12px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              fontFamily: "var(--font-mono)",
              opacity: 0.6,
              cursor: "not-allowed",
            }}
          >
            SELF-HOST VOID — NOT YET
          </span>
        </div>
      </div>

    </PageShell>
  );
}
