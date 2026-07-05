// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end test for the cooperative relay-only flow (Task #210).
//
// The server-side signaling contract is already covered by
// `relay-only-request.test.ts`. This file tests the CLIENT-SIDE
// renegotiation that the feature exists to enable: after a non-host
// peer triggers the cooperative flow and the host accepts, both peers'
// RTCPeerConnections must be rebuilt under `iceTransportPolicy: "relay"`.
//
// Architecture mirrors `forged-peer-e2e.test.ts`:
//   - Two real WebRTCManager instances wired to a real socket.io relay
//     (bootstrapped via `registerSocketHandlers`).
//   - A FakePeerConnection shim that records the `iceTransportPolicy`
//     it was constructed with — the only thing the forged-peer shim
//     did not need to track.
//   - The test drives the full cooperative flow end-to-end:
//       1. Host and non-host establish an initial connection
//          (iceTransportPolicy: "all").
//       2. Non-host emits `request-relay-only`.
//       3. Host receives `relay-only-requested`, accepts.
//       4. Server broadcasts `room-relay-mode-enabled` to all members.
//       5. Both managers call setIceTransportPolicy("relay") then
//          reinitializeAllPeers(initiateTo) — the same call the
//          production UI component makes.
//       6. Assertions:
//            a. Every PC built after the broadcast has
//               iceTransportPolicy === "relay".
//            b. Every PC built before the broadcast (policy "all")
//               is closed — no stale "all" connection survives.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import nodeCrypto from "node:crypto";

import { registerSocketHandlers } from "../socketHandlers";

import {
  WebRTCManager,
  type PeerConnectionStates,
  type SecureChannelFailures,
} from "../../../void-client/src/lib/webrtc";

// ─── Fake browser globals ────────────────────────────────────────────────
//
// We extend the FakePeerConnection from the forged-peer test with one
// additional field: `iceTransportPolicy`, captured from the constructor
// options. This is the value the test assertions read to prove PCs were
// re-built with the correct policy.

class FakePeerConnection {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  addTrackCalls: Array<{ kind: string }> = [];
  readonly iceTransportPolicy: RTCIceTransportPolicy;

  constructor(opts: RTCConfiguration) {
    this.iceTransportPolicy = opts?.iceTransportPolicy ?? "all";
  }

  addTrack(track: MediaStreamTrack): void {
    this.addTrackCalls.push({ kind: track.kind });
  }

  getSenders(): RTCRtpSender[] {
    return [];
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: "answer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(): Promise<void> {}
  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}

  close(): void {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }

  get localDescription(): RTCSessionDescription {
    return { type: "offer", sdp: STUB_VALID_SDP } as RTCSessionDescription;
  }
}

// Minimal SDP that passes the H-03 inbound validator (Task #466) —
// session fields + DTLS fingerprint + an Opus audio m-section.
const STUB_VALID_SDP = [
  "v=0",
  "o=- 0 0 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=rtpmap:111 opus/48000/2",
  "",
].join("\r\n");

class FakeMediaStream {
  private tracks: MediaStreamTrack[];

  constructor(tracks?: MediaStreamTrack[]) {
    this.tracks = tracks ? [...tracks] : [];
  }

  getTracks(): MediaStreamTrack[] { return [...this.tracks]; }
  getAudioTracks(): MediaStreamTrack[] { return this.tracks.filter((t) => t.kind === "audio"); }
  getVideoTracks(): MediaStreamTrack[] { return this.tracks.filter((t) => t.kind === "video"); }
  addTrack(t: MediaStreamTrack): void { this.tracks.push(t); }
  removeTrack(t: MediaStreamTrack): void { this.tracks = this.tracks.filter((x) => x !== t); }
  addEventListener(): void {}
  removeEventListener(): void {}
}

function fakeAudioTrack(id: string): MediaStreamTrack {
  return { kind: "audio", id, stop: () => {} } as unknown as MediaStreamTrack;
}

function localStreamWith(suffix: string): MediaStream {
  return new FakeMediaStream([fakeAudioTrack(`audio-${suffix}`)]) as unknown as MediaStream;
}

function installBrowserGlobals(): void {
  // @ts-expect-error - polyfilling browser global for Node test environment
  globalThis.RTCPeerConnection = FakePeerConnection;
  // @ts-expect-error - polyfilling browser global for Node test environment
  globalThis.MediaStream = FakeMediaStream;
}

// ─── Server bootstrap ────────────────────────────────────────────────────

const TEST_PAYWALL_SECRET = nodeCrypto.randomBytes(32).toString("hex");

function freshJti(): string {
  return nodeCrypto.randomBytes(16).toString("hex");
}

function dayTierToken(): string {
  return jwt.sign(
    { authorized: true, tier: "day", jti: freshJti() },
    TEST_PAYWALL_SECRET,
    { expiresIn: "24h" },
  );
}

