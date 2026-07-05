#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-still-poster.mjs
 *
 * Fails (exit 1) when the source code that drives the social OG JPEG has
 * changed against a base git ref but the captured JPEG in `public/og/` was
 * NOT regenerated.
 *
 * The social card under `public/og/` is not hand-drawn art — it is a
 * screenshot of the live `RoomPage` UI captured by
 * `scripts/gen-still-poster.mjs` (Task #161). If a contributor edits
 * `RoomPage.tsx` or `StillPoster.tsx` (or one of their direct local
 * dependencies) without re-running `pnpm gen:still-poster`, the JPEG on the
 * landing page silently drifts out of sync with the running app — exactly
 * the failure mode the regen script was built to prevent.
 *
 * The landing-page hero variant was retired in Task #588 (swapped to a
 * hand-chosen self-portrait), so only the social card is watched here.
 *
 * What this check does:
 *   1. Statically parses the import graph one level deep from
 *      SocialPoster.tsx and RoomPage.tsx, resolving any `@/...` or relative
 *      imports to local `.ts` / `.tsx` files. That set, plus the two entry
 *      files themselves, forms the "watched sources". The thin route
 *      wrapper `StillPoster.tsx` is deliberately not watched, so route-only
 *      edits (e.g. retiring a variant) do not require JPEG regen.
 *   2. Determines a base git ref (env `BASE_REF`, falling back to `HEAD~1`).
 *   3. Asks git which paths changed between BASE_REF and HEAD.
 *   4. If ANY watched source changed but the social JPEG did not, the check
 *      fails with a pointer to `pnpm gen:still-poster`.
 *
 * Failure modes handled gracefully (skip with a notice, exit 0):
 *   - Not inside a git working tree.
 *   - BASE_REF cannot be resolved (e.g. shallow clone with no HEAD~1).
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:still-poster
 *
 * Wired into CI in `.replit` as a validation workflow alongside the other
 * void-client drift checks.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");
const SRC_ROOT = resolve(CLIENT_ROOT, "src");

// Watch the dedicated social-rendering module (and RoomPage, which it
// embeds) — NOT the `/still/:variant` route wrapper in
// `StillPoster.tsx`. Adding or removing route variants in that wrapper
// does not change the captured frame, so it should not force the
// social JPEG to be regenerated.
const ENTRY_FILES = [
  resolve(SRC_ROOT, "pages", "SocialPoster.tsx"),
  resolve(SRC_ROOT, "pages", "RoomPage.tsx"),
];

// Only the social OG card is still a screenshot of the live RoomPage.
// The landing-page hero was swapped to a hand-chosen self-portrait in
// Task #588, so the `hero` variant was retired from this drift check
// (and from `gen-still-poster.mjs` VARIANTS).
const JPEG_FILES = [
  resolve(CLIENT_ROOT, "public", "og", "this-room-will-not-exist-social.jpg"),
];

const TS_EXTS = [".ts", ".tsx", ".js", ".jsx"];

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

function resolveImport(spec, fromFile) {
  // Only follow local imports — bare specifiers (react, wouter, etc.) live in
  // node_modules and cannot drift from the captured screenshot.
  let basePath;
  if (spec.startsWith("@/")) {
    basePath = resolve(SRC_ROOT, spec.slice(2));
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    basePath = resolve(dirname(fromFile), spec);
  } else {
    return null;
  }

  // Direct hit (rare — TS imports usually omit the extension).
  if (existsSync(basePath)) {
    const stat = (() => {
      try { return readFileSync(basePath); } catch { return null; }
    })();
    if (stat !== null) return basePath;
  }

  for (const ext of TS_EXTS) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of TS_EXTS) {
    const candidate = resolve(basePath, "index" + ext);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function collectDirectImports(file) {
  const src = readFileSync(file, "utf8");
  // Match `import ... from "spec"` / `import "spec"` / `export ... from "spec"`.
  // Single line is enough — TS import statements end at the closing quote.
  const re = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  const found = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    const spec = m[1] || m[2];
    if (!spec) continue;
    const resolved = resolveImport(spec, file);
    if (resolved) found.add(resolved);
  }
  return found;
}

