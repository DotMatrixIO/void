// SPDX-License-Identifier: AGPL-3.0-or-later
// Startup verification that an operator's effective log-retention ceiling
// does not exceed the value VOID publishes to users.
//
// Background: the "What we log" section on /why (and Part V.C of
// /threat-model) names a ≤5-day retention ceiling. The load-bearing config
// that makes that claim true on disk is `deploy/logrotate.d/void` — but
// nothing forces an operator to install it. A self-host box that silently
// keeps logs for a year still serves the "≤5 days" claim on its own /why
// page. This module closes that gap: when the operator tells us their
// effective retention (directly, or by pointing us at their logrotate
// config to probe), the server checks it at startup and warns loudly if it
// exceeds the published ceiling.
//
// The check is OPT-IN. A default deploy sets neither knob and stays quiet —
// we do not read arbitrary files or guess. README-selfhost.md §8 names both
// knobs so a self-hoster can switch the check on.

import { readFileSync } from "node:fs";

/**
 * The retention ceiling VOID publishes to users in the "What we log"
 * section on /why and Part V.C of /threat-model. Kept here as the single
 * source of truth the startup check compares against; if the published
 * policy ever changes, this constant and the docs move together.
 */
export const PUBLISHED_LOG_RETENTION_CEILING_DAYS = 5;

/**
 * Operator-supplied worst-case retention, in whole days. The simplest,
 * most reliable opt-in: the operator states the number directly so the
 * check does not depend on parsing a config file. Takes precedence over
 * the logrotate probe when both are set.
 */
const RETENTION_DAYS_ENV = "LOG_RETENTION_MAX_DAYS";

/**
 * Path to a logrotate config for the server's logs. When set (and
 * LOG_RETENTION_MAX_DAYS is not), the check reads and parses this file to
 * derive the effective retention. Pointing it at the installed
 * `/etc/logrotate.d/void` lets the running server confirm the config it
 * documents is actually the one on disk.
 */
const LOGROTATE_CONFIG_PATH_ENV = "LOGROTATE_CONFIG_PATH";

// logrotate rotation frequencies expressed in days. `hourly` is sub-day;
// the rest are logrotate's standard interval keywords.
const FREQUENCY_DAYS: Record<string, number> = {
  hourly: 1 / 24,
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

export type RetentionSource = "env" | "logrotate";

/**
 * Parse the `LOG_RETENTION_MAX_DAYS` value into a positive integer number
 * of days, or null when it is unset/empty/not a positive integer. We
 * accept only a bare positive integer so a typo (e.g. "5d", "five") is
 * rejected rather than silently coerced — the caller turns null-on-a-set-
 * value into an explicit "could not parse" warning.
 */
export function parseRetentionDaysEnv(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "" || !/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Derive the worst-case retention, in days, implied by a logrotate config.
 *
 * Two directives bound retention:
 *   - `rotate N` with a frequency keyword: the live log spans one interval
 *     and `N` archived intervals are kept, so worst-case = (N + 1) × interval.
 *     (The shipped config's `daily` + `rotate 4` ⇒ 5 days.)
 *   - `maxage N`: logrotate deletes rotated logs older than N days, a hard
 *     day bound regardless of size-triggered rotation.
 * When both are present the effective ceiling is the smaller (whichever
 * removes data first), which is how the shipped config's `rotate 4` and
 * `maxage 5` both resolve to 5. Comment lines (`#…`) are stripped first so
 * the keywords in this file's own header do not get parsed as directives.
 * Returns null when no rotate/maxage directive is found (retention cannot
 * be bounded from the file alone). When a rotate directive is present but
 * no frequency keyword is, we assume `daily` — the shipped config's
 * frequency and logrotate's most common per-file setting.
 */
export function parseLogrotateRetentionDays(config: string): number | null {
  const body = config
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash >= 0 ? line.slice(0, hash) : line;
    })
    .join("\n");

  // Pick the longest frequency present (conservative: a longer interval
  // means a longer retention estimate). Default to daily when none is set.
  let frequencyDays: number | null = null;
  for (const [keyword, days] of Object.entries(FREQUENCY_DAYS)) {
    if (new RegExp(`\\b${keyword}\\b`).test(body)) {
      if (frequencyDays === null || days > frequencyDays) frequencyDays = days;
    }
  }
  const intervalDays = frequencyDays ?? FREQUENCY_DAYS.daily;

  const bounds: number[] = [];

  const rotateMatch = /\brotate\s+(\d+)\b/.exec(body);
  if (rotateMatch) {
    bounds.push((Number(rotateMatch[1]) + 1) * intervalDays);
  }

  const maxageMatch = /\bmaxage\s+(\d+)\b/.exec(body);
  if (maxageMatch) {
    bounds.push(Number(maxageMatch[1]));
  }

  if (bounds.length === 0) return null;
  return Math.min(...bounds);
}

function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
}

/**
 * Build the WARN message for a resolved retention figure, or null when the
 * figure is within the published ceiling (nothing to warn about).
 */
function warningForDays(
  days: number,
  source: RetentionSource,
  label: string,
): string | null {
  if (days <= PUBLISHED_LOG_RETENTION_CEILING_DAYS) return null;
  const where =
    source === "env"
      ? `${RETENTION_DAYS_ENV}=${label}`
      : `logrotate config ${label}`;
  return (
    `LOG RETENTION: effective ceiling is ~${formatDays(days)} day(s) ` +
    `(from ${where}), which EXCEEDS the published ` +
    `≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ceiling named in the ` +
    `"What we log" section on /why. A box that keeps logs longer than the ` +
    `published ceiling contradicts that claim to your users. Tighten your ` +
    `log rotation (deploy/logrotate.d/void ships a ` +
    `${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day config) or correct ` +
    `${RETENTION_DAYS_ENV}. See README-selfhost.md §8.`
  );
}

