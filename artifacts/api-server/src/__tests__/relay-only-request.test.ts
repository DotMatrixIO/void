// SPDX-License-Identifier: AGPL-3.0-or-later
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
  waitForEvent,
  validToken,
  validRoomId,
} from "./helpers/test-server";

// Cooperative relay-only request flow (Task #106). Host-decides policy is
// preserved: any peer can ASK to flip the room into relay-only, but only
// the host can flip it. The signaling contract is:
//   - request-relay-only          (member → server)
//   - relay-only-requested        (server → host)
//   - respond-relay-only-request  (host → server)
//   - room-relay-mode-enabled     (server → all)        on accept
//   - relay-only-request-declined (server → requester)  on decline
//
// These tests live in their own file (separate vitest worker) so the
// per-IP join-room rate limit (50/min, see checkIpJoinRate in
// socketHandlers.ts) starts fresh — when appended to socket-handlers.test.ts
// the cumulative join-room churn from earlier suites pushed every member's
// join into RATE_LIMITED.
describe("cooperative relay-only request flow (#106)", () => {
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
    await new Promise<void>((resolve) => {
      client.on("connect", resolve);
    });
  });

  afterEach(() => {
    client?.disconnect();
  });

  it("forwards a member's request to the host with the requester's peerId", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    // Host must explicitly join their own room to become a member —
    // create-room only reserves the room and the host slot.
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    const hostNotified = waitForEvent(client, "relay-only-requested");
    const ack = await emitWithCallback(member, "request-relay-only", { code: roomId });
    expect(ack).toHaveProperty("success", true);

    const evt = (await hostNotified) as { peerId: string };
    expect(evt.peerId).toBe("peer-mmmmmm");

    member.disconnect();
  });

  it("on accept, broadcasts room-relay-mode-enabled to every member", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    const hostNotified = waitForEvent(client, "relay-only-requested");
    await emitWithCallback(member, "request-relay-only", { code: roomId });
    await hostNotified;

    const hostBroadcast = waitForEvent(client, "room-relay-mode-enabled");
    const memberBroadcast = waitForEvent(member, "room-relay-mode-enabled");

    const resp = await emitWithCallback(client, "respond-relay-only-request", {
      code: roomId,
      peerId: "peer-mmmmmm",
      accept: true,
    });
    expect(resp).toHaveProperty("success", true);

    // Both the host and the requester get the broadcast — the room flag
    // applies to everyone, so the renegotiation must apply to everyone.
    await hostBroadcast;
    await memberBroadcast;

    member.disconnect();
  });

  it("on decline, only the requester is notified — quiet by design", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    const hostNotified = waitForEvent(client, "relay-only-requested");
    await emitWithCallback(member, "request-relay-only", { code: roomId });
    await hostNotified;

    // Host should NOT get the requester-only "declined" event.
    let hostGotDeclined = false;
    client.once("relay-only-request-declined", () => { hostGotDeclined = true; });
    // Host should NOT get a relay-mode-enabled either — decline doesn't
    // flip the room.
    let hostGotEnabled = false;
    client.once("room-relay-mode-enabled", () => { hostGotEnabled = true; });

    const memberDeclined = waitForEvent(member, "relay-only-request-declined");

    const resp = await emitWithCallback(client, "respond-relay-only-request", {
      code: roomId,
      peerId: "peer-mmmmmm",
      accept: false,
    });
    expect(resp).toHaveProperty("success", true);

    await memberDeclined;
    // Give the loop a tick so any errant broadcast would have landed.
    await new Promise((r) => setTimeout(r, 50));
    expect(hostGotDeclined).toBe(false);
    expect(hostGotEnabled).toBe(false);

    member.disconnect();
  });

  it("rejects request-relay-only from a socket that is not in the room", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    // `intruder` connects but never joins the room.
    const intruder = connectClient(port);
    await new Promise<void>((r) => intruder.on("connect", () => r()));

    const ack = await emitWithCallback(intruder, "request-relay-only", { code: roomId });
    expect(ack).toEqual({ success: false, error: "NOT_IN_ROOM" });

    intruder.disconnect();
  });

  it("rejects respond-relay-only-request from a non-host member", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    // A non-host trying to "answer" their own (or someone else's)
    // request must be refused — host-decides policy.
    const ack = await emitWithCallback(member, "respond-relay-only-request", {
      code: roomId,
      peerId: "peer-mmmmmm",
      accept: true,
    });
    expect(ack).toEqual({ success: false, error: "NOT_HOST" });

    member.disconnect();
  });

  it("short-circuits with alreadyEnabled when the room is already relay-only", async () => {
    const roomId = validRoomId();
    // Host creates the room ALREADY in relay-only mode — no host prompt
    // should be raised for a no-op flip.
    await emitCreateRoom(client, { roomId, token: validToken(), relayOnly: true });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    let hostPrompted = false;
    client.once("relay-only-requested", () => { hostPrompted = true; });

    const ack = await emitWithCallback(member, "request-relay-only", { code: roomId });
    expect(ack).toEqual({ success: true, alreadyEnabled: true });

    // Brief tick to ensure no late prompt sneaks in.
    await new Promise((r) => setTimeout(r, 50));
    expect(hostPrompted).toBe(false);

    member.disconnect();
  });

  it("returns NO_HOST when the host has disconnected mid-call", async () => {
    // Host creates the room, joins, then disconnects — leaving a hostless
    // room (room.hostSocketId === null but the room is not destroyed
    // because another member is still in it). A member's request can't
    // be delivered because there's no host socket to forward to.
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });

    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    // Pre-arm peer-left so we know the host's drop has propagated to the
    // member before we ask. Without this we can race the cleanup.
    const memberSawHostLeft = waitForEvent(member, "peer-left");
    client.disconnect();
    await memberSawHostLeft;

    const ack = await emitWithCallback(member, "request-relay-only", { code: roomId });
    expect(ack).toEqual({ success: false, error: "NO_HOST" });

    member.disconnect();
  });

  it("host self-trigger broadcasts immediately without waiting for a prompt", async () => {
    // The host calling request-relay-only on their own room is a
    // self-flip — there's nobody else to ask, so we enable directly
    // and broadcast room-relay-mode-enabled.
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });

    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    const memberBroadcast = waitForEvent(member, "room-relay-mode-enabled");
    const ack = await emitWithCallback(client, "request-relay-only", { code: roomId });
    expect(ack).toHaveProperty("success", true);
    await memberBroadcast;

    member.disconnect();
  });

  it("rate-limits request-relay-only after 3 attempts in the window", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });
    const member = connectClient(port);
    await new Promise<void>((r) => member.on("connect", () => r()));
    await emitJoinRoom(member, { code: roomId, peerId: "peer-mmmmmm" });

    // Quietly drain any host-side prompts so they don't accumulate.
    client.on("relay-only-requested", () => {});

    const r1 = await emitWithCallback(member, "request-relay-only", { code: roomId });
    const r2 = await emitWithCallback(member, "request-relay-only", { code: roomId });
    const r3 = await emitWithCallback(member, "request-relay-only", { code: roomId });
    const r4 = await emitWithCallback(member, "request-relay-only", { code: roomId });
    expect(r1).toHaveProperty("success", true);
    expect(r2).toHaveProperty("success", true);
    expect(r3).toHaveProperty("success", true);
    expect(r4).toEqual({ success: false, error: "RATE_LIMITED" });

    member.disconnect();
  });

  it("validates input on respond-relay-only-request", async () => {
    const roomId = validRoomId();
    await emitCreateRoom(client, { roomId, token: validToken() });
    await emitJoinRoom(client, { code: roomId, peerId: "peer-hhhhhh" });

    const bad1 = await emitWithCallback(client, "respond-relay-only-request", {
      code: roomId,
      peerId: "not-a-peer-id",
      accept: true,
    });
    expect(bad1).toEqual({ success: false, error: "INVALID_REQUEST" });

    const bad2 = await emitWithCallback(client, "respond-relay-only-request", {
      code: roomId,
      peerId: "peer-aaaaaa",
      accept: "yes" as unknown as boolean,
    });
    expect(bad2).toEqual({ success: false, error: "INVALID_REQUEST" });
  });
});
