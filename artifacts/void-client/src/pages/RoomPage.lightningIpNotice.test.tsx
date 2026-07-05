// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #345: the one-time in-room reminder that a clearnet Lightning payment
// linked the host's IP to this room. It must appear ONLY when a fresh paid
// create happened over a .onion origin, must be dismissible, must show at most
// once (the marker is consumed on entry), and must never appear on clearnet.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { markPaidCreateOnion } from "@/lib/paidCreateOnion";
import { roomTestState, createMockSocket, joinRoom } from "./RoomPage.testHelpers";

vi.mock("@/lib/socket", () => ({
  getSocket: () => roomTestState.mockSocket,
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

vi.mock("@/lib/webrtc", async () => {
  const { MockWebRTCManager } = await import("./RoomPage.testHelpers");
  return { WebRTCManager: MockWebRTCManager };
});

vi.mock("@/lib/mediaPipeline", async () => {
  const { makeMediaPipelineMock } = await import("./RoomPage.testHelpers");
  return makeMediaPipelineMock();
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({ default: () => null }));
vi.mock("@/components/RoomShareSheet", () => ({ default: () => null }));
vi.mock("@/components/PaywallModal", () => ({ default: () => null }));

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

beforeEach(() => {
  roomTestState.mockSocket = createMockSocket();
  roomTestState.captured.manager = null;
  sessionStorage.clear();
  // RoomPage's connection hook fetches /api/ice-servers during join; an empty
  // set keeps the join offline and deterministic.
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
  sessionStorage.clear();
});

describe("Task #345 — Lightning IP-linkage in-room reminder", () => {
  it("renders the reminder after a paid create over a .onion origin", async () => {
    setHostname(ONION_HOST);
    markPaidCreateOnion();

    await joinRoom({ isHost: true, peers: [] });

    const note = await screen.findByTestId("lightning-ip-leak-notice");
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/Tor-routed wallet/i);
  });

  it("does NOT render the reminder on a clearnet origin even if the marker is set", async () => {
    setHostname(CLEARNET_HOST);
    markPaidCreateOnion();

    await joinRoom({ isHost: true, peers: [] });

    // Give the mount effect a tick to run before asserting absence.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("lightning-ip-leak-notice")).toBeNull();
  });

  it("does NOT render the reminder on a .onion origin without a paid-create marker", async () => {
    setHostname(ONION_HOST);
    // No markPaidCreateOnion() — e.g. a free resume / recovery entry.

    await joinRoom({ isHost: true, peers: [] });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("lightning-ip-leak-notice")).toBeNull();
  });

  it("is dismissible and stays dismissed (marker already consumed)", async () => {
    setHostname(ONION_HOST);
    markPaidCreateOnion();

    await joinRoom({ isHost: true, peers: [] });

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
    // The marker was consumed on entry, so nothing remains for a re-entry.
    expect(sessionStorage.getItem("void_paid_create_onion")).toBeNull();
  });
});
