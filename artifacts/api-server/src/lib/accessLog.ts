// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "./logger";
import { digestPaymentHash } from "./paymentHashDigest";

// 32-char lowercase hex room ID. Same shape as ROOM_CODE_RE in
// socketHandlers.ts and routes/room-state.ts. Kept in this file as a
// literal (not imported) so the access-log scrub is independent of the
// rooms module and survives any future tightening of the room-id format
// — the scrub matches the on-wire form the API has always emitted.
const ROOM_ID_RE = /\b[0-9a-f]{32}\b/g;
const ROOM_ID_PLACEHOLDER = "<room-id>";

// The Lightning paymentHash appears as a path segment on
// /api/paywall/status/:paymentHash (and /api/paywall/dev-pay/:paymentHash), so
// req.originalUrl carries the raw value into the access line unless scrubbed.
// Unlike the room ID — which is KEPT on 4xx/5xx for triage — the paymentHash is
// a Lightning-settlement-linkable identifier and is NEVER written raw, on any
// status. We scrub it two ways:
//   1. Route-aware (PAYWALL_HASH_SEG_RE): the value of the :paymentHash segment
//      on the paywall status/dev-pay routes, regardless of charset/case/length.
//      This matters because the route accepts NON-hex IDs under the BTCPay
//      backend (paywall.ts only requires length >= 10 there) and UPPERCASE
//      64-hex (its guard is /^[0-9a-f]{64}$/i) — a lowercase-64-hex regex alone
//      would leak both shapes.
//   2. Catch-all (PAYMENT_HASH_RE): any 64-hex run anywhere else, case-
//      insensitive, as defence-in-depth for a future hash-bearing URL. It
//      cannot collide with the 32-hex ROOM_ID_RE — \b needs a word boundary and
//      a 64-hex run has none at its 32-char midpoint — nor with the 12-hex
//      digest token this scrub emits.
const PAYWALL_HASH_SEG_RE = /(\/paywall\/(?:status|dev-pay)\/)([^/?#]+)/gi;
const PAYMENT_HASH_RE = /\b[0-9a-f]{64}\b/gi;

function safeDecodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    // Malformed %-escape — hash the raw segment rather than throwing in the
    // logging path. The digest is for triage; an exact decode is not required.
    return seg;
  }
}

/**
 * Replace any 32-hex-character substring in `url` with `<room-id>`.
 * Used so success-path access-log lines never carry the room code that
 * appears as a path segment on /api/room-state/:code. 4xx/5xx lines
 * leave the room ID intact so an operator triaging a real client error
 * can correlate the failed call with the room. See the "What we log"
 * section on /why and Part V.C of /threat-model for the published rule.
 */
export function scrubRoomIdFromUrl(url: string): string {
  return url.replace(ROOM_ID_RE, ROOM_ID_PLACEHOLDER);
}

/**
 * Replace any Lightning paymentHash in `url` with a `<payment-hash:DIGEST>`
 * token, where DIGEST is `digestPaymentHash` — a plain (unkeyed) SHA-256 prefix.
 * Applied on EVERY access line regardless of status: the raw paymentHash is
 * never operator-log material, because it is the same identifier that appears in
 * Lightning settlement records. The digest still lets an operator line an access
 * line up with the matching warn-path digest in routes/paywall.ts. NOTE the
 * digest is unkeyed, so a party who already holds a set of candidate
 * paymentHashes (e.g. a Lightning backend's settlement set) can hash those and
 * match the prefix; it removes the raw value and preserves triage, it does not
 * defeat a holder of the settlement set. See lib/paymentHashDigest.ts for the
 * primitive and why it stays a plain hash.
 *
 * The route-aware pass runs first so it scrubs the :paymentHash segment whatever
 * its charset/case/length (BTCPay non-hex IDs, uppercase 64-hex); the catch-all
 * then mops up any stray 64-hex elsewhere. The route-aware token contains only a
 * 12-hex digest, so the catch-all cannot re-match it.
 */
export function scrubPaymentHashFromUrl(url: string): string {
  return url
    .replace(
      PAYWALL_HASH_SEG_RE,
      (_match, prefix: string, seg: string) =>
        `${prefix}<payment-hash:${digestPaymentHash(safeDecodeSegment(seg))}>`,
    )
    .replace(PAYMENT_HASH_RE, (hash) => `<payment-hash:${digestPaymentHash(hash)}>`);
}

/**
 * One-line-per-request access logger. Emits at `info` level via the
 * shared pino logger so the standard `LOG_LEVEL=warn` self-host
 * default keeps the channel quiet; operators who want HTTP access
 * lines flip `LOG_LEVEL=info`. The published policy on /why names
 * exactly the fields written here.
 *
 * Scrub rule: the paymentHash (Task #881) is scrubbed to its digest on EVERY
 * status — it is never log-safe. The room ID (Task #374) is scrubbed on 2xx/3xx
 * only; on 4xx/5xx the room ID is passed through so a failing
 * /api/room-state/:code call can be triaged against the room it referenced.
 */
export function httpAccessLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    const method = req.method;
    const originalUrl = req.originalUrl || req.url;
    res.on("finish", () => {
      const status = res.statusCode;
      // paymentHash → digest unconditionally (never log-safe); room ID is kept
      // on the failure path for triage, scrubbed on success.
      let url = scrubPaymentHashFromUrl(originalUrl);
      if (status >= 200 && status < 400) {
        url = scrubRoomIdFromUrl(url);
      }
      logger.info(
        {
          ip: req.ip ?? req.socket.remoteAddress ?? "unknown",
          method,
          url,
          status,
          durationMs: Date.now() - startedAt,
        },
        "http",
      );
    });
    next();
  };
}
