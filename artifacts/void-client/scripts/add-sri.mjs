#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * add-sri.mjs
 *
 * Post-build step: adds Subresource Integrity (SRI) attributes to every
 * <script> and <link rel="stylesheet" | "modulepreload"> tag in every HTML
 * file under dist/public/, based on the SHA-384 of the referenced asset's
 * built bytes.
 *
 * Why a small post-build script and not a Vite plugin:
 *   The hashing logic is ~50 lines of Node's built-in `crypto`. A
 *   third-party plugin would add a supply-chain dependency to a
 *   security-critical build step. Auditability of in-tree code beats a
 *   black-box plugin for this scope. See task-243 step 1.
 *
 * What this script does:
 *   1. Scan dist/public/ for *.html files (the entry index.html plus the
 *      per-route social-card files emitted by gen-og-pages.mjs — they
 *      share byte-identical script/link tags).
 *   2. For every <script ... src="..."> and <link rel="stylesheet" ...
 *      href="..."> and <link rel="modulepreload" ... href="..."> whose
 *      target is a same-origin built asset under /assets/ (i.e. emitted
 *      by Vite into dist/public/assets/), compute SHA-384 of the file on
 *      disk and inject `integrity="sha384-<base64>"` plus
 *      `crossorigin="anonymous"`.
 *   3. Tags whose target is not a built asset under /assets/ (favicons,
 *      OG images, splash screens, the AudioWorklet/QrScanner public files
 *      that aren't part of the Vite graph) are left untouched. SRI only
 *      applies to <script>, <link rel="stylesheet">, and
 *      <link rel="modulepreload"> tags by browser spec, and we only have
 *      a stable hash baseline for the deterministically-named built
 *      assets in /assets/.
 *
 * What this script does NOT do:
 *   - It does not emit <link rel="modulepreload" integrity="..."> tags
 *     for code-split chunks that Vite did not already preload. Vite's
 *     default modulePreload polyfill is enabled and emits integrity
 *     attributes for tags it inserts at runtime; dynamic import()'d
 *     chunks fetched without a corresponding modulepreload tag are NOT
 *     subject to SRI in most browsers. This gap is documented in
 *     docs/security-audit-public-2026-04.md §11 limitation 10.
 *   - It does not touch third-party scripts (we don't load any).
 *   - It does not provide a user-facing diagnostic on SRI failure — see
 *     task-243 "Failure mode" for the explicit decision (option b).
 *
 * Failure mode:
 *   If the script cannot resolve a referenced asset to a real file under
 *   dist/public/ (e.g. the HTML references /assets/foo.js but no such
 *   file exists), it exits non-zero. Silent skips would ship an HTML
 *   tag with no integrity attribute that the operator believes is
 *   covered.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, "..", "dist", "public");

const basePath = (process.env.BASE_PATH || process.env.BASE_URL || "/").replace(
  /\/+$/,
  "",
);

function listHtmlFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .map((name) => resolve(dir, name))
    .filter((p) => statSync(p).isFile())
    .sort();
}

const sriCache = new Map();

function sriFor(absPath) {
  const cached = sriCache.get(absPath);
  if (cached) return cached;
  const bytes = readFileSync(absPath);
  const digest = createHash("sha384").update(bytes).digest("base64");
  const value = `sha384-${digest}`;
  sriCache.set(absPath, value);
  return value;
}

/**
 * Resolve a tag's src/href URL (as seen in the emitted HTML) to an absolute
 * filesystem path under dist/public/, or return null if it isn't a built
 * asset we should hash.
 *
 * Vite emits asset references as `<base>/assets/<name>-<hash>.<ext>`, where
 * <base> matches the BASE_PATH the build was run with. We accept any
 * reference that lands under /assets/ relative to dist/public/ regardless
 * of base prefix — the file-on-disk lookup is the source of truth.
 */
