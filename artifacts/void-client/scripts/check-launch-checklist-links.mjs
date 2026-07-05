#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-launch-checklist-links.mjs
 *
 * Fails (exit 1) if the launch checklist (or one of its receipt docs)
 * cites the path of a launch-evidence file that does not exist on disk.
 *
 * Why this exists (Task #856). Task #855 fixed several launch-checklist
 * citations that pointed at evidence files which had been relocated
 * (`docs/` -> `attached_assets/internal-docs/`). The launch checklist and
 * its receipt docs name their evidence files as backticked, repo-relative
 * paths in prose; nothing stops a future move/rename from silently
 * breaking the evidence trail again. This guard resolves every cited
 * evidence path so the break is caught at review time, not after the fact.
 *
 * What it checks. Inside the scan sources below, every backtick span whose
 * last path segment is a known launch-evidence file AND that is written as
 * a repo-relative path (i.e. contains a `/` directory prefix, so a
 * relocation can break it) must resolve to a real file under the repo root.
 *
 * The evidence files are the dated artifacts the launch program keeps as
 * receipts: the dogfood log, the read-aloud (threat-model) log, the
 * reconcile log, the lockfile-regen drill log, and each dress-rehearsal
 * retro. (See `LAUNCH-CHECKLIST-2.md` and the launch-prep notes.)
 *
 * What it deliberately does NOT flag:
 *   - Template / placeholder paths, e.g.
 *     `attached_assets/internal-docs/launch-rehearsal-YYYY-MM-DD.md` (the
 *     A.11 dated-path template) — they are not real files yet by design.
 *   - Bare evidence filenames with no directory prefix (e.g. a prose
 *     mention of `launch-rehearsal-2026-05-03.md` with no path) — there is
 *     no prefix to break, so the relocation regression cannot apply, and
 *     resolving a bare name is ambiguous.
 *   - Non-evidence path citations (source files, future deliverable docs,
 *     etc.) — this guard is scoped to the evidence trail, not every path.
 *
 * Scan-source exclusions. The historical, point-in-time dress-rehearsal
 * narrative `launch-rehearsal-2026-05-03.md` is NOT scanned: it records the
 * state of the world on its date and intentionally cites paths that have
 * since moved (it predates the `docs/` -> `attached_assets/internal-docs/`
 * relocation). Scanning it would re-flag history.
 *
 * Environment note — THIS IS A MAINTAINER-LOCAL-ONLY GATE. The launch
 * checklist and most of the internal receipt docs live under
 * `attached_assets/` (git-ignored scratch — "must never reach the public
 * repo", see .gitignore). Git never carries git-ignored files across a task
 * merge, so the evidence tree only ever exists *complete* on a maintainer's
 * own working tree (or a long-lived Replit disk that happens to retain it).
 * It is normal — not an error — for the tree to be absent or only partially
 * present in any other environment.
 *
 * Because of that, this guard is deliberately built so a MISSING evidence
 * file can never read as red. There are two distinct ways a cited path can
 * fail to resolve, and they are treated very differently:
 *
 *   1. RELOCATION (a real regression — FAILS). The cited evidence file still
 *      exists in the tree, but at a different path than the citation names
 *      (e.g. it was moved `docs/` <-> `attached_assets/internal-docs/` and
 *      the backticked citation was not updated). We detect this by finding
 *      the same basename elsewhere under the scanned roots. This is exactly
 *      the breakage this guard was created to catch, so it exits non-zero.
 *
 *   2. ABSENCE (the git-ignored-merge trap — SKIPS, exit 0). The cited file
 *      exists nowhere in the tree. The overwhelmingly likely cause is simply
 *      that the git-ignored evidence doc never propagated into this
 *      environment (a task merge, a clean checkout, CI). Failing here would
 *      put the check permanently red on any env that lacks the scratch tree,
 *      and — critically — a task agent CANNOT fix it durably: any receipt it
 *      restores under `attached_assets/` is git-ignored and is dropped on the
 *      next merge, so the gate just goes red again. (This has bitten the same
 *      check twice.) So absent citations are reported as skipped, not failed.
 *
 * Net effect: on a maintainer's complete working tree every citation
 * resolves and the guard fully enforces (and still catches relocations);
 * anywhere the git-ignored tree is absent or incomplete it degrades to a
 * clean skip instead of a spurious red. If you are reading this because the
 * check looked "broken on main", do NOT recreate receipts under
 * `attached_assets/` — that fix cannot survive a merge. The durable place
 * for an evidence doc you actually want enforced everywhere is a TRACKED
 * path (e.g. `docs/...`), cited as such.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:launch-links
 *
 * Wired into CI as part of the `marketing-voice` validation workflow (the
 * same gate as the other repo-wide static doc checks).
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const INTERNAL_DOCS = "attached_assets/internal-docs";

// The primary scan source. If this is absent, there is nothing to check.
const PRIMARY = `${INTERNAL_DOCS}/LAUNCH-CHECKLIST-2.md`;

// Receipt docs cited alongside the checklist. The historical dress-rehearsal
// narrative (launch-rehearsal-2026-05-03.md) is deliberately omitted — see
// the header. Other launch-rehearsal-*.md retros are discovered dynamically.
const STATIC_RECEIPTS = [
  `${INTERNAL_DOCS}/dogfood-log.md`,
  `${INTERNAL_DOCS}/launch-reconcile.md`,
  `${INTERNAL_DOCS}/threat-model-readaloud.md`,
  `${INTERNAL_DOCS}/lockfile-regen-drill.md`,
];

// Scan sources to exclude even if they match a discovery glob: the
// point-in-time rehearsal narrative whose citations are frozen in history.
const SCAN_SOURCE_EXCLUDE = new Set([
  `${INTERNAL_DOCS}/launch-rehearsal-2026-05-03.md`,
]);

// A cited path's final segment must match one of these to be treated as a
// launch-evidence file. Anything else (source files, unrelated docs) is left
// alone — this guard is the evidence-trail net, not a universal link checker.
const EVIDENCE_BASENAME_PATTERNS = [
  /^dogfood-log\.md$/,
  /^launch-reconcile\.md$/,
  /^threat-model-readaloud\.md$/,
  /^lockfile-regen-drill\.md$/,
  /^launch-rehearsal-.+\.md$/,
];

// A citation is a template/placeholder (not a real file) if it carries any
// of these placeholder tokens. Excluded so they never false-positive.
const PLACEHOLDER_RE = /(YYYY|MM|DD|NNN+|X\.Y|\.\.\.|[[\]<>])/;

function rel(path) {
  return relative(REPO_ROOT, path);
}

function isEvidenceBasename(name) {
  return EVIDENCE_BASENAME_PATTERNS.some((re) => re.test(name));
}

/**
 * Discover launch-rehearsal-*.md receipts on disk so future dated retros are
 * scanned automatically, minus the frozen historical narrative.
 */
function discoverRehearsalReceipts() {
  const dir = resolve(REPO_ROOT, INTERNAL_DOCS);
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^launch-rehearsal-.+\.md$/.test(name))
    .map((name) => `${INTERNAL_DOCS}/${name}`)
    .filter((p) => !SCAN_SOURCE_EXCLUDE.has(p));
}

/**
 * Recursively collect every file basename present under `dirAbs`. Used to
 * distinguish a RELOCATION (the cited file still exists, just at a different
 * path — a real regression) from an ABSENCE (the file exists nowhere because
 * the git-ignored evidence tree did not propagate — the merge trap that must
 * never read as red). See the header for the full rationale.
 */
function collectBasenames(dirAbs) {
  const names = new Set();
  if (!existsSync(dirAbs)) return names;
  const stack = [dirAbs];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const child = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(child);
      } else {
        names.add(e.name);
      }
    }
  }
  return names;
}

