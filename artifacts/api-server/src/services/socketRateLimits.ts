// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-event / per-IP / per-socket rate-limit state for the signaling layer
// (Task #447 decomposition — extracted from socketHandlers.ts).
//
// All counters are module-level Maps. The companion test-only escape
// hatch `resetSocketRateLimits()` is re-exported through `socketHandlers.ts`
// so the integration suite can clear the state between cases without
// changing any production limit value.

// Task #241 / audit R-N3: cap the relay-signal `payload` field at 64 KiB so a
// paid attacker cannot push the ws engine's per-frame buffer up to its
// hard limit on every allowed event and create memory pressure on the server
// or the receiving peer. Real WebRTC SDP / ICE blobs encrypted by the client
// are well under 16 KiB; 64 KiB leaves comfortable headroom.
//
// Task #461 / audit L-03: defined in `@workspace/wire-core` so the
// client can import the same value (mirrored at the inbound boundary of
// webrtc.ts handleRelay) without the two sides drifting. The shared
// package is the single source of truth; this module re-exports for the
// in-server callers that previously imported from here.
export { RELAY_SIGNAL_MAX_PAYLOAD_BYTES } from "@workspace/wire-core";

export const EVENT_LIMITS: Record<string, { max: number; windowMs: number }> = {
  "create-room": { max: 10, windowMs: 60_000 },
  "join-room": { max: 10, windowMs: 60_000 },
  "relay-signal": { max: 200, windowMs: 10_000 },
  // Task #229: cooperative secure-channel retry notification. One click per
  // failure is the expected pattern; 10/minute per socket is generous.
  "peer-secure-channel-retry": { max: 10, windowMs: 60_000 },
  "request-screen-share": { max: 5, windowMs: 60_000 },
  "extend-room": { max: 5, windowMs: 60_000 },
  // Cooperative relay-only request (Task #106). Capped to keep a noisy
  // joiner from spamming the host's accept/decline prompt — the host's
  // attention is the scarce resource here, not server CPU.
  "request-relay-only": { max: 3, windowMs: 60_000 },

  // Audit M-3 (task #464): per-socket caps on the remaining wire-up
  // handlers that previously had no rate limit. The original audit
  // observation: a member who passed `join-room` (and so cleared the
  // 50/IP/min cap) could spam state-toggle events at line-rate, both
  // burning CPU on every receiver in the room and forcing the host's
  // UI to re-render at adversarial frequency. Limits below are sized
  // so an honest UI never hits them (state toggles are user-driven
  // and ack-ed) but a script-driven attacker is throttled within the
  // first second of abuse.

  // State toggles broadcast to every peer in the room. 30/60s covers
  // even the most aggressive legitimate UI (a user fat-fingering a
  // mute toggle, a knock-mode flicker on host reconnect).
  "set-knock-mode": { max: 30, windowMs: 60_000 },
  "approve-knock": { max: 30, windowMs: 60_000 },
  "deny-knock": { max: 30, windowMs: 60_000 },
  "cancel-knock": { max: 30, windowMs: 60_000 },
  // Task #868: `peer-media-state` removed — media-state no longer flows
  // through the signaling server (now a peer-to-peer data channel), so
  // there is no server-side event left to rate-limit.
  "leave-room": { max: 30, windowMs: 60_000 },
  "respond-relay-only-request": { max: 30, windowMs: 60_000 },
  "screen-share-started": { max: 30, windowMs: 60_000 },
  "screen-share-stopped": { max: 30, windowMs: 60_000 },

  // Room-modal events. Tighter than state toggles because each one
  // forces every other peer to re-render an overlay.
  "lock-room": { max: 10, windowMs: 60_000 },
  "unlock-room": { max: 10, windowMs: 60_000 },

  // Terminal. There is no legitimate reason for a host to issue more
  // than a handful per minute; a script driving destroy spam against
  // the same room would otherwise force GC + broadcast churn.
  "destroy-room": { max: 3, windowMs: 60_000 },

  // Terminal, member-authorized BURN (Task #696). Same shape as
  // destroy-room: a member who burns has no honest reason to do it
  // more than a few times a minute; the cap blocks GC + broadcast
  // spam from a member who cleared the join cap.
  "burn-room": { max: 3, windowMs: 60_000 },
};

