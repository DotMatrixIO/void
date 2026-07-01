// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Task #172 / #192 — static guard for M-03.
//
// Task #172 converted every URL transition in client code that runs while a
// room is active from `pushState` to `replaceState` so the room phrase never
// gets a history entry of its own. This test reads the source files that
// participate in that flow and asserts they contain ZERO `pushState` calls
// in non-comment code, so a future refactor that re-introduces one fails
// here long before the leak ships. Comments are stripped first so the
// explanatory comments left behind by task #172 don't trip the check.
//
// If a new file legitimately needs pushState (e.g. a marketing page that is
// guaranteed to never render while a room is active), keep it OUT of the
// FILES list below and add a code comment explaining the reasoning.

const __dirname_local = dirname(fileURLToPath(import.meta.url));

function stripJsComments(src: string): string {
  // Tiny state machine that strips // line comments and /* */ block comments
  // while leaving string and template literals intact. Keeping strings means
  // a `pushState(` literal hidden inside a string would also be flagged,
  // which is the conservative thing to do — there is no legitimate reason
  // for the literal to appear in these files even as data.
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inBlock = false;
  let inLine = false;
  while (i < src.length) {
    const ch = src[i];
    const nx = src[i + 1] ?? "";
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && nx === "/") {
        inBlock = false;
        i += 2;
      } else {
        if (ch === "\n") out += ch;
        i++;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "\\") {
        out += ch + nx;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      out += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        out += ch + nx;
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      out += ch;
      i++;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") {
        out += ch + nx;
        i += 2;
        continue;
      }
      if (ch === "`") inTemplate = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && nx === "/") {
      inLine = true;
      i += 2;
      continue;
    }
    if (ch === "/" && nx === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "`") {
      inTemplate = true;
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

describe("history.pushState ban for room-active code paths (M-03 — task #172)", () => {
  // The set of files whose URL transitions can run while the room phrase is
  // resident in app state. App.tsx owns every leave-handler convergence
  // point; RoomPage.tsx owns every fan-in to that handler. These are the
  // exact files task #172 audited.
  const FILES = ["App.tsx", "pages/RoomPage.tsx"];

  for (const rel of FILES) {
    it(`${rel} contains zero history.pushState calls in non-comment code`, () => {
      const src = readFileSync(resolve(__dirname_local, rel), "utf8");
      const codeOnly = stripJsComments(src);
      const matches = codeOnly.match(/\bpushState\s*\(/g) ?? [];
      expect(
        matches,
        `${rel} must not call pushState (found ${matches.length} occurrences). ` +
          `Use replaceState instead so the phrase never gets a history entry. ` +
          `See task #172 / docs/security-audit-public-2026-04.md (M-03).`,
      ).toEqual([]);
    });
  }
});
