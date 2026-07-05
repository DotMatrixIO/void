#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixture-based dry-run tests for scripts/audit/sync-issues.mjs.
//
// Stubs the `gh` CLI by prepending a temp directory to PATH that
// contains a fake `gh` script which records its argv to a log file.
// Drives the sync script through the four lifecycle paths the daily
// scheduled job has to support:
//
//   1. NEW: surface finding with no existing open issue → `gh issue create`
//   2. UPDATE: surface finding with an existing matching open issue
//      (same base64url marker) → `gh issue comment` (no create)
//   3. CLOSE: open audit issue whose marker triple is no longer in the
//      report → `gh issue comment` followed by `gh issue close`
//   4. EXPIRED-IGNORE: orphan ignore-list entry past re-eval date and
//      not currently live → `gh issue create` for the expired entry
//
// Exits 0 on success, 1 on the first assertion failure.
//
// Run: node scripts/audit/sync-issues.test.mjs

import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SYNC = join(__dirname, "sync-issues.mjs");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    failures += 1;
  } else {
    process.stdout.write(`ok: ${msg}\n`);
  }
}

function makeFakeGhDir(scenario) {
  // scenario.issuesJson is the JSON string the fake gh returns when
  // invoked as `gh issue list ... --json ...`. All other gh subcommands
  // (label create, issue create, comment, close) just record argv and
  // exit 0.
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  const logPath = join(dir, "gh.log");
  writeFileSync(logPath, "");
  const ghPath = join(dir, "gh");
  const issuesJson = scenario.issuesJson.replace(/'/g, "'\\''");
  const script = `#!/usr/bin/env bash
echo "$@" >> ${JSON.stringify(logPath)}
case "$1 $2" in
  "issue list")
    echo '${issuesJson}'
    ;;
  "label create")
    # idempotent label-create — succeed
    ;;
  *)
    ;;
esac
exit 0
`;
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  return { dir, ghPath, logPath };
}

function runSync(reportObj, scenario) {
  const { dir, logPath } = makeFakeGhDir(scenario);
  const res = spawnSync("node", [SYNC, "--repo", "x/y"], {
    input: JSON.stringify(reportObj),
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  if (res.status !== 0) {
    process.stderr.write(`sync exited ${res.status}\nstderr:${res.stderr}\nstdout:${res.stdout}\n`);
  }
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  return { exit: res.status, log, stderr: res.stderr };
}

function makeSurfaceRecord(over = {}) {
  return {
    cve: "CVE-2026-9999",
    severity: "high",
    package: "foo",
    installedVersion: "1.2.3",
    vulnerableVersions: ">=1.0.0 <2.0.0",
    patchedVersions: ">=2.0.0",
    depPath: "a>b>foo",
    title: "test advisory",
    url: "https://example/x",
    reason: "test",
    ...over,
  };
}

function markerForRecord(r) {
  const key = { cve: r.cve, package: r.package, version: r.installedVersion };
  return `<!-- audit-key-b64: ${Buffer.from(JSON.stringify(key)).toString("base64url")} -->`;
}

// Scenario 1: NEW issue
{
  const r = makeSurfaceRecord();
  const report = { generatedAt: "2026-05-02T00:00:00Z", totals: {}, surface: [r], ignoredExpired: [], orphanExpired: [], ignoredCurrent: [], lowOrModerateUnignored: [] };
  const { exit, log } = runSync(report, { issuesJson: "[]" });
  assert(exit === 0, "NEW: sync exits 0");
  assert(/issue create /.test(log), "NEW: gh issue create was invoked");
  assert(!/issue comment /.test(log), "NEW: gh issue comment NOT invoked");
  assert(!/issue close /.test(log), "NEW: gh issue close NOT invoked");
}

// Scenario 2: UPDATE existing matching issue (same marker)
{
  const r = makeSurfaceRecord();
  const marker = markerForRecord(r);
  const issues = [{ number: 42, title: "[audit] high: CVE-2026-9999 in foo@1.2.3", body: `${marker}\n\nbody` }];
  const report = { generatedAt: "2026-05-02T00:00:00Z", totals: {}, surface: [r], ignoredExpired: [], orphanExpired: [], ignoredCurrent: [], lowOrModerateUnignored: [] };
  const { exit, log } = runSync(report, { issuesJson: JSON.stringify(issues) });
  assert(exit === 0, "UPDATE: sync exits 0");
  assert(/issue comment 42 /.test(log), "UPDATE: gh issue comment 42 was invoked");
  assert(!/issue create /.test(log), "UPDATE: gh issue create NOT invoked");
}

// Scenario 3: CLOSE issue whose marker is no longer in the report
{
  const stale = makeSurfaceRecord({ cve: "CVE-2026-1111" });
  const marker = markerForRecord(stale);
  const issues = [{ number: 7, title: "[audit] old", body: `${marker}\n\nbody` }];
  const report = { generatedAt: "2026-05-02T00:00:00Z", totals: {}, surface: [], ignoredExpired: [], orphanExpired: [], ignoredCurrent: [], lowOrModerateUnignored: [] };
  const { exit, log } = runSync(report, { issuesJson: JSON.stringify(issues) });
  assert(exit === 0, "CLOSE: sync exits 0");
  assert(/issue comment 7 /.test(log), "CLOSE: gh issue comment 7 was invoked");
  assert(/issue close 7 /.test(log), "CLOSE: gh issue close 7 was invoked");
}

// Scenario 4: EXPIRED orphan ignore entry → create issue
{
  const orphan = {
    entry: { cve: "CVE-2026-7777", package: "bar", vulnerableVersions: ">=1 <2", reEvalDate: "2020-01-01", owner: "task #999", rationale: "old" },
    reason: "re-eval date in the past; advisory no longer live — remove the entry",
  };
  const report = { generatedAt: "2026-05-02T00:00:00Z", totals: {}, surface: [], ignoredExpired: [], orphanExpired: [orphan], ignoredCurrent: [], lowOrModerateUnignored: [] };
  const { exit, log } = runSync(report, { issuesJson: "[]" });
  assert(exit === 0, "EXPIRED: sync exits 0");
  assert(/issue create [^\n]*expired ignore/.test(log), "EXPIRED: gh issue create with 'expired ignore' title");
}

// Scenario 5: DEDUP — same (cve+package+installedVersion) via two
// distinct dep paths in the same run produces exactly ONE create call.
{
  const r1 = makeSurfaceRecord({ depPath: "a>b>foo" });
  const r2 = makeSurfaceRecord({ depPath: "x>y>foo" });
  const report = { generatedAt: "2026-05-02T00:00:00Z", totals: {}, surface: [r1, r2], ignoredExpired: [], orphanExpired: [], ignoredCurrent: [], lowOrModerateUnignored: [] };
  const { exit, log } = runSync(report, { issuesJson: "[]" });
  assert(exit === 0, "DEDUP: sync exits 0");
  const createCount = (log.match(/issue create /g) || []).length;
  assert(createCount === 1, `DEDUP: exactly one gh issue create (got ${createCount})`);
}

if (failures > 0) {
  process.stderr.write(`\n${failures} assertion(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("\nall sync-issues fixture tests passed\n");
  process.exit(0);
}
