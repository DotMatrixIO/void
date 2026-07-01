// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Socket } from "socket.io-client";
import { WebRTCManager, isPeerRelayPinned, type PeerRelayStatuses } from "./webrtc";

// Task #293: surface a per-peer "VIA TOR" hint when the only candidate type
// observed for the live pair is `relay`. The signal is derived from
// RTCPeerConnection.getStats() — never from anything the remote peer
// broadcasts about themselves — so a non-Tor peer in a non-relay-only
// room still sees the asymmetry without the Tor user having to opt in.

function makeStats(reports: Array<Record<string, unknown>>): RTCStatsReport {
  return {
    forEach(cb: (report: Record<string, unknown>) => void) {
      for (const r of reports) cb(r);
    },
  } as unknown as RTCStatsReport;
}

describe("isPeerRelayPinned", () => {
  it("returns true when the live candidate pair has both ends as relay", async () => {
    const pc = {
      getStats: vi.fn().mockResolvedValue(
        makeStats([
          {
            type: "candidate-pair",
            state: "succeeded",
            nominated: true,
            localCandidateId: "L",
            remoteCandidateId: "R",
          },
          { type: "local-candidate", id: "L", candidateType: "relay" },
          { type: "remote-candidate", id: "R", candidateType: "relay" },
        ]),
      ),
    } as unknown as RTCPeerConnection;
    expect(await isPeerRelayPinned(pc)).toBe(true);
  });

  it("returns false when the local end is host (e.g. plain LAN P2P)", async () => {
    const pc = {
      getStats: vi.fn().mockResolvedValue(
        makeStats([
          {
            type: "candidate-pair",
            state: "succeeded",
            nominated: true,
            localCandidateId: "L",
            remoteCandidateId: "R",
          },
          { type: "local-candidate", id: "L", candidateType: "host" },
          { type: "remote-candidate", id: "R", candidateType: "relay" },
        ]),
      ),
    } as unknown as RTCPeerConnection;
    expect(await isPeerRelayPinned(pc)).toBe(false);
  });

  it("recognizes the Firefox-style `selected: true` marker on the live pair", async () => {
    const pc = {
      getStats: vi.fn().mockResolvedValue(
        makeStats([
          {
            type: "candidate-pair",
            selected: true,
            localCandidateId: "L",
            remoteCandidateId: "R",
          },
          { type: "local-candidate", id: "L", candidateType: "relay" },
          { type: "remote-candidate", id: "R", candidateType: "relay" },
        ]),
      ),
    } as unknown as RTCPeerConnection;
    expect(await isPeerRelayPinned(pc)).toBe(true);
  });

  it("ignores non-live (non-nominated) pairs even when they would be relay", async () => {
    const pc = {
      getStats: vi.fn().mockResolvedValue(
        makeStats([
          {
            type: "candidate-pair",
            state: "succeeded",
            nominated: false,
            localCandidateId: "L",
            remoteCandidateId: "R",
          },
          { type: "local-candidate", id: "L", candidateType: "relay" },
          { type: "remote-candidate", id: "R", candidateType: "relay" },
        ]),
      ),
    } as unknown as RTCPeerConnection;
    expect(await isPeerRelayPinned(pc)).toBe(false);
  });

  it("returns false when getStats throws", async () => {
    const pc = {
      getStats: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as RTCPeerConnection;
    expect(await isPeerRelayPinned(pc)).toBe(false);
  });
});

// --- Manager-level polling test ---

const ROOM = "room-xyz";
const ME = "me";
const REMOTE = "remote";

function fakeStream(): MediaStream {
  return {
    getTracks: () => [],
    getAudioTracks: () => [],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function createFakeSocket() {
  return {
    on() {},
    off() {},
    emit() {},
  } as unknown as Socket;
}

class FakePC {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "connected";
  statsToReturn: RTCStatsReport = makeStats([]);
  constructor(_config?: RTCConfiguration) {}
  addTrack() {}
  getSenders() {
    return [];
  }
  close() {
    this.connectionState = "closed";
  }
  async getStats() {
    return this.statsToReturn;
  }
}

class FakeMediaStream {
  getTracks() {
    return [];
  }
}

beforeEach(() => {
  // @ts-expect-error - jsdom polyfill
  globalThis.RTCPeerConnection = FakePC;
  // @ts-expect-error - jsdom polyfill
  globalThis.MediaStream = FakeMediaStream;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WebRTCManager — periodic relay-status probe", () => {
  it("publishes peer relay-pinned status derived from candidate-pair stats", async () => {
    const updates: PeerRelayStatuses[] = [];
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      onUpdate: () => {},
      onPeerRelayStatusUpdate: (m) => updates.push({ ...m }),
    });

    let createdPC: FakePC | null = null;
    (mgr as unknown as { onPeerConnectionCreated: (id: string, pc: RTCPeerConnection) => void }).onPeerConnectionCreated =
      (_id, pc) => {
        createdPC = pc as unknown as FakePC;
      };
    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    expect(createdPC).not.toBeNull();
    createdPC!.connectionState = "connected";
    createdPC!.statsToReturn = makeStats([
      {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "L",
        remoteCandidateId: "R",
      },
      { type: "local-candidate", id: "L", candidateType: "relay" },
      { type: "remote-candidate", id: "R", candidateType: "relay" },
    ]);

    await vi.advanceTimersByTimeAsync(3100);
    // Drain the awaited getStats() promise chain.
    await Promise.resolve();
    await Promise.resolve();

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[updates.length - 1][REMOTE]).toBe(true);

    mgr.destroy();
  });

  it("does not publish a peer as relay-pinned when one end is host (direct P2P)", async () => {
    const updates: PeerRelayStatuses[] = [];
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      onUpdate: () => {},
      onPeerRelayStatusUpdate: (m) => updates.push({ ...m }),
    });

    let createdPC: FakePC | null = null;
    (mgr as unknown as { onPeerConnectionCreated: (id: string, pc: RTCPeerConnection) => void }).onPeerConnectionCreated =
      (_id, pc) => {
        createdPC = pc as unknown as FakePC;
      };
    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    createdPC!.connectionState = "connected";
    createdPC!.statsToReturn = makeStats([
      {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "L",
        remoteCandidateId: "R",
      },
      { type: "local-candidate", id: "L", candidateType: "host" },
      { type: "remote-candidate", id: "R", candidateType: "host" },
    ]);

    await vi.advanceTimersByTimeAsync(3100);
    await Promise.resolve();
    await Promise.resolve();

    const last = updates[updates.length - 1] ?? {};
    expect(last[REMOTE] ?? false).toBe(false);

    mgr.destroy();
  });

  it("clears relay-pinned status when the peer is removed", async () => {
    const updates: PeerRelayStatuses[] = [];
    const mgr = new WebRTCManager({
      localStream: fakeStream(),
      socket: createFakeSocket(),
      myPeerId: ME,
      roomCode: ROOM,
      roomType: "human",
      onUpdate: () => {},
      onPeerRelayStatusUpdate: (m) => updates.push({ ...m }),
    });

    let createdPC: FakePC | null = null;
    (mgr as unknown as { onPeerConnectionCreated: (id: string, pc: RTCPeerConnection) => void }).onPeerConnectionCreated =
      (_id, pc) => {
        createdPC = pc as unknown as FakePC;
      };
    (mgr as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(REMOTE);

    createdPC!.connectionState = "connected";
    createdPC!.statsToReturn = makeStats([
      {
        type: "candidate-pair",
        state: "succeeded",
        nominated: true,
        localCandidateId: "L",
        remoteCandidateId: "R",
      },
      { type: "local-candidate", id: "L", candidateType: "relay" },
      { type: "remote-candidate", id: "R", candidateType: "relay" },
    ]);

    await vi.advanceTimersByTimeAsync(3100);
    await Promise.resolve();
    await Promise.resolve();

    mgr.removePeer(REMOTE);
    const last = updates[updates.length - 1] ?? {};
    expect(REMOTE in last).toBe(false);

    mgr.destroy();
  });
});
