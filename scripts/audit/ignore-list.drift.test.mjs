#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Drift test: scripts/audit/ignore-list.json vs the §R-0 / §R-N rows in
// docs/security-audit-public-2026-04.md.
//
// The two files are two prose-and-JSON copies of the same accepted-
// residual ledger. They agree today (both list the two path-to-regexp
// advisories that compose R-N1 with reEvalDate 2026-08-31), but nothing
// prevents drift: a future maintainer could push the ignore-list date
// out without updating §R-0, or close an §R-N row without removing the
// ignore entry. This test makes the drift fail CI rather than land
// silently.
//
// Assertions:
//
//   1. Every entry in ignore-list.json is mentioned by CVE somewhere in
//      docs/security-audit-public-2026-04.md (the audit's written
//      reachability rationale must exist for every suppressed advisory).
//
//   2. Every R-N row in the §R-0 summary table whose Status cell is not
//      "✓ CLOSED" has at least one corresponding ignore-list entry,
//      identified by an "R-N<n>" reference in the entry's `rationale`.
//      An R-N row may explicitly opt out by including the literal
//      string "no ignore-list entry — fail-build expected" anywhere in
//      the row (intended for findings whose policy is to block the
//      release rather than be suppressed).
//
//   3. For every ignore-list entry that claims to track an R-N row,
//      the entry's reEvalDate YYYY-MM matches the YYYY-MM extracted
//      from that row's Re-eval column. (The §R-0 column is month-
//      precision; the JSON is day-precision; matching is by month.)
//
// Exits 0 on success, 1 on any drift, 2 on parser failure.
//
// Run: node scripts/audit/ignore-list.drift.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");

const IGNORE_LIST_PATH = join(__dirname, "ignore-list.json");
const AUDIT_DOC_PATH = join(
  REPO_ROOT,
  "docs",
  "security-audit-public-2026-04.md",
);

const OPT_OUT_MARKER = "no ignore-list entry — fail-build expected";

let failures = 0;
function fail(msg) {
  process.stderr.write(`FAIL: ${msg}\n`);
  failures += 1;
}
function ok(msg) {
  process.stdout.write(`ok: ${msg}\n`);
}

function loadIgnoreList() {
  const raw = readFileSync(IGNORE_LIST_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries)) {
    process.stderr.write("ignore-list.json missing 'entries' array\n");
    process.exit(2);
  }
  return parsed.entries;
}

function loadAuditDoc() {
  return readFileSync(AUDIT_DOC_PATH, "utf8");
}

// Extract the §R-0 summary table's R-N rows. The §R-0 table is the
// first markdown table after "### R-0. Refreshed summary table" with
// the seven-column header "| ID | Sev | Status | ...".
function parseR0Table(doc) {
  const headingIdx = doc.indexOf("### R-0. Refreshed summary table");
  if (headingIdx < 0) {
    process.stderr.write("Could not find '### R-0. Refreshed summary table' heading\n");
    process.exit(2);
  }
  // Slice from the heading onwards to the next "### " heading so we
  // only see the §R-0 table itself.
  const after = doc.slice(headingIdx);
  const nextHeadingIdx = after.indexOf("\n### ", 1);
  const section = nextHeadingIdx >= 0 ? after.slice(0, nextHeadingIdx) : after;

  const lines = section.split("\n");
  const rows = [];
  let inTable = false;
  for (const line of lines) {
    if (!inTable) {
      if (/^\|\s*ID\s*\|\s*Sev\s*\|\s*Status\s*\|/.test(line)) {
        inTable = true;
      }
      continue;
    }
    // Skip the markdown header separator row.
    if (/^\|\s*-+/.test(line)) continue;
    if (!line.startsWith("|")) {
      // Table ended.
      break;
    }
    // Split on "|" but keep cell contents. The row begins and ends with
    // "|", so splitting yields empty strings at both ends.
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 7) continue;
    const [id, sev, status, regressionRisk, reEval, title, location] = cells;
    rows.push({ id, sev, status, regressionRisk, reEval, title, location, raw: line });
  }
  if (rows.length === 0) {
    process.stderr.write("Parsed §R-0 table contains zero rows\n");
    process.exit(2);
  }
  return rows;
}

function isClosed(statusCell) {
  // "✓ CLOSED", "✓ CLOSED (Task #241)", "✓ CLOSED (task #252)", etc.
  // Also tolerate plain "CLOSED" without the checkmark to keep the
  // matcher robust to a future doc edit.
  return /\bCLOSED\b/.test(statusCell);
}

function extractRNReferencesFromRationale(rationale) {
  // R-N references in ignore-list rationale — e.g. "R-N1", "R-N4".
  // Returns a Set of canonical IDs.
  const out = new Set();
  if (typeof rationale !== "string") return out;
  for (const m of rationale.matchAll(/\bR-N(\d+)\b/g)) {
    out.add(`R-N${m[1]}`);
  }
  return out;
}

