#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-publish-doc-hygiene.mjs
 *
 * Publish-hazard guard for the shippable docs surface.
 *
 * Task #969 fixed two leftover publish hazards that had slipped into the
 * published-by-design audit `docs/security-audit-public-2026-04.md`:
 *
 *   1. the OLD organization slug `Void-PWA` (canonical is `DotMatrixIO/void`), and
 *   2. an internal-only planning path reference (`.local/tasks/...`, i.e. any
 *      `.local/` path — the gitignored agent/operator scratch tree that never
 *      ships).
 *
 * These are exactly the publish hazards catalogued in
 * `docs/pre-publish-scrub-2026-06.md` §1.5 (residual `Void-PWA`) and §2/§4
 * (internal `.local/` references and the grep backstop). Until now they were
 * caught only by a MANUAL grep over the candidate publish tree at snapshot
 * time. This script converts that manual grep into a structural CI guard so
 * the same class of leak cannot silently reappear in any shippable doc.
 *
 * ── Scanned surface (the "shippable docs") ────────────────────────────────
 *
 * The set of docs that ship is decided by which docs are LEFT in the candidate
 * tree when the snapshot is taken (pre-publish-scrub §2). We mirror that here:
 * every Markdown file under `docs/` ships EXCEPT:
 *
 *   - the explicitly PRIVATE docs from the §2 SHIP/PRIVATE table. These are
 *     removed from the candidate tree before the snapshot (§3), so they never
 *     reach the public. By the in-tree dated-doc convention they legitimately
 *     RETAIN their dated `Void-PWA` / `.local/` references and must NOT be
 *     flagged here (that is the whole point of carving them out).
 *
 *   - `docs/_private/` — gitignored, never tracked, never ships.
 *
 *   - hazard-procedure / audit-ledger docs that exist precisely to DESCRIBE
 *     these hazards and therefore name the forbidden strings by design. This
 *     mirrors the audit-ledger carve-out already used by
 *     check-banned-phrases.mjs ("Audit ledgers under docs/ are intentionally
 *     out of scope … they exist to record wording shifts and would otherwise
 *     need allow markers on every quoted phrase"). `pre-publish-scrub-2026-06.md`
 *     is exactly such a doc: it SHIPS (§2), but it quotes `Void-PWA` and
 *     `.local/tasks` repeatedly as the very hazards it teaches the operator to
 *     remove. Flagging it would be flagging the rulebook for stating the rule.
 *
 * Everything else under `docs/` — including the SHIP audit copies, the public
 * threat models, the operator runbooks, the engineering-reference docs, and the
 * READ-INDIVIDUALLY sub-trees (`docs/_fragments`, `docs/research`,
 * `docs/agent-mode`, `docs/security`) — is scanned.
 *
 * ── Forbidden strings ─────────────────────────────────────────────────────
 *
 *   - `Void-PWA`  — the old org slug. Canonical identity is `DotMatrixIO/void`.
 *   - `.local/`   — any reference to the internal `.local/` scratch tree
 *                   (`.local/tasks/...`, etc). This is gitignored planning
 *                   material that is not part of the public project.
 *   - grant-application names (`opensats`, `nlnet`, `geyser`, `hrf`) — the
 *                   second backstop catalogued in pre-publish-scrub §4.2. No
 *                   grant-application drafts exist in the tree today, but one
 *                   added later would otherwise be caught only by the human
 *                   read; this guard converts that manual grep into CI.
 *
 * The check fails loudly (non-zero exit) listing each offending file + line +
 * the matched string, and passes on the current clean tree.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:publish-doc-hygiene
 *
 * Wired into CI as the `publish-doc-hygiene` validation workflow in .replit.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DOCS_DIR = resolve(REPO_ROOT, "docs");

// PRIVATE docs from the pre-publish-scrub §2 SHIP/PRIVATE table. These are
// pulled from the candidate tree before the snapshot, so they never ship and
// legitimately retain their dated Void-PWA / .local references. Paths are
// relative to docs/.
const PRIVATE_DOCS = new Set([
  "security-audit-internal-2026-04.md",
  "manifest-review-2026-05.md",
  "manifest-review-2026-06.md",
]);

// Hazard-procedure / audit-ledger docs that SHIP but exist to DESCRIBE these
// hazards and therefore quote the forbidden strings by design (mirrors the
// audit-ledger carve-out in check-banned-phrases.mjs). Paths relative to docs/.
const HAZARD_LEDGER_DOCS = new Set([
  "pre-publish-scrub-2026-06.md",
]);

// Sub-trees that never ship and never need scanning. Relative to docs/.
const SKIP_DIRS = new Set(["_private"]);

// Forbidden patterns. `label` is what we print; `re` is matched per line.
const FORBIDDEN = [
  {
    label: "Void-PWA (old org slug — canonical is DotMatrixIO/void)",
    re: /Void-PWA/i,
  },
  {
    label: ".local/ (internal-only scratch/planning path — never ships)",
    re: /\.local\//,
  },
  {
    label:
      "grant-application name (pre-publish-scrub §4.2 — no grant drafts ship)",
    re: /\b(opensats|nlnet|geyser|hrf)\b/i,
  },
];

/** Recursively collect every *.md file under `dir`. */
function collectMarkdown(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(DOCS_DIR, abs);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(rel.split(sep)[0])) continue;
      out.push(...collectMarkdown(abs));
    } else if (entry.endsWith(".md")) {
      out.push(abs);
    }
  }
  return out;
}

