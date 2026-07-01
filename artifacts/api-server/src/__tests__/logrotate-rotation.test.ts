// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Verify the published log-retention policy survives a REAL logrotate run.
//
// log-retention.test.ts pins the policy at two layers that never meet:
// the application-layer scrub (pino line shape) and a string-parse of
// the checked-in logrotate config. This test closes the gap by running
// the actual `logrotate` binary against the SHIPPED config on a tmpdir
// of dated fake log files. A future edit to deploy/logrotate.d/void that
// silently widens the ceiling (e.g. `maxage 365`, `rotate 364`) compiles,
// passes the string parser if someone "fixes" it to match — but a real
// rotation would keep week-old logs on disk. This catches that drift.
//
// Skips gracefully when `logrotate` is not on PATH, mirroring the
// nginx-binary gate in security-headers-proxy.test.ts.

const CONFIG_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../deploy/logrotate.d/void",
);

const DAY_MS = 24 * 60 * 60 * 1000;

// The retention assertion uses a deliberately loose 10-day ceiling even
// though the published policy is ≤5 days. The point is to catch a config
// that has silently widened to keep logs for weeks/months/forever, not to
// re-pin the exact day count (log-retention.test.ts already does that).
// The margin keeps this smoke test robust against logrotate's off-by-a-day
// boundary handling across versions.
const SURVIVOR_CEILING_DAYS = 10;

function findLogrotateBinary(): string | null {
  const r = spawnSync("which", ["logrotate"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return null;
}

const logrotateBin = findLogrotateBinary();

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateExtSuffix(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

// logrotate's `dateext` rotation produces `app.log-YYYYMMDD` files and its
// `maxage` cleanup is driven by file mtime. Seed both consistently so the
// fixture looks exactly like a box that has been rotating for weeks.
function seedRotatedFile(logDir: string, ageDays: number): string {
  const when = new Date(Date.now() - ageDays * DAY_MS);
  const name = `app.log-${dateExtSuffix(when)}`;
  const file = path.join(logDir, name);
  writeFileSync(file, `rotated log content from ${ageDays} day(s) ago\n`);
  const seconds = when.getTime() / 1000;
  utimesSync(file, seconds, seconds);
  return file;
}

describe.skipIf(logrotateBin === null)(
  "published log policy survives a real logrotate run",
  () => {
    it("purges logs older than the published ceiling using the shipped config", () => {
      const shipped = readFileSync(CONFIG_PATH, "utf8");

      const root = mkdtempSync(path.join(tmpdir(), "void-logrotate-"));
      try {
        const logDir = path.join(root, "var", "log", "void");
        mkdirSync(logDir, { recursive: true });

        // The live log (copytruncate keeps this file in place after rotation).
        const liveLog = path.join(logDir, "app.log");
        writeFileSync(liveLog, "live log line\nanother live line\n");

        // Seed dated rotated files spanning well past 10 days. The oldest
        // MUST be deleted by any policy that honors the published ceiling;
        // a widened config would leave them on disk and fail the assertion.
        const seededAges = [1, 2, 3, 4, 6, 8, 11, 14, 20, 30, 90];
        const oldestSeeded = Math.max(...seededAges);
        for (const age of seededAges) seedRotatedFile(logDir, age);
        expect(oldestSeeded).toBeGreaterThan(SURVIVOR_CEILING_DAYS);

        // Rewrite the shipped glob to point at our tmpdir and drop the
        // `su root root` line — the test runs as a non-root user, the same
        // kind of environment-only adaptation security-headers-proxy.test.ts
        // makes when it rewrites the README's proxy_pass target. Every
        // retention-relevant directive (daily/rotate/maxage/dateext/...) is
        // exercised verbatim from deploy/logrotate.d/void.
        const conf = shipped
          .replace("/var/log/void/*.log", `${logDir}/*.log`)
          .replace(/^\s*su\s+\S+\s+\S+\s*$/m, "");

        // Confirm the rewrite took effect: the tmpdir glob must be present
        // and no bare `/var/log/void/*.log {` stanza may remain at line start.
        // (The literal substring still appears inside the rewritten tmpdir
        // path because logDir ends in /var/log/void, so match on a line.)
        if (
          !conf.includes(`${logDir}/*.log`) ||
          /^\/var\/log\/void\/\*\.log\s*\{/m.test(conf)
        ) {
          throw new Error(
            "Failed to rewrite the logrotate glob to the tmpdir. The shipped " +
              "config in deploy/logrotate.d/void no longer contains the literal " +
              "'/var/log/void/*.log' stanza this test rewrites — update the test " +
              "or restore the path.",
          );
        }

        const confPath = path.join(root, "void.conf");
        const statePath = path.join(root, "logrotate.state");
        writeFileSync(confPath, conf);

        const run = spawnSync(
          logrotateBin as string,
          ["-f", "-s", statePath, confPath],
          { encoding: "utf8" },
        );

        if (run.status !== 0) {
          throw new Error(
            `logrotate exited with status ${run.status} running the shipped config.\n` +
              `stdout:\n${run.stdout}\n` +
              `stderr:\n${run.stderr}`,
          );
        }

        // After a forced rotation, no file in the log directory may have an
        // mtime older than the ceiling. This is the load-bearing assertion:
        // it fails loudly if a future config edit widens retention.
        const cutoffMs = Date.now() - SURVIVOR_CEILING_DAYS * DAY_MS;
        const survivors = readdirSync(logDir);

        // Sanity: logrotate must have actually run and left the live log in
        // place (copytruncate). An empty dir would make the age check vacuous.
        expect(survivors).toContain("app.log");

        const tooOld = survivors
          .map((name) => {
            const full = path.join(logDir, name);
            return { name, mtimeMs: statSync(full).mtimeMs };
          })
          .filter((f) => f.mtimeMs < cutoffMs)
          .map((f) => {
            const ageDays = ((Date.now() - f.mtimeMs) / DAY_MS).toFixed(1);
            return `${f.name} (${ageDays} days old)`;
          });

        if (tooOld.length > 0) {
          throw new Error(
            `deploy/logrotate.d/void left logs older than ${SURVIVOR_CEILING_DAYS} days ` +
              `on disk after a forced rotation — the published "≤5 days" retention ` +
              `ceiling (/why, README-selfhost.md §8) is no longer enforced by the ` +
              `shipped config. Stale files:\n  - ${tooOld.join("\n  - ")}`,
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  },
);
