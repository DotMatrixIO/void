// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Task #172 / #192 — security regression coverage for M-03.
//
// The phrase that names a VOID room is the room key. Anything that captures
// a phrase-bearing URL into browser history is a phrase leak: shoulder-surf,
// history-extracting malware, or just the user pressing Back after leaving
// would re-expose it. Task #172 converted every URL transition in App.tsx
// into `replaceState` so the phrase never accumulates a history entry. This
// test pins that behavior down for every leave path the user can hit.

vi.mock("@/lib/socket", () => ({
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
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

// Keep parseHashPhrase + phraseToHash real (App.tsx depends on them); only
// stub deriveRoomCredentials so the URL-hash join path doesn't have to spin
// up argon2id (64 MiB, ~2-3 s) on every test.
vi.mock("@/lib/voidPhrase", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/voidPhrase");
  return {
    ...actual,
    deriveRoomCredentials: vi.fn(async () => ({
      roomId: "0123456789abcdef0123456789abcdef",
      e2eKey: { type: "stub-key" } as unknown as CryptoKey,
    })),
  };
});

// LandingPage now absorbs StartScreen's host/join controls. The mock
// exposes a single "start-join" button (lifted from the old StartScreen
// mock) that fires onJoinRoom synchronously — no more intermediate
// "click ENTER then click JOIN" two-step.
vi.mock("@/pages/LandingPage", () => ({
  default: ({
    onJoinRoom,
  }: {
    onJoinRoom: (
      roomId: string,
      e2eKey: CryptoKey,
      voidPhrase: string,
      isHost: boolean,
    ) => void;
  }) => (
    <button
      data-testid="start-join"
      onClick={() =>
        onJoinRoom(
          "0123456789abcdef0123456789abcdef",
          { type: "stub-key" } as unknown as CryptoKey,
          PHRASE_INLINE,
          false,
        )
      }
    >
      join
    </button>
  ),
}));

vi.mock("@/components/SplashScreen", () => ({
  default: () => null,
  shouldShowSplash: () => false,
  markSplashSeen: () => {},
  SPLASH_SEEN_KEY: "void:splash-seen",
}));

const PHRASE_INLINE = "abandon ability able about above absent";

vi.mock("@/pages/PreviewGate", () => ({
  default: ({
    onEnter,
    onCancel,
    voidPhrase,
  }: {
    onEnter: (opts: { audioDeviceId?: string; videoStyle: number; voiceMode: number; relayOnly: boolean }) => void;
    onCancel: () => void;
    voidPhrase: string;
  }) => (
    <div>
      <div data-testid="preview-gate">{voidPhrase}</div>
      <button
        data-testid="preview-enter"
        onClick={() => onEnter({ relayOnly: false, videoStyle: 0, voiceMode: 0 })}
      >
        enter
      </button>
      <button data-testid="preview-cancel" onClick={onCancel}>
        cancel
      </button>
    </div>
  ),
}));

const PHRASE = PHRASE_INLINE;

// StartScreen is still imported by LandingPage (it embeds it via the
// chromeless prop), but the LandingPage mock above suppresses it.
// Stub it so its module graph doesn't have to resolve at test time.
vi.mock("@/pages/StartScreen", () => ({ default: () => null }));

// RoomPage exposes one trigger per leave path documented in task #172. They
// all fire the same `onLeave?` callback into App.tsx — that is the single
// convergence point we are guarding — but having one trigger per documented
// path makes the regression coverage explicit if the case list ever shifts.
vi.mock("@/pages/RoomPage", () => ({
  default: ({
    onLeave,
    voidPhrase,
  }: {
    onLeave?: (reason?: string) => void;
    voidPhrase: string;
  }) => (
    <div data-testid="room-page">
      <div data-testid="room-phrase">{voidPhrase}</div>
      <button data-testid="leave-leave-button" onClick={() => onLeave?.()}>
        leave-button
      </button>
      <button data-testid="leave-burn" onClick={() => onLeave?.()}>
        burn
      </button>
      <button data-testid="leave-kick" onClick={() => onLeave?.("KICKED")}>
        kick
      </button>
      <button
        data-testid="leave-expiry"
        onClick={() => onLeave?.("ROOM EXPIRED — TIME ENDED")}
      >
        expiry
      </button>
      <button
        data-testid="leave-network"
        onClick={() => onLeave?.("CONNECTION ERROR")}
      >
        network-failure
      </button>
      <button data-testid="leave-route" onClick={() => onLeave?.()}>
        route-change
      </button>
    </div>
  ),
}));

vi.mock("@/pages/not-found", () => ({ default: () => <div>404</div> }));
vi.mock("@/pages/WhyPage", () => ({ default: () => null }));
vi.mock("@/pages/ComparePage", () => ({ default: () => null }));
vi.mock("@/pages/ThreatModelPage", () => ({ default: () => null }));
vi.mock("@/pages/ServerStateProofPage", () => ({ default: () => null }));
vi.mock("@/pages/BiometricPage", () => ({ default: () => null }));
vi.mock("@/pages/StillPoster", () => ({ default: () => null }));

import App from "./App";

const PHRASE_HASH = "#abandon-ability-able-about-above-absent";
const PHRASE_FRAGMENT = "abandon-ability";

function seedHistory(initialPath: string) {
  // Two-entry seed so the "going back must not surface the phrase" assertion
  // has somewhere to go back to. The seed entry deliberately contains no
  // phrase fragment so any back-pop that exposes one is unambiguously a leak.
  window.history.replaceState(null, "", "/__seed__");
  window.history.pushState(null, "", initialPath);
}

async function flushPopstate() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeAll(() => {
  // jsdom doesn't ship matchMedia; Home consults it at the top of render to
  // detect installed-PWA mode. Falsy match keeps the standard URL flow.
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

describe("App URL-hash hygiene (M-03 — task #172)", () => {
  let pushSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    pushSpy?.mockRestore();
    window.history.replaceState(null, "", "/");
  });

  describe("URL-hash join path (user pasted a phrase URL)", () => {
    async function renderFromPhraseUrl() {
      seedHistory("/" + PHRASE_HASH);
      // Spy AFTER seeding so the seed pushState doesn't pollute the count.
      pushSpy = vi.spyOn(window.history, "pushState");
      render(<App />);
      // Home parses the hash, kicks off derivation, and renders PreviewGate
      // once the (mocked) credentials resolve.
      await waitFor(() => screen.getByTestId("preview-gate"));
      // Sanity: the URL still carries the phrase while the user is in the
      // PreviewGate — leak-clearance must come from the leave handler.
      expect(window.location.hash).toContain(PHRASE_FRAGMENT);
      await userEvent.click(screen.getByTestId("preview-enter"));
      await waitFor(() => screen.getByTestId("room-page"));
      expect(window.location.hash).toContain(PHRASE_FRAGMENT);
    }

    const cases = [
      ["leave button", "leave-leave-button"],
      ["BURN", "leave-burn"],
      ["kick", "leave-kick"],
      ["timer expiry", "leave-expiry"],
      ["network-failure abandon", "leave-network"],
      ["in-app route change", "leave-route"],
    ] as const;

    for (const [label, testid] of cases) {
      it(`clears the phrase from the URL on leave via ${label} and pushes no history`, async () => {
        await renderFromPhraseUrl();

        await userEvent.click(screen.getByTestId(testid));

        await waitFor(() => {
          expect(window.location.hash).toBe("");
        });
        expect(window.location.href).not.toContain(PHRASE_FRAGMENT);

        // No pushState during the entire join → leave round-trip. If a future
        // refactor re-introduces pushState, this assertion fails before the
        // phrase ever escapes into history.
        expect(pushSpy).not.toHaveBeenCalled();

        // Going back must not surface a prior history entry that still
        // contains the phrase. Because every URL transition uses
        // replaceState, the only entry the phrase ever occupied has been
        // overwritten and `back()` lands on the seed entry.
        await act(async () => {
          window.history.back();
        });
        await flushPopstate();
        expect(window.location.hash).not.toContain(PHRASE_FRAGMENT);
        expect(window.location.href).not.toContain(PHRASE_FRAGMENT);
      });
    }

    it("clears the phrase when the user cancels from the PreviewGate", async () => {
      seedHistory("/" + PHRASE_HASH);
      pushSpy = vi.spyOn(window.history, "pushState");
      render(<App />);
      await waitFor(() => screen.getByTestId("preview-gate"));
      expect(window.location.hash).toContain(PHRASE_FRAGMENT);

      await userEvent.click(screen.getByTestId("preview-cancel"));

      await waitFor(() => {
        expect(window.location.hash).toBe("");
      });
      expect(pushSpy).not.toHaveBeenCalled();

      await act(async () => {
        window.history.back();
      });
      await flushPopstate();
      expect(window.location.href).not.toContain(PHRASE_FRAGMENT);
    });
  });

  describe("LandingPage join path (user typed the phrase in)", () => {
    async function renderViaStartScreen() {
      seedHistory("/");
      pushSpy = vi.spyOn(window.history, "pushState");
      render(<App />);

      // Without a hash and without standalone-PWA mode, Home renders
      // LandingPage directly (the splash is mocked off, the
      // intermediate ENTER → StartScreen step was removed in the
      // LandingPage merge).
      await waitFor(() => screen.getByTestId("start-join"));

      // The mocked LandingPage synchronously fires onJoinRoom, which is
      // App.tsx's *first* opportunity to leak the phrase into history. The
      // converted call uses replaceState, so the hash is now phrase-bearing
      // BUT the history depth has not grown.
      await userEvent.click(screen.getByTestId("start-join"));
      await waitFor(() => screen.getByTestId("preview-gate"));
      expect(window.location.hash).toContain(PHRASE_FRAGMENT);

      await userEvent.click(screen.getByTestId("preview-enter"));
      await waitFor(() => screen.getByTestId("room-page"));
      expect(window.location.hash).toContain(PHRASE_FRAGMENT);
    }

    it("uses replaceState (not pushState) when transitioning to the room URL", async () => {
      await renderViaStartScreen();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("clears the phrase on leave and the prior history entry has no phrase", async () => {
      await renderViaStartScreen();

      await userEvent.click(screen.getByTestId("leave-leave-button"));

      await waitFor(() => {
        expect(window.location.hash).toBe("");
      });
      expect(pushSpy).not.toHaveBeenCalled();

      await act(async () => {
        window.history.back();
      });
      await flushPopstate();
      expect(window.location.href).not.toContain(PHRASE_FRAGMENT);
    });
  });
});