const allDocs = collectMarkdown(DOCS_DIR);

const scanned = [];
const skipped = [];

for (const abs of allDocs) {
  const relToDocs = relative(DOCS_DIR, abs).split(sep).join("/");
  if (PRIVATE_DOCS.has(relToDocs)) {
    skipped.push({ file: abs, why: "PRIVATE (does not ship — §2 table)" });
    continue;
  }
  if (HAZARD_LEDGER_DOCS.has(relToDocs)) {
    skipped.push({
      file: abs,
      why: "hazard-procedure ledger (describes the hazards by design)",
    });
    continue;
  }
  scanned.push(abs);
}

const violations = [];

for (const abs of scanned) {
  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const { label, re } of FORBIDDEN) {
      const m = line.match(re);
      if (m) {
        violations.push({
          file: abs,
          line: i + 1,
          match: m[0],
          label,
          context: line.trim(),
        });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `[check-publish-doc-hygiene] FAILED — ${violations.length} publish hazard(s) found in shippable docs:\n`,
  );
  for (const v of violations) {
    const rel = relative(REPO_ROOT, v.file);
    console.error(`  ${rel}:${v.line}`);
    console.error(`    forbidden: ${v.label}`);
    console.error(`    matched:   ${JSON.stringify(v.match)}`);
    console.error(`    line:      ${v.context}`);
    console.error("");
  }
  console.error(
    "These strings are publish hazards (pre-publish-scrub-2026-06.md §1.5 / §2 / §4):",
  );
  console.error(
    "  - `Void-PWA` is the OLD org slug; the canonical identity is `DotMatrixIO/void`.",
  );
  console.error(
    "  - `.local/` references point at internal scratch/planning material that never ships.",
  );
  console.error(
    "  - grant-application names (`opensats`, `nlnet`, `geyser`, `hrf`) must never ship (§4.2).",
  );
  console.error("");
  console.error(
    "Fix: repoint the reference to its public equivalent (or strike the sentence).",
  );
  console.error(
    "If the doc legitimately describes the hazard (a scrub/audit ledger) or must",
  );
  console.error(
    "not ship (a PRIVATE doc per §2), add it to HAZARD_LEDGER_DOCS / PRIVATE_DOCS",
  );
  console.error("in this script in the same commit, with a one-line reason.");
  process.exit(1);
}

console.log(
  `[check-publish-doc-hygiene] OK — scanned ${scanned.length} shippable doc(s) under docs/ ` +
    `for \`Void-PWA\`, \`.local/\`, and grant-application names ` +
    `(\`opensats\`, \`nlnet\`, \`geyser\`, \`hrf\`); none found. ` +
    `(${skipped.length} doc(s) carved out: ${PRIVATE_DOCS.size} PRIVATE, ${HAZARD_LEDGER_DOCS.size} hazard-ledger.)`,
);
process.exit(0);