function validRoomId(): string {
  return nodeCrypto.randomBytes(16).toString("hex");
}

let httpServer: HttpServer;
let io: SocketIOServer;
let port: number;

beforeAll(async () => {
  installBrowserGlobals();
  httpServer = createServer();
  io = new SocketIOServer(httpServer, { cors: { origin: "*" } });
  registerSocketHandlers(io, { paywallSecret: TEST_PAYWALL_SECRET });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
});

afterAll(async () => {
  io.close();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, { transports: ["websocket"] });
}

function awaitConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (client.connected) { resolve(); return; }
    client.once("connect", () => resolve());
  });
}

function emitWithAck<T = Record<string, unknown>>(
  client: ClientSocket,
  event: string,
  data: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve) => client.emit(event, data, (r: T) => resolve(r)));
}

function waitForEvent(client: ClientSocket, event: string, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    client.once(event, (data: unknown) => { clearTimeout(t); resolve(data); });
  });
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

interface ManagerObs {
  manager: WebRTCManager;
  failures: SecureChannelFailures[];
  states: PeerConnectionStates[];
  builtPCs: Array<{ peerId: string; pc: FakePeerConnection }>;
}

function makeManager(opts: {
  socket: ClientSocket;
  myPeerId: string;
  roomCode: string;
  e2eKey: CryptoKey;
  trackIdSuffix: string;
}): ManagerObs {
  const failures: SecureChannelFailures[] = [];
  const states: PeerConnectionStates[] = [];
  const builtPCs: Array<{ peerId: string; pc: FakePeerConnection }> = [];

  const manager = new WebRTCManager({
    localStream: localStreamWith(opts.trackIdSuffix),
    socket: opts.socket as unknown as import("socket.io-client").Socket,
    myPeerId: opts.myPeerId,
    roomCode: opts.roomCode,
    e2eKey: opts.e2eKey,
    onUpdate: () => {},
    onConnectionStateUpdate: (s) => states.push({ ...s }),
    onSecureChannelFailure: (f) => failures.push({ ...f }),
    onPeerConnectionCreated: (peerId, pc) => {
      builtPCs.push({ peerId, pc: pc as unknown as FakePeerConnection });
    },
  });

  return { manager, failures, states, builtPCs };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("WebRTCManager E2E — cooperative relay-only renegotiation", () => {
  it(
    "rebuilds all peer connections with iceTransportPolicy 'relay' after cooperative relay-only is accepted, and leaves no stale 'all' connections active",
    async () => {
      // Peer ID ordering: "peer-aaaaah" < "peer-nnnnnh" (a < n).
      // When iceTransportPolicy switches, the peer with the LOWER peer ID
      // initiates (deterministic to avoid glare). Host has the lower ID, so
      // host calls reinitializeAllPeers([NON_HOST]) and non-host calls
      // reinitializeAllPeers([]).
      const HOST_PEER = "peer-aaaaah";
      const NON_HOST_PEER = "peer-nnnnnh";

      // ── 1. Spin up server + join room ──────────────────────────────────

      const roomCode = validRoomId();
      const phraseRaw = nodeCrypto.randomBytes(32);
      const e2eKey = await crypto.subtle.importKey(
        "raw",
        phraseRaw,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );

      // Host creates + joins the room.
      const hostSocket = connectClient();
      await awaitConnect(hostSocket);
      const created = await emitWithAck<{ success?: boolean; error?: string }>(
        hostSocket, "create-room", { roomId: roomCode, token: dayTierToken() },
      );
      if (created.error) throw new Error(`create-room failed: ${created.error}`);

      const hostJoin = await emitWithAck<{ success?: boolean; error?: string }>(
        hostSocket, "join-room", { code: roomCode, peerId: HOST_PEER },
      );
      if (!hostJoin.success) throw new Error(`host join-room failed: ${hostJoin.error}`);

      // Non-host joins the same room.
      const nonHostSocket = connectClient();
      await awaitConnect(nonHostSocket);
      const nonHostJoin = await emitWithAck<{ success?: boolean; error?: string }>(
        nonHostSocket, "join-room", { code: roomCode, peerId: NON_HOST_PEER },
      );
      if (!nonHostJoin.success) throw new Error(`non-host join-room failed: ${nonHostJoin.error}`);

      // ── 2. Create WebRTCManagers for both peers ────────────────────────

      const hostObs = makeManager({
        socket: hostSocket,
        myPeerId: HOST_PEER,
        roomCode,
        e2eKey,
        trackIdSuffix: "host",
      });

      const nonHostObs = makeManager({
        socket: nonHostSocket,
        myPeerId: NON_HOST_PEER,
        roomCode,
        e2eKey,
        trackIdSuffix: "non-host",
      });

      // ── 3. Establish initial connection (policy "all") ─────────────────
      //
      // Host initiates. Both sides perform the ECDHE handshake and build
      // RTCPeerConnections with the default iceTransportPolicy ("all").
      // The non-host's WebRTCManager handles the incoming key-exchange and
      // offer signals automatically via its relay-signal listener.

      void hostObs.manager.initiateOffer(NON_HOST_PEER);

      // Allow enough time for full ECDHE handshake + offer/answer exchange.
      await pause(400);

      // Confirm that initial PCs were built with policy "all".
      const allPolicyPCsHost = hostObs.builtPCs.filter(
        (e) => e.peerId === NON_HOST_PEER && e.pc.iceTransportPolicy === "all",
      );
      const allPolicyPCsNonHost = nonHostObs.builtPCs.filter(
        (e) => e.peerId === HOST_PEER && e.pc.iceTransportPolicy === "all",
      );
      expect(allPolicyPCsHost.length).toBeGreaterThanOrEqual(1);
      expect(allPolicyPCsNonHost.length).toBeGreaterThanOrEqual(1);

      // ── 4. Wire client-side room-relay-mode-enabled handlers ──────────
      //
      // In production this wiring lives in the React component that owns
      // the WebRTCManager. We replicate the exact call sequence here so the
      // test exercises the real production path without mocking the manager.
      //
      // Ordering rule: the peer whose ID sorts LOWER initiates on reinit
      // (same tie-breaker as offer/answer glare avoidance). HOST_PEER <
      // NON_HOST_PEER, so host reinitialises with [NON_HOST_PEER]; non-host
      // reinitialises with [] and waits for host's incoming offer.

      const hostRelayModeReceived = new Promise<void>((resolve) => {
        hostSocket.once("room-relay-mode-enabled", () => {
          hostObs.manager.setIceTransportPolicy("relay");
          hostObs.manager.reinitializeAllPeers([NON_HOST_PEER]);
          resolve();
        });
      });

      const nonHostRelayModeReceived = new Promise<void>((resolve) => {
        nonHostSocket.once("room-relay-mode-enabled", () => {
          nonHostObs.manager.setIceTransportPolicy("relay");
          nonHostObs.manager.reinitializeAllPeers([]);
          resolve();
        });
      });

      // ── 5. Non-host sends request-relay-only ──────────────────────────

      const hostNotified = waitForEvent(hostSocket, "relay-only-requested");
      const reqAck = await emitWithAck<{ success?: boolean; error?: string }>(
        nonHostSocket, "request-relay-only", { code: roomCode },
      );
      expect(reqAck).toHaveProperty("success", true);

      // Wait for the relay-only-requested notification to reach the host.
      const requested = (await hostNotified) as { peerId: string };
      expect(requested.peerId).toBe(NON_HOST_PEER);

      // ── 6. Host accepts ───────────────────────────────────────────────

      const respAck = await emitWithAck<{ success?: boolean; error?: string }>(
        hostSocket, "respond-relay-only-request",
        { code: roomCode, peerId: NON_HOST_PEER, accept: true },
      );
      expect(respAck).toHaveProperty("success", true);

      // ── 7. Both sides receive the broadcast and reinitialise ──────────

      await Promise.all([hostRelayModeReceived, nonHostRelayModeReceived]);

      // Allow enough time for the new ECDHE handshake + offer/answer that
      // reinitializeAllPeers kicks off on the host side.
      await pause(500);

      // ── 8. Assert: new PCs use iceTransportPolicy "relay" ─────────────

      const relayPCsHost = hostObs.builtPCs.filter(
        (e) => e.peerId === NON_HOST_PEER && e.pc.iceTransportPolicy === "relay",
      );
      const relayPCsNonHost = nonHostObs.builtPCs.filter(
        (e) => e.peerId === HOST_PEER && e.pc.iceTransportPolicy === "relay",
      );

      // Host must have built at least one new "relay" PC for non-host.
      expect(relayPCsHost.length).toBeGreaterThanOrEqual(1);
      // Non-host must have built at least one new "relay" PC for host
      // (received the re-initiated offer from host and replied).
      expect(relayPCsNonHost.length).toBeGreaterThanOrEqual(1);

      // ── 9. Assert: no stale "all" PCs remain active ───────────────────
      //
      // reinitializeAllPeers calls removePeer → pc.close() on every
      // pre-existing PC. FakePeerConnection.close() sets
      // connectionState to "closed". A regression that skipped the
      // tear-down step would leave these as "new"/"connecting".

      for (const { pc } of allPolicyPCsHost) {
        expect(pc.connectionState).toBe("closed");
      }
      for (const { pc } of allPolicyPCsNonHost) {
        expect(pc.connectionState).toBe("closed");
      }

      // ── Cleanup ───────────────────────────────────────────────────────

      hostObs.manager.destroy();
      nonHostObs.manager.destroy();
      hostSocket.disconnect();
      nonHostSocket.disconnect();
    },
    12_000,
  );
});
