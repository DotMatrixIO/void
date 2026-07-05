// SPDX-License-Identifier: AGPL-3.0-or-later
import { timingSafeEqual } from "node:crypto";
import { hmacReclaimToken } from "../lib/hostHashHmac";
import {
  MAX_USERS,
  MAX_TOTAL_ROOMS_DEFAULT,
  GC_INTERVAL_MS,
  type RoomState,
  type RoomUser,
  type RoomType,
  type RoomTier,
  type RoomCapacityRejection,
  type GcSweepCounters,
  type RoomStateSnapshot,
} from "./types";

// Module-level room registry. Shared (by import) with every other rooms/*
// module — they import this `rooms` Map directly to read and mutate state.
// Keeping it here (rather than re-exporting from the barrel) avoids a
// circular-dependency tangle through `rooms.ts`.
export const rooms = new Map<string, RoomState>();

let maxTotalRooms = MAX_TOTAL_ROOMS_DEFAULT;

const capRejectionCounters = { global: 0 };

export function getRoomCount(): number {
  return rooms.size;
}

// Centralised capacity policy. Called by the socket layer immediately
// before `createRoom`. When the global cap fills, room creation is
// rejected. Increments the cap-rejection counter on rejection.
export function checkRoomCapacity(
  _roomType: RoomType,
): { allowed: true } | { allowed: false; error: RoomCapacityRejection } {
  if (rooms.size >= maxTotalRooms) {
    capRejectionCounters.global++;
    return { allowed: false, error: "ROOM_CAP_REACHED" };
  }
  return { allowed: true };
}

export function getCapRejectionCounters(): { global: number } {
  return { ...capRejectionCounters };
}

export function __resetCapRejectionCountersForTest(): void {
  capRejectionCounters.global = 0;
}

// Test-only: shrink the caps so the integration suite can exercise the
// cap branches without minting tens of thousands of rooms. Always paired
// with `__resetRoomCapsForTest` in the suite's `afterEach`.
export function __setRoomCapsForTest(opts: { maxTotal?: number }): void {
  if (typeof opts.maxTotal === "number") maxTotalRooms = opts.maxTotal;
}

export function __resetRoomCapsForTest(): void {
  maxTotalRooms = MAX_TOTAL_ROOMS_DEFAULT;
}

// Test-only: drop every room and cancel its timers. Used by the cap
// suite to start each test from a known empty state rather than relying
// on the GC sweep to evict prior fixtures.
export function __clearAllRoomsForTest(): void {
  for (const r of rooms.values()) {
    if (r.expiryTimer) clearTimeout(r.expiryTimer);
    if (r.screenShareReservationTimer) clearTimeout(r.screenShareReservationTimer);
  }
  rooms.clear();
}

let onRoomExpired: ((code: string) => void) | null = null;

export function setOnRoomExpired(cb: (code: string) => void): void {
  onRoomExpired = cb;
}

// Invocation helpers used by lifecycle / persistence / GC: these wrap the
// nullable hook with a single null-check so callers don't repeat it inline.
export function invokeOnRoomExpired(code: string): void {
  if (onRoomExpired) onRoomExpired(code);
}

// Task #310: persistence hook. Fires whenever the persistable shape of
// the room registry changes — create, destroy, paid extension, lock /
// unlock, relay-only flip, host reclaim-token add, GC delete. Volatile
// per-socket state (users, hostSocketId, pendingKnocks, screen share)
// is intentionally NOT persisted, so mutations to those fields do NOT
// invoke this hook.
let onRoomsChanged: (() => void) | null = null;

export function setOnRoomsChanged(cb: (() => void) | null): void {
  onRoomsChanged = cb;
}

export function notifyRoomsChanged(): void {
  if (!onRoomsChanged) return;
  try {
    onRoomsChanged();
  } catch {
    // Persistence errors must not break in-memory room operations; the
    // persistence layer logs its own failures.
  }
}

