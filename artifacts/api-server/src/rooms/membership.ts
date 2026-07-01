// SPDX-License-Identifier: AGPL-3.0-or-later
import { MAX_USERS, type RoomUser, type PendingKnock } from "./types";
import { rooms, isRoomHost, notifyRoomsChanged } from "./registry";
import { clearScreenShareForSocket } from "./screenShare";

// Audit H-05 (task #464): hard cap on per-room `pendingKnocks` length.
// Without this, a botnet that sustains ~50 knocks/IP/min against a knock-
// enabled room grows the array indefinitely — chewing memory and flooding
// the host's UI list past the point of usability on mobile. The cap of 32
// is generous (8× MAX_USERS) so a legitimate stampede of joiners is never
// rejected, but well below the size at which the host's list becomes
// noise. New knocks beyond the cap are rejected with `KNOCK_QUEUE_FULL`;
// existing pending entries are preserved (no eviction) so legitimate
// in-flight knocks aren't displaced by an attacker's flood.
export const MAX_PENDING_KNOCKS = 32;

export function joinRoom(
  code: string,
  socketId: string,
  peerId: string,
  allowCreate: boolean = false,
): { success: boolean; error?: string; users: RoomUser[]; locked: boolean; maxUsers: number; knockPending?: boolean } {
  let room = rooms.get(code);

  if (!room && !allowCreate) {
    return { success: false, error: "ROOM_NOT_FOUND", users: [], locked: false, maxUsers: MAX_USERS };
  }

  if (!room) {
    const now = Date.now();
    const capturedCreatedAt = now;
    const ROOM_TTL_MS = 65 * 60 * 1000;
    const expiryTimer = setTimeout(() => {
      const r = rooms.get(code);
      if (!r || r.createdAt !== capturedCreatedAt) return;
      if (r.screenShareReservationTimer) clearTimeout(r.screenShareReservationTimer);
      // Note: this legacy/test create path historically did NOT call
      // `onRoomExpired` (no socket layer was wired up). Preserve that
      // behavior verbatim.
      rooms.delete(code);
    }, ROOM_TTL_MS);
    if (expiryTimer.unref) expiryTimer.unref();
    rooms.set(code, {
      users: [],
      hostSocketId: null,
      // No reclaim token on this code path: this branch only runs when
      // `joinRoom` is called with `allowCreate=true` (legacy/test path)
      // and there is no JWT in scope. Such rooms can never have a host
      // claimed via `claimHost` — which is the safe default.
      hostReclaimTokenHashes: new Set<string>(),
      locked: false,
      lockedBy: null,
      knockMode: false,
      knockModeBy: null,
      pendingKnocks: [],
      relayOnly: false,
      roomType: "human",
      tier: "standard",
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      expiryTimer,
      activeScreenSharePeerId: null,
      screenShareReservation: null,
      screenShareReservationTimer: null,
    });
    room = rooms.get(code)!;
  }

  if (Date.now() >= room.expiresAt) {
    return { success: false, error: "ROOM_EXPIRED", users: [], locked: false, maxUsers: MAX_USERS };
  }

  const users = room.users;

  const alreadyIn = users.some((u) => u.socketId === socketId);
  if (alreadyIn) {
    return { success: true, users, locked: room.locked, maxUsers: MAX_USERS };
  }

  if (room.locked) {
    return { success: false, error: "ROOM_LOCKED", users, locked: true, maxUsers: MAX_USERS };
  }

  if (room.knockMode && room.users.length > 0) {
    const alreadyPending = room.pendingKnocks.some((k) => k.socketId === socketId);
    if (!alreadyPending) {
      // Audit H-05 (task #464): cap the queue. Existing pending entries
      // (including this socket's earlier knock, handled by `alreadyPending`
      // above) are never evicted, so an attacker flooding `join-room`
      // can't displace a legitimate knocker. Returns KNOCK_QUEUE_FULL +
      // knockPending:false so the joiner's UI shows the room is too busy
      // rather than spinning on a knock that will never be approved.
      if (room.pendingKnocks.length >= MAX_PENDING_KNOCKS) {
        return { success: false, error: "KNOCK_QUEUE_FULL", users, locked: false, maxUsers: MAX_USERS, knockPending: false };
      }
      room.pendingKnocks.push({ socketId, peerId, knockedAt: Date.now() });
    }
    return { success: false, error: "KNOCK_PENDING", users, locked: false, maxUsers: MAX_USERS, knockPending: true };
  }

  if (users.length >= MAX_USERS) {
    return { success: false, error: "ROOM_FULL", users, locked: room.locked, maxUsers: MAX_USERS };
  }

  const updated = [...users, { socketId, peerId }];
  room.users = updated;
  // Note: host is NOT auto-granted on join (Task #171). The pre-fix
  // behavior promoted the first joiner of an empty-but-not-expired room
  // to host, which let any phrase-holder hijack moderation control of
  // a room they never paid for. Host status is now claimed only via
  // `claimHost(paymentHash)` in the socket layer.
  return { success: true, users: updated, locked: room.locked, maxUsers: MAX_USERS };
}

