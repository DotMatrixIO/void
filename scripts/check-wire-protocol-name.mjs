// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Wire-protocol-name regression guard.
//
// The signed-hello handshake was renamed from the misleading `void-agent/1` /
// `Agent*` vocabulary to the neutral `void-wire/1` / `Wire*`. Those strings are
// load-bearing: they are part of the Ed25519 signature inputs for the
// browser↔browser handshake. This guard makes the rename a one-way door:
//
//   (a) The literal `void-agent` must not appear in wire handshake source.
//   (b) `AgentIdentity` and `AgentCapabilities` — the old names for the two
//       central wire types — must not appear in wire handshake source.
//   (c) PROTOCOL_VERSION in lib/wire-core/src/schemas.ts must equal
//       "void-wire/1" (checked by parsing the assignment literal).
//   (d) Both SIGNING_CONTEXTS values in the same file must start with
//       "void-wire/1" (same parse approach).
//
// Protected roots: the three source trees that jointly define or consume the
// signed-hello wire format. Test and dist directories are excluded.
//
// Run via: pnpm --filter @workspace/scripts run check:wire-protocol-name

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ─── Protected source roots ───────────────────────────────────────────────────
// These three trees jointly own the signed-hello wire format.  Any file under
// them that reintroduces `void-agent` or the old `Agent*` type names would
// silently break or mislead the wire/signature implementation.
const PROTECTED_ROOTS = [
  "lib/wire-core/src",
  "artifacts/void-client/src",
  "artifacts/api-server/src",
];

// ─── Forbidden literals ───────────────────────────────────────────────────────
// (a) The old protocol string.
const FORBIDDEN_SUBSTRINGS = [
  "void-agent",
];

// (b) The old Agent-prefixed wire identity / capabilities type names.
// These are word-boundary checked (see scan below) so `AgentFoo` in unrelated
// contexts cannot sneak through as a false negative.
const FORBIDDEN_AGENT_TYPES = [
  "AgentIdentity",
  "AgentCapabilities",
];

// ─── Canonical wire-core schema file ─────────────────────────────────────────
// (c) + (d): we parse the assignments out of this file directly.
const SCHEMAS_FILE = join(REPO_ROOT, "lib/wire-core/src/schemas.ts");

// ─── File walker ─────────────────────────────────────────────────────────────
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function* walkSource(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".vite" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSource(full);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      if (!entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx") && !entry.endsWith(".d.ts")) {
        yield full;
      }
    }
  }
}

// ─── Comment stripper (same approach as check-signaling-envelope.mjs) ────────
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

// ─── Scan (a) + (b) + comment hygiene ────────────────────────────────────────
const violations = [];
const commentWarnings = [];

for (const root of PROTECTED_ROOTS) {
  const absRoot = join(REPO_ROOT, root);
  if (!existsSync(absRoot)) continue;
  for (const file of walkSource(absRoot)) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const src = stripComments(raw);
    const rel = relative(REPO_ROOT, file);

    // (a) forbidden substring scan
    for (const sub of FORBIDDEN_SUBSTRINGS) {
      let idx = src.indexOf(sub);
      while (idx !== -1) {
        const lineNo = lineNumberOf(src, idx);
        violations.push(
          `${rel}:${lineNo}  [forbidden-protocol-string]  contains "${sub}" — ` +
          `the old protocol name; use "void-wire/1" instead.`
        );
        idx = src.indexOf(sub, idx + sub.length);
      }
    }

    // (b) forbidden Agent-prefixed type names (word-boundary: preceded and
    // followed by a non-word character or start/end of source)
    for (const typeName of FORBIDDEN_AGENT_TYPES) {
      const re = new RegExp(`\\b${typeName}\\b`, "g");
      let m;
      while ((m = re.exec(src)) !== null) {
        const lineNo = lineNumberOf(src, m.index);
        violations.push(
          `${rel}:${lineNo}  [forbidden-agent-type]  "${typeName}" is the old ` +
          `Agent-prefixed wire type name; use the Wire* equivalent instead.`
        );
      }
    }

    // (e) comment-hygiene: warn (not fail) when `void-agent` appears in raw
    // source but not in the stripped version — i.e. the hit is inside a comment.
    // Comments don't affect wire signatures, but stale references confuse future
    // contributors into thinking the old name is still active.
    for (const sub of FORBIDDEN_SUBSTRINGS) {
      let rawIdx = raw.indexOf(sub);
      while (rawIdx !== -1) {
        // Only warn when the same offset is NOT a hit in stripped source (i.e.
        // the match is inside a comment or was in stripped-out whitespace).
        const strippedWindow = src.slice(rawIdx, rawIdx + sub.length);
        if (strippedWindow !== sub) {
          const lineNo = lineNumberOf(raw, rawIdx);
          commentWarnings.push(
            `${rel}:${lineNo}  [stale-comment]  "${sub}" found in a comment — ` +
            `consider updating to "void-wire/1" or removing the reference.`
          );
        }
        rawIdx = raw.indexOf(sub, rawIdx + sub.length);
      }
    }

    // (e) comment-hygiene, cont.: the same staleness problem applies to the old
    // `AgentIdentity` / `AgentCapabilities` type names. The word-boundary scan
    // in (b) runs on stripped source, so an old type name living inside a comment
    // is invisible there. Warn (not fail) when one appears in a comment — i.e. the
    // raw hit has no counterpart at the same offset in the stripped source.
    for (const typeName of FORBIDDEN_AGENT_TYPES) {
      const re = new RegExp(`\\b${typeName}\\b`, "g");
      let m;
      while ((m = re.exec(raw)) !== null) {
        const strippedWindow = src.slice(m.index, m.index + typeName.length);
        if (strippedWindow !== typeName) {
          const lineNo = lineNumberOf(raw, m.index);
          commentWarnings.push(
            `${rel}:${lineNo}  [stale-comment]  "${typeName}" found in a comment — ` +
            `the old Agent-prefixed wire type name; consider updating to the Wire* ` +
            `equivalent or removing the reference.`
          );
        }
      }
    }
  }
}

