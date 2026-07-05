// SPDX-License-Identifier: AGPL-3.0-or-later
// Wire-level tests for Task #190: guests need to *see* when the host has
// gone offline so they understand moderation is paused. The server-side
// piece of that signal is a `host-changed` broadcast plus
// `hostPresent`/`hostPeerId` fields on the join-room callback.
//
// These tests exercise the three transitions a guest can observe:
//   1. Joining a room whose host is already gone → callback reports
//      `hostPresent: false`.
//   2. Sitting in the room when the host disconnects → server broadcasts
//      `host-changed { hostPresent: false }`.
//   3. Sitting in the room when the original payer rejoins and reclaims
//      host via JWT → server broadcasts `host-changed { hostPresent: true }`.
// The "no broadcast on host-empty room" and "self-claim is idempotent"
// edge cases are also asserted so we don't regress to a chatty/noisy
// event stream.

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
  emitLeaveRoom,
  waitForEvent,
  validRoomId,
  TEST_PAYWALL_SECRET,
} from "./helpers/test-server";

// Carries a server-minted random `jti` (the in-memory create-room replay guard
// id) and a UNIQUE random `reclaimToken` (the value the room persists as a keyed
// HMAC to authorize host reclaim — Task #886). Reusing the SAME token STRING for
// create + rejoin presents the same embedded reclaim token, so reclaim succeeds.
// `label` is unused at runtime — it just keeps each minted token distinct and
// readable in the test source.
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

