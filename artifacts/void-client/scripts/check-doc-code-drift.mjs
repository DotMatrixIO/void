#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-doc-code-drift.mjs
 *
 * Fails (exit 1) if a hand-written prose value in the long-form docs
 * disagrees with the code constant it claims to describe.
 *
 * Why this exists (Task #872). Task #867 fixed five places where the
 * prose docs (VOID_TECHNICAL_OVERVIEW.md, docs/signaling-envelope-audit.md)
 * had silently drifted away from the
 * code. Only ONE of those — the signaling event count / Table 1 — is
 * pinned by a guard (check-signaling-envelope.mjs). The other prose
 * values are free-text and will drift again the next time the code
 * changes, because nothing forces the editor to revisit them.
 *
 * This check is the same net for two more values that are easy to get
 * wrong and security-relevant:
 *
 *   1. The periodic GC sweep interval. `GC_INTERVAL_MS` in
 *      artifacts/api-server/src/rooms/types.ts is described in prose in
 *      VOID_TECHNICAL_OVERVIEW.md §3.5 ("Every 30 seconds … (`GC_INTERVAL_MS
 *      = 30 * 1000`)"). Both the human-readable seconds value AND the
 *      code expression are asserted against the constant.
 *
 *   2. The inbound SDP codec allowlists. `ALLOWED_AUDIO_CODECS` and
 *      `ALLOWED_VIDEO_CODECS` in artifacts/void-client/src/lib/sdpValidator.ts
 *      are enumerated in prose in VOID_TECHNICAL_OVERVIEW.md §14
 *      (the H-03 deferred-items entry). That copy is compared, as a
 *      SET (order-independent), against the code.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:doc-code-drift
 *
 * Wired into CI as part of the `marketing-voice` validation workflow
 * (the same gate as the other repo-wide static doc checks).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const TYPES_TS = resolve(REPO_ROOT, "artifacts/api-server/src/rooms/types.ts");
const SDP_VALIDATOR_TS = resolve(
  REPO_ROOT,
  "artifacts/void-client/src/lib/sdpValidator.ts",
);
const TECHNICAL_OVERVIEW = resolve(REPO_ROOT, "VOID_TECHNICAL_OVERVIEW.md");

const violations = [];

function read(path) {
  return readFileSync(path, "utf8");
}

function rel(path) {
  return relative(REPO_ROOT, path);
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Evaluate a trivial integer arithmetic expression (the right-hand side
 * of a `const X = …;`). Restricted to digits, `_` digit separators, and
 * the four operators plus parentheses/whitespace so this never executes
 * arbitrary code from the source file.
 */
function evalIntExpr(expr) {
  const cleaned = expr.replace(/_/g, "").trim();
  if (!/^[0-9+\-*/ ()]+$/.test(cleaned)) {
    throw new Error(`refusing to evaluate non-arithmetic expression: ${expr}`);
  }
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${cleaned});`)();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`expression did not evaluate to a finite number: ${expr}`);
  }
  return value;
}

/**
 * Extract the string-literal members of a `new Set([ … ])` initializer
 * for the named const. Line comments are stripped first so a `//`-quoted
 * word can never be mistaken for a member. Members are double- or
 * single-quoted string literals.
 */
function extractSetMembers(source, constName) {
  const re = new RegExp(
    `${constName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`,
  );
  const m = re.exec(source);
  if (!m) {
    throw new Error(`could not find ${constName} = new Set([ … ]) in source`);
  }
  const body = m[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const members = [];
  const memberRe = /(["'])([^"']+)\1/g;
  let mm;
  while ((mm = memberRe.exec(body)) !== null) members.push(mm[2]);
  return members;
}

/**
 * Pull the codec tokens out of a doc region bounded by two literal
 * markers. Within the region we collect every backtick span and split
 * its contents on commas / whitespace / semicolons, keeping tokens that
 * look like codec names (lowercase alnum + dashes). This handles BOTH
 * doc shapes: one-codec-per-backtick (`opus`, `g722`, …) and a single
 * backtick span holding a comma list (`opus, g722, …`).
 */
function codecsInRegion(text, startMarker, endMarker, label, anchor = 0) {
  const start = text.indexOf(startMarker, anchor);
  if (start === -1) {
    throw new Error(`could not find start marker for ${label}: "${startMarker}"`);
  }
  const from = start + startMarker.length;
  const end = text.indexOf(endMarker, from);
  if (end === -1) {
    throw new Error(`could not find end marker for ${label}: "${endMarker}"`);
  }
  const region = text.slice(from, end);
  const tokens = new Set();
  const spanRe = /`([^`]+)`/g;
  let sm;
  while ((sm = spanRe.exec(region)) !== null) {
    for (const raw of sm[1].split(/[\s,;]+/)) {
      const tok = raw.trim().toLowerCase();
      if (/^[a-z0-9][a-z0-9-]*$/.test(tok)) tokens.add(tok);
    }
  }
  return tokens;
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function diffSets(code, doc) {
  const missingFromDoc = [...code].filter((x) => !doc.has(x)).sort();
  const extraInDoc = [...doc].filter((x) => !code.has(x)).sort();
  return { missingFromDoc, extraInDoc };
}

// ─── Check 1: GC sweep interval ──────────────────────────────────────

try {
  const typesSrc = read(TYPES_TS);
  const m = /export const GC_INTERVAL_MS\s*=\s*([^;]+);/.exec(typesSrc);
  if (!m) {
    violations.push({
      where: rel(TYPES_TS),
      msg: "could not find `export const GC_INTERVAL_MS = …;` in code",
    });
  } else {
    const expr = m[1].trim();
    const ms = evalIntExpr(expr);
    const seconds = ms / 1000;
    const codeLiteral = `GC_INTERVAL_MS = ${expr}`;
    const secondsPhrase = `${seconds} seconds`;

    const docSrc = read(TECHNICAL_OVERVIEW);
    const bulletLine = docSrc
      .split("\n")
      .find((line) => line.includes("GC_INTERVAL_MS"));

    if (!bulletLine) {
      violations.push({
        where: rel(TECHNICAL_OVERVIEW),
        msg:
          "could not find any line mentioning GC_INTERVAL_MS in §3.5 " +
          `(code says \`${codeLiteral}\`, i.e. every ${secondsPhrase})`,
      });
    } else {
      if (!bulletLine.includes(codeLiteral)) {
        violations.push({
          where: rel(TECHNICAL_OVERVIEW),
          msg:
            `§3.5 GC-sweep line does not contain the code expression \`${codeLiteral}\`. ` +
            `Code (${rel(TYPES_TS)}) defines GC_INTERVAL_MS = ${expr}. ` +
            "Update the parenthetical in the doc to match.",
        });
      }
      if (!bulletLine.includes(secondsPhrase)) {
        violations.push({
          where: rel(TECHNICAL_OVERVIEW),
          msg:
            `§3.5 GC-sweep line does not say "${secondsPhrase}". ` +
            `Code (${rel(TYPES_TS)}) sets the sweep to ${ms} ms = ${seconds} s. ` +
            'Update the "Every N seconds" prose to match.',
        });
      }
    }
  }
} catch (err) {
  violations.push({ where: rel(TYPES_TS), msg: `GC interval check errored: ${err.message}` });
}

