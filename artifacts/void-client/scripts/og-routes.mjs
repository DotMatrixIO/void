// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * og-routes.mjs
 *
 * Single source of truth for per-route Open Graph + Twitter card metadata.
 *
 * Both gen-og-images.mjs (which renders the 1200x630 PNG cards) and
 * gen-og-pages.mjs (which writes per-route HTML files at build time so
 * crawlers see route-specific tags) import this file. Keep them in sync by
 * editing only here.
 *
 * Each entry has:
 *   slug:        Filename stem for the PNG card and the per-route HTML file
 *                ("/" route maps to slug "landing" but writes back into
 *                 index.html, see gen-og-pages.mjs).
 *   path:        Wouter route path that this OG card represents.
 *   title:       <title> + og:title + twitter:title (full string).
 *   description: <meta name=description>, og:description, twitter:description.
 *                Plain prose, ~140 chars max so it survives Twitter's truncation.
 *   headline:    The short string that gets rendered onto the OG image itself.
 *                Keep it punchy — these get drawn in Staatliches at large size
 *                onto a 1200x630 canvas, so anything past ~70 chars wraps badly.
 *   accent:      Color token used for the card's accent stripe and headline
 *                emphasis. One of "gold" | "teal" | "burnt".
 *   image:       (Optional) Explicit asset path (relative to the public
 *                root, e.g. "/og/foo.jpg") to use as the og:image /
 *                twitter:image for this route. When omitted, defaults to
 *                "/og/<slug>.png" — the templated card produced by
 *                gen-og-images.mjs. Set this to point a route at a
 *                hand-crafted asset (e.g. the editorial hero) instead of
 *                the templated card. When set, gen-og-images.mjs skips
 *                rendering a templated card for this route, since nothing
 *                would reference it.
 */

export const PALETTE = {
  bg: "#14110D",
  fg: "#BEB3A2",
  dim: "#9C8E7A",
  gold: "#E8A200",
  teal: "#0D9D8B",
  burnt: "#C85A00",
  red: "#CC2200",
};

export const OG_ROUTES = [
  {
    slug: "landing",
    path: "/",
    title: "VOID | Ephemeral, Zero-Knowledge Video Rooms",
    description:
      "Stateless, peer-to-peer video. No accounts. No logs. The room burns down when you're done.",
    headline:
      "Send anyone a link. They click. You talk. The room burns down.",
    accent: "gold",
    // Use the editorial hero (1200x630) as the social card. The landing
    // page is the most-shared link, and `/og/this-room-will-not-exist-
    // social.jpg` is the hand-crafted asset designed for that purpose.
    // The same image also serves any unrouted SPA page (e.g. /why) that
    // falls through to index.html, since gen-og-pages.mjs rewrites
    // index.html in-place with the landing route's metadata.
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "why",
    path: "/why",
    title: "VOID | The Case for Stateless, Zero-Knowledge Video",
    description:
      "There is a difference between a promise and a proof. A promise has a legal team. A proof is math. This is the case for stateless video.",
    headline: "We didn't make a promise. We made a proof.",
    accent: "gold",
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "compare",
    path: "/compare",
    title: "VOID | Why not Zoom, Meet, FaceTime, Signal, or Jitsi?",
    description:
      "Eleven rows. Six tools. We win eight rows. We lose three. Read it before anything else.",
    headline: "We win eight rows. We lose three.",
    accent: "teal",
    // Compare is the second-most-shared marketing link. Point it at the
    // editorial hero rather than the templated compare card, matching
    // the landing page's social preview.
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "threat-model",
    path: "/threat-model",
    title: "VOID | The Threat Model",
    description:
      "What we protect you from. What we don't. Why the difference matters.",
    headline: "What we protect you from. What we don't.",
    accent: "burnt",
  },
  {
    slug: "pricing",
    path: "/pricing",
    title: "VOID | Pricing — 1,000 sats per room",
    description:
      "1,000 sats — about $1 — per room. Lightning-native. One-shot. No subscription, no upsell.",
    headline: "1,000 sats. ≈ $1. The room burns down.",
    accent: "gold",
  },
  {
    slug: "biometric-masking",
    path: "/biometric-masking",
    title: "VOID | Biometric Masking Explained",
    description:
      "Your face is a database entry. Your voice is a fingerprint. VOID makes both of them useless.",
    headline: "Your face is a database entry. VOID makes it useless.",
    accent: "teal",
  },
  {
    slug: "limits",
    path: "/limits",
    title: "VOID | What VOID is not for",
    description:
      "Four people, hard cap. No recording. No native apps. Here's where VOID stops, and why.",
    headline: "What VOID is not for.",
    accent: "burnt",
  },
  {
    slug: "invited",
    path: "/invited",
    title: "VOID | You're invited — how to join",
    description:
      "Someone sent you a VOID link. No account, no payment to join. Two ways in — a link or six words — and what to expect in the room.",
    headline: "You're invited. Here's how to join.",
    accent: "teal",
    // Guest on-ramp is a link a host shares directly. Point it at the
    // editorial hero, matching the landing/why/compare social previews,
    // rather than rendering a templated card.
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "host",
    path: "/host",
    title: "VOID | How to host a room",
    description:
      "Pay once with Lightning, open the room, send the link, run the call. No account, no subscription. What you control during a call.",
    headline: "Pay once. Open the room. Run the call.",
    accent: "gold",
    // Host walkthrough is a link shared from the landing on-ramp. Point it
    // at the editorial hero, matching the landing/invited social previews,
    // rather than rendering a templated card.
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "tor",
    path: "/tor",
    title: "VOID | Hide your IP Address with Tor",
    description:
      "Reach VOID over Tor so the server can't see where you are. What Tor covers, what it doesn't, and the relay-only mitigation for the call itself.",
    headline: "Hide your IP Address. Reach VOID over Tor.",
    accent: "teal",
    // IP-hiding walkthrough is a link shared directly. Point it at the
    // editorial hero, matching the other guest-facing social previews,
    // rather than rendering a templated card.
    image: "/og/this-room-will-not-exist-social.jpg",
  },
  {
    slug: "law-enforcement",
    path: "/law-enforcement",
    title: "VOID | Law Enforcement Guidelines",
    description:
      "What we cannot produce. What the server can see. What we write to disk. What we could be compelled to log. Named, not promised.",
    headline: "What we can produce. What we can't. Named, not promised.",
    accent: "burnt",
  },
];

/**
 * Strict resolver: throws if the slug isn't recognised. Loud failure beats
 * silently shipping the wrong card.
 */
export function getRouteBySlug(slug) {
  const route = OG_ROUTES.find((r) => r.slug === slug);
  if (!route) {
    throw new Error(`Unknown OG route slug: ${slug}`);
  }
  return route;
}
