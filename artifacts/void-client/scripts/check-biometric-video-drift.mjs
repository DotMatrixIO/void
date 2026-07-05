#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-biometric-video-drift.mjs
 *
 * Fails (exit 1) when any biometric-demo-video scene source file has changed
 * against a base git ref but the exported MP4 in `public/` was NOT
 * regenerated.
 *
 * Background:
 *   The biometric demo MP4 (`public/biometric-demo.mp4`) is a Playwright +
 *   FFmpeg export of the `artifacts/biometric-demo-video` React animation.
 *   If a contributor edits a scene component (Scene1.tsx … Scene6.tsx,
 *   VideoTemplate.tsx, etc.) without re-running the record pipeline, the
 *   shipped video silently drifts from the corrected source — exactly the
 *   overlap-bug failure mode this check is designed to catch.
 *
 * What this check does:
 *   1. Collects every `.ts` / `.tsx` file under
 *      `artifacts/biometric-demo-video/src/` as well as the record script
 *      (`scripts/record-biometric.mjs`) into a "watched sources" set.
 *   2. Determines a base git ref (env `BASE_REF`, falling back to `HEAD~1`).
 *   3. Asks git which paths changed between BASE_REF and HEAD (plus any
 *      staged/unstaged working-tree changes so local runs catch drift too).
 *   4. If ANY watched source changed but the MP4 (and poster JPEG) in
 *      `public/` did not, the check fails with instructions to re-export.
 *
 * Failure modes:
 *   - Not inside a git working tree → skip (exit 0), or fail when CI=true.
 *   - BASE_REF cannot be resolved (e.g. shallow clone with no HEAD~1)
 *     → skip (exit 0), or fail when CI=true.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:biometric-video-drift
 *
 * Wired into CI in `.replit` as the `biometric-video-drift` validation
 * workflow, part of the Project parallel run.
 *
 * To regenerate the MP4 after a scene change:
 *
 *     # Start the biometric-demo-video workflow first, then:
 *     node artifacts/biometric-demo-video/scripts/record-biometric.mjs
 *     cp /tmp/biometric-demo.mp4 artifacts/void-client/public/biometric-demo.mp4
 *     ffmpeg -y -i /tmp/biometric-demo-poster.jpg -q:v 8 /tmp/poster-final.jpg
 *     cp /tmp/poster-final.jpg artifacts/void-client/public/biometric-demo-poster.jpg
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const VIDEO_SRC_DIR = resolve(REPO_ROOT, "artifacts", "biometric-demo-video", "src");
const RECORD_SCRIPT = resolve(
  REPO_ROOT,
  "artifacts",
  "biometric-demo-video",
  "scripts",
  "record-biometric.mjs",
);

const ARTIFACT_FILES = [
  resolve(CLIENT_ROOT, "public", "biometric-demo.mp4"),
  resolve(CLIENT_ROOT, "public", "biometric-demo-poster.jpg"),
];

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function repoRel(absPath) {
  return relative(REPO_ROOT, absPath).split("\\").join("/");
}

function tryGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function collectSourceFiles(dir) {
  const result = [];
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectSourceFiles(full));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      const ext = dot >= 0 ? entry.name.slice(dot) : "";
      if (TS_EXTS.has(ext)) {
        result.push(full);
      }
    }
  }
  return result;
}

function buildWatchedSet() {
  const watched = new Set(collectSourceFiles(VIDEO_SRC_DIR));
  if (existsSync(RECORD_SCRIPT)) watched.add(RECORD_SCRIPT);
  return watched;
}

