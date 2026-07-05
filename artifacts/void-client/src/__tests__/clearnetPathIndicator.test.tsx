// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Task #1022: explicit clearnet-path state in the call. When a .onion mirror
// is published but the session reached VOID over clearnet, a non-alarming
// CLEARNET PATH indicator renders next to the E2E / RELAY ONLY badges, so
// "clearnet" is a known choice rather than an invisible default. It is
// suppressed when no .onion mirror is configured (there is no alternative to
// offer) and on the .onion origin (the "Connected via Tor onion" badge covers
// that). These use snapshot mode to pin pure render behavior.

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
const ME_PEER_ID = "peer-meself";

const ONION_HOST =
  "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";

function setClearnetOrigin() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      hostname: "void.example.com",
      protocol: "https:",
      href: "https://void.example.com/",
    },
  });
}

function setOnionOrigin() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      hostname: ONION_HOST,
      protocol: "http:",
      href: `http://${ONION_HOST}/`,
    },
  });
}

function renderRoom() {
  return render(
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
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CLEARNET PATH indicator — Task #1022", () => {
  beforeEach(() => {
    setClearnetOrigin();
  });

  it("renders the CLEARNET PATH badge when a .onion mirror is published but the session is on clearnet", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", `http://${ONION_HOST}/`);
    renderRoom();
    const badge = screen.getByTestId("clearnet-path-indicator");
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toMatch(/CLEARNET PATH/);
    // The positive onion badge must NOT also fire on a clearnet origin.
    expect(screen.queryByTestId("tor-onion-indicator")).toBeNull();
  });

  it("does not render the CLEARNET PATH badge when no .onion mirror is configured", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", "");
    renderRoom();
    expect(screen.queryByTestId("clearnet-path-indicator")).toBeNull();
  });

  it("does not render the CLEARNET PATH badge on the .onion origin (the positive badge covers that)", () => {
    setOnionOrigin();
    vi.stubEnv("VITE_VOID_ONION_HOST", `http://${ONION_HOST}/`);
    renderRoom();
    expect(screen.queryByTestId("clearnet-path-indicator")).toBeNull();
    expect(screen.getByTestId("tor-onion-indicator")).toBeInTheDocument();
  });
});
