// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "@/test/axe";

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const { closeAudioContextMock, pipelineStopMock, buildMediaPipelineMock } =
  vi.hoisted(() => ({
    closeAudioContextMock: vi.fn(async () => {}),
    pipelineStopMock: vi.fn(),
    buildMediaPipelineMock: vi.fn(() => new Promise(() => {})),
  }));

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  playSelectClick: vi.fn(),
  playBleep: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
  closeAudioContext: closeAudioContextMock,
}));

vi.mock("@/lib/mediaPipeline", () => ({
  buildMediaPipeline: (...args: unknown[]) =>
    (buildMediaPipelineMock as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/components/PhraseShareModal", () => ({
  default: ({ phrase }: { phrase: string }) => (
    <div data-testid="phrase-share-modal-mock">{phrase}</div>
  ),
}));

// Task #636: PreviewGate now opens the shared MasksSheet from a single
// label-only MASKS button. The sheet owns mask selection, tap-to-hear and
// the ALLOW UNMASKED grant flow — covered by MasksSheet's own tests. Here
// we mock it so we can assert the open/close wiring and that an applied
// selection is forwarded to PreviewGate's onApply (which updates the live
// pipeline + the value carried into onEnter).
vi.mock("@/components/MasksSheet", () => ({
  default: ({
    open,
    onClose,
    onApply,
    videoStyle,
    voiceMode,
  }: {
    open: boolean;
    onClose: () => void;
    onApply: (next: { videoStyle: number; voiceMode: number }) => void;
    videoStyle: number;
    voiceMode: number;
  }) =>
    open ? (
      <div data-testid="masks-sheet-mock">
        <span data-testid="masks-sheet-mock-video">{String(videoStyle)}</span>
        <span data-testid="masks-sheet-mock-voice">{String(voiceMode)}</span>
        <button
          data-testid="masks-sheet-mock-apply"
          onClick={() => onApply({ videoStyle: 2, voiceMode: 1 })}
        >
          apply
        </button>
        <button data-testid="masks-sheet-mock-close" onClick={onClose}>
          close
        </button>
      </div>
    ) : null,
}));

// PreviewGate runs a WebRTC capability probe + Brave runtime check on
// mount (task #368). jsdom has no RTCPeerConnection, so the probe
// would otherwise return "no-rtc" and replace the preview UI with the
// browser-blocked screen for every test. Stub both modules to the
// happy path; dedicated coverage for the probe + blocked screen lives
// in browserCapability.test.ts and BrowserBlockedScreen.test.tsx.
vi.mock("@/lib/browserCapability", () => ({
  probeWebRtcCapability: vi.fn(async () => ({
    status: "ok" as const,
    candidates: { host: 0, srflx: 1, relay: 0, prflx: 0 },
    elapsedMs: 1,
  })),
  DEFAULT_PROBE_TIMEOUT_MS: 3000,
}));
vi.mock("@/lib/userAgent", () => ({
  describeUserAgent: () => ({
    raw: "",
    inAppBrowser: null,
    privacyBrowser: null,
    isIOS: false,
    isAndroid: false,
  }),
  isBraveBrowser: vi.fn(async () => false),
}));

import PreviewGate from "./PreviewGate";

beforeEach(() => {
  closeAudioContextMock.mockClear();
  pipelineStopMock.mockClear();
  buildMediaPipelineMock.mockReset();
  buildMediaPipelineMock.mockImplementation(() => new Promise(() => {}));
});

const TEST_PHRASE = "ability about above absent absorb abstract";

// Switch the jsdom hostname for the duration of one test. jsdom's
// `window.location` properties are non-configurable, so we replace the
// entire `location` object with a stub and restore it on teardown.
function withHostname(hostname: string): () => void {
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...original, hostname },
  });
  return () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

