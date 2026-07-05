// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #344: a small "HOST" badge renders on the host's video tile so a
// guest can spot the moderator at a glance, without cross-referencing the
// "HOST: PEER-XYZ" header pill against the tag burned into each tile. The
// badge is purely a UI surfacing of the existing hostPeerId / hostPresent
// state — no new server work. These tests use snapshot mode so we pin
// pure render behavior without spinning up sockets or media.

vi.mock("@/lib/socket", () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  }),
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/sounds", () => ({
  playBleep: vi.fn(),
  playBloop: vi.fn(),
  playClick: vi.fn(),
  playSelectClick: vi.fn(),
  playSlide: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
  closeAudioContext: vi.fn(async () => {}),
}));

vi.mock("@/lib/webrtc", () => ({
  WebRTCManager: class {
    initiateOffer = vi.fn();
    destroy = vi.fn();
    removePeer = vi.fn();
    replaceVideoTrack = vi.fn();
    clearVideoOverride = vi.fn();
    constructor() {}
  },
}));

vi.mock("@/lib/mediaPipeline", async () => {
  const actual = await vi.importActual<object>("@/lib/mediaPipeline");
  return {
    ...actual,
    buildMediaPipeline: vi.fn(() => new Promise(() => {})),
    createWatermarkedScreenShareTrack: vi.fn(),
  };
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({ default: () => null }));
vi.mock("@/components/RoomShareSheet", () => ({ default: () => null }));
vi.mock("@/components/PaywallModal", () => ({ default: () => null }));

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverPolyfill;
}

if (typeof HTMLMediaElement !== "undefined") {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  HTMLMediaElement.prototype.pause = () => undefined;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

import RoomPage from "@/pages/RoomPage";

const TEST_ROOM = "abcdef0123456789abcdef0123456789";
const TEST_PHRASE = "ability about above absent absorb abstract";
const fakeKey = {} as CryptoKey;

const HOST_PEER_ID = "peer-host01";
const GUEST_PEER_ID = "peer-guest02";
const ME_PEER_ID = "peer-meself";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host tile badge — Task #344", () => {
  it("marks the host's tile for a guest when the host is present and on screen", () => {
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        snapshotState={{
          peers: [HOST_PEER_ID, GUEST_PEER_ID],
          localStream: null,
          remoteStreams: {},
          peerMediaState: {
            [HOST_PEER_ID]: { camOff: false, micMuted: false },
            [GUEST_PEER_ID]: { camOff: false, micMuted: false },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    const badge = screen.getByTestId(`host-tile-badge-${HOST_PEER_ID}`);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/^HOST$/);

    // A non-host guest's tile must NOT carry the badge.
    expect(screen.queryByTestId(`host-tile-badge-${GUEST_PEER_ID}`)).toBeNull();
  });

  it("never marks the local user's own tile, even when they are the host", () => {
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        snapshotState={{
          peers: [GUEST_PEER_ID],
          localStream: null,
          remoteStreams: {},
          peerMediaState: {
            [GUEST_PEER_ID]: { camOff: false, micMuted: false },
          },
          isHost: true,
          hostPresent: true,
          hostPeerId: ME_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    // The local (self) tile is the host here — it must never wear the
    // marker, and no remote tile matches the host id either.
    expect(screen.queryByTestId(`host-tile-badge-${ME_PEER_ID}`)).toBeNull();
    expect(screen.queryByTestId(`host-tile-badge-${GUEST_PEER_ID}`)).toBeNull();
  });

  it("does not mark any tile when the host is absent (hostPresent: false)", () => {
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        snapshotState={{
          peers: [HOST_PEER_ID],
          localStream: null,
          remoteStreams: {},
          peerMediaState: {
            [HOST_PEER_ID]: { camOff: false, micMuted: false },
          },
          isHost: false,
          hostPresent: false,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    expect(screen.queryByTestId(`host-tile-badge-${HOST_PEER_ID}`)).toBeNull();
  });
});
