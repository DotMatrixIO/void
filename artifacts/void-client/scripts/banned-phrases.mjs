// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * banned-phrases.mjs
 *
 * Source of truth for the marketing-speak phrases that must not appear on
 * VOID's user-facing pages. This module is the canonical list — edit it here.
 *
 * Used by:
 *   - scripts/check-banned-phrases.mjs (CLI / CI entrypoint)
 *   - src/test/banned-phrases.test.ts  (unit test for the detector)
 *
 * Allowlist mechanism:
 *   A line is skipped if it, or the line immediately above it, contains the
 *   marker `banned-phrase-allow:` followed by a short reason. Use this only
 *   for legitimate technical uses (e.g. quoting the banned list itself in a
 *   doc page). Always include a reason.
 *
 *     {/* banned-phrase-allow: quoting the banned list verbatim *\/}
 *     <p>Avoid words like "powerful" or "seamless".</p>
 */

// Media-over-Tor claims (Task #817). The TURN-over-Tor research spike
// (docs/research/turn-over-tor-spike.md) concluded "don't build": routing
// WebRTC *media* over Tor adds ~400-750ms one-way latency and degrades to a
// "slideshow" under loss (TCP head-of-line blocking on a 3-hop circuit, worse
// on the real 6-hop onion path). VOID only fronts the *signaling* layer with a
// Tor hidden service; the media path always gathers ICE on the user's
// underlying network and relays via clearnet TURN. So any copy asserting that
// calls, video, or audio are routed / tunnelled / anonymized OVER Tor is a
// technically-true-but-unusable claim the experience cannot honour.
//
// This rule fires only when a media noun AND an affirmative transport verb
// (route / tunnel / anonymize / proxy / carry) AND an "over|through|via|across
// Tor" connector all appear in the same clause (verb-then-media or
// media-then-verb). Requiring the transport verb is what keeps the honest
// framing sayable: "signaling over Tor", ".onion mirror", "relay-pinned so
// your IP isn't shared with peers", "media relays via clearnet TURN", and even
// the cautionary "WebRTC media over Tor is usually a bad experience" all pass,
// because none of them route media over Tor with a transport verb. For any
// legitimate exception, add a `banned-phrase-allow:` marker with a reason.
const MEDIA_NOUN = "(?:media|calls?|video|audio|streams?)";
const TOR_TRANSPORT_VERB =
  "(?:rout(?:e|es|ed|ing)|tunnell?(?:s|ed|ing)?|anonymi[sz](?:e|es|ed|ing)?|proxie[ds]?|proxying|carr(?:y|ies|ied))";
// Stay within one clause: never cross a sentence/clause break (`.`, `;`, or a
// newline) so an honest "signaling over Tor; media relays via clearnet TURN"
// can't be stitched into a false positive.
const SAME_CLAUSE = "[^.;\\n]*?";
const MEDIA_OVER_TOR = new RegExp(
  "\\b(?:" +
    `${TOR_TRANSPORT_VERB}\\b${SAME_CLAUSE}\\b${MEDIA_NOUN}` +
    "|" +
    `${MEDIA_NOUN}\\b${SAME_CLAUSE}\\b${TOR_TRANSPORT_VERB}` +
    ")\\b" +
    `${SAME_CLAUSE}\\b(?:over|through|thru|via|across)\\b${SAME_CLAUSE}\\btor\\b`,
  "i",
);

// Grant-application name leak (Task #959). VOID's publication is funded under
// an in-flight grant; the funder's and the grant programme's names are NOT
// part of the public product story and must never drift into user- or
// operator-facing copy (the in-app pages, the package manifests, or the
// self-host runbook). The README's AI-assistance disclosure refers to "the
// project's funders" generically on purpose — that is the honest framing we
// ship. These rules pin specific proper nouns ("NLnet", "NGI Zero" / "NGI0")
// rather than the generic word "grant" so legitimate prose (and the unrelated
// crypto "grant nonce" identifiers elsewhere in the tree) never false-fires.
// For any genuinely legitimate use, add a `banned-phrase-allow:` marker with a
// reason.
const GRANT_NLNET = /\bnlnet\b/i;
const GRANT_NGI_ZERO = /\bngi[-\s]?(?:zero|0)\b/i;

export const BANNED_PHRASES = [
  { label: "grant-application name (NLnet)", pattern: GRANT_NLNET },
  { label: "grant-application name (NGI Zero)", pattern: GRANT_NGI_ZERO },
  { label: "media routed over Tor", pattern: MEDIA_OVER_TOR },
  { label: "powerful", pattern: /\bpowerful\w*\b/i },
  { label: "seamless", pattern: /\bseamless\w*\b/i },
  { label: "robust", pattern: /\brobust\w*\b/i },
  { label: "sovereignty-first", pattern: /\bsovereignty-first\b/i },
  { label: "best-in-class", pattern: /\bbest-in-class\b/i },
  { label: "next-generation", pattern: /\bnext-generation\b/i },
  { label: "world-class", pattern: /\bworld-class\b/i },
  // Cover straight, curly, and modifier-letter apostrophes.
  { label: "we're committed to", pattern: /\bwe['\u2019\u02BC]re committed to\b/i },
  // Tor reachability / routing wording (Task #238). The StartOS and Umbrel
  // packages are .onion-reachable — the signaling layer can be fronted by a
  // Tor hidden service — but they are NOT Tor-routed end-to-end: WebRTC
  // media still gathers ICE candidates on the user's underlying network. Any
  // copy that says "Tor-by-default" or describes VOID traffic as "Tor-routed"
  // is the exact drift this rule guards. Legitimate user-facing recommendations
  // about a "Tor-routed wallet" or "Tor-routed node" (advice to the host about
  // their Lightning wallet) are excluded by lookahead. For any other
  // legitimate use, add a `banned-phrase-allow:` marker with a short reason.
  { label: "Tor-by-default", pattern: /\btor[-\s]by[-\s]default\b/i },
  {
    label: "Tor-routed (use .onion-reachable)",
    pattern: /\btor[-\s]routed\b(?!\s+(?:wallet|node))/i,
  },
];

const ALLOW_MARKER = /banned-phrase-allow\s*:/;

/**
 * Scan a single string of source content for banned phrases.
 *
 * Returns an array of { line, phrase, excerpt } objects, one per violation.
 * An empty array means the content is clean.
 */
export function scanContent(content) {
  const lines = content.split(/\r?\n/);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_MARKER.test(line)) continue;
    if (i > 0 && ALLOW_MARKER.test(lines[i - 1])) continue;
    for (const { label, pattern } of BANNED_PHRASES) {
      if (pattern.test(line)) {
        violations.push({
          line: i + 1,
          phrase: label,
          excerpt: line.trim(),
        });
      }
    }
  }
  return violations;
}
