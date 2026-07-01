// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests the loud-fail teardown path in WebRTCManager. Per the April 2026
// audit (M-01), a malformed/missing/forged signed-hello envelope must
// trigger the same red "secure channel could not be established"
// overlay as a failed decryption — never a silent downgrade to the
// room-wide phrase key.
//
// Wire envelope contract: the signed-hello body shape is the
// `void-wire/1` `HelloBodySchema` from `@workspace/wire-core` (plus
// the optional `sessionId`/`ecdhFingerprint` extension fields and an
// optional browser `roomId` binding). Acceptance/rejection of a
// well-formed SIGNED hello is covered in helloEnvelope.test.ts — the
// envelope-format contract test lives there because that's where
// the verifier lives.
//
// What is enforced HERE, on the relay-signal path:
//
//   - Every `key-exchange` payload MUST carry a `hello` field that
//     parses as a SignedHello. Missing or malformed → `hello_invalid`.
//
//   - The hello MUST bind `roomId` to the current room. The SDK does
//     not currently emit signed hellos over its relay-signal
//     key-exchange, so legacy SDK clients that send the publicKey-
//     only shape will be rejected here. Allowing the legacy shape
//     would re-open the very phrase-key downgrade window task #170
//     closed; the agent SDK envelope-format compatibility lives at
//     the SignedHello body shape (verified in helloEnvelope.test.ts),
//     not at the unsigned key-exchange layer.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebRTCManager, type SecureChannelFailures } from "./webrtc";
import { encryptSignal } from "./signalCrypto";
import {
  generateSigningIdentity,
  signHello,
  buildBrowserHelloBody,
} from "./helloEnvelope";
import {
  generateECDHKeyPair,
  exportECDHPublicKey,
} from "./signalCrypto";
import type { Socket } from "socket.io-client";

const ROOM_ID = "0123456789abcdef";
const ME = "peer-me0001";
const REMOTE = "peer-remote02";

type SocketHandler = (...args: unknown[]) => void;

interface FakeSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  __emit(event: string, ...args: unknown[]): void;
  __sent: Array<{ event: string; args: unknown[] }>;
}

function createFakeSocket(): FakeSocket {
  const handlers: Record<string, SocketHandler[]> = {};
  const sent: Array<{ event: string; args: unknown[] }> = [];
  return {
    on: vi.fn((ev: string, h: SocketHandler) => {
      (handlers[ev] ??= []).push(h);
    }),
    off: vi.fn((ev: string, h?: SocketHandler) => {
      if (!handlers[ev]) return;
      if (!h) {
        delete handlers[ev];
        return;
      }
      handlers[ev] = handlers[ev].filter((x) => x !== h);
    }),
    emit: vi.fn((ev: string, ...args: unknown[]) => {
      sent.push({ event: ev, args });
    }),
    __emit(ev: string, ...args: unknown[]) {
      (handlers[ev] ?? []).forEach((h) => h(...args));
    },
    __sent: sent,
  };
}

// Condition-based wait for the async crypto chain that runs off the
// relay-signal handler. The chain ends in a callback (publishSAS,
// onSecureChannelFailure, etc.); a fixed flush count is unreliable
// because every step in that chain — decryptSignal, verifySignedHello,
// generateECDHKeyPair, exportECDHPublicKey, importECDHPublicKey,
// deriveSessionKey — is a real `crypto.subtle` call that resolves on
// a worker-thread tick under Node's webcrypto. Polling on the
// observable side-effect (test arrays the manager has written to) is
// the deterministic way to know the chain is done. Throws on timeout
// rather than silently passing so a real product regression still
// surfaces as a failure, just with a clearer message than the
// downstream `expect(...).toBeDefined()`.
async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 5, label = "condition" }: {
    timeout?: number;
    interval?: number;
    label?: string;
  } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise<void>((r) => setTimeout(r, interval));
  }
  if (!predicate()) {
    throw new Error(`waitFor timed out after ${timeout}ms waiting for: ${label}`);
  }
}

function fakeStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
    addTrack: () => {},
    removeTrack: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaStream;
}

async function deriveRoomKey(): Promise<CryptoKey> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// Minimal SDP that passes the H-03 inbound validator: contains the
// RFC-required session-level fields, a DTLS fingerprint, an audio
// m-section, and an `a=rtpmap` proving the listed PT resolves to an
// allowlisted codec (Opus). Used by the receive-path stub below.
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

