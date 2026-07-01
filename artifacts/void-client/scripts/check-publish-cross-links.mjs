#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-publish-cross-links.mjs
 *
 * The OTHER half of the publish-safety story (sibling to
 * check-publish-doc-hygiene.mjs).
 *
 * `docs/pre-publish-scrub-2026-06.md` §2 ("Docs-that-ship review") deletes a
 * set of PRIVATE docs from the candidate tree before the snapshot is taken.
 * Its "Cross-link hazard" note (§2, just under the SHIP/PRIVATE table) warns:
 *
 *   > Deleting the target without repointing the reference leaves a dangling
 *   > link in a shipping doc and may break a test.
 *
 * The sibling guard (check-publish-doc-hygiene.mjs) catches the FORBIDDEN
 * STRINGS (`Void-PWA`, `.local/`) that must never appear in a shippable doc.
 * This guard catches the COMPLEMENTARY hazard: a shippable doc or source file
 * that *points at* one of the never-ship PRIVATE docs (or at `docs/_private/`).
 * When that PRIVATE doc is pulled at snapshot time, every such pointer becomes
 * a dangling reference in the public tree. Today that is caught only by the
 * manual human read (§4.4); this converts it into a structural CI guard.
 *
 * ── What counts as a "never-ship" target ──────────────────────────────────
 *
 * The PRIVATE docs from the §2 SHIP/PRIVATE table (same list as
 * check-publish-doc-hygiene.mjs PRIVATE_DOCS), plus the gitignored
 * `docs/_private/` holding area they are moved into:
 *
 *   - docs/security-audit-internal-2026-04.md
 *   - docs/manifest-review-2026-05.md
 *   - docs/manifest-review-2026-06.md
 *   - docs/_private/ (and anything under it)
 *
 * PLUS a ZERO-TOLERANCE target with NO allowlist:
 *
 *   - .agents/ (and `.agents/memory/`) — agent memory. Unlike the PRIVATE docs
 *     (whose references are temporarily inventoried in ALLOWLIST pending a
 *     repoint to a public equivalent), agent memory has no public form EVER.
 *     `.agents/` is removed from the candidate tree at snapshot time
 *     (pre-publish-scrub §1.6 / §3 step 2), so ANY inbound reference from a
 *     shipping file is always a real dangling hazard — never something to
 *     inventory. It is matched as a bare substring on any line (comments,
 *     help-strings, JSON, plain prose), not only inside markdown/link syntax,
 *     and has NO allowlist: the fix for a reference is always removal.
 *
 * ── Scanned surface ───────────────────────────────────────────────────────
 *
 * The whole tracked tree (`git ls-files`) — docs AND source — because a
 * dangling pointer in a source comment ships in the public source just as a
 * dangling Markdown link ships in the public docs. We exclude only what does
 * NOT reach the public tree, or what names these targets BY DESIGN:
 *
 *   - the never-ship targets themselves (they are deleted before the snapshot,
 *     so their cross-references to each other are moot);
 *   - files UNDER `.agents/` (agent memory — explicit NEVER-ship, §1.6 — does
 *     not ship, so its internal cross-references are moot; references INTO
 *     `.agents/` FROM the rest of the tree are caught as a zero-tolerance
 *     target, see above);
 *   - `docs/_private/` (gitignored; never tracked anyway);
 *   - `docs/pre-publish-scrub-2026-06.md` — the hazard-procedure ledger that
 *     SHIPS but quotes these very paths as the hazards it teaches the operator
 *     to remove (same audit-ledger carve-out used by check-banned-phrases.mjs);
 *   - this script and its sibling check-publish-doc-hygiene.mjs — they DEFINE
 *     the never-ship lists and so name the paths by design.
 *
 * ── Allowlist (the "known existing cross-links") ───────────────────────────
 *
 * pre-publish-scrub §2 is explicit that the existing cross-links are owned by
 * the hygiene / content tasks, NOT by this guard: "(a) those tasks repoint
 * internal-audit / manifest-review / marketing-claims links to their public
 * equivalents (or remove them); (b) only then are the PRIVATE docs pulled".
 * So this guard does not try to fix them — it INVENTORIES them. Every
 * (file -> target) pair below is a known cross-link that exists on the current
 * tree; the guard passes on those and FAILS on any NEW one. As each owning
 * task repoints/removes a reference, its allowlist entry goes stale and the
 * guard fails too (stale entries are reported), forcing the inventory to shrink
 * in lockstep so it can never silently drift back to permissive.
 *
 * The check fails loudly (non-zero exit) listing each offending file + line +
 * the never-ship target it points at, and passes on the current clean tree.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:publish-cross-links
 *
 * Wired into CI as the `publish-doc-crosslinks` validation workflow in .replit.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

