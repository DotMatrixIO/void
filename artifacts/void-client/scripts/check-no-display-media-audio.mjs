#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-no-display-media-audio.mjs
 *
 * Fails (exit 1) if any `getDisplayMedia(...)` call in ANY artifact's
 * source tree (every `artifacts/* /src/` directory in the monorepo)
 * either:
 *
 *   (a) omits an explicit `audio: false` in the literal constraints
 *       object passed to the call, OR
 *   (b) is not followed (within the next ~60 lines, i.e. the same
 *       call-handling code block) by a defensive cleanup that calls
 *       `getAudioTracks()` and both `.stop()` + `.removeTrack(` on the
 *       returned tracks before the stream can reach a peer
 *       connection.
 *
 * Why this exists (Task #412 / Task #420). Task #404 hardened the two
 * existing `getDisplayMedia()` callsites in `RoomPage.tsx` so they
 * cannot capture system audio. That guarantee was enforced by
 * per-callsite code review and per-callsite unit tests — meaning a
 * future contributor who adds a third callsite (e.g. for a
 * presenter-music feature, a "share tab audio" toggle, or any new
 * screen-share entry point) and forgets the constraint silently
 * regresses the VOID voice-mask / SILHOUETTE anonymity guarantee.
 *
 * Task #412 added this static check, but scoped it to
 * `artifacts/void-client/src/` only. Task #420 widened the scope: the
 * scanner now walks EVERY artifact's `src/` tree, so a future web
 * artifact (an operator console, a separate mobile-web entry point,
 * an embeddable widget, …) that ships a `getDisplayMedia()` call is
 * held to the same no-system-audio guarantee with zero per-artifact
 * wiring. The check auto-extends to new artifacts the moment they are
 * added under `artifacts/`. `getDisplayMedia` is a browser-only API,
 * so non-web artifacts (e.g. the Node `api-server`) simply contain no
 * matching calls and pass trivially.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:no-display-media-audio
 *
 * Wired into CI as part of the `marketing-voice` validation workflow
 * in .replit (the same gate as the other repo-wide static checks).
 *
 * Test files (`*.test.ts`, `*.test.tsx`) are excluded — they stub
 * `getDisplayMedia` on `navigator.mediaDevices` and never call it
 * directly. The `getDisplayMedia\(` regex already skips those stubs
 * (they appear as `getDisplayMedia:` property assignments, not as
 * calls), but we also drop the files outright for safety.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");
const ARTIFACTS_ROOT = resolve(REPO_ROOT, "artifacts");

/**
 * Discover every `artifacts/<name>/src` directory in the monorepo.
 *
 * The check is intentionally NOT limited to the VOID client (Task
 * #420). Any artifact added in the future that ships a
 * `getDisplayMedia()` call — an operator console, a separate
 * mobile-web entry point, an embeddable widget — must satisfy the
 * same no-system-audio guarantee. Scanning every artifact's `src/`
 * tree means the regression net auto-extends to new artifacts with
 * zero per-artifact wiring. Artifacts without a `src/` directory (or
 * before `artifacts/` exists at all) are skipped silently.
 */
export function discoverArtifactSrcRoots(artifactsRoot = ARTIFACTS_ROOT) {
  const roots = [];
  let entries;
  try {
    entries = readdirSync(artifactsRoot);
  } catch {
    return roots;
  }
  for (const name of entries.sort()) {
    const srcDir = join(artifactsRoot, name, "src");
    try {
      if (statSync(srcDir).isDirectory()) roots.push(srcDir);
    } catch {
      // No `src/` directory (e.g. a config-only artifact) — skip.
    }
  }
  return roots;
}

// How far past a `getDisplayMedia(` call we look for the
// stop+remove cleanup. The existing callsites in RoomPage.tsx do the
// cleanup within ~20 lines of the call; 60 gives plenty of headroom
// for a slightly different code shape (e.g. wrapped in a helper).
const CLEANUP_LOOKAHEAD_LINES = 60;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
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
 * Extract the argument substring of a `getDisplayMedia(...)` call
 * starting at the index of the `(`. Returns null if parens are not
 * balanced (malformed code — let TypeScript handle it).
 */
function extractCallArgs(source, openParenIdx) {
  let depth = 0;
  let inString = null; // '"' | "'" | '`' | null
  let escaped = false;
  for (let i = openParenIdx; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return source.slice(openParenIdx + 1, i);
      }
    }
  }
  return null;
}

