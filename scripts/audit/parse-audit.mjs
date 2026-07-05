#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Release-time pnpm audit parser.
//
// Reads `pnpm audit --json` output on stdin, cross-references the ignore
// list at scripts/audit/ignore-list.json, and emits:
//
//   * a human-readable summary on stderr
//   * a machine-readable JSON report on stdout (when --json is passed)
//   * an exit code:
//       0  no actionable findings
//       1  one or more High/Critical advisories not on the ignore list,
//          OR one or more ignore-list entries past their re-eval date
//       2  parser/usage error
//
// Pinned to the pnpm audit JSON shape produced by pnpm 9.x and 10.x
// ("advisories" keyed by numeric id, with severity/module_name/cves/
// vulnerable_versions/findings[].paths). If a future pnpm major changes
// the shape, the SHAPE_VERSION check at the bottom of detectShape()
// surfaces a loud parser failure rather than a silent miss.
//
// Usage:
//   pnpm audit --json | node scripts/audit/parse-audit.mjs [--mode=fail|report] [--json]
//
//   --mode=fail    (default) exit non-zero on any actionable finding
//   --mode=report  always exit 0; intended for the daily scheduled path
//                  where the workflow opens/updates issues instead of
//                  failing the run
//   --json         also emit the machine-readable report on stdout
//
// See docs/security-audit-public-2026-04.md §11 limitation 4 and
// §R-9.11 for the policy this enforces.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ACTIONABLE_SEVERITIES = new Set(["high", "critical"]);

