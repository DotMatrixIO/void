// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end regression test for the April 2026 audit M-01 finding:
// "an attacker who reuses a stolen ECDH public key without the matching
// Ed25519 signature cannot establish a media channel."
//
// Unit tests in `artifacts/void-client/src/lib/webrtc.test.ts` already
// exercise the loud-fail paths in isolation against a fake socket. This
// file goes further: it wires TWO real `WebRTCManager` instances (a
// victim and an honest peer) to the real `artifacts/api-server` socket
// relay (built via `registerSocketHandlers`) and drives three forged-
// peer attack variants through that real relay using a third raw socket
// for the attacker. The point is to catch a future code change that
// re-introduces the silent fallback (M-01) at the integration boundary,
// not just at the unit boundary.
//
// Three attack variants are covered. They are the threat-model variants
// the Task #183 review asked for and they catch DIFFERENT regressions:
//
//   A) The M-01 silent-fallback attack. Attacker sends a forged
//      key-exchange envelope (signed by the attacker's Ed25519 key,
//      wrapping a STOLEN ECDH public key the attacker doesn't own).
//      Verifier accepts the signature, victim derives a per-pair
//      session key. Attacker — having only the room-wide phrase key —
//      then sends a follow-up "offer" payload encrypted with that
//      PHRASE key. The victim must NOT silently fall back to phrase-
//      key decrypt for post-handshake traffic; it must loud-fail with
//      `decrypt_failed`. This is the exact regression M-01 protects
//      against; if `handleRelay` ever re-introduces a phrase-key
//      fallback for `peerSessionKeys.has(fromPeerId)`, this test
//      goes red.
//
//   B) REPLAY of a valid envelope captured from an earlier session in a
//      DIFFERENT room. The signature and ECDH binding still verify in
//      isolation, but the room-id binding rejects it (`hello_invalid`).
//      Catches the cross-room replay path that the `expectedRoomId`
//      check exists for; if a future change makes `expectedRoomId`
//      optional the test goes red.
//
//   C) Hostile signaling DROPS the legitimate handshake. Victim
//      initiates a key exchange to a peer that never responds; the
//      KEY_EXCHANGE_TIMEOUT must trigger the loud-fail teardown
//      (`ecdhe_failed`) — NOT a silent fallback to phrase-key media.
//
// EVERY variant asserts ALL THREE outcomes the task requires, together:
//   1. `onSecureChannelFailure` fires for the attacker peer (this is
//      the signal the production UI uses to render the red "secure
//      channel could not be established" overlay).
//   2. Zero `addTrack` calls were ever made on ANY RTCPeerConnection
//      for the attacker peer (the strict assertion the user asked for
//      over the original "no peer connection reaches `connected`"
//      wording — a connection that briefly added local tracks before
//      failing would be a real leak).
//   3. The attacker peer never reaches `connected` connection state.
//
// Each variant additionally asserts that the legitimate honest peer's
// secure channel is NOT collaterally damaged — its onSecureChannelFailure
// must NOT fire — proving the defense is targeted, not a blanket DoS.
//
// NOTE on placement: this file lives under api-server because the
// integration target is api-server's `socketHandlers`. It imports
// `WebRTCManager` and crypto helpers from void-client by relative
// path; vitest+vite resolves the .ts source directly. The api-server
// tsconfig excludes this single file from `tsc` because importing
// void-client modules would pull DOM-only types (RTCPeerConnection,
// MediaStream) into api-server's Node-only typecheck. The file is
// still typechecked at runtime by vitest's TS pipeline.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";
import nodeCrypto from "node:crypto";

import { registerSocketHandlers } from "../socketHandlers";

import {
  WebRTCManager,
  type SecureChannelFailures,
  type PeerConnectionStates,
} from "../../../void-client/src/lib/webrtc";
import {
  generateSigningIdentity,
  signHello,
  buildBrowserHelloBody,
  type SignedHello,
} from "../../../void-client/src/lib/helloEnvelope";
import {
  encryptSignal,
  generateECDHKeyPair,
  exportECDHPublicKey,
} from "../../../void-client/src/lib/signalCrypto";

