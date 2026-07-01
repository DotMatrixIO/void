#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-log-ip-room-correlation.mjs
 *
 * Fails (exit 1) if any `logger.*` / `console.*` call in the signaling
 * server's source co-locates a **client-IP field** and a **room-ID
 * field** in the SAME structured log object.
 *
 * Why this exists. VOID's signaling server sees client IPs (HTTP access
 * lines, socket connect/disconnect lifecycle) and room codes. Logging
 * either alone is operational telemetry; logging BOTH in one line is a
 * **correlation** — it reconstructs "this IP was in that room", which is
 * the de-anonymization risk the product promises not to create. Today no
 * log line does this (the access log scrubs the room code out of the URL
 * on the success path — see access-log-scrub.test.ts — and the socket
 * lifecycle line carries no room code). This check promotes that implicit
 * property to a STRUCTURAL one, the same way check-signaling-envelope.mjs
 * pins "the WebSocket carries no user content": a future contributor who
 * writes `logger.info({ ip, code }, …)` trips CI and must confront the
 * correlation before it ships.
 *
 * Scope. Only the signaling SERVER is scanned. The browser client
 * trivially knows its own IP; an IP<->room pair in a *client* log is not
 * the threat — the threat is the instance operator's server-side logs.
 *
 * Complement, not replacement. This is a static, structured-field scan.
 * The transient case where a raw request URL embeds a room code is
 * covered at runtime by access-log-scrub.test.ts (the 2xx scrub). The two
 * together cover the space: this guard stops a new structured correlation
 * from being introduced; the runtime test stops the URL scrub from being
 * removed.
 *
 * Run via:
 *   pnpm --filter @workspace/void-client run check:log-ip-room-correlation
 *
 * Wired into CI as part of the `marketing-voice` validation workflow,
 * alongside the other repo-wide static checks.
 *
 * Reconciles with: docs/log-correlation-audit.md.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

// Only the signaling server logs client IPs against room state.
const SCAN_ROOTS = [resolve(REPO_ROOT, "artifacts/api-server/src")];

// Structured-log field names that carry a client IP in this codebase.
const IP_KEYS = ["ip", "clientIp", "clientIP", "remoteAddress", "forwardedFor"];
// Structured-log field names that carry (or could carry) a room identifier.
// `code` is the canonical room-code field name server-side (ROOM_CODE_RE,
// /api/room-state/:code). It is included deliberately: an error `code`
// logged ALONGSIDE a client IP is exactly the kind of accidental
// correlation worth a human look.
const ROOM_KEYS = ["code", "roomCode", "roomId", "room"];

// Documented exceptions: { file, line, why }. Empty by design — there is
// no legitimate reason to correlate an IP with a room ID in a log line.
// If you believe you have one, add it here AND a row in
// docs/log-correlation-audit.md explaining the payload and retention.
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
// numbers stay correct), so an `// ip: code` in prose never trips us.
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

// Match `logger.info(`, `console.warn(`, etc. The `(` is captured so we
// can find the first argument.
const LOG_CALL_RE =
  /\b(?:logger|console)\s*\.\s*(?:log|info|warn|error|fatal|debug|trace)\s*\(/g;

// Given the index of `(`, return the source text of the first argument
// IF it is an object literal (`{ … }`), else null. String-aware brace
// matcher so braces inside string/template values don't throw off depth.
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

// True if `objText` contains a property whose name is one of `keys`.
// Property names are anchored to `{` / `,` / start so substrings like
// `tooltip` (for `ip`) or `statusCode` (for `code`) don't match.
function matchedKey(objText, keys) {
  for (const k of keys) {
    const bare = new RegExp(`(?:[{,]|^)\\s*${k}\\s*(?::|,|\\})`);
    const quoted = new RegExp(`(?:[{,]|^)\\s*["']${k}["']\\s*:`);
    if (bare.test(objText) || quoted.test(objText)) return k;
  }
  return null;
}

// Return the source text of `key`'s value within `objText`, or null when
// the property is shorthand (`{ ip }`) — i.e. it has no explicit value.
// String-aware + nesting-aware so the value boundary (next top-level comma
// or the object's closing brace) is found correctly.
function valueOf(objText, key) {
  const re = new RegExp(`(?:[{,]|^)\\s*(?:["']${key}["']|${key})\\s*:`);
  const m = re.exec(objText);
  if (!m) return null; // shorthand or no explicit value
  let i = m.index + m[0].length;
  while (i < objText.length && /\s/.test(objText[i])) i++;
  const start = i;
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (; i < objText.length; i++) {
    const ch = objText[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) break;
  }
  return objText.slice(start, i).trim();
}

// A property "carries a real (dynamic) value" unless its value is a PLAIN
// string literal with no interpolation. The canonical safe pattern is the
// scrub sentinel `room: "<room-id>"` (Task #374): a constant literal cannot
// carry a per-request room id, so it is not a correlation. Shorthand
// (`{ ip }`, value === null) is a variable reference, i.e. dynamic → real.
function carriesDynamicValue(objText, key) {
  const v = valueOf(objText, key);
  if (v === null) return true; // shorthand → variable reference
  const q = v[0];
  if (q !== '"' && q !== "'" && q !== "`") return true; // not a string literal
  if (v[v.length - 1] !== q) return true; // not a single closed literal
  if (q === "`" && /\$\{/.test(v)) return true; // interpolated template
  return false; // plain, constant string literal → not a real room id / IP
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
      const ipKey = matchedKey(obj, IP_KEYS);
      const roomKey = matchedKey(obj, ROOM_KEYS);
      if (!ipKey || !roomKey) continue;
      // Only a correlation if BOTH fields carry a real (dynamic) value. A
      // plain string-literal value — the `room: "<room-id>"` scrub sentinel
      // — is the correct, non-correlating pattern and must pass.
      if (!carriesDynamicValue(obj, ipKey) || !carriesDynamicValue(obj, roomKey)) {
        continue;
      }
      const line = lineNumberOf(src, m.index);
      const rel = relative(REPO_ROOT, file);
      if (isAllowlisted(rel, line)) continue;
      violations.push({ rel, line, ipKey, roomKey });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `log IP<->room correlation check failed: ${violations.length} violation(s).\n`,
  );
  for (const v of violations) {
    console.error(
      `  ${v.rel}:${v.line}  logs both "${v.ipKey}" (client IP) and ` +
        `"${v.roomKey}" (room ID) in one structured log object.`,
    );
  }
  console.error("");
  console.error("A single log line that carries a client IP AND a room ID correlates");
  console.error('"this IP was in that room" — the de-anonymization the product promises');
  console.error("not to create. To land this you must either:");
  console.error("");
  console.error("  1. Remove the IP or the room ID from that log object (log them on");
  console.error("     separate lines if you genuinely need both for triage), OR");
  console.error("  2. If there is a real, reviewed need, add the {file,line} to ALLOWLIST");
  console.error("     in this script AND a row to docs/log-correlation-audit.md describing");
  console.error("     the payload, why it is necessary, and its retention.");
  process.exit(1);
}

console.log(
  `log IP<->room correlation check passed: ${logCalls} log call(s) across ` +
    `${scanned} file(s) — no structured log object carries a client IP and a ` +
    `room ID together.`,
);
