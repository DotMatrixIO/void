// SPDX-License-Identifier: AGPL-3.0-or-later
import express, { Router, type IRouter, type Request } from "express";
import { logger } from "../lib/logger";
import { publishNtfy } from "../lib/ntfy";

// CSP / Reporting-API violation sink (Task #252, audit row R-N4).
//
// app.ts declares two browser-side reporting hooks:
//   • CSP directive `report-to default`
//   • header `Reporting-Endpoints: default="/api/csp-report"`
//
// Compliant browsers POST violation reports here. Two body shapes show up
// in the wild; we accept both:
//
//   1. Reporting API (modern, what current Chromium/Firefox emit): a JSON
//      array of report envelopes, content-type `application/reports+json`.
//      Each envelope has { type, age, url, user_agent, body }; for CSP
//      violations, `type === "csp-violation"` and `body` is the violation
//      object (blocked-url, effective-directive, etc.). The Permissions-
//      Policy spec also routes its violations through this same endpoint
//      group with `type === "permissions-policy-violation"`.
//
//   2. Legacy `report-uri` (older browsers, some bots): a single JSON
//      object `{ "csp-report": { … } }` with content-type
//      `application/csp-report`.
//
// Either way the goal is the same: a structured log line the operator can
// grep for. We never reflect the report back, never trust any field for
// access-control decisions, and always reply 204 — including on parse
// failure — so a misbehaving client (or a fuzzer) cannot use this sink to
// probe for error messages.
//
// Threat model:
//   • The endpoint is unauthenticated by design — browsers don't carry
//     auth when posting reports.
//   • A hostile client can flood us with bogus reports. Mitigated by:
//     (a) per-IP rate limit, (b) hard body-size cap (32 KB; real reports
//     are well under 4 KB), (c) we only log a bounded set of fields, never
//     the raw blob, so log volume is predictable.
//   • A leaked report can disclose blocked URLs the user was visiting.
//     Reports stay in operator logs; we never persist or forward them.

const ROUTE_PATH = "/csp-report";

// Body-size cap. The Reporting API sends batches but in practice each
// envelope is < 1 KB; 32 KB tolerates a large batch from a misbehaving
// page without giving an attacker meaningful amplification.
const BODY_LIMIT = "32kb";

// Per-IP rate limiter — same shape as /paywall/recover and /ice-servers.
// A real page produces a small handful of reports per navigation; a
// noisy bug or attack can produce thousands, which we want to drop on
// the floor rather than fan out into the log pipeline.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_IP = 30;

// Coarse global counter that emits one WARN per window if total report
// volume crosses the threshold. This is observability — it does NOT
// throttle traffic — so a distributed flood still surfaces in the logs
// even when no single IP exceeds its bucket.
const GLOBAL_WARN_THRESHOLD = 500;

// Distinct-IP "wave" detector (Task #274). The global volume counter above
// can be tripped by a single noisy page, so it is not, on its own, a good
// paging signal. A wave we actually want to page the operator about is one
// where reports arrive from MANY distinct client IPs in a short window —
// the shape of a real CSP regression hitting a broad slice of users, or a
// distributed probe. We track the set of distinct IPs per window and fire
// ONE ntfy alert per window the moment the count crosses the threshold.
const DISTINCT_IP_WAVE_THRESHOLD = 25;

const ipBuckets = new Map<string, { count: number; resetAt: number }>();
let globalCount = 0;
let globalResetAt = 0;
let globalWarned = false;

// Distinct IPs seen in the current wave window, plus a once-per-window guard
// so we page exactly once when the threshold is first crossed.
let waveWindowIps = new Set<string>();
let waveResetAt = 0;
let waveAlerted = false;

function getClientIp(req: Request): string {
  // Use req.ip, which reflects the Express `trust proxy` setting from
  // app.ts. With the default 1 hop, this returns the rightmost X-Forwarded-
  // For entry — appended by the trusted proxy itself — and not a leftmost
  // value an attacker could spoof to mint unlimited per-IP buckets.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    ipBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX_PER_IP;
}

