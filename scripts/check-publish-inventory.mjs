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
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SHIP, STRIP } from "./publish-inventory-manifest.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ship = new Set(SHIP);
const strip = new Set(STRIP);
const classified = new Set([...ship, ...strip]);

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

// Tracked top-level entries = first path segment of every tracked file, unique.
function trackedTopLevel() {
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
  const top = new Set();
  for (const path of out.split("\0")) {
    if (!path) continue;
    const slash = path.indexOf("/");
    top.add(slash === -1 ? path : path.slice(0, slash));
  }
  return top;
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
  const tracked = trackedTopLevel();
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

  if (problems.length > 0) fail(problems);

  console.log(
    `[check-publish-inventory] OK (source) — all ${tracked.size} tracked ` +
      `top-level entr(ies) classified: ${ship.size} SHIP, ${strip.size} STRIP. ` +
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

  if (problems.length > 0) fail(problems);

  console.log(
    `[check-publish-inventory] OK (snapshot) — "${dir}" matches the manifest: ` +
      `all ${ship.size} SHIP entr(ies) present, all ${strip.size} STRIP entr(ies) ` +
      `absent, no unclassified top-level entries. (Top-level scope; run the §4 ` +
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
