#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * add-modulepreload-sri.mjs
 *
 * Post-build step: closes the SRI coverage gap on dynamic-import chunks
 * (task #258).
 *
 * Background — what add-sri.mjs covers and what it doesn't:
 *   add-sri.mjs hashes the entry <script src> and entry <link rel="stylesheet">
 *   that Vite already emits into the static index.html. It also hashes any
 *   <link rel="modulepreload"> tags that happen to be there. But Vite only
 *   emits modulepreload tags for first-level dynamic imports above a certain
 *   bundle-size heuristic — at this app's current size it emits none for
 *   lazy chunks like `QrScannerModal` and its transitive worker chunk. The
 *   browser fetches those chunks at runtime via dynamic import() with no
 *   modulepreload tag, so there is no integrity baseline. A fully-origin-
 *   compromised attacker who can rewrite the bundles can silently substitute
 *   a tampered lazy chunk and the entry script's SRI does not catch it.
 *
 * What this script does:
 *   1. Read Vite's build manifest at dist/public/.vite/manifest.json.
 *   2. Walk the dynamic-import closure starting from every entry chunk:
 *        - From each entry's `dynamicImports`, recurse over both `imports`
 *          and `dynamicImports` of every reached chunk. The result is the
 *          set of chunks reachable from any entry via dynamic import — the
 *          ones that are NOT loaded by the entry's <script> tag itself.
 *   3. For every chunk in that closure, compute SHA-384 of its on-disk
 *      bytes and inject a tag of the form:
 *        <link rel="modulepreload" href="…" integrity="sha384-…"
 *              crossorigin="anonymous">
 *      into every HTML under dist/public/.
 *   4. Idempotent: a previous insertion (delimited by a marker comment) is
 *      stripped before re-injection, so reruns produce stable output.
 *
 * Why a separate script and not an extension of add-sri.mjs:
 *   add-sri.mjs has a single, narrow responsibility: hash existing tags.
 *   This script's responsibility is different: synthesise new tags from the
 *   build manifest. Keeping them apart keeps each one auditable in
 *   isolation. Both scripts are ~50 lines of in-tree Node — no plugin
 *   dependency for either.
 *
 * Pipeline order:
 *   vite build            — emits assets and the manifest
 *   gen-og-rewrites.mjs   — updates artifact.toml route rewrites
 *   gen-og-pages.mjs      — duplicates index.html into per-route HTMLs
 *   add-sri.mjs           — hashes existing <script>/<link> asset tags
 *   add-modulepreload-sri.mjs — THIS SCRIPT; injects modulepreload tags
 *                               for dynamic-import closure chunks into
 *                               every HTML
 *
 * Browser-engine support note:
 *   SRI on <link rel="modulepreload"> is required by current spec but
 *   enforcement varies by engine. Chromium-based browsers reliably enforce
 *   it. Safari and older Firefox enforcement is inconsistent. For Chromium
 *   users, lazy-chunk tampering after this change requires also tampering
 *   the entry HTML to omit or alter the integrity tag — a much louder
 *   operation that the CSP report-uri endpoint (Task #252) would catch.
 *   For non-Chromium users the residual risk is lower than before but not
 *   eliminated. See docs/security-audit-public-2026-04.md §11
 *   limitation 10 for the full discussion.
 *
 * Failure mode:
 *   If the manifest cannot be read, or any chunk in the closure has no
 *   on-disk file, the script exits non-zero. A silent skip would emit a
 *   modulepreload tag with no integrity (or omit a tag the operator
 *   thought was covered).
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "dist", "public");
const manifestPath = resolve(distDir, ".vite", "manifest.json");

const basePath = (process.env.BASE_PATH || process.env.BASE_URL || "/").replace(
  /\/+$/,
  "",
);

const BEGIN_MARKER = "<!-- modulepreload-sri:begin (task #258) -->";
const END_MARKER = "<!-- modulepreload-sri:end -->";

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (err) {
  console.error(
    `[add-modulepreload-sri] Could not read Vite manifest at ${manifestPath}: ${err.message}\n` +
      `Did vite build run with build.manifest=true?`,
  );
  process.exit(1);
}

/**
 * Compute the transitive closure of chunks reachable from any entry via
 * dynamic import. The entry chunk itself is excluded — it is loaded by the
 * entry <script> tag whose SRI is already covered by add-sri.mjs.
 *
 * Walk:
 *   - Seed the worklist with the dynamicImports of every entry.
 *   - For each chunk pulled off the worklist, also enqueue its `imports`
 *     and `dynamicImports`. Static imports of a dynamically-loaded chunk
 *     are themselves loaded on demand and need their own modulepreload.
 */
function computeDynamicClosure(manifest) {
  const closure = new Set();
  const stack = [];
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry.isEntry) continue;
    for (const dep of entry.dynamicImports ?? []) stack.push(dep);
  }
  while (stack.length > 0) {
    const key = stack.pop();
    if (closure.has(key)) continue;
    const entry = manifest[key];
    if (!entry) {
      throw new Error(
        `[add-modulepreload-sri] Manifest references chunk "${key}" but no entry exists. Manifest is corrupt.`,
      );
    }
    closure.add(key);
    for (const dep of entry.imports ?? []) {
      if (!manifest[dep]?.isEntry) stack.push(dep);
    }
    for (const dep of entry.dynamicImports ?? []) stack.push(dep);
  }
  return closure;
}