beforeEach(() => {
  // Stub out RTCPeerConnection so buildPC does not blow up under jsdom.
  // The malformed-envelope tests fail BEFORE buildPC is reached, so this
  // stub only matters for the successful-negotiation path.
  class FakePC {
    onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
    ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    connectionState: RTCPeerConnectionState = "new";
    addTrack() {}
    getSenders() { return []; }
    async createOffer() { return { type: "offer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit; }
    async createAnswer() { return { type: "answer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit; }
    async setLocalDescription() { /* noop */ }
    async setRemoteDescription() { /* noop */ }
    async addIceCandidate() { /* noop */ }
    close() {}
    get localDescription() { return { type: "offer", sdp: STUB_VALID_SDP } as RTCSessionDescription; }
  }
  // @ts-expect-error - jsdom polyfill
  globalThis.RTCPeerConnection = FakePC;

  // webrtcPerPeer.buildPC constructs `new MediaStream()` for the
  // remote-track aggregator. jsdom does not ship MediaStream, so any
  // test that exercises the post-handshake buildPC path (e.g. the
  // initiator-side retry round-trip in Task #532) needs this stub.
  if (typeof (globalThis as { MediaStream?: unknown }).MediaStream === "undefined") {
    class FakeMediaStream {
      private tracks: MediaStreamTrack[] = [];
      getTracks() { return this.tracks.slice(); }
      getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
      getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
      addTrack(t: MediaStreamTrack) { this.tracks.push(t); }
      removeTrack(t: MediaStreamTrack) {
        this.tracks = this.tracks.filter((x) => x !== t);
      }
      addEventListener() {}
      removeEventListener() {}
    }
    // @ts-expect-error - jsdom polyfill
    globalThis.MediaStream = FakeMediaStream;
  }
});

describe("WebRTCManager — loud fail on bad envelope", () => {
  it("marks the peer as a secure-channel failure when the key-exchange envelope is malformed", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // hello field present but not a SignedHello shape.
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE (malformed hello)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    const last = failures[failures.length - 1];
    expect(last[REMOTE]).toBe("hello_invalid");
  });

  it("marks the peer as a secure-channel failure when the key-exchange envelope is missing the hello field entirely", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // No hello — bare key-exchange envelope. Missing-envelope MUST
    // loud-fail; per task #170, a publicKey-only payload (the SDK's
    // legacy shape) is NOT accepted on this code path.
    const empty = await encryptSignal(e2eKey, { type: "key-exchange" }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: empty });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE (missing hello field)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[failures.length - 1][REMOTE]).toBe("hello_invalid");
  });

  it("marks the peer as a secure-channel failure when only a legacy publicKey field is sent (no hello)", async () => {
    // Post-deprecation policy (task #312): a human room hard-fails
    // unsigned `{ publicKey }` key-exchange payloads. The temporary
    // human-room acceptance window from task #284 has been removed.
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);

    const ct = await encryptSignal(e2eKey, {
      type: "key-exchange",
      publicKey: ecdhPub, // legacy unsigned shape, no hello
    } as unknown as Record<string, unknown>, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE (legacy publicKey-only shape)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[failures.length - 1][REMOTE]).toBe("hello_invalid");
  });

  it("marks the peer as a secure-channel failure when the signature is forged", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    const realIdentity = await generateSigningIdentity();
    const attackerIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);

    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const properlySigned = await signHello(realIdentity, body);
    const forged = {
      hello: properlySigned.hello,
      signature: (await signHello(attackerIdentity, body)).signature,
      signingKey: properlySigned.signingKey,
    };

    const ct = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: forged,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE (forged signature)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[failures.length - 1][REMOTE]).toBe("hello_invalid");
  });

  it("marks the peer as a secure-channel failure when the hello binds a different roomId (cross-room replay)", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);

    // Hello signed for a DIFFERENT room — replayed into our room.
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: "deadbeefdeadbeef",
    });
    const valid = await signHello(remoteIdentity, body);

    const ct = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: valid,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE (cross-room roomId mismatch)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[failures.length - 1][REMOTE]).toBe("hello_invalid");
  });
});

describe("WebRTCManager — loud fail on phrase-key decrypt failure (Task #199)", () => {
  it("marks the peer as a secure-channel failure when a relay-signal payload cannot be decrypted with the phrase key", async () => {
    // Pre-handshake decrypt failure with the phrase key used to be a
    // silent strike against the cryptoMismatch counter — only after 3
    // strikes did the user see anything. Per task #199 this is now an
    // immediate loud-fail (`decrypt_failed` overlay), mirroring the
    // post-handshake decrypt path. See webrtc.ts handleRelay.
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    // The "remote" peer derived a different room key (wrong phrase) so
    // their payload cannot be decrypted by us. We synthesize that by
    // encrypting under a key that is NOT our e2eKey and feeding it in.
    const wrongKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    const undecryptable = await encryptSignal(wrongKey, {
      type: "key-exchange",
      hello: { not: "actually-readable-by-us" },
    });
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: undecryptable });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "decrypt_failed failure recorded for REMOTE (wrong phrase key)" },
    );

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[failures.length - 1][REMOTE]).toBe("decrypt_failed");
  });
});

describe("WebRTCManager — retrySecureChannel (Task #182)", () => {
  it("clears the secure-channel failure entry and re-initiates the ECDHE handshake when retried", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    // ME ("peer-me0001") sorts BEFORE REMOTE ("peer-remote02"), so
    // ME is the entitled initiator under the glare-avoidance rule
    // (smaller peerId initiates — see the "initiateOffer glare
    // avoidance" suite below). The Task #182 contract this test
    // pins — "retry emits a fresh key-exchange" — only holds for the
    // initiator side; on the larger-peerId responder side, retry
    // emits only the `peer-secure-channel-retry` socket event and
    // waits for the remote (smaller) peer to drive the new
    // handshake.
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // Trip the failure with a malformed envelope so the overlay would
    // be visible.
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "hello_invalid failure recorded for REMOTE before retry" },
    );

    expect(failures[failures.length - 1][REMOTE]).toBe("hello_invalid");
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    // Snapshot pre-retry sent traffic so we can assert the retry sends
    // a fresh key-exchange.
    const sentBefore = socket.__sent.length;

    manager.retrySecureChannel(REMOTE);

    // Wait for the fresh key-exchange relay-signal emitted by initiateOffer.
    // This is the terminal observable side-effect of a complete retry: the
    // failure is already cleared synchronously by removePeer, but the
    // key-exchange itself is sent inside the async initiateOffer chain.
    await waitFor(
      () => socket.__sent.slice(sentBefore).some((s) => s.event === "relay-signal"),
      { label: "fresh relay-signal emitted after retrySecureChannel" },
    );

    // The overlay must have been dismissed: the failure entry is gone
    // and the most recent published failures snapshot does not include
    // REMOTE (a clearing republish was emitted).
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    const cleared = failures.find((f) => !(REMOTE in f));
    expect(cleared).toBeDefined();

    // A fresh key-exchange was emitted via relay-signal so the peer
    // can respond with a new signed hello.
    const newSends = socket.__sent.slice(sentBefore);
    const keyExchangeSends = newSends.filter((s) => s.event === "relay-signal");
    expect(keyExchangeSends.length).toBeGreaterThan(0);
  });
});

