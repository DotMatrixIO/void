// SPDX-License-Identifier: AGPL-3.0-or-later
// RoomService — socket-event orchestrators (Task #447 step 5).
//
// Every `socket.on(...)` handler registered by socketHandlers.ts
// delegates to one function in this file. Each orchestrator receives a
// per-connection `RoomServiceContext` ({ io, socket, socketIp, secret })
// plus the event's typed payload + callback, runs DTO validation, calls
// into rooms/* domain functions, accessController, and signalingRelay,
// and emits any broadcasts.
//
// Why functions instead of a class: the connection-scoped context is
// fixed for the lifetime of one socket (io and secret are server-wide,
// socket and socketIp are per-connection). Passing it explicitly keeps
// each function pure-by-construction and unit-testable without a fake
// "this" binding.

import type { Server as SocketIOServer, Socket } from "socket.io";
import type { Secret } from "@workspace/wire-core";
import { logger } from "../lib/logger";
import { TIERS } from "../routes/paywall";
import {
  createRoom,
  checkRoomCapacity,
  roomExists,
  isRoomExpired,
  joinRoom,
  leaveAllRooms,
  leaveRoom,
  getRoomUsers,
  lockRoom,
  unlockRoom,
  setKnockMode,
  approveKnock,
  denyKnock,
  isKnockMode,
  isRoomRelayOnly,
  enableRelayOnly,
  isRoomHost,
  getHostPeerId,
  claimHost,
  addHostReclaimToken,
  removePendingKnockBySocket,
  destroyRoom,
  burnRoom,
  extendRoomExpiry,
  getRoomType,
  getRoomTier,
  getRoomExpiresAt,
  requestScreenShare,
  confirmScreenShare,
  stopScreenShare,
  getScreenShareState,
  ROOM_TTLS,
  type RoomType,
  type RoomTier,
} from "../rooms";
import {
  verifyCreationToken,
  recordConsumedCreationToken,
  verifyExtensionToken,
  recordConsumedExtensionToken,
  extractJoinClaimReclaimToken,
  logCapRejection,
} from "./accessController";
import {
  checkRate,
  checkIpJoinRate,
  checkJoinFailRate,
  recordJoinFailure,
  clearJoinFailures,
  ipConnections,
  rateBuckets,
  joinFailures,
} from "./socketRateLimits";
import { relaySignal, peerSecureChannelRetry } from "./signalingRelay";
import type {
  CreateRoomRequestPayload,
  CreateRoomAckPayload,
  JoinRoomRequestPayload,
  JoinRoomAckPayload,
  LeaveRoomRequestPayload,
  DestroyRoomRequestPayload,
  BurnRoomRequestPayload,
  SimpleAckPayload,
  ExtendRoomRequestPayload,
  ExtendRoomAckPayload,
  RoomCodeOnlyPayload,
  SetKnockModeRequestPayload,
  CodeAndPeerPayload,
  RelaySignalInPayload,
  KnockApprovedPayload,
  SignalingErrorCode,
} from "@workspace/signaling-types";

// Server-side ack/broadcast types that extend spec-defined payloads with
// implementation fields not yet reflected in asyncapi.yaml (Task #202).
type JoinRoomAckServer = JoinRoomAckPayload & {
  hostPresent?: boolean;
  hostPeerId?: string | null;
};
type KnockApprovedServer = KnockApprovedPayload & {
  hostPresent?: boolean;
  hostPeerId?: string | null;
};

export interface RoomServiceContext {
  io: SocketIOServer;
  socket: Socket;
  socketIp: string;
  secret: Secret<string>;
}

const ROOM_CODE_RE = /^[0-9a-f]{32}$/;
const PEER_ID_RE = /^peer-[a-z0-9]{6}$/;

