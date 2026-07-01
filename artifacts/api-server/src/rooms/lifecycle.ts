// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  ROOM_TTL_MS,
  ROOM_TTL_MIN_MS,
  ROOM_TTL_MAX_MS,
  type RoomType,
  type RoomTier,
} from "./types";
import {
  rooms,
  isRoomHost,
  notifyRoomsChanged,
  invokeOnRoomExpired,
} from "./registry";
import { hmacReclaimToken } from "../lib/hostHashHmac";

export function createRoom(
  code: string,
  relayOnly: boolean = false,
  hostSocketId?: string,
  roomType: RoomType = "human",
  ttlMs?: number,
  tier: RoomTier = "standard",
  hostReclaimToken: string | null = null,
): void {
  if (!rooms.has(code)) {
    const effectiveRelay = relayOnly;
    const now = Date.now();
    const requestedTtl = typeof ttlMs === "number" && Number.isFinite(ttlMs) ? ttlMs : ROOM_TTL_MS;
    const effectiveTtl = Math.min(Math.max(requestedTtl, ROOM_TTL_MIN_MS), ROOM_TTL_MAX_MS);
    const expiresAt = now + effectiveTtl;
    // Stale-timer guard (Task #127). A room can be destroyed and a new
    // one created under the same `code` before this `setTimeout` fires
    // (host hits "burn", or the room expires and is recreated by a
    // fresh paid invoice within the TTL window). The captured
    // `createdAt` binds this timer to THIS instantiation only — the
    // callback no-ops if the current room's `createdAt` has changed.
    // Do not collapse this into a plain `clearTimeout` reference: that
    // covers the explicit-destroy path but not the create-then-create
    // race, which has no chance to clear the timer.
    const capturedCreatedAt = now;
    const expiryTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r || r.createdAt !== capturedCreatedAt) return;
      if (r.screenShareReservationTimer) clearTimeout(r.screenShareReservationTimer);
      if (r.users.length > 0) {
        invokeOnRoomExpired(code);
      }
      rooms.delete(code);
      notifyRoomsChanged();
    }, effectiveTtl);
    if (expiryTimer.unref) expiryTimer.unref();

    rooms.set(code, {
      users: [],
      hostSocketId: hostSocketId ?? null,
      // Store the KEYED HMAC of the per-room reclaim token, never the raw
      // token and nothing derived from the `paymentHash`. The set is the
      // in-memory comparison form and is persisted verbatim, so no
      // payment-linkable identifier ever reaches `data/rooms.json`. See
      // `claimHost`, which HMACs the incoming reclaim token before comparing.
      hostReclaimTokenHashes: hostReclaimToken
        ? new Set([hmacReclaimToken(hostReclaimToken)])
        : new Set(),
      locked: false,
      lockedBy: null,
      knockMode: false,
      knockModeBy: null,
      pendingKnocks: [],
      relayOnly: effectiveRelay,
      roomType,
      tier,
      createdAt: now,
      expiresAt,
      expiryTimer,
      activeScreenSharePeerId: null,
      screenShareReservation: null,
      screenShareReservationTimer: null,
    });
    notifyRoomsChanged();
  }
}

export function destroyRoom(code: string, socketId: string): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };
  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };

  if (room.expiryTimer) clearTimeout(room.expiryTimer);
  if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
  rooms.delete(code);
  notifyRoomsChanged();
  return { success: true };
}

// BURN — the privacy panic teardown (Task #696). Unlike `destroyRoom`
// (a host-only moderation control) this destroys the room when ANY
// current member of it burns. The "Burn" UI promises "session burned,
// all keys destroyed" for everyone; a joiner who only `leave-room`s
// would leave the phrase live and re-joinable, which is a security
// failure. Authorization is MEMBERSHIP, not host: the caller's socket
// must currently be in the room. The teardown itself is identical to
// `destroyRoom` (clear timers, drop the room from the in-memory Map so
// the phrase can no longer be re-joined, notify the rooms-changed
// listeners). The host-only `destroyRoom` contract is intentionally
// left unchanged so the moderation security model (Audit M-02) holds.
export function burnRoom(code: string, socketId: string): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };
  if (!room.users.some((u) => u.socketId === socketId)) {
    return { success: false, error: "NOT_IN_ROOM" };
  }

  if (room.expiryTimer) clearTimeout(room.expiryTimer);
  if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
  rooms.delete(code);
  notifyRoomsChanged();
  return { success: true };
}

