// SPDX-License-Identifier: AGPL-3.0-or-later
import { Link } from "wouter";
import { REPO_URL, hasPublicRepo } from "@/lib/repo";
import OnionMirrorLink from "@/components/OnionMirrorLink";
import BuildProvenanceBadge from "@/components/BuildProvenanceBadge";

interface PageFooterProps {
  paddingTop?: string;
  /**
   * Render the footer for a dark pavement-band parent (LandingPage's
   * lower section). Flips text from --fg-dim (tuned for tan --bg) to
   * the on-pavement headerBtn token #A89E90 and brightens the accent
   * link color so contrast stays AA on #14110D. Background is left
   * transparent in both modes; the parent paints the surface.
   */
  onPavement?: boolean;
}

export default function PageFooter({ paddingTop = "24px", onPavement = false }: PageFooterProps) {
  const textColor = onPavement ? "#A89E90" : "var(--fg-dim)";
  const linkColor = onPavement ? "var(--gold)" : "#B84A00";
  return (
    <div
      style={{
        padding: `${paddingTop} 16px 24px`,
        textAlign: "center",
        fontSize: "12px",
        color: textColor,
        letterSpacing: "2px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
      }}
    >
      {/* PRE-LAUNCH WORKAROUND — remove this guard once REPO_URL is set.
          While REPO_URL is the placeholder (the public repo isn't published
          until launch, per launch checklist §0.1) we hide the source line
          entirely rather than render the literal "[[TO BE ADDED]]" as a
          broken link. This is acceptable only during development: AGPLv3
          §13 requires a running production service to offer Corresponding
          Source, so the production build refuses to ship with the
          placeholder (scripts/check-repo-url.mjs). Once REPO_URL holds a
          real repo-root URL, hasPublicRepo() flips true and the link below
          renders for everyone. (If the URL itself should be visible for
          transparency, surface it as a muted subtitle under the label — but
          the default is label-only, matching the other footer links.) */}
      {hasPublicRepo() && (
        <div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: linkColor,
              textDecoration: "none",
              letterSpacing: "2px",
            }}
          >
            SOURCE / SELF-HOST
          </a>
        </div>
      )}
      <div style={{ fontSize: "11px", color: textColor, letterSpacing: "1px", maxWidth: "32rem" }}>
        AGPLV3 · §13: THE EXACT BUILD RUNNING HERE IS VERIFIABLE BELOW
      </div>
      <BuildProvenanceBadge />
      <div>
        <Link
          href="/law-enforcement"
          style={{
            color: linkColor,
            textDecoration: "none",
            letterSpacing: "2px",
          }}
        >
          LAW ENFORCEMENT →
        </Link>
      </div>
      <div>
        <Link
          href="/docs"
          style={{
            color: linkColor,
            textDecoration: "none",
            letterSpacing: "2px",
          }}
          data-testid="footer-docs-link"
        >
          DOCS →
        </Link>
      </div>
      <OnionMirrorLink />
      {/* Architecture spec line — the quiet, one-line technical summary that
          used to be a loud orange band on the landing page. Lives here as the
          footer's bottom row so it reads as a spec/credits line site-wide.
          Inherits the footer's text token: --fg-dim on tan --bg (6.56:1,
          fgDim/bg) or #A89E90 on the landing's #14110D pavement (7.13:1,
          headerBtn/headerBg) — both already audited in check-contrast.mjs, so
          no new pair is needed. Per-term casing is authored (P2P, E2E, AGPLv3);
          middots separate the clauses; it wraps gracefully on narrow widths. */}
      <div
        style={{
          marginTop: "4px",
          maxWidth: "440px",
          fontSize: "11px",
          letterSpacing: "1px",
          lineHeight: 1.7,
          // Bake the dim into the text color (alpha channel) instead of the
          // `opacity` property: opacity < 1 promotes a compositing layer, the
          // same class of trigger behind the landing text-vanish bug. color-mix
          // keeps the exact 85% tint with no layer (see .landing-haze in index.css).
          color: "color-mix(in srgb, currentColor 85%, transparent)",
        }}
      >
        P2P · no accounts · no room content stored · E2E encrypted · ephemeral keys · AGPLv3 · © 2026 VOID
      </div>
    </div>
  );
}