// Single guard for room-scoped socket events (Task #55). All in-room handlers
// route through this so an expired room is rejected at the door without
// duplicating the same `if (isRoomExpired(...)) ...` four-line snippet at
// every call site. Returns `true` when the event was rejected (caller must
// `return` immediately); returns `false` when the room is live and the
// caller may proceed.
//
// `isRoomExpired` already returns `true` for both "past expiresAt" AND
// "no such room", so this guard collapses the ROOM_NOT_FOUND-after-GC
// race window into the same response code clients already handle.
function rejectIfRoomExpired(
  code: string,
  callback?: (result: { success: boolean; error: SignalingErrorCode }) => void,
): boolean {
  if (!isRoomExpired(code)) return false;
  if (typeof callback === "function") {
    callback({ success: false, error: "ROOM_EXPIRED" });
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// create-room
// ─────────────────────────────────────────────────────────────────────────

export function handleCreateRoom(
  ctx: RoomServiceContext,
  data: CreateRoomRequestPayload,
  callback?: (result: CreateRoomAckPayload) => void,
): void {
  if (typeof callback !== "function") return;
  if (!checkRate(ctx.socket.id, "create-room")) {
    callback({ error: "RATE_LIMITED" });
    return;
  }

  if (!data || typeof data !== "object" || typeof data.roomId !== "string" || typeof data.token !== "string") {
    callback({ error: "INVALID_REQUEST" });
    return;
  }

  if (!ROOM_CODE_RE.test(data.roomId)) {
    callback({ error: "INVALID_ROOM_ID" });
    return;
  }

  // VOID is human-only; every room is created as a "human" room.
  const roomType: RoomType = "human";

  // Paywall JWT verification + one-payment-one-room replay guard live
  // entirely in AccessController. The error codes returned here are the
  // same the inline JWT path used to emit.
  const now = Date.now();
  const verified = verifyCreationToken(data.token, ctx.secret, now);
  if (!verified.ok) {
    callback({ error: verified.error });
    return;
  }
  const { tier, jwtExpMs, jti, reclaimToken } = verified.value;

  if (roomExists(data.roomId)) {
    callback({ error: "ROOM_EXISTS" });
    return;
  }

  // Task #286: enforce the global concurrent-room cap *after* JWT
  // verification (so unpaid callers can't probe the cap state) and
  // *before* `createRoom` / `recordConsumedCreationToken` (so a
  // rejected request doesn't burn the host's invoice slot — they can
  // retry once capacity frees up). Rate-limited log line below means
  // the cap firing under DoS is not silent.
  const cap = checkRoomCapacity(roomType);
  if (!cap.allowed) {
    logCapRejection(cap.error);
    callback({ error: cap.error });
    return;
  }

  const relayOnly = data.relayOnly === true;
  // Clamp the room's TTL to the JWT's remaining time, plus the tier's
  // documented grace buffer. /paywall/recover shrinks a recovered
  // JWT's expiresIn to the REMAINING wall-clock seconds of the
  // original paid window — without this clamp, a host who redeems a
  // recovery code with minutes left would still get a fresh full-tier
  // room (standard: 65m, day: 24h), turning recovery into a stealth
  // paid-window upgrade.
  //
  // The grace term preserves the existing standard-tier behavior:
  // ROOM_TTLS.standard (65m) intentionally exceeds the JWT/window
  // (60m) by 5 min so a host who creates a room near the end of their
  // paid window can still finish their call. The day tier has zero
  // grace (room TTL == window). For the standard /paywall/status path,
  // jwt.exp - now == TIERS.standard.windowSeconds, so the min()
  // collapses to ROOM_TTLS[tier] and behavior is unchanged.
  //
  // The lower bound in createRoom (ROOM_TTL_MIN_MS) still applies if
  // a recovery code is redeemed in its final seconds; that's accepted
  // as the cost of not booting a host mid-handshake.
  const tierTtlMs = ROOM_TTLS[tier];
  const tierWindowMs = TIERS[tier].windowSeconds * 1000;
  const tierGraceMs = Math.max(0, tierTtlMs - tierWindowMs);
  const ttlMs = jwtExpMs !== null
    ? Math.min(tierTtlMs, (jwtExpMs - Date.now()) + tierGraceMs)
    : tierTtlMs;
  // Pass the per-room `reclaimToken` so the room remembers who may
  // reclaim host. On a later rejoin to an empty room, only a socket
  // presenting a JWT with the same `reclaimToken` (or one added by a
  // paid extension) can reclaim host (Task #171). The token is decoupled
  // from the replay-guard `jti` and stored only as a keyed HMAC, so nothing
  // payment-derived is ever written to disk (Task #886). A token minted
  // by an older build carries no `reclaimToken` (null) — the room is
  // created but offers no host reclaim, the same "fail and re-pay"
  // migration the on-disk set already had.
  createRoom(data.roomId, relayOnly, ctx.socket.id, roomType, ttlMs, tier, reclaimToken);
  // Mark this invoice's JWT spent, keyed by its server-minted random `jti`.
  // Stored against the JWT's own `exp` so the entry self-prunes once the
  // token would have expired anyway. Fall back to a forward-looking expiry
  // if `exp` is missing (defensive — the paywall always issues one).
  recordConsumedCreationToken(jti, jwtExpMs ?? now + tierTtlMs);
  const effectiveRelay = relayOnly;
  const expiresAt = getRoomExpiresAt(data.roomId);
  callback({ success: true, relayOnly: effectiveRelay, roomType, tier, expiresAt, serverNow: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────────
// join-room
// ─────────────────────────────────────────────────────────────────────────

export function handleJoinRoom(
  ctx: RoomServiceContext,
  data: JoinRoomRequestPayload,
  callback: (result: JoinRoomAckServer) => void,
): void {
  if (typeof callback !== "function") return;
  if (!checkRate(ctx.socket.id, "join-room")) {
    callback({ success: false, error: "RATE_LIMITED", peers: [] });
    return;
  }

  if (!checkIpJoinRate(ctx.socketIp)) {
    callback({ success: false, error: "RATE_LIMITED", peers: [] });
    return;
  }

  const failCheck = checkJoinFailRate(ctx.socket.id);
  if (!failCheck.allowed) {
    callback({ success: false, error: "RATE_LIMITED", peers: [] });
    return;
  }

  if (!data || typeof data !== "object") {
    recordJoinFailure(ctx.socket.id);
    callback({ success: false, error: "INVALID_CODE", peers: [] });
    return;
  }

  const { code, peerId } = data;

  if (typeof code !== "string" || !ROOM_CODE_RE.test(code)) {
    recordJoinFailure(ctx.socket.id);
    callback({ success: false, error: "INVALID_CODE", peers: [] });
    return;
  }

  if (typeof peerId !== "string" || !PEER_ID_RE.test(peerId)) {
    recordJoinFailure(ctx.socket.id);
    callback({ success: false, error: "INVALID_CODE", peers: [] });
    return;
  }

  const result = joinRoom(code, ctx.socket.id, peerId);

  if (!result.success) {
    if (result.error === "KNOCK_PENDING") {
      ctx.socket.join(code + ":knocking");
      const hostUsers = getRoomUsers(code);
      for (const u of hostUsers) {
        ctx.io.to(u.socketId).emit("knock-request", { peerId, code });
      }
      callback({ success: false, error: "KNOCK_PENDING", peers: [], knockPending: true });
      return;
    }
    if (result.error === "KNOCK_QUEUE_FULL") {
      // Audit H-05 (task #464): the per-room pendingKnocks queue is at
      // its cap. Surface a distinct error so the joiner's UI can render
      // "ROOM BUSY — TRY AGAIN" instead of the indefinite-wait spinner
      // a KNOCK_PENDING response triggers. Note we do NOT record a join
      // failure here — this is a back-pressure signal, not a credential
      // failure, and we don't want to feed the per-socket backoff with
      // events the joiner had no way to avoid.
      callback({ success: false, error: "KNOCK_QUEUE_FULL", peers: [], knockPending: false });
      return;
    }
    if (result.error === "ROOM_NOT_FOUND") {
      recordJoinFailure(ctx.socket.id);
    }
    callback({ success: false, error: result.error as SignalingErrorCode, peers: [], locked: result.locked ?? false, maxUsers: result.maxUsers });
    return;
  }

  clearJoinFailures(ctx.socket.id);
  ctx.socket.join(code);

  const peers = result.users
    .filter((u) => u.socketId !== ctx.socket.id)
    .map((u) => u.peerId);

  const relayOnly = isRoomRelayOnly(code);
  const knockMode = isKnockMode(code);
  const roomType = getRoomType(code);

  // Task #171: if the joining socket presents a paywall JWT, try to
  // claim host. `claimHost` only succeeds when (a) the room currently
  // has no host (the previous host disconnected and the room emptied),
  // and (b) the JWT's `reclaimToken` matches one stored on the room.
  // Failures are silent — a non-paying phrase-holder simply doesn't
  // become host. The original paying host can rejoin and reclaim host
  // by presenting either the original creation JWT or any later paid
  // extension JWT (see `addHostReclaimToken` in the extend-room handler).
  let hostJustClaimed = false;
  const claimReclaimToken = extractJoinClaimReclaimToken(data.token, ctx.secret);
  if (claimReclaimToken) {
    // Snapshot host occupancy BEFORE the claim so we can tell a
    // true "vacant slot just filled" from `claimHost`'s
    // idempotent self-reclaim (host already === socket.id, also
    // returns success). Only the former is a `host-changed`
    // event for the room; the latter is a no-op the room must
    // not learn about.
    const hostWasAbsent = getHostPeerId(code) === null;
    const claim = claimHost(code, ctx.socket.id, claimReclaimToken);
    if (claim.success && hostWasAbsent && isRoomHost(code, ctx.socket.id)) {
      hostJustClaimed = true;
    }
  }

  const hostStatus = isRoomHost(code, ctx.socket.id);
  const expiresAt = getRoomExpiresAt(code);
  const tier = getRoomTier(code);
  const screenShare = getScreenShareState(code);
  const hostPeerId = getHostPeerId(code);
  const hostPresent = hostPeerId !== null;
  ctx.socket.to(code).emit("peer-joined", { peerId });
  // Task #190: tell remaining peers the moderation slot just filled
  // so a guest's "HOST OFFLINE" pill clears the moment the original
  // payer rejoins. Only fire on a true claim (not on a non-host
  // join, and not on the idempotent self-reclaim) so non-host joins
  // and ordinary reconnects don't broadcast a redundant event.
  if (hostJustClaimed) {
    ctx.socket.to(code).emit("host-changed", { hostPresent: true, hostPeerId });
  }
  callback({ success: true, peers, locked: result.locked, maxUsers: result.maxUsers, knockMode, relayOnly, roomType, tier, isHost: hostStatus, hostPresent, hostPeerId, expiresAt, serverNow: Date.now(), screenSharePeerId: screenShare.activeScreenSharePeerId, screenShareReservedByPeerId: screenShare.reservedByPeerId });
  // Task #374: lifecycle log on success. Room code is scrubbed —
  // the policy on /why says success-path room IDs never hit
  // disk. `peerCount` is the post-join occupancy so an operator
  // can see fill ratios over time without learning which room.
  logger.info(
    {
      event: "socket-join",
      ip: ctx.socketIp,
      room: "<room-id>",
      peerCount: result.users.length,
    },
    "socket",
  );
}

// ─────────────────────────────────────────────────────────────────────────
// knock-mode + approve/deny/cancel
// ─────────────────────────────────────────────────────────────────────────

export function handleSetKnockMode(
  ctx: RoomServiceContext,
  data: SetKnockModeRequestPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.enabled !== "boolean") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap. See socketRateLimits.ts EVENT_LIMITS.
  if (!checkRate(ctx.socket.id, "set-knock-mode")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = setKnockMode(data.code, ctx.socket.id, data.enabled);
  if (result.success) {
    ctx.io.to(data.code).emit("knock-mode-changed", { enabled: data.enabled });
  }
  if (typeof callback === "function") callback(result as SimpleAckPayload);
}

export function handleApproveKnock(
  ctx: RoomServiceContext,
  data: CodeAndPeerPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.peerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "approve-knock")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = approveKnock(data.code, ctx.socket.id, data.peerId);
  if (result.success && result.knock) {
    const knockSocket = ctx.io.sockets.sockets.get(result.knock.socketId);
    if (knockSocket) {
      knockSocket.leave(data.code + ":knocking");
      knockSocket.join(data.code);
      const users = getRoomUsers(data.code);
      const peers = users
        .filter((u) => u.socketId !== result.knock!.socketId)
        .map((u) => u.peerId);
      const relayOnly = isRoomRelayOnly(data.code);
      const roomType = getRoomType(data.code);
      const knockExpiresAt = getRoomExpiresAt(data.code);
      const knockTier = getRoomTier(data.code);
      const knockScreenShare = getScreenShareState(data.code);
      // Task #190: surface host presence on the knock-approved hand-off
      // so a guest admitted via knock can render the "host offline"
      // pill from the first frame, just like the primary join path.
      // The host is necessarily present in this branch (only a host
      // could have approved the knock), but we ask the room state
      // rather than hard-coding `true` so a host who races to drop
      // their socket between approving and the broadcast doesn't
      // leave the new joiner with a stale "host present" flag.
      const knockHostPeerId = getHostPeerId(data.code);
      const knockHostPresent = knockHostPeerId !== null;
      knockSocket.emit("knock-approved", { code: data.code, peers, relayOnly, roomType, tier: knockTier, expiresAt: knockExpiresAt, serverNow: Date.now(), screenSharePeerId: knockScreenShare.activeScreenSharePeerId, screenShareReservedByPeerId: knockScreenShare.reservedByPeerId, hostPresent: knockHostPresent, hostPeerId: knockHostPeerId });
      // Task #698: broadcast `peer-joined` from the newly-admitted
      // joiner's socket, NOT the approving host's. `ctx.socket` here is
      // the host who clicked ADMIT, so `ctx.socket.to(code)` excludes
      // the host and (wrongly) includes the joiner — meaning the host
      // never learns a peer joined and never runs the WebRTC offer
      // path. Because glare avoidance only lets the smaller peerId
      // initiate, whenever the host holds the smaller peerId neither
      // side ever offers and both ends sit with no video/audio. Using
      // `knockSocket` mirrors the normal join path (sender = joining
      // socket), so the room's existing members — the host included —
      // get the notification and the joiner does not get a spurious
      // self-join.
      knockSocket.to(data.code).emit("peer-joined", { peerId: data.peerId });
    }
  }
  if (typeof callback === "function") callback({ success: result.success, error: result.error as SignalingErrorCode | undefined });
}

export function handleDenyKnock(
  ctx: RoomServiceContext,
  data: CodeAndPeerPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.peerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "deny-knock")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = denyKnock(data.code, ctx.socket.id, data.peerId);
  if (result.success && result.knock) {
    const knockSocket = ctx.io.sockets.sockets.get(result.knock.socketId);
    if (knockSocket) {
      knockSocket.emit("knock-denied", { code: data.code });
      knockSocket.leave(data.code + ":knocking");
      knockSocket.disconnect(true);
    }
  }
  if (typeof callback === "function") callback({ success: result.success, error: result.error as SignalingErrorCode | undefined });
}

export function handleCancelKnock(
  ctx: RoomServiceContext,
  data: RoomCodeOnlyPayload,
): void {
  if (!data || typeof data.code !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "cancel-knock")) return;
  if (rejectIfRoomExpired(data.code)) return;
  removePendingKnockBySocket(data.code, ctx.socket.id);
  ctx.socket.leave(data.code + ":knocking");
}

// ─────────────────────────────────────────────────────────────────────────
// peer-media-state — REMOVED (Task #868)
//
// Peer camera/mic/voice-mask/onion state is no longer relayed by the
// signaling server. It now travels peer-to-peer over the encrypted
// `void.media-state` RTCDataChannel (DTLS-over-SCTP), validated and
// merged entirely on the client (see artifacts/void-client/src/lib/
// webrtc.ts). The server can no longer read or forward these contents —
// it sees only that small encrypted data-channel messages cross the SCTP
// association. See docs/signaling-envelope-audit.md (Table 1 row +
// Table 2 row) for the before/after envelope claim.
// ─────────────────────────────────────────────────────────────────────────
// leave-room + destroy-room
// ─────────────────────────────────────────────────────────────────────────

export function handleLeaveRoom(
  ctx: RoomServiceContext,
  data: LeaveRoomRequestPayload,
): void {
  if (!data || typeof data !== "object") return;
  const { code, peerId: leavingPeerId } = data;
  if (typeof code !== "string" || typeof leavingPeerId !== "string") return;
  if (!ROOM_CODE_RE.test(code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "leave-room")) return;
  if (rejectIfRoomExpired(code)) return;

  const users = getRoomUsers(code);
  const sender = users.find((u) => u.socketId === ctx.socket.id);
  if (!sender || sender.peerId !== leavingPeerId) return;

  const { screenShareCleared, hostDeparted } = leaveRoom(code, ctx.socket.id);
  ctx.socket.leave(code);
  ctx.socket.to(code).emit("peer-left", { peerId: leavingPeerId });
  // Task #190: when the host walks out (rather than disconnecting),
  // surface the moderation slot vacating so the remaining peers'
  // "HOST OFFLINE — REJOIN PAUSED" pill comes on immediately. The
  // helper only flags `hostDeparted` when other peers remain, so a
  // host leaving an empty room never broadcasts a no-op event.
  if (hostDeparted) {
    ctx.socket.to(code).emit("host-changed", { hostPresent: false, hostPeerId: null });
  }
  if (screenShareCleared) {
    const state = getScreenShareState(code);
    ctx.io.to(code).emit("screen-share-state", state);
  }
}

export function handleDestroyRoom(
  ctx: RoomServiceContext,
  data: DestroyRoomRequestPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data !== "object") return;
  const { code } = data;
  if (typeof code !== "string" || !ROOM_CODE_RE.test(code)) {
    if (typeof callback === "function") callback({ success: false, error: "INVALID_CODE" });
    return;
  }

  // Audit M-3 (task #464): per-socket cap — 3/60s. Destroying a room is
  // terminal and broadcast to every member; an attacker who acquired
  // host (or who is racing the host) shouldn't be able to spam it.
  if (!checkRate(ctx.socket.id, "destroy-room")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }

  if (rejectIfRoomExpired(code, callback)) return;

  const result = destroyRoom(code, ctx.socket.id);
  if (!result.success) {
    if (typeof callback === "function") callback({ success: false, error: result.error as SignalingErrorCode | undefined });
    return;
  }

  ctx.socket.to(code).emit("room-destroyed");
  ctx.io.to(code + ":knocking").emit("room-destroyed");

  ctx.io.in(code).socketsLeave(code);
  ctx.io.in(code + ":knocking").socketsLeave(code + ":knocking");

  if (typeof callback === "function") callback({ success: true });
}

// burn-room — the BURN privacy panic primitive (Task #696).
//
// Bug fixed here: a JOINER's "Burn" used to emit only `leave-room`,
// which removes the peer but leaves the room (and its phrase) live —
// so the iPhone host could still re-join the supposedly-burned room.
// `destroy-room` is host-only by design (a moderation control), so a
// joiner could never destroy the room through it. This handler is the
// member-authorized teardown: any CURRENT member of the room can burn
// it, the room is dropped from memory, and `room-destroyed` is
// broadcast to everyone (members + knockers) exactly like the
// host-initiated destroy. After this the phrase returns ROOM_NOT_FOUND
// / ROOM_EXPIRED to anyone trying to re-join.
export function handleBurnRoom(
  ctx: RoomServiceContext,
  data: BurnRoomRequestPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data !== "object") return;
  const { code, peerId } = data;
  if (typeof code !== "string" || !ROOM_CODE_RE.test(code)) {
    if (typeof callback === "function") callback({ success: false, error: "INVALID_CODE" });
    return;
  }
  if (typeof peerId !== "string" || !PEER_ID_RE.test(peerId)) {
    if (typeof callback === "function") callback({ success: false, error: "INVALID_CODE" });
    return;
  }

  // Audit M-3 (task #464): per-socket cap. BURN is terminal and
  // broadcast to every member; throttle it the same as destroy-room so
  // a member can't spam GC + broadcast churn against the room.
  if (!checkRate(ctx.socket.id, "burn-room")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }

  if (rejectIfRoomExpired(code, callback)) return;

  // Verify the caller is who they claim to be in the room (same shape
  // as leave-room): the socket must be a current member AND own the
  // presented peerId. `burnRoom` re-checks membership by socketId, so
  // this is belt-and-suspenders against a forged peerId.
  const users = getRoomUsers(code);
  const sender = users.find((u) => u.socketId === ctx.socket.id);
  if (!sender || sender.peerId !== peerId) {
    if (typeof callback === "function") callback({ success: false, error: "NOT_IN_ROOM" });
    return;
  }

  const result = burnRoom(code, ctx.socket.id);
  if (!result.success) {
    if (typeof callback === "function") callback({ success: false, error: result.error as SignalingErrorCode | undefined });
    return;
  }

  ctx.socket.to(code).emit("room-destroyed");
  ctx.io.to(code + ":knocking").emit("room-destroyed");

  ctx.io.in(code).socketsLeave(code);
  ctx.io.in(code + ":knocking").socketsLeave(code + ":knocking");

  if (typeof callback === "function") callback({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// extend-room
// ─────────────────────────────────────────────────────────────────────────

export function handleExtendRoom(
  ctx: RoomServiceContext,
  data: ExtendRoomRequestPayload,
  callback?: (result: ExtendRoomAckPayload) => void,
): void {
  if (typeof callback !== "function") return;
  if (!checkRate(ctx.socket.id, "extend-room")) {
    callback({ success: false, error: "RATE_LIMITED" });
    return;
  }

  if (!data || typeof data !== "object" || typeof data.code !== "string" || typeof data.token !== "string") {
    callback({ success: false, error: "INVALID_REQUEST" });
    return;
  }
  if (!ROOM_CODE_RE.test(data.code)) {
    callback({ success: false, error: "INVALID_CODE" });
    return;
  }
  if (!roomExists(data.code)) {
    callback({ success: false, error: "ROOM_NOT_FOUND" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  if (!isRoomHost(data.code, ctx.socket.id)) {
    callback({ success: false, error: "NOT_HOST" });
    return;
  }

  const now = Date.now();
  const verified = verifyExtensionToken(data.token, ctx.secret, now);
  if (!verified.ok) {
    callback({ success: false, error: verified.error });
    return;
  }
  const { tier, tokenExpMs, reclaimToken: extensionReclaimToken, tokenHash } = verified.value;

  // Mirror the create-room clamp (Task #127) on the extension path.
  // Without this, a host who redeems a near-expiry recovery code
  // (which /paywall/recover deliberately shrinks the JWT's `exp` for)
  // could still extend their existing room by the FULL tier window
  // (standard: 65m, day: 24h) — a stealth paid-window upgrade
  // identical in shape to the bug Task #127 closed for room creation.
  // We clamp the extension to whatever the JWT itself still proves
  // out, plus the tier's documented grace buffer so honest hosts who
  // extend in the final minutes of a normal (non-recovered) window
  // still get the same 5-min standard tier grace they get at create
  // time. For the standard /paywall/status path, jwt.exp - now ==
  // TIERS.standard.windowSeconds so this collapses to ROOM_TTLS[tier]
  // and behavior is unchanged; for day tier the grace term is 0 so
  // a near-expiry day JWT extends the room by exactly the JWT's
  // remaining seconds.
  const tierTtlMs = ROOM_TTLS[tier];
  const tierWindowMs = TIERS[tier].windowSeconds * 1000;
  const tierGraceMs = Math.max(0, tierTtlMs - tierWindowMs);
  const jwtRemainingMs = tokenExpMs > 0 ? tokenExpMs - now : tierTtlMs;
  const additionalMs = Math.min(tierTtlMs, jwtRemainingMs + tierGraceMs);
  if (additionalMs <= 0) {
    callback({ success: false, error: "PAYMENT_REQUIRED" });
    return;
  }
  const result = extendRoomExpiry(data.code, additionalMs, ctx.socket.id, tier);
  if (!result.success || typeof result.expiresAt !== "number") {
    callback({ success: false, error: result.error as SignalingErrorCode | undefined, expiresAt: result.expiresAt });
    return;
  }

  // Mark the token spent. Fall back to a forward-looking expiry if the
  // JWT didn't carry an `exp` (defensive — paywall always issues one).
  recordConsumedExtensionToken(tokenHash, tokenExpMs > 0 ? tokenExpMs : now + additionalMs);

  // Task #171: register this extension's `reclaimToken` as a valid
  // host-claim token. If the host loses their original creation JWT
  // (e.g. tab reload after sessionStorage was cleared on extension)
  // they can still rejoin and reclaim host using the extension JWT.
  // The token is decoupled from `paymentHash` and stored only as a
  // keyed HMAC (Task #886). A token minted by an older build carries
  // none (null) — the extension still succeeds, it just grants no new
  // reclaim capability.
  if (extensionReclaimToken) {
    addHostReclaimToken(data.code, extensionReclaimToken);
  }

  const serverNow = Date.now();
  ctx.io.to(data.code).emit("room-extended", { expiresAt: result.expiresAt, serverNow, tier });
  callback({ success: true, expiresAt: result.expiresAt, serverNow, tier });
}

// ─────────────────────────────────────────────────────────────────────────
// relay-signal + peer-secure-channel-retry — forwarded to SignalingRelay
// ─────────────────────────────────────────────────────────────────────────

export function handleRelaySignal(
  ctx: RoomServiceContext,
  data: RelaySignalInPayload,
): void {
  if (!checkRate(ctx.socket.id, "relay-signal")) return;
  if (!data || typeof data !== "object") return;
  if (typeof data.code !== "string" || typeof data.toPeerId !== "string" || typeof data.fromPeerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  if (rejectIfRoomExpired(data.code)) return;
  relaySignal(ctx.io, ctx.socket, data.code, data.fromPeerId, data.toPeerId, data.payload);
}

export function handlePeerSecureChannelRetry(
  ctx: RoomServiceContext,
  data: { code: string; toPeerId: string; fromPeerId: string },
): void {
  if (!checkRate(ctx.socket.id, "peer-secure-channel-retry")) return;
  if (!data || typeof data !== "object") return;
  if (typeof data.code !== "string" || typeof data.toPeerId !== "string" || typeof data.fromPeerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  if (!PEER_ID_RE.test(data.fromPeerId) || !PEER_ID_RE.test(data.toPeerId)) return;
  if (rejectIfRoomExpired(data.code)) return;
  peerSecureChannelRetry(ctx.io, ctx.socket, data.code, data.fromPeerId, data.toPeerId);
}

// ─────────────────────────────────────────────────────────────────────────
// lock-room / unlock-room
// ─────────────────────────────────────────────────────────────────────────

export function handleLockRoom(
  ctx: RoomServiceContext,
  data: RoomCodeOnlyPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "lock-room")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = lockRoom(data.code, ctx.socket.id);
  if (result.success) {
    ctx.io.to(data.code).emit("room-locked", {});
  }
  if (typeof callback === "function") callback(result as SimpleAckPayload);
}

export function handleUnlockRoom(
  ctx: RoomServiceContext,
  data: RoomCodeOnlyPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "unlock-room")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = unlockRoom(data.code, ctx.socket.id);
  if (result.success) {
    ctx.io.to(data.code).emit("room-unlocked", {});
  }
  if (typeof callback === "function") callback(result as SimpleAckPayload);
}

// ─────────────────────────────────────────────────────────────────────────
// cooperative relay-only (request + respond) — Task #106
// ─────────────────────────────────────────────────────────────────────────

export function handleRequestRelayOnly(
  ctx: RoomServiceContext,
  data: { code: string },
  callback?: (result: { success: boolean; error?: string; alreadyEnabled?: boolean }) => void,
): void {
  if (!data || typeof data.code !== "string" || !ROOM_CODE_RE.test(data.code)) {
    if (typeof callback === "function") callback({ success: false, error: "INVALID_CODE" });
    return;
  }
  if (!checkRate(ctx.socket.id, "request-relay-only")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;

  // Caller must be a current member of the room. Without this, a
  // disconnected/never-joined socket could still ping the host.
  const users = getRoomUsers(data.code);
  const sender = users.find((u) => u.socketId === ctx.socket.id);
  if (!sender) {
    if (typeof callback === "function") callback({ success: false, error: "NOT_IN_ROOM" });
    return;
  }

  // Already on — short-circuit so the host isn't pinged for a
  // change that's effectively a no-op.
  if (isRoomRelayOnly(data.code)) {
    if (typeof callback === "function") callback({ success: true, alreadyEnabled: true });
    return;
  }

  // The host requesting their own room flip is just a self-trigger;
  // there's no one else to ask. Enable directly and broadcast.
  if (isRoomHost(data.code, ctx.socket.id)) {
    const enable = enableRelayOnly(data.code, ctx.socket.id);
    if (enable.success) {
      ctx.io.to(data.code).emit("room-relay-mode-enabled", {});
    }
    if (typeof callback === "function") callback({ success: true });
    return;
  }

  // Forward to whoever currently holds host. If the host has
  // disconnected mid-call (room.hostSocketId === null), there is
  // nobody to accept — surface NO_HOST so the requester's UI can
  // tell the user their request can't be delivered.
  const hostSocketId = users.find((u) => isRoomHost(data.code, u.socketId))?.socketId;
  if (!hostSocketId) {
    if (typeof callback === "function") callback({ success: false, error: "NO_HOST" });
    return;
  }
  ctx.io.to(hostSocketId).emit("relay-only-requested", { peerId: sender.peerId });
  if (typeof callback === "function") callback({ success: true });
}

export function handleRespondRelayOnlyRequest(
  ctx: RoomServiceContext,
  data: { code: string; peerId: string; accept: boolean },
  callback?: (result: { success: boolean; error?: string }) => void,
): void {
  if (
    !data ||
    typeof data.code !== "string" ||
    !ROOM_CODE_RE.test(data.code) ||
    typeof data.peerId !== "string" ||
    !PEER_ID_RE.test(data.peerId) ||
    typeof data.accept !== "boolean"
  ) {
    if (typeof callback === "function") callback({ success: false, error: "INVALID_REQUEST" });
    return;
  }
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "respond-relay-only-request")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  if (!isRoomHost(data.code, ctx.socket.id)) {
    if (typeof callback === "function") callback({ success: false, error: "NOT_HOST" });
    return;
  }

  // Look up the requester by peerId in the current member list.
  // If they've left the room (or were never there) the response is
  // a no-op from their perspective — we still ack the host.
  const users = getRoomUsers(data.code);
  const requester = users.find((u) => u.peerId === data.peerId);

  if (data.accept) {
    const result = enableRelayOnly(data.code, ctx.socket.id);
    if (!result.success) {
      if (typeof callback === "function") callback({ success: false, error: result.error });
      return;
    }
    // Suppress the broadcast on a no-op flip (room was already
    // relay-only). Otherwise every peer renegotiates for nothing.
    if (!result.alreadyEnabled) {
      // Include the requester's peerId so clients can show attribution
      // ("REQUESTED BY peer-xxxxxx"). Host self-triggers (request-relay-only
      // path) emit without requestedBy, preserving the current no-attribution
      // behavior for that path.
      ctx.io.to(data.code).emit("room-relay-mode-enabled", { requestedBy: data.peerId });
    }
  } else if (requester) {
    ctx.io.to(requester.socketId).emit("relay-only-request-declined", {});
  }

  if (typeof callback === "function") callback({ success: true });
}

// ─────────────────────────────────────────────────────────────────────────
// screen share — request / started / stopped
// ─────────────────────────────────────────────────────────────────────────

export function handleRequestScreenShare(
  ctx: RoomServiceContext,
  data: CodeAndPeerPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.peerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  if (!checkRate(ctx.socket.id, "request-screen-share")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = requestScreenShare(data.code, ctx.socket.id, data.peerId);
  if (result.success) {
    // Per-grant idempotency nonce (Task #303). Echoed in BOTH the
    // ack and the `screen-share-granted` event so the client can
    // dedup a duplicated grant and avoid promoting the same
    // reservation twice into a double-booked presenter slot.
    // `requestScreenShare` always returns a nonce on success — the
    // empty-string fallback is purely a TS narrowing belt-and-braces.
    ctx.socket.emit("screen-share-granted", { code: data.code, nonce: result.nonce ?? "" });
    const state = getScreenShareState(data.code);
    ctx.io.to(data.code).emit("screen-share-state", state);
  } else {
    ctx.socket.emit("screen-share-denied", { code: data.code, reason: result.error as SignalingErrorCode });
  }
  if (typeof callback === "function") {
    callback(result as SimpleAckPayload & { nonce?: string });
  }
}

export function handleScreenShareStarted(
  ctx: RoomServiceContext,
  data: CodeAndPeerPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.peerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "screen-share-started")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = confirmScreenShare(data.code, ctx.socket.id, data.peerId);
  if (result.success) {
    const state = getScreenShareState(data.code);
    ctx.io.to(data.code).emit("screen-share-state", state);
  }
  if (typeof callback === "function") {
    callback(result as SimpleAckPayload);
  }
}

export function handleScreenShareStopped(
  ctx: RoomServiceContext,
  data: CodeAndPeerPayload,
  callback?: (result: SimpleAckPayload) => void,
): void {
  if (!data || typeof data.code !== "string" || typeof data.peerId !== "string") return;
  if (!ROOM_CODE_RE.test(data.code)) return;
  // Audit M-3 (task #464): per-socket cap.
  if (!checkRate(ctx.socket.id, "screen-share-stopped")) {
    if (typeof callback === "function") callback({ success: false, error: "RATE_LIMITED" });
    return;
  }
  if (rejectIfRoomExpired(data.code, callback)) return;
  const result = stopScreenShare(data.code, ctx.socket.id, data.peerId);
  if (result.success) {
    const state = getScreenShareState(data.code);
    ctx.io.to(data.code).emit("screen-share-state", state);
  }
  if (typeof callback === "function") {
    callback(result as SimpleAckPayload);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// disconnect — per-IP + per-socket cleanup + leaveAll broadcasts
// ─────────────────────────────────────────────────────────────────────────

export function handleDisconnect(ctx: RoomServiceContext, ip: string): void {
  const conns = ipConnections.get(ip);
  if (conns) {
    conns.delete(ctx.socket.id);
    if (conns.size === 0) ipConnections.delete(ip);
  }
  rateBuckets.delete(ctx.socket.id);
  joinFailures.delete(ctx.socket.id);
  const affected = leaveAllRooms(ctx.socket.id);
  // Task #374: lifecycle log on disconnect. Room codes that the
  // socket was in are scrubbed; we emit one summary line with the
  // count of rooms departed so an operator sees the shape (peers
  // leaving) without learning which rooms.
  logger.info(
    {
      event: "socket-disconnect",
      ip,
      peerCount: ipConnections.get(ip)?.size ?? 0,
      roomsDeparted: affected.length,
    },
    "socket",
  );
  for (const { code, departedPeerId, unlocked, screenShareCleared, hostDeparted } of affected) {
    ctx.io.to(code).emit("peer-left", { peerId: departedPeerId });
    if (unlocked) {
      ctx.io.to(code).emit("room-unlocked", {});
    }
    // Task #190: same `host-changed` broadcast as the explicit
    // leave-room path. Disconnect-driven host departures (tab close,
    // network drop) are the most common way moderation goes silent
    // — without this, guests would only learn the host was gone via
    // the lack of moderation actions, not via a clear UI signal.
    if (hostDeparted) {
      ctx.io.to(code).emit("host-changed", { hostPresent: false, hostPeerId: null });
    }
    if (screenShareCleared) {
      const state = getScreenShareState(code);
      ctx.io.to(code).emit("screen-share-state", state);
    }
  }
}
