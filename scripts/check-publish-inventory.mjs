// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publish-scope inventory guard. Two modes, one manifest
// (publish-inventory-manifest.mjs) as the single source of truth for which
// top-level entries SHIP and which get STRIPped.
//
// SOURCE MODE (default) — classification completeness against the tracked tree.
//   Run inside the git checkout. FAILS if the tree and the manifest have drifted:
//     (a) UNCLASSIFIED — a tracked top-level entry is in neither SHIP nor STRIP.
//         The fail-open this guard exists to close: a new root file/dir added by
//         someone who never updated the scrub doc would otherwise ship by default.
//     (b) STALE — a manifest entry no longer exists in the tracked tree.
//     (c) DOUBLE-CLASSIFIED — an entry appears in both SHIP and STRIP.
//   Run via: pnpm --filter @workspace/scripts run check:publish-inventory
//
// SNAPSHOT MODE (--snapshot <dir>) — verify the candidate publish tree ($PUB)
//   matches the manifest AFTER the §3 strip. Run from the repo root after step 2.
//   FAILS if:
//     (d) NOT-STRIPPED — a STRIP entry is still present in the snapshot (the §3
//         `rm` lines drifted from the manifest, or one was forgotten).
//     (e) MISSING-SHIP — a SHIP entry is absent from the snapshot (over-stripped,
//         or the archive omitted it).
//     (f) UNCLASSIFIED-IN-SNAPSHOT — a top-level entry exists in the snapshot
//         that is in neither SHIP nor STRIP.
//   This makes the manifest authoritative for the strip too, so the §3 `rm` lines
//   and the §4.2 absence checks can no longer silently diverge from it.
//   Run via: node scripts/check-publish-inventory.mjs --snapshot "$PUB"
//
// SCOPE: top-level only by design. Internal files inside a SHIP dir are handled
// by the §3 strip list and the §4 content scans (gitleaks / hygiene / cross-link
// grep), not here. See docs/pre-publish-scrub-2026-06.md.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHIP,
  STRIP,
  NESTED_STRIP,
  LARGE_FILE_THRESHOLD_BYTES,
  LARGE_FILE_ALLOWLIST,
} from "./publish-inventory-manifest.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ship = new Set(SHIP);
const strip = new Set(STRIP);
const classified = new Set([...ship, ...strip]);
const largeAllow = new Set(LARGE_FILE_ALLOWLIST);

// Human-readable byte size for the failure message (e.g. "1.2 MiB").
function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// Every regular file under `root`, returned as a path RELATIVE to `root` using
// forward slashes (so it matches the manifest allowlist regardless of platform).
function walkFilesRelative(root) {
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — nothing to weigh here
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  }
  return out;
}

// A .gitattributes line configures Git LFS if it carries the lfs filter driver.
// The public snapshot must ship an LFS-free .gitattributes (the baseline shipped
// it emptied): a lingering LFS pointer rule references blobs that never exist in
// the fresh-history snapshot.
const LFS_RULE = /\bfilter=lfs\b/;

// Problems that are pure manifest config errors, checked in both modes.
function manifestConfigProblems() {
  const problems = [];
  for (const name of ship) {
    if (strip.has(name)) {
      problems.push(`DOUBLE-CLASSIFIED: "${name}" is in both SHIP and STRIP.`);
    }
  }
  return problems;
}

// Every tracked path (relative to REPO_ROOT), one per entry.
function trackedPaths() {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    fail([
      `could not run "git ls-files" in ${REPO_ROOT}. Source mode must run ` +
        `inside the git checkout it classifies (for the snapshot tree, use ` +
        `--snapshot <dir>).\n  ${err.message}`,
    ]);
  }
  return out.split("\0").filter(Boolean);
}

// Tracked top-level entries = first path segment of every tracked file, unique.
function trackedTopLevel(paths) {
  const top = new Set();
  for (const path of paths) {
    const slash = path.indexOf("/");
    top.add(slash === -1 ? path : path.slice(0, slash));
  }
  return top;
}

// A nested-strip entry is "present" in the tracked tree if it is either a tracked
// file itself (exact match) or a directory prefix of at least one tracked file.
function nestedPresentInTracked(entry, paths) {
  const prefix = `${entry}/`;
  return paths.some((p) => p === entry || p.startsWith(prefix));
}

