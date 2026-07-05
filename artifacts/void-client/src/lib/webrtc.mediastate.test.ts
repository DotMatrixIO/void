// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #868: per-peer media-state (camOff / micMuted / voiceMode /
// viaOnion) now rides a dedicated `void.media-state` RTCDataChannel
// (DTLS-over-SCTP) instead of the old plaintext `peer-media-state`
// signaling broadcast. The signaling server no longer relays or reads it.
//
// Covered here, at the WebRTCManager data-channel layer:
//   1. Late-joiner convergence — when a peer's channel opens, the cached
//      local snapshot is replayed so they render the correct state even
//      though they joined after the last toggle.
//   2. Live broadcast — setLocalMediaState() pushes to every open channel.
//   3. Strict inbound validation — malformed payloads are dropped, and an
//      out-of-range voiceMode / non-boolean viaOnion is OMITTED (never
//      coerced), which is exactly what lets the receiver-side reducer
//      preserve the prior cached value on a partial update.
//   4. Fail-safe — a message arriving before any local snapshot still
//      surfaces the peer's reported booleans (no false "unmuted" claim is
//      ever fabricated; absence is handled by the UI, not by this layer).

import { describe, it, expect, vi, afterEach } from "vitest";
import { WebRTCManager, type PeerMediaStateMessage } from "./webrtc";
import type { Socket } from "socket.io-client";

const ROOM_ID = "0123456789abcdef";
// Deterministic ordering: A < B lexicographically.
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

// A fake RTCDataChannel mirroring the browser's async delivery: when
// `__peer` is set, `send` delivers the bytes to the peer channel's
// `onmessage` on a microtask. Without a `__peer`, `send` only records.
interface FakeChannel extends RTCDataChannel {
  __peer?: FakeChannel;
  __sent: string[];
}

function makeChannel(): FakeChannel {
  const ch = {
    readyState: "open",
    onopen: null as (() => void) | null,
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

type Internals = {
  peerMediaStateChannels: Map<string, RTCDataChannel>;
  localMediaState: PeerMediaStateMessage | null;
  attachMediaStateChannel(peerId: string, channel: RTCDataChannel): void;
  rekeyTimer: ReturnType<typeof setInterval> | null;
};

const managers: WebRTCManager[] = [];

function makeManager(
  myPeerId: string,
  onMediaStateReceived?: (peerId: string, state: PeerMediaStateMessage) => void,
): WebRTCManager {
  const mgr = new WebRTCManager({
    localStream: fakeStream(),
    socket: fakeSocket(),
    myPeerId,
    roomCode: ROOM_ID,
    roomType: "human",
    onUpdate: () => {},
    onMediaStateReceived,
  });
  managers.push(mgr);
  return mgr;
}

function internals(mgr: WebRTCManager): Internals {
  return mgr as unknown as Internals;
}

afterEach(() => {
  // The constructor arms a 30s scheduled-rekey interval (human rooms);
  // clear it so the test process has no dangling handles.
  for (const mgr of managers.splice(0)) {
    const t = internals(mgr).rekeyTimer;
    if (t) clearInterval(t);
  }
});

describe("WebRTCManager per-peer media-state channel (Task #868)", () => {
  it("converges a late joiner: a freshly attached channel immediately replays the cached local snapshot", async () => {
    const received: Array<{ peerId: string; state: PeerMediaStateMessage }> = [];
    const mgrA = makeManager(A);
    const mgrB = makeManager(B, (peerId, state) =>
      received.push({ peerId, state }),
    );
    const a = internals(mgrA);
    const b = internals(mgrB);

    // A has already toggled its mic/cam/mask BEFORE B's channel exists.
    mgrA.setLocalMediaState({
      camOff: true,
      micMuted: false,
      voiceMode: 3,
      viaOnion: true,
    });

    const [chA, chB] = linkedPair();
    // B wires its receiver first so the microtask sees a live handler.
    b.attachMediaStateChannel(A, chB);
    // A's channel opens last — attach replays the cached snapshot on open.
    a.attachMediaStateChannel(B, chA);

    await waitFor(() => received.length > 0);
    expect(received[0].peerId).toBe(A);
    expect(received[0].state).toEqual({
      camOff: true,
      micMuted: false,
      voiceMode: 3,
      viaOnion: true,
    });
  });

  it("broadcasts a live toggle to every open channel via setLocalMediaState", async () => {
    const received: PeerMediaStateMessage[] = [];
    const mgrA = makeManager(A);
    const mgrB = makeManager(B, (_pid, state) => received.push(state));
    const a = internals(mgrA);
    const b = internals(mgrB);

    const [chA, chB] = linkedPair();
    a.attachMediaStateChannel(B, chA);
    b.attachMediaStateChannel(A, chB);

    // No snapshot cached yet, so attach sent nothing.
    expect((chA as FakeChannel).__sent.length).toBe(0);

    mgrA.setLocalMediaState({ camOff: false, micMuted: true });
    await waitFor(() => received.length > 0);
    expect(received[received.length - 1]).toEqual({
      camOff: false,
      micMuted: true,
    });
  });

  it("strictly validates inbound payloads: drops malformed and omits an out-of-range voiceMode / non-boolean viaOnion", async () => {
    const received: PeerMediaStateMessage[] = [];
    const mgrB = makeManager(B, (_pid, state) => received.push(state));
    const b = internals(mgrB);

    const [feed, chB] = linkedPair();
    b.attachMediaStateChannel(A, chB);

    // Missing micMuted → the whole message is rejected (no callback).
    feed.send(JSON.stringify({ camOff: true }));
    // Out-of-range voiceMode + non-boolean viaOnion → booleans kept, the
    // bad optional fields are OMITTED (not coerced), which is what lets the
    // receiver reducer preserve the prior cached value.
    feed.send(
      JSON.stringify({
        camOff: false,
        micMuted: false,
        voiceMode: 99,
        viaOnion: "yes",
      }),
    );

    await waitFor(() => received.length > 0);
    // Exactly one callback — the malformed one never fired.
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ camOff: false, micMuted: false });
    expect(received[0]).not.toHaveProperty("voiceMode");
    expect(received[0]).not.toHaveProperty("viaOnion");
  });

  it("accepts a valid partial update (booleans only) so the receiver can preserve prior voiceMode/viaOnion", async () => {
    const received: PeerMediaStateMessage[] = [];
    const mgrB = makeManager(B, (_pid, state) => received.push(state));
    const b = internals(mgrB);

    const [feed, chB] = linkedPair();
    b.attachMediaStateChannel(A, chB);

    feed.send(JSON.stringify({ camOff: true, micMuted: true }));
    await waitFor(() => received.length > 0);
    expect(received[0]).toEqual({ camOff: true, micMuted: true });
  });
});
