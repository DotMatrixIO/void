#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-required-literals.mjs
 *
 * Companion to check-banned-phrases.mjs. Where that script fails when a
 * banned marketing phrase APPEARS, this script fails when a load-bearing
 * editorial literal DISAPPEARS (or, in one case, when a hidden-feature
 * phrase reappears in a section it must never re-enter).
 *
 * The assertions below encode tone-rewrite decisions that future copy edits
 * could silently regress:
 *
 *   1. ThreatModelPage must NOT contain "hybrid (human plus agent)" inside
 *      any "WHAT THE SERVER SEES" list. AgentMode is hidden in v0.5 and the
 *      server-visibility list must not advertise it.
 *   2. DocsHowItWorksPage must contain the exact phrase "66 bits of chaos".
 *      (Moved from WhyPage during the WHY-page IA rework — the wonkish
 *      entropy framing now lives on the long-form HOW IT WORKS page; the
 *      short-form WhyPage is reserved for "why this project exists" prose.)
 *   3. ThreatModelPage must contain the phrase "32-character lowercase hex".
 *   4. DocsPricingPage must contain the Gerald anecdote ("A man named Gerald").
 *   5. PreviewGate, the phrase-share modal, and the in-room share sheet must
 *      each contain the clipboard-caution caption that names concrete
 *      platforms (older Android, in-app browsers). See tasks #373 / #916.
 *   6. Every share-affordance file must contain the fragment-leak caption.
 *      The phrase travels in the URL fragment when the join link is
 *      shared, and any process with read access to the URL — browser
 *      sync, history, extensions — sees the phrase. Pinned here so a
 *      future "let's soften this" edit fails CI. See task #399.
 *   7. The phrase-share modal and in-room share sheet must contain the
 *      link-mangling caution. Some messengers/proxies (Slack, LinkedIn)
 *      rewrite or strip a plain join link; the caution tells the sharer to
 *      use the QR or read the six words aloud instead. Pinned so a future
 *      tone rewrite can't quietly drop or soften it. See task #730.
 *   8. BurnedOverlay must contain the host-token cleanup-failure warning.
 *  10. WhyPage must keep the four load-bearing lines of the founder's-note
 *      rewrite — the structural-proof framing ("the room can't betray you,
 *      because there is nothing in it to take", "so I can't hand over what I
 *      didn't build", "the whole thing breaks on purpose") and the Gameboy
 *      payoff ("an act of refusal in 2026"). These are the page's argument;
 *      a future tone rewrite that softened or dropped them would gut the
 *      note, so they're pinned the way other pages' anchor lines are.
 *  11. WhyPage must also keep the founder's-note closing line ("Enough
 *      presence to trust. Not enough to surveil.") and the privacy caveat
 *      that names the concrete remedy ("its .onion address in Tor Browser").
 *      The closing line is the note's thesis restated; the caveat is the one
 *      honest limitation the page owns (the server still sees an IP) plus
 *      the actionable fix. NOTE (Task #792): the remedy must steer to the
 *      .onion ADDRESS, never the old "open VOID in Tor Browser" — only an
 *      onion ORIGIN triggers the relay-only ICE pin; clearnet-URL-over-Tor
 *      does not. This literal lives in the build-time onion-gated branch, so
 *      it is present in source even though it only renders when a .onion
 *      mirror is baked. Both were only loosely covered by
 *      whyShortForm.test.tsx, so a tone rewrite could soften or drop them
 *      without failing CI. Pinned here alongside the other anchor lines.
 *  12. WhyPage must keep the four opening "philosophy" lines that frame why
 *      the project exists — the watched-by-default premise ("Everything we
 *      say and do online is watched"), the felt cost ("it feels exactly as
 *      creepy as it is"), the verdict ("This is unacceptable, but somehow
 *      we’ve agreed to call it normal"), and the wholesome reframe ("a
 *      little more privacy and a little more anonymity in our digital lives
 *      strikes me as downright wholesome"). These paragraphs were just
 *      hand-edited for tone and nothing pinned the new wording, so a future
 *      refactor or copy pass could silently revert them. Locked here the way
 *      the other anchor lines are.
 *   9. HostPage's share affordance must keep its HOST-facing framing — the
 *      "Hosting someone? Send them this page ahead of the call" heading and
 *      the "Copies the link to the guest walkthrough so you can send it to
 *      your guest." caption. Unlike the other share affordances this one
 *      points OUTWARD (the host sends the guest walkthrough to the guest),
 *      and a future tone rewrite could silently flip it back to guest-facing
 *      language and re-introduce the confusion this edit fixed. (The
 *      affordance moved off /invited when that page was split into the guest
 *      walkthrough, /host, and /tor.) Pinned so any such rewrite fails CI in
 *      the same commit.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:literals
 *
 * Wired into CI as part of the `marketing-voice` validation workflow.
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const PAGES_DIR = resolve(CLIENT_ROOT, "src", "pages");
const COMPONENTS_DIR = resolve(CLIENT_ROOT, "src", "components");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const DOCS_HOW_IT_WORKS_PAGE = resolve(PAGES_DIR, "docs", "DocsHowItWorksPage.tsx");
const WHY_PAGE = resolve(PAGES_DIR, "WhyPage.tsx");
const LANDING_PAGE = resolve(PAGES_DIR, "LandingPage.tsx");
const THREAT_PAGE = resolve(PAGES_DIR, "ThreatModelPage.tsx");
const PRICING_PAGE = resolve(PAGES_DIR, "docs", "DocsPricingPage.tsx");
const PREVIEW_GATE = resolve(PAGES_DIR, "PreviewGate.tsx");
const HOST_PAGE = resolve(PAGES_DIR, "HostPage.tsx");
const ROOM_PAGE = resolve(PAGES_DIR, "RoomPage.tsx");
const ROOM_HEADER_BAR = resolve(PAGES_DIR, "room", "RoomHeaderBar.tsx");
const PHRASE_SHARE_MODAL = resolve(COMPONENTS_DIR, "PhraseShareModal.tsx");
const ROOM_SHARE_SHEET = resolve(COMPONENTS_DIR, "RoomShareSheet.tsx");
const BURNED_OVERLAY = resolve(COMPONENTS_DIR, "BurnedOverlay.tsx");

const CLIPBOARD_CAUTION_CAPTION =
  "On older Android and many in-app browsers, other apps can read the clipboard. QR doesn’t touch it.";

const FRAGMENT_LEAK_CAPTION =
  "Phrase travels in the URL. Anything that reads the URL — browser sync, history, extensions — reads the phrase.";

const LINK_MANGLING_CAUTION =
  "Some messengers and proxies (Slack, LinkedIn) can mangle the link. Share the QR or read the six words aloud instead.";

// ThreatModelPage's §3.5 server-observable block is rendered from this
// shared markdown fragment (imported via Vite `?raw`). Required literals
// that live in the fragment must be checked against the union of the
// page source and the fragment.
const SERVER_OBSERVABLE_FRAGMENT = resolve(
  REPO_ROOT,
  "docs",
  "_fragments",
  "server-observable.md",
);

const SERVER_SEES_HEADING = "WHAT THE SERVER SEES";
const HIDDEN_AGENT_PHRASE = "hybrid (human plus agent)";

// Canonical "no install — opens from a link" summary surfaces (task-1096).
// VOID promotes "no app to install; it opens from a link" to a named second
// property in every headline/summary. Pin a short distinctive fragment of
// that summary to each surface so a future tone rewrite of one surface can't
// silently drop the property or let the summaries drift apart. The fragment
// is a raw-source substring match, so it must sit contiguously on one line.
const README = resolve(REPO_ROOT, "README.md");
const INDEX_HTML = resolve(CLIENT_ROOT, "index.html");
const MANIFEST_JSON = resolve(CLIENT_ROOT, "public", "manifest.json");
const OG_ROUTES_FILE = resolve(__dirname, "og-routes.mjs");
const HOW_IT_WORKS_PAGE = resolve(PAGES_DIR, "HowItWorksPage.tsx");
const PAGE_FOOTER = resolve(COMPONENTS_DIR, "PageFooter.tsx");
const MEDIA_PAGE = resolve(PAGES_DIR, "MediaPage.tsx");
const NO_INSTALL_SENTINEL = "opens from a link";
// gen-og-pages.mjs rewrites index.html's landing meta from og-routes.mjs at
// build time, so the index.html summary surface legitimately spans both files
// — accept the sentinel from either via alsoSearch.
const NO_INSTALL_SURFACES = [
  { file: README },
  { file: INDEX_HTML, alsoSearch: [OG_ROUTES_FILE] },
  { file: MANIFEST_JSON },
  { file: LANDING_PAGE },
  { file: HOW_IT_WORKS_PAGE },
  { file: DOCS_HOW_IT_WORKS_PAGE },
  { file: PAGE_FOOTER },
  { file: MEDIA_PAGE },
];

const violations = [];

function checkRequiredLiteral(file, literal, reason, alsoSearch = []) {
  const sources = [file, ...alsoSearch];
  const hit = sources.some((p) => readFileSync(p, "utf8").includes(literal));
  if (!hit) {
    violations.push({
      file,
      message:
        `Required literal missing: ${JSON.stringify(literal)}\n    Reason: ${reason}` +
        (alsoSearch.length
          ? `\n    Also searched: ${alsoSearch
              .map((p) => relative(REPO_ROOT, p))
              .join(", ")}`
          : ""),
    });
  }
}

/**
 * Returns the substrings of `content` that fall inside any "WHAT THE SERVER
 * SEES" section. A section starts at the heading and ends at the next
 * top-level divider (`<div style={dividerStyle} />`) or end of file —
 * whichever comes first. This is intentionally loose: any list, paragraph,
 * or JSX inside that section counts.
 */
function extractServerSeesSections(content) {
  const sections = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf(SERVER_SEES_HEADING, cursor);
    if (start === -1) break;
    const dividerIdx = content.indexOf("dividerStyle", start + SERVER_SEES_HEADING.length);
    const end = dividerIdx === -1 ? content.length : dividerIdx;
    sections.push({ start, end, text: content.slice(start, end) });
    cursor = end;
  }
  return sections;
}

function checkForbiddenInServerSeesSections(file, forbidden, reason) {
  const content = readFileSync(file, "utf8");
  const sections = extractServerSeesSections(content);
  for (const section of sections) {
    if (section.text.includes(forbidden)) {
      const offsetInSection = section.text.indexOf(forbidden);
      const absoluteOffset = section.start + offsetInSection;
      const line = content.slice(0, absoluteOffset).split("\n").length;
      violations.push({
        file,
        message:
          `Forbidden literal ${JSON.stringify(forbidden)} found inside a "${SERVER_SEES_HEADING}" section at line ${line}.\n    Reason: ${reason}`,
      });
    }
  }
}

// 1. AgentMode must stay hidden from the server-visibility list in v0.5.
checkForbiddenInServerSeesSections(
  THREAT_PAGE,
  HIDDEN_AGENT_PHRASE,
  'AgentMode is hidden in v0.5; the "WHAT THE SERVER SEES" list must not advertise hybrid sessions.',
);

// 2. DocsHowItWorksPage must keep the "66 bits of chaos" framing.
//    (Relocated from WhyPage during the WHY-page IA rework — the wonkish
//    entropy framing belongs on the long-form HOW IT WORKS page.)
checkRequiredLiteral(
  DOCS_HOW_IT_WORKS_PAGE,
  "66 bits of chaos",
  "Editorial framing of room-phrase entropy on DocsHowItWorksPage.",
);

// 3. ThreatModelPage (or the shared §3.5 fragment it renders) must keep
//    the precise room-ID description.
checkRequiredLiteral(
  THREAT_PAGE,
  "32-character lowercase hex",
  "Precise room-ID description in the server-visibility list.",
  [SERVER_OBSERVABLE_FRAGMENT],
);

// 4. DocsPricingPage must keep the Gerald anecdote.
checkRequiredLiteral(
  PRICING_PAGE,
  "A man named Gerald",
  "Pricing-page anecdote that anchors the per-room price comparison.",
);

// 5. PreviewGate, the phrase-share modal, and the in-room share sheet must
//    each keep the clipboard-caution caption beside their COPY affordance.
//    It names concrete platforms (older Android, in-app browsers) in the same
//    sentence as the claim — rejects hedge-soup. The caption now appears on
//    all three surfaces; the other two relied solely on component tests, so a
//    future edit could quietly drop it on one of them. Pinned here so any such
//    edit fails CI on whichever surface regressed. See tasks #373 / #916.
for (const file of [PREVIEW_GATE, PHRASE_SHARE_MODAL, ROOM_SHARE_SHEET]) {
  checkRequiredLiteral(
    file,
    CLIPBOARD_CAUTION_CAPTION,
    "Clipboard-caution caption beside the COPY affordance (tasks #373 / #916).",
  );
}

// 6. Every share affordance must keep the fragment-leak caption (task #399).
//    The phrase travels in the URL fragment when the join link is shared,
//    so anything with read access to the URL — browser sync, history,
//    extensions — sees the phrase. Drift here softens the warning the host
//    sees at the decision point.
for (const file of [
  PREVIEW_GATE,
  ROOM_PAGE,
  PHRASE_SHARE_MODAL,
  ROOM_SHARE_SHEET,
]) {
  // RoomPage's share affordance was extracted into ./room/RoomHeaderBar.tsx
  // during task #497; accept the literal in either location so the refactor
  // does not regress the pinned caption.
  const alsoSearch = file === ROOM_PAGE ? [ROOM_HEADER_BAR] : [];
  checkRequiredLiteral(
    file,
    FRAGMENT_LEAK_CAPTION,
    "Fragment-leak caption at the share affordance (task #399).",
    alsoSearch,
  );
}

// 7. The phrase-share modal and in-room share sheet must keep the
//    link-mangling caution (task #730). Some messengers/proxies (Slack,
//    LinkedIn) rewrite or strip a plain join link; the caution steers the
//    sharer to the QR or the spoken six words. Pinned here so a future tone
//    rewrite can't quietly drop or soften it.
for (const file of [PHRASE_SHARE_MODAL, ROOM_SHARE_SHEET]) {
  checkRequiredLiteral(
    file,
    LINK_MANGLING_CAUTION,
    "Link-mangling caution at the share affordance (task #730).",
  );
}

// 8. BurnedOverlay must keep the security-grade host-token cleanup-failure
//    warning (task #450). The literal warns the user that an explicit BURN
//    could not clear the persisted reclaim credential — a future tone edit
//    that softens this into "burn may be incomplete" or removes the
//    "TOKEN MAY PERSIST" qualifier would silently regress the security
//    signal. Locked here so any rewrite fails CI in the same commit.
checkRequiredLiteral(
  BURNED_OVERLAY,
  "BURN INCOMPLETE — TOKEN MAY PERSIST",
  "Host-token cleanup-failure warning on the ROOM BURNED overlay (task #450).",
);

// 9. HostPage's share affordance must keep its HOST-facing framing. The
//    affordance points OUTWARD — the host sends the guest walkthrough to the
//    guest — unlike every other share affordance on the site. A future tone
//    rewrite could silently flip it back to guest-facing language and
//    re-introduce the confusion the reframing fixed. Both the heading and the
//    helper caption are pinned so any such rewrite fails CI in the same
//    commit. (Moved off InvitedPage when /invited was split into the guest
//    walkthrough, /host, and /tor.)
checkRequiredLiteral(
  HOST_PAGE,
  "Hosting someone? Send them this page ahead of the call",
  "Host-facing heading on the HostPage share affordance.",
);
checkRequiredLiteral(
  HOST_PAGE,
  "Copies the link to the guest walkthrough so you can send it to your guest.",
  "Host-facing helper caption on the HostPage share affordance.",
);

// 10. WhyPage must keep the four load-bearing lines of the founder's-note
//     rewrite. The structural-proof framing ("nothing in it to take", "can't
//     hand over what I didn't build", "breaks on purpose") and the Gameboy
//     payoff ("an act of refusal in 2026") are the page's whole argument; a
//     future tone rewrite that softened or dropped them would gut the note.
//     Pinned the way other pages' anchor lines are.
for (const literal of [
  "I didn’t build the things that could be turned against us",
  "so they can’t be handed over",
  "the whole thing breaks on purpose",
  "an act of refusal in 2026",
]) {
  checkRequiredLiteral(
    WHY_PAGE,
    literal,
    "Load-bearing founder's-note line on WhyPage.",
  );
}

// 11. WhyPage must also keep the founder's-note closing line and the privacy
//     caveat that names the concrete remedy. The closing line restates the
//     note's thesis; the caveat owns the one honest limitation (the server
//     still sees an IP) and gives the actionable fix. Both were only loosely
//     covered by whyShortForm.test.tsx, so a tone rewrite could soften or
//     drop them without failing CI. Pinned alongside the other anchor lines.
for (const literal of [
  "Enough presence to trust. Not enough to surveil.",
  "its .onion address in Tor Browser",
]) {
  checkRequiredLiteral(
    WHY_PAGE,
    literal,
    "Founder's-note closing line / privacy caveat on WhyPage.",
  );
}

// 11b. LandingPage's worried-guest Tor sentence is safety-critical copy
//      (Task #792): a frightened reader makes a real safety decision on
//      these words. The two clauses that keep it honest must not be softened
//      or dropped by a future tone pass — the remedy steers to the .onion
//      ADDRESS (only an onion ORIGIN gets the relay-only ICE pin), and the
//      scope limit (NOT anonymous, does NOT hide the other participant) sits
//      in the same breath. Pinned in source; the sentence itself only
//      renders when a .onion mirror is baked, so this is the drift guard.
for (const literal of [
  "its .onion address in Tor Browser",
  "does not make the call anonymous or hide you from the other people in the room",
]) {
  checkRequiredLiteral(
    LANDING_PAGE,
    literal,
    "Safety-critical worried-guest Tor sentence on LandingPage.",
  );
}

// 12. WhyPage must keep the four opening "philosophy" lines that were just
//     hand-edited for tone. They frame the page's premise (the watched-by-
//     default web), the felt cost, the verdict, and the wholesome reframe;
//     nothing pinned the new wording, so a future refactor or copy pass
//     could silently revert them. Locked alongside the other anchor lines.
for (const literal of [
  "Everything we say and do online is watched, and we all know this.",
  "It’s constant and feels creepy",
  "It’s unacceptable, but we call it normal.",
  "More privacy is the wholesome move here.",
]) {
  checkRequiredLiteral(
    WHY_PAGE,
    literal,
    "Opening philosophy line on WhyPage (tone-rewrite lock).",
  );
}

for (const { file, alsoSearch = [] } of NO_INSTALL_SURFACES) {
  checkRequiredLiteral(
    file,
    NO_INSTALL_SENTINEL,
    'Canonical no-install summary sentinel (task-1096) — every headline/summary surface must keep the "opens from a link" framing so the summaries cannot silently drift apart.',
    alsoSearch,
  );
}

if (violations.length > 0) {
  console.error(
    `Required-literal check failed in ${violations.length} location(s):\n`,
  );
  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file);
    console.error(`  ${rel}`);
    console.error(`    ${v.message}`);
    console.error("");
  }
  console.error(
    "These literals were preserved by an earlier tone rewrite and must not",
  );
  console.error(
    "regress. If you intentionally changed one, update this script in the",
  );
  console.error("same commit so the new wording is locked in.");
  process.exit(1);
}

console.log(
  "Required-literal check passed: all assertions verified across long-form pages, the no-install summary surfaces, the WHY founder's-note, share affordances, and the BURN overlay.",
);
