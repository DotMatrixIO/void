// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #349: a small "HOST VIA .ONION" badge renders next to the
// existing E2E / RELAY ONLY badges when the room's host has advertised
// — over the existing peer-media-state signaling channel — that they
// loaded VOID from a .onion origin. The badge is purely informational:
// local ICE enforcement is still owned by initialIceTransportPolicy()
// in each peer's own RoomPage. These tests use snapshot mode so we
// pin pure render behavior without spinning up sockets or media.

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
const ME_PEER_ID = "peer-meself";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HOST VIA .ONION badge — Task #349", () => {
  beforeEach(() => {
    // Force a clearnet origin so the local "Connected via Tor onion"
    // badge does not also fire — we want to assert the new badge
    // independently of the pre-existing self-perspective badge.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        hostname: "void.example.com",
        protocol: "https:",
        href: "https://void.example.com/",
      },
    });
  });

  it("renders the HOST VIA .ONION badge for a guest when the host's advertised peer-media-state carries viaOnion: true", () => {
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
            [HOST_PEER_ID]: { camOff: false, micMuted: false, viaOnion: true },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    const badge = screen.getByTestId("host-via-onion-indicator");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/HOST VIA \.ONION/);
  });

  it("does not render the HOST VIA .ONION badge when the host's advertised peer-media-state carries viaOnion: false", () => {
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
            [HOST_PEER_ID]: { camOff: false, micMuted: false, viaOnion: false },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    expect(screen.queryByTestId("host-via-onion-indicator")).toBeNull();
  });

  it("does not render the HOST VIA .ONION badge when the host has not advertised any onion flag yet", () => {
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
            // Host present but viaOnion not yet known — must not assume.
            [HOST_PEER_ID]: { camOff: false, micMuted: false },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    expect(screen.queryByTestId("host-via-onion-indicator")).toBeNull();
  });

  it("does not render the HOST VIA .ONION badge for the local user when they themselves are the host on a clearnet origin", () => {
    render(
      <RoomPage
        roomId={TEST_ROOM}
        e2eKey={fakeKey}
        voidPhrase={TEST_PHRASE}
        snapshotState={{
          peers: [],
          localStream: null,
          remoteStreams: {},
          peerMediaState: {},
          isHost: true,
          hostPresent: true,
          hostPeerId: ME_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    // The local user is the host; the self-perspective "Connected via
    // Tor onion" badge already covers this case, so the duplicate
    // HOST VIA .ONION badge must not also render.
    expect(screen.queryByTestId("host-via-onion-indicator")).toBeNull();
  });
});

describe("per-peer .ONION badge — Task #366", () => {
  beforeEach(() => {
    // Force a clearnet origin so the local self-perspective Tor badge
    // does not fire — we want to assert the new per-peer badge purely
    // from the remote peer's advertised peer-media-state.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        hostname: "void.example.com",
        protocol: "https:",
        href: "https://void.example.com/",
      },
    });
  });

  it("renders a per-peer .ONION badge for a non-host guest who advertised viaOnion: true", () => {
    const GUEST_PEER_ID = "peer-guest02";
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
            // Host on clearnet — the room-level HOST VIA .ONION pill
            // must stay silent so we know we're asserting only the
            // per-peer guest indicator.
            [HOST_PEER_ID]: { camOff: false, micMuted: false, viaOnion: false },
            // Non-host guest came in over .onion.
            [GUEST_PEER_ID]: { camOff: false, micMuted: false, viaOnion: true },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    const badge = screen.getByTestId(`peer-via-onion-${GUEST_PEER_ID}`);
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/\.ONION/);

    // The host-perspective room-level badge must NOT fire here — the
    // host advertised viaOnion: false. This pins that the new per-peer
    // indicator is independent of the existing host-only indicator.
    expect(screen.queryByTestId("host-via-onion-indicator")).toBeNull();
  });

  it("also renders the per-peer .ONION badge for the host's own tile when the host advertised viaOnion: true (alongside the room-level pill)", () => {
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
            [HOST_PEER_ID]: { camOff: false, micMuted: false, viaOnion: true },
          },
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    // The host's remote tile is itself a non-self peer, so the per-peer
    // badge should render there too — consistent with every other peer.
    expect(screen.getByTestId(`peer-via-onion-${HOST_PEER_ID}`)).toBeInTheDocument();
    // And the existing room-level host pill still fires.
    expect(screen.getByTestId("host-via-onion-indicator")).toBeInTheDocument();
  });

  it("does not render the per-peer .ONION badge when the peer has not advertised viaOnion", () => {
    const GUEST_PEER_ID = "peer-guest03";
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
          isHost: false,
          hostPresent: true,
          hostPeerId: HOST_PEER_ID,
          myPeerId: ME_PEER_ID,
        }}
      />,
    );

    expect(screen.queryByTestId(`peer-via-onion-${GUEST_PEER_ID}`)).toBeNull();
  });
});