// ─── Assert (c) PROTOCOL_VERSION == "void-wire/1" ────────────────────────────
if (!existsSync(SCHEMAS_FILE)) {
  violations.push(
    `lib/wire-core/src/schemas.ts is missing — cannot assert PROTOCOL_VERSION.`
  );
} else {
  const schemasText = readFileSync(SCHEMAS_FILE, "utf8");
  const schemasStripped = stripComments(schemasText);

  // Match: export const PROTOCOL_VERSION = "..." as const;
  // or:    export const PROTOCOL_VERSION = '...';
  const pvMatch = schemasStripped.match(
    /\bPROTOCOL_VERSION\s*=\s*(["'])([^"']+)\1/
  );
  if (!pvMatch) {
    violations.push(
      `lib/wire-core/src/schemas.ts: could not locate PROTOCOL_VERSION assignment.`
    );
  } else if (pvMatch[2] !== "void-wire/1") {
    violations.push(
      `lib/wire-core/src/schemas.ts: PROTOCOL_VERSION is "${pvMatch[2]}" ` +
      `but must be "void-wire/1".`
    );
  }

  // ─── Assert (d) SIGNING_CONTEXTS.HELLO and .ENVELOPE start with "void-wire/1" ─
  // We require both named keys to be present as string literals so that a future
  // rename, deletion, or conversion to a computed value is caught immediately.
  const scBlockMatch = schemasStripped.match(
    /\bSIGNING_CONTEXTS\s*=\s*\{([^}]+)\}/
  );
  if (!scBlockMatch) {
    violations.push(
      `lib/wire-core/src/schemas.ts: could not locate SIGNING_CONTEXTS assignment.`
    );
  } else {
    const block = scBlockMatch[1];
    // Extract each named key and its string value from the block.
    const entryRe = /\b(\w+)\s*:\s*(["'])([^"']+)\2/g;
    const found = {};
    let em;
    while ((em = entryRe.exec(block)) !== null) {
      found[em[1]] = em[3];
    }
    for (const key of ["HELLO", "ENVELOPE"]) {
      if (!(key in found)) {
        violations.push(
          `lib/wire-core/src/schemas.ts: SIGNING_CONTEXTS.${key} is missing ` +
          `or is not a string literal — both HELLO and ENVELOPE must be ` +
          `present as literal strings.`
        );
      } else if (!found[key].startsWith("void-wire/1")) {
        violations.push(
          `lib/wire-core/src/schemas.ts: SIGNING_CONTEXTS.${key} is ` +
          `"${found[key]}" — must start with "void-wire/1" (not the old ` +
          `"void-agent/1" prefix).`
        );
      }
    }
  }
}

// ─── Report ──────────────────────────────────────────────────────────────────
if (violations.length > 0) {
  console.error(
    `wire-protocol-name guard FAILED: ${violations.length} violation(s).\n`
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(`
The signed-hello handshake was renamed from the old agent-prefixed protocol
string to "void-wire/1" / Wire* as a deliberate wire-version bump. These
strings are load-bearing: they are hashed into every Ed25519 signature in the
browser handshake. Reintroducing the old name silently breaks or misleads the
wire implementation.

To resolve a [forbidden-protocol-string] or [forbidden-agent-type] violation:
  • Replace the old name with its void-wire/1 / Wire* equivalent.
  • If this is intentional (e.g. a migration shim), document the rationale
    here and update the whitelist in scripts/check-wire-protocol-name.mjs.

To resolve a PROTOCOL_VERSION / SIGNING_CONTEXTS assertion failure:
  • The canonical source is lib/wire-core/src/schemas.ts.
  • Any change to these constants is a hard wire-version bump that requires
    a coordinated update of both peers (browser client + API server) and
    the corresponding doc-drift anchors.
`);
  process.exit(1);
}

if (commentWarnings.length > 0) {
  console.warn(
    `wire-protocol-name guard passed with ${commentWarnings.length} comment-hygiene warning(s).\n`
  );
  for (const w of commentWarnings) console.warn(`  ${w}`);
  console.warn(`
These are stale comments that still reference the old protocol name.  They do
not affect wire signatures, but may confuse future contributors.  Clean them up
by rewording the comment (e.g. "the old agent-prefixed protocol string") or
removing the reference entirely.  This is a warning, not a hard failure.
`);
} else {
  console.log(
    `wire-protocol-name guard passed: no "void-agent" literal or Agent-prefixed ` +
    `wire type found in protected roots (${PROTECTED_ROOTS.join(", ")}); ` +
    `PROTOCOL_VERSION == "void-wire/1"; both SIGNING_CONTEXTS values carry the ` +
    `"void-wire/1" prefix. No stale comment references found.`
  );
}
