// SPDX-License-Identifier: AGPL-3.0-or-later
// Anchor-redirect maps for the short-form / hub-and-spoke pages.
//
// Tasks #545 and #550 flipped `/why` and `/threat-model` from
// long-form prose to short-form pages; the long prose now lives at
// `/docs/how-it-works` (formerly `/docs/why` — renamed in the WHY-IA
// rework) and `/docs/threat-model`. Pre-existing inbound deep links
// to the long sections need to keep working — visiting
// `/why#encryption` should land on `/docs/how-it-works#encryption`,
// and `/threat-model#browser-level-surfaces` should land on
// `/docs/threat-model#browser-level-surfaces`.
//
// This is the canonical anchor list, shared by:
//   - WhyPage.tsx / ThreatModelPage.tsx (do the client-side redirect on mount)
//   - whyAnchorRedirects.test.ts / threatModelAnchorRedirects.test.ts
//
// Edit these sets — and only these sets — when adding or removing
// long-form anchors. Membership rule (per Task #550 plan): include an
// anchor only when (a) it exists on the destination /docs page AND
// (b) it is referenced from somewhere else in the repo. Orphan anchors
// don't need a redirect — they already resolve directly on /docs.
export const WHY_REDIRECT_ANCHORS: ReadonlySet<string> = new Set([
  "#encryption",
  "#philosophy",
  "#the-void-phrase",
  "#video-filters",
  "#voice-masks",
]);

export function whyAnchorRedirectTarget(
  hash: string,
  basePath: string,
): string | null {
  if (!WHY_REDIRECT_ANCHORS.has(hash)) return null;
  const base = basePath.replace(/\/$/, "");
  return `${base}/docs/how-it-works${hash}`;
}

// THREAT MODEL redirect set. Sourced from the cross-reference graph
// at task time:
//   - StartScreen.tsx / StartScreen.test.tsx → #browser-level-surfaces
//   - PaywallModal (and its test) → #lightning-ip-leak
//   - Tor-wallet copy historically deep-linked → #tor-wallet-shortlist
//   - Supply-chain copy historically deep-linked → #supply-chain
// All four IDs are preserved on /docs/threat-model; the redirect
// keeps existing inbound links working without an HTTP 301.
export const THREAT_MODEL_REDIRECT_ANCHORS: ReadonlySet<string> = new Set([
  "#lightning-ip-leak",
  "#tor-wallet-shortlist",
  "#browser-level-surfaces",
  "#supply-chain",
]);

export function threatModelAnchorRedirectTarget(
  hash: string,
  basePath: string,
): string | null {
  if (!THREAT_MODEL_REDIRECT_ANCHORS.has(hash)) return null;
  const base = basePath.replace(/\/$/, "");
  return `${base}/docs/threat-model${hash}`;
}
