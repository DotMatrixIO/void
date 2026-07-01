// SPDX-License-Identifier: AGPL-3.0-or-later
// Socket.IO signaling router (Task #447 step 7).
//
// This file is now a thin wire-↔-service router: it owns ONLY the
// connection middleware (per-IP cap, lifecycle log) and the
// `socket.on(event, handler)` wiring. Every event delegates to one
// orchestrator in `services/roomService.ts`. Auth lives in
// `services/accessController.ts`. Relay forwarding lives in
// `services/signalingRelay.ts`. Rate limit + token replay infra live in
// `services/{socketRateLimits,accessController}.ts`.
//
// No business logic. No JWT verification. No payload validation beyond
// what the connection-middleware layer needs to enforce the per-IP cap.

import { Server as SocketIOServer } from "socket.io";
import type { Secret } from "@workspace/wire-core";
import { getTrustedClientIp } from "./lib/clientIp";
import { logger } from "./lib/logger";
import {
  setOnRoomExpired,
  getScreenShareState,
  setOnScreenShareReservationExpired,
} from "./rooms";
import {
  ipConnections,
  MAX_CONNECTIONS_PER_IP,
} from "./services/socketRateLimits";
import {
  resolvePaywallSecret,
  startConsumedTokenSweep,
} from "./services/accessController";
import {
  handleCreateRoom,
  handleJoinRoom,
  handleSetKnockMode,
  handleApproveKnock,
  handleDenyKnock,
  handleCancelKnock,
  handleLeaveRoom,
  handleDestroyRoom,
  handleBurnRoom,
  handleExtendRoom,
  handleRelaySignal,
  handlePeerSecureChannelRetry,
  handleLockRoom,
  handleUnlockRoom,
  handleRequestRelayOnly,
  handleRespondRelayOnlyRequest,
  handleRequestScreenShare,
  handleScreenShareStarted,
  handleScreenShareStopped,
  handleDisconnect,
  type RoomServiceContext,
} from "./services/roomService";

// Re-exports preserved for backward compatibility (test fixtures +
// shutdown handlers import these from "./socketHandlers" historically).
export {
  resetSocketRateLimits,
} from "./services/socketRateLimits";
export {
  __resetCapRejectionLogForTest,
  startConsumedTokenSweep,
  stopConsumedTokenSweep,
  sweepConsumedExtensionTokens,
  sweepConsumedRoomCreationTokens,
} from "./services/accessController";

export interface RegisterSocketHandlersOptions {
  /** Override the paywall HMAC verification secret. Tests pass an explicit
   *  value here to wire the paywall router and the socket handler up with
   *  the SAME secret end-to-end. */
  paywallSecret?: Secret<string> | string;
}

export function registerSocketHandlers(
  io: SocketIOServer,
  options?: RegisterSocketHandlersOptions,
) {
  const secret = resolvePaywallSecret(options?.paywallSecret);
  // Schedule the consumed-token map sweep. Idempotent — re-registering the
  // socket handlers (e.g. in test fixtures that bring multiple servers up
  // and down) does not stack timers. Tests that need a clean slate call
  // stopConsumedTokenSweep() explicitly.
  startConsumedTokenSweep();

  io.use((socket, next) => {
    const ip = getTrustedClientIp(socket);
    const conns = ipConnections.get(ip) || new Set();
    if (conns.size >= MAX_CONNECTIONS_PER_IP) {
      return next(new Error("TOO_MANY_CONNECTIONS"));
    }
    conns.add(socket.id);
    ipConnections.set(ip, conns);
    next();
  });

  io.on("connection", (socket) => {
    const socketIp = getTrustedClientIp(socket);
    const ctx: RoomServiceContext = { io, socket, socketIp, secret };

    // Task #374: Socket.io connection lifecycle log line. Emitted at
    // `info` level so the standard `LOG_LEVEL=warn` self-host default
    // keeps the channel quiet; operators who want lifecycle visibility
    // flip `LOG_LEVEL=info`. No room ID at this point — the socket
    // hasn't joined a room yet — and no peer ID. Matched at disconnect
    // with `event: "socket-disconnect"` and the running per-IP
    // connection count so an operator can see open/close pairs and
    // peer count without ever seeing the room code on success.
    logger.info(
      {
        event: "socket-connect",
        ip: socketIp,
        peerCount: ipConnections.get(socketIp)?.size ?? 0,
      },
      "socket",
    );

    socket.on("create-room", (data, cb) => handleCreateRoom(ctx, data, cb));
    socket.on("join-room", (data, cb) => handleJoinRoom(ctx, data, cb));
    socket.on("set-knock-mode", (data, cb) => handleSetKnockMode(ctx, data, cb));
    socket.on("approve-knock", (data, cb) => handleApproveKnock(ctx, data, cb));
    socket.on("deny-knock", (data, cb) => handleDenyKnock(ctx, data, cb));
    socket.on("cancel-knock", (data) => handleCancelKnock(ctx, data));
    // Task #868: `peer-media-state` is no longer a signaling event. Peer
    // camera/mic/voice/onion state now travels peer-to-peer over the
    // encrypted `void.media-state` RTCDataChannel; the server neither
    // relays nor can read it. See docs/signaling-envelope-audit.md.
    socket.on("leave-room", (data) => handleLeaveRoom(ctx, data));
    socket.on("destroy-room", (data, cb) => handleDestroyRoom(ctx, data, cb));
    socket.on("burn-room", (data, cb) => handleBurnRoom(ctx, data, cb));
    socket.on("extend-room", (data, cb) => handleExtendRoom(ctx, data, cb));
    socket.on("relay-signal", (data) => handleRelaySignal(ctx, data));
    socket.on("peer-secure-channel-retry", (data) => handlePeerSecureChannelRetry(ctx, data));
    socket.on("lock-room", (data, cb) => handleLockRoom(ctx, data, cb));
    socket.on("unlock-room", (data, cb) => handleUnlockRoom(ctx, data, cb));
    socket.on("request-relay-only", (data, cb) => handleRequestRelayOnly(ctx, data, cb));
    socket.on("respond-relay-only-request", (data, cb) => handleRespondRelayOnlyRequest(ctx, data, cb));
    socket.on("request-screen-share", (data, cb) => handleRequestScreenShare(ctx, data, cb));
    socket.on("screen-share-started", (data, cb) => handleScreenShareStarted(ctx, data, cb));
    socket.on("screen-share-stopped", (data, cb) => handleScreenShareStopped(ctx, data, cb));
    socket.on("disconnect", () => handleDisconnect(ctx, getTrustedClientIp(socket)));
  });

  setOnScreenShareReservationExpired((code) => {
    const state = getScreenShareState(code);
    io.to(code).emit("screen-share-state", state);
  });

  setOnRoomExpired((code) => {
    io.to(code).emit("room-expired");
    io.in(code).socketsLeave(code);
    io.in(code + ":knocking").socketsLeave(code + ":knocking");
  });
}
