// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import RoomPage from "@/pages/RoomPage";

type SocketHandler = (...args: unknown[]) => void;
type EmitCallback = (result: unknown) => void;

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  __handlers: Record<string, SocketHandler[]>;
  __trigger: (event: string, ...args: unknown[]) => void;
  __getEmit: (event: string) => unknown[][];
}

function createMockSocket(): MockSocket {
  const handlers: Record<string, SocketHandler[]> = {};
  const emitCalls: Array<{ event: string; args: unknown[] }> = [];
  const socket: MockSocket = {
    on: vi.fn((event: string, handler: SocketHandler) => {
      (handlers[event] ??= []).push(handler);
    }),
    off: vi.fn((event: string, handler?: SocketHandler) => {
      if (!handlers[event]) return;
      if (!handler) {
        delete handlers[event];
        return;
      }
      handlers[event] = handlers[event].filter((h) => h !== handler);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      emitCalls.push({ event, args });
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn(),
      off: vi.fn(),
    },
    __handlers: handlers,
    __trigger(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
    __getEmit(event: string) {
      return emitCalls.filter((c) => c.event === event).map((c) => c.args);
    },
  };
  return socket;
}

let mockSocket: MockSocket;

vi.mock("@/lib/socket", () => ({
  getSocket: () => mockSocket,
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/hostTokenStorage", () => ({
  loadHostToken: vi.fn(async () => undefined),
  persistHostToken: vi.fn(async () => {}),
  clearHostToken: vi.fn(async () => {}),
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
    setLocalMediaState = vi.fn();
    constructor() {}
  },
}));

vi.mock("@/lib/mediaPipeline", async () => {
  const actual = await vi.importActual<object>("@/lib/mediaPipeline");
  function makeFakeStream(): MediaStream {
    const stream: Partial<MediaStream> & {
      getAudioTracks: () => MediaStreamTrack[];
      getVideoTracks: () => MediaStreamTrack[];
      getTracks: () => MediaStreamTrack[];
      addEventListener: () => void;
      removeEventListener: () => void;
    } = {
      getAudioTracks: () => [],
      getVideoTracks: () => [],
      getTracks: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    return stream as MediaStream;
  }
  return {
    ...actual,
    buildMediaPipeline: vi.fn(async () => ({
      processedStream: makeFakeStream(),
      rawStream: makeFakeStream(),
      gainNode: {} as GainNode,
      canvas: document.createElement("canvas"),
      analyser: null as unknown as AnalyserNode,
      stop: vi.fn(),
      setVideoStyle: vi.fn(),
      setVoiceMode: vi.fn(),
      enableMonitor: vi.fn(),
      disableMonitor: vi.fn(),
      setWatermark: vi.fn(),
    })),
    createWatermarkedScreenShareTrack: vi.fn(),
  };
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({
  default: () => null,
}));

vi.mock("@/components/RoomShareSheet", () => ({
  default: () => null,
}));

vi.mock("@/components/PaywallModal", () => ({
  default: () => null,
}));

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

const TEST_ROOM = "abcdef0123456789abcdef0123456789";
const TEST_PHRASE = "ability about above absent absorb abstract";
const fakeKey = {} as CryptoKey;

async function joinRoomAsGuest(opts: { hostPresent?: boolean; hostPeerId?: string | null } = {}) {
  const result = render(
    <RoomPage
      roomId={TEST_ROOM}
      e2eKey={fakeKey}
      voidPhrase={TEST_PHRASE}
      fromUrl={false}
    />,
  );

  await vi.waitFor(() => {
    const joinCalls = mockSocket.__getEmit("join-room");
    expect(joinCalls.length).toBeGreaterThan(0);
  });

  const joinCalls = mockSocket.__getEmit("join-room");
  const cb = joinCalls[0][1] as EmitCallback;

  await act(async () => {
    cb({
      success: true,
      peers: [],
      maxUsers: 4,
      isHost: false,
      relayOnly: false,
      screenSharePeerId: null,
      hostPresent: opts.hostPresent !== false,
      hostPeerId: opts.hostPeerId ?? null,
    });
  });

  return result;
}

// Task #594: KNOCK / LOCK moderation toggles moved into the in-call
// overflow ("kebab") menu, so they must be revealed before querying.
async function openOverflow() {
  await act(async () => {
    screen.getByTestId("incall-overflow-button").click();
  });
  await screen.findByTestId("incall-overflow-menu");
}

describe("host-offline indicator — UI", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the HOST OFFLINE pill and disables LOCK + KNOCK when host-changed { hostPresent: false } fires", async () => {
    await joinRoomAsGuest({ hostPresent: true });

    // Sanity: pill is absent before the host goes offline.
    expect(screen.queryByTestId("host-offline-pill")).toBeNull();

    // Simulate server broadcast: host has left.
    await act(async () => {
      mockSocket.__trigger("host-changed", { hostPresent: false, hostPeerId: null });
    });

    // Pill must appear.
    const pill = await screen.findByTestId("host-offline-pill");
    expect(pill).toBeInTheDocument();
    expect(pill.textContent).toMatch(/HOST OFFLINE/i);

    // Reveal the overflow menu that now holds KNOCK / LOCK.
    await openOverflow();

    // KNOCK button must be disabled with the correct tooltip.
    const knockBtn = screen.getByRole("menuitem", { name: /^KNOCK$/i });
    expect(knockBtn).toBeDisabled();
    expect(knockBtn).toHaveAttribute("aria-disabled", "true");
    expect(knockBtn.title).toMatch(/paused until the original host rejoins/i);

    // LOCK button must be disabled with the correct tooltip.
    const lockBtn = screen.getByRole("menuitem", { name: /^LOCK$/i });
    expect(lockBtn).toBeDisabled();
    expect(lockBtn).toHaveAttribute("aria-disabled", "true");
    expect(lockBtn.title).toMatch(/paused until the original host rejoins/i);
  });

  it("shows the host's peer tag to guests on join and updates it live via host-changed", async () => {
    await joinRoomAsGuest({ hostPresent: true, hostPeerId: "peer-original-host" });

    // Tag should appear immediately from the join callback, formatted to
    // match the local "YOU ARE PEER-XYZ" convention (uppercase, "peer-"
    // -> "PEER-").
    const tag = await screen.findByTestId("host-peer-tag");
    expect(tag.textContent).toMatch(/HOST:\s*PEER-ORIGINAL-HOST/i);

    // While the host is present we never show the offline pill.
    expect(screen.queryByTestId("host-offline-pill")).toBeNull();

    // Host disconnects: tag must hide (offline pill takes the slot).
    await act(async () => {
      mockSocket.__trigger("host-changed", { hostPresent: false, hostPeerId: null });
    });
    expect(screen.queryByTestId("host-peer-tag")).toBeNull();
    expect(await screen.findByTestId("host-offline-pill")).toBeInTheDocument();

    // A new host reclaims under a different peer ID — tag returns with
    // the new value, offline pill is gone.
    await act(async () => {
      mockSocket.__trigger("host-changed", { hostPresent: true, hostPeerId: "peer-second-host" });
    });
    const tag2 = await screen.findByTestId("host-peer-tag");
    expect(tag2.textContent).toMatch(/HOST:\s*PEER-SECOND-HOST/i);
    expect(screen.queryByTestId("host-offline-pill")).toBeNull();
  });

  it("clears the HOST OFFLINE pill and re-enables LOCK + KNOCK when host-changed { hostPresent: true } fires", async () => {
    await joinRoomAsGuest({ hostPresent: true });

    // Drive the host offline first.
    await act(async () => {
      mockSocket.__trigger("host-changed", { hostPresent: false, hostPeerId: null });
    });

    // Confirm the offline state is set.
    expect(await screen.findByTestId("host-offline-pill")).toBeInTheDocument();
    // Reveal the overflow menu that now holds KNOCK / LOCK.
    await openOverflow();
    expect(screen.getByRole("menuitem", { name: /^KNOCK$/i })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^LOCK$/i })).toBeDisabled();

    // Host rejoins and reclaims.
    await act(async () => {
      mockSocket.__trigger("host-changed", { hostPresent: true, hostPeerId: "peer-original-host" });
    });

    // Pill must be gone.
    expect(screen.queryByTestId("host-offline-pill")).toBeNull();

    // Buttons must be re-enabled and carry no paused tooltip.
    const knockBtn = screen.getByRole("menuitem", { name: /^KNOCK$/i });
    expect(knockBtn).not.toBeDisabled();
    expect(knockBtn).toHaveAttribute("aria-disabled", "false");
    expect(knockBtn.title).not.toMatch(/paused/i);

    const lockBtn = screen.getByRole("menuitem", { name: /^LOCK$/i });
    expect(lockBtn).not.toBeDisabled();
    expect(lockBtn).toHaveAttribute("aria-disabled", "false");
    expect(lockBtn.title).not.toMatch(/paused/i);
  });
});
