// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import { SCREEN_SHARE_RESERVATION_TTL_MS } from "./types";
import { rooms } from "./registry";

let onReservationExpired: ((code: string, peerId: string) => void) | null = null;

export function setOnScreenShareReservationExpired(cb: (code: string, peerId: string) => void): void {
  onReservationExpired = cb;
}

export function getScreenShareState(code: string): { activeScreenSharePeerId: string | null; reservedByPeerId: string | null } {
  const room = rooms.get(code);
  if (!room) return { activeScreenSharePeerId: null, reservedByPeerId: null };
  const now = Date.now();
  if (room.screenShareReservation && now >= room.screenShareReservation.expiresAt) {
    if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
    room.screenShareReservation = null;
    room.screenShareReservationTimer = null;
  }
  return {
    activeScreenSharePeerId: room.activeScreenSharePeerId,
    reservedByPeerId: room.screenShareReservation?.peerId ?? null,
  };
}

export function requestScreenShare(
  code: string,
  socketId: string,
  peerId: string,
): { success: boolean; error?: string; nonce?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  const sender = room.users.find((u) => u.socketId === socketId && u.peerId === peerId);
  if (!sender) return { success: false, error: "NOT_IN_ROOM" };

  if (room.activeScreenSharePeerId) return { success: false, error: "SLOT_OCCUPIED" };

  const now = Date.now();
  if (room.screenShareReservation) {
    if (now < room.screenShareReservation.expiresAt) {
      return { success: false, error: "SLOT_RESERVED" };
    }
    if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
    room.screenShareReservation = null;
    room.screenShareReservationTimer = null;
  }

  // Per-grant idempotency nonce (Task #303). 16 random bytes hex-encoded
  // is far more than the dedup window needs — collisions across the
  // 12-second reservation TTL are vanishingly unlikely. Returned to the
  // requester so the client can ignore a duplicated grant ack and avoid
  // promoting the same grant twice.
  const nonce = crypto.randomBytes(16).toString("hex");
  room.screenShareReservation = { peerId, socketId, expiresAt: now + SCREEN_SHARE_RESERVATION_TTL_MS, nonce };
  room.screenShareReservationTimer = setTimeout(() => {
    const r = rooms.get(code);
    if (r && r.screenShareReservation && r.screenShareReservation.peerId === peerId) {
      r.screenShareReservation = null;
      r.screenShareReservationTimer = null;
      if (onReservationExpired) onReservationExpired(code, peerId);
    }
  }, SCREEN_SHARE_RESERVATION_TTL_MS);

  return { success: true, nonce };
}

export function confirmScreenShare(
  code: string,
  socketId: string,
  peerId: string,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  if (room.activeScreenSharePeerId) return { success: false, error: "SLOT_OCCUPIED" };

  if (!room.screenShareReservation || room.screenShareReservation.peerId !== peerId || room.screenShareReservation.socketId !== socketId) {
    return { success: false, error: "NO_RESERVATION" };
  }

  if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
  room.screenShareReservation = null;
  room.screenShareReservationTimer = null;
  room.activeScreenSharePeerId = peerId;
  return { success: true };
}

export function stopScreenShare(
  code: string,
  socketId: string,
  peerId: string,
): { success: boolean; error?: string } {
  const room = rooms.get(code);
  if (!room) return { success: false, error: "ROOM_NOT_FOUND" };

  const sender = room.users.find((u) => u.socketId === socketId && u.peerId === peerId);
  if (!sender) return { success: false, error: "NOT_IN_ROOM" };

  if (room.screenShareReservation && room.screenShareReservation.peerId === peerId && room.screenShareReservation.socketId === socketId) {
    if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
    room.screenShareReservation = null;
    room.screenShareReservationTimer = null;
    return { success: true };
  }

  if (room.activeScreenSharePeerId === peerId) {
    room.activeScreenSharePeerId = null;
    return { success: true };
  }

  return { success: false, error: "NOT_SHARING" };
}

// Internal helper used by membership leave paths. Exported here so
// `membership.ts` (which owns leaveRoom / leaveAllRooms) can call it
// without reaching back into screen-share private state.
export function clearScreenShareForSocket(code: string, socketId: string): boolean {
  const room = rooms.get(code);
  if (!room) return false;
  let cleared = false;

  if (room.screenShareReservation && room.screenShareReservation.socketId === socketId) {
    if (room.screenShareReservationTimer) clearTimeout(room.screenShareReservationTimer);
    room.screenShareReservation = null;
    room.screenShareReservationTimer = null;
    cleared = true;
  }

  const user = room.users.find((u) => u.socketId === socketId);
  if (user && room.activeScreenSharePeerId === user.peerId) {
    room.activeScreenSharePeerId = null;
    cleared = true;
  }

  return cleared;
}
