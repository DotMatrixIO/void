// SPDX-License-Identifier: AGPL-3.0-or-later
import { Router, type IRouter, type Request } from "express";
import { getRoomState } from "../rooms";
import type { RoomTier } from "../rooms";

const router: IRouter = Router();

const ROOM_CODE_RE = /^[0-9a-f]{32}$/;

// Per-IP rate limit for the server-state proof endpoint. A person
// pasting one code into /proof/server-state and reading the JSON never
// approaches this ceiling; the limit exists so an attacker who has
// harvested a set of real room codes (shared links, logs, referrers)
// cannot hammer this endpoint to track those rooms in real time and
// turn the transparency tool into a scraping oracle. Mirrors the
// self-contained per-IP bucket pattern in ice-servers.ts; aligned to
// the established 10 requests/IP/minute convention. These named
// constants are the single source of truth shared by the runtime, the
// test, and the documented limit (VOID_TECHNICAL_OVERVIEW.md §3.4
// "Rate limiting"). Keep them in sync.
export const RATE_WINDOW_MS = 60_000;
export const RATE_MAX = 10;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request): string {
  // Use req.ip, which reflects the Express `trust proxy` setting (configured
  // in app.ts). The leftmost X-Forwarded-For token is attacker-controlled
  // and would let a single source rotate spoofed values to bypass the
  // per-IP rate limit; req.ip with trust=1 returns the rightmost entry
  // (added by the trusted reverse proxy) instead.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkIpRate(ip: string): boolean {
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_MAX;
}

// Public tier vocabulary. Internal RoomTier names ("standard", "day")
// describe TTL buckets; the proof endpoint must expose what the user
// paid for. Single mapping point — anything else that ships an
// internal tier string publicly is a bug. "paid_7d" is reserved for
// a future 7-day product.
export type PublicRoomTier = "free" | "paid_24h" | "paid_7d";

export function toPublicTier(internal: RoomTier): PublicRoomTier {
  switch (internal) {
    case "standard":
      return "free";
    case "day":
      return "paid_24h";
    default: {
      const exhaustive: never = internal;
      throw new Error(`Unmapped internal room tier: ${String(exhaustive)}`);
    }
  }
}

// GET /api/room-state/:code — server-state proof endpoint.
//
// 400 { error: "INVALID_CODE" }   malformed (not 32-char lowercase hex)
// 200 {}                          well-formed code, no live room
// 200 { exists, tier, expiresAt, participantCount }   live room
//
// {} collapses never-existed, expired, and destroyed on purpose. The
// underlying `getRoomState` codepath is also kept coarsely uniform
// across those three cases (one Map.get + one property read + one
// Date.now compare reaches `return null` on every null path) so an
// off-path observer can't use response timing to tell never-existed
// from expired from destroyed at order-of-magnitude granularity.
//
// Codepath equalization, NOT secret string comparison: the equalized
// branches are the three `return null` paths inside `getRoomState`,
// not a byte compare of secret material. The room `code` is a
// joiner-derived public identifier on this path; there is no secret
// value being compared per byte, so `timingSafeStringCompare` is
// deliberately not used here. See docs/security-audit-internal-
// 2026-04.md §3.9 (constant-time sweep) for the full reasoning.
//
// This is not a strict constant-time guarantee — see `getRoomState`
// in ../rooms.ts for the rationale and the threat-model scope, and
// `__tests__/room-state-timing.test.ts` for the regression check.
// tier is mapped to public vocabulary. No identity fields.
router.get("/room-state/:code", (req, res) => {
  if (!checkIpRate(getClientIp(req))) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  const { code } = req.params;
  if (!ROOM_CODE_RE.test(code)) {
    res.status(400).json({ error: "INVALID_CODE" });
    return;
  }
  const state = getRoomState(code);
  if (state === null) {
    res.json({});
    return;
  }
  res.json({
    exists: state.exists,
    tier: toPublicTier(state.tier),
    expiresAt: state.expiresAt,
    participantCount: state.participantCount,
    relayOnly: state.relayOnly,
  });
});

export default router;
