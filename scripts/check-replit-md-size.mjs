// SPDX-License-Identifier: AGPL-3.0-or-later
//
// replit.md size guard.
//
// replit.md once grew to 334 lines (~11k tokens) and was silently truncated
// in agent context, making the tail of the file invisible. It was trimmed to
// a ~63-line compact index, with deep detail relocated to
// docs/replit-md-archive.md. Nothing structural prevents it from re-inflating,
// so this guard fails loudly before the file becomes useless again.
//
// Rule: replit.md must stay at or under MAX_LINES lines. New deep detail
// belongs in docs/replit-md-archive.md or VOID_TECHNICAL_OVERVIEW.md, with a
// one-line pointer from replit.md if needed.
//
// Run via: pnpm --filter @workspace/scripts run check:replit-md-size

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = join(REPO_ROOT, "replit.md");

// Ceiling chosen with ~2x headroom over the current compact index (~63 lines)
// while staying far below the size at which agent context truncated the file.
const MAX_LINES = 120;

const content = readFileSync(TARGET, "utf8");
// Count lines the way editors do: a trailing newline does not add a line.
const lineCount = content.length === 0 ? 0 : content.replace(/\n$/, "").split("\n").length;

if (lineCount > MAX_LINES) {
  console.error(
    `FAIL: replit.md is ${lineCount} lines (ceiling: ${MAX_LINES}).\n\n` +
      `replit.md is a compact index; when it grows too large it gets silently\n` +
      `truncated in agent context and becomes useless. Move deep detail to:\n` +
      `  - docs/replit-md-archive.md   (project detail relocated from replit.md)\n` +
      `  - VOID_TECHNICAL_OVERVIEW.md  (canonical technical architecture)\n` +
      `and leave at most a one-line pointer in replit.md.`,
  );
  process.exit(1);
}

console.log(`OK: replit.md is ${lineCount} lines (ceiling: ${MAX_LINES}).`);
