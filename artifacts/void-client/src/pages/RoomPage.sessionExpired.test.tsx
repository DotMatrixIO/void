// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #336: the SESSION EXPIRED teardown (room paid window runs out)
// must have the same partial-failure resilience as BURN. A thrown
// track.stop() or a crashed pipeline can no longer leave the camera /
// mic live with the OS recording dot still on, and the ROOM ENDED
// overlay surfaces a short, user-visible reason when a step fails —
// mirroring the BURN reason line.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

type SocketHandler = (...args: unknown[]) => void;
type EmitCallback = (result: unknown) => void;

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
  __getEmit: (event: string) => unknown[][];
  __getHandler: (event: string) => SocketHandler | undefined;
}

function createMockSocket(): MockSocket {
  const handlers: Record<string, SocketHandler[]> = {};
  const emitCalls: Array<{ event: string; args: unknown[] }> = [];
  return {
    on: vi.fn((event: string, h: SocketHandler) => {
      (handlers[event] ??= []).push(h);
    }),
    off: vi.fn(),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      emitCalls.push({ event, args });
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
    __getEmit: (event: string) =>
      emitCalls.filter((c) => c.event === event).map((c) => c.args),
    __getHandler: (event: string) => handlers[event]?.[0],
  };
}

let mockSocket: MockSocket;
const pipelineStop = vi.fn();

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
    constructor(_: unknown) {}
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
      stop: pipelineStop,
      setVideoStyle: vi.fn(),
      setVoiceMode: vi.fn(),
      enableMonitor: vi.fn(),
      disableMonitor: vi.fn(),
      setWatermark: vi.fn(),
    })),
    createWatermarkedScreenShareTrack: vi.fn(),
  };
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({ default: () => null }));
vi.mock("@/components/RoomShareSheet", () => ({ default: () => null }));
vi.mock("@/components/PaywallModal", () => ({ default: () => null }));

