// SPDX-License-Identifier: AGPL-3.0-or-later
// BURN releases every local media track. The pipeline owns
// camera+mic via a single stop(); pending and active screen
// share are released by stopPendingShare / stopShareCleanup
// (covered directly in burnTeardown.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

// Task #398: BURN drains the object-URL registry. We mock it so we
// can assert it was called even though the in-room media pipeline
// (in this test) does not actually allocate any blob URLs.
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

describe("BURN releases all local media", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    pipelineStop.mockReset();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("mock-no-network"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("invokes mediaPipeline.stop() and emits destroy-room when host BURNs", async () => {
    await joinAsHost();

    // Wait until the pipeline has been built (camera+mic captured).
    // Without this, we'd race the BURN click against the async setup.
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    // The BURN button is found by visible text.
    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();

    const user = userEvent.setup();
    await user.click(burn!);

    // BURN runs locally on click; destroy-room is fire-and-forget.
    const destroyCalls = mockSocket.__getEmit("destroy-room");
    expect(destroyCalls.length).toBeGreaterThan(0);

    // pipeline.stop() owns BOTH the rawStream and processedStream
    // teardown — calling it once releases the camera, the microphone,
    // and the WebGL compositor in one shot. That is the single
    // convergence point for the OS recording indicator.
    expect(pipelineStop).toHaveBeenCalled();
  });

  it("invokes pipeline.stop() so its tracks are released on BURN", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const captureTrack = { stop: vi.fn(), kind: "video", readyState: "live", onended: null } as unknown as MediaStreamTrack;
    pipelineStop.mockImplementation(() => { captureTrack.stop(); });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    expect(pipelineStop).toHaveBeenCalled();
    expect(captureTrack.stop).toHaveBeenCalled();
  });

  it("releases local capture even when destroy-room ack never arrives", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    expect(mockSocket.__getEmit("destroy-room").length).toBeGreaterThan(0);
    expect(pipelineStop).toHaveBeenCalled();
  });

  it("still stops every other local-stream track when one track.stop() throws", async () => {
    // Privacy guarantee: a single failing track must not abort the
    // rest of the BURN cleanup. Otherwise a thrown stop() (revoked
    // OS permission, crashed device handle) could leave the mic or
    // camera live with the OS recording dot still on.
    const goodTrackA = { stop: vi.fn(), kind: "video", readyState: "live", onended: null } as unknown as MediaStreamTrack;
    const badTrack = {
      stop: vi.fn(() => { throw new Error("device handle revoked"); }),
      kind: "audio",
      readyState: "live",
      onended: null,
    } as unknown as MediaStreamTrack;
    const goodTrackB = { stop: vi.fn(), kind: "video", readyState: "live", onended: null } as unknown as MediaStreamTrack;

    // Inject the failing-track set into the processedStream that
    // becomes RoomPage's localStreamRef — the per-track stop loop
    // is what we're exercising here, not the pipeline.stop() path.
    const processedTracks = [goodTrackA, badTrack, goodTrackB];
    const stream = {
      getAudioTracks: () => processedTracks.filter((t) => t.kind === "audio"),
      getVideoTracks: () => processedTracks.filter((t) => t.kind === "video"),
      getTracks: () => processedTracks,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaStream;
    (buildMediaPipeline as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(async () => ({
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
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    // Every track was attempted, including the ones after the throw.
    expect(goodTrackA.stop).toHaveBeenCalled();
    expect(badTrack.stop).toHaveBeenCalled();
    expect(goodTrackB.stop).toHaveBeenCalled();
    // destroy-room is still emitted after the partial failure.
    expect(mockSocket.__getEmit("destroy-room").length).toBeGreaterThan(0);
    // And the user sees a reason — not a silent partial cleanup.
    expect(document.querySelector('[data-testid="burned-overlay-reason"]')).not.toBeNull();

    errSpy.mockRestore();
  });

  it("surfaces a user-visible reason on the BURN screen when a step fails", async () => {
    // The user must SEE that BURN was not perfectly clean. A silent
    // success screen after a partial failure is worse than the
    // failure itself.
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    pipelineStop.mockImplementation(() => {
      throw new Error("WebGL pipeline crashed mid-frame");
    });
    // Silence the expected console.error from the BURN failure path.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    const reason = document.querySelector('[data-testid="burned-overlay-reason"]');
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toMatch(/media pipeline/i);
    expect(reason!.textContent).toMatch(/close this tab/i);

    errSpy.mockRestore();
  });

  it("BURN is idempotent — a second click does not re-run cleanup", async () => {
    // performLocalBurn is reachable from three call sites (host BURN
    // click, remote room-destroyed, post-ack leave-room). They CAN
    // race. The sessionEndedRef guard means only the first call does
    // any work; the rest are no-ops.
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    // After the first BURN, the remote room-destroyed handler can
    // still fire (server confirming what we already did locally).
    // It must NOT re-enter performLocalBurn.
    const handler = mockSocket.on.mock.calls.find(
      (c: unknown[]) => c[0] === "room-destroyed",
    )?.[1] as SocketHandler | undefined;
    expect(handler).toBeDefined();
    await act(async () => { handler!(); });

    expect(pipelineStop).toHaveBeenCalledTimes(1);
    expect(mockSocket.__getEmit("destroy-room").length).toBe(1);
  });

  it("BURN-during-pipeline-frame: pipeline.stop throwing does not block destroy-room or local cleanup", async () => {
    // Models the WebGL compositor being mid-frame when BURN fires.
    // The pipeline's stop() rejects, but the rest of the teardown —
    // including the destroy-room emit and the BURN screen swap —
    // must still complete.
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    pipelineStop.mockImplementation(() => {
      throw new Error("frame in flight: cannot stop GL context");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    expect(pipelineStop).toHaveBeenCalled();
    expect(mockSocket.__getEmit("destroy-room").length).toBeGreaterThan(0);
    // BURN screen is rendered (with the failure reason) — not a
    // half-torn-down room.
    expect(document.querySelector('[data-testid="burned-overlay"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="burned-overlay-reason"]')).not.toBeNull();

    errSpy.mockRestore();
  });

  // ─── Task #398: BURN actually burns ────────────────────────────────────
  it("clears the URL hash, wipes VOID sessionStorage, deletes VOID caches, and drains the object-URL registry", async () => {
    // Seed the residue that BURN must remove. Each entry corresponds
    // to a real call site (PaywallModal/StartScreen for void_token,
    // StartScreen for the tor-wallet prompt, lastSeenGrantNonceStorage
    // for the dedupe key, hostTokenStorage for the encrypted JWT).
    sessionStorage.setItem("void_token", "test-jwt");
    sessionStorage.setItem("void:tor-wallet-prompt-dismissed", "1");
    sessionStorage.setItem("void.lsgn.abc:peer1", "0");
    sessionStorage.setItem("void.hk.deadbeef", "encrypted-blob");
    // Neighbor artifact's key — must NOT be wiped.
    sessionStorage.setItem("unrelated-app:setting", "keep-me");

    // Task #407: VOID-owned localStorage keys must also be wiped on BURN.
    // The new UI-sounds toggle and the existing music toggle both live
    // under the `2bit_` namespace. A neighbor artifact's localStorage
    // entry under a different prefix must be preserved — same scoping
    // discipline as sessionStorage above.
    localStorage.setItem("2bit_ui_sounds_enabled", "1");
    localStorage.setItem("2bit_music_enabled", "1");
    localStorage.setItem("unrelated-app:theme", "keep-me");

    // Stub the URL hash so we can assert the burn clears it. We set
    // it directly on `location` because RoomPage's BurnedOverlay
    // onDismiss does a `location.replace(BASE_URL)` — which in jsdom
    // resets the hash.
    window.location.hash = "#abandon-ability-able-about-above-absent";

    const cachesKeys = vi.fn(async () => ["2bit-v1", "third-party-cache"]);
    const cachesDelete = vi.fn(async () => true);
    vi.stubGlobal("caches", { keys: cachesKeys, delete: cachesDelete });

    drainObjectUrlRegistryMock.mockClear();

    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();
    const user = userEvent.setup();
    await user.click(burn!);

    // sessionStorage: every VOID-namespaced entry is gone, neighbor
    // artifact's entry is preserved.
    expect(sessionStorage.getItem("void_token")).toBeNull();
    expect(sessionStorage.getItem("void:tor-wallet-prompt-dismissed")).toBeNull();
    expect(sessionStorage.getItem("void.lsgn.abc:peer1")).toBeNull();
    expect(sessionStorage.getItem("void.hk.deadbeef")).toBeNull();
    expect(sessionStorage.getItem("unrelated-app:setting")).toBe("keep-me");

    // Task #407: VOID-owned localStorage entries are gone, neighbor
    // artifact's localStorage entry is preserved.
    expect(localStorage.getItem("2bit_ui_sounds_enabled")).toBeNull();
    expect(localStorage.getItem("2bit_music_enabled")).toBeNull();
    expect(localStorage.getItem("unrelated-app:theme")).toBe("keep-me");

    // Object-URL registry was drained.
    expect(drainObjectUrlRegistryMock).toHaveBeenCalled();

    // Runtime caches: VOID-owned entry deleted, unrelated cache
    // left alone. caches.delete is fire-and-forget so wait for it.
    await vi.waitFor(() => {
      expect(cachesKeys).toHaveBeenCalled();
      expect(cachesDelete).toHaveBeenCalledWith("2bit-v1");
    });
    expect(cachesDelete).not.toHaveBeenCalledWith("third-party-cache");

    // URL hash: the BurnedOverlay auto-dismiss drives location.replace,
    // but we don't wait the full 3 s here. Instead we drive the
    // dismiss directly via the ESC key, which is the same code path.
    fireEvent.keyDown(document, { key: "Escape" });
    await vi.waitFor(() => {
      expect(window.location.hash).toBe("");
    });
  });

  it("a JOINER's BURN emits burn-room (NOT leave-room) so the room is destroyed for everyone (Task #696)", async () => {
    // Regression for the security bug: a joiner's BURN used to emit only
    // `leave-room`, which left the room + phrase live server-side. It
    // must now emit `burn-room` so the server destroys the room for all
    // participants.
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

    // Join as a NON-host (the bug only manifests for joiners).
    const cb = mockSocket.__getEmit("join-room")[0][1] as EmitCallback;
    await act(async () => {
      cb({
        success: true,
        peers: [],
        maxUsers: 4,
        isHost: false,
        relayOnly: false,
        screenSharePeerId: null,
      });
    });

    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const allButtons = Array.from(document.body.querySelectorAll("button"));
    const burn = allButtons.find((b) => /BURN/.test(b.textContent ?? ""));
    expect(burn).toBeDefined();

    const user = userEvent.setup();
    await user.click(burn!);

    // The fix: a joiner BURN destroys the room via burn-room.
    expect(mockSocket.__getEmit("burn-room").length).toBeGreaterThan(0);
    // And it does NOT silently fall back to a plain leave-room (which is
    // exactly the bug — leaving the room alive).
    expect(mockSocket.__getEmit("leave-room").length).toBe(0);
    expect(pipelineStop).toHaveBeenCalled();
  });

  it("remote room-destroyed routes through performLocalBurn", async () => {
    await joinAsHost();
    await vi.waitFor(() => {
      expect((buildMediaPipeline as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
    });

    const captureTrack = { stop: vi.fn(), kind: "video", readyState: "live", onended: null } as unknown as MediaStreamTrack;
    pipelineStop.mockImplementation(() => { captureTrack.stop(); });

    const handler = mockSocket.on.mock.calls.find(
      (c: unknown[]) => c[0] === "room-destroyed",
    )?.[1] as SocketHandler | undefined;
    expect(handler).toBeDefined();
    await act(async () => { handler!(); });

    expect(pipelineStop).toHaveBeenCalled();
    expect(captureTrack.stop).toHaveBeenCalled();
  });
});
