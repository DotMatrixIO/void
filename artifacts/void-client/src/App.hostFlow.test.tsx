// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Regression test for the host-flow race condition:
// When a host clicks "join as host", App.tsx sets pendingRoom with
// {fromUrl:false, isHost:true} then calls replaceState(phraseToHash(...)).
// That replaceState mutates window.location.hash. On the next render, the
// `hashPhrase` derived from window.location.hash becomes non-null and the
// deep-link useEffect would fire, clobbering pendingRoom with
// {fromUrl:true, isHost:false}. The host then lands on PreviewGate as a
// joiner, never calls create-room, and the eventual join-room emit hits
// ROOM_NOT_FOUND → "Room destroyed".
//
// The fix: skip the deep-link derivation if pendingRoom or activeRoom is
// already set. This test mounts App, clicks the host button, clicks
// "enter" on PreviewGate, and asserts the socket emitted "create-room"
// (i.e. the host path actually ran) instead of arriving at RoomPage via
// the joiner path.

const socketStore: {
  emits: Array<{ event: string; data: unknown }>;
  handler: ((event: string, data?: unknown, cb?: (r: unknown) => void) => void) | null;
} = { emits: [], handler: null };

vi.mock("@/lib/socket", () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: (event: string, data?: unknown, cb?: (r: unknown) => void) => {
      socketStore.emits.push({ event, data });
      socketStore.handler?.(event, data, cb);
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: { on: vi.fn(), off: vi.fn() },
  }),
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  playBleep: vi.fn(),
  playBloop: vi.fn(),
  playSelectClick: vi.fn(),
  playSlide: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => null),
  closeAudioContext: vi.fn(async () => {}),
}));

vi.mock("@/lib/hostTokenStorage", () => ({
  persistHostToken: vi.fn(async () => {}),
  loadHostToken: vi.fn(async () => null),
  clearHostToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/voidPhrase", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/voidPhrase",
  );
  return {
    ...actual,
    deriveRoomCredentials: vi.fn(async () => ({
      roomId: "0123456789abcdef0123456789abcdef",
      e2eKey: { type: "stub-key" } as unknown as CryptoKey,
    })),
    generateVoidPhrase: vi.fn(
      () => "alpha bravo charlie delta echo foxtrot",
    ),
  };
});

vi.mock("@/pages/LandingPage", () => ({
  default: ({
    onJoinRoom,
  }: {
    sessionNotice: string | null;
    onJoinRoom: (
      roomId: string,
      e2eKey: CryptoKey,
      voidPhrase: string,
      isHost: boolean,
    ) => void;
  }) => (
    <button
      data-testid="start-join-host"
      onClick={() =>
        onJoinRoom(
          "0123456789abcdef0123456789abcdef",
          { type: "stub-key" } as unknown as CryptoKey,
          "alpha bravo charlie delta echo foxtrot",
          true,
        )
      }
    >
      join as host
    </button>
  ),
}));

vi.mock("@/pages/StartScreen", () => ({ default: () => null }));
vi.mock("@/components/SplashScreen", () => ({
  default: () => null,
  shouldShowSplash: () => false,
  markSplashSeen: () => {},
  SPLASH_SEEN_KEY: "void:splash-seen",
}));

vi.mock("@/pages/PreviewGate", () => ({
  default: ({
    onEnter,
    showRelayToggle,
  }: {
    onEnter: (opts: {
      audioDeviceId?: string;
      videoStyle: number;
      voiceMode: number;
      relayOnly: boolean;
    }) => void;
    onCancel: () => void;
    voidPhrase: string;
    showRelayToggle: boolean;
  }) => (
    <>
      <div data-testid="preview-is-host">{showRelayToggle ? "yes" : "no"}</div>
      <button
        data-testid="preview-enter"
        onClick={() => onEnter({ relayOnly: false, videoStyle: 0, voiceMode: 0 })}
      >
        enter
      </button>
    </>
  ),
}));

vi.mock("@/pages/RoomPage", () => ({
  default: ({ fromUrl }: { fromUrl: boolean }) => (
    <div data-testid="room-page" data-fromurl={String(fromUrl)}>
      room
    </div>
  ),
}));

vi.mock("@/pages/not-found", () => ({ default: () => <div>404</div> }));
vi.mock("@/pages/WhyPage", () => ({ default: () => null }));
vi.mock("@/pages/ComparePage", () => ({ default: () => null }));
vi.mock("@/pages/ThreatModelPage", () => ({ default: () => null }));
vi.mock("@/pages/AuditPage", () => ({ default: () => null }));
vi.mock("@/pages/ServerStateProofPage", () => ({ default: () => null }));
vi.mock("@/pages/BiometricPage", () => ({ default: () => null }));
vi.mock("@/pages/StillPoster", () => ({ default: () => null }));

import App from "./App";

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: () => ({
        matches: false,
        media: "",
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
});

describe("App host flow — replaceState must not clobber pendingRoom (regression)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem("void_token", "test-payment-token");
    socketStore.emits = [];
    socketStore.handler = (event, _data, cb) => {
      if (event === "create-room" && typeof cb === "function") {
        cb({ success: true });
      }
    };
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("preserves isHost=true on PreviewGate even after replaceState repopulates window.location.hash", async () => {
    render(<App />);

    await waitFor(() => screen.getByTestId("start-join-host"));
    await userEvent.click(screen.getByTestId("start-join-host"));

    // PreviewGate must see the host's pendingRoom (showRelayToggle=true).
    // If the deep-link useEffect clobbers pendingRoom, this flips to "no".
    await waitFor(() => screen.getByTestId("preview-enter"));
    await waitFor(() =>
      expect(screen.getByTestId("preview-is-host").textContent).toBe("yes"),
    );
  });

  it("emits create-room (not join-room) and lands on RoomPage with fromUrl=false", async () => {
    render(<App />);

    await waitFor(() => screen.getByTestId("start-join-host"));
    await userEvent.click(screen.getByTestId("start-join-host"));

    await waitFor(() => screen.getByTestId("preview-enter"));
    await userEvent.click(screen.getByTestId("preview-enter"));

    const room = await screen.findByTestId("room-page");
    expect(room.getAttribute("data-fromurl")).toBe("false");

    const createEmits = socketStore.emits.filter((e) => e.event === "create-room");
    expect(createEmits.length).toBeGreaterThan(0);
  });
});
