#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-banned-phrases.mjs
 *
 * Fails (exit 1) if any banned marketing phrase appears in user-facing or
 * operator-facing copy:
 *   - artifacts/void-client/src/pages/*.tsx (excluding *.test.tsx)
 *   - artifacts/void-client/scripts/og-routes.mjs (per-route OG metadata —
 *     the `title` / `description` / `headline` strings that show up in
 *     Twitter/X, Slack, iMessage, WhatsApp, LinkedIn, Facebook link previews)
 *   - artifacts/void-client/index.html (the head meta tags that ship for
 *     any unrouted SPA page that falls through to index.html)
 *   - manifest.yaml, umbrel-app.yml (StartOS / Umbrel package manifests —
 *     description, releaseNotes, alerts, and interface comments that ship
 *     to operators via the package store), and README-selfhost.md (the
 *     canonical operator runbook). Audit ledgers under docs/ are
 *     intentionally out of scope: they exist to record wording shifts
 *     and would otherwise need allow markers on every quoted phrase.
 *     Added by Task #238.
 *
 * The canonical phrase list lives in scripts/banned-phrases.mjs. Run via:
 *
 *     pnpm --filter @workspace/void-client run check:phrases
 *
 * Wired into CI as the `marketing-voice` validation workflow in .replit.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BANNED_PHRASES, scanContent } from "./banned-phrases.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const PAGES_DIR = resolve(CLIENT_ROOT, "src", "pages");
const OG_ROUTES_FILE = resolve(__dirname, "og-routes.mjs");
const INDEX_HTML_FILE = resolve(CLIENT_ROOT, "index.html");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const MANIFEST_FILE = resolve(REPO_ROOT, "manifest.yaml");
const UMBREL_FILE = resolve(REPO_ROOT, "umbrel-app.yml");
const README_SELFHOST_FILE = resolve(REPO_ROOT, "README-selfhost.md");

// Recursively collect every .tsx page (excluding *.test.tsx) under PAGES_DIR.
// The scan used to be a flat, non-recursive readdirSync, which silently
// skipped subdirectories like src/pages/docs/ — the long-form docs pages
// (DocsThreatModelPage, DocsHowItWorksPage, DocsPricingPage, …) carry by far
// the most Tor-related prose in the product and are exactly where a
// media-over-Tor / "Tor-routed" positioning claim is most likely to drift in
// unnoticed. Recursing also covers src/pages/room/ for free (Task #819).
export function listPageFiles(dir = PAGES_DIR) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listPageFiles(full));
    } else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(full);
    }
  }
  return files.sort();
}

function main() {
  const files = [
    ...listPageFiles(),
    OG_ROUTES_FILE,
    INDEX_HTML_FILE,
    MANIFEST_FILE,
    UMBREL_FILE,
    README_SELFHOST_FILE,
  ];
  const allViolations = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const v of scanContent(content)) {
      allViolations.push({ file, ...v });
    }
  }

  if (allViolations.length > 0) {
    console.error(
      `Banned marketing phrases detected in ${allViolations.length} location(s):\n`,
    );
    for (const v of allViolations) {
      const rel = relative(REPO_ROOT, v.file);
      console.error(`  ${rel}:${v.line}  [${v.phrase}]`);
      console.error(`    ${v.excerpt}`);
    }
    console.error("");
    console.error("Banned list (see scripts/banned-phrases.mjs):");
    for (const { label } of BANNED_PHRASES) {
      console.error(`  - ${label}`);
    }
    console.error("");
    console.error(
      "If a match is a legitimate technical use, add a comment on the same",
    );
    console.error("line or the line above:");
    console.error("");
    console.error("  {/* banned-phrase-allow: <short reason> */}");
    console.error("");
    process.exit(1);
  }

  console.log(
    `Banned-phrase check passed: ${files.length} file(s) scanned, ` +
      `${BANNED_PHRASES.length} phrase(s) checked.`,
  );
}

// Only run the scan when invoked directly (pnpm check:phrases / CI), not when
// imported by a test that wants to exercise listPageFiles() in isolation.
if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
