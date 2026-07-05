// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #926: a paid *extend* leaks the host's IP to the payment server from a
// clearnet wallet exactly like the original paid create (Task #345) does. On a
// .onion origin a successful top-up must re-raise the same one-time,
// dismissible Lightning IP-linkage reminder. On clearnet it must never appear.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
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

vi.mock("@/lib/uiSounds", () => ({
  uiBleep: vi.fn(),
  uiBloop: vi.fn(),
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
  uiSlide: vi.fn(),
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

vi.mock("@/components/RecordingDisclosureBanner", () => ({ default: () => null }));
vi.mock("@/components/RoomShareSheet", () => ({ default: () => null }));

// PaywallModal mock: renders a "pay" button so tests can drive the extend
// success path (onSuccess → handleExtendPaid) without needing Stripe.
vi.mock("@/components/PaywallModal", () => ({
  default: ({
    onSuccess,
    onClose,
  }: {
    onSuccess: (token: string) => void;
    onClose: () => void;
  }) => (
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
  ),
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

const ONION_HOST =
  "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";
const CLEARNET_HOST = "void.example.com";
const ORIGINAL_LOCATION = window.location;

function setHostname(hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...ORIGINAL_LOCATION,
      hostname,
      protocol: "https:",
      href: `https://${hostname}/`,
    },
  });
}

// Joins the room as a host near expiry so the "WRAP IT UP OR EXTEND" toast
// fires and the EXTEND button is rendered.
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
// with a successful new window.
function stubExtendRoomSuccess() {
  const original = mockSocket.emit.getMockImplementation();
  mockSocket.emit.mockImplementation((event: string, ...args: unknown[]) => {
    if (event === "extend-room") {
      const cb = args[args.length - 1] as EmitCallback | undefined;
      if (typeof cb === "function") {
        const now = Date.now();
        cb({
          success: true,
          expiresAt: now + 60 * 60_000,
          serverNow: now,
          tier: "standard",
        });
        return;
      }
    }
    if (original) {
      (original as (event: string, ...args: unknown[]) => void)(event, ...args);
    }
  });
}

async function payToExtend() {
  const user = userEvent.setup();
  const extendBtn = await screen.findByTestId("expiry-warning-extend");
  await user.click(extendBtn);
  await screen.findByTestId("mock-paywall-modal");
  await user.click(screen.getByTestId("mock-paywall-trigger"));
}

beforeEach(() => {
  mockSocket = createMockSocket();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ iceServers: [] }) })),
  );
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Task #926 — Lightning IP-linkage reminder on paid extend", () => {
  it("renders the reminder after a successful paid extend over a .onion origin", async () => {
    setHostname(ONION_HOST);
    await joinAsHostNearExpiry();
    stubExtendRoomSuccess();

    await payToExtend();

    const note = await screen.findByTestId("lightning-ip-leak-notice");
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/Tor-routed wallet/i);
  });

  it("does NOT render the reminder after a paid extend on a clearnet origin", async () => {
    setHostname(CLEARNET_HOST);
    await joinAsHostNearExpiry();
    stubExtendRoomSuccess();

    await payToExtend();

    // The success toast confirms the extend ran end-to-end.
    const notice = await screen.findByTestId("extend-notice");
    expect(notice.textContent).toContain("ROOM EXTENDED");
    expect(screen.queryByTestId("lightning-ip-leak-notice")).toBeNull();
  });

  it("is dismissible after a paid extend over a .onion origin", async () => {
    setHostname(ONION_HOST);
    await joinAsHostNearExpiry();
    stubExtendRoomSuccess();

    await payToExtend();

    const note = await screen.findByTestId("lightning-ip-leak-notice");
    expect(note).toBeInTheDocument();

    const dismiss = screen.getByRole("button", {
      name: /dismiss lightning ip reminder/i,
    });
    await act(async () => {
      await userEvent.click(dismiss);
    });

    await waitFor(() =>
      expect(screen.queryByTestId("lightning-ip-leak-notice")).toBeNull(),
    );
  });
});
