// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";

// Onion-origin defaults contract: host toggle pre-checked, disable
// gated by confirm modal, joiner pre-entry warning + ENTER gate, and
// local iceTransportPolicy pinned to "relay" regardless of room setting.

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  playSelectClick: vi.fn(),
  playBleep: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
  closeAudioContext: vi.fn(async () => {}),
}));

vi.mock("@/lib/mediaPipeline", () => ({
  buildMediaPipeline: vi.fn(() => new Promise(() => {})),
}));

vi.mock("@/components/PhraseShareModal", () => ({
  default: () => null,
}));

// PreviewGate (task #368) runs a WebRTC capability probe + Brave check
// on mount. jsdom has no RTCPeerConnection, so without these stubs the
// probe returns "no-rtc" and replaces the onion UI with the
// browser-blocked screen. Dedicated coverage for the probe and blocked
// screen lives in browserCapability.test.ts / BrowserBlockedScreen.test.tsx.
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

import PreviewGate from "@/pages/PreviewGate";
import { initialIceTransportPolicy } from "@/lib/origin";
import { rendezvousJoinCandidates } from "@/lib/rendezvous";

const TEST_PHRASE = "ability about above absent absorb abstract";

function setOnionHostname(hostname: string) {
  // jsdom's `location` is normally read-only; we replace the host via
  // `Object.defineProperty` so `isOnionOrigin()`, which calls
  // `window.location.hostname`, observes our test value.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      hostname,
      protocol: "http:",
      href: `http://${hostname}/`,
    },
  });
}