describe("PreviewGate WebRTC probe hard gate (task #368)", () => {
  // These tests prove the WebRTC probe is a hard gate on ENTER ROOM,
  // not just an advisory. Pre-fix, a user could click Enter before the
  // ~3s probe settled, unmount PreviewGate, and bypass the
  // BrowserBlockedScreen entirely — reintroducing the original failure
  // mode (generic call timeout instead of a fix-it screen).
  it("holds ENTER ROOM disabled while the probe is still pending and shows the compatibility-check status", async () => {
    const probeMock = vi.mocked(
      (await import("@/lib/browserCapability")).probeWebRtcCapability,
    );
    // Probe that never resolves — simulates the ~3s window before the
    // probe settles. The button must stay disabled the whole time.
    let resolveProbe: (v: { status: "ok"; candidates: { host: number; srflx: number; relay: number; prflx: number }; elapsedMs: number }) => void = () => {};
    probeMock.mockImplementationOnce(
      () => new Promise((res) => { resolveProbe = res; }),
    );
    const onEnter = vi.fn();
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={onEnter}
        onCancel={vi.fn()}
      />,
    );
    const btn = screen.getByTestId("enter-room") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId("webrtc-probe-pending")).toBeInTheDocument();
    // Clicking through the disabled button must not commit. We invoke
    // onClick directly because user-event respects `disabled`.
    fireEvent.click(btn);
    expect(onEnter).not.toHaveBeenCalled();
    // After the probe resolves "ok", the gate opens and Enter becomes
    // clickable. This is the happy-path completion of the same gate.
    await act(async () => {
      resolveProbe({
        status: "ok",
        candidates: { host: 0, srflx: 1, relay: 0, prflx: 0 },
        elapsedMs: 5,
      });
      await flushMicrotasks();
    });
    expect((screen.getByTestId("enter-room") as HTMLButtonElement).disabled)
      .toBe(false);
    expect(screen.queryByTestId("webrtc-probe-pending")).toBeNull();
  });

  it("replaces the preview UI with BrowserBlockedScreen when the probe reports blocked (no fallthrough)", async () => {
    const probeMock = vi.mocked(
      (await import("@/lib/browserCapability")).probeWebRtcCapability,
    );
    probeMock.mockResolvedValueOnce({
      status: "blocked",
      candidates: { host: 0, srflx: 0, relay: 0, prflx: 0 },
      elapsedMs: 3000,
    });
    const onEnter = vi.fn();
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={onEnter}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    // Blocked-screen takeover: the original Enter button is gone.
    expect(screen.queryByTestId("enter-room")).toBeNull();
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getByTestId("browser-blocked-screen")).toBeInTheDocument();
  });
});

describe("PreviewGate relay-only default on .onion vs clearnet", () => {
  // The ThreatModelPage paragraph (data-testid="tor-onion-default-paragraph")
  // promises that loading VOID from a .onion URL pre-checks the host's
  // relay-only toggle. These tests are the code half of that contract:
  // if a future refactor drops the onion-aware initialiser, the page's
  // promise becomes aspirational again and these tests fail.
  it("initialises the host relay-only toggle to ON when loaded from a .onion hostname", () => {
    const restore = withHostname("voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion");
    try {
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          showRelayToggle
          onEnter={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const toggle = screen.getByTestId("relay-only-toggle");
      // Pre-checked: the leading "✓ " marks the on state in the label.
      expect(toggle.textContent).toMatch(/^✓ /);
      // The inline note explaining the auto-default is rendered too.
      expect(screen.getByTestId("onion-relay-explanation")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("initialises the host relay-only toggle to OFF on a clearnet hostname", () => {
    // jsdom default hostname is "localhost" — clearnet for our purposes.
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const toggle = screen.getByTestId("relay-only-toggle");
    expect(toggle.textContent).not.toMatch(/^✓ /);
    expect(screen.queryByTestId("onion-relay-explanation")).toBeNull();
  });

  it("passes relayOnly=true to onEnter when the host enters from a .onion origin without flipping the toggle", async () => {
    const restore = withHostname("voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion");
    try {
      const onEnter = vi.fn();
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          showRelayToggle
          onEnter={onEnter}
          onCancel={vi.fn()}
        />,
      );
      // Wait for the WebRTC probe mock to resolve "ok" so the gate
      // opens. Without this, the new probe-gate keeps Enter disabled
      // and the click below is a no-op.
      await flushMicrotasks();
      fireEvent.click(screen.getByTestId("enter-room"));
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(onEnter.mock.calls[0][0]).toMatchObject({ relayOnly: true });
    } finally {
      restore();
    }
  });
});

describe("PreviewGate relay-only toggle", () => {
  it("renders the relay-only label and the explanatory sentence when showRelayToggle is true", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // The toggle label promises what the mode does in user-visible terms.
    expect(
      screen.getByRole("button", {
        name: /RELAY-ONLY MODE — HIDE MY IP FROM PEERS/,
      }),
    ).toBeInTheDocument();

    // The explanatory copy underneath the toggle states the trade-off so a
    // host who flips it understands the cost. A future refactor must not
    // drop it without anything failing.
    expect(screen.getByTestId("relay-info-text").textContent).toMatch(
      /All traffic routes through the TURN relay\. Your peers cannot see your IP address\. Slower for everyone in the room\./,
    );
  });

  it("does not render the relay-only toggle when showRelayToggle is false", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: /RELAY-ONLY MODE/,
      }),
    ).toBeNull();
    expect(
      screen.queryByText(/All traffic routes through the TURN relay/),
    ).toBeNull();
  });
});

