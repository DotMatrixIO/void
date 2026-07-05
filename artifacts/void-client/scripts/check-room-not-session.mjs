#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-room-not-session.mjs
 *
 * Guards the settled product-language model documented in the project's
 * internal SESSION-vs-ROOM vocabulary notes and
 * `artifacts/void-client/docs/aesthetic-audit.md` (V1): the in-app runtime
 * UI names the paid space ROOM (host / join / recover / extend / burn), the
 * live conversation "call", and reserves "session" for cryptographic uses
 * only. Task #826 migrated the runtime chrome off "SESSION" by hand across
 * BurnedOverlay, the RoomPage overlays, the BURN tooltip, the room-expiry
 * leave notice, and PaywallModal. Nothing guarded it — a future copy edit
 * could quietly reintroduce a user-facing "SESSION" string and no check
 * would catch it.
 *
 * This script fails (exit 1) when the standalone, all-caps token "SESSION"
 * appears in user-facing client source. The runtime chrome is uppercase
 * ("ROOM ENDED", "ROOM BURNED", "ROOM EXPIRED"), so a reintroduction would
 * read "SESSION ENDED" / "SESSION EXPIRED" — exactly what this catches.
 *
 * Softer mixed-case copy ("Session ended", "Session expired", "Your Session")
 * would slip past an all-caps-only check. The runtime chrome happens to be
 * uppercase, but a future edit could introduce title-case copy in the in-app
 * room experience and read perfectly fine to a reviewer. So a SECOND, narrower
 * pass also fails on the title-case token `\bSession\b` — but only inside the
 * in-app runtime surfaces (RoomPage, BurnedOverlay, PaywallModal,
 * useRoomTeardown, and everything under pages/room/). It is deliberately NOT
 * applied repo-wide, because legitimate title-case "Session" is an established
 * crypto / docs term elsewhere ("Session encryption", "Session persistence" in
 * the docs pages, "Session keys rotated" in PeerTileGrid). Within the runtime
 * surfaces the only legitimate title-case use is PeerTileGrid's crypto
 * "Session key(s)", which is allow-listed by exact phrase below.
 *
 * Beyond the React runtime UI, the same ROOM-not-SESSION vocabulary must hold
 * in the surfaces that show up OUTSIDE the app — the social / link-preview
 * metadata and the operator-facing package manifests that the sibling
 * check-banned-phrases.mjs already scans (Task #859). So this guard also
 * covers (all-caps SESSION only — the title-case pass stays scoped to the
 * in-app runtime surfaces above):
 *   - scripts/og-routes.mjs — per-route OG title / description / headline
 *     strings rendered into Twitter/X, Slack, iMessage, WhatsApp, LinkedIn,
 *     Facebook link previews.
 *   - index.html — the head meta tags that ship for any unrouted SPA page.
 *   - manifest.yaml, umbrel-app.yml — StartOS / Umbrel package manifests.
 *   - README-selfhost.md — the canonical operator runbook.
 * A "SESSION"-in-an-OG-title (or manifest) regression now fails the
 * marketing-voice workflow too, not just the in-app `.ts(x)` chrome.
 *
 * Matching only the all-caps token `\bSESSION\b` (case-sensitive) means the
 * legitimate non-user-facing uses are excluded for free:
 *   - camelCase internal identifiers — `sessionEnded`, `handleBurnSession`,
 *     `handleSessionExpired`, `sessionStorage`, `sessionExpiredRef`.
 *   - hyphenated identifiers / test hooks — `session-ended-overlay`
 *     (`data-testid` / `id` / `aria-*`).
 *   - SCREAMING_SNAKE constants — `SESSION_STORAGE_KEY` (the `_` defeats the
 *     trailing word boundary).
 *   - prose in comments, which uses lowercase "session".
 *
 * Two legitimate all-caps uses remain and are allow-listed by exact phrase:
 *   - the crypto term of art "SESSION KEY" in KeyDerivationDiagram.
 *   - the runtime-proof page's "BROWSER SESSION" / "HASH THIS SESSION"
 *     (a browser session is a different, established meaning).
 *
 * For any other genuinely legitimate all-caps SESSION, add an inline
 * escape hatch on the same line or the line above:
 *
 *     {/* room-not-session-allow: <short reason> *␣/}
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:room-not-session
 *
 * Wired into CI as part of the `marketing-voice` validation workflow.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const SRC_DIR = resolve(CLIENT_ROOT, "src");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// Out-of-app surfaces that ship the same product vocabulary: link-preview
// metadata (og-routes / index.html head meta) and the operator-facing package
// manifests + self-host runbook. Same scan set as check-banned-phrases.mjs.
const EXTRA_FILES = [
  resolve(__dirname, "og-routes.mjs"),
  resolve(CLIENT_ROOT, "index.html"),
  resolve(REPO_ROOT, "manifest.yaml"),
  resolve(REPO_ROOT, "umbrel-app.yml"),
  resolve(REPO_ROOT, "README-selfhost.md"),
  // The repository's top-level README — its tagline and overview prose are the
  // first surface a public-repo reader sees. Kept in lockstep with the sibling
  // check-banned-phrases.mjs scan set (Task #1086).
  resolve(REPO_ROOT, "README.md"),
];

// Standalone, all-caps "SESSION". Case-sensitive on purpose — see header.
const SESSION_TOKEN = /\bSESSION\b/g;

// Standalone, title-case "Session" — the softer mixed-case wording. Only
// applied to the in-app runtime surfaces (see below). Case-sensitive: it does
// not match all-caps "SESSION" (handled above), lowercase "session" (comment
// prose, identifiers), camelCase (`sessionEnded`), or PascalCase compounds
// (`RTCSessionDescription` — no word boundary before "Session").
const SESSION_TITLE_CASE = /\bSession\b/g;

// Inline escape hatch, mirroring check-banned-phrases.mjs' allow comment.
const ALLOW_MARKER = "room-not-session-allow:";

// Exact all-caps phrases that are legitimate where they live. A match is
// permitted only when it falls inside one of these substrings for its file.
const ALLOWED_BY_FILE = new Map([
  [
    resolve(SRC_DIR, "components", "short-form", "KeyDerivationDiagram.tsx"),
    // Crypto term of art: the derived per-call encryption key. Covers
    // "SESSION KEY", "SESSION KEYS", and "SESSION KEYs".
    ["SESSION KEY"],
  ],
  [
    resolve(SRC_DIR, "pages", "RuntimeProofPage.tsx"),
    // "browser session" — a different, established meaning (the assets the
    // current browser session loaded), not the product's paid space.
    ["BROWSER SESSION", "HASH THIS SESSION"],
  ],
]);

// The in-app runtime surfaces — the live room / in-call experience. The
// title-case "Session" check (see SESSION_TITLE_CASE) runs ONLY here, so a
// softer "Session ended" / "Session expired" can't slip into room copy. Docs
// pages and marketing surfaces keep their legitimate title-case "Session"
// (crypto / SaaS term) because they are not in this set.
const RUNTIME_SURFACE_FILES = new Set([
  resolve(SRC_DIR, "pages", "RoomPage.tsx"),
  resolve(SRC_DIR, "components", "BurnedOverlay.tsx"),
  resolve(SRC_DIR, "components", "PaywallModal.tsx"),
  resolve(SRC_DIR, "hooks", "useRoomTeardown.ts"),
]);

// Whole directories whose every file is an in-call runtime surface.
const RUNTIME_SURFACE_DIRS = [resolve(SRC_DIR, "pages", "room")];

/** True when `file` is one of the in-app runtime surfaces. */
function isRuntimeSurface(file) {
  if (RUNTIME_SURFACE_FILES.has(file)) return true;
  return RUNTIME_SURFACE_DIRS.some((dir) => file.startsWith(dir + sep));
}

// Title-case phrases that are legitimate even inside a runtime surface, matched
// by exact substring (same mechanism as ALLOWED_BY_FILE).
const TITLE_CASE_ALLOWED_BY_FILE = new Map([
  [
    resolve(SRC_DIR, "pages", "room", "PeerTileGrid.tsx"),
    // Crypto term of art: the silent-rekey notice names the per-call
    // "Session key(s)" that rotated. Covers "Session key" and "Session keys".
    ["Session key"],
  ],
]);

/** Recursively collect user-facing .ts / .tsx source, excluding tests. */
function listSourceFiles(dir = SRC_DIR) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * True when the SESSION match at `index` on `line` is covered by one of the
 * file's allow-listed phrases.
 */
function isAllowedPhrase(line, index, allowedPhrases) {
  for (const phrase of allowedPhrases) {
    let from = 0;
    let at;
    while ((at = line.indexOf(phrase, from)) !== -1) {
      if (index >= at && index < at + phrase.length) return true;
      from = at + 1;
    }
  }
  return false;
}

const violations = [];

for (const file of [...listSourceFiles(), ...EXTRA_FILES]) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const allowedPhrases = ALLOWED_BY_FILE.get(file) ?? [];
  const runtimeSurface = isRuntimeSurface(file);
  const titleCaseAllowed = TITLE_CASE_ALLOWED_BY_FILE.get(file) ?? [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";
    if (line.includes(ALLOW_MARKER) || prev.includes(ALLOW_MARKER)) continue;

    SESSION_TOKEN.lastIndex = 0;
    let m;
    while ((m = SESSION_TOKEN.exec(line)) !== null) {
      if (isAllowedPhrase(line, m.index, allowedPhrases)) continue;
      violations.push({
        file,
        line: i + 1,
        excerpt: line.trim(),
      });
    }

    // Softer title-case "Session" — runtime surfaces only.
    if (!runtimeSurface) continue;
    SESSION_TITLE_CASE.lastIndex = 0;
    while ((m = SESSION_TITLE_CASE.exec(line)) !== null) {
      if (isAllowedPhrase(line, m.index, titleCaseAllowed)) continue;
      violations.push({
        file,
        line: i + 1,
        excerpt: line.trim(),
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `User-facing "SESSION" found in ${violations.length} location(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${relative(REPO_ROOT, v.file)}:${v.line}`);
    console.error(`    ${v.excerpt}`);
    console.error("");
  }
  console.error(
    "The in-app runtime UI names the paid space ROOM, the live conversation",
  );
  console.error(
    '"call", and reserves "session" for cryptographic uses only — including',
  );
  console.error(
    'softer title-case copy ("Session ended") inside the room surfaces. See',
  );
  console.error(
    "  the project's internal SESSION-vs-ROOM vocabulary notes",
  );
  console.error(
    "  artifacts/void-client/docs/aesthetic-audit.md (V1)",
  );
  console.error("");
  console.error(
    "Rename the user-facing copy to ROOM (or call). If a match is a genuine",
  );
  console.error(
    "crypto / browser-session use, add it to ALLOWED_BY_FILE in this script,",
  );
  console.error("or mark the line:");
  console.error("");
  console.error("  {/* room-not-session-allow: <short reason> */}");
  console.error("");
  process.exit(1);
}

console.log(
  "ROOM-not-SESSION check passed: no user-facing all-caps SESSION in client source, " +
    "link-preview metadata (og-routes / index.html), or operator manifests " +
    "(manifest.yaml / umbrel-app.yml / README-selfhost.md), " +
    "and no softer title-case Session in the in-app room surfaces " +
    "(crypto SESSION KEY / Session key and runtime-proof browser session allow-listed).",
);