function lineNumberOf(source, idx) {
  let line = 1;
  for (let i = 0; i < idx; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Replace the contents of `//` line comments and `/* ... *\/` block
 * comments with spaces (preserving newlines and length so line
 * numbers and indices are unchanged). String literals are preserved
 * verbatim so that, while we don't expect a real call inside a
 * string, a stray quoted "getDisplayMedia(" in user-facing copy
 * still won't be mis-detected and a real call won't accidentally be
 * blanked out. We only need to neutralize comments — the regex
 * doesn't match property accesses (`getDisplayMedia:`) so those are
 * already safe.
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
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === inString) {
        inString = null;
      }
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
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < source.length) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * `audio: false` literal detector. Accepts arbitrary whitespace
 * between the key, colon, and value (`audio:false`, `audio :  false`,
 * `"audio": false`, `'audio': false`). Rejects `audio: true`,
 * `audio: undefined`, `audio: someVar`, `audio: { … }`.
 */
const AUDIO_FALSE_RE = /(?:^|[\s,{])(?:["']?audio["']?)\s*:\s*false\b/;

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Find the brace-balanced body starting at the `{` at `openBraceIdx`.
 * Skips string literals so `{` / `}` inside strings don't confuse
 * the depth counter. Returns null on unbalanced input.
 */
function extractBraceBody(source, openBraceIdx) {
  let depth = 0;
  let inString = null;
  let escaped = false;
  for (let i = openBraceIdx; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openBraceIdx + 1, i);
    }
  }
  return null;
}

/**
 * If the constraints argument is just a bare identifier (e.g.
 * `SHARE_CONSTRAINTS`), look that identifier up as a top-level
 * `const NAME ... = { ... }` in the same file and return its
 * object-literal body. Returns null if the identifier isn't a
 * resolvable const-with-object-initializer in this file.
 *
 * This exists because factoring constraints out of the call site
 * is a normal DRY refactor across multiple callsites (see
 * useScreenShareLifecycle.ts) and the scanner shouldn't punish it.
 */
function resolveConstObjectLiteral(source, ident) {
  const declRe = new RegExp(
    String.raw`\b(?:const|let|var)\s+` + ident + String.raw`\b[^=]*=\s*\{`,
  );
  const m = declRe.exec(source);
  if (!m) return null;
  const openBraceIdx = m.index + m[0].length - 1;
  return extractBraceBody(source, openBraceIdx);
}

/**
 * Return the bodies of every top-level helper defined in `source`
 * whose name appears as a call expression inside `windowText`.
 *
 * Supports the two function-definition shapes used in this codebase:
 *   - `function NAME(...) { ... }`
 *   - `const NAME = (...) => { ... }`  /  `const NAME = function ...(...) { ... }`
 *
 * This exists because the belt-and-suspenders audio-track cleanup
 * is frequently factored out into a helper (e.g.
 * `stripStragglerAudio(displayStream)` in
 * useScreenShareLifecycle.ts). Inlining same-file helpers called
 * within the lookahead window lets the existing
 * `getAudioTracks` / `.stop()` / `.removeTrack(` regexes catch the
 * cleanup wherever the implementation actually lives.
 */
/**
 * Detect a dependency-injection pass-through wrapper of the form
 *
 *     (constraints) => navigator.mediaDevices.getDisplayMedia(constraints)
 *
 * or its `function NAME(constraints) { return ...; }` equivalent.
 *
 * Pattern: the call's single argument is an identifier that matches
 * the single parameter of an arrow/function whose entire body is
 * this call. Such a wrapper exists only as a test seam (e.g. the
 * `getDisplayMedia` default in useScreenShareLifecycle.ts), forwards
 * an opaque value the scanner cannot statically reason about, and
 * is itself a no-op — the real audio policy is enforced at the
 * wrapper's *callers*, which DO pass literal/named constraints we
 * can resolve and which DO own the cleanup window.
 *
 * Treating this case as a violation would force the hook to either
 * inline the constraints (defeating the DI seam) or invent fake
 * cleanup with no stream to clean up. So we recognize the shape
 * and skip both checks.
 */
function isPassthroughDIWrapper(source, callMatchIdx, argIdent) {
  if (!IDENT_RE.test(argIdent)) return false;
  const lookback = source.slice(Math.max(0, callMatchIdx - 240), callMatchIdx);
  // `(IDENT) =>` (optionally typed) directly before the
  // `[ns.]getDisplayMedia(` call, with no other statements between.
  const arrowRe = new RegExp(
    String.raw`\(\s*` +
      argIdent +
      String.raw`\s*(?::[^)]*)?\)\s*=>\s*(?:\{\s*return\s+)?(?:[A-Za-z_$][\w.$]*\.)?$`,
  );
  if (arrowRe.test(lookback)) return true;
  // `function NAME(IDENT) { return ` immediately before the call.
  const fnRe = new RegExp(
    String.raw`function\s*\w*\s*\(\s*` +
      argIdent +
      String.raw`\s*(?::[^)]*)?\)\s*\{\s*return\s+(?:[A-Za-z_$][\w.$]*\.)?$`,
  );
  if (fnRe.test(lookback)) return true;
  return false;
}

function expandSameFileHelperBodies(source, windowText) {
  const calledNames = new Set();
  const callRe = /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = callRe.exec(windowText)) !== null) {
    calledNames.add(m[1]);
  }
  if (calledNames.size === 0) return "";
  const bodies = [];
  for (const name of calledNames) {
    if (!IDENT_RE.test(name)) continue;
    // function NAME(...) { ... }
    const fnDeclRe = new RegExp(
      String.raw`\bfunction\s+` + name + String.raw`\s*\([^)]*\)[^{]*\{`,
    );
    let dm = fnDeclRe.exec(source);
    if (dm) {
      const body = extractBraceBody(source, dm.index + dm[0].length - 1);
      if (body !== null) bodies.push(body);
      continue;
    }
    // const NAME = (...) => { ... }  /  const NAME = function (...) { ... }
    const constArrowRe = new RegExp(
      String.raw`\b(?:const|let|var)\s+` +
        name +
        String.raw`\b[^=]*=\s*(?:async\s+)?(?:function[^{]*|\([^)]*\)[^=>{]*=>\s*)\{`,
    );
    dm = constArrowRe.exec(source);
    if (dm) {
      const body = extractBraceBody(source, dm.index + dm[0].length - 1);
      if (body !== null) bodies.push(body);
    }
  }
  return bodies.join("\n");
}

