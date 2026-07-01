// SPDX-License-Identifier: AGPL-3.0-or-later
// Wire-level tests for Task #171 / audit finding M-02: a paying host stays
// the host. After a room becomes empty, only a socket presenting a JWT
// whose `reclaimToken` matches `room.hostReclaimTokenHashes` may reclaim host
// on rejoin. The `reclaimToken` is a per-room random value decoupled from the
// Lightning `paymentHash` (Task #886). This file is intentionally separate
// from `socket-handlers.test.ts` so its joins don't share the 50/60s IP-level
// `join-room` rate limit budget with the rest of the integration suite.
//
// Branch-level coverage of `claimHost` (mismatched token, idempotency,
// HOST_PRESENT, NOT_IN_ROOM, extension-token claim) lives in
// `rooms.test.ts`; this file proves the end-to-end socket plumbing.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import {
  startServer,
  connectClient,
  emitCreateRoom,
  emitJoinRoom,
  emitWithCallback,
  validRoomId,
  TEST_PAYWALL_SECRET,
} from "./helpers/test-server";

// Mints a JWT carrying both a UNIQUE random `jti` (for the in-memory single-use
// create-room replay guard — Task #889 replaced the payment-derived key with a
// fresh random one so nothing payment-derived reaches the client) and a UNIQUE
// random `reclaimToken` (the value the room persists, as a keyed HMAC, to
// authorize host reclaim — Task #886). Both are random per call so two
// separately-minted tokens never collide on the replay guard or share reclaim
// authority; a test that reuses the SAME token STRING for create + rejoin still
// presents the same embedded `jti` and reclaim token. The `label` argument is
// retained only to make call sites self-documenting (which conceptual payer the
// token stands in for); it is no longer embedded in the JWT.
function tokenWithHash(label: string): string {
  void label;
  return jwt.sign(
    {
      authorized: true,
      tier: "standard",
      jti: crypto.randomBytes(16).toString("hex"),
      reclaimToken: crypto.randomBytes(32).toString("hex"),
    },
    TEST_PAYWALL_SECRET,
    { expiresIn: "1h" },
  );
}

async function freshSocket(port: number): Promise<ClientSocket> {
  const c = connectClient(port);
  await new Promise<void>((resolve) => c.on("connect", () => resolve()));
  return c;
}

describe("socket: host binding to reclaim token (Task #171, M-02, #886)", () => {
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
    client = await freshSocket(port);
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("original payer reclaims host on rejoin by presenting the creation token", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    // Original host creates and joins the room, then disconnects so the
    // room is empty (hostSocketId=null) but still alive.
    const created = await emitCreateRoom(client, { roomId, token: creationToken });
    expect(created).toHaveProperty("success", true);
    const creatorJoined = await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
    expect(creatorJoined).toHaveProperty("success", true);
    expect(creatorJoined).toHaveProperty("isHost", true);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 30));

    // Same human reconnects on a fresh socket and rejoins, presenting
    // the same JWT (same reclaimToken) — they reclaim host.
    const rejoinClient = await freshSocket(port);
    const rejoined = await emitJoinRoom(rejoinClient, {
      code: roomId,
      peerId: "peer-bbbbbb",
      token: creationToken,
    });
    expect(rejoined).toHaveProperty("success", true);
    expect(rejoined).toHaveProperty("isHost", true);

    rejoinClient.disconnect();
  });

  it("a different reclaim token cannot hijack host on a vacated room", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const attackerHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);
    const attackerToken = tokenWithHash(attackerHash);

    await emitCreateRoom(client, { roomId, token: creationToken });
    const creatorJoined = await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
    expect(creatorJoined).toHaveProperty("isHost", true);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 30));

    const attacker = await freshSocket(port);
    const joined = await emitJoinRoom(attacker, {
      code: roomId,
      peerId: "peer-bbbbbb",
      token: attackerToken,
    });
    // Join still succeeds (the phrase opens the door) but they are NOT host.
    expect(joined).toHaveProperty("success", true);
    expect(joined).toHaveProperty("isHost", false);

    // Confirm via the wire that they cannot moderate.
    const destroyResult = await emitWithCallback(attacker, "destroy-room", { code: roomId });
    expect(destroyResult).toHaveProperty("success", false);
    expect(destroyResult).toHaveProperty("error", "NOT_HOST");

    attacker.disconnect();
  });

  it("rejoining without any token yields a non-host participant", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    await emitCreateRoom(client, { roomId, token: creationToken });
    const creatorJoined = await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
    expect(creatorJoined).toHaveProperty("isHost", true);
    client.disconnect();
    await new Promise((r) => setTimeout(r, 30));

    const passerby = await freshSocket(port);
    const joined = await emitJoinRoom(passerby, {
      code: roomId,
      peerId: "peer-bbbbbb",
    });
    expect(joined).toHaveProperty("success", true);
    expect(joined).toHaveProperty("isHost", false);

    passerby.disconnect();
  });

  it("a paid extension JWT can also reclaim host on rejoin", async () => {
    const roomId = validRoomId();
    const creationHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const extensionHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(creationHash);
    const extensionToken = tokenWithHash(extensionHash);

    await emitCreateRoom(client, { roomId, token: creationToken });
    const creatorJoined = await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
    expect(creatorJoined).toHaveProperty("isHost", true);

    // Host pays for an extension while still in the room. The server-side
    // side-effect under test is `addHostReclaimToken(code, <extension token>)`.
    const ext = await emitWithCallback(client, "extend-room", { code: roomId, token: extensionToken });
    expect(ext).toHaveProperty("success", true);

    client.disconnect();
    await new Promise((r) => setTimeout(r, 30));

    // Rejoin presenting ONLY the extension token — host is reclaimed.
    const rejoinClient = await freshSocket(port);
    const rejoined = await emitJoinRoom(rejoinClient, {
      code: roomId,
      peerId: "peer-bbbbbb",
      token: extensionToken,
    });
    expect(rejoined).toHaveProperty("success", true);
    expect(rejoined).toHaveProperty("isHost", true);

    rejoinClient.disconnect();
  });
});