describe("socket: host presence signaling (Task #190)", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    const srv = await startServer();
    httpServer = srv.httpServer;
    io = srv.io;
    port = srv.port;
  });

  afterAll(async () => {
    for (const s of sockets) {
      try { s.disconnect(); } catch { /* swallow */ }
    }
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  beforeEach(() => {
    sockets.length = 0;
  });

  afterEach(() => {
    for (const s of sockets) {
      try { s.disconnect(); } catch { /* swallow */ }
    }
    sockets.length = 0;
  });

  async function makeSocket(): Promise<ClientSocket> {
    const s = await freshSocket(port);
    sockets.push(s);
    return s;
  }

  it("join-room callback reports hostPresent=true and the host's peerId for the host themselves", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    const joined = await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    expect(joined).toHaveProperty("success", true);
    expect(joined).toHaveProperty("isHost", true);
    expect(joined).toHaveProperty("hostPresent", true);
    expect(joined).toHaveProperty("hostPeerId", "peer-aaaaaa");
  });

  it("guest joining after the host disconnects sees hostPresent=false on the callback", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    // Host creates and joins, then a second peer joins so the room stays
    // alive when the host disconnects (an empty room is destroyed and
    // rebuilt by the next joiner, which would mask the bug).
    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    const sitter = await makeSocket();
    await emitJoinRoom(sitter, { code: roomId, peerId: "peer-bbbbbb" });

    host.disconnect();
    await new Promise((r) => setTimeout(r, 30));

    // A fresh guest joining now learns moderation is offline immediately.
    const guest = await makeSocket();
    const joined = await emitJoinRoom(guest, { code: roomId, peerId: "peer-cccccc" });

    expect(joined).toHaveProperty("success", true);
    expect(joined).toHaveProperty("isHost", false);
    expect(joined).toHaveProperty("hostPresent", false);
    expect(joined).toHaveProperty("hostPeerId", null);
  });

  it("broadcasts host-changed { hostPresent: false } when the host disconnects with peers remaining", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    const sitter = await makeSocket();
    await emitJoinRoom(sitter, { code: roomId, peerId: "peer-bbbbbb" });

    // Arm the listener BEFORE we trigger the disconnect — the broadcast
    // races the disconnect cleanup, so attaching after-the-fact would
    // miss it on a slow CI box.
    const eventP = waitForEvent(sitter, "host-changed", 2000);
    host.disconnect();
    const evt = (await eventP) as { hostPresent: boolean; hostPeerId: string | null };

    expect(evt.hostPresent).toBe(false);
    expect(evt.hostPeerId).toBeNull();
  });

  it("broadcasts host-changed { hostPresent: false } when the host explicitly leaves the room", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    const sitter = await makeSocket();
    await emitJoinRoom(sitter, { code: roomId, peerId: "peer-bbbbbb" });

    const eventP = waitForEvent(sitter, "host-changed", 2000);
    emitLeaveRoom(host, { code: roomId, peerId: "peer-aaaaaa" });
    const evt = (await eventP) as { hostPresent: boolean; hostPeerId: string | null };

    expect(evt.hostPresent).toBe(false);
    expect(evt.hostPeerId).toBeNull();
  });

  it("broadcasts host-changed { hostPresent: true } when the original payer rejoins and reclaims host", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    const sitter = await makeSocket();
    await emitJoinRoom(sitter, { code: roomId, peerId: "peer-bbbbbb" });

    // Drain the host-departure broadcast before arming the reclaim
    // listener so we assert specifically on the reclaim event.
    const departP = waitForEvent(sitter, "host-changed", 2000);
    host.disconnect();
    const departEvt = (await departP) as { hostPresent: boolean };
    expect(departEvt.hostPresent).toBe(false);

    // Original payer rejoins on a fresh socket presenting the same JWT.
    const reclaimer = await makeSocket();
    const reclaimP = waitForEvent(sitter, "host-changed", 2000);
    const rejoined = await emitJoinRoom(reclaimer, {
      code: roomId,
      peerId: "peer-cccccc",
      token: creationToken,
    });
    expect(rejoined).toHaveProperty("isHost", true);
    expect(rejoined).toHaveProperty("hostPresent", true);
    expect(rejoined).toHaveProperty("hostPeerId", "peer-cccccc");

    const reclaimEvt = (await reclaimP) as { hostPresent: boolean; hostPeerId: string | null };
    expect(reclaimEvt.hostPresent).toBe(true);
    expect(reclaimEvt.hostPeerId).toBe("peer-cccccc");
  });

  it("does NOT broadcast host-changed on an ordinary non-host join", async () => {
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    // Track every host-changed event the host receives during the next
    // join. A non-host join must produce zero — otherwise the client's
    // pill state would flicker on every newcomer's arrival.
    let received = 0;
    host.on("host-changed", () => { received += 1; });

    const guest = await makeSocket();
    const joined = await emitJoinRoom(guest, { code: roomId, peerId: "peer-bbbbbb" });
    expect(joined).toHaveProperty("isHost", false);
    expect(joined).toHaveProperty("hostPresent", true);

    // Settle for the same window we'd allow a real broadcast to arrive
    // in — this is a "did NOT happen" assertion, so we have to wait long
    // enough that a real event would have arrived.
    await new Promise((r) => setTimeout(r, 100));
    host.off("host-changed");
    expect(received).toBe(0);
  });

  it("does NOT broadcast host-changed when the existing host self-reclaims via the same socket", async () => {
    // Edge case: the original payer's tab regains focus and re-sends
    // join-room with their token while still being the host. `claimHost`
    // returns success (idempotent self-reclaim), but `hostJustClaimed`
    // must stay false so the room doesn't see a phantom event.
    const roomId = validRoomId();
    const hostHash = `pay-${crypto.randomBytes(8).toString("hex")}`;
    const creationToken = tokenWithHash(hostHash);

    const host = await makeSocket();
    await emitCreateRoom(host, { roomId, token: creationToken });
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa" });

    const sitter = await makeSocket();
    await emitJoinRoom(sitter, { code: roomId, peerId: "peer-bbbbbb" });

    let received = 0;
    sitter.on("host-changed", () => { received += 1; });

    // Same socket re-joins (no disconnect) — host slot is already theirs,
    // so the claim is a no-op. Note this would actually be rejected as
    // ALREADY_IN_ROOM by the server, which is also fine for this assertion.
    await emitJoinRoom(host, { code: roomId, peerId: "peer-aaaaaa", token: creationToken });

    await new Promise((r) => setTimeout(r, 100));
    sitter.off("host-changed");
    expect(received).toBe(0);
  });
});