/**
 * Pull every backtick span out of a doc, returning { value, line } records.
 */
function backtickCitations(text) {
  const out = [];
  const lines = text.split("\n");
  const spanRe = /`([^`]+)`/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    spanRe.lastIndex = 0;
    while ((m = spanRe.exec(lines[i])) !== null) {
      out.push({ value: m[1].trim(), line: i + 1 });
    }
  }
  return out;
}

// ─── Collect scan sources ────────────────────────────────────────────

const primaryAbs = resolve(REPO_ROOT, PRIMARY);
if (!existsSync(primaryAbs)) {
  console.log(
    `launch-checklist-links check skipped: ${PRIMARY} is not present on ` +
      "disk (git-ignored evidence tree absent). Nothing to check.",
  );
  process.exit(0);
}

const scanSources = [
  PRIMARY,
  ...STATIC_RECEIPTS,
  ...discoverRehearsalReceipts(),
]
  .filter((p, i, arr) => arr.indexOf(p) === i) // de-dupe
  .filter((p) => !SCAN_SOURCE_EXCLUDE.has(p))
  .filter((p) => existsSync(resolve(REPO_ROOT, p)));

// ─── Resolve cited evidence paths ────────────────────────────────────

// Every evidence-file basename that exists *somewhere* under the two roots
// a launch-evidence doc is ever kept in. A broken citation whose basename is
// in this set is a RELOCATION (the file moved, the citation went stale —
// fail); one whose basename is absent here is an ABSENCE (the git-ignored
// tree did not propagate into this env — skip, never red). See the header.
const presentBasenames = new Set([
  ...collectBasenames(resolve(REPO_ROOT, INTERNAL_DOCS)),
  ...collectBasenames(resolve(REPO_ROOT, "docs")),
]);

const relocations = []; // file exists elsewhere → stale citation → FAIL
const absences = []; // file exists nowhere → git-ignored merge trap → SKIP
let checked = 0;

for (const source of scanSources) {
  const text = readFileSync(resolve(REPO_ROOT, source), "utf8");
  for (const { value, line } of backtickCitations(text)) {
    // Must be a path with a directory prefix (the relocation regression
    // only applies to prefixed, repo-relative paths) ending in an
    // evidence-file basename.
    if (!value.includes("/")) continue;
    if (!isEvidenceBasename(basename(value))) continue;
    if (PLACEHOLDER_RE.test(value)) continue; // template / placeholder

    checked++;
    const targetAbs = join(REPO_ROOT, value);
    if (existsSync(targetAbs)) continue; // resolves — fine

    if (presentBasenames.has(basename(value))) {
      relocations.push({ source, line, value });
    } else {
      absences.push({ source, line, value });
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────

// Absences are NOT failures (see header): a cited file that exists nowhere is
// almost certainly a git-ignored evidence doc that did not propagate into
// this environment. Surfacing them is useful, but they must never turn the
// gate red — a task agent cannot durably fix them (the fix is itself
// git-ignored), so red here is a permanent, un-actionable false alarm.
if (absences.length > 0) {
  console.log(
    `launch-checklist-links: ${absences.length} cited evidence file(s) are ` +
      "absent from this environment (git-ignored evidence tree not fully\n" +
      "present here). Skipping them — this is expected outside a maintainer's\n" +
      "complete working tree and is never treated as a failure:",
  );
  for (const a of absences) {
    console.log(`  ${a.source}:${a.line} — \`${a.value}\` (not present anywhere)`);
  }
}

if (relocations.length > 0) {
  console.error(
    `\nlaunch-checklist-links check failed: ${relocations.length} ` +
      "RELOCATED evidence-file citation(s).\n",
  );
  for (const v of relocations) {
    console.error(`  ${v.source}:${v.line}`);
    console.error(
      `    cites \`${v.value}\` — that path has no file, but a file named ` +
        `\`${basename(v.value)}\` exists elsewhere in the tree.\n`,
    );
  }
  console.error(
    "A launch-evidence file cited in the checklist (or a receipt doc) still\n" +
      "exists but at a different path — it was moved or renamed and the\n" +
      "citation was not updated (the regression this guard was built for).\n" +
      "Update the citation to the file's new path.\n" +
      "If the path is a deliberate template, give it a placeholder token\n" +
      "(e.g. YYYY-MM-DD) so it is recognised as not-yet-real.",
  );
  process.exit(1);
}

const resolved = checked - absences.length;
console.log(
  `launch-checklist-links check passed: all ${resolved} present cited ` +
    `launch-evidence path(s) across ${scanSources.length} scanned doc(s) ` +
    `resolve on disk` +
    (absences.length > 0 ? ` (${absences.length} absent, skipped)` : "") +
    ".",
);
