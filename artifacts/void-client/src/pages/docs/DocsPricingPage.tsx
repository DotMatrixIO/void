// SPDX-License-Identifier: AGPL-3.0-or-later
import { type ReactNode } from "react";
import { Link } from "wouter";
import PageShell from "@/components/PageShell";
import {
  sectionStyle,
  headingStyle,
  sectionHeadingStyle,
  dividerStyle,
  tealText,
  goldText,
  burntText,
} from "@/components/longFormStyles";
import { useTierPricing } from "@/hooks/useTierPricing";
// Canonical "why this price" prose — same bytes as the block spliced
// into VOID_TECHNICAL_OVERVIEW.md §4.1 by sync-fragments.mjs at build
// time. Drift is caught by check:fragments-sync in marketing-voice CI.
import pricingLogicMd from "@docs/_fragments/pricing-logic.md?raw";

// Task #549 — render helper for the live sat amount. The server is the
// single source of truth (GET /paywall/tiers). Until it responds we
// show a `—` placeholder rather than a stale or invented number.
function formatSats(amount: number | null): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString()} SATS`;
}

function formatUsd(usd: string | null): string | null {
  return usd ? `≈ $${usd}` : null;
}

const closingLineStyle: React.CSSProperties = {
  marginBottom: "0",
  color: "#9C8E7A",
};

// Minimal markdown renderer — mirrors the helpers in ThreatModelPage
// and LawEnforcementPage so the shared fragments render with the same
// typography on every surface without pulling in a full markdown
// library. Supports paragraphs and inline `**bold**` / `*italic*` /
// `` `code` ``. The final paragraph is styled as the section's closing
// line so the fragment-driven section matches the rest of the page.
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

function PricingLogicProse({ source }: { source: string }) {
  const paragraphs = source.trim().split(/\n\s*\n/);
  return (
    <>
      {paragraphs.map((para, i) => {
        const isLast = i === paragraphs.length - 1;
        const style: React.CSSProperties = isLast
          ? closingLineStyle
          : { marginBottom: "16px" };
        return (
          <p key={i} style={style}>
            {renderInlineMarkdown(para.replace(/\s+/g, " ").trim())}
          </p>
        );
      })}
    </>
  );
}

export default function PricingPage() {
  const { pricing, loading } = useTierPricing();
  const standardSats = loading ? null : pricing.standard.amountSats;
  const daySats = loading ? null : pricing.day.amountSats;
  const standardUsd = formatUsd(pricing.standard.usdApprox);
  const dayUsd = formatUsd(pricing.day.usdApprox);
  return (
    <PageShell backHref="/" backLabel="← BACK" footerPaddingTop="8px">
      <div style={sectionStyle}>
        <div style={headingStyle}>PRICING</div>

        <p style={closingLineStyle}>
          Rooms come in two lengths, so two prices.
        </p>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> THE TWO LENGTHS
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          {[
            {
              name: "STANDARD",
              price: formatSats(standardSats),
              usd: standardUsd,
              ttl: "65 MINUTES",
              for: "One conversation. One short meeting. One coffee.",
              accent: "var(--gold)",
            },
            {
              name: "24-HOUR",
              price: formatSats(daySats),
              usd: dayUsd,
              ttl: "24 HOURS",
              for: "All-day workshops. Cross-timezone standups. A room that survives a lunch break.",
              accent: "var(--teal)",
            },
          ].map((tier) => (
            <div
              key={tier.name}
              style={{
                border: `3px solid ${tier.accent}`,
                padding: "16px 18px",
                background: "rgba(20,17,13,0.4)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: "6px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "3px", color: tier.accent }}>
                  {tier.name}
                </div>
                <div style={{ fontSize: "13px", letterSpacing: "2px", color: "var(--fg-on-dark)" }}>
                  {tier.price} <span style={{ color: "#9C8E7A" }}>({tier.usd})</span> · {tier.ttl}
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "#9C8E7A", letterSpacing: "1px", lineHeight: 1.7 }}>
                {tier.for}
              </div>
            </div>
          ))}
        </div>
        <p
          style={{
            fontSize: "12px",
            color: "#9C8E7A",
            letterSpacing: "1px",
            lineHeight: 1.7,
            marginBottom: "16px",
            marginTop: "-4px",
          }}
        >
          USD figures are approximate and move with the price of Bitcoin.
        </p>

        <p style={closingLineStyle}>
          Each tier is a one-shot purchase. No subscription. No auto-renewal.
          When you want another room, make one.
        </p>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> WHY THIS PRICE?
        </div>
        <div data-testid="pricing-logic-fragment">
          <PricingLogicProse source={pricingLogicMd} />
        </div>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> HOW IT WORKS
        </div>
        <p style={{ marginBottom: "0" }}>
          You choose a length and pay over the{" "}
          <a
            href="https://en.wikipedia.org/wiki/Lightning_Network"
            rel="noopener noreferrer"
            target="_blank"
            style={{ ...tealText, textDecoration: "none" }}
          >
            Lightning Network
          </a>. No name is
          collected. No email address. No billing identity of any kind.
          The sats move, and the room opens.
        </p>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> WHAT YOU GET
        </div>
        <ul
          style={{
            listStyle: "none",
            padding: "0 0 0 16px",
            marginBottom: "0",
          }}
        >
          {[
            "One encrypted session room, up to 4 participants",
            "End-to-end encrypted signaling",
            "Peer-to-peer media — VOID’s server can’t see or hear",
            "Six video filters, processed locally on your device",
            "Five voice filters, processed locally on your device",
            "No account required... or possible.",
            "No logs or recordings or summaries.",
          ].map((item) => (
            <li key={item} style={{ marginBottom: "10px" }}>
              <span style={burntText}>→</span> {item}
            </li>
          ))}
        </ul>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={goldText}>▌</span> SELF-HOSTING
        </div>
        <p style={{ marginBottom: "16px" }}>
          VOID is open source.
        </p>
        <p style={{ marginBottom: "16px" }}>
          So, if you prefer, you can run your own server, and you can decide the
          price.
        </p>
        <p style={{ marginBottom: "0" }}>
          You would control the paywall. You could even remove it. You could
          replace it with your own Lightning node and gate access by whatever
          mechanism you prefer. Like coffee shop gift certificates -- that might make a nice payment
          mechanism.
        </p>
      </div>

      <div style={dividerStyle} />

      <div style={sectionStyle}>
        <div style={sectionHeadingStyle}>
          <span style={tealText}>▌</span>{" "}
          <span style={tealText}>IN SUMMARY</span>
        </div>

        <p style={{ marginBottom: "24px" }}>
          A man named Gerald once paid $47.99 every month to a company for a
          subscription he used twice. The company sold Gerald’s data for many
          years, and it was very popular data. Gerald’s subscription renewed
          automatically for 40 months. Gerald is fine. He says he does not
          think about it.
        </p>
        <p style={{ marginBottom: "28px", ...goldText }}>
          We did not build VOID for Gerald.
        </p>

      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "12px",
          padding: "28px 24px",
          maxWidth: "680px",
          width: "100%",
          backgroundColor: "var(--surface-dark)",
          backgroundImage:
            "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
          backgroundSize: "auto, 400px auto",
          backgroundRepeat: "repeat",
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
      </div>
    </PageShell>
  );
}