function changedFilesAgainst(baseRef) {
  let raw = tryGit(["diff", "--name-only", `${baseRef}...HEAD`]);
  if (raw === null) {
    raw = tryGit(["diff", "--name-only", baseRef, "HEAD"]);
  }
  if (raw === null) return null;
  const wt = tryGit(["diff", "--name-only", "HEAD"]) ?? "";
  const staged = tryGit(["diff", "--name-only", "--cached"]) ?? "";
  return new Set(
    [raw, wt, staged]
      .join("\n")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function skip(reason) {
  if (process.env.CI === "true") {
    // In CI, skip conditions are likely environment bugs — fail loudly so
    // the check cannot be silently bypassed by a broken ref or shallow clone.
    console.error(`biometric-video drift check FAILED in CI: ${reason}`);
    console.error(
      "Set BASE_REF to a resolvable git ref, or ensure the checkout is not shallow.",
    );
    process.exit(1);
  }
  console.log(`biometric-video drift check skipped: ${reason}`);
  process.exit(0);
}

/**
 * Determine the best merge-base ref to compare against.
 *
 * Priority:
 *   1. $BASE_REF env var (explicitly set by CI/caller).
 *   2. `git merge-base HEAD origin/main` — covers full branch delta vs remote.
 *   3. `git merge-base HEAD origin/master` — same for repos using master.
 *   4. `git merge-base HEAD main` — local branch (no remote fetch required).
 *   5. `git merge-base HEAD master` — same for master.
 *   6. HEAD~1 — single-commit fallback for local runs.
 *
 * In CI (`CI=true`), we refuse HEAD~1 as a fallback — it only covers the last
 * commit and would silently pass a branch where a scene changed two commits ago.
 */
function resolveBaseRef() {
  if (process.env.BASE_REF) {
    const ref = process.env.BASE_REF.trim();
    if (tryGit(["rev-parse", "--verify", ref]) !== null) return ref;
    console.error(`BASE_REF=${JSON.stringify(ref)} could not be resolved.`);
    return null;
  }

  // Try merge-base candidates in priority order.
  const candidates = [
    ["merge-base", "HEAD", "origin/main"],
    ["merge-base", "HEAD", "origin/master"],
    ["merge-base", "HEAD", "main"],
    ["merge-base", "HEAD", "master"],
  ];
  for (const args of candidates) {
    const sha = tryGit(args);
    if (sha) {
      console.log(`[drift] merge-base resolved via: git ${args.join(" ")} → ${sha.slice(0, 12)}`);
      return sha;
    }
  }

  // In CI refuse HEAD~1 — it only covers the last commit and will miss earlier
  // scene changes on multi-commit branches.
  if (process.env.CI === "true") {
    return null;
  }

  // Local fallback: HEAD~1 is fine for single-commit local checks.
  const prev = tryGit(["rev-parse", "--verify", "HEAD~1"]);
  if (prev) {
    console.log("[drift] falling back to HEAD~1 for local run.");
    return "HEAD~1";
  }

  return null;
}

function main() {
  if (tryGit(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    skip("not inside a git working tree");
  }

  const baseRef = resolveBaseRef();
  if (!baseRef) {
    skip(
      "could not determine a merge-base ref. " +
        "Set BASE_REF=<sha> to the target-branch tip or common ancestor, " +
        "or ensure origin/main (or origin/master) is fetched.",
    );
  }

  const changed = changedFilesAgainst(baseRef);
  if (changed === null) {
    skip(`git diff against ${baseRef} failed`);
  }

  const watched = buildWatchedSet();
  const watchedRel = new Set([...watched].map(repoRel));
  const artifactRel = ARTIFACT_FILES.map(repoRel);

  const changedSources = [...changed].filter((p) => watchedRel.has(p));
  const changedArtifacts = artifactRel.filter((p) => changed.has(p));

  if (changedSources.length === 0) {
    console.log(
      `biometric-video drift check passed: no watched source changed since ${baseRef} ` +
        `(watched ${watchedRel.size} file(s)).`,
    );
    process.exit(0);
  }

  if (changedArtifacts.length === ARTIFACT_FILES.length) {
    console.log(
      `biometric-video drift check passed: ${changedSources.length} source(s) changed ` +
        `since ${baseRef}, and the MP4 + poster were both regenerated.`,
    );
    process.exit(0);
  }

  console.error("Biometric demo MP4 is out of sync with the scene source.\n");
  console.error(`Base ref:        ${baseRef}`);
  console.error(
    `Watched sources: ${watchedRel.size} file(s) ` +
      `(artifacts/biometric-demo-video/src/**/*.ts(x) + record-biometric.mjs)`,
  );
  console.error("");
  console.error("Source files that changed but the video was not re-exported:");
  for (const p of changedSources) console.error(`  - ${p}`);
  console.error("");
  console.error(
    "Expected BOTH the MP4 and the poster JPEG to also change in the same commit range:",
  );
  for (const p of artifactRel) {
    const tag = changed.has(p) ? "changed" : "UNCHANGED";
    console.error(`  - ${p}  [${tag}]`);
  }
  console.error("");
  console.error(
    "The biometric demo MP4 is a Playwright + FFmpeg export of the scene React components.",
  );
  console.error(
    "Any scene edit must be followed by a re-export and commit of the new MP4 + poster.",
  );
  console.error("");
  console.error("To regenerate:");
  console.error("");
  console.error(
    "  1. Start the biometric-demo-video workflow (port 22687) and wait for it to load.",
  );
  console.error(
    "  2. Run the record script from the workspace root:",
  );
  console.error(
    "       node artifacts/biometric-demo-video/scripts/record-biometric.mjs",
  );
  console.error("  3. Copy outputs into void-client/public/:");
  console.error(
    "       cp /tmp/biometric-demo.mp4 artifacts/void-client/public/biometric-demo.mp4",
  );
  console.error(
    "       ffmpeg -y -i /tmp/biometric-demo-poster.jpg -q:v 8 /tmp/poster-final.jpg",
  );
  console.error(
    "       cp /tmp/poster-final.jpg artifacts/void-client/public/biometric-demo-poster.jpg",
  );
  console.error(
    "  4. Commit both files alongside the scene change.",
  );
  console.error("");
  console.error(
    "Set BASE_REF=<sha> to override the comparison base (default: HEAD~1).",
  );
  process.exit(1);
}

main();