// Host-only SHARE affordance on the lobby (task #637, simplified task #645).
// The heavy phrase block was replaced by a single SHARE button that opens the
// QR/share pop-up (PhraseShareModal) directly, plus an accessible ⓘ disclosure
// that holds the two URL-leak cautions. The whole affordance is gated on the
// host (showRelayToggle); a joiner already has the phrase, so they see nothing.
// These tests guard each path so a refactor of PreviewGate cannot silently
// break the host hand-off.
describe("PreviewGate host SHARE affordance (task #637)", () => {
  it("shows the SHARE affordance to the host and hides it from a joiner", () => {
    const { unmount } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("preview-share-affordance")).toBeInTheDocument();
    expect(screen.getByTestId("preview-share-button")).toBeInTheDocument();
    // The full phrase is no longer printed inline at rest — it moved into
    // the room / behind the SHARE + QR actions.
    expect(screen.queryByText(TEST_PHRASE)).toBeNull();
    unmount();

    // Joiner (no host flag) gets no share affordance at all.
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("preview-share-affordance")).toBeNull();
    expect(screen.queryByTestId("preview-share-button")).toBeNull();
  });

  it("opens the PhraseShareModal with the room phrase when SHARE is clicked", async () => {
    const user = userEvent.setup();
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // The modal is closed at rest.
    expect(screen.queryByTestId("phrase-share-modal-mock")).toBeNull();

    // Task #645: SHARE opens the QR/share pop-up directly — there is no
    // inline clipboard/native-share hand-off and no transient COPIED/SENT
    // label; the button reads "SHARE" at all times.
    const shareBtn = screen.getByTestId("preview-share-button");
    expect(shareBtn).toHaveTextContent(/^SHARE$/);
    await user.click(shareBtn);

    const modal = screen.getByTestId("phrase-share-modal-mock");
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent(TEST_PHRASE);
  });

  it("keeps the two URL-leak cautions behind the ⓘ disclosure, hidden until opened", async () => {
    const user = userEvent.setup();
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Collapsed by default: neither caution shouts at the host at rest.
    expect(screen.queryByTestId("preview-share-cautions")).toBeNull();
    expect(
      screen.queryByText(
        /On older Android and many in-app browsers, other apps can read the clipboard\. QR doesn’t touch it\./,
      ),
    ).toBeNull();

    const toggle = screen.getByTestId("preview-share-cautions-toggle");
    // Disclosure semantics: keyboard-focusable button wired to the region.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "preview-share-cautions");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Exact wording pinned in scripts/check-required-literals.mjs (clipboard
    // caution task #373, fragment-leak caution task #399). Both must surface
    // when the curious host opens the disclosure.
    expect(
      screen.getByText(
        /On older Android and many in-app browsers, other apps can read the clipboard\. QR doesn’t touch it\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
      ),
    ).toBeInTheDocument();
  });
});

