#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the publish-scope inventory guard (scripts/check-publish-inventory.mjs),
// focused on the NESTED-strip enforcement this guard grew: material that lives
// INSIDE a SHIP dir (the aesthetic-audit-shots PNGs and the aesthetic-audit doc)
// and the LFS-free .gitattributes requirement. The top-level SHIP/STRIP scheme
// cannot express these, so they were previously stripped by memory/ad-hoc
// commands and enforced by nothing — this locks that closed.
//
// The tests drive SNAPSHOT MODE against synthetic candidate trees built from the
// manifest (so they can't drift from the real SHIP/NESTED_STRIP lists), asserting:
//   * a snapshot that still contains a nested-strip item FAILS (NESTED-NOT-STRIPPED),
//   * a snapshot whose .gitattributes carries an LFS rule FAILS (LFS-RULE-PRESENT),
//   * a fully-scrubbed snapshot PASSES.
//
// Exits 0 on success, 1 on the first assertion failure.
//
// Run: node scripts/check-publish-inventory.test.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SHIP,
  NESTED_STRIP,
  LARGE_FILE_THRESHOLD_BYTES,
  LARGE_FILE_ALLOWLIST,
  MIN_TRACKED_FILES,
} from "./publish-inventory-manifest.mjs";
import { fileCountFloorProblem } from "./check-publish-inventory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(__dirname, "check-publish-inventory.mjs");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    failures += 1;
  } else {
    process.stdout.write(`ok: ${msg}\n`);
  }
}

// Build a synthetic candidate publish tree that a correctly-scrubbed snapshot
// would look like: every SHIP top-level entry present (as a dir, or a file for
// .gitattributes), no STRIP entry, nothing unclassified, no nested-strip item,
// and an LFS-free .gitattributes. Options let a test reintroduce a hazard.
function buildSnapshot({
  includeNested = false,
  lfsInGitattributes = false,
  // Extra files to plant, each { path (rel to snapshot root), bytes }. Used to
  // exercise the large-file backstop with over- and under-threshold files.
  extraFiles = [],
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pub-inv-"));
  for (const entry of SHIP) {
    if (entry === ".gitattributes") continue; // written explicitly below
    mkdirSync(join(dir, entry));
  }
  writeFileSync(
    join(dir, ".gitattributes"),
    lfsInGitattributes
      ? "artifacts/void-client/docs/aesthetic-audit-shots/x.png filter=lfs diff=lfs merge=lfs -text\n"
      : "",
  );
  if (includeNested) {
    for (const entry of NESTED_STRIP) {
      const full = join(dir, entry);
      if (entry.endsWith(".md")) {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, "# internal\n");
      } else {
        mkdirSync(full, { recursive: true });
        writeFileSync(join(full, "shot.png"), "png");
      }
    }
  }
  for (const { path, bytes } of extraFiles) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.alloc(bytes, 0));
  }
  return dir;
}

