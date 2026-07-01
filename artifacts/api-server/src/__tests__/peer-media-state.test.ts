// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #868: per-peer media-state (camOff / micMuted / voiceMode /
// viaOnion) no longer transits the signaling server. It used to ride a
// plaintext `peer-media-state` socket broadcast (Task #114 added voiceMode
// forwarding; Task #349 added viaOnion) which meant the relay saw — and
// could have logged — every mute/camera toggle. It now travels peer-to-
// peer over a `void.media-state` RTCDataChannel (DTLS-over-SCTP); the
// server has no handler for it at all.
//
// This file is the server-side regression guard for that removal: if a
// future change re-adds a `peer-media-state` handler (re-exposing the
// transcript to the relay), these tests fail. The client-side validation
// + late-joiner convergence contract that used to live here now lives in
// `artifacts/void-client/src/lib/webrtc.mediastate.test.ts`.
//
// Lives in its own file (with its own server in `beforeAll`) so the extra
// joins it performs do not stack onto the per-IP join-room rate-limit
// bucket of the much larger socket-handlers suite — same reasoning as
// `relay-only-request.test.ts`.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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

describe("Task #868 — server no longer relays peer-media-state", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;
  let sender: ClientSocket;
  let receiver: ClientSocket;
  let roomId: string;
  const senderPeerId = "peer-aaaaaa";
  const receiverPeerId = "peer-bbbbbb";

  beforeAll(async () => {
    const srv = await startServer();
    httpServer = srv.httpServer;
    io = srv.io;
    port = srv.port;
  });

  afterAll(async () => {
    sender?.disconnect();
    receiver?.disconnect();
    io.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  beforeEach(async () => {
    sender = connectClient(port);
    receiver = connectClient(port);
    await Promise.all([
      new Promise<void>((resolve) => sender.on("connect", () => resolve())),
      new Promise<void>((resolve) => receiver.on("connect", () => resolve())),
    ]);

    roomId = validRoomId();
    await emitCreateRoom(sender, { roomId, token: validToken() });
    await emitJoinRoom(sender, { code: roomId, peerId: senderPeerId });
    await emitJoinRoom(receiver, { code: roomId, peerId: receiverPeerId });
  });

  afterEach(() => {
    sender?.disconnect();
    receiver?.disconnect();
  });

  it("does not broadcast a `peer-media-state` event to other peers in the room", async () => {
    let hits = 0;
    receiver.on("peer-media-state", () => {
      hits++;
    });

    // A well-formed legacy emit — exactly what a pre-#868 client would
    // have sent. With the handler removed, the server must ignore it: no
    // broadcast, no echo, nothing on the wire to the other peer.
    sender.emit("peer-media-state", {
      code: roomId,
      peerId: senderPeerId,
      camOff: true,
      micMuted: true,
      voiceMode: 3,
      viaOnion: true,
    });

    // Give socket.io a real-time tick to flush anything it shouldn't have.
    await new Promise((r) => setTimeout(r, 200));
    expect(hits).toBe(0);
  });

  it("does not echo a `peer-media-state` event back to the sender either", async () => {
    let echoes = 0;
    sender.on("peer-media-state", () => {
      echoes++;
    });

    sender.emit("peer-media-state", {
      code: roomId,
      peerId: senderPeerId,
      camOff: false,
      micMuted: false,
    });

    await new Promise((r) => setTimeout(r, 200));
    expect(echoes).toBe(0);
  });
});