function parseArgs(argv) {
  const out = { mode: "fail", json: false };
  for (const arg of argv) {
    if (arg === "--json") out.json = true;
    else if (arg.startsWith("--mode=")) out.mode = arg.slice("--mode=".length);
    else if (arg === "--help" || arg === "-h") {
      process.stderr.write(
        "Usage: pnpm audit --json | node scripts/audit/parse-audit.mjs " +
          "[--mode=fail|report] [--json]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  if (out.mode !== "fail" && out.mode !== "report") {
    process.stderr.write(`Invalid --mode: ${out.mode}\n`);
    process.exit(2);
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function loadIgnoreList() {
  const path = join(__dirname, "ignore-list.json");
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.entries)) {
    throw new Error("ignore-list.json is missing the 'entries' array");
  }
  return parsed.entries;
}

function detectShape(audit) {
  // pnpm 9.x and 10.x both emit { advisories: { <id>: { ... } }, ... }.
  // pnpm 8.x emitted a flat array under .advisories. Reject the older
  // shape loudly so a CI runner that drifts off the pinned version does
  // not silently pass.
  if (audit && typeof audit === "object" && "error" in audit) {
    throw new Error(`pnpm audit reported an error: ${JSON.stringify(audit.error)}`);
  }
  if (!audit || typeof audit !== "object") {
    throw new Error("pnpm audit output is not an object");
  }
  if (audit.advisories === undefined) {
    // Empty / clean lockfile: pnpm still emits the key, but be defensive.
    return { advisories: {} };
  }
  if (Array.isArray(audit.advisories)) {
    throw new Error(
      "pnpm audit output uses the legacy array shape (pnpm <= 8). " +
        "Pin the workflow to pnpm 9.x or 10.x.",
    );
  }
  if (typeof audit.advisories !== "object") {
    throw new Error("pnpm audit .advisories is neither an object nor an array");
  }
  return { advisories: audit.advisories };
}

function flattenAdvisories(advisoryMap) {
  // One pnpm-audit advisory can have multiple findings (different
  // installed versions of the same package). Emit one record per
  // (advisory + finding-version + path) so the ignore-list matcher can
  // operate on the same triple shape it stores.
  const out = [];
  for (const [id, adv] of Object.entries(advisoryMap)) {
    const cves = Array.isArray(adv.cves) && adv.cves.length > 0 ? adv.cves : [null];
    const findings = Array.isArray(adv.findings) ? adv.findings : [];
    for (const finding of findings) {
      const paths = Array.isArray(finding.paths) ? finding.paths : [null];
      for (const path of paths) {
        for (const cve of cves) {
          out.push({
            advisoryId: Number(id),
            cve,
            severity: (adv.severity || "unknown").toLowerCase(),
            package: adv.module_name,
            installedVersion: finding.version,
            vulnerableVersions: adv.vulnerable_versions,
            patchedVersions: adv.patched_versions,
            depPath: path,
            title: adv.title,
            url: adv.url,
          });
        }
      }
    }
  }
  return out;
}

function matchIgnoreEntry(record, entries) {
  // Match on (cve + package + vulnerableVersions + depPath). depPath is
  // load-bearing: the same CVE arriving via a different transitive
  // chain may have a different reachability story than the one the
  // ignore-list rationale was written against, so it should be surfaced
  // for fresh review rather than silently suppressed. An entry may use
  // the literal "*" sentinel for depPath to opt into path-insensitive
  // suppression when the rationale genuinely covers every reachable
  // path; this requires an explicit author decision rather than being
  // the default.
  for (const entry of entries) {
    if (
      entry.cve === record.cve &&
      entry.package === record.package &&
      entry.vulnerableVersions === record.vulnerableVersions &&
      (entry.depPath === "*" || entry.depPath === record.depPath)
    ) {
      return entry;
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  return readStdin()
    .then((raw) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        // pnpm audit prints nothing when the lockfile is clean AND the
        // exit code is 0. Treat as no findings.
        return {};
      }
      try {
        return JSON.parse(trimmed);
      } catch (err) {
        process.stderr.write(`Failed to parse pnpm audit JSON: ${err.message}\n`);
        process.stderr.write(`First 200 bytes: ${trimmed.slice(0, 200)}\n`);
        process.exit(2);
      }
    })
    .then((audit) => {
      const { advisories } = detectShape(audit);
      const records = flattenAdvisories(advisories);
      const ignoreEntries = loadIgnoreList();
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const surface = []; // findings to surface (block release / open issue)
      const ignoredCurrent = []; // findings ignored, re-eval date in the future
      const ignoredExpired = []; // findings ignored, re-eval date in the past
      const lowOrModerateUnignored = []; // visible-but-not-blocking

      for (const r of records) {
        const ignore = matchIgnoreEntry(r, ignoreEntries);
        if (ignore) {
          const reEval = new Date(ignore.reEvalDate);
          if (Number.isNaN(reEval.getTime())) {
            surface.push({
              ...r,
              reason: `ignore-list entry has invalid reEvalDate: ${ignore.reEvalDate}`,
            });
            continue;
          }
          if (reEval < today) {
            ignoredExpired.push({ ...r, ignore });
          } else {
            ignoredCurrent.push({ ...r, ignore });
          }
        } else if (ACTIONABLE_SEVERITIES.has(r.severity)) {
          surface.push({ ...r, reason: "new high/critical advisory not on ignore list" });
        } else {
          lowOrModerateUnignored.push(r);
        }
      }

      // Surface any ignore-list entry whose re-eval date is in the past
      // even when no live finding currently matches it (the dep may have
      // been bumped — the entry should be removed, not silently kept).
      const orphanExpired = [];
      for (const entry of ignoreEntries) {
        const reEval = new Date(entry.reEvalDate);
        if (Number.isNaN(reEval.getTime())) {
          orphanExpired.push({ entry, reason: "invalid reEvalDate" });
          continue;
        }
        if (reEval < today) {
          const stillLive = ignoredExpired.some(
            (r) =>
              r.ignore.cve === entry.cve &&
              r.ignore.package === entry.package &&
              r.ignore.vulnerableVersions === entry.vulnerableVersions,
          );
          if (!stillLive) {
            orphanExpired.push({ entry, reason: "re-eval date in the past; advisory no longer live — remove the entry" });
          }
        }
      }

      const report = {
        generatedAt: new Date().toISOString(),
        totals: {
          surface: surface.length,
          ignoredCurrent: ignoredCurrent.length,
          ignoredExpired: ignoredExpired.length,
          orphanExpired: orphanExpired.length,
          lowOrModerateUnignored: lowOrModerateUnignored.length,
        },
        surface,
        ignoredExpired,
        orphanExpired,
        ignoredCurrent,
        lowOrModerateUnignored,
      };

      // Human-readable summary on stderr.
      const log = (s) => process.stderr.write(s + "\n");
      log("=== pnpm audit summary ===");
      log(`Surfaced (block release / open issue): ${surface.length}`);
      log(`Ignored, current re-eval:              ${ignoredCurrent.length}`);
      log(`Ignored, EXPIRED re-eval:              ${ignoredExpired.length}`);
      log(`Orphan ignore entries (expired):       ${orphanExpired.length}`);
      log(`Low/Moderate, not on ignore list:      ${lowOrModerateUnignored.length}`);
      log("");
      for (const r of surface) {
        log(`SURFACE  [${r.severity.toUpperCase()}] ${r.cve || "no-cve"} ${r.package}@${r.installedVersion} (${r.vulnerableVersions}) — ${r.reason}`);
        if (r.depPath) log(`         path: ${r.depPath}`);
        if (r.url) log(`         ref:  ${r.url}`);
      }
      for (const r of ignoredExpired) {
        log(`EXPIRED  [${r.severity.toUpperCase()}] ${r.cve} ${r.package} — ignore reEvalDate ${r.ignore.reEvalDate} (owner: ${r.ignore.owner || "unset"})`);
      }
      for (const o of orphanExpired) {
        log(`ORPHAN   ${o.entry.cve} ${o.entry.package} — ${o.reason} (reEvalDate ${o.entry.reEvalDate})`);
      }

      if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");

      const actionable = surface.length + ignoredExpired.length + orphanExpired.length;
      if (args.mode === "fail" && actionable > 0) process.exit(1);
      process.exit(0);
    })
    .catch((err) => {
      process.stderr.write(`parse-audit failed: ${err.stack || err.message || String(err)}\n`);
      process.exit(2);
    });
}

main();