// Task #302: lightweight GC-sweep telemetry. The intent is NOT a metrics
// pipeline; it's a few bounded counters an operator can sample (alongside
// `getCapRejectionCounters()`) to decide whether the 30s cadence needs
// tightening further. All fields are integers, no per-room history is
// retained, and the only allocations per sweep are the counter increments
// — keeping the sweep itself cheap on a server with thousands of rooms.
const gcSweepCounters = {
  // Total number of sweep cycles executed since process start (or last
  // test reset). Combined with `totalEvicted` this gives the average
  // evictions-per-sweep — the headline number for tuning the cadence.
  totalSweeps: 0,
  // Total rooms evicted across all sweeps. Includes both empty rooms
  // and rooms that still had peers at expiry (the latter also fire
  // `onRoomExpired`). Operators can subtract `getRoomCount()` from
  // historical samples to reason about churn separately from steady-state.
  totalEvicted: 0,
  // Evictions in the most recent sweep. A non-zero value here means the
  // primary per-room expiry timer dropped a room and the safety-net
  // sweep had to clean up — the metric the task author cares about.
  lastSweepEvicted: 0,
  // Largest single-sweep eviction count seen. If this climbs into the
  // hundreds on a real server, the per-sweep cost (a Map iteration plus
  // the `onRoomExpired` broadcast for each evicted room with peers) is
  // worth re-measuring before tightening `GC_INTERVAL_MS` further.
  maxSweepEvicted: 0,
  // Wall-clock timestamp of the last sweep, or 0 if the sweep has not
  // run yet. Lets an operator confirm the interval timer is alive
  // (`Date.now() - lastSweepAt < GC_INTERVAL_MS * 2`).
  lastSweepAt: 0,
};

function runGcSweep(): void {
  const now = Date.now();
  let changed = false;
  let evicted = 0;
  for (const [code, room] of rooms.entries()) {
    if (now >= room.expiresAt) {
      if (room.expiryTimer) clearTimeout(room.expiryTimer);
      if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
      if (room.users.length > 0) {
        invokeOnRoomExpired(code);
      }
      rooms.delete(code);
      changed = true;
      evicted++;
    }
  }
  gcSweepCounters.totalSweeps++;
  gcSweepCounters.totalEvicted += evicted;
  gcSweepCounters.lastSweepEvicted = evicted;
  if (evicted > gcSweepCounters.maxSweepEvicted) {
    gcSweepCounters.maxSweepEvicted = evicted;
  }
  gcSweepCounters.lastSweepAt = now;
  if (changed) notifyRoomsChanged();
}

export function getGcSweepCounters(): GcSweepCounters {
  return { ...gcSweepCounters };
}

export function __resetGcSweepCountersForTest(): void {
  gcSweepCounters.totalSweeps = 0;
  gcSweepCounters.totalEvicted = 0;
  gcSweepCounters.lastSweepEvicted = 0;
  gcSweepCounters.maxSweepEvicted = 0;
  gcSweepCounters.lastSweepAt = 0;
}

const gcTimer = setInterval(runGcSweep, GC_INTERVAL_MS);
// Match the per-room expiry `setTimeout` policy: don't keep the Node
// event loop alive solely for the GC sweep. This matters for the test
// suites that spin up and tear down servers — without unref, a 30s
// recurring timer would prolong process exit on suites that previously
// got away with the 5-minute cadence.
if (gcTimer.unref) gcTimer.unref();

// ── Simple getters ───────────────────────────────────────────────────────

export function getRoomUsers(code: string): RoomUser[] {
  return rooms.get(code)?.users ?? [];
}

export function isRoomLocked(code: string): boolean {
  return rooms.get(code)?.locked ?? false;
}

export function getRoomMaxUsers(_code: string): number {
  return MAX_USERS;
}

export function isRoomRelayOnly(code: string): boolean {
  return rooms.get(code)?.relayOnly ?? false;
}

export function getRoomType(code: string): RoomType {
  return rooms.get(code)?.roomType ?? "human";
}

export function isKnockMode(code: string): boolean {
  return rooms.get(code)?.knockMode ?? false;
}

export function roomExists(code: string): boolean {
  return rooms.has(code);
}

export function isRoomExpired(code: string): boolean {
  const room = rooms.get(code);
  if (!room) return true;
  return Date.now() >= room.expiresAt;
}

export function getRoomExpiresAt(code: string): number | null {
  return rooms.get(code)?.expiresAt ?? null;
}

export function getRoomTier(code: string): RoomTier | null {
  return rooms.get(code)?.tier ?? null;
}

// ── Host helpers ─────────────────────────────────────────────────────────

// Adds an additional reclaim token (e.g. from a paid extension) to the
// room's set of valid host-claim hashes. No-op if the room is gone or
// the token is already present. See `claimHost` for the rejoin path.
export function addHostReclaimToken(code: string, reclaimToken: string): void {
  const room = rooms.get(code);
  if (!room) return;
  if (typeof reclaimToken !== "string" || reclaimToken.length === 0) return;
  // Store the KEYED HMAC of the reclaim token, never the raw token and nothing
  // payment-derived. The set is persisted verbatim, so no payment-linkable
  // identifier ever reaches disk. Dedup on the HMAC so re-adding the same
  // extension token stays a no-op.
  const hmac = hmacReclaimToken(reclaimToken);
  if (room.hostReclaimTokenHashes.has(hmac)) return;
  room.hostReclaimTokenHashes.add(hmac);
  notifyRoomsChanged();
}