export const rateBuckets = new Map<string, Map<string, { count: number; resetAt: number }>>();

export function checkRate(key: string, event: string): boolean {
  const limit = EVENT_LIMITS[event];
  if (!limit) return true;

  if (!rateBuckets.has(key)) rateBuckets.set(key, new Map());
  const bucket = rateBuckets.get(key)!;

  const now = Date.now();
  const entry = bucket.get(event);

  if (!entry || now >= entry.resetAt) {
    bucket.set(event, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= limit.max;
}

const IP_JOIN_LIMITS = { max: 50, windowMs: 60_000 };
export const ipJoinBuckets = new Map<string, { count: number; resetAt: number }>();

export function checkIpJoinRate(ip: string): boolean {
  const now = Date.now();
  const entry = ipJoinBuckets.get(ip);

  if (!entry || now >= entry.resetAt) {
    ipJoinBuckets.set(ip, { count: 1, resetAt: now + IP_JOIN_LIMITS.windowMs });
    return true;
  }

  entry.count++;
  return entry.count <= IP_JOIN_LIMITS.max;
}

const JOIN_FAIL_WINDOW_MS = 60_000;
const JOIN_FAIL_MAX = 3;

export const joinFailures = new Map<string, { timestamps: number[]; backoffUntil: number; consecutiveCount: number }>();

export function checkJoinFailRate(socketId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = joinFailures.get(socketId);
  if (!entry) return { allowed: true };

  if (entry.backoffUntil > 0 && now < entry.backoffUntil) {
    return { allowed: false, retryAfterMs: entry.backoffUntil - now };
  }

  if (entry.backoffUntil > 0 && now >= entry.backoffUntil) {
    entry.backoffUntil = 0;
  }

  return { allowed: true };
}

export function recordJoinFailure(socketId: string) {
  const now = Date.now();
  const entry = joinFailures.get(socketId) || { timestamps: [], backoffUntil: 0, consecutiveCount: 0 };
  entry.timestamps = entry.timestamps.filter(t => now - t < JOIN_FAIL_WINDOW_MS);
  entry.timestamps.push(now);

  if (entry.timestamps.length >= JOIN_FAIL_MAX) {
    entry.consecutiveCount++;
    const delayMs = Math.min(2000 * Math.pow(2, entry.consecutiveCount - 1), 30_000);
    entry.backoffUntil = now + delayMs;
  }
  joinFailures.set(socketId, entry);
}

export function clearJoinFailures(socketId: string) {
  joinFailures.delete(socketId);
}

export const MAX_CONNECTIONS_PER_IP = 50;
export const ipConnections = new Map<string, Set<string>>();

/**
 * Reset every in-process rate-limit bucket. Test-only escape hatch.
 *
 * The socket-handler integration tests share a single Socket.IO server
 * across ~280 `it()` cases, all originating from 127.0.0.1. The per-IP
 * join cap (50/min) and the per-socket join-failure backoff persist
 * across tests because they live in module-level Maps. By the time the
 * extend-room block runs, the IP bucket is exhausted and a freshly
 * connected `guest`/`joiner` socket gets `RATE_LIMITED` from
 * `checkIpJoinRate` before it ever reaches `joinRoom`, masquerading as a
 * regression in extend-room.
 *
 * Production code paths never call this. The export exists so test
 * fixtures can clear the buckets in `beforeEach`, restoring a clean slate
 * without changing any production rate-limit value. Do not wire this into
 * a request handler — clearing the buckets at runtime would defeat the
 * abuse-mitigation purpose of the limits.
 */
export function resetSocketRateLimits(): void {
  rateBuckets.clear();
  ipJoinBuckets.clear();
  joinFailures.clear();
}
