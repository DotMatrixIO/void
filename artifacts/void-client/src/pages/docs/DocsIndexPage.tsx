// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import { sectionStyle, headingStyle } from "@/components/longFormStyles";

// Task #545. Flat /docs index. Lists every long-form doc page that has
// been split off from a short-form info page. Designed to grow to ~7
// entries (the hamburger pages); revisit grouping only if it grows
// past ~10. Flat now, flat forever unless it grows.

type DocEntry = {
  title: string;
  href: string;
  description: string;
  updated: string;
};

// Add a new entry here when a follow-up vertical slice ships its long
// form. Last-updated is a manual constant, hand-bumped when the prose
// in the target file is meaningfully revised.
const DOC_ENTRIES: ReadonlyArray<DocEntry> = [
  {
    title: "HOW IT WORKS",
    href: "/docs/how-it-works",
    description:
      "Stateless architecture, log policy, the VOID phrase, encryption (with key-derivation diagram), video filters, voice masks.",
    updated: "2026-05-27",
  },
  {
    title: "THREAT MODEL",
    href: "/docs/threat-model",
    description:
      "What the server can see, what it cannot, network observers, browser-level surfaces, Tor and the media path, supply chain, the won’t-fix list for v0.5, and the honest summary.",
    updated: "2026-05-27",
  },
  {
    title: "COMPARE",
    href: "/docs/compare",
    description:
      "Full eleven-row comparison table vs the major alternatives, what we win and what we lose, when VOID is the wrong tool.",
    updated: "2026-05-27",
  },
  {
    title: "AUDIT",
    href: "/docs/audit",
    description:
      "The April 2026 internal security and resilience audit — what an audit is and isn’t, the status table for the two High and six Medium findings, per-finding summaries with code fixes or documentation links, what a static audit cannot tell you, and a deep link to the published audit markdown.",
    updated: "2026-05-27",
  },
  {
    title: "BIOMETRIC",
    href: "/docs/biometric",
    description:
      "Biometric asset FAQs, why face and voice qualify, the video and voice masks, on-device processing, and the difference between reduced exposure and anonymity.",
    updated: "2026-05-27",
  },
  {
    title: "PRICING",
    href: "/docs/pricing",
    description:
      "Why the price is what it is, why 24 hours is the longest tier, how the Lightning one-shot payment works, what the longer tier is not, and self-hosting for groups that need free rooms.",
    updated: "2026-05-27",
  },
  {
    title: "LIMITS",
    href: "/docs/limits",
    description:
      "The full “not for” list, the leaked-phrase boundary, and the live-captions accessibility decision named in plain language. Failure modes and recovery paths live on the FAQ page.",
    updated: "2026-05-27",
  },
  {
    title: "FAQ — TECHNICAL QUESTIONS",
    href: "/docs/faq",
    description:
      "Some known errors and what to do about each one.",
    updated: "2026-05-27",
  },
];

const entryStyle: React.CSSProperties = {
  display: "block",
  padding: "18px 0",
  borderTop: "1px solid rgba(232,162,0,0.24)",
  textDecoration: "none",
  color: "inherit",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: 700,
  fontSize: "14px",
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--gold)",
  marginBottom: "6px",
};

const descStyle: React.CSSProperties = {
  color: "var(--fg-on-dark)",
  fontSize: "13px",
  lineHeight: 1.6,
  margin: "0 0 6px",
};

const updatedStyle: React.CSSProperties = {
  color: "#5C5040",
  fontSize: "11px",
  letterSpacing: "2px",
  textTransform: "uppercase",
};

export default function DocsIndexPage() {
  return (
    <PageShell backHref="/" backLabel="← BACK">
      <div style={sectionStyle}>
        <div style={headingStyle}>DOCS</div>
        <p style={{ margin: "0 0 24px", color: "var(--fg-on-dark)" }}>
          The long versions.
        </p>

        <div data-testid="docs-index-entries">
          {DOC_ENTRIES.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              style={entryStyle}
              data-testid="docs-index-entry"
            >
              <div style={titleStyle}>{entry.title}</div>
              <p style={descStyle}>{entry.description}</p>
              <div style={updatedStyle}>UPDATED {entry.updated}</div>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
