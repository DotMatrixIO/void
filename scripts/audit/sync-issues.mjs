#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// De-duplicating issue sync for the daily scheduled pnpm-audit run.
//
// Reads the JSON report produced by parse-audit.mjs on stdin and uses
// the GitHub REST API (via the `gh` CLI in PATH, authenticated via the
// workflow's GITHUB_TOKEN) to:
//
//   * open one issue per (cve + package + installedVersion) triple in
//     report.surface that does not already have an open issue carrying
//     the canonical "audit:cve" label and the triple in its body
//   * update the existing issue (post a comment with the latest seen-at
//     timestamp) when the triple is already tracked
//   * close the existing issue with a "no longer reported by pnpm audit"
//     comment when an open audit:cve issue's triple is no longer in
//     report.surface (the dep was bumped, or the advisory was withdrawn)
//   * surface report.ignoredExpired and report.orphanExpired the same
//     way, so a stale ignore-list entry produces a tracking issue even
//     when no high/critical advisory is currently live
//
// The triple is encoded into the issue body as a stable HTML comment so
// the matcher does not depend on title formatting:
//
//   <!-- audit-key: cve=CVE-XXX package=foo vulnerableVersions=>=1 <2 -->
//
// All gh calls go through runGh() which fails loudly on non-zero exit.
// Dry-run mode (--dry-run) prints the actions that would be taken.
//
// Usage:
//   node scripts/audit/sync-issues.mjs [--repo=owner/name] [--label=audit:cve] [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = { repo: process.env.GITHUB_REPOSITORY || "", label: "audit:cve", dryRun: false, newIssuesOut: "" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--repo=")) out.repo = arg.slice("--repo=".length);
    else if (arg === "--repo") out.repo = argv[++i];
    else if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg === "--label") out.label = argv[++i];
    // Path to write a JSON array of the surface advisories for which a NEW
    // issue was opened this run (Task #274). The workflow reads this file and
    // posts an ntfy alert only when it is non-empty, so the operator is paged
    // on genuinely new High/Critical CVEs — not re-paged daily for one that is
    // already tracked.
    else if (arg.startsWith("--new-issues-out=")) out.newIssuesOut = arg.slice("--new-issues-out=".length);
    else if (arg === "--new-issues-out") out.newIssuesOut = argv[++i];
    else {
      process.stderr.write(`Unknown argument: ${arg}\n`);
      process.exit(2);
    }
  }
  if (!out.repo) {
    process.stderr.write("--repo or GITHUB_REPOSITORY env var required\n");
    process.exit(2);
  }
  return out;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function runGh(args, { dryRun, captureJson = false } = {}) {
  if (dryRun) {
    process.stderr.write(`[dry-run] gh ${args.join(" ")}\n`);
    return captureJson ? [] : "";
  }
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(`gh ${args.join(" ")}\n`);
    process.stderr.write(result.stderr || "");
    throw new Error(`gh exited with status ${result.status}`);
  }
  if (captureJson) return JSON.parse(result.stdout || "[]");
  return result.stdout || "";
}

// The marker is a base64url-encoded JSON object so the closing `>` of
// the HTML comment cannot collide with characters in semver ranges
// (e.g. `>=8.0.0 <8.4.0`) that previously broke the regex extractor.
// Triple is (cve + package + installed version) per the task spec —
// using the installed version means two distinct vulnerable installs
// of the same package each get their own issue rather than collapsing.
function makeKey(cve, pkg, installedVersion) {
  return { cve: cve || "", package: pkg || "", version: installedVersion || "" };
}

