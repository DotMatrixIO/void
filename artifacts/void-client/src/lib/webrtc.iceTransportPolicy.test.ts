// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { WebRTCManager } from "./webrtc";

// Regression: when WebRTCManager is constructed with
// `iceTransportPolicy: "relay"` (the path used for `.onion` origins),
// every RTCPeerConnection it builds must be constructed with the same
// `iceTransportPolicy` option. A regression here would silently leak
// host/srflx ICE candidates from a Tor user.

const ME = "me";
const REMOTE = "remote";
const ROOM = "room-abc";

function fakeStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function createFakeSocket() {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    on(event: string, fn: (...args: unknown[]) => void) {
      const arr = handlers.get(event) ?? [];
      arr.push(fn);
      handlers.set(event, arr);
    },
    off() {},
    emit() {},
  } as unknown as Socket;
}

let pcConstructorCalls: RTCConfiguration[] = [];

class FakePC {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  constructor(config?: RTCConfiguration) {
    pcConstructorCalls.push(config ?? {});
  }
  addTrack() {}
  getSenders() {
    return [];
  }
  close() {}
}

class FakeMediaStream {
  getTracks() {
    return [];
  }
}

beforeEach(() => {
  pcConstructorCalls = [];
  // @ts-expect-error - jsdom polyfill
  globalThis.RTCPeerConnection = FakePC;
  // @ts-expect-error - jsdom polyfill
  globalThis.MediaStream = FakeMediaStream;
});

describe("WebRTCManager — iceTransportPolicy is forwarded to RTCPeerConnection", () => {
  it("constructs RTCPeerConnection with iceTransportPolicy: 'relay' when configured for relay-only", () => {
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      iceTransportPolicy: "relay",
      onUpdate: () => {},
    });

    // buildPC is private; this regression test exercises it directly so a
    // refactor that drops the iceTransportPolicy plumbing fails loudly.
    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    expect(pcConstructorCalls.length).toBe(1);
    expect(pcConstructorCalls[0].iceTransportPolicy).toBe("relay");
  });

  it("defaults RTCPeerConnection iceTransportPolicy to 'all' when not specified", () => {
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      onUpdate: () => {},
    });

    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    expect(pcConstructorCalls[0].iceTransportPolicy).toBe("all");
  });

  it("calls onPeerConnectionCreated with a PC whose construction config carries the configured iceTransportPolicy", () => {
    const seen: Array<{ peerId: string; pc: RTCPeerConnection }> = [];
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      iceTransportPolicy: "relay",
      onUpdate: () => {},
      onPeerConnectionCreated: (peerId, pc) => seen.push({ peerId, pc }),
    });

    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    expect(seen.length).toBe(1);
    expect(seen[0].peerId).toBe(REMOTE);
    expect(pcConstructorCalls[0].iceTransportPolicy).toBe("relay");
  });
});

// Suppress unused-import lint when vi isn't used directly above.
void vi;
