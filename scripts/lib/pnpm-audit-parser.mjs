// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Shared parser for `pnpm audit --json` output.
 *
 * This module is the single source of truth for parsing pnpm audit output
 * across the release-time CVE appendix snapshot (Task #255) and the
 * release-branch / daily monitoring workflow (Task #254). Do not write a
 * second parser; extend this one and branch on the calling context.
 *
 * Pinned to pnpm major version 10. The shape produced by `pnpm audit --json`
 * has changed across pnpm major versions in the past; if PNPM_PINNED_MAJOR
 * does not match the running pnpm, parseAuditJson() throws so a silent
 * shape-drift cannot regress either consumer.
 */

import { spawnSync } from "node:child_process";

export const PNPM_PINNED_MAJOR = 10;

export const SEVERITY_ORDER = ["critical", "high", "moderate", "low", "info"];

const SEVERITY_RANK = Object.fromEntries(
  SEVERITY_ORDER.map((s, i) => [s, i]),
);

export class PnpmAuditParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "PnpmAuditParseError";
  }
}

export function detectPnpmMajor() {
  const result = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new PnpmAuditParseError(
      `Could not determine pnpm version: ${result.stderr || result.error}`,
    );
  }
  const major = parseInt(result.stdout.trim().split(".")[0], 10);
  if (Number.isNaN(major)) {
    throw new PnpmAuditParseError(
      `Could not parse pnpm version: ${result.stdout}`,
    );
  }
  return major;
}

export function assertPinnedPnpmMajor(major = detectPnpmMajor()) {
  if (major !== PNPM_PINNED_MAJOR) {
    throw new PnpmAuditParseError(
      `pnpm-audit-parser is pinned to pnpm major ${PNPM_PINNED_MAJOR}, ` +
        `but the running pnpm is major ${major}. The --json shape has ` +
        `historically drifted across majors; refusing to parse to avoid ` +
        `silent regressions in either Task #254 (monitoring) or ` +
        `Task #255 (release-time appendix).`,
    );
  }
}

export function runPnpmAudit({ cwd = process.cwd(), prodOnly = false } = {}) {
  const args = ["audit", "--json", "--audit-level=info"];
  if (prodOnly) args.push("--prod");
  const result = spawnSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // pnpm audit exits non-zero when advisories are found. That is expected.
  if (result.error) {
    throw new PnpmAuditParseError(`pnpm audit failed to launch: ${result.error}`);
  }
  if (!result.stdout) {
    throw new PnpmAuditParseError(
      `pnpm audit produced no stdout (stderr: ${result.stderr})`,
    );
  }
  return result.stdout;
}

/**
 * Parse the raw JSON string produced by `pnpm audit --json --audit-level=info`.
 * Returns a normalized array of advisory rows. Each row is independent of
 * the pnpm output shape so downstream callers (issue tracker, markdown
 * appendix, build-fail check) all see the same fields.
 */
export function parseAuditJson(rawJson) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    throw new PnpmAuditParseError(
      `pnpm audit output is not valid JSON: ${err.message}`,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new PnpmAuditParseError("pnpm audit output is not an object");
  }
  // pnpm 10 shape: { advisories: { "<id>": { ...advisory } }, actions: [...] }
  // No advisories: pnpm 10 returns an object with empty `advisories: {}` and
  // empty `actions: []`. Treat absent `advisories` as a parse failure rather
  // than silently emitting an empty appendix.
  if (!("advisories" in parsed)) {
    throw new PnpmAuditParseError(
      "pnpm audit output is missing the `advisories` key. The pnpm major " +
        "may have changed shape; pin a new PNPM_PINNED_MAJOR after review.",
    );
  }

  const advisories = parsed.advisories ?? {};
  const rows = [];
  for (const advisoryId of Object.keys(advisories)) {
    const adv = advisories[advisoryId];
    if (!adv) continue;
    const findings = Array.isArray(adv.findings) ? adv.findings : [];
    if (findings.length === 0) {
      // Surface the advisory anyway so an absent finding does not silently
      // hide a row.
      rows.push(buildRow(adv, { version: null, depPath: null }));
      continue;
    }
    for (const finding of findings) {
      const version = finding?.version ?? null;
      const paths = Array.isArray(finding?.paths) ? finding.paths : [null];
      for (const depPath of paths) {
        rows.push(buildRow(adv, { version, depPath }));
      }
    }
  }
  return rows;
}

function buildRow(adv, { version, depPath }) {
  const severity = classifySeverity(adv.severity);
  const cves = Array.isArray(adv.cves) ? adv.cves : [];
  const ghsa = adv.github_advisory_id ?? null;
  // Prefer a CVE for the primary ID when available; fall back to GHSA;
  // fall back to the numeric advisory id as a last resort.
  const primaryId = cves[0] || ghsa || (adv.id != null ? String(adv.id) : "unknown");
  return {
    severity,
    primaryId,
    cves,
    ghsa,
    advisoryId: adv.id ?? null,
    module: adv.module_name ?? "unknown",
    version,
    vulnerableVersions: adv.vulnerable_versions ?? null,
    patchedVersions: adv.patched_versions ?? null,
    depPath,
    title: adv.title ?? "(no title)",
    url: adv.url ?? null,
    cvssScore: adv?.cvss?.score ?? null,
  };
}

export function classifySeverity(raw) {
  if (typeof raw !== "string") return "info";
  const normalized = raw.toLowerCase().trim();
  if (normalized in SEVERITY_RANK) return normalized;
  // pnpm has historically used "informational" in some shapes; map it.
  if (normalized === "informational") return "info";
  return "info";
}

export function compareSeverity(a, b) {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const sev = compareSeverity(a.severity, b.severity);
    if (sev !== 0) return sev;
    if (a.primaryId !== b.primaryId) return a.primaryId.localeCompare(b.primaryId);
    return (a.depPath ?? "").localeCompare(b.depPath ?? "");
  });
}