function encodeKey(key) {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeKey(encoded) {
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function keyId(key) {
  return `${key.cve}|${key.package}|${key.version}`;
}

function tripleMarker(cve, pkg, installedVersion) {
  return `<!-- audit-key-b64: ${encodeKey(makeKey(cve, pkg, installedVersion))} -->`;
}

const MARKER_RE = /<!-- audit-key-b64: ([A-Za-z0-9_-]+) -->/;

function listOpenAuditIssues(repo, label, dryRun) {
  return runGh(
    [
      "issue",
      "list",
      "--repo",
      repo,
      "--label",
      label,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,body",
    ],
    { dryRun, captureJson: true },
  );
}

function findIssueByMarker(issues, marker) {
  return issues.find((i) => typeof i.body === "string" && i.body.includes(marker));
}

function buildIssueBody(record, marker) {
  const paths = Array.isArray(record.depPaths) && record.depPaths.length > 0
    ? record.depPaths
    : record.depPath
      ? [record.depPath]
      : [];
  const pathsBlock = paths.length > 0 ? paths.map((p) => `- \`${p}\``).join("\n") : "- (none reported)";
  return [
    marker,
    "",
    `**Severity:** ${record.severity}`,
    `**CVE:** ${record.cve || "(none)"}`,
    `**Package:** \`${record.package}\` @ \`${record.installedVersion}\``,
    `**Vulnerable range:** \`${record.vulnerableVersions}\``,
    `**Patched in:** \`${record.patchedVersions || "(unknown)"}\``,
    `**Dep paths:**\n${pathsBlock}`,
    record.title ? `\n> ${record.title}` : "",
    record.url ? `\nReference: ${record.url}` : "",
    "",
    "Filed automatically by `.github/workflows/pnpm-audit.yml`. The fix",
    "work for this CVE belongs in its own task; see",
    "`docs/security-audit-public-2026-04.md` §11 limitation 4 for the",
    "policy. Either bump the affected dep (closes this issue on the next",
    "scheduled run) or add an entry to `scripts/audit/ignore-list.json`",
    "with a written reachability rationale and a re-evaluation date.",
  ]
    .filter((s) => s !== "")
    .join("\n");
}

function buildExpiredIgnoreBody(entry, marker) {
  return [
    marker,
    "",
    `**Ignore-list entry past its re-evaluation date.**`,
    `**CVE:** ${entry.cve}`,
    `**Package:** \`${entry.package}\``,
    `**Vulnerable range:** \`${entry.vulnerableVersions}\``,
    `**Re-eval date:** ${entry.reEvalDate} (in the past)`,
    `**Owner:** ${entry.owner || "(unset)"}`,
    "",
    "Original rationale:",
    "",
    `> ${entry.rationale}`,
    "",
    "Either re-justify (push the date out in `scripts/audit/ignore-list.json`",
    "with an updated rationale) or remove the entry. The scheduled run",
    "will fail until one of those happens.",
  ].join("\n");
}

function ensureLabel(repo, label, dryRun) {
  // Idempotent: `gh label create` exits non-zero if the label already
  // exists, which is fine — swallow that one specific failure.
  if (dryRun) {
    process.stderr.write(`[dry-run] gh label create ${label} (idempotent)\n`);
    return;
  }
  const result = spawnSync(
    "gh",
    ["label", "create", label, "--repo", repo, "--description", "Automated pnpm audit finding", "--color", "B60205"],
    { encoding: "utf8" },
  );
  if (result.status !== 0 && !(result.stderr || "").includes("already exists")) {
    process.stderr.write(result.stderr || "");
    throw new Error(`Failed to ensure label ${label}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readStdin();
  const report = JSON.parse(raw);

  ensureLabel(args.repo, args.label, args.dryRun);
  const openIssues = listOpenAuditIssues(args.repo, args.label, args.dryRun);

  const liveTriples = new Set();

  // Surface advisories for which we open a NEW issue this run. Written to
  // args.newIssuesOut (when set) so the workflow can ntfy-alert on genuinely
  // new High/Critical CVEs only (Task #274).
  const newSurfaceIssues = [];

  // openIssues is mutated in place: when we create an issue inside this
  // run we push a synthetic placeholder so a subsequent record carrying
  // the same marker (different dep path, same advisory) is treated as
  // an UPDATE rather than a second CREATE.
  function recordCreatedIssue(marker) {
    openIssues.push({ number: -1, title: "(created this run)", body: marker, _createdThisRun: true });
  }

  // 1. Surface findings → open or comment-update an issue. Group by the
  // canonical (cve + package + installedVersion) key first so the same
  // advisory reaching us via multiple dep paths does not generate
  // multiple issues. Aggregated dep paths are listed in the issue body.
  const surfaceByMarker = new Map();
  for (const r of report.surface || []) {
    const marker = tripleMarker(r.cve, r.package, r.installedVersion);
    if (!surfaceByMarker.has(marker)) {
      surfaceByMarker.set(marker, { record: r, depPaths: new Set() });
    }
    if (r.depPath) surfaceByMarker.get(marker).depPaths.add(r.depPath);
  }
  for (const [marker, { record, depPaths }] of surfaceByMarker) {
    liveTriples.add(keyId(makeKey(record.cve, record.package, record.installedVersion)));
    const aggregated = { ...record, depPaths: Array.from(depPaths).sort() };
    const existing = findIssueByMarker(openIssues, marker);
    if (existing) {
      runGh(
        [
          "issue",
          "comment",
          String(existing.number),
          "--repo",
          args.repo,
          "--body",
          `Still reported by \`pnpm audit\` as of ${report.generatedAt} (run ${process.env.GITHUB_RUN_ID || "local"}).\n\nDep paths this run:\n${aggregated.depPaths.map((p) => `- \`${p}\``).join("\n") || "- (none)"}`,
        ],
        { dryRun: args.dryRun },
      );
    } else {
      const title = `[audit] ${record.severity}: ${record.cve || record.package} in ${record.package}@${record.installedVersion}`;
      runGh(
        ["issue", "create", "--repo", args.repo, "--label", args.label, "--title", title, "--body", buildIssueBody(aggregated, marker)],
        { dryRun: args.dryRun },
      );
      recordCreatedIssue(marker);
      newSurfaceIssues.push({
        cve: record.cve || null,
        package: record.package,
        installedVersion: record.installedVersion,
        severity: record.severity,
        title,
      });
    }
  }

  // 2. Expired ignore entries (live or orphan) → open or comment-update.
  // For an expired ignore-list entry, the live finding (if any) carries
  // the installed version. Pair each entry with the matching live
  // record's installedVersion when available so the marker matches the
  // surface-path marker for the same advisory; fall back to a synthetic
  // "ignored" sentinel when only the orphan path applies. Group by
  // marker the same way the surface path does.
  const expiredPairs = [
    ...(report.ignoredExpired || []).map((r) => ({ entry: r.ignore, installedVersion: r.installedVersion })),
    ...(report.orphanExpired || []).map((o) => ({ entry: o.entry, installedVersion: "ignored" })),
  ];
  const expiredByMarker = new Map();
  for (const { entry, installedVersion } of expiredPairs) {
    const marker = tripleMarker(entry.cve, entry.package, installedVersion);
    if (!expiredByMarker.has(marker)) expiredByMarker.set(marker, { entry, installedVersion });
  }
  for (const [marker, { entry, installedVersion }] of expiredByMarker) {
    liveTriples.add(keyId(makeKey(entry.cve, entry.package, installedVersion)));
    const existing = findIssueByMarker(openIssues, marker);
    if (existing) {
      runGh(
        [
          "issue",
          "comment",
          String(existing.number),
          "--repo",
          args.repo,
          "--body",
          `Ignore-list entry still past re-eval date as of ${report.generatedAt}.`,
        ],
        { dryRun: args.dryRun },
      );
    } else {
      const title = `[audit] expired ignore: ${entry.cve} in ${entry.package} (re-eval ${entry.reEvalDate})`;
      runGh(
        [
          "issue",
          "create",
          "--repo",
          args.repo,
          "--label",
          args.label,
          "--title",
          title,
          "--body",
          buildExpiredIgnoreBody(entry, marker),
        ],
        { dryRun: args.dryRun },
      );
    }
  }

  // 3. Close issues whose triple is no longer reported.
  for (const issue of openIssues) {
    if (typeof issue.body !== "string") continue;
    const match = issue.body.match(MARKER_RE);
    if (!match) continue;
    const decoded = decodeKey(match[1]);
    if (!decoded) continue;
    const key = keyId(decoded);
    if (liveTriples.has(key)) continue;
    runGh(
      [
        "issue",
        "comment",
        String(issue.number),
        "--repo",
        args.repo,
        "--body",
        `\`pnpm audit\` no longer reports this advisory as of ${report.generatedAt}. Auto-closing.`,
      ],
      { dryRun: args.dryRun },
    );
    runGh(
      ["issue", "close", String(issue.number), "--repo", args.repo, "--reason", "completed"],
      { dryRun: args.dryRun },
    );
  }

  // Emit the newly-opened surface advisories so the workflow can ntfy-alert
  // on genuinely new High/Critical CVEs. Always write the file (even an empty
  // array) when a path is given so the workflow can branch on `length == 0`
  // without a "file missing" special case.
  if (args.newIssuesOut) {
    writeFileSync(args.newIssuesOut, JSON.stringify(newSurfaceIssues, null, 2));
  }
}

main().catch((err) => {
  process.stderr.write(`sync-issues failed: ${err.stack || err.message || String(err)}\n`);
  process.exit(2);
});