// ─── Fake browser globals ────────────────────────────────────────────────
//
// vitest runs api-server tests in Node, where `RTCPeerConnection` and
// `MediaStream` are not defined. The fakes below are minimal stand-ins;
// each FakePeerConnection records every `addTrack` call on itself so the
// "no tracks were ever added for the attacker peer" assertion can read
// directly from the PC the manager constructed (we map PC→peerId via
// the `onPeerConnectionCreated` lifecycle hook on WebRTCManager).

class FakePeerConnection {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  addTrackCalls: Array<{ kind: string }> = [];

  constructor(_opts: unknown) {}

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

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "audio");
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === "video");
  }

  addTrack(t: MediaStreamTrack): void {
    this.tracks.push(t);
  }

  removeTrack(t: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((x) => x !== t);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
}

function fakeAudioTrack(idSuffix: string): MediaStreamTrack {
  return { kind: "audio", id: `audio-${idSuffix}`, stop: () => {} } as unknown as MediaStreamTrack;
}

function localStreamWith(idSuffix: string): MediaStream {
  return new FakeMediaStream([fakeAudioTrack(idSuffix)]) as unknown as MediaStream;
}

function installBrowserGlobals(): void {
  // Polyfill browser globals jsdom does not provide. Narrow `@ts-expect-error`
  // (one per global) is the smallest typed surface — there's no way to
  // assign to lib.dom's RTCPeerConnection global without it.
  // @ts-expect-error - polyfilling browser global for Node test environment
  globalThis.RTCPeerConnection = FakePeerConnection;
  // @ts-expect-error - polyfilling browser global for Node test environment
  globalThis.MediaStream = FakeMediaStream;
}

// ─── Test paywall + server bootstrap ─────────────────────────────────────

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

// ─── Test helpers ────────────────────────────────────────────────────────

function connectClient(): ClientSocket {
  return ioClient(`http://localhost:${port}`, { transports: ["websocket"] });
}

function awaitConnect(client: ClientSocket): Promise<void> {
  return new Promise((resolve) => {
    if (client.connected) {
      resolve();
      return;
    }
    client.once("connect", () => resolve());
  });
}

function emitWithAck<T = Record<string, unknown>>(
  client: ClientSocket,
  event: string,
  data: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve) => {
    client.emit(event, data, (result: T) => resolve(result));
  });
}

async function pause(ms: number): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, ms));
}

interface ManagerObservations {
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
}): ManagerObservations {
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
    // Typed test seam — no monkey-patching, no `any` casts.
    onPeerConnectionCreated: (peerId, pc) => {
      builtPCs.push({ peerId, pc: pc as unknown as FakePeerConnection });
    },
  });

  return { manager, failures, states, builtPCs };
}

interface RoomSetup {
  code: string;
  e2eKey: CryptoKey;
  hostSocket: ClientSocket;
  victim: ManagerObservations;
  honest: ManagerObservations;
  victimSocket: ClientSocket;
  honestSocket: ClientSocket;
  attackerSocket: ClientSocket;
  silentSocket?: ClientSocket;
}