function resolveAssetPath(url) {
  if (!url) return null;
  if (/^[a-z]+:\/\//i.test(url)) return null;
  if (url.startsWith("data:")) return null;

  let path = url;
  if (basePath && path.startsWith(basePath + "/")) {
    path = path.slice(basePath.length);
  }
  if (!path.startsWith("/assets/")) return null;

  const onDisk = resolve(distDir, path.replace(/^\/+/, ""));
  const rel = posix.relative(distDir.split(/\\/).join("/"), onDisk.split(/\\/).join("/"));
  if (rel.startsWith("..")) return null;

  try {
    if (!statSync(onDisk).isFile()) return null;
  } catch {
    throw new Error(
      `[add-sri] Tag references "${url}" but no file exists at ${onDisk}. ` +
        `Refusing to ship an HTML with a missing or unhashable asset reference.`,
    );
  }
  return onDisk;
}

/**
 * Apply SRI to a single tag's attribute string.
 *
 * Strategy:
 *   - Strip any existing integrity="..." (so reruns are idempotent).
 *   - Ensure crossorigin="anonymous" is present (Vite emits a bare
 *     `crossorigin` keyword which the HTML spec treats as equivalent to
 *     "anonymous" for fetch-mode purposes; we normalise to the explicit
 *     attribute value to make SRI's crossorigin requirement obvious to a
 *     human auditor reading the file).
 *   - Insert the new integrity attribute.
 */
function withIntegrityAttrs(attrString, integrity) {
  let out = attrString;
  out = out.replace(/\s+integrity=("[^"]*"|'[^']*')/g, "");
  out = out.replace(/\s+crossorigin(=("[^"]*"|'[^']*'))?/g, "");
  out = out.trimEnd();
  return ` integrity="${integrity}" crossorigin="anonymous"${out ? " " + out.replace(/^\s+/, "") : ""}`;
}

let touchedTags = 0;

function transformHtml(html, fileLabel) {
  let out = html;

  // <script ... src="..."> with optional self-close. We require a src
  // attribute — inline scripts have no asset to hash and are out of scope.
  out = out.replace(
    /<script\b([^>]*?)\bsrc=("([^"]+)"|'([^']+)')([^>]*)>/gi,
    (match, before, _full, dq, sq, after) => {
      const url = dq ?? sq;
      const onDisk = resolveAssetPath(url);
      if (!onDisk) return match;
      const integrity = sriFor(onDisk);
      const attrs = withIntegrityAttrs(`${before} ${after}`, integrity);
      touchedTags += 1;
      return `<script${attrs} src="${url}">`;
    },
  );

  // <link ... rel="stylesheet" | "modulepreload" ... href="...">
  out = out.replace(
    /<link\b([^>]*)>/gi,
    (match, attrs) => {
      const relMatch = attrs.match(/\brel=("([^"]+)"|'([^']+)')/i);
      if (!relMatch) return match;
      const relValue = (relMatch[2] ?? relMatch[3] ?? "").toLowerCase();
      if (relValue !== "stylesheet" && relValue !== "modulepreload") {
        return match;
      }
      const hrefMatch = attrs.match(/\bhref=("([^"]+)"|'([^']+)')/i);
      if (!hrefMatch) return match;
      const url = hrefMatch[2] ?? hrefMatch[3];
      const onDisk = resolveAssetPath(url);
      if (!onDisk) return match;
      const integrity = sriFor(onDisk);

      let cleaned = attrs;
      cleaned = cleaned.replace(/\s+integrity=("[^"]*"|'[^']*')/g, "");
      cleaned = cleaned.replace(/\s+crossorigin(=("[^"]*"|'[^']*'))?/g, "");
      cleaned = cleaned.trimEnd();
      touchedTags += 1;
      return `<link${cleaned} integrity="${integrity}" crossorigin="anonymous">`;
    },
  );

  return out;
}

const htmlFiles = listHtmlFiles(distDir);
if (htmlFiles.length === 0) {
  console.error(
    `[add-sri] No HTML files found under ${distDir}. ` +
      `Did you run \`vite build\` (and gen-og-pages.mjs) first?`,
  );
  process.exit(1);
}

let totalChanged = 0;
for (const file of htmlFiles) {
  const before = readFileSync(file, "utf8");
  const after = transformHtml(before, file);
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    totalChanged += 1;
  }
}

console.log(
  `[add-sri] Added/refreshed SRI on ${touchedTags} tag(s) across ${htmlFiles.length} HTML file(s); ${totalChanged} file(s) modified.`,
);