// Run the checker in snapshot mode; return { ok, output } where ok reflects a
// zero exit (pass) and output is the combined stdout+stderr for message asserts.
function runSnapshot(dir) {
  try {
    const out = execFileSync("node", [CHECKER, "--snapshot", dir], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: out };
  } catch (err) {
    return {
      ok: false,
      output: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

function withSnapshot(opts, fn) {
  const dir = buildSnapshot(opts);
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- 1. A nested-strip item left in the snapshot FAILS. -------------------
withSnapshot({ includeNested: true }, (dir) => {
  const { ok, output } = runSnapshot(dir);
  assert(
    !ok,
    "snapshot with a nested-strip item present fails (non-zero exit)",
  );
  assert(
    output.includes("NESTED-NOT-STRIPPED"),
    "nested-strip failure names NESTED-NOT-STRIPPED",
  );
});

// --- 2. An LFS rule in .gitattributes FAILS. ------------------------------
withSnapshot({ lfsInGitattributes: true }, (dir) => {
  const { ok, output } = runSnapshot(dir);
  assert(!ok, "snapshot whose .gitattributes carries an LFS rule fails");
  assert(
    output.includes("LFS-RULE-PRESENT"),
    "LFS failure names LFS-RULE-PRESENT",
  );
});

// --- 3. A fully-scrubbed snapshot PASSES. ---------------------------------
withSnapshot({}, (dir) => {
  const { ok, output } = runSnapshot(dir);
  assert(ok, "a fully-scrubbed snapshot passes (zero exit)");
  assert(
    output.includes("OK (snapshot)"),
    "the passing snapshot prints the OK (snapshot) line",
  );
});

// --- 4. An over-threshold, un-allowlisted file FAILS. --------------------
withSnapshot(
  {
    extraFiles: [
      {
        path: "artifacts/void-client/public/sneaky-huge-asset.bin",
        bytes: LARGE_FILE_THRESHOLD_BYTES + 1,
      },
    ],
  },
  (dir) => {
    const { ok, output } = runSnapshot(dir);
    assert(
      !ok,
      "snapshot with an over-threshold un-allowlisted file fails (non-zero exit)",
    );
    assert(
      output.includes("LARGE-FILE-NOT-ALLOWLISTED"),
      "large-file failure names LARGE-FILE-NOT-ALLOWLISTED",
    );
    assert(
      output.includes("sneaky-huge-asset.bin"),
      "large-file failure names the offending file",
    );
  },
);

// --- 5. An allowlisted large file PASSES. --------------------------------
withSnapshot(
  {
    extraFiles: [
      {
        path: LARGE_FILE_ALLOWLIST[0],
        bytes: LARGE_FILE_THRESHOLD_BYTES + 1024,
      },
    ],
  },
  (dir) => {
    const { ok, output } = runSnapshot(dir);
    assert(
      ok,
      "a snapshot whose only over-threshold file is allowlisted passes",
    );
    assert(
      output.includes("OK (snapshot)"),
      "the allowlisted-large-file snapshot prints the OK (snapshot) line",
    );
  },
);

// --- 6. A file exactly AT the threshold PASSES (ceiling is exclusive). ----
withSnapshot(
  {
    extraFiles: [
      {
        path: "artifacts/void-client/public/right-at-the-line.bin",
        bytes: LARGE_FILE_THRESHOLD_BYTES,
      },
    ],
  },
  (dir) => {
    const { ok } = runSnapshot(dir);
    assert(ok, "a file exactly at the threshold passes (ceiling is > not >=)");
  },
);

// --- 7. Tracked-file-count FLOOR (the wipe backstop, source mode). ---------
// The floor guards against a wiped tree. The real source-mode path lists tracked
// files via `git ls-files` against the actual checkout, so a synthetic
// below-floor tree cannot be built in-process; instead we (a) unit-test the pure
// fileCountFloorProblem helper for the below/at/above cases and their message,
// and (b) run the CLI as a subprocess in source mode against the real repo to
// prove the guard fires when invoked directly and the healthy tree passes.

// 7a. Below the floor FAILS with an actionable FILE-COUNT-FLOOR message.
{
  const belowProblem = fileCountFloorProblem(MIN_TRACKED_FILES - 1);
  assert(
    belowProblem !== null,
    "a count below the floor returns a problem (not null)",
  );
  assert(
    typeof belowProblem === "string" &&
      belowProblem.includes("FILE-COUNT-FLOOR"),
    "below-floor problem names FILE-COUNT-FLOOR",
  );
  assert(
    belowProblem.includes(String(MIN_TRACKED_FILES)) &&
      belowProblem.includes(String(MIN_TRACKED_FILES - 1)),
    "below-floor problem names both the observed count and the floor",
  );
  assert(
    /git restore|git checkout/.test(belowProblem) &&
      belowProblem.includes("cp"),
    "below-floor problem tells the operator to recover via git, not cp",
  );
}

// 7b. A catastrophic wipe (single-digit count) FAILS.
assert(
  fileCountFloorProblem(3) !== null,
  "a wiped tree (3 files) is below the floor and fails",
);

// 7c. Exactly AT the floor PASSES (floor is inclusive: count >= floor is OK).
assert(
  fileCountFloorProblem(MIN_TRACKED_FILES) === null,
  "a count exactly at the floor passes (>= floor is OK)",
);

// 7d. Above the floor PASSES.
assert(
  fileCountFloorProblem(MIN_TRACKED_FILES + 500) === null,
  "a count above the floor passes",
);

// 7e. The CLI, run directly in source mode against the real repo, PASSES and
//     prints the OK (source) line — proving the invoked-directly dispatch still
//     fires (a regressed main-guard would silently no-op instead of running).
{
  let ok = false;
  let output = "";
  try {
    output = execFileSync("node", [CHECKER], {
      cwd: join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    ok = true;
  } catch (err) {
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }
  assert(ok, "source mode against the real (healthy) tree passes");
  assert(
    output.includes("OK (source)"),
    "the CLI runs when invoked directly and prints OK (source)",
  );
}

if (failures > 0) {
  process.stderr.write(`\n${failures} assertion(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("\nall check-publish-inventory tests passed\n");
  process.exit(0);
}