const ORIGINAL_LOCATION = window.location;

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PreviewGate onion defaults", () => {
  beforeEach(() => {
    setOnionHostname("voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion");
  });

  it("pre-checks the host's relay-only toggle when the page is loaded over a .onion origin", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    // The "✓ " prefix is rendered when relayOnly is true.
    expect(toggle.textContent).toMatch(/^✓/);
    // The inline explanation that justifies the default must be visible
    // — without it, a user has no way to know why the toggle starts on.
    expect(screen.getByTestId("onion-relay-explanation")).toBeInTheDocument();
  });

  it("opens a confirmation modal when the host tries to disable the pre-checked toggle, and keeps relay-only on if the host cancels", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    fireEvent.click(toggle);

    // First click on a pre-checked toggle does NOT immediately disable
    // — it opens the confirmation dialog.
    expect(screen.getByTestId("onion-disable-confirm")).toBeInTheDocument();
    expect(toggle.textContent).toMatch(/^✓/);

    fireEvent.click(screen.getByTestId("onion-disable-cancel"));
    expect(screen.queryByTestId("onion-disable-confirm")).toBeNull();
    // Toggle stays on after cancel.
    expect(toggle.textContent).toMatch(/^✓/);
  });

  it("disables the toggle only after the host explicitly confirms in the modal", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("onion-disable-confirm-btn"));

    expect(screen.queryByTestId("onion-disable-confirm")).toBeNull();
    // Toggle now reads as off (no leading "✓ ").
    expect(toggle.textContent).not.toMatch(/^✓/);
  });

  it("warns a joiner reaching the gate from a .onion origin when the room they are about to join was not created relay-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayOnly: false }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        roomId="room-abcdef"
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("onion-join-warning")).toBeInTheDocument();
    });
    // The fetch must use the room-state endpoint (not, e.g., a stale
    // joinable check) — otherwise the warning would trigger on the
    // wrong condition.
    expect(fetchMock).toHaveBeenCalled();
    // Task #1024: a human room is routed (and looked up) under its live
    // per-epoch rendezvous handle, NOT the durable roomId. The gate probes
    // the join window most-likely-first, so the first room-state fetch must
    // hit the current-epoch handle H(E), not the literal roomId.
    const [expectedHandle] = await rendezvousJoinCandidates("room-abcdef");
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toMatch(new RegExp(`/api/room-state/${expectedHandle}$`));
  });

  it("pins iceTransportPolicy to 'relay' for the local PeerConnection regardless of the room setting", () => {
    expect(initialIceTransportPolicy()).toBe("relay");
  });

  it("holds ENTER ROOM disabled for an onion joiner until the room-state fetch resolves, so the warning is visible before commit", async () => {
    let resolveFetch: ((value: unknown) => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((res) => {
          resolveFetch = res;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onEnter = vi.fn();

    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        roomId="room-abcdef"
        onEnter={onEnter}
        onCancel={vi.fn()}
      />,
    );

    const enter = screen.getByTestId("enter-room") as HTMLButtonElement;
    expect(enter.disabled).toBe(true);
    expect(screen.getByTestId("onion-join-gate-pending")).toBeInTheDocument();
    fireEvent.click(enter);
    expect(onEnter).not.toHaveBeenCalled();

    // Task #1024: the room-state probe first awaits the async rendezvous-handle
    // derivation (HKDF) before it calls fetch, so `resolveFetch` is not assigned
    // synchronously. Wait for the deferred fetch to actually be invoked before
    // resolving it — the gate must stay pending throughout this window.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(enter.disabled).toBe(true);
    expect(screen.getByTestId("onion-join-gate-pending")).toBeInTheDocument();

    await act(async () => {
      resolveFetch!({ ok: true, json: async () => ({ relayOnly: false }) });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId("onion-join-warning")).toBeInTheDocument();
    });
    expect(enter.disabled).toBe(false);
    expect(screen.queryByTestId("onion-join-gate-pending")).toBeNull();
    fireEvent.click(enter);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("releases the ENTER gate even if the room-state fetch fails (local relay enforcement still applies)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        roomId="room-abcdef"
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      const enter = screen.getByTestId("enter-room") as HTMLButtonElement;
      expect(enter.disabled).toBe(false);
    });
    expect(screen.queryByTestId("onion-join-warning")).toBeNull();
    expect(screen.queryByTestId("onion-join-gate-pending")).toBeNull();
  });

  it("does not re-prompt the host once they have already confirmed disabling once", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    // First disable — modal opens, host confirms.
    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("onion-disable-confirm-btn"));
    expect(toggle.textContent).not.toMatch(/^✓/);

    // Re-enable, then disable again — no second modal. The friction is
    // meant to catch an accidental click on the pre-checked default,
    // not to nag a user who has already made an informed choice.
    fireEvent.click(toggle);
    expect(toggle.textContent).toMatch(/^✓/);
    fireEvent.click(toggle);
    expect(screen.queryByTestId("onion-disable-confirm")).toBeNull();
    expect(toggle.textContent).not.toMatch(/^✓/);
  });

  it("does not show the joiner warning when the room WAS created relay-only", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ relayOnly: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        roomId="room-abcdef"
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId("onion-join-warning")).toBeNull();
  });
});

describe("PreviewGate non-onion origin", () => {
  beforeEach(() => {
    setOnionHostname("void.example.com");
  });

  it("leaves initialIceTransportPolicy at the default 'all' for clearnet origins", () => {
    expect(initialIceTransportPolicy()).toBe("all");
  });

  it("does not pre-check the host's relay-only toggle on clearnet origins", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    expect(toggle.textContent).not.toMatch(/^✓/);
    expect(screen.queryByTestId("onion-relay-explanation")).toBeNull();
  });

  it("does not open the confirmation modal when a clearnet host clicks the toggle", () => {
    render(
      <PreviewGate
        voidPhrase={TEST_PHRASE}
        showRelayToggle
        onEnter={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId("relay-only-toggle");
    fireEvent.click(toggle); // off → on, no modal
    expect(screen.queryByTestId("onion-disable-confirm")).toBeNull();
    expect(toggle.textContent).toMatch(/^✓/);
    fireEvent.click(toggle); // on → off, still no modal (no onion gating)
    expect(screen.queryByTestId("onion-disable-confirm")).toBeNull();
    expect(toggle.textContent).not.toMatch(/^✓/);
  });
});