describe("WebRTCManager — post-retry grace window (Task #229 follow-up)", () => {
  // Regression: after the glare-avoidance fix landed, the ECDHE handshake
  // itself succeeded on retry (matching SAS visibly published on both
  // sides) but ciphertext from the remote that was already in flight
  // BEFORE the user clicked retry (encrypted under the previous, now-
  // deleted session key) arrived at handleRelay during the brief window
  // between removePeer and the new key-exchange completing. With no
  // session key installed, that ciphertext fell into the phrase-key
  // fallback path, failed to decrypt (it wasn't phrase-key encrypted),
  // and tripped `failSecureChannel("decrypt_failed")` — re-raising the
  // overlay the user had just dismissed. The grace window silently
  // drops those in-flight stragglers instead.

  it("retrySecureChannel does not re-fail the channel when stale ciphertext arrives during the grace window", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // Trip the initial failure so we have a "user clicks retry" starting
    // point identical to the field-reported sequence.
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });

    await waitFor(
      () => failures.some((f) => REMOTE in f),
      { label: "initial hello_invalid failure recorded" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    // User clicks retry: this opens the grace window AND removes the
    // peer (which clears the failure entry). After this point any
    // straggler ciphertext from REMOTE should be silently dropped.
    manager.retrySecureChannel(REMOTE);
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);

    const failuresAfterRetry = failures.length;

    // Stale ciphertext: a payload encrypted with a session key the
    // receiver no longer has. We simulate it by encrypting under a
    // FRESH AES-GCM key that the manager has never seen — phrase-key
    // decrypt will fail, exactly mirroring the production scenario
    // where the in-flight bytes were encrypted with the previous,
    // now-deleted session key.
    const staleKey = await deriveRoomKey();
    const stale = await encryptSignal(staleKey, {
      type: "ice",
      candidate: { candidate: "stale", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: stale });

    // Give the async decrypt chain time to run. The grace window must
    // suppress the loud-fail teardown that would otherwise fire.
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    // No NEW failure publish should have been emitted for REMOTE.
    const newFailures = failures.slice(failuresAfterRetry).filter(
      (f) => REMOTE in f,
    );
    expect(newFailures).toEqual([]);
  });

  it("loud-fails decrypt failures normally once the grace window expires (via fresh session install)", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // Open the grace window directly (as the remote-triggered retry
    // handler does).
    manager.markPostRetryGrace(REMOTE);

    // Drive a real key-exchange from the remote so a fresh session key
    // is installed. After install, the grace window must close and
    // subsequent decrypt failures must loud-fail.
    const remoteIdentity = await generateSigningIdentity();
    const remoteKeyPair = await generateECDHKeyPair();
    const remotePubKeyStr = await exportECDHPublicKey(remoteKeyPair.publicKey);
    const helloBody = await buildBrowserHelloBody({
      ecdhPublicKey: remotePubKeyStr,
      roomId: ROOM_ID,
    });
    const remoteSignedHello = await signHello(remoteIdentity, helloBody);
    const keyExchange = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: remoteSignedHello,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: keyExchange });

    await waitFor(
      () => socket.__sent.some(
        (s) => s.event === "relay-signal"
          && (s.args[0] as { toPeerId?: string })?.toPeerId === REMOTE,
      ),
      { label: "responder hello emitted (session key installed)" },
    );

    // Grace must be closed now. A stale ciphertext arriving here is
    // either an actual attack or a real bug and must loud-fail.
    const failuresBefore = failures.length;
    const staleKey = await deriveRoomKey();
    const stale = await encryptSignal(staleKey, {
      type: "ice",
      candidate: { candidate: "stale", sdpMid: "0", sdpMLineIndex: 0 } as RTCIceCandidateInit,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: stale });

    await waitFor(
      () => failures.slice(failuresBefore).some((f) => REMOTE in f),
      { label: "decrypt_failed fires after grace window closes via session install" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);
  });
});

