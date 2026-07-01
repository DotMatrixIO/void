// SPDX-License-Identifier: AGPL-3.0-or-later
// App-level shutdown banner contract.
//
// When the api-server broadcasts `server-shutdown` during its drain
// window, App.tsx must:
//   1. Render a non-blocking banner with the canonical copy
//      ("SIGNALING SERVER OFFLINE — YOUR CALL CONTINUES P2P.").
//   2. NOT call socket.disconnect() — peers continue P2P.
//   3. Hide the banner again when the underlying socket.io Manager
//      reports a successful reconnect.
//   4. Allow the user to dismiss the banner manually.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

type Handler = (...args: unknown[]) => void;

interface MockSocket {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  io: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
  __fire: (event: string, ...args: unknown[]) => void;
  __fireManager: (event: string, ...args: unknown[]) => void;
}

function makeSocket(): MockSocket {
  const handlers: Record<string, Handler[]> = {};
  const managerHandlers: Record<string, Handler[]> = {};
  return {
    on: vi.fn((evt: string, h: Handler) => {
      (handlers[evt] ??= []).push(h);
    }),
    off: vi.fn((evt: string, h: Handler) => {
      handlers[evt] = (handlers[evt] ?? []).filter((x) => x !== h);
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    io: {
      on: vi.fn((evt: string, h: Handler) => {
        (managerHandlers[evt] ??= []).push(h);
      }),
      off: vi.fn((evt: string, h: Handler) => {
        managerHandlers[evt] = (managerHandlers[evt] ?? []).filter((x) => x !== h);
      }),
    },
    __fire: (evt: string, ...args: unknown[]) => {
      for (const h of handlers[evt] ?? []) h(...args);
    },
    __fireManager: (evt: string, ...args: unknown[]) => {
      for (const h of managerHandlers[evt] ?? []) h(...args);
    },
  };
}

let mockSocket: MockSocket;

vi.mock("@/lib/socket", () => ({
  getSocket: () => mockSocket,
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
  registerBeforeAudioClose: vi.fn(() => () => {}),
}));

vi.mock("@/lib/hostTokenStorage", () => ({
  persistHostToken: vi.fn(async () => {}),
  loadHostToken: vi.fn(async () => null),
  clearHostToken: vi.fn(async () => {}),
}));

// Suppress the first-visit splash so the shutdown banner — which lives
// behind it on the post-splash LandingPage — is reachable. Without this
// mock the splash overlay is the only thing rendered for ~6s and
// findByRole("status") times out.
vi.mock("@/components/SplashScreen", () => ({
  default: () => null,
  shouldShowSplash: () => false,
  markSplashSeen: () => {},
  SPLASH_SEEN_KEY: "void:splash-seen",
}));

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

import App from "./App";

describe("App shutdown banner", () => {
  beforeEach(() => {
    mockSocket = makeSocket();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the canonical banner copy when server-shutdown fires, and never disconnects the socket", async () => {
    render(<App />);

    expect(screen.queryByRole("status")).toBeNull();
    expect(mockSocket.disconnect).not.toHaveBeenCalled();

    await act(async () => {
      mockSocket.__fire("server-shutdown", { reason: "SIGTERM", drainMs: 5000 });
    });

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toMatch(
      /SIGNALING SERVER OFFLINE — YOUR CALL CONTINUES P2P\./,
    );
    // The whole point of the banner is that peer connections survive
    // the operator restart. If we disconnect the socket here, the
    // call would die alongside the signaling server.
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });

  it("clears the banner when the socket.io Manager reports reconnect", async () => {
    render(<App />);
    await act(async () => {
      mockSocket.__fire("server-shutdown", { reason: "SIGTERM", drainMs: 5000 });
    });
    expect(await screen.findByRole("status")).toBeTruthy();

    await act(async () => {
      mockSocket.__fireManager("reconnect");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("can be dismissed by the user without disconnecting the socket", async () => {
    render(<App />);
    await act(async () => {
      mockSocket.__fire("server-shutdown", { reason: "SIGTERM", drainMs: 5000 });
    });
    const dismiss = await screen.findByRole("button", { name: /DISMISS/i });
    const user = userEvent.setup();
    await user.click(dismiss);
    expect(screen.queryByRole("status")).toBeNull();
    expect(mockSocket.disconnect).not.toHaveBeenCalled();
  });
});
