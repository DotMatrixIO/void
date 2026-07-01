// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #286: room capacity cap + observability + GC sweep.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import {
  startServer,
  connectClient,
  emitCreateRoom,
  validToken,
  validRoomId,
} from "./helpers/test-server";
import {
  __setRoomCapsForTest,
  __resetRoomCapsForTest,
  __resetCapRejectionCountersForTest,
  __clearAllRoomsForTest,
  __triggerGcSweepForTest,
  __forceExpireRoomForTest,
  getCapRejectionCounters,
  getRoomCount,
  checkRoomCapacity,
  rehydratePersistedRooms,
  MAX_TOTAL_ROOMS_DEFAULT,
} from "../rooms";
import { __resetCapRejectionLogForTest } from "../socketHandlers";

describe("Task #286 — room-capacity caps", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;

  beforeAll(async () => {
    const srv = await startServer();
    httpServer = srv.httpServer;
    io = srv.io;
    port = srv.port;
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  beforeEach(() => {
    __clearAllRoomsForTest();
    __resetRoomCapsForTest();
    __resetCapRejectionCountersForTest();
    __resetCapRejectionLogForTest();
  });

  afterEach(() => {
    __resetRoomCapsForTest();
    __clearAllRoomsForTest();
  });

  it("documented default: 10k global cap", () => {
    expect(MAX_TOTAL_ROOMS_DEFAULT).toBe(10_000);
  });

  it("rejects new human creation once the global cap is full", async () => {
    __setRoomCapsForTest({ maxTotal: 2 });

    const client = connectClient(port);
    await new Promise<void>((r) => { client.on("connect", r); });

    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toHaveProperty("success", true);
    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toHaveProperty("success", true);
    expect(getRoomCount()).toBe(2);

    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toEqual({ error: "ROOM_CAP_REACHED" });
    expect(getCapRejectionCounters()).toEqual({ global: 1 });

    client.disconnect();
  });

  it("global cap full → human room creation is rejected", async () => {
    __setRoomCapsForTest({ maxTotal: 1 });

    const client = connectClient(port);
    await new Promise<void>((r) => { client.on("connect", r); });

    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toHaveProperty("success", true);

    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toEqual({ error: "ROOM_CAP_REACHED" });
    expect(await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() }))
      .toEqual({ error: "ROOM_CAP_REACHED" });

    expect(getCapRejectionCounters()).toEqual({ global: 2 });

    client.disconnect();
  });

  it("counter increments per global-cap rejection and can be reset", () => {
    __setRoomCapsForTest({ maxTotal: 0 });
    for (let i = 0; i < 5; i++) checkRoomCapacity("human");
    expect(getCapRejectionCounters()).toEqual({ global: 5 });

    __resetCapRejectionCountersForTest();
    expect(getCapRejectionCounters()).toEqual({ global: 0 });

    for (let i = 0; i < 3; i++) checkRoomCapacity("human");
    expect(getCapRejectionCounters()).toEqual({ global: 3 });
  });

  it("legacy persisted record with a removed room type rehydrates as human without throwing", () => {
    const code = validRoomId();
    // A record written by an older build that still used a now-removed room
    // type. VOID is human-only now; deserialization MUST tolerate the legacy
    // value (coerce to "human") rather than crash.
    const legacy = [
      {
        code,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        tier: "standard",
        // Deliberately the now-removed value to exercise the coercion path.
        roomType: "agent",
        relayOnly: false,
        locked: false,
        hostReclaimTokenHashes: [],
      },
    ] as unknown as Parameters<typeof rehydratePersistedRooms>[0];

    expect(() => rehydratePersistedRooms(legacy)).not.toThrow();
    expect(getRoomCount()).toBe(1);
  });

  it("GC sweep evicts a room past expiresAt without disturbing live rooms", async () => {
    const client = connectClient(port);
    await new Promise<void>((r) => { client.on("connect", r); });

    const expiringRoomId = validRoomId();
    const liveRoomId = validRoomId();
    await emitCreateRoom(client, { roomId: expiringRoomId, token: validToken() });
    await emitCreateRoom(client, { roomId: liveRoomId, token: validToken() });
    expect(getRoomCount()).toBe(2);

    expect(__forceExpireRoomForTest(expiringRoomId)).toBe(true);
    __triggerGcSweepForTest();

    expect(getRoomCount()).toBe(1);

    client.disconnect();
  });
});