function buildWatchedSet() {
  const watched = new Set(ENTRY_FILES);
  for (const entry of ENTRY_FILES) {
    for (const dep of collectDirectImports(entry)) {
      watched.add(dep);
    }
  }
  return watched;
}

function changedFilesAgainst(baseRef) {
  // `git diff --name-only A...HEAD` reports paths changed on HEAD's side
  // since the merge base with A. Falls back to a plain diff if the
  // three-dot form is rejected (e.g. when A == HEAD).
  let raw = tryGit(["diff", "--name-only", `${baseRef}...HEAD`]);
  if (raw === null) {
    raw = tryGit(["diff", "--name-only", baseRef, "HEAD"]);
  }
  if (raw === null) return null;
  // Also include unstaged + staged working-tree changes so a contributor
  // running this locally catches drift before they even commit.
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
  console.log(`still-poster drift check skipped: ${reason}`);
  process.exit(0);
}

function main() {
  if (tryGit(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    skip("not inside a git working tree");
  }

  const baseRef = process.env.BASE_REF || "HEAD~1";
  if (tryGit(["rev-parse", "--verify", baseRef]) === null) {
    skip(`base ref ${JSON.stringify(baseRef)} could not be resolved (set BASE_REF to override)`);
  }

  const changed = changedFilesAgainst(baseRef);
  if (changed === null) {
    skip(`git diff against ${baseRef} failed`);
  }

  const watched = buildWatchedSet();
  const watchedRel = new Set([...watched].map(repoRel));
  const jpegRel = JPEG_FILES.map(repoRel);

  const changedSources = [...changed].filter((p) => watchedRel.has(p));
  const changedJpegs = jpegRel.filter((p) => changed.has(p));

  if (changedSources.length === 0) {
    console.log(
      `still-poster drift check passed: no watched source changed since ${baseRef} ` +
        `(watched ${watchedRel.size} file(s)).`,
    );
    process.exit(0);
  }

  if (changedJpegs.length === JPEG_FILES.length) {
    console.log(
      `still-poster drift check passed: ${changedSources.length} watched source(s) ` +
        `changed since ${baseRef}, and the social OG JPEG was regenerated.`,
    );
    process.exit(0);
  }

  console.error("Social OG JPEG is out of sync with the room UI source.\n");
  console.error(`Base ref:        ${baseRef}`);
  console.error(`Watched sources: ${watchedRel.size} file(s) (SocialPoster.tsx, RoomPage.tsx + direct local deps)`);
  console.error("");
  console.error("Source files that changed but were not re-captured:");
  for (const p of changedSources) console.error(`  - ${p}`);
  console.error("");
  console.error("Expected the social OG JPEG to also change in the same commit range:");
  for (const p of jpegRel) {
    const tag = changed.has(p) ? "changed" : "UNCHANGED";
    console.error(`  - ${p}  [${tag}]`);
  }
  console.error("");
  console.error("This JPEG is a screenshot of the live RoomPage UI (Task #161).");
  console.error("If RoomPage / StillPoster (or their direct deps) change, the capture");
  console.error("must be refreshed or the social card will drift from the running app.");
  console.error("");
  console.error("To fix, regenerate it from the live UI and commit the result:");
  console.error("");
  console.error("  pnpm --filter @workspace/void-client run gen:still-poster");
  console.error("  git add artifacts/void-client/public/og/this-room-will-not-exist-social.jpg");
  console.error("");
  console.error("If a source change is intentionally cosmetic-only and does not affect");
  console.error("the captured frame, re-run the script anyway — it is deterministic and");
  console.error("will be a no-op diff if nothing visible moved.");
  process.exit(1);
}

main();
