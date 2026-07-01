// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Regression tests for Task #181 / Task #228:
// When the server returns TOKEN_ALREADY_USED on an extend-room attempt, the
// client must surface the plain-language
// "THIS PAYMENT WAS ALREADY USED — PAY AGAIN TO EXTEND" notice instead of
// leaking the raw wire code "COULDN'T EXTEND: TOKEN_ALREADY_USED". Nothing
// else in the test suite asserts this mapping, so this file locks it in as
// an explicit regression gate.

type SocketHandler = (...args: unknown[]) => void;
type EmitCallback = (result: unknown) => void;

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
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
    io: { on: vi.fn(), off: vi.fn() },
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

// Captured PaywallModal onSuccess reference so tests can call it directly.
let capturedOnSuccess: ((token: string) => void) | null = null;

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

// PaywallModal mock: captures `onSuccess` and renders a "Trigger payment"
// button so tests can invoke handleExtendPaid without needing Stripe.
vi.mock("@/components/PaywallModal", () => ({
  default: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: (token: string) => void;
    onClose: () => void;
  }) => {
    capturedOnSuccess = onSuccess;
    return (
      <div data-testid="mock-paywall-modal">
        <button
          data-testid="mock-paywall-trigger"
          onClick={() => onSuccess("test-payment-token")}
        >
          pay
        </button>
        <button data-testid="mock-paywall-close" onClick={onClose}>
          close
        </button>
      </div>
    );
  },
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

const TEST_ROOM = "abcdef0123456789abcdef0123456789";
const TEST_PHRASE = "ability about above absent absorb abstract";
const fakeKey = {} as CryptoKey;

// Joins the room as a host with near-expiry time so the "WRAP IT UP OR
// EXTEND" toast fires and the EXTEND button is rendered.
async function joinAsHostNearExpiry() {
  const now = Date.now();
  const remainingMs = 8 * 60_000; // 8 min — inside the STANDARD 10-min lead

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
      tier: "standard",
      expiresAt: now + remainingMs,
      serverNow: now,
    });
  });
}

// Configures the mock socket so the next extend-room emit calls its callback
// with the given result.
function stubExtendRoom(result: { success: boolean; error?: string }) {
  const original = mockSocket.emit.getMockImplementation();
  mockSocket.emit.mockImplementation(
    (event: string, ...args: unknown[]) => {
      if (event === "extend-room") {
        const cb = args[args.length - 1] as EmitCallback | undefined;
        if (typeof cb === "function") {
          cb(result);
          return;
        }
      }
      if (original) {
        (original as (event: string, ...args: unknown[]) => void)(
          event,
          ...args,
        );
      }
    },
  );
}

describe("RoomPage extend-room TOKEN_ALREADY_USED message (#181 / #228)", () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    capturedOnSuccess = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows 'THIS PAYMENT WAS ALREADY USED — PAY AGAIN TO EXTEND' when extend-room returns TOKEN_ALREADY_USED", async () => {
    await joinAsHostNearExpiry();

    // The expiry toast must be visible with the EXTEND button.
    const extendBtn = await screen.findByTestId("expiry-warning-extend");
    expect(extendBtn).toBeInTheDocument();

    // Configure the socket so extend-room calls back with TOKEN_ALREADY_USED.
    stubExtendRoom({ success: false, error: "TOKEN_ALREADY_USED" });

    const user = userEvent.setup();

    // Click EXTEND → opens PaywallModal (setExtendModalOpen(true)).
    await user.click(extendBtn);

    // The PaywallModal mock should now be rendered.
    await screen.findByTestId("mock-paywall-modal");

    // Click "pay" to call onSuccess("test-payment-token") → handleExtendPaid.
    await user.click(screen.getByTestId("mock-paywall-trigger"));

    // handleExtendPaid calls socket.emit("extend-room", ...) → callback
    // returns TOKEN_ALREADY_USED → flashExtendNotice fires.
    const notice = await screen.findByTestId("extend-notice");
    expect(notice.textContent).toContain(
      "THIS PAYMENT WAS ALREADY USED — PAY AGAIN TO EXTEND",
    );
  });

  it("does NOT show the raw wire code 'COULDN'T EXTEND: TOKEN_ALREADY_USED' when the server returns TOKEN_ALREADY_USED", async () => {
    await joinAsHostNearExpiry();

    const extendBtn = await screen.findByTestId("expiry-warning-extend");
    stubExtendRoom({ success: false, error: "TOKEN_ALREADY_USED" });

    const user = userEvent.setup();
    await user.click(extendBtn);
    await screen.findByTestId("mock-paywall-modal");
    await user.click(screen.getByTestId("mock-paywall-trigger"));

    const notice = await screen.findByTestId("extend-notice");

    // The raw wire code must never be shown — it leaks implementation detail
    // and gives no signal that the host's payment was actually real.
    expect(notice.textContent).not.toContain("COULDN’T EXTEND: TOKEN_ALREADY_USED");
    expect(notice.textContent).not.toContain("TOKEN_ALREADY_USED");
  });

  it("still shows the generic error for non-TOKEN_ALREADY_USED failures (e.g. ROOM_EXPIRED)", async () => {
    await joinAsHostNearExpiry();

    const extendBtn = await screen.findByTestId("expiry-warning-extend");
    stubExtendRoom({ success: false, error: "ROOM_EXPIRED" });

    const user = userEvent.setup();
    await user.click(extendBtn);
    await screen.findByTestId("mock-paywall-modal");
    await user.click(screen.getByTestId("mock-paywall-trigger"));

    const notice = await screen.findByTestId("extend-notice");
    expect(notice.textContent).toContain("COULDN’T EXTEND: ROOM_EXPIRED");
    expect(notice.textContent).not.toContain("THIS PAYMENT WAS ALREADY USED");
  });
});