// ─── Check 2: SDP codec allowlists ───────────────────────────────────

try {
  const sdpSrc = read(SDP_VALIDATOR_TS);
  const codeAudio = new Set(
    extractSetMembers(sdpSrc, "ALLOWED_AUDIO_CODECS").map((c) => c.toLowerCase()),
  );
  const codeVideo = new Set(
    extractSetMembers(sdpSrc, "ALLOWED_VIDEO_CODECS").map((c) => c.toLowerCase()),
  );

  // Each doc that enumerates the allowlist, with the literal markers
  // that bound its audio and video lists. The lists are compared as
  // SETS — the docs and code order their entries differently on purpose.
  const docTargets = [
    {
      path: TECHNICAL_OVERVIEW,
      section: "§14 (H-03 SDP validation layer)",
      anchorMarker: "per-section codec allowlist",
      audio: { start: "audio:", end: "; video:" },
      video: { start: "video:", end: "(see" },
    },
  ];

  for (const target of docTargets) {
    const text = read(target.path);
    const where = `${rel(target.path)} (${target.section})`;

    let docAudio;
    let docVideo;
    try {
      const anchor = text.indexOf(target.anchorMarker);
      if (anchor === -1) {
        throw new Error(`could not find allowlist anchor "${target.anchorMarker}"`);
      }
      docAudio = codecsInRegion(text, target.audio.start, target.audio.end, `${where} audio`, anchor);
      docVideo = codecsInRegion(text, target.video.start, target.video.end, `${where} video`, anchor);
    } catch (err) {
      violations.push({ where, msg: err.message });
      continue;
    }

    if (!setsEqual(codeAudio, docAudio)) {
      const { missingFromDoc, extraInDoc } = diffSets(codeAudio, docAudio);
      violations.push({
        where,
        msg:
          "audio codec allowlist disagrees with ALLOWED_AUDIO_CODECS in " +
          `${rel(SDP_VALIDATOR_TS)}.` +
          (missingFromDoc.length ? ` Missing from doc: ${missingFromDoc.join(", ")}.` : "") +
          (extraInDoc.length ? ` Listed in doc but not code: ${extraInDoc.join(", ")}.` : "") +
          ` Code set: {${[...codeAudio].sort().join(", ")}}.`,
      });
    }

    if (!setsEqual(codeVideo, docVideo)) {
      const { missingFromDoc, extraInDoc } = diffSets(codeVideo, docVideo);
      violations.push({
        where,
        msg:
          "video codec allowlist disagrees with ALLOWED_VIDEO_CODECS in " +
          `${rel(SDP_VALIDATOR_TS)}.` +
          (missingFromDoc.length ? ` Missing from doc: ${missingFromDoc.join(", ")}.` : "") +
          (extraInDoc.length ? ` Listed in doc but not code: ${extraInDoc.join(", ")}.` : "") +
          ` Code set: {${[...codeVideo].sort().join(", ")}}.`,
      });
    }
  }
} catch (err) {
  violations.push({ where: rel(SDP_VALIDATOR_TS), msg: `codec allowlist check errored: ${err.message}` });
}

// ─── Report ──────────────────────────────────────────────────────────

if (violations.length > 0) {
  console.error(`doc-code-drift check failed: ${violations.length} violation(s).\n`);
  for (const v of violations) {
    console.error(`  ${v.where}`);
    console.error(`    ${v.msg}\n`);
  }
  console.error(
    "A pinned prose value in the long-form docs no longer matches the code\n" +
      "constant it describes. Update the doc line(s) named above so the prose\n" +
      "matches the code (or, if the code value is wrong, fix the code). This\n" +
      "guard mirrors check-signaling-envelope.mjs and exists to stop the\n" +
      "doc-vs-code drift fixed in Task #867 from silently recurring.",
  );
  process.exit(1);
}

console.log(
  "doc-code-drift check passed: GC_INTERVAL_MS prose and the audio/video " +
    "SDP codec allowlists match the code in all pinned doc locations.",
);