/**
 * One-line log-retention posture for the consolidated effective-config
 * startup summary. Unlike `evaluateLogRetention` — which stays silent unless
 * something is wrong — this always returns a human-readable string so the
 * summary can report the posture even when the check is opted out. It
 * mirrors the same resolution order (env, then logrotate probe) and reuses
 * the exported parsers, but never throws and never returns the long
 * remediation prose (that stays in the WARN line).
 *
 * `readFile` is injected for testability; it defaults to a UTF-8
 * `fs.readFileSync`.
 */
export function describeLogRetention(
  opts: {
    env?: NodeJS.ProcessEnv;
    readFile?: (path: string) => string;
  } = {},
): string {
  const env = opts.env ?? process.env;
  const readFile =
    opts.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  const rawDays = env[RETENTION_DAYS_ENV];
  const hasEnvDays = rawDays !== undefined && rawDays.trim() !== "";
  const configPath = env[LOGROTATE_CONFIG_PATH_ENV]?.trim();

  if (!hasEnvDays && !configPath) {
    return (
      `check off — set ${RETENTION_DAYS_ENV} or ${LOGROTATE_CONFIG_PATH_ENV} ` +
      `to verify against the ≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ` +
      `published ceiling`
    );
  }

  const annotate = (days: number, from: string): string => {
    const exceeds =
      days > PUBLISHED_LOG_RETENTION_CEILING_DAYS
        ? ` — EXCEEDS the published ≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ceiling`
        : "";
    return `~${formatDays(days)} day(s) (from ${from})${exceeds}`;
  };

  if (hasEnvDays) {
    const days = parseRetentionDaysEnv(rawDays);
    if (days === null) {
      return `unverifiable — ${RETENTION_DAYS_ENV}="${rawDays}" is not a positive integer`;
    }
    return annotate(days, RETENTION_DAYS_ENV);
  }

  let config: string;
  try {
    config = readFile(configPath as string);
  } catch {
    return `unverifiable — ${LOGROTATE_CONFIG_PATH_ENV} could not be read`;
  }
  const days = parseLogrotateRetentionDays(config);
  if (days === null) {
    return `unverifiable — no rotate/maxage directive in ${LOGROTATE_CONFIG_PATH_ENV}`;
  }
  return annotate(days, `logrotate config ${LOGROTATE_CONFIG_PATH_ENV}`);
}

export interface LogRetentionResult {
  /** WARN line to emit at startup, or null when nothing should be logged. */
  warning: string | null;
}

/**
 * Evaluate the operator's effective log retention against the published
 * ceiling. Returns the WARN line index.ts should emit, or `{ warning: null }`
 * when the check is not opted into or the retention is within the ceiling.
 *
 * Resolution order:
 *   1. `LOG_RETENTION_MAX_DAYS` (direct, authoritative) — if set.
 *   2. `LOGROTATE_CONFIG_PATH` (probe the file) — if set.
 *   3. Neither set ⇒ opt-out, returns null silently.
 * A set-but-unusable knob (unparseable env, unreadable/unbounded config)
 * produces its own explanatory warning rather than failing silently — the
 * operator asked us to verify retention, so we tell them we could not.
 *
 * `readFile` is injected for testability; it defaults to a UTF-8
 * `fs.readFileSync`.
 */
export function evaluateLogRetention(
  opts: {
    env?: NodeJS.ProcessEnv;
    readFile?: (path: string) => string;
  } = {},
): LogRetentionResult {
  const env = opts.env ?? process.env;
  const readFile =
    opts.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  const rawDays = env[RETENTION_DAYS_ENV];
  const hasEnvDays = rawDays !== undefined && rawDays.trim() !== "";
  const configPath = env[LOGROTATE_CONFIG_PATH_ENV]?.trim();

  // Opt-in: do nothing unless the operator set one of the two knobs.
  if (!hasEnvDays && !configPath) return { warning: null };

  if (hasEnvDays) {
    const days = parseRetentionDaysEnv(rawDays);
    if (days === null) {
      return {
        warning:
          `LOG RETENTION: ${RETENTION_DAYS_ENV}="${rawDays}" is not a positive ` +
          `integer number of days, so the published ` +
          `≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ceiling cannot be ` +
          `verified. Set it to your log rotation's worst-case retention in ` +
          `whole days. See README-selfhost.md §8.`,
      };
    }
    return { warning: warningForDays(days, "env", String(days)) };
  }

  // configPath is set (and env days is not).
  let config: string;
  try {
    config = readFile(configPath as string);
  } catch {
    return {
      warning:
        `LOG RETENTION: ${LOGROTATE_CONFIG_PATH_ENV}="${configPath}" could not ` +
        `be read, so the published ` +
        `≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ceiling cannot be ` +
        `verified. Check the path points at your installed logrotate config. ` +
        `See README-selfhost.md §8.`,
    };
  }

  const days = parseLogrotateRetentionDays(config);
  if (days === null) {
    return {
      warning:
        `LOG RETENTION: no rotate/maxage directive found in the logrotate ` +
        `config at "${configPath}", so the published ` +
        `≤${PUBLISHED_LOG_RETENTION_CEILING_DAYS}-day ceiling cannot be ` +
        `verified from it. See README-selfhost.md §8.`,
    };
  }
  return { warning: warningForDays(days, "logrotate", configPath as string) };
}
