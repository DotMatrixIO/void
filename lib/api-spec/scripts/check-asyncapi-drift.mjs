#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: enumerate every Socket.io `socket.emit("...")` / `socket.on("...")`
// (and `io.to(...).emit("...")` / `socket.broadcast.emit("...")`) call site
// in the api-server and void-client production source, then diff the set of
// event names against every `address:` listed in `lib/api-spec/asyncapi.yaml`.
//
// This is the AsyncAPI sibling of the OpenAPI codegen drift check at
// `.github/workflows/api-spec-drift.yml`. It catches the case where a
// developer adds a new server emit (or a new client subscription) without
// updating the AsyncAPI spec, and the symmetric case where the spec lists a
// channel no production code references.
//
// Test files (`__tests__/`, `*.test.ts(x)`) are deliberately excluded — they
// frequently probe arbitrary event names to assert negative behaviour and
// would produce false positives if scanned.

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const SPEC_PATH = resolve(__dirname, "..", "asyncapi.yaml");

// Source roots scanned for emit/on call sites. Each entry is a directory whose
// `*.ts` / `*.tsx` files are recursively walked. Anything matching the
// `IGNORE_PATHS` or `IGNORE_NAMES` filters below is skipped.
const SOURCE_ROOTS = [
  resolve(REPO_ROOT, "artifacts/api-server/src"),
  resolve(REPO_ROOT, "artifacts/void-client/src"),
];

const IGNORE_PATH_SEGMENTS = ["__tests__", "node_modules"];
const IGNORE_NAME_PATTERNS = [/\.test\.tsx?$/, /\.spec\.tsx?$/, /\.d\.ts$/];

// Socket.io built-in / lifecycle event names we never expect to find in
// asyncapi.yaml — they're transport concerns, not part of the public
// signaling contract.
const BUILTIN_EVENTS = new Set([
  "connection",
  "connect",
  "connect_error",
  "disconnect",
  "disconnecting",
  "reconnect",
  "reconnect_attempt",
  "reconnect_error",
  "reconnect_failed",
  "error",
  "newListener",
  "removeListener",
  "ping",
  "pong",
]);

// Recursively collect every TS/TSX file under `dir`, honouring the ignore
// filters. Returns absolute paths.
async function collectSourceFiles(dir) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      if (IGNORE_PATH_SEGMENTS.includes(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (IGNORE_NAME_PATTERNS.some((re) => re.test(entry.name))) continue;
      out.push(full);
    }
  }
  await walk(dir);
  return out;
}

// Match every `.emit("event-name"` / `.on("event-name"` (or single-quoted /
// backtick-quoted) call. The leading dot keeps us inside method-call syntax
// (so a function-local `emit("foo")` doesn't match), and `\s*` lets the event
// name sit on a separate line (the api-server uses
// `socket.on(\n  "create-room",\n ...)` heavily). A tiny chance of false
// positives from unrelated `.emit()` / `.on()` (e.g. EventEmitter calls) is
// preferable to silently missing real signaling drift — the kebab-case
// allowlist below filters out anything that isn't a plausible Socket.io
// channel name.
const EVENT_CALL_RE = /\.(?:emit|on)\(\s*(['"`])([^'"`]+)\1/g;

async function extractCodeEvents() {
  const events = new Map(); // event name -> Set of source paths
  for (const root of SOURCE_ROOTS) {
    const files = await collectSourceFiles(root);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      EVENT_CALL_RE.lastIndex = 0;
      let m;
      while ((m = EVENT_CALL_RE.exec(text)) !== null) {
        const name = m[2];
        if (BUILTIN_EVENTS.has(name)) continue;
        // Skip names that are obviously not signaling channels (e.g. internal
        // EventTarget custom events): require kebab-case or single-word
        // lowercase. Real Socket.io event names in this project are all
        // kebab-case. Anything else is almost certainly a DOM / Node event.
        if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
        if (!events.has(name)) events.set(name, new Set());
        events.get(name).add(file);
      }
    }
  }
  return events;
}

// Pull every `address: <name>` line out of asyncapi.yaml. The spec lists each
// signaling channel under `channels:` with a kebab-case `address:` field;
// some addresses repeat (e.g. `relay-signal` appears as both
// `relaySignalIn` and `relaySignalOut`) so we collect into a Set.
async function extractSpecEvents() {
  const text = await readFile(SPEC_PATH, "utf8");
  const events = new Set();
  // Match `  address: kebab-case-name` (no quotes; the spec doesn't quote
  // these). Anchored at start-of-line + whitespace to avoid matching the
  // `address:` key inside `reply:` blocks (which always sits at a deeper
  // indent and is followed by a `location:` map, never a bare value).
  const re = /^\s+address:\s+([a-z][a-z0-9-]*)\s*$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    events.add(m[1]);
  }
  return events;
}

function formatEventList(events, codeIndex) {
  return [...events]
    .sort()
    .map((name) => {
      const files = codeIndex?.get(name);
      if (!files || files.size === 0) return `  - ${name}`;
      const sample = [...files]
        .map((f) => relative(REPO_ROOT, f))
        .sort()
        .slice(0, 3)
        .join(", ");
      const more = files.size > 3 ? ` (+${files.size - 3} more)` : "";
      return `  - ${name}  [${sample}${more}]`;
    })
    .join("\n");
}

async function main() {
  const [codeEvents, specEvents] = await Promise.all([
    extractCodeEvents(),
    extractSpecEvents(),
  ]);

  const codeNames = new Set(codeEvents.keys());

  const missingFromSpec = [...codeNames].filter((n) => !specEvents.has(n));
  const missingFromCode = [...specEvents].filter((n) => !codeNames.has(n));

  if (missingFromSpec.length === 0 && missingFromCode.length === 0) {
    const total = specEvents.size;
    process.stdout.write(
      `AsyncAPI signaling channel is in sync with code (${total} events).\n`,
    );
    return;
  }

  process.stderr.write(
    "AsyncAPI signaling-channel drift detected.\n\n",
  );

  if (missingFromSpec.length > 0) {
    process.stderr.write(
      "Events emitted/subscribed in code but missing from lib/api-spec/asyncapi.yaml:\n",
    );
    process.stderr.write(formatEventList(missingFromSpec, codeEvents) + "\n\n");
    process.stderr.write(
      "Fix: add a `channels[*].address` (and matching operation + message)\n" +
        "for each event above, OR remove the stray emit/on call from the code.\n\n",
    );
  }

  if (missingFromCode.length > 0) {
    process.stderr.write(
      "Channels declared in lib/api-spec/asyncapi.yaml but never referenced in code:\n",
    );
    process.stderr.write(formatEventList(missingFromCode) + "\n\n");
    process.stderr.write(
      "Fix: remove the stale channel/operation/message entries from the spec,\n" +
        "OR start emitting/subscribing the event from the api-server / void-client.\n\n",
    );
  }

  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`check-asyncapi-drift failed: ${err.stack ?? err}\n`);
  process.exit(1);
});