export function isRoomHost(code: string, socketId: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  // Strict identity check only. The pre-Task #171 fallback that auto-
  // promoted "first user in an empty room" to host has been removed —
  // host status now requires explicit possession of a JWT whose
  // `reclaimToken` matches `room.hostReclaimTokenHashes` (see `claimHost`).
  return room.hostSocketId === socketId;
}

// Returns the peerId of the socket currently holding host in `code`, or
// null if no current room member matches `room.hostSocketId`. Used by
// the socket layer to (a) populate the `hostPresent` field on join /
// knock-approve callbacks and (b) attach `hostPeerId` to the
// `host-changed` broadcast so guests can render a "host offline" pill
// when moderation goes silent (Task #190).
export function getHostPeerId(code: string): string | null {
  const room = rooms.get(code);
  if (!room || room.hostSocketId === null) return null;
  const hostUser = room.users.find((u) => u.socketId === room.hostSocketId);
  return hostUser?.peerId ?? null;
}

// Atomically grant host on rejoin. Succeeds iff:
//   1. The room still exists.
//   2. No other socket currently holds host (`hostSocketId === null`).
//   3. The caller is already a member of the room (joinRoom landed first).
//   4. The caller's `reclaimToken` is in `room.hostReclaimTokenHashes` —
//      i.e. it was either the original creation JWT's token or one
//      added later via `addHostReclaimToken` on a paid extension.
//
// Idempotent: if the caller is already host, returns success without
// changing state.
export function claimHost(
  code: string,
  socketId: string,
  reclaimToken: string,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };
  if (room.hostSocketId === socketId) return { success: true };
  if (room.hostSocketId !== null) return { success: false, error: "HOST_PRESENT" };
  if (typeof reclaimToken !== "string" || reclaimToken.length === 0) {
    return { success: false, error: "PAYMENT_HASH_MISMATCH" };
  }
  // The stored set holds the KEYED HMAC of each entitled reclaim token, not
  // the raw token (and nothing payment-derived). HMAC the incoming token with
  // the same `PAYWALL_SECRET` and compare HMAC-to-HMAC. A snapshot written by
  // an older build holds a payment-derived value that won't match (migration
  // is "fail and re-pay" — that host re-pays once; we deliberately don't
  // upconvert).
  //
  // Leakage profile, stated precisely (Audit M-2, task #464):
  //   - We iterate the FULL set on every call (no early exit on match) and
  //     OR the per-entry results, so the MATCHING INDEX does not leak via
  //     timing.
  //   - Each per-entry comparison is `crypto.timingSafeEqual` over the byte
  //     buffers, so the per-byte content of a stored HMAC does not leak.
  //   - HMAC-SHA256 outputs are FIXED length (64 hex chars), so every
  //     comparison is genuinely length-uniform; the length-padding +
  //     length-equality fold-in below is now a no-op for well-formed
  //     entries but is kept defensively so a malformed (legacy raw) stored
  //     entry of a different length still compares in constant time rather
  //     than throwing.
  //   - What is NOT hidden: runtime is O(|hostReclaimTokenHashes|), so the set
  //     CARDINALITY is observable. That equals `1 + (extensions paid)`,
  //     which an attacker can already correlate from /paywall invoices, so
  //     no new information leaks.
  // The wire-core package intentionally does NOT re-export
  // `timingSafeStringCompare` (see lib/wire-core/src/brand.ts —
  // rollup chokes on the node:crypto specifier). On the server we have
  // node:crypto first-class, so we inline the same construction: pad to the
  // longer length with zero bytes, run `timingSafeEqual`, then fold in the
  // length mismatch.
  const target = Buffer.from(hmacReclaimToken(reclaimToken), "utf8");
  let matched = false;
  for (const stored of room.hostReclaimTokenHashes) {
    const a = Buffer.from(stored, "utf8");
    const len = Math.max(a.length, target.length);
    const aPad = Buffer.alloc(len);
    const bPad = Buffer.alloc(len);
    a.copy(aPad);
    target.copy(bPad);
    const eq = timingSafeEqual(aPad, bPad) && a.length === target.length;
    matched = matched || eq;
  }
  if (!matched) {
    return { success: false, error: "PAYMENT_HASH_MISMATCH" };
  }
  if (!room.users.some((u) => u.socketId === socketId)) {
    return { success: false, error: "NOT_IN_ROOM" };
  }
  room.hostSocketId = socketId;
  return { success: true };
}

