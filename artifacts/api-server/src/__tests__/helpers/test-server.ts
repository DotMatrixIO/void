// SPDX-License-Identifier: AGPL-3.0-or-later
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { RoomType } from "../../rooms";
import { registerSocketHandlers } from "../../socketHandlers";

export const TEST_PAYWALL_SECRET = crypto.randomBytes(32).toString("hex");

// Generate a fresh fake `jti` for each minted token. The socket layer rejects
// re-use of a creation token's `jti` (Task #169) to enforce one-payment-one-
// room, so each helper-minted token MUST carry a unique value. Using random
// bytes here mirrors how the real paywall mints a fresh `jti` per JWT. The
// `jti` replaced the Lightning `paymentHash` as the replay key (Task #889) so
// nothing payment-derived is ever shipped to the client.
function freshJti(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Generate a fresh per-room reclaim token (Task #886). The real paywall mints
// one random 32-byte value per paid window, decoupled from the `jti`;
// it — not the `jti` — is what the room persists (as a keyed HMAC) to
// authorize host reclaim. Each helper-minted token gets a unique one so that
// two distinct tokens never accidentally share reclaim authority.
function freshReclaimToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function validToken(): string {
  return jwt.sign(
    { authorized: true, jti: freshJti(), reclaimToken: freshReclaimToken() },
    TEST_PAYWALL_SECRET,
    { expiresIn: "1h" },
  );
}

// Mint with the tier's full window (matches what /paywall/status would issue).
// Using "1h" here would be the exact escalation pattern that Task #127's clamp
// in socketHandlers.ts now prevents — the room would be capped at 1h, not 24h.
export function dayTierToken(): string {
  return jwt.sign(
    { authorized: true, tier: "day", jti: freshJti(), reclaimToken: freshReclaimToken() },
    TEST_PAYWALL_SECRET,
    { expiresIn: "24h" },
  );
}

// Legacy "week" tier was 7 days before Task #115 capped paid rooms at 24h.
// The socket handler aliases tier "week" → "day" for room TTL, but the JWT
// exp itself can still be 7d (that's what older clients hold). The clamp
// then collapses to ROOM_TTLS.day (24h), which is what this test asserts.
export function legacyWeekTierToken(): string {
  return jwt.sign(
    { authorized: true, tier: "week", jti: freshJti(), reclaimToken: freshReclaimToken() },
    TEST_PAYWALL_SECRET,
    { expiresIn: "7d" },
  );
}

export function validRoomId(): string {
  return crypto.randomBytes(16).toString("hex");
}

export function buildServer() {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  registerSocketHandlers(io, { paywallSecret: TEST_PAYWALL_SECRET });

  return { httpServer, io };
}

export function startServer(): Promise<{ httpServer: HttpServer; io: SocketIOServer; port: number }> {
  const { httpServer, io } = buildServer();
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ httpServer, io, port });
    });
  });
}

export function connectClient(port: number): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
  });
}

export function emitCreateRoom(
  client: ClientSocket,
  data: { roomId: string; token: string; relayOnly?: boolean; roomType?: RoomType },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("create-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitJoinRoom(
  client: ClientSocket,
  data: { code: string; peerId: string; token?: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("join-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitSetKnockMode(
  client: ClientSocket,
  data: { code: string; enabled: boolean },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("set-knock-mode", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitApproveKnock(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("approve-knock", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitDenyKnock(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("deny-knock", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitCancelKnock(
  client: ClientSocket,
  data: { code: string },
): void {
  client.emit("cancel-knock", data);
}

export function emitLockRoom(
  client: ClientSocket,
  data: { code: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("lock-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitUnlockRoom(
  client: ClientSocket,
  data: { code: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("unlock-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitDestroyRoom(
  client: ClientSocket,
  data: { code: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("destroy-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitBurnRoom(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("burn-room", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitLeaveRoom(
  client: ClientSocket,
  data: { code: string; peerId: string },
): void {
  client.emit("leave-room", data);
}

export function emitRelaySignal(
  client: ClientSocket,
  data: { code: string; toPeerId: string; fromPeerId: string; payload: unknown },
): void {
  client.emit("relay-signal", data);
}

export function emitPeerMediaState(
  client: ClientSocket,
  data: { code: string; peerId: string; camOff: boolean; micMuted: boolean; voiceMode?: number },
): void {
  client.emit("peer-media-state", data);
}

export function emitRequestScreenShare(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("request-screen-share", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitScreenShareStarted(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("screen-share-started", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitScreenShareStopped(
  client: ClientSocket,
  data: { code: string; peerId: string },
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit("screen-share-stopped", data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function emitWithCallback(
  client: ClientSocket,
  event: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    client.emit(event, data, (result: Record<string, unknown>) => {
      resolve(result);
    });
  });
}

export function waitForEvent(
  client: ClientSocket,
  event: string,
  timeoutMs: number = 2000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (data: unknown) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

export function useTestServer() {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port = 0;
  let client: ClientSocket;

  beforeAll(async () => {
    const srv = await startServer();
    httpServer = srv.httpServer;
    io = srv.io;
    port = srv.port;
  });

  afterAll(async () => {
    client?.disconnect();
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  beforeEach(async () => {
    if (client?.connected) client.disconnect();
    client = connectClient(port);
    await new Promise<void>((resolve) => {
      client.on("connect", resolve);
    });
  });

  afterEach(() => {
    client?.disconnect();
  });

  return {
    getClient: () => client,
    getPort: () => port,
  };
}