/**
 * Extend a live room's expiry by `additionalMs`, capped so the new expiry
 * doesn't exceed `now + ROOM_TTL_MAX_MS`. Replaces the per-room expiry timer
 * with one scheduled for the new remaining window.
 *
 * If `newTier` is provided, the room's stored tier is updated to match —
 * last paid tier wins. This keeps `getRoomTier()` (and the join-room
 * callback that surfaces it to reconnecting peers) consistent with the
 * `room-extended` broadcast tier value.
 *
 * Errors:
 *   - ROOM_NOT_FOUND: no such room
 *   - NOT_HOST: caller's socket isn't the host
 *   - ROOM_EXPIRED: room already past its current expiresAt
 *   - INVALID_EXTENSION: additionalMs is not a positive finite number
 *   - EXTENSION_CAPPED: room is already at the 24h ceiling, can't go further
 */
export function extendRoomExpiry(
  code: string,
  additionalMs: number,
  socketId: string,
  newTier?: RoomTier,
): { success: boolean; error?: string; expiresAt?: number } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };
  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };

  const now = Date.now();
  if (now >= room.expiresAt) return { success: false, error: "ROOM_EXPIRED" };

  if (!Number.isFinite(additionalMs) || additionalMs <= 0) {
    return { success: false, error: "INVALID_EXTENSION" };
  }

  const ceiling = now + ROOM_TTL_MAX_MS;
  const proposed = room.expiresAt + additionalMs;
  const newExpiresAt = Math.min(proposed, ceiling);
  if (newExpiresAt <= room.expiresAt) {
    return { success: false, error: "EXTENSION_CAPPED", expiresAt: room.expiresAt };
  }

  if (room.expiryTimer) clearTimeout(room.expiryTimer);

  const capturedCreatedAt = room.createdAt;
  const remaining = newExpiresAt - now;
  const expiryTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (!r || r.createdAt !== capturedCreatedAt) return;
    if (r.screenShareReservationTimer) clearTimeout(r.screenShareReservationTimer);
    if (r.users.length > 0) {
      invokeOnRoomExpired(code);
    }
    rooms.delete(code);
    notifyRoomsChanged();
  }, remaining);
  if (expiryTimer.unref) expiryTimer.unref();

  room.expiresAt = newExpiresAt;
  room.expiryTimer = expiryTimer;
  if (newTier) room.tier = newTier;

  notifyRoomsChanged();
  return { success: true, expiresAt: newExpiresAt };
}

// Shutdown helper. On SIGTERM the api-server broadcasts a
// `server-shutdown` notice and exits within a short drain window — but
// every room still holds a `setTimeout` for its TTL expiry, and Node will
// not exit until those timers are either cleared or fired. Iterating
// every room and clearing its expiry + screen-share-reservation timers
// lets the process exit cleanly inside the drain window instead of
// blocking on a multi-hour day-tier timer. The room map itself is
// in-memory only and dies with the process, so we deliberately do NOT
// touch room state here — only the timers, which are the only handles
// keeping the event loop alive.
export function clearAllExpiryTimers(): void {
  for (const room of rooms.values()) {
    if (room.expiryTimer) {
      clearTimeout(room.expiryTimer);
      room.expiryTimer = null;
    }
    if (room.screenShareReservationTimer) {
      clearTimeout(room.screenShareReservationTimer);
      room.screenShareReservationTimer = null;
    }
  }
}