function tickGlobal(): void {
  const now = Date.now();
  if (now > globalResetAt) {
    globalCount = 0;
    globalResetAt = now + RATE_WINDOW_MS;
    globalWarned = false;
  }
  globalCount++;
  if (globalCount > GLOBAL_WARN_THRESHOLD && !globalWarned) {
    logger.warn(
      {
        reports: globalCount,
        windowMs: RATE_WINDOW_MS,
        threshold: GLOBAL_WARN_THRESHOLD,
      },
      "Global CSP/Reporting-API report rate exceeded threshold — possible flood or widespread policy regression",
    );
    globalWarned = true;
  }
}

/** Track distinct client IPs in the current wave window. When the count of
 *  distinct IPs first crosses DISTINCT_IP_WAVE_THRESHOLD, fire ONE ntfy alert
 *  for the window. The ntfy publisher additionally dedupes on its own, so even
 *  a window-reset race cannot fan this out into a flood. No-op when ntfy is
 *  unconfigured (publishNtfy returns immediately). */
function recordWaveIp(ip: string): void {
  const now = Date.now();
  if (now > waveResetAt) {
    waveWindowIps = new Set<string>();
    waveResetAt = now + RATE_WINDOW_MS;
    waveAlerted = false;
  }
  waveWindowIps.add(ip);
  if (waveWindowIps.size >= DISTINCT_IP_WAVE_THRESHOLD && !waveAlerted) {
    waveAlerted = true;
    const distinct = waveWindowIps.size;
    void publishNtfy({
      title: "VOID: CSP report wave",
      message:
        `CSP / Permissions-Policy violation reports arriving from ${distinct} distinct client IPs ` +
        `within ${RATE_WINDOW_MS / 1000}s — possible policy regression hitting many users, or a distributed probe. ` +
        `Check the api-server logs for "csp_report" lines.`,
      priority: "high",
      tags: ["rotating_light", "shield"],
      dedupeKey: "csp-report-wave",
      dedupeWindowMs: RATE_WINDOW_MS,
    });
  }
}

function resetRateLimit(): void {
  ipBuckets.clear();
  globalCount = 0;
  globalResetAt = 0;
  globalWarned = false;
  waveWindowIps = new Set<string>();
  waveResetAt = 0;
  waveAlerted = false;
}

interface NormalizedReport {
  type: string;
  blockedUrl?: string;
  documentUrl?: string;
  effectiveDirective?: string;
  originalPolicy?: string;
  disposition?: string;
  statusCode?: number;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  // Permissions-Policy violations carry the offending feature ID.
  featureId?: string;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Normalize a single report into a flat shape suitable for structured
 *  logging. Accepts either:
 *   - a Reporting-API envelope ({ type, body: { … } }), or
 *   - a legacy `report-uri` envelope ({ "csp-report": { … } }), or
 *   - a bare violation object (some non-spec clients).
 *  Returns null if the input is not a recognizable shape. */
function normalize(raw: unknown): NormalizedReport | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // Reporting-API envelope.
  if (typeof obj["type"] === "string" && obj["body"] && typeof obj["body"] === "object") {
    const body = obj["body"] as Record<string, unknown>;
    return {
      type: String(obj["type"]),
      blockedUrl: pickString(body, "blockedURL", "blocked-uri"),
      documentUrl: pickString(body, "documentURL", "document-uri"),
      effectiveDirective: pickString(body, "effectiveDirective", "effective-directive", "violatedDirective", "violated-directive"),
      originalPolicy: pickString(body, "originalPolicy", "original-policy"),
      disposition: pickString(body, "disposition"),
      statusCode: pickNumber(body, "statusCode", "status-code"),
      sourceFile: pickString(body, "sourceFile", "source-file"),
      lineNumber: pickNumber(body, "lineNumber", "line-number"),
      columnNumber: pickNumber(body, "columnNumber", "column-number"),
      featureId: pickString(body, "featureId", "feature-id"),
    };
  }

  // Legacy `report-uri` envelope.
  if (obj["csp-report"] && typeof obj["csp-report"] === "object") {
    const body = obj["csp-report"] as Record<string, unknown>;
    return {
      type: "csp-violation",
      blockedUrl: pickString(body, "blocked-uri", "blockedURL"),
      documentUrl: pickString(body, "document-uri", "documentURL"),
      effectiveDirective: pickString(body, "effective-directive", "violated-directive"),
      originalPolicy: pickString(body, "original-policy"),
      disposition: pickString(body, "disposition"),
      statusCode: pickNumber(body, "status-code"),
      sourceFile: pickString(body, "source-file"),
      lineNumber: pickNumber(body, "line-number"),
      columnNumber: pickNumber(body, "column-number"),
    };
  }