describe("PreviewGate audio resource cleanup", () => {
  it("calls closeAudioContext on unmount even if a preview was never started", () => {
    const { unmount } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    closeAudioContextMock.mockClear();

    unmount();

    expect(closeAudioContextMock).toHaveBeenCalledTimes(1);
  });

  it("stops the pipeline and closes the AudioContext when an active preview is unmounted", async () => {
    buildMediaPipelineMock.mockImplementation(async () => ({
      canvas: { width: 0, height: 0 },
      processedStream: { getTracks: () => [] },
      stop: pipelineStopMock,
      disableMonitor: vi.fn(),
      setVideoStyle: vi.fn(),
      setVoiceMode: vi.fn(),
    }));

    const { unmount } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    closeAudioContextMock.mockClear();
    pipelineStopMock.mockClear();

    unmount();

    expect(pipelineStopMock).toHaveBeenCalledTimes(1);
    expect(closeAudioContextMock).toHaveBeenCalledTimes(1);
  });

  it("tears down a late-resolving pipeline when the gate is unmounted before buildMediaPipeline finishes", async () => {
    // Regression guard for the startCancelledRef branch in startPreview:
    // if the host backs out of the lobby (or the component unmounts) WHILE
    // buildMediaPipeline is still awaiting — e.g. the user is still
    // looking at the camera permission prompt, or getUserMedia is slow —
    // the late-resolving pipeline must be stopped and the AudioContext
    // closed instead of being bound to a now-unmounted component. Without
    // this branch the camera light stays on after the user has visibly
    // left the page.
    let resolvePipeline: ((pipeline: unknown) => void) | null = null;
    buildMediaPipelineMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePipeline = resolve;
        }),
    );

    const { unmount } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();

    // Sanity: startPreview must actually be awaiting the build at this
    // point — otherwise the test setup never exercised the branch and a
    // future refactor that drops the guard would still pass.
    expect(buildMediaPipelineMock).toHaveBeenCalledTimes(1);
    expect(typeof resolvePipeline).toBe("function");

    // The host leaves the lobby BEFORE buildMediaPipeline resolves.
    unmount();

    // Now the slow getUserMedia / permission prompt finally settles and
    // the pipeline arrives at a component that no longer exists. The
    // cancellation guard should stop the camera/audio pipeline and close
    // the AudioContext instead of leaking past unmount.
    closeAudioContextMock.mockClear();
    pipelineStopMock.mockClear();

    await act(async () => {
      resolvePipeline!({
        canvas: { width: 0, height: 0 },
        processedStream: { getTracks: () => [], getAudioTracks: () => [] },
        stop: pipelineStopMock,
        disableMonitor: vi.fn(),
        setVideoStyle: vi.fn(),
        setVoiceMode: vi.fn(),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pipelineStopMock).toHaveBeenCalledTimes(1);
    expect(closeAudioContextMock).toHaveBeenCalledTimes(1);
  });

  describe("mask defaults", () => {
    beforeEach(() => {
      window.localStorage.clear();
    });

    it("fresh session with no localStorage defaults to ASCII video and SCRAMBLE audio", async () => {
      // Task #636: the visible ASCII/SCRAMBLE cycler labels are gone (mask
      // selection moved into the MasksSheet). The defaults are now proven
      // by what is pushed to the live pipeline and carried into onEnter.
      const setVideoStyleMock = vi.fn();
      const setVoiceModeMock = vi.fn();
      buildMediaPipelineMock.mockImplementation(async () => ({
        canvas: { width: 0, height: 0 },
        processedStream: { getTracks: () => [], getAudioTracks: () => [] },
        stop: pipelineStopMock,
        disableMonitor: vi.fn(),
        setVideoStyle: setVideoStyleMock,
        setVoiceMode: setVoiceModeMock,
      }));

      const onEnter = vi.fn();
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          onEnter={onEnter}
          onCancel={vi.fn()}
        />,
      );

      await flushMicrotasks();
      await flushMicrotasks();
      expect(setVideoStyleMock).toHaveBeenCalledWith(5);
      expect(setVoiceModeMock).toHaveBeenCalledWith(3);

      fireEvent.click(screen.getByTestId("enter-room"));
      expect(onEnter).toHaveBeenCalledTimes(1);
      expect(onEnter.mock.calls[0][0]).toMatchObject({
        videoStyle: 5,
        voiceMode: 3,
      });
    });

    it("stored selection takes precedence over the defaults", async () => {
      window.localStorage.setItem("voidVideoStyle", "0");
      window.localStorage.setItem("voidVoiceMode", "0");
      // Task #572/#636: NONE (0) is gated. A stored NONE only survives
      // mount when the matching ALLOW UNMASKED pref is on — otherwise the
      // mount-time clamp snaps it back to the safe default.
      window.localStorage.setItem("voidAllowUnmaskedVideo", "1");
      window.localStorage.setItem("voidAllowUnmaskedVoice", "1");

      const onEnter = vi.fn();
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          onEnter={onEnter}
          onCancel={vi.fn()}
        />,
      );

      // Wait for the WebRTC probe mock to resolve "ok" so the
      // probe-gate (task #368) lets the click through.
      await flushMicrotasks();
      fireEvent.click(screen.getByTestId("enter-room"));
      expect(onEnter.mock.calls[0][0]).toMatchObject({
        videoStyle: 0,
        voiceMode: 0,
      });
    });

    it("clamps a stored NONE back to the safe default when ALLOW UNMASKED is OFF", async () => {
      // Task #636: gated-NONE clamp is preserved even though the cyclers
      // are gone. A stored NONE with the pref OFF must not be carried into
      // the room — it snaps to ASCII video / SCRAMBLE audio on mount.
      window.localStorage.setItem("voidVideoStyle", "0");
      window.localStorage.setItem("voidVoiceMode", "0");

      const onEnter = vi.fn();
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          onEnter={onEnter}
          onCancel={vi.fn()}
        />,
      );

      await flushMicrotasks();
      fireEvent.click(screen.getByTestId("enter-room"));
      expect(onEnter.mock.calls[0][0]).toMatchObject({
        videoStyle: 5,
        voiceMode: 3,
      });
    });

    it("persists the current selection to localStorage", async () => {
      render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          onEnter={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      await flushMicrotasks();
      expect(window.localStorage.getItem("voidVideoStyle")).toBe("5");
      expect(window.localStorage.getItem("voidVoiceMode")).toBe("3");
    });
  });

  it("does not leave an orphan requestAnimationFrame callback scheduled after unmount of an active preview", async () => {
    // PreviewGate mirrors the pipeline canvas onto the on-screen
    // preview canvas with its own RAF loop; if a future refactor
    // forgets to wire up the cancel side, the loop keeps ticking
    // against a torn-down pipeline canvas after the user leaves the
    // gate. Track every RAF id we hand out and assert each one was
    // either cancelled or never re-scheduled by the loop after stop.
    const scheduledIds = new Set<number>();
    const cancelledIds = new Set<number>();
    let nextId = 100;
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => {
        const id = nextId++;
        scheduledIds.add(id);
        return id;
      });
    const cancelSpy = vi
      .spyOn(globalThis, "cancelAnimationFrame")
      .mockImplementation((id: number) => {
        cancelledIds.add(id);
      });

    try {
      buildMediaPipelineMock.mockImplementation(async () => ({
        canvas: { width: 320, height: 240, getContext: () => null },
        processedStream: { getTracks: () => [], getAudioTracks: () => [] },
        stop: pipelineStopMock,
        disableMonitor: vi.fn(),
        setVideoStyle: vi.fn(),
        setVoiceMode: vi.fn(),
      }));

      const { unmount } = render(
        <PreviewGate
          voidPhrase={TEST_PHRASE}
          onEnter={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      await flushMicrotasks();
      await flushMicrotasks();

      // The preview-mirror RAF should have been scheduled at least once
      // by the time the build resolves. (Zero would mean the test
      // setup never actually let startPreview run, masking the bug.)
      expect(scheduledIds.size).toBeGreaterThanOrEqual(1);

      unmount();

      // Every RAF id we ever handed out must have been passed to
      // cancelAnimationFrame by unmount. An id that was scheduled but
      // never cancelled is the canonical orphan-RAF leak this test
      // exists to catch.
      for (const id of scheduledIds) {
        expect(cancelledIds.has(id)).toBe(true);
      }
    } finally {
      rafSpy.mockRestore();
      cancelSpy.mockRestore();
    }
  });

  it("closes the AudioContext when buildMediaPipeline rejects", async () => {
    buildMediaPipelineMock.mockImplementation(async () => {
      throw new Error("getUserMedia denied");
    });

    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    expect(closeAudioContextMock).toHaveBeenCalled();
  });
});