/**
 * Scan every artifact `src/` tree under `artifactsRoot` and collect
 * audio-policy violations. Pure: performs no console output and never
 * calls `process.exit`, so it can be unit-tested against synthetic
 * fixtures. Returns the violation list plus the roots/files scanned
 * (the CLI uses the latter for its summary line).
 */
export function scanArtifacts(artifactsRoot = ARTIFACTS_ROOT) {
  const violations = [];
  const srcRoots = discoverArtifactSrcRoots(artifactsRoot);
  const allFiles = [];
  for (const srcRoot of srcRoots) walk(srcRoot, allFiles);

  for (const file of allFiles.sort()) {
    const rawSource = readFileSync(file, "utf8");
  const source = stripComments(rawSource);
  const lines = source.split("\n");

  // Find every `getDisplayMedia(` callsite. The regex `\bgetDisplayMedia\s*\(`
  // matches actual call expressions and skips the property-access
  // forms used in test stubs (`getDisplayMedia:`) and the feature
  // detection (`getDisplayMedia ===`).
  const callRe = /\bgetDisplayMedia\s*\(/g;
  let m;
  while ((m = callRe.exec(source)) !== null) {
    const openParenIdx = m.index + m[0].length - 1;
    const line = lineNumberOf(source, m.index);

    // (a) audio: false constraint check.
    const args = extractCallArgs(source, openParenIdx);
    if (args === null) {
      violations.push({
        file,
        line,
        rule: "audio-false-required",
        detail: "Unbalanced parens in getDisplayMedia(...) call; cannot statically verify constraints.",
      });
      continue;
    }
    // Skip dependency-injection pass-through wrappers — see
    // isPassthroughDIWrapper. The wrapper itself can't carry an
    // audio policy; the real callers do, and they get checked
    // separately.
    if (isPassthroughDIWrapper(source, m.index, args.trim())) {
      continue;
    }
    // If the call passes a bare identifier (e.g.
    // `getDisplayMedia(SHARE_CONSTRAINTS)`), resolve that identifier
    // to its `const NAME = { ... }` declaration in the same file
    // and check the object literal there. This keeps the scanner
    // honest about DRY refactors where the constraints are factored
    // out across multiple callsites (see useScreenShareLifecycle.ts).
    let constraintsBody = args;
    const trimmedArgs = args.trim();
    if (IDENT_RE.test(trimmedArgs)) {
      const resolved = resolveConstObjectLiteral(source, trimmedArgs);
      if (resolved !== null) constraintsBody = resolved;
    }
    if (!AUDIO_FALSE_RE.test(constraintsBody)) {
      violations.push({
        file,
        line,
        rule: "audio-false-required",
        detail:
          "getDisplayMedia(...) must pass `audio: false` explicitly in its literal constraints object " +
          "(or via a same-file `const NAME = { ..., audio: false }` resolved by name). " +
          "See Task #404 / Task #412 — omitting it lets the browser default the 'Share system audio' " +
          "checkbox to on, which would bypass the voice mask.",
      });
    }

    // (b) belt-and-suspenders cleanup check: within the next
    // CLEANUP_LOOKAHEAD_LINES, both `getAudioTracks()` and
    // `removeTrack(` must appear. We also require a `.stop()` call,
    // since stopping the underlying device track is the part that
    // actually releases the OS-level audio capture handle.
    const windowStart = line; // 1-indexed; slice is 0-indexed below
    const windowEnd = Math.min(lines.length, line + CLEANUP_LOOKAHEAD_LINES);
    const windowText = lines.slice(windowStart - 1, windowEnd).join("\n");
    // Inline same-file helper bodies for any function called inside
    // the window, so a factored-out cleanup helper (e.g.
    // `stripStragglerAudio(displayStream)`) counts the same as
    // inlining its body at the callsite. Only same-file helpers are
    // followed — cross-file resolution is out of scope on purpose,
    // because trusting an arbitrary import would turn the check into
    // a rubber stamp.
    const helperBodies = expandSameFileHelperBodies(source, windowText);
    const cleanupScope = windowText + "\n" + helperBodies;
    const hasGetAudioTracks = /\.getAudioTracks\s*\(/.test(cleanupScope);
    const hasRemoveTrack = /\.removeTrack\s*\(/.test(cleanupScope);
    const hasStop = /\.stop\s*\(\s*\)/.test(cleanupScope);
    if (!(hasGetAudioTracks && hasRemoveTrack && hasStop)) {
      const missing = [];
      if (!hasGetAudioTracks) missing.push("getAudioTracks()");
      if (!hasStop) missing.push(".stop()");
      if (!hasRemoveTrack) missing.push(".removeTrack(...)");
      violations.push({
        file,
        line,
        rule: "audio-track-cleanup-required",
        detail:
          `getDisplayMedia(...) call is not followed by the required belt-and-suspenders ` +
          `audio-track cleanup within ${CLEANUP_LOOKAHEAD_LINES} lines. Missing: ${missing.join(", ")}. ` +
          `See Task #404 / Task #412 — the call must be followed by ` +
          `stream.getAudioTracks().forEach(t => t.stop()) AND stream.removeTrack(t) ` +
          `BEFORE the stream reaches any RTCPeerConnection.`,
      });
    }
  }
  }
  return { violations, roots: srcRoots, files: allFiles };
}

function main() {
  const { violations, roots, files } = scanArtifacts();

  if (violations.length > 0) {
    console.error(
      `getDisplayMedia audio-policy check failed: ${violations.length} violation(s).\n`,
    );
    for (const v of violations) {
      const rel = relative(REPO_ROOT, v.file);
      console.error(`  ${rel}:${v.line}  [${v.rule}]`);
      console.error(`    ${v.detail}\n`);
    }
    console.error(
      "If you are intentionally adding a new screen-share entry point, the only correct fix is",
    );
    console.error(
      "to mirror the pattern already used in artifacts/void-client/src/pages/RoomPage.tsx:",
    );
    console.error("");
    console.error("  const displayStream = await navigator.mediaDevices.getDisplayMedia({");
    console.error("    video: { /* ... */ },");
    console.error("    audio: false,                       // REQUIRED — see Task #404");
    console.error("  });");
    console.error("  const stragglers = displayStream.getAudioTracks();");
    console.error("  for (const t of stragglers) { try { t.stop(); } catch {} }");
    console.error("  for (const t of stragglers) { try { displayStream.removeTrack(t); } catch {} }");
    console.error("");
    process.exit(1);
  }

  const scopeSummary =
    roots.length === 0
      ? "no artifact src/ trees found"
      : `${files.length} file(s) across ${roots.length} artifact src/ tree(s)`;
  console.log(
    "getDisplayMedia audio-policy check passed: every call in " +
      `every artifacts/*/src/ tree (${scopeSummary}) passes \`audio: false\` AND ` +
      "stops + removes any returned audio tracks before they can reach a peer connection.",
  );
}

// Only run the CLI when executed directly (`node check-...mjs`), not
// when imported by the unit tests, which call `scanArtifacts()`
// against synthetic fixture trees.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