const { drainObjectUrlRegistryMock } = vi.hoisted(() => ({
  drainObjectUrlRegistryMock: vi.fn(() => 0),
}));
vi.mock("@/lib/objectUrlRegistry", () => ({
  registerObjectUrl: (u: string) => u,
  unregisterObjectUrl: () => {},
  drainObjectUrlRegistry: drainObjectUrlRegistryMock,
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

import RoomPage from "./RoomPage";
import { buildMediaPipeline } from "@/lib/mediaPipeline";

const TEST_ROOM = "abcdef0123456789abcdef0123456789";
const TEST_PHRASE = "ability about above absent absorb abstract";
const fakeKey = {} as CryptoKey;

async function joinAsHost() {
  render(
    <RoomPage
      roomId={TEST_ROOM}
      e2eKey={fakeKey}
      voidPhrase={TEST_PHRASE}
      fromUrl={false}
    />,
  );

  await vi.waitFor(() => {
    expect(mockSocket.__getEmit("join-room").length).toBeGreaterThan(0);
  });

  const cb = mockSocket.__getEmit("join-room")[0][1] as EmitCallback;
  await act(async () => {
    cb({
      success: true,
      peers: [],
      maxUsers: 4,
      isHost: true,
      relayOnly: false,
      screenSharePeerId: null,
    });
  });
}

function pipelineWithTracks(tracks: MediaStreamTrack[]) {
  const stream = {
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getTracks: () => tracks,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as MediaStream;
  (buildMediaPipeline as unknown as {
    mockImplementationOnce: (fn: () => unknown) => void;
  }).mockImplementationOnce(async () => ({
    processedStream: stream,
    rawStream: stream,
    gainNode: {} as GainNode,
    canvas: document.createElement("canvas"),
    analyser: null as unknown as AnalyserNode,
    stop: pipelineStop,
    setVideoStyle: vi.fn(),
    setVoiceMode: vi.fn(),
    enableMonitor: vi.fn(),
    disableMonitor: vi.fn(),
    setWatermark: vi.fn(),
  }));
}

async function expireSession() {
  const handler = mockSocket.__getHandler("room-expired");
  expect(handler).toBeDefined();
  await act(async () => {
    handler!();
  });
}

describe("SESSION EXPIRED releases all local media (Task #336)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    pipelineStop.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes pipeline.stop() and emits leave-room on expiry", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    await expireSession();

    expect(pipelineStop).toHaveBeenCalled();
    expect(mockSocket.__getEmit("leave-room").length).toBeGreaterThan(0);
    // ROOM ENDED overlay is shown.
    expect(
      document.querySelector('[data-testid="session-ended-overlay"]'),
    ).not.toBeNull();
  });

  it("clean expiry shows NO reason line", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    await expireSession();

    expect(
      document.querySelector('[data-testid="session-ended-overlay"]'),
    ).not.toBeNull();
    // A clean teardown must not surface a failure reason.
    expect(
      document.querySelector('[data-testid="session-ended-overlay-reason"]'),
    ).toBeNull();
  });

  it("still stops every other local-stream track when one track.stop() throws", async () => {
    // Privacy guarantee: a single failing track must not abort the
    // rest of the expiry cleanup. Otherwise a thrown stop() (revoked
    // OS permission, crashed device handle) could leave the mic or
    // camera live with the OS recording dot still on.
    const goodTrackA = {
      stop: vi.fn(),
      kind: "video",
      readyState: "live",
      onended: null,
    } as unknown as MediaStreamTrack;
    const badTrack = {
      stop: vi.fn(() => {
        throw new Error("device handle revoked");
      }),
      kind: "audio",
      readyState: "live",
      onended: null,
    } as unknown as MediaStreamTrack;
    const goodTrackB = {
      stop: vi.fn(),
      kind: "video",
      readyState: "live",
      onended: null,
    } as unknown as MediaStreamTrack;

    pipelineWithTracks([goodTrackA, badTrack, goodTrackB]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    await expireSession();

    // Every track was attempted, including the ones after the throw.
    expect(goodTrackA.stop).toHaveBeenCalled();
    expect(badTrack.stop).toHaveBeenCalled();
    expect(goodTrackB.stop).toHaveBeenCalled();
    // leave-room is still emitted after the partial failure.
    expect(mockSocket.__getEmit("leave-room").length).toBeGreaterThan(0);
    // And the user sees a reason — not a silent partial cleanup.
    expect(
      document.querySelector('[data-testid="session-ended-overlay-reason"]'),
    ).not.toBeNull();

    errSpy.mockRestore();
  });

  it("surfaces a user-visible reason on the ROOM ENDED screen when a step fails", async () => {
    // The user must SEE that the expiry teardown was not perfectly
    // clean. A silent ROOM ENDED screen after a partial failure is
    // worse than the failure itself.
    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    pipelineStop.mockImplementation(() => {
      throw new Error("WebGL pipeline crashed mid-frame");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expireSession();

    const reason = document.querySelector(
      '[data-testid="session-ended-overlay-reason"]',
    );
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toMatch(/media pipeline/i);
    expect(reason!.textContent).toMatch(/close this tab/i);

    errSpy.mockRestore();
  });

  it("expiry teardown is idempotent — a second room-expired is a no-op", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    await expireSession();
    // A second room-expired (server retry, or a race with the
    // countdown reaching zero) must NOT re-run cleanup.
    await expireSession();

    expect(pipelineStop).toHaveBeenCalledTimes(1);
    expect(mockSocket.__getEmit("leave-room").length).toBe(1);
  });

  it("pipeline.stop throwing does not block leave-room or the ROOM ENDED screen", async () => {
    // Models the WebGL compositor being mid-frame when the room
    // expires. The pipeline's stop() throws, but the rest of the
    // teardown — including the leave-room emit and the overlay swap —
    // must still complete.
    await joinAsHost();
    await vi.waitFor(() => {
      expect(
        (buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBeGreaterThan(0);
    });

    pipelineStop.mockImplementation(() => {
      throw new Error("frame in flight: cannot stop GL context");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expireSession();

    expect(pipelineStop).toHaveBeenCalled();
    expect(mockSocket.__getEmit("leave-room").length).toBeGreaterThan(0);
    expect(
      document.querySelector('[data-testid="session-ended-overlay"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="session-ended-overlay-reason"]'),
    ).not.toBeNull();

    errSpy.mockRestore();
  });
});
