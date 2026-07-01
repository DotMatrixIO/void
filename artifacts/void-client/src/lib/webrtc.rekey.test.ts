// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests the time-based PFS rekey (Option A) data-channel ratchet in
// WebRTCManager. The whole security argument is CONTINUITY BINDING: a
// rotation payload must decrypt under the CURRENT SAS-verified session
// key, so only the genuine, already-verified peer can read or forge it.
// That is what lets the rotation be SILENT (carry the verified verdict
// forward, no forced re-verify).
//
// Covered here:
//   1. Continuity / happy path — an offer encrypted under the current
//      session key drives a full offer→answer exchange; both sides
//      install a fresh, interoperable session key and fire the SILENT
//      onSilentRekey callback (NOT the loud onRekey).
//   2. Glare / initiator selection — only the smaller peerId initiates a
//      scheduled rotation; the larger peer waits and responds.
//   3. Negative — a rotation payload that does NOT decrypt under the
//      current session key is silently dropped: no answer, no key swap,
//      no callback, epoch unchanged.
//   4. Late answer / no premature discard — the initiator retains its
//      pending ephemeral key past the former 10s answer-timeout window, so
//      a slow-but-reliably-delivered answer still completes instead of
//      silently desyncing the pair (responder on the new key, initiator
//      stranded on the old one).
//   5. Dead channel cleanup — `onclose` drops the retained pending key so
//      a dead in-flight rekey does not block future rotations.

import { describe, it, expect, vi, afterEach } from "vitest";
import { WebRTCManager } from "./webrtc";
import {
  encryptSignal,
  decryptSignal,
  generateECDHKeyPair,
  exportECDHPublicKey,
  importECDHPublicKey,
  deriveSessionKey,
} from "./signalCrypto";
import type { Socket } from "socket.io-client";

const ROOM_ID = "0123456789abcdef";
// Deterministic ordering: A < B lexicographically, so A initiates.
const A = "peer-aaa0001";
const B = "peer-bbb0002";

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

function fakeSocket(): Socket {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as Socket;
}

// A fake RTCDataChannel. When `__peer` is set, `send` delivers the bytes
// to the peer channel's `onmessage` on a microtask, mimicking the
// browser's async data-channel delivery. Without a `__peer`, `send` is a
// spy that records calls but delivers nothing (used to assert that a side
// did/did not transmit).
interface FakeChannel extends RTCDataChannel {
  __peer?: FakeChannel;
  __sent: string[];
}

function makeChannel(): FakeChannel {
  const ch = {
    readyState: "open",
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onclose: null as (() => void) | null,
    __sent: [] as string[],
    __peer: undefined as FakeChannel | undefined,
    send(data: string) {
      this.__sent.push(data);
      const peer = this.__peer;
      if (peer) {
        queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent));
      }
    },
    close() {},
  };
  return ch as unknown as FakeChannel;
}

function linkedPair(): [FakeChannel, FakeChannel] {
  const a = makeChannel();
  const b = makeChannel();
  a.__peer = b;
  b.__peer = a;
  return [a, b];
}

async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 5 } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise<void>((r) => setTimeout(r, interval));
  }
  if (!predicate()) throw new Error("waitFor timed out");
}

// Two real ECDH keypairs produce two identical AES-GCM session keys (and
// an identical SAS) — exactly mirroring a completed production handshake.
// Both managers are seeded with the same key, so an offer one encrypts
// the other can decrypt.
async function sharedSessionKey(): Promise<{ key: CryptoKey; sas: [string, string] }> {
  const kpA = await generateECDHKeyPair();
  const kpB = await generateECDHKeyPair();
  const pubA = await exportECDHPublicKey(kpA.publicKey);
  const pubB = await exportECDHPublicKey(kpB.publicKey);
  const a = await deriveSessionKey(kpA.privateKey, await importECDHPublicKey(pubB));
  const b = await deriveSessionKey(kpB.privateKey, await importECDHPublicKey(pubA));
  // a.key and b.key are interoperable AES-GCM keys; either reference works.
  void b;
  return a;
}

type Internals = {
  peerSessionKeys: Map<string, CryptoKey>;
  peerRekeyEpoch: Map<string, number>;
  peerLastRekeyAt: Map<string, number>;
  peerRekeyChannels: Map<string, RTCDataChannel>;
  peerPendingRekey: Map<string, unknown>;
  rekeyTimer: ReturnType<typeof setInterval> | null;
  attachRekeyChannel(peerId: string, channel: RTCDataChannel): void;
  initiateRekey(peerId: string): Promise<void>;
  runScheduledRekeys(): Promise<void>;
  handleRekeyMessage(peerId: string, raw: string): Promise<void>;
  shouldInitiateTo(peerId: string): boolean;
};

const managers: WebRTCManager[] = [];