async function setUpRoomAndPeers(opts: {
  victimPeerId: string;
  honestPeerId: string;
  attackerPeerId: string;
  silentPeerId?: string;
}): Promise<RoomSetup> {
  const code = validRoomId();

  // The phrase key is the room-wide AES-GCM key both honest peers and the
  // attacker share. Mirroring the threat model: the attacker has the room
  // phrase (otherwise they could not even encrypt a relay-signal payload
  // in the right format) — what they MUST NOT be able to do is upgrade
  // that membership into a per-pair media channel without also producing
  // valid Ed25519 signatures over their own ECDH key.
  const phraseRaw = nodeCrypto.randomBytes(32);
  const e2eKey = await crypto.subtle.importKey(
    "raw",
    phraseRaw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const hostSocket = connectClient();
  await awaitConnect(hostSocket);
  const created = await emitWithAck<{ success?: boolean; error?: string }>(
    hostSocket,
    "create-room",
    { roomId: code, token: dayTierToken() },
  );
  if (created.error) throw new Error(`create-room failed: ${created.error}`);

  const victimSocket = connectClient();
  await awaitConnect(victimSocket);
  const victimJoin = await emitWithAck<{ success?: boolean; error?: string }>(
    victimSocket,
    "join-room",
    { code, peerId: opts.victimPeerId },
  );
  if (!victimJoin.success) throw new Error(`victim join-room failed: ${victimJoin.error}`);

  const honestSocket = connectClient();
  await awaitConnect(honestSocket);
  const honestJoin = await emitWithAck<{ success?: boolean; error?: string }>(
    honestSocket,
    "join-room",
    { code, peerId: opts.honestPeerId },
  );
  if (!honestJoin.success) throw new Error(`honest join-room failed: ${honestJoin.error}`);

  const attackerSocket = connectClient();
  await awaitConnect(attackerSocket);
  const attackerJoin = await emitWithAck<{ success?: boolean; error?: string }>(
    attackerSocket,
    "join-room",
    { code, peerId: opts.attackerPeerId },
  );
  if (!attackerJoin.success) throw new Error(`attacker join-room failed: ${attackerJoin.error}`);

  let silentSocket: ClientSocket | undefined;
  if (opts.silentPeerId) {
    silentSocket = connectClient();
    await awaitConnect(silentSocket);
    const silentJoin = await emitWithAck<{ success?: boolean; error?: string }>(
      silentSocket,
      "join-room",
      { code, peerId: opts.silentPeerId },
    );
    if (!silentJoin.success) throw new Error(`silent join-room failed: ${silentJoin.error}`);
  }

  // Two real WebRTCManager instances driven by the real socket relay,
  // as the task acceptance criteria require.
  const victim = makeManager({
    socket: victimSocket,
    myPeerId: opts.victimPeerId,
    roomCode: code,
    e2eKey,
    trackIdSuffix: "victim",
  });
  const honest = makeManager({
    socket: honestSocket,
    myPeerId: opts.honestPeerId,
    roomCode: code,
    e2eKey,
    trackIdSuffix: "honest",
  });

  return {
    code,
    e2eKey,
    hostSocket,
    victim,
    honest,
    victimSocket,
    honestSocket,
    attackerSocket,
    silentSocket,
  };
}

function teardown(setup: RoomSetup): void {
  setup.victim.manager.destroy();
  setup.honest.manager.destroy();
  setup.victimSocket.disconnect();
  setup.honestSocket.disconnect();
  setup.attackerSocket.disconnect();
  setup.silentSocket?.disconnect();
  setup.hostSocket.disconnect();
}

function tracksAddedFor(observations: ManagerObservations, peerId: string): number {
  let total = 0;
  for (const entry of observations.builtPCs) {
    if (entry.peerId === peerId) {
      total += entry.pc.addTrackCalls.length;
    }
  }
  return total;
}

function reachedConnectedFor(observations: ManagerObservations, peerId: string): boolean {
  return observations.states.some((s) => s[peerId] === "connected");
}

function lastFailureFor(observations: ManagerObservations, peerId: string): string | undefined {
  for (let i = observations.failures.length - 1; i >= 0; i--) {
    const reason = observations.failures[i][peerId];
    if (reason) return reason;
  }
  return undefined;
}

function failureEverFiredFor(observations: ManagerObservations, peerId: string): boolean {
  return lastFailureFor(observations, peerId) !== undefined;
}

// ─── Variants ────────────────────────────────────────────────────────────

describe("WebRTCManager E2E — forged peer cannot join calls", () => {
  it("(A) loud-fails when an attacker forges a hello and then sends post-handshake traffic encrypted with the room phrase key", async () => {
    const VICTIM = "peer-vvvvva";
    const HONEST = "peer-hhhhha";
    const ATTACKER = "peer-aaaaaa";
    const setup = await setUpRoomAndPeers({
      victimPeerId: VICTIM,
      honestPeerId: HONEST,
      attackerPeerId: ATTACKER,
    });

    // Step 1. Forged key-exchange envelope. Attacker mints their own
    // signing identity and wraps a STOLEN ECDH public key (one whose
    // private half they don't hold) inside a body bound to the current
    // roomId. Verifier accepts the signature (signature/body internally
    // consistent), and the victim derives a per-pair session key with
    // the stolen ECDH pub.
    const stolenPair = await generateECDHKeyPair();
    const stolenEcdhPub = await exportECDHPublicKey(stolenPair.publicKey);
    const attackerIdentity = await generateSigningIdentity();
    const forgedBody = await buildBrowserHelloBody({
      ecdhPublicKey: stolenEcdhPub,
      roomId: setup.code,
    });
    const forgedHello = await signHello(attackerIdentity, forgedBody);

    // Task #461 / audit M-01: the receiver now binds `fromPeerId` into the
    // AES-GCM AAD on decrypt, so to model a same-room attacker (the threat
    // shape this test was written for — attacker holds the room phrase
    // key) we MUST encrypt under that same AAD. Omitting it would short-
    // circuit at `decrypt_failed`, which is also a correct loud-fail but
    // would let this test stop exercising the deeper hello-verification
    // path it was written to cover.
    const helloCt = await encryptSignal(
      setup.e2eKey,
      { type: "key-exchange", hello: forgedHello },
      ATTACKER,
    );
    setup.attackerSocket.emit("relay-signal", {
      code: setup.code,
      toPeerId: VICTIM,
      fromPeerId: ATTACKER,
      payload: helloCt,
    });

    // Let the responder side of the handshake settle on the victim.
    await pause(150);

    // Step 2. The M-01 attack proper: attacker — who cannot derive the
    // session key (no stolen ECDH private) — tries to send a post-
    // handshake "offer" payload encrypted with the room PHRASE key
    // (the only AES key they hold). If the victim ever silently fell
    // back to phrase-key decrypt for `peerSessionKeys.has(fromPeerId)`,
    // this offer would be accepted, `buildPC` would run for ATTACKER,
    // and local audio tracks would be attached. The defense in
    // `webrtc.ts` `handleRelay` MUST loud-fail with `decrypt_failed`.
    const offerCt = await encryptSignal(
      setup.e2eKey,
      { type: "offer", sdp: { type: "offer", sdp: "v=0\r\n" } },
      ATTACKER,
    );
    setup.attackerSocket.emit("relay-signal", {
      code: setup.code,
      toPeerId: VICTIM,
      fromPeerId: ATTACKER,
      payload: offerCt,
    });

    await pause(200);

    // (1) Secure-channel failure surfaced — drives the production red
    // overlay. Acceptable reasons are `decrypt_failed` (post-handshake
    // payload encrypted under the wrong key) or `ecdhe_failed` (pre-
    // handshake type guard tripped). Both are loud-fail paths and both
    // satisfy the M-01 defense.
    const failureReason = lastFailureFor(setup.victim, ATTACKER);
    expect(failureReason).toBeDefined();
    expect(["decrypt_failed", "ecdhe_failed"]).toContain(failureReason);

    // (2) No media tracks ever attached for the attacker peer.
    expect(tracksAddedFor(setup.victim, ATTACKER)).toBe(0);

    // (3) No connected state for the attacker peer.
    expect(reachedConnectedFor(setup.victim, ATTACKER)).toBe(false);

    // Honest peer is not collaterally damaged: no failure on its
    // channel, since the attack is targeted at the attacker's own
    // peerId routing key. The honest peer is just present in the
    // room.
    expect(failureEverFiredFor(setup.victim, HONEST)).toBe(false);
    expect(failureEverFiredFor(setup.honest, VICTIM)).toBe(false);

    teardown(setup);
  }, 10_000);

  it("(B) rejects a replay of a captured envelope from a different room", async () => {
    const VICTIM = "peer-vvvvvb";
    const HONEST = "peer-hhhhhb";
    const ATTACKER = "peer-aaaaab";
    const setup = await setUpRoomAndPeers({
      victimPeerId: VICTIM,
      honestPeerId: HONEST,
      attackerPeerId: ATTACKER,
    });

    // Captured envelope from a different roomId — what an attacker might
    // lift off the wire from a prior victim's session in some other room.
    const priorRoomId = nodeCrypto.randomBytes(16).toString("hex");
    const priorIdentity = await generateSigningIdentity();
    const priorEcdh = await generateECDHKeyPair();
    const priorEcdhPub = await exportECDHPublicKey(priorEcdh.publicKey);
    const priorBody = await buildBrowserHelloBody({
      ecdhPublicKey: priorEcdhPub,
      roomId: priorRoomId,
    });
    const replayedEnvelope: SignedHello = await signHello(priorIdentity, priorBody);

    // Task #461 / audit M-01: bind AAD to the attacker's `fromPeerId` so
    // the receiver's AAD-bound decrypt succeeds and the test reaches the
    // downstream `expectedRoomId`-mismatch loud-fail it was written for.
    const ct = await encryptSignal(
      setup.e2eKey,
      { type: "key-exchange", hello: replayedEnvelope },
      ATTACKER,
    );
    setup.attackerSocket.emit("relay-signal", {
      code: setup.code,
      toPeerId: VICTIM,
      fromPeerId: ATTACKER,
      payload: ct,
    });

    await pause(300);

    // (1) Loud-fail — `hello_invalid` from `expectedRoomId` mismatch.
    expect(lastFailureFor(setup.victim, ATTACKER)).toBe("hello_invalid");

    // (2) No tracks attached for the attacker peer.
    expect(tracksAddedFor(setup.victim, ATTACKER)).toBe(0);

    // (3) No connected state for the attacker peer.
    expect(reachedConnectedFor(setup.victim, ATTACKER)).toBe(false);

    // Honest peer not collaterally damaged.
    expect(failureEverFiredFor(setup.victim, HONEST)).toBe(false);
    expect(failureEverFiredFor(setup.honest, VICTIM)).toBe(false);

    teardown(setup);
  }, 10_000);

  it("(C) rejects an aborted handshake without silently falling back to phrase-key media", async () => {
    const VICTIM = "peer-vvvvvc";
    const HONEST = "peer-hhhhhc";
    const ATTACKER = "peer-aaaaac";
    // SILENT must sort AFTER VICTIM so the glare rule
    // (`shouldInitiateTo`: `myPeerId < remotePeerId`) lets the victim be
    // the entitled initiator — otherwise `initiateOffer(SILENT)` no-ops
    // and the `KEY_EXCHANGE_TIMEOUT_MS` loud-fail this test is written
    // to exercise never fires, surfacing as `undefined` for the failure
    // reason. The test was originally written with `peer-sssssc`, which
    // sorts BEFORE `peer-vvvvvc`, so the handshake never started.
    const SILENT = "peer-zzzzzc";
    const setup = await setUpRoomAndPeers({
      victimPeerId: VICTIM,
      honestPeerId: HONEST,
      attackerPeerId: ATTACKER,
      silentPeerId: SILENT,
    });

    // The "silent" socket is joined to the room (so the relay forwards
    // signals to it) but installs no `relay-signal` handler — the
    // hostile-signaling-drops-legitimate-envelope shape modeled at the
    // recipient. The victim's outbound key exchange will time out after
    // KEY_EXCHANGE_TIMEOUT_MS (5s) inside `performKeyExchange`.
    await setup.victim.manager.initiateOffer(SILENT);

    // KEY_EXCHANGE_TIMEOUT_MS is 5_000ms in webrtc.ts; wait past it then
    // give the loud-fail teardown a tick to surface.
    await pause(5_500);

    // (1) Loud-fail surfaced.
    expect(lastFailureFor(setup.victim, SILENT)).toBe("ecdhe_failed");

    // (2) No tracks attached for the silent peer (would-be media leak
    // path under M-01 silent fallback).
    expect(tracksAddedFor(setup.victim, SILENT)).toBe(0);

    // (3) No connected state.
    expect(reachedConnectedFor(setup.victim, SILENT)).toBe(false);

    // Nothing leaked to the attacker either.
    expect(tracksAddedFor(setup.victim, ATTACKER)).toBe(0);
    expect(reachedConnectedFor(setup.victim, ATTACKER)).toBe(false);

    // Honest peer not collaterally damaged.
    expect(failureEverFiredFor(setup.victim, HONEST)).toBe(false);
    expect(failureEverFiredFor(setup.honest, VICTIM)).toBe(false);

    teardown(setup);
  }, 15_000);

  it("(D) loud-fails when the attacker speaks first with an unsolicited forged offer envelope, before any honest handshake", async () => {
    // Reverse-direction coverage. Variants A/B/C have the attacker
    // initiate with a forged `key-exchange` envelope and exercise the
    // post-handshake `decrypt_failed` and `hello_invalid` paths in
    // `handleKeyExchange`. This variant covers the OTHER initiator
    // shape called out in the threat model: the attacker sends an
    // unsolicited forged "offer" envelope FIRST, before any honest
    // handshake has happened. There is no prior key-exchange — the
    // attacker tries to skip the handshake entirely and inject a
    // post-handshake-shaped payload directly into the victim's
    // `handleRelay`. The defense lives in `handleRelay`'s pre-
    // handshake branch: with no session key for the attacker peer,
    // the payload is decrypted with the room phrase key, and the
    // type guard `if (candidate.type !== "key-exchange") loud-fails
    // with `ecdhe_failed`. An "initiator-only optimization" that
    // dropped that type guard on the assumption that "only key-
    // exchanges arrive pre-handshake" would silently drop into
    // `buildPC`/`addTrack` here and this test would go red.
    const VICTIM = "peer-vvvvvd";
    const HONEST = "peer-hhhhhd";
    const ATTACKER = "peer-aaaaad";
    const setup = await setUpRoomAndPeers({
      victimPeerId: VICTIM,
      honestPeerId: HONEST,
      attackerPeerId: ATTACKER,
    });

    // Unsolicited forged offer envelope. No key-exchange precedes it.
    // The attacker has the room phrase (threat-model assumption), so
    // it encrypts the offer under the phrase key — the wire format a
    // pre-handshake message takes when no per-pair session key exists
    // yet. `handleRelay` will decrypt it successfully but the type
    // guard MUST reject it because "offer" is not a permitted
    // pre-handshake message type.
    // Task #461 / audit M-01: bind AAD to the attacker's `fromPeerId` so
    // the receiver's AAD-bound decrypt succeeds and the test reaches the
    // pre-handshake type-guard `ecdhe_failed` path it was written for.
    const offerCt = await encryptSignal(
      setup.e2eKey,
      { type: "offer", sdp: { type: "offer", sdp: "v=0\r\n" } },
      ATTACKER,
    );
    setup.attackerSocket.emit("relay-signal", {
      code: setup.code,
      toPeerId: VICTIM,
      fromPeerId: ATTACKER,
      payload: offerCt,
    });

    await pause(200);

    // (1) Loud-fail surfaced. The pre-handshake type guard in
    // `handleRelay` produces `ecdhe_failed` for any payload type
    // other than `key-exchange` arriving before a session key exists.
    expect(lastFailureFor(setup.victim, ATTACKER)).toBe("ecdhe_failed");

    // (2) Strict no-tracks assertion: `buildPC` MUST NOT have been
    // reached for the attacker peer. The whole point of the type
    // guard is to stop an unsolicited "offer" from ever reaching the
    // `payload.type === "offer"` branch that builds the PC and
    // attaches the local audio track. A regression that removed the
    // guard would silently invoke `buildPC(ATTACKER)` and fail this
    // assertion.
    expect(tracksAddedFor(setup.victim, ATTACKER)).toBe(0);

    // (3) No connected state for the attacker peer.
    expect(reachedConnectedFor(setup.victim, ATTACKER)).toBe(false);

    // Honest peer not collaterally damaged: the targeted defense must
    // not flag the unrelated honest peer's channel.
    expect(failureEverFiredFor(setup.victim, HONEST)).toBe(false);
    expect(failureEverFiredFor(setup.honest, VICTIM)).toBe(false);

    teardown(setup);
  }, 10_000);
});