function extractMonth(dateStr) {
  // Accepts "2026-08-31" → "2026-08", "2026-08" → "2026-08".
  if (typeof dateStr !== "string") return null;
  const m = dateStr.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function extractReEvalMonth(reEvalCell) {
  // The §R-0 Re-eval column is either:
  //   "n/a (CI/code)" / "n/a (code)"  → null (closed)
  //   "**2026-08** — triggers: …"     → "2026-08"
  //   "**2026-11** — triggers: …"     → "2026-11"
  // Match the first YYYY-MM (optionally with -DD) anywhere in the cell.
  if (!reEvalCell || /^n\/a\b/i.test(reEvalCell.replace(/\*/g, ""))) {
    return null;
  }
  return extractMonth(reEvalCell);
}

function main() {
  const ignoreEntries = loadIgnoreList();
  const doc = loadAuditDoc();
  const r0Rows = parseR0Table(doc);

  // ---- Assertion 1: every ignore-list CVE appears in the audit doc.
  for (const entry of ignoreEntries) {
    if (typeof entry.cve !== "string" || entry.cve.length === 0) {
      fail(`ignore-list entry missing 'cve' field: ${JSON.stringify(entry)}`);
      continue;
    }
    if (!doc.includes(entry.cve)) {
      fail(
        `ignore-list entry ${entry.cve} (${entry.package}) is not mentioned ` +
          `anywhere in docs/security-audit-public-2026-04.md — the audit ` +
          `prose rationale must exist for every suppressed advisory.`,
      );
    } else {
      ok(`audit doc mentions ignore-list CVE ${entry.cve}`);
    }
  }

  // ---- Assertion 2 + 3: every non-closed R-N row has either a tracker
  // ignore-list entry OR the explicit opt-out marker; for the matched
  // entries the reEvalDate month must equal the row's Re-eval month.
  const rnRows = r0Rows.filter((r) => /^R-N\d+$/.test(r.id));
  if (rnRows.length === 0) {
    fail("§R-0 table parsed but contained no R-N rows — parser likely off");
  }

  // Index ignore-list entries by the R-N IDs their rationale references.
  const entriesByRn = new Map(); // "R-N1" -> [entry, ...]
  for (const entry of ignoreEntries) {
    const refs = extractRNReferencesFromRationale(entry.rationale);
    for (const ref of refs) {
      if (!entriesByRn.has(ref)) entriesByRn.set(ref, []);
      entriesByRn.get(ref).push(entry);
    }
  }

  // Detect ignore-list entries whose rationale references R-N IDs that
  // don't appear in the §R-0 table at all (typo, deleted row, etc.).
  const knownRnIds = new Set(rnRows.map((r) => r.id));
  for (const [rnId, entries] of entriesByRn.entries()) {
    if (!knownRnIds.has(rnId)) {
      for (const entry of entries) {
        fail(
          `ignore-list entry ${entry.cve} (${entry.package}) references ` +
            `${rnId} in its rationale, but no row with that ID exists in ` +
            `the §R-0 table.`,
        );
      }
    }
  }

  for (const row of rnRows) {
    const closed = isClosed(row.status);
    const tracked = entriesByRn.get(row.id) || [];
    const optOut =
      row.title.includes(OPT_OUT_MARKER) ||
      row.raw.includes(OPT_OUT_MARKER);

    if (closed) {
      // Closed row should not have any active ignore-list entries
      // pointing at it — if it does, the suppression is now stale.
      if (tracked.length > 0) {
        fail(
          `§R-0 row ${row.id} is marked CLOSED but ignore-list still ` +
            `contains entries that claim to track it: ` +
            tracked.map((e) => `${e.cve} (${e.package})`).join(", ") +
            `. Remove the ignore-list entry, or reopen the row.`,
        );
      } else {
        ok(`${row.id} CLOSED with no stale ignore-list entries`);
      }
      continue;
    }

    // OPEN (or any non-closed status) row.
    if (tracked.length === 0) {
      if (optOut) {
        ok(
          `${row.id} OPEN with explicit "${OPT_OUT_MARKER}" annotation; ` +
            `no ignore-list entry required.`,
        );
      } else {
        fail(
          `§R-0 row ${row.id} (${row.status}) has no corresponding ` +
            `ignore-list entry. Either add an entry whose rationale ` +
            `references "${row.id}", or annotate the row with the ` +
            `literal string "${OPT_OUT_MARKER}" to declare that ` +
            `policy is to block the release rather than suppress.`,
        );
      }
      continue;
    }

    // Tracked AND row is open: the row's Re-eval month must agree
    // with each tracking entry's reEvalDate month.
    const rowMonth = extractReEvalMonth(row.reEval);
    if (!rowMonth) {
      fail(
        `§R-0 row ${row.id} has tracking ignore-list entries but its ` +
          `Re-eval column does not parse as a YYYY-MM date: ` +
          JSON.stringify(row.reEval),
      );
      continue;
    }
    for (const entry of tracked) {
      const entryMonth = extractMonth(entry.reEvalDate);
      if (!entryMonth) {
        fail(
          `ignore-list entry ${entry.cve} (${entry.package}) has a ` +
            `reEvalDate that does not parse as YYYY-MM-DD: ` +
            JSON.stringify(entry.reEvalDate),
        );
        continue;
      }
      if (entryMonth !== rowMonth) {
        fail(
          `Re-eval drift on ${row.id}: §R-0 row says ${rowMonth} but ` +
            `ignore-list entry ${entry.cve} (${entry.package}) says ` +
            `${entry.reEvalDate} (${entryMonth}). Push both forward ` +
            `together or pull both back together.`,
        );
      } else {
        ok(
          `${row.id} Re-eval month matches: §R-0=${rowMonth}, ` +
            `ignore-list ${entry.cve}=${entry.reEvalDate}`,
        );
      }
    }
  }

  if (failures > 0) {
    process.stderr.write(
      `\n${failures} drift assertion(s) failed. ` +
        `ignore-list.json and the audit doc's §R-0 / §R-N table are out ` +
        `of sync — see messages above.\n`,
    );
    process.exit(1);
  }
  process.stdout.write("\nignore-list ↔ audit doc: no drift detected.\n");
  process.exit(0);
}

main();
