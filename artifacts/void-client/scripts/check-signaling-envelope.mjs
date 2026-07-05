#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-signaling-envelope.mjs
 *
 * Fails (exit 1) if any of the following appear anywhere under the
 * scanned roots with a string-literal name not in the whitelists below:
 *
 *   - `.emit("…"` callsites — outbound signaling events.
 *   - `.on("…"` callsites — inbound signaling listeners (and a small
 *     explicit allow-list of legitimate non-signaling `.on()` names
 *     used in production: Socket.IO lifecycle, `connection` on the
 *     server, `SIGTERM` / `SIGINT` on `process`, `finish` on HTTP
 *     responses).
 *   - `.createDataChannel("…"` callsites — opened WebRTC data
 *     channels.
 *
 * The signaling-event whitelist is the audit's single source of truth
 * — it must stay byte-equivalent with Table 1 of
 * `docs/signaling-envelope-audit.md`. The data-channel-label whitelist
 * mirrors Table 2 of the same document.
 *
 * Why this exists (Task #437). The signaling envelope audit proves
 * that the WebSocket carries no user content. That proof rests on an
 * exhaustive enumeration of every event name and every data-channel
 * label. A future contributor who adds a new `socket.emit("chat", …)`
 * or `socket.on("transcript", …)` listener, or who opens a new
 * `pc.createDataChannel("file-transfer")`, would silently break the
 * audit's guarantee. This static check is the repo-wide net that
 * forces the contributor to confront the audit before landing such a
 * change — either by adding the new name to the whitelist AND updating
 * the audit doc with an honest payload description, or by reworking
 * the feature to ride DTLS-over-SCTP (which the audit already
 * documents as encrypted browser-to-browser).
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:signaling-envelope
 *
 * Wired into CI as part of the `marketing-voice` validation workflow
 * (the same gate as the other repo-wide static checks).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

// Scanned roots: every directory that contains production code which
// may `.emit("…")`, `.on("…")`, or `.createDataChannel("…")` on a path
// reachable from the deployed artifacts. Test files are excluded per
// the directory walk below.
const SCAN_ROOTS = [
  resolve(REPO_ROOT, "artifacts/void-client/src"),
  resolve(REPO_ROOT, "artifacts/api-server/src"),
];

// ─── Whitelists ──────────────────────────────────────────────────────
// ALLOWED_SIGNALING_EVENTS MUST stay byte-equivalent with Table 1 of
// docs/signaling-envelope-audit.md. ALLOWED_DATA_CHANNEL_LABELS MUST
// stay byte-equivalent with Table 2 of the same document. If you are
// adding a new event or channel label, update BOTH this file and the
// audit doc in the same commit.

const ALLOWED_SIGNALING_EVENTS = new Set([
  // C→S room lifecycle / moderation.
  "create-room", "join-room", "leave-room", "destroy-room", "burn-room", "extend-room",
  "lock-room", "unlock-room",
  "set-knock-mode", "approve-knock", "deny-knock", "cancel-knock",
  // Task #868: `peer-media-state` removed as a signaling event. Peer
  // camera/mic/voice-mask/onion state now travels peer-to-peer over the
  // `void.media-state` data channel (see ALLOWED_DATA_CHANNEL_LABELS).
  "request-relay-only", "respond-relay-only-request",
  "request-screen-share", "screen-share-started", "screen-share-stopped",

  // Encrypted SDP/ICE relay (payload is AES-GCM ciphertext under a key
  // the server never sees).
  "relay-signal", "peer-secure-channel-retry",

  // S→C room state / moderation.
  "peer-joined", "peer-left",
  "room-locked", "room-unlocked", "room-destroyed", "room-expired",
  "room-extended",
  "knock-request", "knock-approved", "knock-denied", "knock-mode-changed",
  "host-changed",
  "screen-share-state", "screen-share-granted", "screen-share-denied",
  "relay-only-requested", "relay-only-request-declined",
  "room-relay-mode-enabled",
  "server-shutdown",
]);

// Legitimate non-signaling `.on("…")` names that appear in scanned
// production code. These are NOT signaling events — they're either
// Socket.IO transport lifecycle (no payload) or unrelated host-OS /
// HTTP-server / Socket.IO-server hooks that happen to share the
// `.on(string, handler)` shape. Listed explicitly here so the check
// can distinguish them from a new user-content-bearing signaling
// listener, and so adding a new one forces a reviewer to explain it.
const ALLOWED_NON_SIGNALING_ON_NAMES = new Set([
  // Socket.IO client lifecycle (no payload, transport state only).
  "connect", "connect_error", "disconnect", "reconnect",
  // Socket.IO server: io.on("connection", …) is the per-socket accept.
  "connection",
  // process.on signal handlers (api-server/src/index.ts).
  "SIGTERM", "SIGINT",
  // HTTP response stream completion (api-server access log).
  "finish",
]);

const ALLOWED_DATA_CHANNEL_LABELS = new Set([
  // Agent SDK control plane.
  "void.control",
  // Agent SDK RPC. End-to-end private via DTLS-over-SCTP.
  "void.rpc",
  // Agent SDK streaming (reserved by schema; not opened in production
  // today, but the label is in the protocol's canonical list).
  "void.stream",
  // Browser-capability probe — no payload ever sent, channel exists
  // only to force ICE gathering during the screen-share preflight.
  "probe",
  // Task #443: shared DROP slot — a single UTF-8 string ≤2 KB that
  // atomically overwrites the previous value on every receiver. Opened
  // per-peer in artifacts/void-client/src/lib/webrtc.ts inside
  // `initiateOffer`. Rides DTLS-over-SCTP on the same encrypted
  // association as media; the signaling server cannot read the bytes.
  "drop",
  // Time-based PFS rekey control channel — carries `rekey-offer` /
  // `rekey-answer` envelopes (a fresh ECDH public key + monotonic epoch)
  // AES-GCM-encrypted under the CURRENT SAS-verified session key. Opened
  // per-peer by the offerer in artifacts/void-client/src/lib/webrtc.ts
  // inside `initiateOffer` (human rooms only). The encryption-under-the-
  // verified-key is the continuity binding that lets the rotation be
  // silent; see Table 2 row 6 and docs/client-threat-model.md §1.
  "void.rekey",
  // Task #868: per-peer media-state channel — carries the small JSON
  // snapshot {camOff, micMuted, voiceMode?, viaOnion?} so camera/mic/
  // voice-mask/onion indicators travel peer-to-peer instead of through a
  // plaintext `peer-media-state` signaling broadcast. Opened per-peer by
  // the offerer in artifacts/void-client/src/lib/webrtc.ts inside
  // `initiateOffer`. Rides DTLS-over-SCTP on the same encrypted
  // association as media; the signaling server cannot read the bytes.
  // See Table 2 row 7 and docs/signaling-envelope-audit.md.
  "void.media-state",
]);

// ─── File walk ───────────────────────────────────────────────────────

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test directories outright.
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

/**
 * Replace comments with whitespace (preserving newlines and length so
 * line numbers stay correct). String literals are preserved verbatim
 * so a quoted "socket.emit(\"foo\"" inside copy isn't blanked out — but
 * the regexes below only match actual call expressions, so this is
 * mostly defensive.
 */
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

// ─── Detection ──────────────────────────────────────────────────────

// Match `.emit("name"` or `.emit('name'`. The leading `.` is REQUIRED
// — it ensures we only match real method calls on a socket-like
// receiver (`socket.emit(`, `io.to(x).emit(`, `client.emit(`, etc.)
// and never bare `emit("foo")` tokens that appear inside JSX prose /
// code-span examples in the threat-model page.
const EMIT_RE = /\.emit\s*\(\s*(["'])([^"']+)\1/g;

// Match `.on("name"` or `.on('name'`. Same `.` requirement as above
// to avoid matching prose. We then check against BOTH the signaling
// event whitelist and the non-signaling allow-list, so a legitimate
// `process.on("SIGTERM"` does not trip the check while a new
// `socket.on("chat"` would.
const ON_RE = /\.on\s*\(\s*(["'])([^"']+)\1/g;

// Match `.createDataChannel("label"` or `.createDataChannel('label'`.
// Only matches calls (the `(` is required), so won't trigger on
// interface declarations or test stubs that use
// `createDataChannel:`.
const DC_RE = /\bcreateDataChannel\s*\(\s*(["'])([^"']+)\1/g;

const violations = [];
const seenEmits = new Set();
const seenOns = new Set();
const seenChannels = new Set();

for (const root of SCAN_ROOTS) {
  for (const file of walk(root).sort()) {
    const raw = readFileSync(file, "utf8");
    const src = stripComments(raw);

    let m;
    while ((m = EMIT_RE.exec(src)) !== null) {
      const name = m[2];
      seenEmits.add(name);
      if (!ALLOWED_SIGNALING_EVENTS.has(name)) {
        violations.push({
          file,
          line: lineNumberOf(src, m.index),
          rule: "unknown-emit-event",
          name,
        });
      }
    }

    while ((m = ON_RE.exec(src)) !== null) {
      const name = m[2];
      seenOns.add(name);
      if (
        !ALLOWED_SIGNALING_EVENTS.has(name) &&
        !ALLOWED_NON_SIGNALING_ON_NAMES.has(name)
      ) {
        violations.push({
          file,
          line: lineNumberOf(src, m.index),
          rule: "unknown-on-event",
          name,
        });
      }
    }

    while ((m = DC_RE.exec(src)) !== null) {
      const label = m[2];
      seenChannels.add(label);
      if (!ALLOWED_DATA_CHANNEL_LABELS.has(label)) {
        violations.push({
          file,
          line: lineNumberOf(src, m.index),
          rule: "unknown-data-channel-label",
          name: label,
        });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `signaling-envelope check failed: ${violations.length} violation(s).\n`,
  );
  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file);
    console.error(`  ${rel}:${v.line}  [${v.rule}]  "${v.name}"`);
  }
  console.error("");
  console.error("A new signaling event name, listener name, or data-channel label appeared");
  console.error("that is not documented in docs/signaling-envelope-audit.md. The audit's");
  console.error("guarantee (\"the WebSocket carries no user content\") rests on the");
  console.error("exhaustive enumeration in that file's two tables. To land this change you");
  console.error("must:");
  console.error("");
  console.error("  1. Add a row to the appropriate table in docs/signaling-envelope-audit.md");
  console.error("     with the file:line provenance and an honest description of whether the");
  console.error("     payload carries user content.");
  console.error("  2. Add the new name to the corresponding whitelist in this script.");
  console.error("");
  console.error("If the new payload would carry user content (chat, transcript, file blob,");
  console.error("audio/video frame), STOP — the audit's guarantee is broken. File a");
  console.error("follow-up task before landing the change.");
  process.exit(1);
}

console.log(
  `signaling-envelope check passed: ${seenEmits.size} emit name(s), ` +
    `${seenOns.size} on() name(s), and ${seenChannels.size} data-channel ` +
    `label(s) all match the audit whitelists in ` +
    `docs/signaling-envelope-audit.md.`,
);