// Top-level entries actually present on disk in a directory (incl. dotfiles).
function snapshotTopLevel(dir) {
  try {
    return new Set(readdirSync(dir));
  } catch (err) {
    fail([
      `could not read snapshot directory "${dir}". Build it first with ` +
        `git archive (see §3), then run this from the repo root.\n  ${err.message}`,
    ]);
  }
}

function fail(problems) {
  console.error(
    `[check-publish-inventory] FAILED — ${problems.length} problem(s):\n`,
  );
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\nThe pre-publish scrub is a denylist (archive-then-strip); this guard is ` +
      `the fail-closed backstop that keeps every top-level entry explicitly ` +
      `SHIP or STRIP and the snapshot honest to the manifest. See ` +
      `docs/pre-publish-scrub-2026-06.md.`,
  );
  process.exit(1);
}

function runSourceMode() {
  const paths = trackedPaths();
  const tracked = trackedTopLevel(paths);
  const problems = manifestConfigProblems();

  // (a) Every tracked top-level entry must be classified (fail-open closer).
  for (const name of [...tracked].sort()) {
    if (!classified.has(name)) {
      problems.push(
        `UNCLASSIFIED: tracked top-level entry "${name}" is in neither SHIP ` +
          `nor STRIP. Classify it in scripts/publish-inventory-manifest.mjs ` +
          `(and the §2 table) before publishing — do not let it ship by omission.`,
      );
    }
  }

  // (b) Every manifest entry must still exist in the tree (no stale entry).
  for (const name of [...classified].sort()) {
    if (!tracked.has(name)) {
      problems.push(
        `STALE: manifest entry "${name}" is no longer a tracked top-level ` +
          `entry. Remove it from scripts/publish-inventory-manifest.mjs.`,
      );
    }
  }

  // (c) Every NESTED_STRIP entry must still exist in the tracked tree, else the
  //     list has rotted: a listed path was renamed/removed and now protects
  //     nothing. Mirrors (b) for the nested tier.
  for (const entry of [...NESTED_STRIP].sort()) {
    if (!nestedPresentInTracked(entry, paths)) {
      problems.push(
        `STALE-NESTED-STRIP: nested-strip entry "${entry}" no longer exists in ` +
          `the tracked tree. Update NESTED_STRIP in ` +
          `scripts/publish-inventory-manifest.mjs (and the §3 nested rm list) so ` +
          `the strip list cannot rot silently.`,
      );
    }
  }

  // (d) Every LARGE_FILE_ALLOWLIST entry must still be a tracked file, else the
  //     allowlist has rotted: a listed asset was renamed/removed and its entry
  //     now excuses nothing. Mirrors (b)/(c) for the large-file backstop tier.
  const trackedFiles = new Set(paths);
  for (const entry of [...LARGE_FILE_ALLOWLIST].sort()) {
    if (!trackedFiles.has(entry)) {
      problems.push(
        `STALE-LARGE-FILE-ALLOWLIST: allowlisted large file "${entry}" is no ` +
          `longer a tracked file. Remove it from LARGE_FILE_ALLOWLIST in ` +
          `scripts/publish-inventory-manifest.mjs so the allowlist cannot rot ` +
          `silently.`,
      );
    }
  }

  if (problems.length > 0) fail(problems);

  console.log(
    `[check-publish-inventory] OK (source) — all ${tracked.size} tracked ` +
      `top-level entr(ies) classified: ${ship.size} SHIP, ${strip.size} STRIP; ` +
      `${NESTED_STRIP.length} nested-strip entr(ies) still present in the tree; ` +
      `${LARGE_FILE_ALLOWLIST.length} large-file allowlist entr(ies) still tracked. ` +
      `(Top-level scope; internal files inside SHIP dirs are covered by the §3 ` +
      `strip list and §4 content scans.)`,
  );
}

function runSnapshotMode(dir) {
  const present = snapshotTopLevel(dir);
  const problems = manifestConfigProblems();

  // (d) No STRIP entry may survive in the snapshot.
  for (const name of [...strip].sort()) {
    if (present.has(name)) {
      problems.push(
        `NOT-STRIPPED: "${name}" is classified STRIP but is still present in ` +
          `"${dir}". The §3 strip step did not remove it (or the §3 rm lines ` +
          `drifted from the manifest).`,
      );
    }
  }

  // (e) Every SHIP entry must be present in the snapshot.
  for (const name of [...ship].sort()) {
    if (!present.has(name)) {
      problems.push(
        `MISSING-SHIP: "${name}" is classified SHIP but is absent from ` +
          `"${dir}". It was over-stripped or never archived.`,
      );
    }
  }

  // (f) No unclassified entry may exist in the snapshot.
  for (const name of [...present].sort()) {
    if (!classified.has(name)) {
      problems.push(
        `UNCLASSIFIED-IN-SNAPSHOT: "${name}" exists in "${dir}" but is in ` +
          `neither SHIP nor STRIP. Classify it in the manifest before publishing.`,
      );
    }
  }

  // (g) No NESTED_STRIP entry may survive inside the snapshot. The top-level
  //     checks above can't see these (they live under a SHIP dir), so an
  //     un-stripped 354 MB of internal PNGs would otherwise sail through.
  for (const entry of [...NESTED_STRIP].sort()) {
    if (existsSync(join(dir, entry))) {
      problems.push(
        `NESTED-NOT-STRIPPED: "${entry}" is a nested-strip entry but is still ` +
          `present in "${dir}". Add its \`rm\` to the §3 nested strip list — it ` +
          `must not reach the public snapshot.`,
      );
    }
  }

  // (h) The shipped .gitattributes must carry no Git LFS rule. The baseline
  //     ships it emptied; a lingering `filter=lfs` rule points at LFS blobs that
  //     don't exist in the fresh-history snapshot.
  const gaPath = join(dir, ".gitattributes");
  if (existsSync(gaPath)) {
    const ga = readFileSync(gaPath, "utf8");
    const lfsLines = ga
      .split(/\r?\n/)
      .filter((line) => LFS_RULE.test(line))
      .map((line) => line.trim());
    if (lfsLines.length > 0) {
      problems.push(
        `LFS-RULE-PRESENT: "${gaPath}" contains ${lfsLines.length} Git LFS ` +
          `rule(s) (${lfsLines.join(" | ")}). The public snapshot must carry no ` +
          `LFS configuration — empty .gitattributes (the baseline shipped it empty).`,
      );
    }
  }

  // (i) BACKSTOP: no file anywhere in the snapshot may exceed the size ceiling
  //     unless it is on the reviewed large-file allowlist. NESTED_STRIP only
  //     catches the internal bloat someone already named; this catches the big
  //     file nobody thought to name — the same fail-open, one level down.
  for (const rel of walkFilesRelative(dir).sort()) {
    let size;
    try {
      size = statSync(join(dir, rel)).size;
    } catch {
      continue;
    }
    if (size > LARGE_FILE_THRESHOLD_BYTES && !largeAllow.has(rel)) {
      problems.push(
        `LARGE-FILE-NOT-ALLOWLISTED: "${rel}" is ${fmtBytes(size)}, over the ` +
          `${fmtBytes(LARGE_FILE_THRESHOLD_BYTES)} publish size ceiling and not ` +
          `on LARGE_FILE_ALLOWLIST in scripts/publish-inventory-manifest.mjs. ` +
          `If it legitimately ships, add it there (a reviewed decision); if it ` +
          `is internal, strip it (NESTED_STRIP + the §3 rm list).`,
      );
    }
  }

  if (problems.length > 0) fail(problems);

  console.log(
    `[check-publish-inventory] OK (snapshot) — "${dir}" matches the manifest: ` +
      `all ${ship.size} SHIP entr(ies) present, all ${strip.size} STRIP entr(ies) ` +
      `absent, no unclassified top-level entries; all ${NESTED_STRIP.length} ` +
      `nested-strip entr(ies) absent, .gitattributes carries no LFS rule, and no ` +
      `file over the ${fmtBytes(LARGE_FILE_THRESHOLD_BYTES)} ceiling is unlisted ` +
      `(${LARGE_FILE_ALLOWLIST.length} allowlisted). (Top-level scope; run the §4 ` +
      `content scans for inside-dir material.)`,
  );
}

const args = process.argv.slice(2);
const snapIdx = args.indexOf("--snapshot");
if (snapIdx !== -1) {
  const dir = args[snapIdx + 1];
  if (!dir || dir.startsWith("--")) {
    fail([`--snapshot requires a directory argument, e.g. --snapshot "$PUB".`]);
  }
  runSnapshotMode(dir);
} else {
  runSourceMode();
}
