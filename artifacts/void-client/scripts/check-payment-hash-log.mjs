#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-payment-hash-log.mjs
 *
 * Fails (exit 1) if any `logger.*` / `console.*` call in the api-server's
 * source includes a bare `paymentHash` field in its structured log object.
 *
 * Why this exists. The Lightning `paymentHash` is a raw 64-hex identifier
 * that ALSO appears verbatim in Lightning settlement records. Writing it to
 * an operator log lets anyone holding the log line (and a set of candidate
 * settlement hashes) correlate "this log entry is that payment". Two known
 * warn-level sites in routes/paywall.ts used to print the raw hash; they now
 * log a short, non-reversible triage digest via `digestPaymentHash`
 * (lib/paymentHashDigest.ts), surfaced under the `paymentHashDigest` field.
 *
 * A regression TEST only exercises those two specific paths. A future
 * contributor who adds a NEW `logger.info({ paymentHash }, …)` (or
 * `console.warn({ paymentHash: x }, …)`) on a DIFFERENT code path would not
 * be caught by that test. This static check is the repo-wide net — the same
 * idiom already used by check-signaling-envelope.mjs and
 * check-log-ip-room-correlation.mjs: a future contributor who logs a raw
 * `paymentHash` trips CI and is directed to `digestPaymentHash` before the
 * leak ships.
 *
 * What is flagged. A log call whose first argument is an object literal that
 * has a property whose KEY is exactly `paymentHash` — both the shorthand
 * form `{ paymentHash }` (which logs the raw value) and the explicit form
 * `{ paymentHash: <anything> }` (a misleading field name even when the value
 * is digested — use `paymentHashDigest` instead).
 *
 * What is allowed. The approved `paymentHashDigest` field (the key
 * `paymentHash` is anchored, so `paymentHashDigest:` does NOT match). Test
 * files are skipped by the directory walk. Route-template string literals
 * like the `:paymentHash` segment in `router.get("/paywall/status/:paymentHash")`
 * never appear as an object-literal KEY, so they are never flagged.
 *
 * Scope. Only the api-server is scanned — it is the only artifact that holds
 * a Lightning `paymentHash`. The browser client never sees it.
 *
 * Run via:
 *   pnpm --filter @workspace/void-client run check:payment-hash-log
 *
 * Wired into CI as its own validation workflow (`payment-hash-log`),
 * alongside the other repo-wide static checks.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

// Only the api-server holds a Lightning paymentHash.
const SCAN_ROOTS = [resolve(REPO_ROOT, "artifacts/api-server/src")];

// The structured-log field name that leaks a raw payment identifier. The
// approved digest field `paymentHashDigest` is NOT in this list, and the
// key-matching regexes below are anchored so `paymentHashDigest:` cannot
// match `paymentHash`.
const FORBIDDEN_KEYS = ["paymentHash"];

// Documented exceptions: { file, line, why }. Empty by design — there is no
// legitimate reason to log a raw paymentHash. If you believe you have one,
// add it here AND explain why the digest is insufficient.
const ALLOWLIST = [];

// ─── File walk ───────────────────────────────────────────────────────

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx") &&
      !name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

// Replace comments with whitespace (preserving newlines + length so line
// numbers stay correct), so a `// paymentHash` in prose never trips us.
function stripComments(source) {
  let out = "";
  let i = 0;
  let inString = null;
  let escaped = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) { out += "  "; i += 2; }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function lineNumberOf(source, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

// Match `logger.info(`, `console.warn(`, etc. The `(` is captured so we can
// find the first argument.
const LOG_CALL_RE =
  /\b(?:logger|console)\s*\.\s*(?:log|info|warn|error|fatal|debug|trace)\s*\(/g;

// Given the index of `(`, return the source text of the first argument IF it
// is an object literal (`{ … }`), else null. String-aware brace matcher so
// braces inside string/template values don't throw off depth.
function firstObjectArg(src, openParenIdx) {
  let i = openParenIdx + 1;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] !== "{") return null;
  const start = i;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null; // unbalanced — ignore rather than throw
}

// True if `objText` contains a property whose name is exactly one of `keys`.
// Property names are anchored to `{` / `,` / start so a longer name like
// `paymentHashDigest` does NOT match `paymentHash`. Nested object literals
// are scanned too (a key can appear after any `{` or `,`), so a paymentHash
// buried inside `{ meta: { paymentHash } }` is still caught.
function matchedKey(objText, keys) {
  for (const k of keys) {
    const bare = new RegExp(`(?:[{,]|^)\\s*${k}\\s*(?::|,|\\})`);
    const quoted = new RegExp(`(?:[{,]|^)\\s*["']${k}["']\\s*:`);
    if (bare.test(objText) || quoted.test(objText)) return k;
  }
  return null;
}

function isAllowlisted(relPath, line) {
  return ALLOWLIST.some((a) => a.file === relPath && a.line === line);
}

// ─── Scan ────────────────────────────────────────────────────────────

const violations = [];
let scanned = 0;
let logCalls = 0;

for (const root of SCAN_ROOTS) {
  for (const file of walk(root).sort()) {
    scanned++;
    const src = stripComments(readFileSync(file, "utf8"));
    let m;
    LOG_CALL_RE.lastIndex = 0;
    while ((m = LOG_CALL_RE.exec(src)) !== null) {
      logCalls++;
      const openParen = m.index + m[0].length - 1;
      const obj = firstObjectArg(src, openParen);
      if (!obj) continue;
      const key = matchedKey(obj, FORBIDDEN_KEYS);
      if (!key) continue;
      const line = lineNumberOf(src, m.index);
      const rel = relative(REPO_ROOT, file);
      if (isAllowlisted(rel, line)) continue;
      violations.push({ rel, line, key });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `payment-hash log check failed: ${violations.length} violation(s).\n`,
  );
  for (const v of violations) {
    console.error(
      `  ${v.rel}:${v.line}  logs a raw "${v.key}" field in a structured log object.`,
    );
  }
  console.error("");
  console.error("A Lightning paymentHash is a raw 64-hex identifier that also appears in");
  console.error("Lightning settlement records — writing it to an operator log lets a log");
  console.error("holder correlate the entry back to a payment. To land this you must:");
  console.error("");
  console.error("  1. Log the non-reversible triage digest instead, via");
  console.error("     digestPaymentHash(paymentHash) from lib/paymentHashDigest.ts, under");
  console.error('     the `paymentHashDigest` field — e.g.');
  console.error("       logger.warn({ paymentHashDigest: digestPaymentHash(paymentHash) }, \"…\")");
  console.error("  2. If you genuinely believe a raw paymentHash must be logged, add the");
  console.error("     {file,line} to ALLOWLIST in this script with a written justification.");
  process.exit(1);
}

console.log(
  `payment-hash log check passed: ${logCalls} log call(s) across ${scanned} ` +
    `file(s) — no structured log object carries a raw paymentHash field.`,
);
