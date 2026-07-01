// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WebRTCManager } from "./webrtc";
import type { Socket } from "socket.io-client";

const ROOM_ID = "abcdef0123456789abcdef0123456789";
const ME = "peer-me0001";
const REMOTE = "peer-remote02";

interface FakeSender {
  track: MediaStreamTrack | null;
  replaceTrack: ReturnType<typeof vi.fn>;
}

class FakePC {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  senders: FakeSender[] = [];

  addTrack(track: MediaStreamTrack) {
    const sender: FakeSender = {
      track,
      replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => {
        sender.track = next;
      }),
    };
    this.senders.push(sender);
  }
  getSenders() {
    return this.senders as unknown as RTCRtpSender[];
  }
  async createOffer() {
    return { type: "offer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit;
  }
  async createAnswer() {
    return { type: "answer", sdp: STUB_VALID_SDP } as RTCSessionDescriptionInit;
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  async addIceCandidate() {}
  close() {}
  get localDescription() {
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
  private tracks: MediaStreamTrack[] = [];
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
  addTrack(t: MediaStreamTrack) { this.tracks.push(t); }
  removeTrack(t: MediaStreamTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
  addEventListener() {}
  removeEventListener() {}
}

beforeEach(() => {
  // @ts-expect-error - jsdom polyfill
  globalThis.RTCPeerConnection = FakePC;
  // @ts-expect-error - jsdom polyfill
  globalThis.MediaStream = FakeMediaStream;
});

function fakeTrack(kind: "video" | "audio", label: string): MediaStreamTrack {
  return {
    kind,
    label,
    enabled: true,
    readyState: "live",
    stop: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaStreamTrack;
}

function fakeStreamWithTracks(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
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

function buildManagerWithPeer() {
  const cameraTrack = fakeTrack("video", "camera");
  const localStream = fakeStreamWithTracks([cameraTrack]);
  const mgr = new WebRTCManager({
    localStream,
    socket: fakeSocket(),
    myPeerId: ME,
    roomCode: ROOM_ID,
    roomType: "human",
    onUpdate: () => {},
  });

  const buildPC = (
    mgr as unknown as { buildPC: (id: string) => RTCPeerConnection }
  ).buildPC.bind(mgr);
  const pc = buildPC(REMOTE) as unknown as FakePC;

  return { mgr, pc, cameraTrack };
}

describe("WebRTCManager screen-share restoration", () => {
  it("replaceVideoTrack swaps the screen-share track in via RTCRtpSender.replaceTrack", () => {
    const { mgr, pc, cameraTrack } = buildManagerWithPeer();
    const videoSender = pc.senders.find((s) => s.track === cameraTrack)!;
    expect(videoSender).toBeDefined();

    const displayTrack = fakeTrack("video", "display");
    mgr.replaceVideoTrack(displayTrack);

    expect(videoSender.replaceTrack).toHaveBeenCalledWith(displayTrack);
    expect(videoSender.track).toBe(displayTrack);
  });

  it("clearVideoOverride restores the exact pre-share camera track on every sender (graceful-end path)", () => {
    const { mgr, pc, cameraTrack } = buildManagerWithPeer();
    const videoSender = pc.senders.find((s) => s.track === cameraTrack)!;

    const displayTrack = fakeTrack("video", "display");
    mgr.replaceVideoTrack(displayTrack);
    expect(videoSender.track).toBe(displayTrack);

    mgr.clearVideoOverride();
    expect(videoSender.track).toBe(cameraTrack);
  });

  it("clearVideoOverride called without a prior swap (failure path) restores from localStream and does not error", () => {
    const { mgr, pc, cameraTrack } = buildManagerWithPeer();
    const videoSender = pc.senders.find((s) => s.track === cameraTrack)!;

    expect(() => mgr.clearVideoOverride()).not.toThrow();
    expect(videoSender.track).toBe(cameraTrack);
  });

  it("failure-path and graceful-end-path post-restore states are identical", () => {
    const a = buildManagerWithPeer();
    const aSender = a.pc.senders.find((s) => s.track === a.cameraTrack)!;
    a.mgr.clearVideoOverride();
    const aFinal = aSender.track;

    const b = buildManagerWithPeer();
    const bSender = b.pc.senders.find((s) => s.track === b.cameraTrack)!;
    b.mgr.replaceVideoTrack(fakeTrack("video", "display"));
    b.mgr.clearVideoOverride();
    const bFinal = bSender.track;

    expect(aFinal?.kind).toBe("video");
    expect(bFinal?.kind).toBe("video");
    expect(aFinal?.label).toBe("camera");
    expect(bFinal?.label).toBe("camera");
  });
});