// Task #420: the SOUNDS toggle was moved out of PreviewGate and into
// the HamburgerMenu's PREFERENCES section. The persist-before-uiClick
// ordering is still pinned by RoomPage.test.tsx via the same shared
// <UiSoundsToggle> component, so no presence test lives here anymore.


// Task #636: "Calm the PREVIEW screen" UI pass. The unfolded video/audio
// cyclers, the two ALLOW UNMASKED toggles and the audio-test line are
// replaced by a single label-only MASKS button that opens the shared
// MasksSheet. The visible body heading is gone (replaced by a
// visually-hidden semantic <h1>), the headphones advice is demoted to a
// quiet line near the mic selector, and the relay-only explanation hides
// behind an accessible ⓘ affordance. These tests pin the calmer surface.
describe("PreviewGate calmed PREVIEW screen (task #636)", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch {}
  });
  afterEach(() => {
    try { window.localStorage.clear(); } catch {}
  });

  it("removes the noisy mask cyclers, ALLOW UNMASKED toggles and audio-test line", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The old unfolded controls are gone.
    expect(screen.queryByTestId("preview-unmasked-toggle-row")).toBeNull();
    expect(
      screen.queryByTestId("preview-allow-unmasked-video-toggle"),
    ).toBeNull();
    expect(
      screen.queryByTestId("preview-allow-unmasked-voice-toggle"),
    ).toBeNull();
    expect(screen.queryByText(/^video mask:/i)).toBeNull();
    expect(screen.queryByText(/^audio mask:/i)).toBeNull();
    expect(screen.queryByText(/To test audio masks/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Next audio mask/i })).toBeNull();
  });

  it("renders the visible body heading as a visually-hidden semantic heading instead", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The old loud body heading text is gone…
    expect(screen.queryByText(/Set Up Before Going Live/i)).toBeNull();
    // …but a real, programmatically-discoverable heading remains.
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toBeInTheDocument();
    // Visually hidden: clipped to a 1px box, not display:none (so it stays
    // in the accessibility tree).
    expect(heading).toHaveStyle({ position: "absolute" });
  });

  it("demotes the headphones advice to a small quiet line (no loud gold callout)", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The shouty all-caps gold callout is gone.
    expect(
      screen.queryByText(/HEADPHONES RECOMMENDED FOR THE CALL/),
    ).toBeNull();
    // A calm sentence-case advisory remains.
    expect(
      screen.getByText(/Headphones recommended — helps prevent echo\./),
    ).toBeInTheDocument();
  });

  it("opens the MasksSheet from the single label-only MASKS button and closes it again", async () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const masksBtn = screen.getByTestId("preview-masks-button");
    expect(masksBtn).toHaveTextContent(/^MASKS$/);
    // Closed by default.
    expect(screen.queryByTestId("masks-sheet-mock")).toBeNull();

    await act(async () => { fireEvent.click(masksBtn); });
    expect(screen.getByTestId("masks-sheet-mock")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("masks-sheet-mock-close"));
    });
    expect(screen.queryByTestId("masks-sheet-mock")).toBeNull();
  });

  it("seeds the sheet with the current selection and forwards an applied selection into onEnter", async () => {
    const setVideoStyleMock = vi.fn();
    const setVoiceModeMock = vi.fn();
    buildMediaPipelineMock.mockImplementation(async () => ({
      canvas: { width: 0, height: 0 },
      processedStream: { getTracks: () => [], getAudioTracks: () => [] },
      stop: pipelineStopMock,
      disableMonitor: vi.fn(),
      setVideoStyle: setVideoStyleMock,
      setVoiceMode: setVoiceModeMock,
    }));

    const onEnter = vi.fn();
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={onEnter}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    await flushMicrotasks();

    await act(async () => {
      fireEvent.click(screen.getByTestId("preview-masks-button"));
    });
    // Sheet is seeded with the live (default) selection: ASCII (5) / SCRAMBLE (3).
    expect(screen.getByTestId("masks-sheet-mock-video")).toHaveTextContent("5");
    expect(screen.getByTestId("masks-sheet-mock-voice")).toHaveTextContent("3");

    // Apply a new selection from the sheet (mock applies video 2 / voice 1).
    await act(async () => {
      fireEvent.click(screen.getByTestId("masks-sheet-mock-apply"));
    });
    // The live pipeline is updated…
    expect(setVideoStyleMock).toHaveBeenLastCalledWith(2);
    expect(setVoiceModeMock).toHaveBeenLastCalledWith(1);

    // …and the applied selection is what gets carried into the room.
    fireEvent.click(screen.getByTestId("enter-room"));
    expect(onEnter.mock.calls[0][0]).toMatchObject({
      videoStyle: 2,
      voiceMode: 1,
    });
  });

  it("keeps the relay-only explanation in the DOM but hides it behind an accessible ⓘ affordance", async () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const info = screen.getByTestId("relay-info-toggle");
    // 44x44px keyboard-operable target, collapsed by default, linked to
    // the explanatory text for assistive tech.
    expect(info).toHaveStyle({ width: "44px", height: "44px" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    const describedBy = info.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();

    // The explanatory text is present in the DOM at all times (so it never
    // leaves the accessibility tree) — getByText finds it even collapsed.
    const text = screen.getByTestId("relay-info-text");
    expect(text.id).toBe(describedBy);
    expect(text.textContent).toMatch(
      /All traffic routes through the TURN relay\./,
    );
    // Collapsed: visually hidden (clipped, absolutely positioned).
    expect(text).toHaveStyle({ position: "absolute" });

    // Tapping ⓘ reveals it.
    await act(async () => { fireEvent.click(info); });
    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(text).not.toHaveStyle({ position: "absolute" });
  });

  it("the joiner sees the cleaner screen too: no MASKS button, no relay controls, no cyclers", () => {
    // A joiner renders PreviewGate WITHOUT showRelayToggle. The calmed
    // screen must not regress into the old dense control set for them
    // either — they get the self-preview and ENTER ROOM, nothing noisy.
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // No relay toggle / explanation for a non-host joiner.
    expect(screen.queryByTestId("relay-only-toggle")).toBeNull();
    expect(screen.queryByTestId("relay-info-toggle")).toBeNull();
    // No legacy dense controls.
    expect(screen.queryByTestId("preview-unmasked-toggle-row")).toBeNull();
    expect(screen.queryByText(/^video mask:/i)).toBeNull();
    expect(screen.queryByText(/To test audio masks/i)).toBeNull();
    // The MASKS button IS still available (joiner can pick their own mask),
    // and ENTER ROOM is present.
    expect(screen.getByTestId("preview-masks-button")).toBeInTheDocument();
    expect(screen.getByTestId("enter-room")).toBeInTheDocument();
  });
});

describe("PreviewGate accessibility audit (axe)", () => {
  it("has no axe violations for the host lobby (relay toggle + SHARE affordance)", async () => {
    const { container } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // Let the WebRTC probe mock settle so the gate is in its steady,
    // probe-resolved state rather than the transient pending state.
    await flushMicrotasks();
    await expectNoAxeViolations(container);
  });

  it("has no axe violations for the joiner lobby and with the SHARE cautions disclosure open", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    await expectNoAxeViolations(container);
    unmount();

    // Host again, with the ⓘ cautions disclosure expanded — the expanded
    // region is part of the surface a screen-reader user can reach.
    const { container: hostContainer } = render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await flushMicrotasks();
    await user.click(screen.getByTestId("preview-share-cautions-toggle"));
    await expectNoAxeViolations(hostContainer);
  });
});