export function approveKnock(
  code: string,
  hostSocketId: string,
  knockPeerId: string,
): { success: boolean; error?: string; knock?: PendingKnock } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (!isRoomHost(code, hostSocketId)) return { success: false, error: "NOT_HOST" };

  const knockIdx = room.pendingKnocks.findIndex((k) => k.peerId === knockPeerId);
  if (knockIdx === -1) return { success: false, error: "KNOCK_NOT_FOUND" };

  const knock = room.pendingKnocks[knockIdx];

  if (room.users.length >= MAX_USERS) {
    return { success: false, error: "ROOM_FULL" };
  }

  room.pendingKnocks.splice(knockIdx, 1);
  room.users.push({ socketId: knock.socketId, peerId: knock.peerId });
  return { success: true, knock };
}

export function denyKnock(
  code: string,
  hostSocketId: string,
  knockPeerId: string,
): { success: boolean; error?: string; knock?: PendingKnock } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (!isRoomHost(code, hostSocketId)) return { success: false, error: "NOT_HOST" };

  const knockIdx = room.pendingKnocks.findIndex((k) => k.peerId === knockPeerId);
  if (knockIdx === -1) return { success: false, error: "KNOCK_NOT_FOUND" };

  const knock = room.pendingKnocks[knockIdx];
  room.pendingKnocks.splice(knockIdx, 1);
  return { success: true, knock };
}

export function setKnockMode(
  code: string,
  socketId: string,
  enabled: boolean,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };

  room.knockMode = enabled;
  room.knockModeBy = enabled ? socketId : null;
  if (!enabled) {
    room.pendingKnocks = [];
  }
  return { success: true };
}

export function removePendingKnockBySocket(code: string, socketId: string): PendingKnock | null {
  const room = rooms.get(code);
  if (!room) return null;
  const idx = room.pendingKnocks.findIndex((k) => k.socketId === socketId);
  if (idx === -1) return null;
  const [knock] = room.pendingKnocks.splice(idx, 1);
  return knock;
}

export function lockRoom(
  code: string,
  socketId: string,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };

  if (room.locked) return { success: true };

  room.locked = true;
  room.lockedBy = socketId;
  notifyRoomsChanged();
  return { success: true };
}

export function unlockRoom(
  code: string,
  socketId: string,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };

  if (!room.locked) return { success: true };

  room.locked = false;
  room.lockedBy = null;
  notifyRoomsChanged();
  return { success: true };
}

// Flip an existing room into relay-only mode. Used by the cooperative
// "any peer can suggest, host decides" flow (Task #106): a non-host peer
// emits `request-relay-only`; if the host accepts, the socket layer calls
// this to commit the change before broadcasting `room-relay-mode-enabled`.
//
// Host-only by design — the privacy lever still belongs to the room owner.
// Idempotent: a second host-driven flip after the room is already relay-
// only returns success with `alreadyEnabled: true` so the broadcast can be
// suppressed (no need to re-negotiate ICE that's already restricted).
export function enableRelayOnly(
  code: string,
  socketId: string,
): { success: boolean; error?: string; alreadyEnabled?: boolean } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };
  if (!isRoomHost(code, socketId)) return { success: false, error: "NOT_HOST" };
  if (room.relayOnly) return { success: true, alreadyEnabled: true };
  room.relayOnly = true;
  notifyRoomsChanged();
  return { success: true };
}

