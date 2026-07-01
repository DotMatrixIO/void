// SPDX-License-Identifier: AGPL-3.0-or-later
import { vi, expect } from "vitest";
import { act, render } from "@testing-library/react";

export type SocketHandler = (...args: unknown[]) => void;
export type EmitCallback = (result: unknown) => void;

export interface MockSocket {
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

export function createMockSocket(): MockSocket {
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

export interface CapturedManager {
  opts: {
    onUpdate: (streams: Record<string, MediaStream | null>) => void;
    onConnectionStateUpdate: (s: Record<string, RTCPeerConnectionState>) => void;
    onSASUpdate: (s: Record<string, [string, string]>) => void;
    onCryptoMismatch: (m: Record<string, boolean>) => void;
    onSecureChannelFailure?: (
      f: Record<string, "ecdhe_failed" | "hello_invalid" | "decrypt_failed" | "ice_restart_failed">,
    ) => void;
    onRekey?: (peerId: string, keyFingerprint: string) => void;
    onMediaStateReceived?: (
      peerId: string,
      state: { camOff: boolean; micMuted: boolean; voiceMode?: number; viaOnion?: boolean },
    ) => void;
  };
  initiateOffer: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  removePeer: ReturnType<typeof vi.fn>;
  replaceVideoTrack: ReturnType<typeof vi.fn>;
  clearVideoOverride: ReturnType<typeof vi.fn>;
  setLocalMediaState: ReturnType<typeof vi.fn>;
}

/**
 * Shared mutable state for the RoomPage test mocks. The `vi.mock`
 * factories in each test file close over these via lazy references
 * (inside getters / class constructors), so re-assigning
 * `roomTestState.mockSocket` between tests propagates automatically.
 */
export const roomTestState: {
  mockSocket: MockSocket;
  captured: { manager: CapturedManager | null };
} = {
  mockSocket: createMockSocket(),
  captured: { manager: null },
};

export function resetRoomTestState() {
  roomTestState.mockSocket = createMockSocket();
  roomTestState.captured.manager = null;
}

export class MockWebRTCManager {
  initiateOffer = vi.fn();
  destroy = vi.fn();
  removePeer = vi.fn();
  replaceVideoTrack = vi.fn();
  clearVideoOverride = vi.fn();
  setLocalMediaState = vi.fn();
  constructor(opts: CapturedManager["opts"]) {
    roomTestState.captured.manager = {
      opts,
      initiateOffer: this.initiateOffer,
      destroy: this.destroy,
      removePeer: this.removePeer,
      replaceVideoTrack: this.replaceVideoTrack,
      clearVideoOverride: this.clearVideoOverride,
      setLocalMediaState: this.setLocalMediaState,
    };
  }
}

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

/**
 * Async factory used inside `vi.mock("@/lib/mediaPipeline", ...)` so
 * the buildMediaPipeline stub stays in sync across test files without
 * duplication.
 */
export async function makeMediaPipelineMock() {
  const actual = await vi.importActual<object>("@/lib/mediaPipeline");
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
}

// jsdom polyfills — applied at module import so any test file that
// imports these helpers picks them up.
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

export const TEST_ROOM = "abcdef0123456789abcdef0123456789";
export const TEST_PHRASE = "ability about above absent absorb abstract";
export const fakeKey = {} as CryptoKey;

export async function joinRoom(opts: {
  peers?: string[];
  isHost?: boolean;
  relayOnly?: boolean;
  joinError?: string;
} = {}) {
  const peers = opts.peers ?? [];
  const { default: RoomPage } = await import("./RoomPage");
  const result = render(
    <RoomPage
      roomId={TEST_ROOM}
      e2eKey={fakeKey}
      voidPhrase={TEST_PHRASE}
      fromUrl={false}
    />,
  );

  await vi.waitFor(() => {
    const joinCalls = roomTestState.mockSocket.__getEmit("join-room");
    expect(joinCalls.length).toBeGreaterThan(0);
  });

  const joinCalls = roomTestState.mockSocket.__getEmit("join-room");
  const cb = joinCalls[0][1] as EmitCallback;

  await act(async () => {
    if (opts.joinError) {
      cb({
        success: false,
        error: opts.joinError,
        peers: [],
      });
    } else {
      cb({
        success: true,
        peers,
        maxUsers: 4,
        isHost: opts.isHost ?? false,
        relayOnly: opts.relayOnly ?? false,
        screenSharePeerId: null,
      });
    }
  });

  return result;
}