describe("WebRTCManager — initiateOffer glare avoidance (handshake-flap fix)", () => {
  // Regression: when two peers opened the room nearly simultaneously
  // (both saw the other in their `join-room` result.peers list) both
  // called `initiateOffer` on each other. Two parallel ECDHE rounds
  // ran, each side kept a different keypair's output, derived session
  // keys diverged, SAS ("duet words") didn't match, and every
  // subsequent `relay()` call failed with `decrypt_failed`. The
  // user-visible symptom was the "SECURE HANDSHAKE DIDN'T COMPLETE
  // / KEY EXCHANGE FAILED" overlay flapping between the two peers.
  //
  // Fix: only the lexicographically SMALLER peerId initiates
  // (matching the existing `p > peerIdRef.current` rule in the
  // relay-flip and `reinitializeAllPeers` paths). The larger side
  // waits and runs the responder path in `handleKeyExchange`.
  // Callers (`peer-joined`, `peer-secure-channel-retry`,
  // `result.peers` loops) can fire `initiateOffer` unconditionally
  // — the manager filters via `shouldInitiateTo`.

  it("shouldInitiateTo returns true only when local peerId sorts before remote", () => {
    const socket = createFakeSocket();
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: "peer-mmmmmmmm",
      roomCode: ROOM_ID,
      roomType: "human",
      onUpdate: () => {},
    });
    // Smaller peerId initiates. The local "peer-mmmmmmmm" is larger
    // than "peer-aaaaaaaa" → responder; smaller than "peer-zzzzzzzz"
    // → initiator. Matches the existing `p > peerIdRef.current`
    // rule in the relay-flip / `reinitializeAllPeers` paths.
    expect(manager.shouldInitiateTo("peer-aaaaaaaa")).toBe(false);
    expect(manager.shouldInitiateTo("peer-zzzzzzzz")).toBe(true);
    // Equal is impossible in practice (peerIds are unique) but the
    // rule must still be strict-less-than so a degenerate equal
    // pair never produces two initiators.
    expect(manager.shouldInitiateTo("peer-mmmmmmmm")).toBe(false);
  });

  it("initiateOffer is a no-op when the local peer is the larger-peerId responder", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    // Pick a myPeerId that sorts AFTER REMOTE ("peer-remote02") so
    // the local peer is the responder under the smaller-initiates
    // rule. "peer-zzzzzz01" > "peer-remote02" lexicographically.
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: "peer-zzzzzz01",
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
    });
    expect(manager.shouldInitiateTo(REMOTE)).toBe(false);

    const sentBefore = socket.__sent.length;
    await manager.initiateOffer(REMOTE);

    // No relay-signal emitted — the responder side stays quiet and
    // waits for the smaller peer's inbound key-exchange.
    const sentAfter = socket.__sent.slice(sentBefore);
    const keyExchangeSends = sentAfter.filter((s) => s.event === "relay-signal");
    expect(keyExchangeSends.length).toBe(0);
  });

  it("initiateOffer is a no-op when a key exchange is already pending for the same peer", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    // Use ME ("peer-me0001"), which sorts BEFORE REMOTE
    // ("peer-remote02"), so the initiator path is entitled to fire
    // (otherwise the no-op is from `shouldInitiateTo`, not the
    // in-flight dedupe we're testing).
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
    });

    // Kick off the first handshake. We do NOT await — performKeyExchange
    // blocks on the inbound remote hello, so the pending entry stays
    // set until either the response arrives or the 30s timeout fires.
    // The first key-exchange relay-signal lands synchronously enough
    // that we can wait for it on the observable side-effect.
    const sentBefore = socket.__sent.length;
    const firstCall = manager.initiateOffer(REMOTE);

    await waitFor(
      () => socket.__sent.slice(sentBefore).some((s) => s.event === "relay-signal"),
      { label: "first initiateOffer emitted its key-exchange relay-signal" },
    );

    const sentAfterFirst = socket.__sent.length;

    // A second call (e.g. from the retry-event handler arriving at
    // the same peer who just clicked retry locally) MUST NOT generate
    // a second key-exchange — that would overwrite the pending
    // resolver, leave the first awaiter to time out, and re-introduce
    // the multi-round race the glare check is meant to prevent.
    await manager.initiateOffer(REMOTE);

    const sentAfterSecond = socket.__sent.slice(sentAfterFirst);
    const secondKeyExchanges = sentAfterSecond.filter((s) => s.event === "relay-signal");
    expect(secondKeyExchanges.length).toBe(0);

    // Cleanup: let the still-pending firstCall reject cleanly when
    // the test harness tears down. Swallow the eventual
    // KEY_EXCHANGE_TIMEOUT — the assertion above is the contract;
    // the unresolved promise is a side-effect of not wiring a fake
    // responder for this dedupe-only test.
    void firstCall.catch(() => {});
  });
});

