// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Regression coverage for Task #321 / Task #326.
//
// Task #321 took `/music` (MusicAudition) and `/agents` (AgentModePage) off
// the v0.5 surface by removing their <Route> entries from App.tsx and
// dropping the hamburger / footer entries that linked to them. Both pages
// have since been removed from disk entirely, so an accidental re-import +
// re-route would silently re-expose them.
//
// The existing App.token.test.tsx / App.history.test.tsx tests pin specific
// known routes but never assert these two are *absent*. This file is the
// negative test: visiting `/music` or `/agents` must render the NotFound
// page, never the AgentModePage or MusicAudition page. The test fails the
// moment either route is re-added without an explicit policy decision.

// App.tsx pulls in a lot of side-effecty modules at import time (sockets,
// audio, query client, etc). Stub them so the router can mount cheaply.
import { vi } from "vitest";

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

// Stub the routed pages with sentinels so a stray render of one of them
// (instead of NotFound) is unambiguous in the assertions below. Home is
// stubbed too so the "/" smoke check doesn't have to drag in matchMedia +
// the full landing flow.
vi.mock("@/pages/LandingPage", () => ({
  default: () => <div data-testid="page-home">home</div>,
}));
vi.mock("@/pages/StartScreen", () => ({ default: () => null }));
vi.mock("@/pages/PreviewGate", () => ({ default: () => null }));
vi.mock("@/pages/RoomPage", () => ({ default: () => null }));
vi.mock("@/pages/WhyPage", () => ({ default: () => null }));
vi.mock("@/pages/ComparePage", () => ({ default: () => null }));
vi.mock("@/pages/ThreatModelPage", () => ({ default: () => null }));
vi.mock("@/pages/AuditPage", () => ({ default: () => null }));
vi.mock("@/pages/ServerStateProofPage", () => ({ default: () => null }));
vi.mock("@/pages/BiometricPage", () => ({ default: () => null }));

// Sentinels for the two routes that are NOT supposed to exist. If a future
// refactor wires either page back into App.tsx, the route would render this
// sentinel instead of the real NotFound, and the assertions below would
// fail with a clear, on-purpose message.
// Neither AgentModePage nor MusicAudition is on disk anymore; the factory
// form of vi.mock registers a stub for the alias without needing the real
// module to exist.
vi.mock("@/pages/AgentModePage", () => ({
  default: () => <div data-testid="page-agents">agents-page-rendered</div>,
}));
vi.mock("@/pages/MusicAudition", () => ({
  default: () => <div data-testid="page-music">music-page-rendered</div>,
}));

vi.mock("@/pages/not-found", () => ({
  default: () => <div data-testid="page-not-found">404 NOT FOUND</div>,
}));

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

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("Removed routes /music and /agents render NotFound (#321 / #326)", () => {
  for (const path of ["/music", "/agents"] as const) {
    it(`renders NotFound for ${path} and never the removed page`, () => {
      window.history.replaceState(null, "", path);
      render(<App />);

      expect(screen.getByTestId("page-not-found")).toBeInTheDocument();
      expect(screen.queryByTestId("page-agents")).toBeNull();
      expect(screen.queryByTestId("page-music")).toBeNull();
    });
  }
});
