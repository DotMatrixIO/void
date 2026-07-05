// SPDX-License-Identifier: AGPL-3.0-or-later
// SignalingRelay service (Task #447 step 4).
//
// Owns the wire-side forwarding of opaque encrypted payloads between
// peers — `relay-signal` (offer/answer/ICE candidates encrypted by the
// client's secure-channel layer) and `peer-secure-channel-retry` (the
// cooperative "drop your per-peer failure entry" nudge from Task #229).
//
// Deliberately has NO knowledge of room lifecycle, auth, or screen
// share — it only knows: "given a sender socket and a target peerId in
// the same live room, forward this opaque payload." Room expiry guards
// and rate-limit checks happen UPSTREAM in the socketHandlers router
// before this service is called.

import type { Server as SocketIOServer, Socket } from "socket.io";
import { getRoomUsers } from "../rooms";
import { RELAY_SIGNAL_MAX_PAYLOAD_BYTES } from "./socketRateLimits";

/** Forward a `relay-signal` event from `sender` to the peer named
 *  `toPeerId` in the same room. Silently drops the event when:
 *   - sender isn't a member of the room (spoofing attempt)
 *   - sender's stored peerId doesn't match `fromPeerId` (spoofing attempt)
 *   - target peer isn't in the room (peer dropped between events)
 *   - payload exceeds RELAY_SIGNAL_MAX_PAYLOAD_BYTES (audit R-N3)
 *
 * Silent return matches the fire-and-forget shape of the handler — a
 * misbehaving or hostile client gets no feedback channel to probe the
 * cap or membership state with.
 */
export function relaySignal(
  io: SocketIOServer,
  sender: Socket,
  code: string,
  fromPeerId: string,
  toPeerId: string,
  payload: unknown,
): void {
  // Task #241 / audit R-N3: bound the opaque encrypted payload before
  // doing any room lookups or broadcasting. Real WebRTC SDP / ICE blobs
  // encrypted by the client are well under 16 KiB; 64 KiB leaves
  // comfortable headroom.
  if (typeof payload === "string") {
    if (Buffer.byteLength(payload, "utf8") > RELAY_SIGNAL_MAX_PAYLOAD_BYTES) return;
  } else {
    // Non-string payloads are not produced by the official client
    // (encryptSignal returns a string) but the wire type is `unknown`,
    // so measure a JSON serialization as a conservative upper bound.
    let serialized: string;
    try {
      serialized = JSON.stringify(payload ?? null);
    } catch {
      return;
    }
    if (Buffer.byteLength(serialized, "utf8") > RELAY_SIGNAL_MAX_PAYLOAD_BYTES) return;
  }

  const users = getRoomUsers(code);
  const senderUser = users.find((u) => u.socketId === sender.id);
  if (!senderUser || senderUser.peerId !== fromPeerId) return;

  const target = users.find((u) => u.peerId === toPeerId);
  if (!target) return;

  io.to(target.socketId).emit("relay-signal", {
    fromPeerId: senderUser.peerId,
    payload,
  });
}

/** Task #229: one peer tells the other to drop its per-peer secure-channel
 *  failure entry so the inbound ECDHE retry is not silently dropped.
 *  Validated the same way as `relaySignal`: sender must be in the room
 *  and `fromPeerId` must match their registered peerId. */
export function peerSecureChannelRetry(
  io: SocketIOServer,
  sender: Socket,
  code: string,
  fromPeerId: string,
  toPeerId: string,
): void {
  const users = getRoomUsers(code);
  const senderUser = users.find((u) => u.socketId === sender.id);
  if (!senderUser || senderUser.peerId !== fromPeerId) return;

  const target = users.find((u) => u.peerId === toPeerId);
  if (!target) return;

  io.to(target.socketId).emit("peer-secure-channel-retry", {
    fromPeerId: senderUser.peerId,
  });
}
