// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Task #374: snapshot Socket.io lifecycle log lines and assert they
// match the published "What we log" policy on /why:
//   - connect/disconnect lines have NO room ID
//   - join lines on the success path scrub the room ID to <room-id>
// Capturing before the module under test loads is what makes the
// log-mock effective — see access-log-scrub.test.ts for the same
// pattern at the HTTP layer.

const lines: Array<Record<string, unknown> & { msg: string }> = [];
vi.mock("../lib/logger", () => ({
  logger: {
    info: (obj: Record<string, unknown>, msg: string) => {
      lines.push({ ...obj, msg });
    },
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    debug: () => undefined,
  },
}));

import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import {
  startServer,
  connectClient,
  emitCreateRoom,
  emitJoinRoom,
  validToken,
  validRoomId,
} from "./helpers/test-server";
import { resetSocketRateLimits } from "../socketHandlers";

describe("Socket.io lifecycle log scrubs room IDs on success (Task #374)", () => {
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

  beforeEach(() => {
    resetSocketRateLimits();
    lines.length = 0;
  });

  function socketLines() {
    return lines.filter((l) => l.msg === "socket");
  }

  it("socket-connect line has no room ID and no peer ID", async () => {
    client = connectClient(port);
    await new Promise<void>((r) => client.on("connect", r));

    const connect = socketLines().find((l) => l.event === "socket-connect");
    expect(connect, "expected a socket-connect line").toBeDefined();
    // Connect line is emitted BEFORE any join — it must not carry a
    // room field at all. (Belt-and-braces for the published policy.)
    expect(connect).not.toHaveProperty("room");
    expect(connect).not.toHaveProperty("peerId");
    expect(connect).not.toHaveProperty("code");
    client.disconnect();
  });

  it("socket-join success line replaces the room code with <room-id>", async () => {
    const roomId = validRoomId();
    const host = connectClient(port);
    await new Promise<void>((r) => host.on("connect", r));
    await emitCreateRoom(host, { roomId, token: validToken() });

    const joiner = connectClient(port);
    await new Promise<void>((r) => joiner.on("connect", r));
    lines.length = 0;
    const result = await emitJoinRoom(joiner, { code: roomId, peerId: "peer-abc123" });
    expect(result).toHaveProperty("success", true);

    const join = socketLines().find((l) => l.event === "socket-join");
    expect(join, "expected a socket-join line").toBeDefined();
    expect(join!.room).toBe("<room-id>");
    // The whole point of the scrub: the actual room code must not
    // appear anywhere in the line's structured fields.
    const serialized = JSON.stringify(join);
    expect(serialized).not.toContain(roomId);

    host.disconnect();
    joiner.disconnect();
  });

  it("socket-disconnect line has no room ID", async () => {
    const c = connectClient(port);
    await new Promise<void>((r) => c.on("connect", r));
    lines.length = 0;
    c.disconnect();
    // Disconnect log fires server-side on the next tick; poll briefly.
    const deadline = Date.now() + 1000;
    let disconnect: typeof lines[number] | undefined;
    while (Date.now() < deadline) {
      disconnect = socketLines().find((l) => l.event === "socket-disconnect");
      if (disconnect) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(disconnect, "expected a socket-disconnect line").toBeDefined();
    expect(disconnect).not.toHaveProperty("room");
    expect(disconnect).not.toHaveProperty("code");
    // The summary count of rooms departed IS part of the policy ("peer
    // count, room join/leave"); it leaks no identifier.
    expect(typeof disconnect!.roomsDeparted).toBe("number");
  });
});