export function leaveRoom(
  code: string,
  socketId: string,
): { remainingUsers: RoomUser[]; departedPeerId: string | null; screenShareCleared: boolean; hostDeparted: boolean } {
  const room = rooms.get(code);
  const users = room?.users ?? [];
  const departed = users.find((u) => u.socketId === socketId);
  const screenShareCleared = clearScreenShareForSocket(code, socketId);
  const wasHost = !!room && room.hostSocketId === socketId;
  const updated = users.filter((u) => u.socketId !== socketId);
  if (updated.length === 0 && room) {
    room.users = updated;
    room.hostSocketId = null;
    room.locked = false;
    room.lockedBy = null;
    room.knockMode = false;
    room.knockModeBy = null;
    room.pendingKnocks = [];
  } else if (room) {
    const wasLockedByDeparted = room.lockedBy === socketId;
    const wasKnockByDeparted = room.knockModeBy === socketId;
    room.users = updated;
    // Task #190: when the host leaves with peers still in the room, the
    // moderation slot must visibly empty so (a) guests can see "no host
    // present" and (b) the original payer can later reclaim host on
    // rejoin (`claimHost` requires `hostSocketId === null`). Without
    // this, the slot would stay pinned to the now-stale socket id —
    // leaving the room in a "ghost host" state that no current member
    // could ever satisfy.
    if (wasHost) {
      room.hostSocketId = null;
    }
    if (wasLockedByDeparted) {
      room.locked = false;
      room.lockedBy = null;
    }
    if (wasKnockByDeparted) {
      room.knockMode = false;
      room.knockModeBy = null;
      room.pendingKnocks = [];
    }
  }
  // `hostDeparted` is true only when other peers remain — when the room
  // empties there's no audience for a `host-changed` broadcast.
  const hostDeparted = wasHost && updated.length > 0;
  return { remainingUsers: updated, departedPeerId: departed?.peerId ?? null, screenShareCleared, hostDeparted };
}

export function leaveAllRooms(
  socketId: string,
): Array<{ code: string; remainingUsers: RoomUser[]; departedPeerId: string; unlocked: boolean; screenShareCleared: boolean; hostDeparted: boolean }> {
  const affected: Array<{ code: string; remainingUsers: RoomUser[]; departedPeerId: string; unlocked: boolean; screenShareCleared: boolean; hostDeparted: boolean }> = [];
  for (const [code, room] of rooms.entries()) {
    room.pendingKnocks = room.pendingKnocks.filter((k) => k.socketId !== socketId);

    const departed = room.users.find((u) => u.socketId === socketId);
    if (departed) {
      const screenShareCleared = clearScreenShareForSocket(code, socketId);
      const wasHost = room.hostSocketId === socketId;
      const updated = room.users.filter((u) => u.socketId !== socketId);
      const wasLockedByDeparted = room.lockedBy === socketId;
      const wasKnockByDeparted = room.knockModeBy === socketId;
      if (updated.length === 0) {
        room.users = updated;
        room.hostSocketId = null;
        room.locked = false;
        room.lockedBy = null;
        room.knockMode = false;
        room.knockModeBy = null;
        room.pendingKnocks = [];
      } else {
        room.users = updated;
        // Task #190: same host-slot vacate as `leaveRoom` — mirror it
        // here so disconnect-driven host departures (tab close, network
        // drop) also leave the slot reclaimable and surface a
        // `host-changed` broadcast to the remaining peers.
        if (wasHost) {
          room.hostSocketId = null;
        }
        if (wasLockedByDeparted) {
          room.locked = false;
          room.lockedBy = null;
        }
        if (wasKnockByDeparted) {
          room.knockMode = false;
          room.knockModeBy = null;
          room.pendingKnocks = [];
        }
      }
      // `hostDeparted` is true only when other peers remain — when the
      // room empties there's no audience for a `host-changed` broadcast.
      const hostDeparted = wasHost && updated.length > 0;
      affected.push({ code, remainingUsers: updated, departedPeerId: departed.peerId, unlocked: wasLockedByDeparted, screenShareCleared, hostDeparted });
    }
  }
  return affected;
}