// ── Test-only timer/state escape hatches ────────────────────────────────

// Test-only: forcibly mark an existing room as expired by rewinding its
// `expiresAt` to one millisecond in the past. Used by the integration
// suite to verify the per-event expiry guard (Task #55) rejects in-room
// operations on an expired room without having to wait out the real
// per-tier TTL (minimum 60s by `ROOM_TTL_MIN_MS`). The hard-cleanup
// `setTimeout` scheduled in `createRoom` is left intact — `isRoomExpired`
// will report `true` immediately based on the rewritten `expiresAt`,
// which is all the per-event guard needs to flip.
export function __forceExpireRoomForTest(code: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  room.expiresAt = Date.now() - 1;
  return true;
}

// Test-only: directly invoke the GC sweep function. The production GC
// `setInterval` is created at module-load time with real timers, so
// `vi.advanceTimersByTime` cannot drive it from test setup. Calling this
// function bypasses the timer entirely and exercises the same sweep logic
// path. Used by the GC safety-net regression test (Task #201).
export function __triggerGcSweepForTest(): void {
  runGcSweep();
}

// Test-only: clear a room's per-room `expiryTimer` reference without
// cancelling it (simulates the timer having fired or been lost, so that
// the GC sweep becomes the sole cleanup mechanism). Used by the GC
// safety-net regression test (Task #201) to verify the sweep still
// removes the room and fires `onRoomExpired` when the per-room timer is
// unavailable.
export function __clearRoomExpiryTimerForTest(code: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  room.expiryTimer = null;
  return true;
}

// Test-only: warp an existing room's `expiresAt` to a specific instant.
// Used by the paywall extension regression test (Task #141) to simulate
// a host who has been in their room for most of the paid window — without
// this we can't construct a "day" tier room near its end-of-window state
// (the room is created at the full 24h ROOM_TTL_MAX_MS ceiling, which
// `extendRoomExpiry` clamps to, masking any bug in the additionalMs
// calculation). Like `__forceExpireRoomForTest`, this leaves the hard
// cleanup timer alone — the per-event guards consult `expiresAt`, which
// is what the test exercises.
export function __setRoomExpiresAtForTest(code: string, expiresAt: number): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  room.expiresAt = expiresAt;
  return true;
}

// ── Identity-free room-state snapshot (timing-equalized) ─────────────────

// Codepath equalization (NOT a string/byte secret comparison): the
// three "no live room" branches — never-existed, expired, destroyed —
// must all reach `return null` through the same shape of work, so an
// off-path observer can't use response time to distinguish them.
// There is no secret value being compared here; the input `code` is
// the room ID derived from the phrase by the joiner (already known
// to the requester) and the only "compare" is `now >= expiresAt`,
// which is an integer compare against a non-secret timestamp. This
// is why the function does not — and should not — call
// `timingSafeStringCompare`: there is no secret-vs-secret string
// equality on this path. See docs/security-audit-public-2026-04.md
// §3.9 (constant-time sweep) for the reasoning.
//
// All three null paths execute the same operations: one Map.get, one
// optional property read (with a 0 fallback), one Date.now call, one
// numeric comparison, one return. The expiry compare is placed first
// in the `if` so its short-circuit fires for every null path — miss
// paths trip on `now >= 0` (which is always true), expired paths trip
// on `now >= room.expiresAt`. Both are a single integer compare. The
// `!room` branch is only reached on the live-room path, where we then
// fall through to build the snapshot. This keeps the compute uniform
// across the three null branches.
//
// The live-room path is intentionally not equalized — its larger JSON
// body is already trivially distinguishable on the wire, so hiding it
// from a timing observer would be theatre.
//
// Note: this is a coarse mitigation against accidental order-of-
// magnitude divergence between the null paths, not a guarantee of
// strict constant-time behavior. Sub-microsecond V8 hash-table noise
// (cache effects, tombstones, etc.) is below what the proof endpoint
// can plausibly defend against. The regression test in
// `__tests__/room-state-timing.test.ts` enforces the coarse bound.
export function getRoomState(code: string): RoomStateSnapshot | null {
  const room = rooms.get(code);
  const expiresAt = room?.expiresAt ?? 0;
  const now = Date.now();
  if (now >= expiresAt || !room) return null;
  return {
    exists: true,
    tier: room.tier,
    expiresAt: room.expiresAt,
    participantCount: room.users.length,
    relayOnly: room.relayOnly,
  };
}