describe("WebRTCManager — rekey emits onRekey with a fresh fingerprint", () => {
  it("publishes a fresh SAS and emits onRekey with a new fingerprint on a live-session second handshake", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];
    const rekeyEvents: Array<{ peerId: string; fingerprint: string }> = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
      onRekey: (peerId, fingerprint) => rekeyEvents.push({ peerId, fingerprint }),
    });

    const remoteIdentity = await generateSigningIdentity();

    async function sendKeyExchange(): Promise<void> {
      const pair = await generateECDHKeyPair();
      const ecdhPub = await exportECDHPublicKey(pair.publicKey);
      const body = await buildBrowserHelloBody({
        ecdhPublicKey: ecdhPub,
        roomId: ROOM_ID,
      });
      const valid = await signHello(remoteIdentity, body);
      const ct = await encryptSignal(e2eKey, {
        type: "key-exchange",
        hello: valid,
      }, REMOTE);
      socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });
    }

    await sendKeyExchange();
    await waitFor(
      () => sasUpdates.some((s) => REMOTE in s),
      { label: "initial SAS published for REMOTE" },
    );
    const firstSas = sasUpdates[sasUpdates.length - 1][REMOTE];
    expect(firstSas).toBeDefined();

    // Live-session rekey: do NOT remove the peer first. The second
    // signed hello arrives phrase-key encrypted while the first
    // session key is still installed (the wire shape produced by
    // attemptIceRestart). Asserts the typed phrase-key fallback in
    // handleRelay accepts it.
    await sendKeyExchange();
    await waitFor(
      () => rekeyEvents.filter((e) => e.peerId === REMOTE).length >= 2,
      { label: "second onRekey fired for REMOTE after live-session rekey" },
    );

    const remoteRekeys = rekeyEvents.filter((e) => e.peerId === REMOTE);
    expect(remoteRekeys).toHaveLength(2);
    expect(remoteRekeys[0].fingerprint).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(remoteRekeys[1].fingerprint).toMatch(/^[A-Za-z0-9_-]+$/);
    // Deterministic: a fresh ECDH keypair on the wire produces a
    // distinct SHA-256 fingerprint by construction.
    expect(remoteRekeys[1].fingerprint).not.toBe(remoteRekeys[0].fingerprint);
    // SAS for REMOTE must have been republished too.
    const lastSas = sasUpdates[sasUpdates.length - 1][REMOTE];
    expect(lastSas).toBeDefined();
    void firstSas;
    expect(failures.every((f) => Object.keys(f).length === 0)).toBe(true);
  });
});

describe("WebRTCManager — same-sender replay defense (Task #483)", () => {
  // A hostile signaling server can capture a `(IV, ciphertext)` pair
  // from a real peer and re-emit it later under the original sender
  // id; AAD only blocks *cross-sender* re-addressing. Task #483 closes
  // the same-sender gap with per-peer IV and per-peer hello-nonce
  // caches; these tests pin the behavior so a future refactor cannot
  // silently regress the defense.

  it("rejects a replayed key-exchange envelope as decrypt_failed (per-peer IV cache)", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
    });

    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const valid = await signHello(remoteIdentity, body);
    const ct = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: valid,
    }, REMOTE);

    // First delivery completes the handshake legitimately.
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });
    await waitFor(
      () => sasUpdates.some((s) => REMOTE in s),
      { label: "initial SAS published" },
    );
    expect(failures.every((f) => Object.keys(f).length === 0)).toBe(true);

    // The hostile server re-emits the EXACT SAME wire bytes (same IV,
    // same ciphertext, same fromPeerId). Must be rejected at the IV
    // cache, not handed to the key-exchange handler.
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "decrypt_failed"),
      { label: "decrypt_failed on replayed envelope" },
    );
    expect(failures[failures.length - 1][REMOTE]).toBe("decrypt_failed");
  });

  it("rejects a replayed signed-hello body that re-encrypts under a fresh IV via the nonce cache", async () => {
    // The IV cache alone does not catch a hostile peer that re-encrypts
    // the SAME signed-hello body under a fresh IV — only the nonce
    // cache passed into verifySignedHello does. Pinning this here so
    // a future cleanup that drops the seenNonces wiring does not
    // silently re-open the rekey-replay window.
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const rekeyEvents: Array<{ peerId: string; fingerprint: string }> = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onRekey: (peerId, fingerprint) => rekeyEvents.push({ peerId, fingerprint }),
    });

    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const signed = await signHello(remoteIdentity, body);

    // Two ciphertexts of the SAME signed-hello body under DIFFERENT
    // IVs. The IV cache cannot detect this; only the per-peer
    // seen-hello-nonces set (passed to verifySignedHello) can.
    const ct1 = await encryptSignal(e2eKey, { type: "key-exchange", hello: signed }, REMOTE);
    const ct2 = await encryptSignal(e2eKey, { type: "key-exchange", hello: signed }, REMOTE);
    expect(ct1).not.toBe(ct2);

    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct1 });
    await waitFor(
      () => rekeyEvents.some((e) => e.peerId === REMOTE),
      { label: "first onRekey for REMOTE" },
    );

    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct2 });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "hello_invalid on replayed nonce" },
    );

    // No second onRekey — the replayed hello body was rejected before
    // the ECDHE rekey path ran.
    expect(rekeyEvents.filter((e) => e.peerId === REMOTE)).toHaveLength(1);
  });
});

describe("WebRTCManager — successful negotiation does not trigger fallback", () => {
  it("accepts a valid signed envelope bound to the current room and never emits a secure-channel failure", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];

    new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
    });

    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const valid = await signHello(remoteIdentity, body);

    const ct = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: valid,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: ct });

    // Wait on the OBSERVABLE side-effect of a successful handshake (a
    // SAS published for REMOTE) instead of guessing how many macrotask
    // ticks the crypto chain needs. Under Node's webcrypto each
    // `crypto.subtle.*` call resolves on a worker-thread tick, and a
    // fixed flush count flakes about ~25% of the time on this path
    // (verified at HEAD baseline during Task #184). Polling the
    // happy-path signal removes the race without weakening what's
    // asserted: we still verify (a) no secure-channel failure was ever
    // emitted, and (b) the SAS was published with REMOTE bound.
    await waitFor(
      () => sasUpdates.some((s) => REMOTE in s),
      { label: "SAS published for REMOTE after valid signed envelope" },
    );

    expect(failures.every((f) => Object.keys(f).length === 0)).toBe(true);
    const lastSas = sasUpdates[sasUpdates.length - 1] ?? {};
    expect(lastSas[REMOTE]).toBeDefined();
  });
});

