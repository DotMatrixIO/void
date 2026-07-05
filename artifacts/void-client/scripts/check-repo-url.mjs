#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-repo-url.mjs
 *
 * Production-build guard for the public source-code URL.
 *
 * `src/lib/repo.ts` exports REPO_URL, which the shared PageFooter renders
 * as the SOURCE / SELF-HOST link. Until the public repo is published
 * (launch checklist §0.1) REPO_URL is the sentinel "[[TO BE ADDED]]" and
 * PageFooter hides the source line entirely. That hidden-line state is a
 * legitimate PRE-LAUNCH workaround — but it is NOT acceptable in
 * production: AGPLv3 §13 requires a running service offered over a network
 * to offer its Corresponding Source. A production build that hides the
 * source link is non-compliant.
 *
 * This script converts "remember to fill in REPO_URL before launch" into a
 * structural constraint: in strict mode it FAILS the build while REPO_URL
 * is still the placeholder (or empty). Dev/staging builds may keep the
 * placeholder.
 *
 * Strict mode mirrors gen-og-pages.mjs: it is on whenever NODE_ENV is
 * "production" (the Docker frontend stage sets this) or REPO_URL_STRICT=1
 * is set explicitly. Outside strict mode the script warns and exits 0.
 *
 * Wired in as the first step of the void-client `build` script, so the
 * production Docker build (NODE_ENV=production) fails closed.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const REPO_TS = resolve(CLIENT_ROOT, "src", "lib", "repo.ts");

const STRICT =
  process.env.NODE_ENV === "production" || process.env.REPO_URL_STRICT === "1";

function extractConst(source, name) {
  // Allow an optional TypeScript type annotation between the name and `=`
  // (e.g. `export const REPO_URL: string = ...`). The RHS is either a
  // double-quoted string literal or a bare identifier (a reference to
  // another const such as REPO_URL_PLACEHOLDER).
  const re = new RegExp(
    `export const ${name}\\s*(?::[^=]+)?=\\s*("([^"]*)"|([A-Za-z_]\\w*))`,
  );
  const m = source.match(re);
  if (!m) return null;
  return { quoted: m[2] ?? null, ident: m[3] ?? null };
}

const source = readFileSync(REPO_TS, "utf8");
const placeholder = extractConst(source, "REPO_URL_PLACEHOLDER");
const repoUrl = extractConst(source, "REPO_URL");

if (!placeholder || placeholder.quoted === null) {
  console.error(
    `[check-repo-url] FATAL: could not find the string literal REPO_URL_PLACEHOLDER in ${relative(REPO_ROOT, REPO_TS)}. ` +
      "This guard depends on it as the single source of truth for the placeholder value.",
  );
  process.exit(1);
}
if (!repoUrl) {
  console.error(
    `[check-repo-url] FATAL: could not find the REPO_URL export in ${relative(REPO_ROOT, REPO_TS)}.`,
  );
  process.exit(1);
}

const placeholderValue = placeholder.quoted;
// REPO_URL is the placeholder when it is literally the sentinel string, an
// empty string, or assigned by reference from REPO_URL_PLACEHOLDER.
const isPlaceholder =
  repoUrl.ident === "REPO_URL_PLACEHOLDER" ||
  repoUrl.quoted === placeholderValue ||
  (repoUrl.quoted !== null && repoUrl.quoted.trim().length === 0);

if (!isPlaceholder) {
  console.log(
    `[check-repo-url] OK — REPO_URL is set to a real URL (${relative(REPO_ROOT, REPO_TS)}).`,
  );
  process.exit(0);
}

if (STRICT) {
  console.error(
    `[check-repo-url] FATAL: strict mode is on (NODE_ENV=production or REPO_URL_STRICT=1) but REPO_URL is still the placeholder "${placeholderValue}" in ${relative(REPO_ROOT, REPO_TS)}. ` +
      "The PageFooter SOURCE / SELF-HOST link is hidden while REPO_URL is the placeholder, but AGPLv3 §13 requires a running production service to offer its Corresponding Source. " +
      "Publish the public source repository (launch checklist §0.1) and set REPO_URL to its repo-root URL before building for production.",
  );
  process.exit(1);
}

console.warn(
  `[check-repo-url] REPO_URL is still the placeholder "${placeholderValue}". The footer source line is hidden. ` +
    "This is fine for dev/staging; a production build (NODE_ENV=production) will fail until REPO_URL is set.",
);
process.exit(0);
