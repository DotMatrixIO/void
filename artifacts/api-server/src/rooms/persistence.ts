// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RoomTier, RoomType } from "./types";
import {
  rooms,
  notifyRoomsChanged,
  invokeOnRoomExpired,
} from "./registry";

// Task #310: persistable snapshot of the room registry. Used by the
// on-disk persistence layer so that a SIGTERM → restart cycle (or a
// crash) doesn't strand existing peers — late joiners and reconnects
// can still reach the room after the server comes back.
//
// Persisted fields are deliberately limited to "what the host paid for"
// + "moderation flags the host set explicitly":
//   - hostReclaimTokenHashes: who is allowed to reclaim host on rejoin. Stored
//     as KEYED HMACs — `HMAC(PAYWALL_SECRET, reclaimToken)` — of per-room
//     RECLAIM TOKENS that are decoupled from the Lightning `paymentHash`;
//     nothing payment-derived is ever written. The in-memory set already holds
//     the HMACs (see `createRoom` / `addHostReclaimToken`), so persist and
//     rehydrate are verbatim pass-throughs; a seized snapshot file (even with
//     the server secret) cannot be correlated against Lightning settlement
//     records.
//   - createdAt / expiresAt / tier / roomType: defines the paid window
//     and which capacity bucket the room belongs to.
//   - relayOnly: privacy lever the host (or a peer + host) set.
//   - locked: moderation state the host explicitly toggled.
//
// Volatile per-socket state is intentionally NOT persisted:
//   - users, hostSocketId: every socket is dead after restart; peers
//     reconnect and re-claim their seats.
//   - pendingKnocks, knockMode: the host is gone, the knockers are
//     gone, and the host can re-toggle on rejoin.
//   - screen-share reservation / active: dies with the sharer's socket.
export const PERSISTED_ROOMS_VERSION = 1 as const;

export interface PersistedRoomV1 {
  code: string;
  createdAt: number;
  expiresAt: number;
  tier: RoomTier;
  roomType: RoomType;
  relayOnly: boolean;
  locked: boolean;
  hostReclaimTokenHashes: string[];
}

export function getPersistableSnapshot(): PersistedRoomV1[] {
  const out: PersistedRoomV1[] = [];
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (now >= room.expiresAt) continue;
    out.push({
      code,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      tier: room.tier,
      roomType: room.roomType,
      relayOnly: room.relayOnly,
      locked: room.locked,
      hostReclaimTokenHashes: Array.from(room.hostReclaimTokenHashes),
    });
  }
  return out;
}

// Rebuilds the in-memory rooms map from a persisted snapshot. Used at
// process startup. Skips any record whose `expiresAt` has already
// passed (we don't want to resurrect a room the operator restart
// straddled the expiry of). Schedules a fresh per-room expiry timer
// for the REMAINING window. Does NOT clobber an existing in-memory
// room with the same code — startup rehydrate runs before any socket
// can connect, so collisions are not expected, but we err on the side
// of preserving live state rather than overwriting it.
//
// Returns the count of rooms actually rehydrated, for the startup log.
export function rehydratePersistedRooms(records: PersistedRoomV1[]): number {
  if (!Array.isArray(records)) return 0;
  const now = Date.now();
  let rehydrated = 0;
  for (const rec of records) {
    if (!rec || typeof rec !== "object") continue;
    if (typeof rec.code !== "string" || rec.code.length === 0) continue;
    if (rooms.has(rec.code)) continue;
    if (typeof rec.expiresAt !== "number" || now >= rec.expiresAt) continue;
    if (typeof rec.createdAt !== "number") continue;
    const tier: RoomTier = rec.tier === "day" ? "day" : "standard";
    // VOID is human-only. Any persisted record — including legacy records
    // written when other room types still existed — coerces to the single
    // supported "human" type. This MUST tolerate (not crash on) an
    // unrecognized/legacy `roomType` value.
    const roomType: RoomType = "human";
    const hashes = Array.isArray(rec.hostReclaimTokenHashes)
      ? rec.hostReclaimTokenHashes.filter((h): h is string => typeof h === "string" && h.length > 0)
      : [];
    const code = rec.code;
    const capturedCreatedAt = rec.createdAt;
    const remaining = rec.expiresAt - now;
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

    rooms.set(code, {
      users: [],
      hostSocketId: null,
      hostReclaimTokenHashes: new Set(hashes),
      locked: rec.locked === true,
      lockedBy: null,
      knockMode: false,
      knockModeBy: null,
      pendingKnocks: [],
      relayOnly: rec.relayOnly === true,
      roomType,
      tier,
      createdAt: rec.createdAt,
      expiresAt: rec.expiresAt,
      expiryTimer,
      activeScreenSharePeerId: null,
      screenShareReservation: null,
      screenShareReservationTimer: null,
    });
    rehydrated++;
  }
  return rehydrated;
}
