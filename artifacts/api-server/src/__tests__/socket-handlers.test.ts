// SPDX-License-Identifier: AGPL-3.0-or-later
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
  emitSetKnockMode,
  emitApproveKnock,
  emitBurnRoom,
  emitDestroyRoom,
  emitWithCallback,
  waitForEvent,
  validToken,
  dayTierToken,
  legacyWeekTierToken,
  validRoomId,
  TEST_PAYWALL_SECRET,
} from "./helpers/test-server";
import { resetSocketRateLimits } from "../socketHandlers";

describe("socket handler integration tests", () => {
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
    // Clear in-process rate-limit buckets between cases. All ~280 tests in
    // this file share one Socket.IO server on 127.0.0.1; without this
    // reset, the per-IP join cap (50/min) leaks across cases and later
    // tests that connect a fresh `guest`/`joiner` socket get RATE_LIMITED
    // before `joinRoom` is even called — surfacing as a spurious
    // `success: false` in the extend-room block. See
    // `resetSocketRateLimits` in socketHandlers.ts for the rationale.
    resetSocketRateLimits();
    if (client?.connected) client.disconnect();
    client = connectClient(port);
    await new Promise<void>((resolve) => {
      client.on("connect", resolve);
    });
  });

  afterEach(() => {
    client?.disconnect();
  });

  describe("join-room", () => {
    it("joins an existing room successfully", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      const result = await emitJoinRoom(client2, { code: roomId, peerId: "peer-abc123" });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("peers");
      expect(result).toHaveProperty("expiresAt");
      expect(result).toHaveProperty("serverNow");

      client2.disconnect();
    });

    it("returns ROOM_NOT_FOUND for nonexistent room", async () => {
      const result = await emitJoinRoom(client, { code: validRoomId(), peerId: "peer-abc123" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_NOT_FOUND");
    });

    it("returns INVALID_CODE for bad room code", async () => {
      const result = await emitJoinRoom(client, { code: "bad", peerId: "peer-abc123" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "INVALID_CODE");
    });

    it("returns INVALID_CODE for bad peer ID", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      const result = await emitJoinRoom(client2, { code: roomId, peerId: "bad-peer" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "INVALID_CODE");

      client2.disconnect();
    });

    it("returns ROOM_FULL when room has 4 users", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const clients: ClientSocket[] = [];
      for (let i = 0; i < 4; i++) {
        const c = connectClient(port);
        await new Promise<void>((resolve) => { c.on("connect", resolve); });
        const letters = "abcdef";
        await emitJoinRoom(c, { code: roomId, peerId: `peer-${letters[i]}${letters[i]}${letters[i]}${letters[i]}${letters[i]}${letters[i]}` });
        clients.push(c);
      }

      const extra = connectClient(port);
      await new Promise<void>((resolve) => { extra.on("connect", resolve); });
      const result = await emitJoinRoom(extra, { code: roomId, peerId: "peer-zzzzzz" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_FULL");

      extra.disconnect();
      clients.forEach((c) => c.disconnect());
    });

    it("emits peer-joined to existing room members", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const peerJoinedPromise = waitForEvent(client, "peer-joined");

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const event = await peerJoinedPromise;
      expect(event).toEqual({ peerId: "peer-bbbbbb" });

      client2.disconnect();
    });

    it("emits peer-joined to the host (not the joiner) when a knock is approved (#698)", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
      await emitSetKnockMode(client, { code: roomId, enabled: true });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      // The host must be told a peer arrived so it can run the WebRTC
      // offer path; without it neither side negotiates media.
      const hostPeerJoined = waitForEvent(client, "peer-joined");
      // The admitted joiner must NOT receive a spurious peer-joined
      // about itself.
      let joinerGotPeerJoined = false;
      client2.on("peer-joined", () => { joinerGotPeerJoined = true; });

      const joinResult = await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });
      expect(joinResult).toHaveProperty("error", "KNOCK_PENDING");

      await emitApproveKnock(client, { code: roomId, peerId: "peer-bbbbbb" });

      const event = await hostPeerJoined;
      expect(event).toEqual({ peerId: "peer-bbbbbb" });
      expect(joinerGotPeerJoined).toBe(false);

      client2.disconnect();
    });

    it("rate-limits join-room after 10 attempts", async () => {
      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < 12; i++) {
        results.push(await emitJoinRoom(client, { code: validRoomId(), peerId: "peer-aaaaaa" }));
      }

      expect(results[10]).toHaveProperty("error", "RATE_LIMITED");
      expect(results[11]).toHaveProperty("error", "RATE_LIMITED");
    });
  });

  describe("leave-room", () => {
    it("emits peer-left to remaining users", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const peerLeftPromise = waitForEvent(client, "peer-left");

      client2.emit("leave-room", { code: roomId, peerId: "peer-bbbbbb" });

      const event = await peerLeftPromise;
      expect(event).toEqual({ peerId: "peer-bbbbbb" });

      client2.disconnect();
    });

    it("ignores leave-room from user not in room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      client2.emit("leave-room", { code: roomId, peerId: "peer-zzzzzz" });
      await new Promise((r) => setTimeout(r, 100));

      client2.disconnect();
    });
  });

  describe("lock-room / unlock-room", () => {
    it("host can lock and unlock room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const lockResult = await emitWithCallback(client, "lock-room", { code: roomId });
      expect(lockResult).toEqual({ success: true });

      const unlockResult = await emitWithCallback(client, "unlock-room", { code: roomId });
      expect(unlockResult).toEqual({ success: true });
    });

    it("non-host cannot lock room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const result = await emitWithCallback(client2, "lock-room", { code: roomId });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "NOT_HOST");

      client2.disconnect();
    });

    it("locked room rejects new joins", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });
      await emitWithCallback(client, "lock-room", { code: roomId });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      const result = await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_LOCKED");

      client2.disconnect();
    });

    it("emits room-locked and room-unlocked to room members", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const lockedPromise = waitForEvent(client2, "room-locked");
      await emitWithCallback(client, "lock-room", { code: roomId });
      await lockedPromise;

      const unlockedPromise = waitForEvent(client2, "room-unlocked");
      await emitWithCallback(client, "unlock-room", { code: roomId });
      await unlockedPromise;

      client2.disconnect();
    });
  });

  describe("relay-signal", () => {
    it("relays signal between peers", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const signalPromise = waitForEvent(client2, "relay-signal");

      client.emit("relay-signal", {
        code: roomId,
        toPeerId: "peer-bbbbbb",
        fromPeerId: "peer-aaaaaa",
        payload: { type: "offer", sdp: "test" },
      });

      const signal = await signalPromise as Record<string, unknown>;
      expect(signal).toHaveProperty("fromPeerId", "peer-aaaaaa");
      expect(signal).toHaveProperty("payload");

      client2.disconnect();
    });

    it("drops signal whose payload exceeds the 64 KiB cap (Task #241 / R-N3)", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      let received = false;
      client2.on("relay-signal", () => { received = true; });

      // 64 KiB + 1 byte string payload — must be silently dropped.
      const oversized = "A".repeat(64 * 1024 + 1);
      client.emit("relay-signal", {
        code: roomId,
        toPeerId: "peer-bbbbbb",
        fromPeerId: "peer-aaaaaa",
        payload: oversized,
      });

      await new Promise((r) => setTimeout(r, 200));
      expect(received).toBe(false);

      client2.disconnect();
    });

    it("drops signal with mismatched fromPeerId", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      let received = false;
      client2.on("relay-signal", () => { received = true; });

      client.emit("relay-signal", {
        code: roomId,
        toPeerId: "peer-bbbbbb",
        fromPeerId: "peer-cccccc",
        payload: { type: "offer" },
      });

      await new Promise((r) => setTimeout(r, 200));
      expect(received).toBe(false);

      client2.disconnect();
    });
  });

  describe("disconnect", () => {
    it("emits peer-left when disconnecting", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const peerLeftPromise = waitForEvent(client, "peer-left");
      client2.disconnect();

      const event = await peerLeftPromise;
      expect(event).toEqual({ peerId: "peer-bbbbbb" });
    });

    it("unlocks room when lock owner disconnects", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      await emitWithCallback(client, "lock-room", { code: roomId });

      const unlockedPromise = waitForEvent(client2, "room-unlocked");
      client.disconnect();
      await unlockedPromise;

      client2.disconnect();
    });
  });

  describe("destroy-room", () => {
    it("host can destroy room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const result = await emitWithCallback(client, "destroy-room", { code: roomId });
      expect(result).toEqual({ success: true });
    });

    it("non-host cannot destroy room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const result = await emitWithCallback(client2, "destroy-room", { code: roomId });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "NOT_HOST");

      client2.disconnect();
    });

    it("emits room-destroyed to all members", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });
      await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });

      const destroyedPromise = waitForEvent(client2, "room-destroyed");
      await emitWithCallback(client, "destroy-room", { code: roomId });
      await destroyedPromise;

      client2.disconnect();
    });
  });

  describe("burn-room (Task #696)", () => {
    it("a JOINER (non-host) can burn the room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const joiner = connectClient(port);
      await new Promise<void>((resolve) => { joiner.on("connect", resolve); });
      const joined = await emitJoinRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });
      expect(joined).toHaveProperty("isHost", false);

      const result = await emitWithCallback(joiner, "burn-room", { code: roomId, peerId: "peer-bbbbbb" });
      expect(result).toEqual({ success: true });

      joiner.disconnect();
    });

    it("after a joiner's burn the phrase can no longer be re-joined by anyone", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const joiner = connectClient(port);
      await new Promise<void>((resolve) => { joiner.on("connect", resolve); });
      await emitJoinRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });

      await emitWithCallback(joiner, "burn-room", { code: roomId, peerId: "peer-bbbbbb" });
      joiner.disconnect();

      // The original host trying to re-join the burned phrase is rejected.
      const rejoin = connectClient(port);
      await new Promise<void>((resolve) => { rejoin.on("connect", resolve); });
      const rejoinResult = await emitJoinRoom(rejoin, { code: roomId, peerId: "peer-cccccc" });
      expect(rejoinResult).toHaveProperty("success", false);
      // isRoomExpired() returns true for a missing room, so the join
      // path reports the room as gone (ROOM_NOT_FOUND).
      expect(rejoinResult).toHaveProperty("error", "ROOM_NOT_FOUND");

      rejoin.disconnect();
    });

    it("burn broadcasts room-destroyed to the remaining members", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const joiner = connectClient(port);
      await new Promise<void>((resolve) => { joiner.on("connect", resolve); });
      await emitJoinRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });

      // The HOST should be told the room was destroyed when the JOINER burns.
      const destroyedPromise = waitForEvent(client, "room-destroyed");
      await emitWithCallback(joiner, "burn-room", { code: roomId, peerId: "peer-bbbbbb" });
      await destroyedPromise;

      joiner.disconnect();
    });

    it("a non-member cannot burn a room they never joined", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const outsider = connectClient(port);
      await new Promise<void>((resolve) => { outsider.on("connect", resolve); });

      const result = await emitWithCallback(outsider, "burn-room", { code: roomId, peerId: "peer-zzzzzz" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "NOT_IN_ROOM");

      outsider.disconnect();
    });

    // Full end-to-end proof of the "session burned, all keys destroyed"
    // promise across every layer (Task #703). Earlier cases prove the
    // broadcast and the un-rejoinable phrase in isolation; this one walks
    // the entire real path in a single test — two clients on the live
    // Socket.IO server, the NON-host hits Burn, the other participant is
    // told the room is gone, and a fresh join with the same code is
    // rejected for everyone. This guards against a regression in any
    // single layer that leaves the other assertions still passing.
    it("end-to-end: a non-host burn destroys the room for everyone and the phrase is un-rejoinable (Task #703)", async () => {
      const roomId = validRoomId();
      // Host creates and joins the room.
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      // A second, NON-host participant joins the live room.
      const joiner = connectClient(port);
      await new Promise<void>((resolve) => { joiner.on("connect", resolve); });
      const joined = await emitJoinRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });
      expect(joined).toHaveProperty("isHost", false);

      // The other participant (the host) must be told the room was destroyed.
      const destroyedPromise = waitForEvent(client, "room-destroyed");

      // The NON-host burns the room.
      const burnResult = await emitBurnRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });
      expect(burnResult).toEqual({ success: true });

      await destroyedPromise;
      joiner.disconnect();

      // A fresh join with the same phrase/code is rejected for everyone —
      // the room is gone, the phrase un-rejoinable.
      const rejoin = connectClient(port);
      await new Promise<void>((resolve) => { rejoin.on("connect", resolve); });
      const rejoinResult = await emitJoinRoom(rejoin, { code: roomId, peerId: "peer-cccccc" });
      expect(rejoinResult).toHaveProperty("success", false);
      expect(rejoinResult).toHaveProperty("error", "ROOM_NOT_FOUND");

      rejoin.disconnect();
    });

    // Mirror of the member-burn end-to-end above for the host-only
    // moderation path (destroy-room). Both teardowns must leave the room
    // gone and the phrase un-rejoinable, so both moderation and
    // member-burn are proven at the integration layer (Task #703).
    it("end-to-end: a host destroy tears down the room for everyone and the phrase is un-rejoinable (Task #703)", async () => {
      const roomId = validRoomId();
      // Host creates and joins the room.
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      // A second participant joins the live room.
      const joiner = connectClient(port);
      await new Promise<void>((resolve) => { joiner.on("connect", resolve); });
      await emitJoinRoom(joiner, { code: roomId, peerId: "peer-bbbbbb" });

      // The other participant (the joiner) must be told the room was destroyed.
      const destroyedPromise = waitForEvent(joiner, "room-destroyed");

      // The HOST destroys the room (moderation control).
      const destroyResult = await emitDestroyRoom(client, { code: roomId });
      expect(destroyResult).toEqual({ success: true });

      await destroyedPromise;
      joiner.disconnect();

      // A fresh join with the same phrase/code is rejected for everyone.
      const rejoin = connectClient(port);
      await new Promise<void>((resolve) => { rejoin.on("connect", resolve); });
      const rejoinResult = await emitJoinRoom(rejoin, { code: roomId, peerId: "peer-cccccc" });
      expect(rejoinResult).toHaveProperty("success", false);
      expect(rejoinResult).toHaveProperty("error", "ROOM_NOT_FOUND");

      rejoin.disconnect();
    });
  });

  describe("screen share rate limiting (#57)", () => {
    it("allows up to 5 request-screen-share calls then returns RATE_LIMITED", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const results: Record<string, unknown>[] = [];
      for (let i = 0; i < 7; i++) {
        results.push(
          await emitWithCallback(client, "request-screen-share", { code: roomId, peerId: "peer-aaaaaa" }),
        );
      }

      expect(results[0]).toHaveProperty("success", true);
      expect(results[5]).toHaveProperty("error", "RATE_LIMITED");
      expect(results[6]).toHaveProperty("error", "RATE_LIMITED");
    });
  });

  describe("screen share grant nonce (Task #303)", () => {
    // The server attaches a per-grant nonce to every successful
    // request-screen-share ack so the client can dedup a duplicated
    // grant ack (retransmit / out-of-order delivery) and avoid
    // promoting the same reservation twice into a double-booked
    // presenter slot. The companion broadcast event carries the same
    // nonce so an alternate client codepath that listens to the event
    // (rather than the ack) can dedup against the same token.
    it("ack and screen-share-granted event carry the same fresh nonce on success", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const grantedPromise = waitForEvent(client, "screen-share-granted") as Promise<{ code: string; nonce: string }>;
      const ack = (await emitWithCallback(
        client,
        "request-screen-share",
        { code: roomId, peerId: "peer-aaaaaa" },
      )) as { success: boolean; nonce?: string };
      const granted = await grantedPromise;

      expect(ack).toHaveProperty("success", true);
      expect(typeof ack.nonce).toBe("string");
      expect((ack.nonce ?? "").length).toBeGreaterThan(0);
      expect(granted.nonce).toBe(ack.nonce);
    });

    it("a fresh reservation (after stop) issues a new nonce — guarantees uniqueness across grants", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      await emitJoinRoom(client, { code: roomId, peerId: "peer-aaaaaa" });

      const ack1 = (await emitWithCallback(
        client,
        "request-screen-share",
        { code: roomId, peerId: "peer-aaaaaa" },
      )) as { success: boolean; nonce?: string };
      // Release the reservation without going active so the next request
      // can take a fresh slot.
      await emitWithCallback(client, "screen-share-stopped", { code: roomId, peerId: "peer-aaaaaa" });

      const ack2 = (await emitWithCallback(
        client,
        "request-screen-share",
        { code: roomId, peerId: "peer-aaaaaa" },
      )) as { success: boolean; nonce?: string };

      expect(ack1).toHaveProperty("success", true);
      expect(ack2).toHaveProperty("success", true);
      expect(ack1.nonce).toBeTruthy();
      expect(ack2.nonce).toBeTruthy();
      expect(ack2.nonce).not.toBe(ack1.nonce);
    });
  });

  describe("expired room enforcement (#55)", () => {
    it("lock-room returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "lock-room", { code: validRoomId() });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("unlock-room returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "unlock-room", { code: validRoomId() });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("destroy-room returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "destroy-room", { code: validRoomId() });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("request-screen-share returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "request-screen-share", { code: validRoomId(), peerId: "peer-aaaaaa" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("screen-share-started returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "screen-share-started", { code: validRoomId(), peerId: "peer-aaaaaa" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("screen-share-stopped returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "screen-share-stopped", { code: validRoomId(), peerId: "peer-aaaaaa" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("set-knock-mode returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "set-knock-mode", { code: validRoomId(), enabled: true });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("approve-knock returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "approve-knock", { code: validRoomId(), peerId: "peer-aaaaaa" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });

    it("deny-knock returns ROOM_EXPIRED for nonexistent room", async () => {
      const result = await emitWithCallback(client, "deny-knock", { code: validRoomId(), peerId: "peer-aaaaaa" });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_EXPIRED");
    });
  });

  describe("create-room paid-tier TTL (#115)", () => {
    const HOUR = 60 * 60 * 1000;
    const STANDARD_TTL_MS = 65 * 60 * 1000;
    const DAY_TTL_MS = 24 * 60 * 60 * 1000;

    it("standard token (no tier claim) creates a 65-minute room", async () => {
      const before = Date.now();
      const result = await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() });
      expect(result).toHaveProperty("success", true);
      const expiresAt = result.expiresAt as number;
      expect(expiresAt).toBeGreaterThanOrEqual(before + STANDARD_TTL_MS - 1000);
      expect(expiresAt).toBeLessThanOrEqual(before + STANDARD_TTL_MS + 5000);
    });

    it("day-tier token creates a 24-hour room", async () => {
      const before = Date.now();
      const result = await emitCreateRoom(client, { roomId: validRoomId(), token: dayTierToken() });
      expect(result).toHaveProperty("success", true);
      const expiresAt = result.expiresAt as number;
      expect(expiresAt).toBeGreaterThanOrEqual(before + DAY_TTL_MS - 1000);
      expect(expiresAt).toBeLessThanOrEqual(before + DAY_TTL_MS + 5000);
    });

    it("legacy week-tier token is gracefully capped to a 24-hour room (not silently downgraded to standard)", async () => {
      const before = Date.now();
      const result = await emitCreateRoom(client, { roomId: validRoomId(), token: legacyWeekTierToken() });
      expect(result).toHaveProperty("success", true);
      const expiresAt = result.expiresAt as number;
      // Must be 24h, not 65m. Use a generous lower bound that still excludes standard.
      expect(expiresAt).toBeGreaterThanOrEqual(before + DAY_TTL_MS - 1000);
      expect(expiresAt).toBeLessThanOrEqual(before + DAY_TTL_MS + 5000);
      // And definitely not the standard 65-minute lifetime.
      expect(expiresAt - before).toBeGreaterThan(2 * HOUR);
    });

    // Task #112: end-to-end "the JWT and the room agree on the window" check.
    // The other tests in this block confirm `expiresAt` matches the tier
    // window in absolute terms; this one explicitly cross-references the
    // SAME JWT we hand to create-room so a future refactor that decouples
    // JWT exp from room TTL gets caught.
    it("day-tier room expiresAt aligns with the day-tier JWT exp claim (no drift)", async () => {
      // Mint a JWT whose own `exp` is exactly 24h out, matching the day tier.
      const token = jwt.sign({ authorized: true, tier: "day", jti: crypto.randomBytes(16).toString("hex") }, TEST_PAYWALL_SECRET, { expiresIn: "24h" });
      const decoded = jwt.verify(token, TEST_PAYWALL_SECRET) as { tier: string; exp: number };
      expect(decoded.tier).toBe("day");

      const result = await emitCreateRoom(client, { roomId: validRoomId(), token });
      expect(result).toHaveProperty("success", true);
      const expiresAt = result.expiresAt as number;

      // Room's own expiry must be within a couple of seconds of the JWT's exp.
      // For day-tier the room TTL (24h) matches the JWT window (24h) exactly.
      const jwtExpMs = decoded.exp * 1000;
      expect(Math.abs(expiresAt - jwtExpMs)).toBeLessThanOrEqual(2000);
    });

    it("standard (tier-less) room expiresAt is the JWT exp + 5-min grace window", async () => {
      // Document and pin the intentional 5-minute gap between the JWT exp
      // (1h) and the room TTL (65m) for the standard tier — see rooms.ts
      // ROOM_TTL_MS. If a refactor removes that grace, this test will fail
      // loudly instead of silently shortening every standard room.
      const token = jwt.sign({ authorized: true, jti: crypto.randomBytes(16).toString("hex") }, TEST_PAYWALL_SECRET, { expiresIn: "1h" });
      const decoded = jwt.verify(token, TEST_PAYWALL_SECRET) as { exp: number; tier?: unknown };
      expect(decoded.tier).toBeUndefined();

      const result = await emitCreateRoom(client, { roomId: validRoomId(), token });
      expect(result).toHaveProperty("success", true);
      const expiresAt = result.expiresAt as number;

      // Room expiry should be ~5 min past JWT exp (65m room TTL vs 1h JWT).
      const jwtExpMs = decoded.exp * 1000;
      const gapMs = expiresAt - jwtExpMs;
      expect(gapMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
      expect(gapMs).toBeLessThanOrEqual(5 * 60 * 1000 + 2000);
    });
  });

  describe("tier surfaced to clients so they can show expiry info (#111)", () => {
    it("create-room returns the resolved tier in its callback", async () => {
      const standardResult = await emitCreateRoom(client, { roomId: validRoomId(), token: validToken() });
      expect(standardResult).toHaveProperty("success", true);
      expect(standardResult).toHaveProperty("tier", "standard");

      const dayResult = await emitCreateRoom(client, { roomId: validRoomId(), token: dayTierToken() });
      expect(dayResult).toHaveProperty("success", true);
      expect(dayResult).toHaveProperty("tier", "day");
    });

    it("join-room returns the host's tier so a reloading host sees the same expiry info", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: dayTierToken() });

      const client2 = connectClient(port);
      await new Promise<void>((resolve) => { client2.on("connect", resolve); });

      const result = await emitJoinRoom(client2, { code: roomId, peerId: "peer-bbbbbb" });
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("tier", "day");
      expect(result).toHaveProperty("expiresAt");

      client2.disconnect();
    });
  });

  // ── Task #125: extend-room mid-call top-up ──────────────────────────────
  describe("extend-room: host top-up extends expiry without rejoin", () => {
    function freshExtendToken(tier: "standard" | "day"): string {
      // A unique JWT every time so replay-tracking can't cross test boundaries.
      return jwt.sign(
        { authorized: true, tier, nonce: Math.random().toString(36).slice(2) },
        TEST_PAYWALL_SECRET,
        { expiresIn: "1h" },
      );
    }

    function emitExtend(c: ClientSocket, code: string, token: string) {
      return new Promise<Record<string, unknown>>((resolve) => {
        c.emit("extend-room", { code, token }, (result: Record<string, unknown>) => resolve(result));
      });
    }

    it("happy path: host extends a paid room and the new expiresAt is bumped past the old one", async () => {
      const roomId = validRoomId();
      const created = await emitCreateRoom(client, { roomId, token: validToken() });
      expect(created).toHaveProperty("success", true);
      const beforeExp = created.expiresAt as number;

      const result = await emitExtend(client, roomId, freshExtendToken("standard"));
      expect(result).toHaveProperty("success", true);
      expect(result).toHaveProperty("tier", "standard");
      expect(typeof result.expiresAt).toBe("number");
      expect(typeof result.serverNow).toBe("number");
      expect(result.expiresAt as number).toBeGreaterThan(beforeExp);
      // Bump should be ~ROOM_TTLS.standard (allow timing slack).
      const bump = (result.expiresAt as number) - beforeExp;
      expect(bump).toBeGreaterThan(60 * 60 * 1000 - 5000);
      expect(bump).toBeLessThan(65 * 60 * 1000 + 5000);
    });

    it("broadcasts room-extended to other peers in the room", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const peer = connectClient(port);
      await new Promise<void>((resolve) => peer.on("connect", () => resolve()));
      const joined = await emitJoinRoom(peer, { code: roomId, peerId: "peer-zzzzzz" });
      expect(joined).toHaveProperty("success", true);

      const broadcast = waitForEvent(peer, "room-extended", 2000);
      const ext = await emitExtend(client, roomId, freshExtendToken("standard"));
      expect(ext).toHaveProperty("success", true);

      const event = (await broadcast) as { expiresAt?: number; serverNow?: number; tier?: string };
      expect(typeof event.expiresAt).toBe("number");
      expect(typeof event.serverNow).toBe("number");
      expect(event.tier).toBe("standard");
      expect(event.expiresAt).toBe(ext.expiresAt);

      peer.disconnect();
    });

    it("non-host extending the same room is rejected with NOT_HOST", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const guest = connectClient(port);
      await new Promise<void>((resolve) => guest.on("connect", () => resolve()));
      const joined = await emitJoinRoom(guest, { code: roomId, peerId: "peer-yyyyyy" });
      expect(joined).toHaveProperty("success", true);

      const result = await emitExtend(guest, roomId, freshExtendToken("standard"));
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "NOT_HOST");

      guest.disconnect();
    });

    it("the same paid token cannot be replayed for two extensions", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const token = freshExtendToken("standard");
      const first = await emitExtend(client, roomId, token);
      expect(first).toHaveProperty("success", true);

      const second = await emitExtend(client, roomId, token);
      expect(second).toHaveProperty("success", false);
      expect(second).toHaveProperty("error", "TOKEN_ALREADY_USED");
    });

    it("rejects extension on unknown room code", async () => {
      const result = await emitExtend(client, validRoomId(), freshExtendToken("standard"));
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "ROOM_NOT_FOUND");
    });

    it("rejects malformed inputs without crashing", async () => {
      const r1 = await emitExtend(client, "not-a-valid-code", freshExtendToken("standard"));
      expect(r1).toHaveProperty("success", false);
      expect(r1).toHaveProperty("error", "INVALID_CODE");

      // Missing/garbage token → PAYMENT_REQUIRED (jwt.verify throws).
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });
      const r2 = await emitExtend(client, roomId, "garbage.jwt.string");
      expect(r2).toHaveProperty("success", false);
      expect(r2).toHaveProperty("error", "PAYMENT_REQUIRED");
    });

    it("rejects free (tier-less) tokens — extension is paid-only", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      // validToken() carries no `tier` claim — it predates the tier system.
      // Extension is a paid-only flow, so we refuse.
      const result = await emitExtend(client, roomId, validToken());
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "PAYMENT_REQUIRED");
    });

    it("persists the new tier in room state so a peer who joins later sees the extended tier", async () => {
      // Host creates a STANDARD room then pays for a DAY extension. A new
      // peer joining after the extension should be told the room is now
      // "day" — matching what the broadcast told the in-call peers.
      const roomId = validRoomId();
      const created = await emitCreateRoom(client, { roomId, token: validToken() });
      expect(created).toHaveProperty("tier", "standard");

      const ext = await emitExtend(client, roomId, freshExtendToken("day"));
      expect(ext).toHaveProperty("success", true);
      expect(ext).toHaveProperty("tier", "day");

      const joiner = connectClient(port);
      await new Promise<void>((resolve) => joiner.on("connect", () => resolve()));
      const joined = await emitJoinRoom(joiner, { code: roomId, peerId: "peer-xxxxxx" });
      expect(joined).toHaveProperty("success", true);
      expect(joined).toHaveProperty("tier", "day");
      // And the expiresAt the joiner sees matches what extension produced.
      expect(joined.expiresAt).toBe(ext.expiresAt);

      joiner.disconnect();
    });
  });

  // ── Task #178: paywall JWT algorithm pinning ───────────────────────────
  // Both `create-room` and `extend-room` pass `{ algorithms: ["HS256"] }`
  // explicitly to `jwt.verify`, so a token whose header advertises any other
  // algorithm — even one in the HS family the library would otherwise accept
  // by default for a string secret — must be rejected. This locks the
  // verifier's behavior against future jsonwebtoken default changes
  // (security audit §3.2).
  describe("paywall JWT is verified with algorithms pinned to HS256 (#178)", () => {
    it("create-room rejects a token signed with HS384 even though the secret matches", async () => {
      const hs384Token = jwt.sign(
        { authorized: true, jti: crypto.randomBytes(16).toString("hex") },
        TEST_PAYWALL_SECRET,
        { expiresIn: "1h", algorithm: "HS384" },
      );
      const result = await emitCreateRoom(client, { roomId: validRoomId(), token: hs384Token });
      expect(result).toHaveProperty("error", "PAYMENT_REQUIRED");
    });

    it("extend-room rejects a token signed with HS384 even though the secret matches", async () => {
      const roomId = validRoomId();
      await emitCreateRoom(client, { roomId, token: validToken() });

      const hs384Token = jwt.sign(
        { authorized: true, tier: "standard", jti: crypto.randomBytes(16).toString("hex") },
        TEST_PAYWALL_SECRET,
        { expiresIn: "1h", algorithm: "HS384" },
      );
      const result = await new Promise<Record<string, unknown>>((resolve) => {
        client.emit("extend-room", { code: roomId, token: hs384Token }, (r: Record<string, unknown>) => resolve(r));
      });
      expect(result).toHaveProperty("success", false);
      expect(result).toHaveProperty("error", "PAYMENT_REQUIRED");
    });
  });

  // Cooperative relay-only request flow (Task #106) is covered in
  // __tests__/relay-only-request.test.ts — kept in a separate file so the
  // per-IP join-room rate limit (50/min, see checkIpJoinRate) doesn't
  // accidentally throttle these tests when appended to this large file.

});
