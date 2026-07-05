#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-sw-known-hashes.mjs
 *
 * Post-build sibling to add-sri.mjs / add-modulepreload-sri.mjs (task #489 /
 * H-02). Emits `dist/public/sw-known-hashes.json` — a path -> sha384-base64
 * table covering every file under `dist/public/assets/`, the deterministic
 * Vite output bucket whose contents are the same bytes add-sri.mjs hashes
 * into the entry HTML and add-modulepreload-sri.mjs hashes into the
 * modulepreload tags.
 *
 * Why this file exists:
 *   The service worker (`public/sw.js`) caches asset bytes on first fetch
 *   (stale-while-revalidate). Without a SW-side hash table, a one-time bad
 *   fetch (flaky CDN, partial corruption that beat the initial-load SRI
 *   race) could pin into the cache for the lifetime of the browser
 *   profile. The SW now re-verifies every cached-asset serve against this
 *   table; on mismatch it evicts, refetches, and re-verifies; if the
 *   fresh fetch also mismatches, it surfaces the same integrity-failure
 *   overlay (`index.html:61-125`) the install-time SRI failure uses. The
 *   table is the SW's cryptographic baseline.
 *
 * Why .json and not .js:
 *   Audit-readable (operator can `cat` it and spot-check a hash against
 *   add-sri.mjs's stamped tags). Loaded at install time by `sw.js` via a
 *   plain `fetch('./sw-known-hashes.json')`.
 *
 * Why pathname keys, not URL keys:
 *   The SW intercepts requests as fully-qualified URLs; the lookup uses
 *   the URL pathname so the table is independent of host, scheme, and
 *   port. The BASE_PATH prefix is included in the key so the lookup
 *   matches what the browser actually requests.
 *
 * Pipeline order (extends add-modulepreload-sri.mjs's header):
 *   vite build                 — emits assets + manifest
 *   gen-og-rewrites.mjs        — updates artifact.toml route rewrites
 *   gen-og-pages.mjs           — duplicates index.html into per-route HTMLs
 *   add-sri.mjs                — hashes existing <script>/<link> tags
 *   add-modulepreload-sri.mjs  — injects modulepreload SRI tags
 *   gen-sw-known-hashes.mjs    — THIS SCRIPT; emits SW hash table
 *
 * Failure mode:
 *   If `dist/public/assets/` does not exist, this script exits non-zero —
 *   a silent skip would ship a SW with an empty table, silently downgrading
 *   the defense to the pre-task-489 stale-while-revalidate behaviour
 *   without anyone noticing.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "dist", "public");
const assetsDir = resolve(distDir, "assets");
const outPath = resolve(distDir, "sw-known-hashes.json");

const basePath = (process.env.BASE_PATH || process.env.BASE_URL || "/").replace(
  /\/+$/,
  "",
);

function listAssetFiles(dir) {
  const out = [];
  const entries = readdirSync(dir);
  for (const name of entries) {
    const abs = resolve(dir, name);
    const s = statSync(abs);
    if (s.isDirectory()) {
      for (const nested of listAssetFiles(abs)) out.push(nested);
    } else if (s.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

let assetFiles;
try {
  assetFiles = listAssetFiles(assetsDir);
} catch (err) {
  console.error(
    `[gen-sw-known-hashes] Could not enumerate ${assetsDir}: ${err.message}\n` +
      `Refusing to ship a SW with an empty integrity table. ` +
      `Did vite build run before this script?`,
  );
  process.exit(1);
}

const table = {};
for (const abs of assetFiles.sort()) {
  const bytes = readFileSync(abs);
  const digest = createHash("sha384").update(bytes).digest("base64");
  const relFromDist = abs.slice(distDir.length).replace(/\\/g, "/");
  const key = `${basePath}${relFromDist}`;
  table[key] = `sha384-${digest}`;
}

writeFileSync(outPath, JSON.stringify(table, null, 2) + "\n", "utf8");

console.log(
  `[gen-sw-known-hashes] Wrote ${Object.keys(table).length} entry/entries ` +
    `(base="${basePath || "/"}") to ${outPath.slice(distDir.length + 1)}.`,
);
