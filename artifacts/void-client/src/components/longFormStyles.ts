// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared long-form typography + card recipe for every docs and marketing
// page. Before this module the page/docs shell (icon+BACK header, the
// concrete-over-#14110D card) and its type scale were copy-pasted into each
// page file, which is why body size and secondary-heading treatment had
// drifted (aesthetic-audit findings C2/C3/C8). Defining them once here —
// consumed via PageShell and these constants — keeps type consistent.

import type { CSSProperties } from "react";

// The concrete-textured dark card every long-form section sits in. Body copy
// is standardized at 16px (matching the section sub-headings — bumped up from
// 14px for readability of the long-form serif; was the resolution for finding
// C3, which had pages drifting across 12/13/14px).
// The card bg/fg/overlay and the body face are parameterized through CSS
// variables whose fallbacks reproduce the original values exactly (so every
// other page is unchanged). --font-body is the chosen long-form serif
// (Source Serif 4), set in index.css.
export const sectionStyle: CSSProperties = {
  maxWidth: "680px",
  width: "100%",
  padding: "28px 24px",
  backgroundColor: "var(--lf-card-bg, var(--surface-dark))",
  backgroundImage:
    "linear-gradient(var(--lf-card-overlay, rgba(20,17,13,0.82)), var(--lf-card-overlay, rgba(20,17,13,0.82))), url('/concrete.jpeg')",
  backgroundSize: "auto, 400px auto",
  backgroundRepeat: "repeat",
  color: "var(--lf-card-fg, var(--fg-on-dark))",
  fontFamily: "var(--font-body)",
  fontSize: "16px",
  lineHeight: 1.85,
  letterSpacing: "0.4px",
};

// Solid (non-concrete) variant for sections that deliberately drop the
// texture — same type scale as sectionStyle.
export const plainSectionStyle: CSSProperties = {
  ...sectionStyle,
  backgroundColor: "#1A1612",
  backgroundImage: "none",
};

// Anchor-target variant. Pages that deep-link to individual sections
// (e.g. /docs/how-it-works#encryption) need a scroll offset so the
// linked section doesn't land flush against the top of the viewport.
// The base sectionStyle/plainSectionStyle carry no scroll offset; wrap
// them here to opt in without re-declaring the whole type scale locally
// (which is how the body type on those pages used to drift).
export function withScrollOffset(
  style: CSSProperties,
  offset = "20px",
): CSSProperties {
  return { ...style, scrollMarginTop: offset };
}

// The one display heading (H1). Gold Staatliches — already consistent across
// the system; pinned here so it stays that way.
export const headingStyle: CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontWeight: 400,
  fontSize: "clamp(28px, 6vw, 36px)",
  letterSpacing: "4px",
  textTransform: "uppercase",
  color: "var(--gold)",
  lineHeight: 1.1,
  marginBottom: "20px",
};

// The single editorial lead under H1 (e.g. Compare's "FAIR QUESTION.").
// Teal Staatliches with a teal rule. One per page.
export const leadStyle: CSSProperties = {
  fontFamily: "'Staatliches', system-ui, sans-serif",
  fontSize: "clamp(20px, 4.5vw, 28px)",
  letterSpacing: "2px",
  lineHeight: 1.25,
  color: "var(--teal)",
  textTransform: "uppercase",
  margin: "0 0 28px",
  borderLeft: "4px solid var(--teal)",
  paddingLeft: "16px",
};

// The standardized secondary/section heading used across every long-form
// page: burnt mono small-caps, paired with the `▌` marker. This is the one
// section-heading treatment (resolution for finding C2) — no page should
// re-declare its own.
export const sectionHeadingStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "22px",
  fontWeight: 700,
  letterSpacing: "3px",
  textTransform: "uppercase",
  color: "var(--burnt)",
  marginBottom: "16px",
  marginTop: "28px",
};

export const dividerStyle: CSSProperties = {
  height: "3px",
  background: "var(--gold)",
  opacity: 0.6,
  margin: "0",
  maxWidth: "680px",
  width: "100%",
};

export const linkStyle: CSSProperties = {
  /* contrast-exception: shared style definitions with no background of
     their own — the scanner pairs them with the unrelated dividerStyle
     gold background above. Actual usage sites are on the long-form
     pages' dark sections. */
  color: "var(--gold)",
  textDecoration: "none",
  borderBottom: "1px solid var(--gold)",
};

/* contrast-exception: shared accent-text style definitions with no
   background of their own — the scanner pairs them with the unrelated
   dividerStyle gold background above. Usage sites are dark sections. */
export const tealText: CSSProperties = { color: "var(--teal)" };
export const goldText: CSSProperties = { color: "var(--gold)" };
export const burntText: CSSProperties = { color: "var(--burnt)" };
