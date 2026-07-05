// SPDX-License-Identifier: AGPL-3.0-or-later
import { logger } from "./logger";

// Shared ntfy.sh publisher for operator alerts (Task #274).
//
// Four otherwise-buried operator signals are routed to a single push
// destination — an ntfy topic — so a solo operator is paged instead of
// having to grep logs or watch a GitHub issue tracker:
//
//   1. a new High/Critical CVE in the daily dependency scan (posted by the
//      CI workflow directly, NOT through this module — it runs outside the
//      api-server process), and the three signals that DO live in this
//      process and use this publisher:
//   2. a wave of CSP / Permissions-Policy violation reports,
//   3. a Lightning backend changing its response shape, and
//   4. repeated payment-service slowness (503 LIGHTNING_BACKEND_UNAVAILABLE).
//
// Design rules:
//   • Env-driven and a SILENT NO-OP when unconfigured. With no NTFY_TOPIC set
//     the function returns immediately; it never throws, never logs an error,
//     and changes no behavior. Alerting must never be on a hot path that can
//     break a request.
//   • Per-signal dedupe. Each caller passes a `dedupeKey`; a second alert with
//     the same key inside `dedupeWindowMs` is dropped. This is what stops a
//     storm of any one signal (a fuzzed CSP flood, a backend stuck returning a
//     bad shape) from flooding the topic.
//   • Failures are swallowed (logged at warn) — a paging-channel outage must
//     not surface as a 500 to a user or crash the process.
//
// The topic is a SECRET: anyone who knows it can read the alerts (and, on a
// public server, publish to it). It is read from the environment and never
// logged.

const NTFY_DEFAULT_SERVER = "https://ntfy.sh";

// How long the POST is allowed to take before we give up. Short — a slow
// paging channel must not stall the caller (e.g. the request handler that
// recorded the 503). The alert is best-effort.
const NTFY_PUBLISH_TIMEOUT_MS = 5_000;

// Default dedupe window when a caller does not pass one. Five minutes is long
// enough to collapse a burst of the same signal into one page, short enough
// that a genuinely recurring condition re-pages within a reasonable time.
const DEFAULT_DEDUPE_WINDOW_MS = 5 * 60_000;

/** ntfy priority levels (https://docs.ntfy.sh/publish/#message-priority). */
export type NtfyPriority = "min" | "low" | "default" | "high" | "urgent";

export interface NtfyAlert {
  /** Short headline — becomes the ntfy notification title. */
  title: string;
  /** Body text — the notification message. */
  message: string;
  /** ntfy priority; defaults to "default". */
  priority?: NtfyPriority;
  /** ntfy tags (emoji shortcodes or words) shown with the notification. */
  tags?: string[];
  /** Per-signal dedupe key. A repeat with the same key inside the window is
   *  dropped. Required — every call site declares which signal it is so one
   *  noisy signal cannot crowd out the others. */
  dedupeKey: string;
  /** Override the default dedupe window for this signal. */
  dedupeWindowMs?: number;
}

interface NtfyConfig {
  topic: string;
  server: string;
  token?: string;
}

/** Read config from the environment at call time (not module load) so tests
 *  and operators can set the vars without import-order surprises. Returns null
 *  — the no-op signal — when no topic is configured. */
function readConfig(): NtfyConfig | null {
  const topic = process.env["NTFY_TOPIC"];
  if (!topic || topic.trim().length === 0) return null;
  const server = (process.env["NTFY_SERVER"] || NTFY_DEFAULT_SERVER).replace(/\/$/, "");
  const token = process.env["NTFY_TOKEN"] || undefined;
  return { topic: topic.trim(), server, token };
}

// Per-key last-sent timestamps for dedupe. Module-level so it survives across
// router instances within the process (same reasoning as the rate-limit maps
// in csp-report.ts / paywall.ts).
const lastSentByKey = new Map<string, number>();

function shouldSend(dedupeKey: string, windowMs: number, now: number): boolean {
  const last = lastSentByKey.get(dedupeKey);
  if (last !== undefined && now - last < windowMs) return false;
  lastSentByKey.set(dedupeKey, now);
  return true;
}

/** Publish an operator alert to the configured ntfy topic.
 *
 *  Returns `true` if a request was actually sent, `false` if it was a no-op
 *  (unconfigured) or suppressed by dedupe. Never throws — transport errors are
 *  logged at warn and swallowed. */
export async function publishNtfy(alert: NtfyAlert): Promise<boolean> {
  const config = readConfig();
  if (!config) return false;

  const windowMs = alert.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const now = Date.now();
  if (!shouldSend(alert.dedupeKey, windowMs, now)) return false;

  const headers: Record<string, string> = {
    Title: alert.title,
    Priority: alert.priority ?? "default",
  };
  if (alert.tags && alert.tags.length > 0) headers["Tags"] = alert.tags.join(",");
  if (config.token) headers["Authorization"] = `Bearer ${config.token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NTFY_PUBLISH_TIMEOUT_MS);
  try {
    const res = await fetch(`${config.server}/${config.topic}`, {
      method: "POST",
      headers,
      body: alert.message,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Do NOT echo the topic (secret). The status code is enough to triage.
      logger.warn(
        { status: res.status, dedupeKey: alert.dedupeKey },
        "ntfy publish returned a non-OK status — operator alert not delivered",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), dedupeKey: alert.dedupeKey },
      "ntfy publish failed — operator alert not delivered",
    );
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether an ntfy topic is configured. Call sites can use this to skip work
 *  that would only feed a no-op publish, but `publishNtfy` is already a no-op
 *  when unconfigured so this is purely an optimization. */
export function isNtfyConfigured(): boolean {
  return readConfig() !== null;
}

/** Test-only seam to reset the dedupe map between tests. Not part of the
 *  public API. */
export const __testing = {
  resetDedupe(): void {
    lastSentByKey.clear();
  },
  DEFAULT_DEDUPE_WINDOW_MS,
};
