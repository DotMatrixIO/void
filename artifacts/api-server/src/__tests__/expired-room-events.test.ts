// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #55: server-side enforcement of expired rooms on in-room actions.
//
// The existing "expired room enforcement" suite in socket-handlers.test.ts
// covers the easy path — a room code that never existed. These tests cover
// the harder path that motivates the per-event guard: a room that was
// actually paid for and joined, then crossed `expiresAt` between the
// 5-minute GC sweeps. The per-event check must reject in-room operations
// the moment expiry passes, without waiting for the GC or the per-room
// hard-cleanup `setTimeout` to fire and delete the room object.
//
// Lives in its own file (with its own server in `beforeAll`) so the
// extra joins it performs do not stack onto the per-IP join rate-limit
// bucket of the much larger socket-handlers suite.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import {
  startServer,
  connectClient,
  emitCreateRoom,
  emitJoinRoom,
  emitWithCallback,
  validToken,
  dayTierToken,
  validRoomId,
} from "./helpers/test-server";
import { __forceExpireRoomForTest } from "../rooms";

describe("Task #55 — per-event expiry guard on a real, force-expired room", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;
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
    await new Promise<void>((resolve) => { client.on("connect", resolve); });
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("rejects every in-room callback event with ROOM_EXPIRED", async () => {
    const roomId = validRoomId();
    const created = await emitCreateRoom(client, { roomId, token: validToken() });
    expect(created).toHaveProperty("success", true);
    await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

    // Cross expiry without waiting out the real per-tier TTL
    // (minimum 60s, enforced by ROOM_TTL_MIN_MS in createRoom).
    expect(__forceExpireRoomForTest(roomId)).toBe(true);

    const cases: Array<[string, Record<string, unknown>]> = [
      ["lock-room", { code: roomId }],
      ["unlock-room", { code: roomId }],
      ["destroy-room", { code: roomId }],
      ["set-knock-mode", { code: roomId, enabled: true }],
      ["approve-knock", { code: roomId, peerId: "peer-aaaaaa" }],
      ["deny-knock", { code: roomId, peerId: "peer-aaaaaa" }],
      ["request-screen-share", { code: roomId, peerId: "peer-aaaaaa" }],
      ["screen-share-started", { code: roomId, peerId: "peer-aaaaaa" }],
      ["screen-share-stopped", { code: roomId, peerId: "peer-aaaaaa" }],
    ];

    for (const [event, payload] of cases) {
      const result = await emitWithCallback(client, event, payload);
      expect(result, `${event} on expired room`).toHaveProperty("success", false);
      expect(result, `${event} on expired room`).toHaveProperty("error", "ROOM_EXPIRED");
    }
  });

  it("drops the fire-and-forget in-room relay-signal event with no broadcast", async () => {
    // Task #868 removed the `peer-media-state` handler entirely (that state
    // now rides the `void.media-state` data channel, never the server), so
    // relay-signal is the remaining fire-and-forget in-room broadcast whose
    // per-event ROOM_EXPIRED guard must fire before any broadcast side
    // effect — not just before the room-state mutation.
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

    // A second peer joins live so we have a recipient to (not) receive
    // a broadcast.
    const client2 = connectClient(port);
    await new Promise<void>((resolve) => { client2.on("connect", resolve); });
    await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

    let relayHits = 0;
    client2.on("relay-signal", () => { relayHits++; });

    expect(__forceExpireRoomForTest(roomId)).toBe(true);

    client.emit("relay-signal", {
      code: roomId,
      toPeerId: "peer-bbbbbb",
      fromPeerId: "peer-aaaaaa",
      payload: { type: "offer", sdp: "test" },
    });

    // Give socket.io a real-time tick to flush anything it shouldn't have.
    await new Promise((r) => setTimeout(r, 200));
    expect(relayHits).toBe(0);

    client2.disconnect();
  });

  it("rejects extend-room with ROOM_EXPIRED once the room has crossed expiry", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: dayTierToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

    expect(__forceExpireRoomForTest(roomId)).toBe(true);

    const result = await emitWithCallback(client, "extend-room", {
      code: roomId,
      token: dayTierToken(),
    });
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error", "ROOM_EXPIRED");
  });
});