describe("WebRTCManager — clear-on-success (Task #529)", () => {
  // Reported symptom: the iPad shows a fresh peer card + duet for the
  // Pixel, but the Pixel still shows the red "secure channel could not
  // be established" overlay toward the iPad. Root cause: the Pixel's
  // `secureChannelFailures` entry was never cleared when a later
  // re-handshake succeeded. The clear-on-success helper fixes this
  // at every Secured observation point with explicit ordering rules
  // (generation-based "failure always wins" + grace-window deferral).
  //
  // Tests reach the private `installSessionKey` /
  // `clearSecureChannelFailureOnSuccess` surface through bracket-notation
  // casts. The Secured transition itself is exercised by public API in
  // the other test suites in this file (`rekey emits onRekey…`,
  // `successful negotiation does not trigger fallback`, etc.); this
  // suite pins the *clear* contract — which is what task #529 is
  // about — without re-litigating the surrounding handshake plumbing
  // or fighting the `handleRelay` blacklist that intentionally blocks
  // post-failure inbound traffic until `removePeer` is called.

  // Test-only handle that exposes the private members the tests below
  // need to drive Secured/grace observations directly. Keeping the
  // unsafe cast confined to one alias avoids littering individual
  // assertions with `as unknown as ...` boilerplate.
  type ManagerInternals = {
    installSessionKey(peerId: string, key: CryptoKey): void;
    markPostRetryGrace(peerId: string): void;
    failSecureChannel(peerId: string, reason: string): void;
    secureChannelFailures: Map<string, string>;
    secureChannelFailureGen: Map<string, number>;
    peers: Map<string, unknown>;
  };
  const asInternals = (m: WebRTCManager): ManagerInternals =>
    m as unknown as ManagerInternals;

  async function makeFakeSessionKey(): Promise<CryptoKey> {
    return deriveRoomKey();
  }

  it("dismisses an existing failure entry when the secure channel transitions back to Secured (installSessionKey)", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // Seed a failure entry the way production does it.
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "initial hello_invalid failure recorded" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    // Drive a Secured transition directly via the same private entry
    // point that every real handshake completion funnels through. This
    // is the realistic recovery race: an in-flight key-exchange whose
    // `installSessionKey` call resolves AFTER another concurrent
    // message tripped `failSecureChannel`. The helper must dismiss the
    // overlay; the alternative (current pre-fix behavior) is a
    // permanent red banner the user has to manually retry past.
    const fakeKey = await makeFakeSessionKey();
    asInternals(manager).installSessionKey(REMOTE, fakeKey);

    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    const lastPublished = failures[failures.length - 1] ?? {};
    expect(lastPublished[REMOTE]).toBeUndefined();
  });

  it("re-fails loudly with the new reason if the channel breaks again after recovering", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    // Trip → recover via installSessionKey (the Secured observation).
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "initial hello_invalid" },
    );
    const fakeKey = await makeFakeSessionKey();
    asInternals(manager).installSessionKey(REMOTE, fakeKey);
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);

    // A genuine second failure after recovery must NOT be debounced or
    // suppressed by the clear path.
    asInternals(manager).failSecureChannel(REMOTE, "decrypt_failed");
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);
    const last = failures[failures.length - 1] ?? {};
    expect(last[REMOTE]).toBe("decrypt_failed");
  });

  it("defers the clear until the POST_RETRY_GRACE_MS window closes when grace is active at Secured time", async () => {
    vi.useFakeTimers();
    try {
      const socket = createFakeSocket();
      const e2eKey = await deriveRoomKey();
      const failures: SecureChannelFailures[] = [];

      const manager = new WebRTCManager({
        localStream: fakeStream(),
        socket: socket as unknown as Socket,
        myPeerId: ME,
        roomCode: ROOM_ID,
        roomType: "human",
        e2eKey,
        onUpdate: () => {},
        onSecureChannelFailure: (f) => failures.push({ ...f }),
      });

      // Seed a failure entry directly via the private surface — under
      // fake timers we cannot wait on the async crypto chain that the
      // real malformed-relay-signal path runs through.
      asInternals(manager).failSecureChannel(REMOTE, "hello_invalid");
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

      // Open the grace window, then trigger Secured. The helper must
      // defer the clear to grace expiry — flipping to "healthy"
      // mid-window would lie to the user while we are still silently
      // dropping stale ciphertexts from the prior session.
      asInternals(manager).markPostRetryGrace(REMOTE);
      const fakeKey = await makeFakeSessionKey();
      asInternals(manager).installSessionKey(REMOTE, fakeKey);

      // Entry must still be present during the grace window.
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

      // Advance past POST_RETRY_GRACE_MS (5000ms). The deferred clear
      // fires; the overlay finally comes down.
      vi.advanceTimersByTime(6000);
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failure arriving during a deferred clear wins (failure-always-wins generation invariant)", async () => {
    vi.useFakeTimers();
    try {
      const socket = createFakeSocket();
      const e2eKey = await deriveRoomKey();
      const failures: SecureChannelFailures[] = [];

      const manager = new WebRTCManager({
        localStream: fakeStream(),
        socket: socket as unknown as Socket,
        myPeerId: ME,
        roomCode: ROOM_ID,
        roomType: "human",
        e2eKey,
        onUpdate: () => {},
        onSecureChannelFailure: (f) => failures.push({ ...f }),
      });

      // Seed a failure, open the grace window, trigger Secured. The
      // clear is now deferred for POST_RETRY_GRACE_MS.
      asInternals(manager).failSecureChannel(REMOTE, "hello_invalid");
      asInternals(manager).markPostRetryGrace(REMOTE);
      const fakeKey = await makeFakeSessionKey();
      asInternals(manager).installSessionKey(REMOTE, fakeKey);
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

      // A NEW failure lands before the deferred clear timer fires —
      // bumping the per-peer generation. We mirror exactly what
      // `failSecureChannel` writes for an already-failed entry that
      // re-fails for a *live* peer (the production guard short-
      // circuits second writes when `peers.has(peerId)` is false, but
      // a real reconnect re-adds the peer first). The point of this
      // test is the helper's generation contract — not the
      // failSecureChannel guard — so we touch the two fields the
      // helper inspects directly.
      const internals = asInternals(manager);
      internals.secureChannelFailures.set(REMOTE, "decrypt_failed");
      internals.secureChannelFailureGen.set(
        REMOTE,
        (internals.secureChannelFailureGen.get(REMOTE) ?? 0) + 1,
      );
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

      vi.advanceTimersByTime(10000);
      expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);
      // Read the surviving reason directly from the underlying map —
      // we wrote it via internals without going through the publish
      // callback, so the captured `failures` history reflects only
      // the helper's publication side effects (a published *clear*
      // here would be the bug we're guarding against).
      expect(internals.secureChannelFailures.get(REMOTE)).toBe("decrypt_failed");
      // And critically: the helper must NOT have published a clear
      // after the gen bump — the captured stream's last entry should
      // still show REMOTE present (from the initial seed publish).
      const last = failures[failures.length - 1] ?? {};
      expect(last[REMOTE]).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removing a peer drops the failure entry so a rejoin starts clean", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
    });

    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "initial failure" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    manager.removePeer(REMOTE);
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    const lastPublished = failures[failures.length - 1] ?? {};
    expect(lastPublished[REMOTE]).toBeUndefined();
  });
});