function makeManager(
  myPeerId: string,
  spies: {
    onSilentRekey?: (peerId: string, fp: string, sas: [string, string]) => void;
    onRekey?: (peerId: string) => void;
  } = {},
): WebRTCManager {
  const mgr = new WebRTCManager({
    localStream: fakeStream(),
    socket: fakeSocket(),
    myPeerId,
    roomCode: ROOM_ID,
    roomType: "human",
    onUpdate: () => {},
    onSilentRekey: spies.onSilentRekey,
    onRekey: spies.onRekey,
  });
  managers.push(mgr);
  return mgr;
}

function internals(mgr: WebRTCManager): Internals {
  return mgr as unknown as Internals;
}

afterEach(() => {
  // The constructor arms a 30s scheduled-rekey interval; clear it so the
  // test process has no dangling handles.
  for (const mgr of managers.splice(0)) {
    const t = internals(mgr).rekeyTimer;
    if (t) clearInterval(t);
  }
});

describe("WebRTCManager time-based PFS rekey (data-channel ratchet)", () => {
  it("rotates silently end-to-end: offer→answer under the current key installs a fresh, interoperable key on both sides", async () => {
    const aSilent = vi.fn();
    const aLoud = vi.fn();
    const bSilent = vi.fn();
    const bLoud = vi.fn();
    const mgrA = makeManager(A, { onSilentRekey: aSilent, onRekey: aLoud });
    const mgrB = makeManager(B, { onSilentRekey: bSilent, onRekey: bLoud });
    const a = internals(mgrA);
    const b = internals(mgrB);

    const old = await sharedSessionKey();
    a.peerSessionKeys.set(B, old.key);
    a.peerRekeyEpoch.set(B, 0);
    b.peerSessionKeys.set(A, old.key);
    b.peerRekeyEpoch.set(A, 0);

    const [chA, chB] = linkedPair();
    a.attachRekeyChannel(B, chA);
    b.attachRekeyChannel(A, chB);

    await a.initiateRekey(B);

    await waitFor(() => aSilent.mock.calls.length > 0 && bSilent.mock.calls.length > 0);

    // SILENT path only — the loud RE-VERIFY callback never fires.
    expect(aLoud).not.toHaveBeenCalled();
    expect(bLoud).not.toHaveBeenCalled();

    // Callback shape: (peerId, fingerprint, sas).
    expect(aSilent).toHaveBeenCalledWith(B, expect.any(String), expect.any(Array));
    expect(bSilent).toHaveBeenCalledWith(A, expect.any(String), expect.any(Array));

    // Both sides converged on the same fresh SAS.
    const aSas = aSilent.mock.calls[0][2] as [string, string];
    const bSas = bSilent.mock.calls[0][2] as [string, string];
    expect(aSas).toEqual(bSas);

    // Epoch advanced monotonically on both sides.
    expect(a.peerRekeyEpoch.get(B)).toBe(1);
    expect(b.peerRekeyEpoch.get(A)).toBe(1);

    // The installed keys actually changed and remain interoperable: a
    // message A encrypts under its NEW key decrypts under B's NEW key.
    const newA = a.peerSessionKeys.get(B)!;
    const newB = b.peerSessionKeys.get(A)!;
    expect(newA).not.toBe(old.key);
    expect(newB).not.toBe(old.key);
    const ct = await encryptSignal(newA, { ping: 1 }, A);
    const pt = (await decryptSignal(newB, ct, A)) as { ping: number };
    expect(pt.ping).toBe(1);
  });

  it("selects the initiator deterministically: only the smaller peerId initiates a scheduled rotation", async () => {
    const mgrA = makeManager(A);
    const mgrB = makeManager(B);
    const a = internals(mgrA);
    const b = internals(mgrB);

    expect(a.shouldInitiateTo(B)).toBe(true);
    expect(b.shouldInitiateTo(A)).toBe(false);

    const old = await sharedSessionKey();
    // Both have a long-overdue rotation (last rekey at epoch 0 wall-clock).
    a.peerSessionKeys.set(B, old.key);
    a.peerRekeyEpoch.set(B, 0);
    a.peerLastRekeyAt.set(B, 0);
    b.peerSessionKeys.set(A, old.key);
    b.peerRekeyEpoch.set(A, 0);
    b.peerLastRekeyAt.set(A, 0);

    const chA = makeChannel(); // no __peer: records sends, delivers nothing
    const chB = makeChannel();
    a.attachRekeyChannel(B, chA);
    b.attachRekeyChannel(A, chB);

    await a.runScheduledRekeys();
    await b.runScheduledRekeys();

    // A (smaller) initiated: it transmitted an offer and is now pending.
    expect((chA as FakeChannel).__sent.length).toBe(1);
    expect(a.peerPendingRekey.has(B)).toBe(true);

    // B (larger) stayed silent: no transmit, no pending rotation.
    expect((chB as FakeChannel).__sent.length).toBe(0);
    expect(b.peerPendingRekey.has(A)).toBe(false);
  });

  it("rejects a rotation NOT encrypted under the current session key: no answer, no key swap, no callback", async () => {
    const bSilent = vi.fn();
    const bLoud = vi.fn();
    const mgrB = makeManager(B, { onSilentRekey: bSilent, onRekey: bLoud });
    const b = internals(mgrB);

    const old = await sharedSessionKey();
    b.peerSessionKeys.set(A, old.key);
    b.peerRekeyEpoch.set(A, 0);

    const chB = makeChannel(); // records any answer B would send
    b.attachRekeyChannel(A, chB);

    // Forge an offer under an UNRELATED key (an attacker who does not hold
    // the verified session key). A valid-looking ECDH pubkey + epoch, but
    // the AEAD will not authenticate under B's stored session key.
    const wrong = await sharedSessionKey();
    const kp = await generateECDHKeyPair();
    const pub = await exportECDHPublicKey(kp.publicKey);
    const forged = await encryptSignal(wrong.key, { t: "o", pub, epoch: 1 }, A);

    await b.handleRekeyMessage(A, forged);
    // Give any (incorrect) async response a chance to run.
    await new Promise<void>((r) => setTimeout(r, 20));

    // Silently dropped: no answer transmitted, session key + epoch intact,
    // and neither rekey callback fired.
    expect((chB as FakeChannel).__sent.length).toBe(0);
    expect(b.peerSessionKeys.get(A)).toBe(old.key);
    expect(b.peerRekeyEpoch.get(A)).toBe(0);
    expect(bSilent).not.toHaveBeenCalled();
    expect(bLoud).not.toHaveBeenCalled();
  });

  it("completes a late answer instead of desyncing: the initiator retains its pending key past the old answer-timeout window", async () => {
    const aSilent = vi.fn();
    const aLoud = vi.fn();
    const bSilent = vi.fn();
    const bLoud = vi.fn();
    const mgrA = makeManager(A, { onSilentRekey: aSilent, onRekey: aLoud });
    const mgrB = makeManager(B, { onSilentRekey: bSilent, onRekey: bLoud });
    const a = internals(mgrA);
    const b = internals(mgrB);

    const old = await sharedSessionKey();
    a.peerSessionKeys.set(B, old.key);
    a.peerRekeyEpoch.set(B, 0);
    b.peerSessionKeys.set(A, old.key);
    b.peerRekeyEpoch.set(A, 0);

    // Unlinked channels: send() records bytes but delivers nothing, so we
    // can pump the offer and the answer by hand and interpose a delay.
    const chA = makeChannel();
    const chB = makeChannel();
    a.attachRekeyChannel(B, chA);
    b.attachRekeyChannel(A, chB);

    // A initiates and is now waiting on the answer.
    await a.initiateRekey(B);
    expect(a.peerPendingRekey.has(B)).toBe(true);
    const offer = (chA as FakeChannel).__sent.at(-1)!;

    // Deliver the offer to B. B answers AND installs its new key right away
    // (the responder commits optimistically), advancing to epoch 1.
    await b.handleRekeyMessage(A, offer);
    await waitFor(() => bSilent.mock.calls.length > 0);
    expect(b.peerRekeyEpoch.get(A)).toBe(1);
    const answer = (chB as FakeChannel).__sent.at(-1)!;

    // The answer is SLOW — delayed past the former 10s answer-timeout. The
    // pending entry MUST survive: discarding it here is the regression that
    // silently desynced the pair (B on the new key, A stuck on the old one).
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(a.peerPendingRekey.has(B)).toBe(true);

    // The late answer still completes: A installs the matching key, fires
    // the SILENT callback (never the loud re-verify), and converges with B.
    await a.handleRekeyMessage(B, answer);
    await waitFor(() => aSilent.mock.calls.length > 0);
    expect(aLoud).not.toHaveBeenCalled();
    expect(bLoud).not.toHaveBeenCalled();
    expect(a.peerRekeyEpoch.get(B)).toBe(1);
    expect(a.peerPendingRekey.has(B)).toBe(false);

    // Both sides converged on the same fresh SAS and an interoperable key.
    const aSas = aSilent.mock.calls[0][2] as [string, string];
    const bSas = bSilent.mock.calls[0][2] as [string, string];
    expect(aSas).toEqual(bSas);
    const newA = a.peerSessionKeys.get(B)!;
    const newB = b.peerSessionKeys.get(A)!;
    const ct = await encryptSignal(newA, { ping: 7 }, A);
    const pt = (await decryptSignal(newB, ct, A)) as { ping: number };
    expect(pt.ping).toBe(7);
  });

  it("drops the retained pending key when the rekey channel closes: a dead in-flight rekey does not block future rotations", async () => {
    const mgrA = makeManager(A);
    const a = internals(mgrA);

    const old = await sharedSessionKey();
    a.peerSessionKeys.set(B, old.key);
    a.peerRekeyEpoch.set(B, 0);

    const chA = makeChannel(); // no __peer: the answer never comes back
    a.attachRekeyChannel(B, chA);

    await a.initiateRekey(B);
    expect(a.peerPendingRekey.has(B)).toBe(true);

    // The browser fires `onclose` when the data channel dies. That must
    // clear the stranded pending entry.
    (chA as FakeChannel).onclose?.(new Event("close"));
    expect(a.peerPendingRekey.has(B)).toBe(false);
  });
});
