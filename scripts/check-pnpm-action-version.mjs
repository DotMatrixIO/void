// SPDX-License-Identifier: AGPL-3.0-or-later
//
// pnpm/action-setup version-pin regression guard.
//
// The single source of truth for which pnpm a workflow uses is the root
// `package.json` `packageManager` field (e.g. "pnpm@10.26.1"). When a GitHub
// Actions workflow's `pnpm/action-setup` step ALSO declares a `version:` input,
// the two can disagree. action-setup then aborts the job with:
//
//   "Multiple versions of pnpm specified"   /   ERR_PNPM_BAD_PM_VERSION
//
// This already broke nine workflows once. The failure only surfaces when the
// job actually runs — and several of these workflows are scheduled — so a
// conflicting `version:` can sit dormant for a long time before it bites.
//
// This guard makes the rule a one-way door: NO `pnpm/action-setup` step may
// declare a `version:` input. The version must come from `packageManager`.
//
// Run via: pnpm --filter @workspace/scripts run check:pnpm-action-version

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");

// ─── Indentation helper ───────────────────────────────────────────────────────
// Count leading spaces. Tabs are not valid YAML indentation, but if present we
// treat each tab as one column so a tab-indented `version:` still gets flagged.
function indentOf(line) {
  let n = 0;
  for (const ch of line) {
    if (ch === " " || ch === "\t") n++;
    else break;
  }
  return n;
}

// Strip a trailing `# comment` that is not inside quotes. Good enough for the
// simple scalar lines we inspect here (uses:/with:/version:).
function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble) {
      // A '#' only starts a comment when preceded by whitespace or at start.
      if (i === 0 || line[i - 1] === " " || line[i - 1] === "\t") {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

// ─── Locate the canonical pnpm version (for the error message only) ──────────
function packageManagerPnpm() {
  try {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8")
    );
    return typeof pkg.packageManager === "string" ? pkg.packageManager : null;
  } catch {
    return null;
  }
}

// ─── Scan a single workflow file ──────────────────────────────────────────────
// For every `uses: pnpm/action-setup@...` step, find its sibling `with:` block
// and flag any `version:` key declared inside it.
function scanWorkflow(relPath, text) {
  const violations = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = stripInlineComment(raw);
    const trimmed = code.trim();

    // Match the step key `uses: pnpm/action-setup@...`. The leading `- ` of a
    // list item is allowed (e.g. "- uses: pnpm/action-setup@v4").
    const usesMatch = trimmed.match(/^-?\s*uses:\s*pnpm\/action-setup(@\S+)?\s*$/);
    if (!usesMatch) continue;

    // Indentation of the step's keys. For "- uses:" the keys logically sit at
    // the column of `uses`, so measure from the first non-(`-`/space) token.
    const usesKeyCol = code.indexOf("uses:");
    const stepKeyIndent = usesKeyCol === -1 ? indentOf(raw) : usesKeyCol;

    // Walk forward to find this step's `with:` block, then scan inside it.
    let j = i + 1;
    let inWith = false;
    let withKeyIndent = -1;

    for (; j < lines.length; j++) {
      const lraw = lines[j];
      if (lraw.trim() === "") continue; // blank lines don't end a block
      const lcode = stripInlineComment(lraw);
      const lindent = indentOf(lcode);
      const ltrim = lcode.trim();

      if (!inWith) {
        // We are still scanning the step's own keys (with:/name:/env:/id: ...).
        // A line at or below the step-key indent means we've left this step.
        if (lindent <= stepKeyIndent) {
          // Could be the next `with:`-less step or a new step `- ...`.
          // Either way, this pnpm step has no `with:` block -> done.
          if (ltrim.startsWith("with:")) {
            inWith = true;
            withKeyIndent = lindent;
            continue;
          }
          break;
        }
        // A `with:` key indented under the step.
        if (ltrim === "with:" || ltrim.startsWith("with:")) {
          inWith = true;
          withKeyIndent = lindent;
          continue;
        }
        // Some other step-level key (name/env/id/etc.) — keep scanning.
        continue;
      }

      // Inside the `with:` block: keys are indented deeper than `with:`.
      if (lindent <= withKeyIndent) {
        // Block (and step) ended.
        break;
      }
      const keyMatch = ltrim.match(/^([A-Za-z0-9_-]+)\s*:/);
      if (keyMatch && keyMatch[1] === "version") {
        violations.push({
          file: relPath,
          line: j + 1,
          text: ltrim,
        });
      }
    }
  }

  return violations;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
if (!existsSync(WORKFLOWS_DIR)) {
  console.log(
    `pnpm-action-version guard skipped: ${WORKFLOWS_DIR} does not exist.`
  );
  process.exit(0);
}

const files = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

let scanned = 0;
const allViolations = [];

for (const f of files) {
  const abs = join(WORKFLOWS_DIR, f);
  let text;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue;
  }
  scanned++;
  allViolations.push(...scanWorkflow(join(".github", "workflows", f), text));
}

const pm = packageManagerPnpm() ?? "pnpm@<version> (missing from package.json!)";

if (allViolations.length > 0) {
  console.error(
    `pnpm-action-version guard FAILED: ${allViolations.length} ` +
      `forbidden version: input(s) in pnpm/action-setup step(s).\n`
  );
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(`
A pnpm/action-setup step must NOT declare a "version:" input. When it does,
the pinned version can disagree with the root package.json "packageManager"
field, and the job aborts with "Multiple versions of pnpm specified" /
ERR_PNPM_BAD_PM_VERSION. Because some of these workflows run on a schedule,
the break can stay hidden until the job next fires.

The single source of truth for the pnpm version is:

    package.json -> "packageManager": "${pm}"

To resolve: delete the "version:" line(s) above. pnpm/action-setup@v4 reads
the version from "packageManager" automatically.
`);
  process.exit(1);
}

console.log(
  `pnpm-action-version guard passed: scanned ${scanned} workflow file(s); ` +
    `no pnpm/action-setup step declares a "version:" input. ` +
    `pnpm version is sourced from package.json "packageManager" (${pm}).`
);