// Never-ship targets. Each entry's `match` is searched for literally on every
// line of every scanned file. PRIVATE docs are matched by basename (the only
// stable, path-prefix-independent form references use, e.g.
// `docs/x.md`, `../x.md`, or a bare mention). `docs/_private` is matched as a
// path fragment. Keep this in lockstep with check-publish-doc-hygiene.mjs.
const NEVER_SHIP_TARGETS = [
  "security-audit-internal-2026-04.md",
  "manifest-review-2026-05.md",
  "manifest-review-2026-06.md",
  "docs/_private",
];

// Files that legitimately name the never-ship targets and must NOT be scanned:
// the targets themselves (deleted before snapshot), the hazard-procedure
// ledger, and the two guard scripts that DEFINE these lists. Paths relative to
// REPO_ROOT, POSIX separators.
const CARVE_OUT_FILES = new Set([
  "docs/security-audit-internal-2026-04.md",
  "docs/manifest-review-2026-05.md",
  "docs/manifest-review-2026-06.md",
  "docs/pre-publish-scrub-2026-06.md",
  "artifacts/void-client/scripts/check-publish-doc-hygiene.mjs",
  "artifacts/void-client/scripts/check-publish-cross-links.mjs",
  // `.gitignore` names `docs/_private/` BY DESIGN — that ignore rule is the
  // mechanism that keeps the private holding area out of the tracked tree.
  // It is not a dangling cross-link (gitignore tolerates a missing path).
  ".gitignore",
]);

// Directory prefixes whose CONTENTS are never scanned: they never reach the
// public tree, so their internal cross-references are moot. Relative to
// REPO_ROOT. Note: `.agents/` files are skipped here, but references INTO
// `.agents/` from the rest of the tree are caught as a zero-tolerance target
// (ZERO_TOLERANCE_TARGETS) below.
const CARVE_OUT_DIR_PREFIXES = [".agents/", "docs/_private/"];

// Zero-tolerance never-ship target(s) — matched as a bare substring on every
// line of every scanned file (comments, help-strings, JSON, plain prose), with
// NO allowlist. Unlike the PRIVATE docs (whose references are temporarily
// inventoried in ALLOWLIST pending a repoint to a public equivalent), agent
// memory has no public form EVER: `.agents/` is removed from the candidate tree
// at snapshot time (pre-publish-scrub §1.6 / §3 step 2), so ANY inbound
// reference from a shipping file is always a real dangling hazard, never
// something to inventory. The only files that may name the path — this guard
// and the scrub ledger — are already in CARVE_OUT_FILES and so are not scanned.
const ZERO_TOLERANCE_TARGETS = [".agents/"];

// ── Known existing cross-links (owned by the hygiene / content tasks) ───────
// Each entry is a (file -> target) pair that exists on the current tree.
// `target` is the matching value from NEVER_SHIP_TARGETS. `reason` records the
// owning hygiene area that will repoint/remove it before the PRIVATE doc is
// pulled (pre-publish-scrub §2 cross-link hazard, step (a)). The unit of hazard
// is the pair, not the line: once a file points at a target, deleting the
// target dangles that file regardless of how many lines do so.
const ALLOWLIST = [
  // Empty by design. Every shipping file that once cited a never-ship doc has
  // had that citation severed (rationale inlined) or repointed to a shipping
  // doc (README-selfhost.md / docs/security-audit-public-2026-04.md §11). The
  // last outbound citation — docs/marketing-claims-audit.md -> manifest-review-
  //   2026-05.md — was inlined when that ledger was finalized for publication,
  // so there are no live references left to inventory. The never-ship docs stay
  // in NEVER_SHIP_TARGETS so any future reintroduced reference is still caught.
];

const allowKey = (file, target) => `${file}::${target}`;
const allowSet = new Set(ALLOWLIST.map(([f, t]) => allowKey(f, t)));
const allowSeen = new Set();

/** Enumerate the tracked tree (what the snapshot ships). */
function listTrackedFiles() {
  const res = spawnSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error(
      "[check-publish-cross-links] FAILED — `git ls-files` did not run:\n" +
        (res.stderr || res.error?.message || "unknown error"),
    );
    process.exit(2);
  }
  return res.stdout.split("\0").filter(Boolean);
}

