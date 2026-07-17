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
// Rule: replit.md's ## section headings must match the allowlist below.
// Other docs and agents rely on these sections existing under stable names
// (e.g. "Hard rules — never do"); someone could stay under the line ceiling
// while deleting or renaming a load-bearing section. Headings are matched by
// prefix so descriptive suffixes ("API Spec — source of truth + codegen …")
// can evolve without breaking the guard.
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

let failed = false;

if (lineCount > MAX_LINES) {
  console.error(
    `FAIL: replit.md is ${lineCount} lines (ceiling: ${MAX_LINES}).\n\n` +
      `replit.md is a compact index; when it grows too large it gets silently\n` +
      `truncated in agent context and becomes useless. Move deep detail to:\n` +
      `  - docs/replit-md-archive.md   (project detail relocated from replit.md)\n` +
      `  - VOID_TECHNICAL_OVERVIEW.md  (canonical technical architecture)\n` +
      `and leave at most a one-line pointer in replit.md.`,
  );
  failed = true;
}

// Heading structure guard. Each entry is a prefix: a "## <heading>" line
// matches an entry when the heading text starts with that prefix (so
// descriptive suffixes like "— source of truth + codegen" can change freely).
const REQUIRED_HEADING_PREFIXES = [
  "Overview",
  "User preferences",
  "Project structure",
  "Stack",
  "Artifacts",
  "Key Commands",
  "API Spec",
  "Hard rules",
  "Visual Design",
  "Where the detail lives",
];

// Ignore fenced code blocks so example markdown inside ``` fences can't
// masquerade as real section headings.
const headings = [];
let inFence = false;
for (const line of content.split("\n")) {
  if (/^\s*(```|~~~)/.test(line)) {
    inFence = !inFence;
    continue;
  }
  if (!inFence && /^## /.test(line)) {
    headings.push(line.slice(3).trim());
  }
}

const matchedPrefixes = new Set();
const unexpected = [];
for (const heading of headings) {
  const prefix = REQUIRED_HEADING_PREFIXES.find((p) => heading.startsWith(p));
  if (prefix) {
    matchedPrefixes.add(prefix);
  } else {
    unexpected.push(heading);
  }
}
const missing = REQUIRED_HEADING_PREFIXES.filter((p) => !matchedPrefixes.has(p));

if (missing.length > 0 || unexpected.length > 0) {
  const lines = [
    `FAIL: replit.md's ## section headings drifted from the allowlist.`,
    ``,
  ];
  for (const p of missing) {
    lines.push(`  MISSING:    "## ${p}" (or a heading starting with "${p}")`);
  }
  for (const h of unexpected) {
    lines.push(`  UNEXPECTED: "## ${h}"`);
  }
  lines.push(
    ``,
    `replit.md is a compact index with a fixed section skeleton; other docs`,
    `and agents rely on these sections existing under stable names.`,
    `  - Do not delete or rename allowlisted sections. If a section is empty,`,
    `    leave the heading with a one-line pointer.`,
    `  - New deep detail does not get a new section here. Put it in`,
    `    docs/replit-md-archive.md or VOID_TECHNICAL_OVERVIEW.md and link it`,
    `    from "## Where the detail lives".`,
    `  - If the skeleton genuinely must change, update`,
    `    REQUIRED_HEADING_PREFIXES in scripts/check-replit-md-size.mjs in the`,
    `    same change and say why.`,
  );
  console.error(lines.join("\n"));
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `OK: replit.md is ${lineCount} lines (ceiling: ${MAX_LINES}); ` +
    `all ${REQUIRED_HEADING_PREFIXES.length} allowlisted sections present, no unexpected headings.`,
);