  return null;
}

const router: IRouter = Router();

// Match BOTH content types the Reporting API and the legacy CSP report-uri
// flow use. The default `express.json()` mounted in app.ts only parses
// `application/json`, so the per-route parser here is what actually pulls
// the body out for the two real-world content types.
const bodyParser = express.json({
  type: ["application/csp-report", "application/reports+json", "application/json"],
  limit: BODY_LIMIT,
});

// Wrap the body parser so its errors (malformed JSON, oversized body, etc.)
// short-circuit to a 204 instead of falling through to the global Express
// error handler — which would otherwise return 500 with a body and turn this
// endpoint into a status-code oracle for fuzz traffic. We deliberately do not
// log at WARN here because a fuzz wave would dominate the log; debug is
// enough for an operator who is actively investigating.
function bodyParserSafe(req: Request, res: import("express").Response, next: import("express").NextFunction): void {
  bodyParser(req, res, (err) => {
    if (err) {
      logger.debug(
        { err: err instanceof Error ? err.message : String(err), contentType: req.get("content-type") },
        "CSP report endpoint dropped a malformed or oversized payload",
      );
      res.status(204).end();
      return;
    }
    next();
  });
}

router.post(
  ROUTE_PATH,
  bodyParserSafe,
  (req, res) => {
    // Always rate-limit before any work — counting only well-formed reports
    // would let an attacker probe the parser for free, the same reasoning
    // that applies to /paywall/recover.
    tickGlobal();
    const ip = getClientIp(req);
    if (!checkIpRate(ip)) {
      // Per the Reporting API spec, the browser does not retry on 429, so
      // dropping floods this way does not cause a retry storm. We still
      // emit a single throttled WARN per IP per window so the operator
      // sees that we're shedding load on this address.
      const bucket = ipBuckets.get(ip);
      if (bucket && bucket.count === RATE_MAX_PER_IP + 1) {
        logger.warn(
          { ip, windowMs: RATE_WINDOW_MS, max: RATE_MAX_PER_IP },
          "CSP report rate limit exceeded for IP — dropping further reports this window",
        );
      }
      res.status(429).end();
      return;
    }

    // Count this IP toward the distinct-IP wave detector (Task #274). Done
    // before parsing so a flood of malformed reports from many IPs still
    // pages the operator — a broad probe is exactly the shape we want to know
    // about even when the bodies are garbage.
    recordWaveIp(ip);

    const body = req.body;

    // Reporting API delivers an array of envelopes; legacy report-uri
    // delivers a single object. Coerce to an array of one for uniform
    // iteration.
    const items: unknown[] = Array.isArray(body) ? body : [body];

    let parsed = 0;
    for (const item of items) {
      const report = normalize(item);
      if (!report) continue;
      parsed++;
      logger.warn(
        {
          event: "csp_report",
          reportType: report.type,
          blockedUrl: report.blockedUrl,
          documentUrl: report.documentUrl,
          effectiveDirective: report.effectiveDirective,
          disposition: report.disposition,
          statusCode: report.statusCode,
          sourceFile: report.sourceFile,
          lineNumber: report.lineNumber,
          columnNumber: report.columnNumber,
          featureId: report.featureId,
          ip,
          userAgent: req.get("user-agent"),
        },
        "CSP / Reporting-API violation received",
      );
    }

    if (parsed === 0) {
      // Bad shape — log once at debug so a fuzz wave doesn't fill the log,
      // but the operator can still see something arrived if they're looking.
      logger.debug({ ip, contentType: req.get("content-type") }, "CSP report endpoint received an unrecognized payload shape");
    }

    // Always 204. The browser ignores the body, and surfacing nothing means
    // the endpoint cannot be used as an oracle for parser internals.
    res.status(204).end();
  },
);

export default router;

/** Test-only seam to reset the rate-limit state between tests. Not part of
 *  the public API; nothing else in the codebase should import this. */
export const __testing = {
  resetRateLimit,
  RATE_MAX_PER_IP,
  RATE_WINDOW_MS,
};