describe("WebRTCManager — full secure-channel recovery via public surface (Task #532)", () => {
  // The clear-on-success suite above reaches `installSessionKey` and
  // `failSecureChannel` directly through a private-internals cast. That
  // pins the helper's contract but cannot catch a regression where the
  // helper stops being wired into a real recovery path — `handleRelay`'s
  // post-failure blacklist (returns early when `secureChannelFailures.has`)
  // makes the in-flight race hard to reproduce through the public
  // socket-event surface alone. These tests drive the same
  // Secured-after-Failed transition end-to-end via `retrySecureChannel`
  // and relay-signal emits, with no internals casts, so the wiring
  // itself is covered.

  it("drives the full peer-secure-channel-retry round-trip on the initiator side and clears the overlay", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];

    // ME ("peer-me0001") sorts BEFORE REMOTE ("peer-remote02"), so the
    // local peer is the entitled initiator under the smaller-initiates
    // rule. That makes `retrySecureChannel` actually run
    // `performKeyExchange` — the call site that lands at
    // `installSessionKey` and exercises
    // `clearSecureChannelFailureOnSuccess` for real.
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: ME,
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
    });

    // Trip the initial failure with a malformed envelope so the overlay
    // would be visible to a real user.
    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "initial hello_invalid failure recorded (initiator side)" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    const sentBefore = socket.__sent.length;
    manager.retrySecureChannel(REMOTE);

    // The retry must inform the remote so they can drop their own
    // blacklist for us. Pin this as part of the round-trip contract.
    expect(
      socket.__sent
        .slice(sentBefore)
        .some((s) => s.event === "peer-secure-channel-retry"),
    ).toBe(true);

    // Wait for the fresh key-exchange relay-signal `initiateOffer`
    // emits inside `retrySecureChannel`.
    await waitFor(
      () =>
        socket.__sent.slice(sentBefore).some(
          (s) =>
            s.event === "relay-signal"
            && (s.args[0] as { toPeerId?: string })?.toPeerId === REMOTE,
        ),
      { label: "fresh key-exchange relay-signal emitted after retry" },
    );

    // Simulate the remote responding to our retry with a valid signed
    // hello. handleKeyExchange resolves the pending key-exchange
    // resolver inside performKeyExchange, which then derives the
    // session key, calls installSessionKey, and publishes SAS.
    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const valid = await signHello(remoteIdentity, body);
    const reply = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: valid,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: reply });

    await waitFor(
      () => sasUpdates.some((s) => REMOTE in s),
      { label: "SAS published after initiator-side recovery" },
    );

    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    const lastFailures = failures[failures.length - 1] ?? {};
    expect(lastFailures[REMOTE]).toBeUndefined();
  });

  it("recovers on the responder side when the remote drives peer-secure-channel-retry and follows up with a valid signed hello", async () => {
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];

    // myPeerId sorts AFTER REMOTE so the local peer is the responder
    // under the smaller-initiates rule. The realistic remote-driven
    // recovery path is: remote clicks retry → server forwards a
    // `peer-secure-channel-retry` to us → the production hook (the
    // only subscriber for that socket event) calls these three public
    // manager methods. We mimic exactly that here, staying entirely on
    // the public manager surface.
    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: "peer-zzzzzz01",
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
    });

    const malformed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "initial hello_invalid failure recorded (responder side)" },
    );
    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(true);

    // Production hook's `peer-secure-channel-retry` handler, mirrored
    // through the public manager surface only.
    manager.markPostRetryGrace(REMOTE);
    manager.removePeer(REMOTE);
    // initiateOffer is a no-op for the responder (shouldInitiateTo
    // false) but the hook fires it unconditionally — mirror that so
    // any regression where the no-op stops being a no-op surfaces.
    void manager.initiateOffer(REMOTE);

    // Remote (the smaller-peerId initiator) sends its fresh signed
    // hello via the phrase-key channel.
    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const valid = await signHello(remoteIdentity, body);
    const reply = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: valid,
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: reply });

    await waitFor(
      () => sasUpdates.some((s) => REMOTE in s),
      { label: "SAS published after responder-side recovery" },
    );

    expect(manager.hasSecureChannelFailure(REMOTE)).toBe(false);
    const lastFailures = failures[failures.length - 1] ?? {};
    expect(lastFailures[REMOTE]).toBeUndefined();
  });

  it("holds the failure-wins / clear-on-success contract when a malformed and a valid key-exchange arrive concurrently after a retry", async () => {
    // Responder side: trip a failure, drop the blacklist via removePeer
    // (mimicking retry-receipt), then emit a malformed and a valid
    // key-exchange in the same microtask tick. Both pass the
    // `handleRelay` blacklist check (no failure outstanding at entry)
    // and both reach `handleKeyExchange`; the malformed routes to
    // `failSecureChannel("hello_invalid")` and the valid routes to
    // `installSessionKey` → `clearSecureChannelFailureOnSuccess`.
    //
    // Completion order is non-deterministic under Node webcrypto's
    // worker-thread scheduling, so we pin the *invariant* both branches
    // must hold rather than a specific ordering: the end state is
    // either (a) loud-failed — failure-wins (helper's generation
    // check prevented the clear from swallowing the real failure),
    // or (b) cleanly recovered with a freshly published SAS — the
    // valid genuinely superseded. The terminal state must never be
    // "overlay down with no session installed", which would be the
    // user-visible "lying healthy" regression.
    const socket = createFakeSocket();
    const e2eKey = await deriveRoomKey();
    const failures: SecureChannelFailures[] = [];
    const sasUpdates: Array<Record<string, [string, string]>> = [];

    const manager = new WebRTCManager({
      localStream: fakeStream(),
      socket: socket as unknown as Socket,
      myPeerId: "peer-zzzzzz01",
      roomCode: ROOM_ID,
      roomType: "human",
      e2eKey,
      onUpdate: () => {},
      onSecureChannelFailure: (f) => failures.push({ ...f }),
      onSASUpdate: (s) => sasUpdates.push({ ...s }),
    });

    const seed = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: seed });
    await waitFor(
      () => failures.some((f) => f[REMOTE] === "hello_invalid"),
      { label: "seed failure recorded" },
    );

    // Drop the blacklist so the next inbound key-exchanges are
    // processed instead of short-circuited.
    manager.removePeer(REMOTE);

    const remoteIdentity = await generateSigningIdentity();
    const pair = await generateECDHKeyPair();
    const ecdhPub = await exportECDHPublicKey(pair.publicKey);
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: ecdhPub,
      roomId: ROOM_ID,
    });
    const validHello = await signHello(remoteIdentity, body);
    const validCt = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: validHello,
    }, REMOTE);
    const malformedCt = await encryptSignal(e2eKey, {
      type: "key-exchange",
      hello: { not: "a-signed-hello" },
    }, REMOTE);

    const failuresBefore = failures.length;
    const sasBefore = sasUpdates.length;
    // Same-tick emits: both handlers enter handleRelay before either
    // crypto chain resolves, so the helper actually sees the race
    // rather than two sequential, fully-settled transitions.
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: malformedCt });
    socket.__emit("relay-signal", { fromPeerId: REMOTE, payload: validCt });

    await waitFor(
      () =>
        failures.slice(failuresBefore).some((f) => f[REMOTE] === "hello_invalid")
        || sasUpdates.slice(sasBefore).some((s) => REMOTE in s),
      { label: "either race outcome observed" },
    );
    // Let any still-in-flight chain complete so the assertion sees the
    // terminal state instead of a mid-race snapshot.
    await new Promise<void>((r) => setTimeout(r, 100));

    if (manager.hasSecureChannelFailure(REMOTE)) {
      // failure-wins branch: a published failure must show the
      // hello_invalid reason — confirming the helper did NOT swallow
      // the real failure even though a Secured observation raced it.
      const failuresForRemote = failures
        .slice(failuresBefore)
        .filter((f) => f[REMOTE] !== undefined);
      expect(failuresForRemote.length).toBeGreaterThan(0);
      expect(
        failuresForRemote[failuresForRemote.length - 1][REMOTE],
      ).toBe("hello_invalid");
    } else {
      // clear-on-success branch: a fresh SAS must have been published
      // for REMOTE. Otherwise the overlay is down with no actual
      // healthy session behind it — the "lying healthy" regression.
      const sasForRemote = sasUpdates
        .slice(sasBefore)
        .filter((s) => REMOTE in s);
      expect(sasForRemote.length).toBeGreaterThan(0);
    }
  });
});