const closureKeys = computeDynamicClosure(manifest);

// Resolve each closure entry to its built filename and SHA-384 integrity.
// Sort for deterministic output (modulepreload order does not matter
// semantically but stable bytes matter for reproducibility — task #248).
const preloadEntries = [];
for (const key of closureKeys) {
  const file = manifest[key].file;
  const onDisk = resolve(distDir, file);
  let bytes;
  try {
    bytes = readFileSync(onDisk);
  } catch (err) {
    console.error(
      `[add-modulepreload-sri] Manifest claims chunk ${key} -> ${file} but no file exists at ${onDisk}: ${err.message}\n` +
        `Refusing to ship modulepreload tags that reference missing assets.`,
    );
    process.exit(1);
  }
  const integrity = "sha384-" + createHash("sha384").update(bytes).digest("base64");
  // The href is base-prefixed so it matches what the browser would request
  // at runtime under the configured Vite base. add-sri.mjs's resolver also
  // strips this prefix when looking up the on-disk file, so the two scripts
  // agree on URL shape.
  preloadEntries.push({
    key,
    href: `${basePath}/${file}`,
    integrity,
  });
}

preloadEntries.sort((a, b) => (a.href < b.href ? -1 : a.href > b.href ? 1 : 0));

const block =
  preloadEntries.length === 0
    ? ""
    : "\n  " +
      BEGIN_MARKER +
      "\n" +
      preloadEntries
        .map(
          (e) =>
            `  <link rel="modulepreload" href="${e.href}" integrity="${e.integrity}" crossorigin="anonymous">`,
        )
        .join("\n") +
      "\n  " +
      END_MARKER +
      "\n";

function listHtmlFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => resolve(dir, name))
    .filter((p) => statSync(p).isFile())
    .sort();
}

// Strip any prior insertion (idempotency) then inject before </head>.
const stripRe = new RegExp(
  `\\s*${escapeRe(BEGIN_MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}\\s*`,
  "g",
);

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const htmlFiles = listHtmlFiles(distDir);
if (htmlFiles.length === 0) {
  console.error(
    `[add-modulepreload-sri] No HTML files under ${distDir}. ` +
      `Did vite build / gen-og-pages.mjs run?`,
  );
  process.exit(1);
}

let modified = 0;
for (const file of htmlFiles) {
  const before = readFileSync(file, "utf8");
  let next = before.replace(stripRe, "\n");
  if (block) {
    if (!/<\/head>/i.test(next)) {
      console.error(
        `[add-modulepreload-sri] ${file}: no </head> tag found. ` +
          `Cannot inject modulepreload tags into a malformed HTML.`,
      );
      process.exit(1);
    }
    next = next.replace(/<\/head>/i, `${block}</head>`);
  }
  if (next !== before) {
    writeFileSync(file, next, "utf8");
    modified += 1;
  }
}

console.log(
  `[add-modulepreload-sri] Injected ${preloadEntries.length} modulepreload tag(s) ` +
    `(${[...closureKeys].join(", ") || "<none>"}) into ${htmlFiles.length} HTML file(s); ` +
    `${modified} file(s) modified.`,
);