function isCarvedOut(rel) {
  if (CARVE_OUT_FILES.has(rel)) return true;
  return CARVE_OUT_DIR_PREFIXES.some((p) => rel.startsWith(p));
}

/** Cheap binary sniff so we never scan/print binary blobs. */
function looksBinary(abs) {
  try {
    const buf = readFileSync(abs);
    const n = Math.min(buf.length, 4096);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } catch {
    return false;
  }
}

const violations = [];
const zeroTolViolations = [];

for (const rel of listTrackedFiles()) {
  if (isCarvedOut(rel)) continue;
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs) || !statSync(abs).isFile()) continue;
  if (looksBinary(abs)) continue;

  const lines = readFileSync(abs, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const target of NEVER_SHIP_TARGETS) {
      if (!line.includes(target)) continue;
      const key = allowKey(rel, target);
      if (allowSet.has(key)) {
        allowSeen.add(key);
        continue;
      }
      violations.push({
        file: rel,
        line: i + 1,
        target,
        context: line.trim(),
      });
    }
    // Zero-tolerance targets — no allowlist, no inventory: any inbound
    // reference is always a real dangling hazard.
    for (const target of ZERO_TOLERANCE_TARGETS) {
      if (!line.includes(target)) continue;
      zeroTolViolations.push({
        file: rel,
        line: i + 1,
        target,
        context: line.trim(),
      });
    }
  });
}

const staleAllow = ALLOWLIST.filter(([f, t]) => !allowSeen.has(allowKey(f, t)));

let failed = false;

if (violations.length > 0) {
  failed = true;
  console.error(
    `[check-publish-cross-links] FAILED — ${violations.length} NEW cross-link(s) to never-ship docs:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    points at never-ship target: ${v.target}`);
    console.error(`    line: ${v.context}`);
    console.error("");
  }
  console.error(
    "These targets are deleted from the candidate tree before the public",
  );
  console.error(
    "snapshot (pre-publish-scrub-2026-06.md §2 SHIP/PRIVATE table). A shipping",
  );
  console.error(
    "file pointing at one of them leaves a DANGLING reference in the public tree.",
  );
  console.error("");
  console.error("Fix one of:");
  console.error(
    "  - repoint the reference to its public equivalent (e.g. the internal",
  );
  console.error(
    "    audit -> docs/security-audit-public-2026-04.md), or remove it; or",
  );
  console.error(
    "  - if this is a genuinely-owned known cross-link, add the (file, target)",
  );
  console.error(
    "    pair to ALLOWLIST in this script in the same commit, with a one-line",
  );
  console.error("    reason naming the owning hygiene/content task.");
  console.error("");
}

if (zeroTolViolations.length > 0) {
  failed = true;
  console.error(
    `[check-publish-cross-links] FAILED — ${zeroTolViolations.length} reference(s) into a ZERO-TOLERANCE never-ship target:\n`,
  );
  for (const v of zeroTolViolations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    points into zero-tolerance never-ship target: ${v.target}`);
    console.error(`    line: ${v.context}`);
    console.error("");
  }
  console.error(
    "`.agents/` (agent memory) is removed from the candidate tree before the",
  );
  console.error(
    "public snapshot (pre-publish-scrub-2026-06.md §1.6 / §3 step 2). It has NO",
  );
  console.error(
    "public form — ever — so there is NO allowlist: any shipping-tree reference",
  );
  console.error(
    "into it is always a real dangling hazard. The only fix is to REMOVE the",
  );
  console.error(
    "reference (genericize the wording so it does not name an `.agents/` path).",
  );
  console.error("");
}

if (staleAllow.length > 0) {
  failed = true;
  console.error(
    `[check-publish-cross-links] FAILED — ${staleAllow.length} stale ALLOWLIST entry(ies) (reference no longer present):\n`,
  );
  for (const [f, t] of staleAllow) {
    console.error(`  ${f}  ->  ${t}`);
  }
  console.error("");
  console.error(
    "A known cross-link was repointed/removed — good. Delete its (file, target)",
  );
  console.error(
    "pair from ALLOWLIST in this script so the inventory stays accurate and the",
  );
  console.error("guard can never silently drift back to permissive.");
  console.error("");
}

if (failed) process.exit(1);

console.log(
  `[check-publish-cross-links] OK — scanned the tracked tree for references to ` +
    `${NEVER_SHIP_TARGETS.length} never-ship target(s) and ` +
    `${ZERO_TOLERANCE_TARGETS.length} zero-tolerance target(s); ` +
    `${allowSeen.size} known cross-link(s) inventoried, no new ones found.`,
);
process.exit(0);
