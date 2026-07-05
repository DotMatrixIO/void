#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-feature-policy-sync.mjs
 *
 * Fails (exit 1) if the canonical Feature Policy at the repo root has drifted
 * from the public copy that the marketing site serves as a static asset.
 *
 *   canonical: VOID-Feature-Policy.md
 *   public:    artifacts/void-client/public/VOID-Feature-Policy.md
 *
 * Task #288 made the policy linkable from /why and the footer by copying it
 * into the void-client `public/` directory so Vite would ship it. Because it
 * is a copy (not a symlink or build-time step), the two files can silently
 * diverge whenever the canonical doc is edited but the copy isn't refreshed.
 * This check catches that drift in CI before stale copy reaches visitors.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:feature-policy-sync
 *
 * Wired into CI as part of the `marketing-voice` validation workflow in
 * .replit (alongside check:phrases).
 */

import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const CANONICAL = resolve(REPO_ROOT, "VOID-Feature-Policy.md");
const PUBLIC_COPY = resolve(CLIENT_ROOT, "public", "VOID-Feature-Policy.md");

function readOrDie(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`Could not read ${relative(REPO_ROOT, path)}: ${err.message}`);
    process.exit(1);
  }
}

const canonical = readOrDie(CANONICAL);
const publicCopy = readOrDie(PUBLIC_COPY);

if (canonical === publicCopy) {
  console.log(
    "Feature-policy sync check passed: " +
      `${relative(REPO_ROOT, CANONICAL)} matches ` +
      `${relative(REPO_ROOT, PUBLIC_COPY)}.`,
  );
  process.exit(0);
}

const canonicalLines = canonical.split("\n");
const publicLines = publicCopy.split("\n");

console.error("Feature Policy drift detected.\n");
console.error(`  canonical: ${relative(REPO_ROOT, CANONICAL)} (${canonicalLines.length} lines, ${canonical.length} bytes)`);
console.error(`  public:    ${relative(REPO_ROOT, PUBLIC_COPY)} (${publicLines.length} lines, ${publicCopy.length} bytes)`);
console.error("");

const maxLines = Math.max(canonicalLines.length, publicLines.length);
let firstDiffLine = -1;
for (let i = 0; i < maxLines; i++) {
  if (canonicalLines[i] !== publicLines[i]) {
    firstDiffLine = i + 1;
    break;
  }
}
if (firstDiffLine > 0) {
  console.error(`First differing line: ${firstDiffLine}`);
  console.error(`  canonical: ${JSON.stringify(canonicalLines[firstDiffLine - 1] ?? "<EOF>")}`);
  console.error(`  public:    ${JSON.stringify(publicLines[firstDiffLine - 1] ?? "<EOF>")}`);
  console.error("");
}

console.error("The marketing site (/why and the footer) links to the public copy,");
console.error("so visitors would read a stale manifesto until this is fixed.");
console.error("");
console.error("To resolve, refresh the public copy from the canonical doc:");
console.error("");
console.error("  cp VOID-Feature-Policy.md artifacts/void-client/public/VOID-Feature-Policy.md");
console.error("");

process.exit(1);
