#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sync-fragments.mjs
 *
 * Registry-driven splicer. For every entry in fragments.config.mjs,
 * rewrites the block between sentinel HTML comments inside the entry's
 * overview file with the canonical bytes of the corresponding
 * docs/_fragments/*.md. One fragment file. Two surfaces (overview + the
 * pages that import it via Vite `?raw`). No paraphrase drift.
 *
 * Sentinels (intentionally HTML comments — invisible when rendered):
 *
 *   <!-- BEGIN GENERATED: <id> (from <fragment>) -->
 *   <!-- END GENERATED: <id> -->
 *
 * Invoked from the void-client build script. Idempotent: a no-op when
 * every spliced block already matches its fragment byte-for-byte.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAGMENTS, beginSentinel, endSentinel } from "./fragments.config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

let exitCode = 0;
const overviewCache = new Map();

function readOverview(path) {
  if (!overviewCache.has(path)) {
    overviewCache.set(path, readFileSync(path, "utf8"));
  }
  return overviewCache.get(path);
}

for (const entry of FRAGMENTS) {
  const fragmentPath = resolve(REPO_ROOT, entry.fragment);
  const overviewPath = resolve(REPO_ROOT, entry.overview);
  const BEGIN = beginSentinel(entry);
  const END = endSentinel(entry);

  const fragment = readFileSync(fragmentPath, "utf8").replace(/\s+$/, "");
  const overview = readOverview(overviewPath);

  const beginIdx = overview.indexOf(BEGIN);
  const endIdx = overview.indexOf(END);

  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.error(
      `sync-fragments[${entry.id}]: sentinels not found in ${relative(REPO_ROOT, overviewPath)}.\n` +
        `  Add:\n    ${BEGIN}\n    ${END}\n` +
        `  around the canonical block for this fragment.`,
    );
    exitCode = 1;
    continue;
  }

  const before = overview.slice(0, beginIdx + BEGIN.length);
  const after = overview.slice(endIdx);
  const next = `${before}\n${fragment}\n${after}`;

  if (next === overview) {
    console.log(
      `sync-fragments[${entry.id}]: ${relative(REPO_ROOT, overviewPath)} already in sync.`,
    );
    continue;
  }

  overviewCache.set(overviewPath, next);
  console.log(
    `sync-fragments[${entry.id}]: rewrote block in ${relative(REPO_ROOT, overviewPath)} from ${relative(REPO_ROOT, fragmentPath)}.`,
  );
}

for (const [path, content] of overviewCache) {
  if (readFileSync(path, "utf8") !== content) {
    writeFileSync(path, content);
  }
}

process.exit(exitCode);
