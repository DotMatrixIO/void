// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Regression tests for Task #181 / Task #228:
// When the server returns TOKEN_ALREADY_USED on a create-room attempt, the
// client must surface the plain-language "ONE PAYMENT, ONE ROOM — PAY AGAIN
// FOR A NEW ONE" notice instead of silently falling through to the misleading
// "PAYMENT REQUIRED" fallback. Nothing else in the test suite asserts this
// mapping, so this file locks it in as an explicit regression gate.

// Shared object the mock factory closes over. The factory is hoisted but the
// reference is shared, so tests can reconfigure `emit` in beforeEach without
// recreating the mock.
const socketStore: {
  emit: (event: string, data?: unknown, cb?: (r: unknown) => void) => void;
} = {
  emit: () => {},
};

vi.mock("@/lib/socket", () => ({
  getSocket: () => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: (...args: unknown[]) =>
      socketStore.emit(
        args[0] as string,
        args[1] as unknown,
        args[2] as (r: unknown) => void,
      ),
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

// LandingPage now absorbs the host/join/recover controls that used to
// live on the (deleted) intermediate StartScreen. The mock receives
// sessionNotice + onJoinRoom directly and renders a single host-join
// button — no more "click ENTER then click HOST" two-step.
vi.mock("@/pages/LandingPage", () => ({
  default: ({
    sessionNotice,
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
    <div>
      {sessionNotice && (
        <div data-testid="session-notice">{sessionNotice}</div>
      )}
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
    </div>
  ),
}));

// StartScreen is still imported by LandingPage but is fully suppressed
// by the LandingPage mock above. Stub it so its module graph (paywall
// modal, phrase grid, qr scanner) doesn't have to resolve at test time.
vi.mock("@/pages/StartScreen", () => ({ default: () => null }));
vi.mock("@/components/SplashScreen", () => ({
  default: () => null,
  shouldShowSplash: () => false,
  markSplashSeen: () => {},
  SPLASH_SEEN_KEY: "void:splash-seen",
}));

// PreviewGate: immediately invokes onEnter so the create-room emit fires.
vi.mock("@/pages/PreviewGate", () => ({
  default: ({
    onEnter,
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
    <button
      data-testid="preview-enter"
      onClick={() => onEnter({ relayOnly: false, videoStyle: 0, voiceMode: 0 })}
    >
      enter
    </button>
  ),
}));

// RoomPage: stub — these tests never reach the active-room state.
vi.mock("@/pages/RoomPage", () => ({
  default: () => <div data-testid="room-page">room</div>,
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

describe("App create-room TOKEN_ALREADY_USED message (#181 / #228)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    // Seed a valid payment token so emitHostCreate proceeds to socket.emit
    // rather than short-circuiting with "PAYMENT REQUIRED".
    sessionStorage.setItem("void_token", "test-payment-token");

    // Default emit: call the create-room callback with TOKEN_ALREADY_USED.
    socketStore.emit = vi.fn(
      (
        event: string,
        _data?: unknown,
        cb?: (r: unknown) => void,
      ) => {
        if (event === "create-room" && typeof cb === "function") {
          cb({ error: "TOKEN_ALREADY_USED" });
        }
      },
    );
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("shows 'ONE PAYMENT, ONE ROOM — PAY AGAIN FOR A NEW ONE' when the server returns TOKEN_ALREADY_USED on create-room", async () => {
    render(<App />);

    // LandingPage now embeds the host join button directly — no
    // intermediate ENTER step. Click straight through to PreviewGate.
    await waitFor(() => screen.getByTestId("start-join-host"));
    await userEvent.click(screen.getByTestId("start-join-host"));

    // PreviewGate: click enter to trigger emitHostCreate.
    await waitFor(() => screen.getByTestId("preview-enter"));
    await userEvent.click(screen.getByTestId("preview-enter"));

    // After the failed create-room ack, App sets sessionNotice and
    // returns to LandingPage. The friendly message must be visible.
    const notice = await screen.findByTestId("session-notice");
    expect(notice.textContent).toContain(
      "ONE PAYMENT, ONE ROOM — PAY AGAIN FOR A NEW ONE",
    );
  });

  it("does NOT show 'PAYMENT REQUIRED' when the server returns TOKEN_ALREADY_USED (the host genuinely paid)", async () => {
    render(<App />);

    await waitFor(() => screen.getByTestId("start-join-host"));
    await userEvent.click(screen.getByTestId("start-join-host"));

    await waitFor(() => screen.getByTestId("preview-enter"));
    await userEvent.click(screen.getByTestId("preview-enter"));

    await screen.findByTestId("session-notice");

    // The generic "PAYMENT REQUIRED" fallback must NOT appear when the wire
    // code is TOKEN_ALREADY_USED — that would mislead a host who paid.
    const notice = screen.getByTestId("session-notice");
    expect(notice.textContent).not.toContain("PAYMENT REQUIRED");
  });

  // Task #482: the create-room catch-all used to collapse INVALID_REQUEST /
  // INVALID_ROOM_ID into the misleading "PAYMENT REQUIRED" copy. Neither is
  // a billing problem — the host has no payment they can make to clear them.
  // These tests lock in the plain-language branches so a future refactor
  // can't silently re-collapse them.
  it.each([
    ["INVALID_REQUEST", "BAD REQUEST — RELOAD AND TRY AGAIN"],
    ["INVALID_ROOM_ID", "BAD REQUEST — RELOAD AND TRY AGAIN"],
  ])(
    "shows plain-language copy (not 'PAYMENT REQUIRED') when create-room returns %s",
    async (wireCode, expectedCopy) => {
      socketStore.emit = vi.fn(
        (
          event: string,
          _data?: unknown,
          cb?: (r: unknown) => void,
        ) => {
          if (event === "create-room" && typeof cb === "function") {
            cb({ error: wireCode });
          }
        },
      );

      render(<App />);

      await waitFor(() => screen.getByTestId("start-join-host"));
      await userEvent.click(screen.getByTestId("start-join-host"));

      await waitFor(() => screen.getByTestId("preview-enter"));
      await userEvent.click(screen.getByTestId("preview-enter"));

      const notice = await screen.findByTestId("session-notice");
      expect(notice.textContent).toContain(expectedCopy);
      expect(notice.textContent).not.toContain("PAYMENT REQUIRED");
    },
  );

  it("still shows 'PAYMENT REQUIRED' when there is no void_token in sessionStorage", async () => {
    // Remove the token so emitHostCreate hits the early-return path.
    sessionStorage.removeItem("void_token");

    // The socket should NOT be called in this path; configure it as a safety
    // net that would fail the test if unexpectedly reached.
    socketStore.emit = vi.fn(() => {
      throw new Error("socket.emit should not be called when token is absent");
    });

    render(<App />);

    await waitFor(() => screen.getByTestId("start-join-host"));
    await userEvent.click(screen.getByTestId("start-join-host"));

    await waitFor(() => screen.getByTestId("preview-enter"));
    await userEvent.click(screen.getByTestId("preview-enter"));

    const notice = await screen.findByTestId("session-notice");
    expect(notice.textContent).toContain("PAYMENT REQUIRED");
  });
});
