// SPDX-License-Identifier: AGPL-3.0-or-later
// End-to-end .onion auto-default contract across PreviewGate → RoomPage.
//
// The unit-level coverage already pins each link in isolation:
//   - PreviewGate.test / onion-defaults.test: the host toggle initialises
//     to `true` on a `.onion` origin and to `false` on clearnet.
//   - onion-defaults.test: `initialIceTransportPolicy()` returns "relay" on
//     onion and "all" on clearnet.
//   - useRoomConnection.reconnect.test: a seeded `iceTransportPolicyRef`
//     reaches the WebRTCManager and every RTCPeerConnection it builds.
//
// What none of them prove is that the value actually SURVIVES the whole
// trip: a future refactor that decouples PreviewGate's toggle from the
// room config, or that stops feeding `initialIceTransportPolicy()` into
// the room's signaling ref, could silently stop enforcing relay-only for
// a Tor user without failing any existing test. These tests render the
// real PreviewGate on a simulated origin, drive its ENTER affordance, and
// then mount the real RoomPage on that SAME origin — asserting both that
// the host toggle came out where it should AND that the RTCPeerConnection
// RoomPage ends up constructing carries the matching iceTransportPolicy.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

type EmitCallback = (result: unknown) => void;

// Records the `iceTransportPolicy` of every RTCPeerConnection the mounted
// RoomPage's WebRTCManager builds. Hoisted so the `vi.mock("@/lib/webrtc")`
// factory below can close over it.
const captured = vi.hoisted(() => ({
  pcConfigs: [] as RTCConfiguration[],
  // The latest `onError` callback RoomPage handed to the media
  // pipeline. The media-error "TRY AGAIN" affordance only appears once
  // a media failure has set RoomPage's `mediaError` state; firing this
  // captured callback is how the tests below reproduce that failure
  // mid-call (exactly as the pipeline's own GOLD blank-frame sanity
  // check would) so they can then drive the retry rebuild.
  pipelineOnError: null as ((err: Error) => void) | null,
}));

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

// Stand-in WebRTCManager. The real manager defers to webrtcPerPeer.buildPC,
// which constructs `new RTCPeerConnection({ iceTransportPolicy })` from the
// policy the manager was built with. This fake mirrors that single,
// privacy-critical behaviour: on `initiateOffer` it records the policy it
// would have handed to the browser. Everything else is an inert stub.
vi.mock("@/lib/webrtc", () => {
  class TestWebRTCManager {
    private policy: RTCIceTransportPolicy;
    constructor(opts: { iceTransportPolicy: RTCIceTransportPolicy }) {
      this.policy = opts.iceTransportPolicy;
    }
    initiateOffer() {
      captured.pcConfigs.push({ iceTransportPolicy: this.policy });
    }
    setLocalMediaState() {}
    destroy() {}
    removePeer() {}
    replaceVideoTrack() {}
    clearVideoOverride() {}
  }
  return { WebRTCManager: TestWebRTCManager };
});

vi.mock("@/lib/mediaPipeline", async () => {
  const { makeMediaPipelineMock } = await import("../pages/RoomPage.testHelpers");
  const base = await makeMediaPipelineMock();
  const baseBuild = base.buildMediaPipeline as (
    ctx: unknown,
    opts?: { onError?: (err: Error) => void },
  ) => Promise<unknown>;
  return {
    ...base,
    // Wrap the shared stub so the media-retry tests can grab the
    // `onError` callback RoomPage wires into the pipeline. Everything
    // else (the fake pipeline object) is delegated unchanged.
    buildMediaPipeline: vi.fn(
      async (ctx: unknown, opts?: { onError?: (err: Error) => void }) => {
        if (opts?.onError) captured.pipelineOnError = opts.onError;
        return baseBuild(ctx, opts);
      },
    ),
  };
});

// PreviewGate (task #368) runs a WebRTC capability probe + Brave check on
// mount. jsdom has no RTCPeerConnection, so without this stub the probe
// returns "no-rtc" and swaps the gate for the browser-blocked screen,
// hiding the relay toggle and the ENTER button we drive here.
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

vi.mock("@/components/PhraseShareModal", () => ({ default: () => null }));
vi.mock("@/components/RecordingDisclosureBanner", () => ({ default: () => null }));
vi.mock("@/components/RoomShareSheet", () => ({ default: () => null }));
vi.mock("@/components/PaywallModal", () => ({ default: () => null }));

import PreviewGate, { type PreviewGateOpts } from "@/pages/PreviewGate";
import {
  roomTestState,
  createMockSocket,
  joinRoom,
  TEST_ROOM,
} from "@/pages/RoomPage.testHelpers";

const TEST_PHRASE = "ability about above absent absorb abstract";
// A v3 onion address: 56 base32 chars + ".onion". Only the final label is
// what `hostnameIsOnion` keys on, but use a realistic shape anyway.
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

const ORIGINAL_MEDIA_DEVICES = (
  navigator as { mediaDevices?: MediaDevices }
).mediaDevices;

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  captured.pcConfigs = [];
  captured.pipelineOnError = null;
  roomTestState.mockSocket = createMockSocket();
  roomTestState.captured.manager = null;
  // RoomPage's "TRY AGAIN" handler re-probes camera+mic via
  // `navigator.mediaDevices.getUserMedia` before re-running the
  // connection effect. jsdom has no real mediaDevices, so the retry
  // tests stub a successful probe; a track-less stream is enough since
  // the handler only stops the tracks it gets back.
  setMediaDevices({
    getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
  });
  // Two fetches happen in these flows and both must resolve
  // deterministically without real network:
  //   - PreviewGate (guest-on-onion) probes `/api/room-state/:code` to
  //     drive the pre-entry warning and release the ENTER gate. We answer
  //     `relayOnly: false` so the joined room is explicitly NOT relay-only
  //     — the worst case the local-enforcement contract must survive.
  //   - RoomPage's connection hook fetches `/api/ice-servers` during join;
  //     an empty set keeps the join offline and deterministic.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : (input as { url?: string }).url ?? String(input);
      if (url.includes("/api/room-state/")) {
        return { ok: true, json: async () => ({ relayOnly: false }) };
      }
      return { ok: true, json: async () => ({ iceServers: [] }) };
    }),
  );
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
  setMediaDevices(ORIGINAL_MEDIA_DEVICES);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// Render PreviewGate as the host, wait for the WebRTC probe to release the
// ENTER button, click it, and return the options the gate emitted.
async function enterViaPreviewGate(): Promise<PreviewGateOpts> {
  const onEnter = vi.fn();
  const { unmount } = render(
    <PreviewGate
      voidPhrase={TEST_PHRASE}
      showRelayToggle
      onEnter={onEnter}
      onCancel={vi.fn()}
    />,
  );

  const enter = screen.getByTestId("enter-room") as HTMLButtonElement;
  await waitFor(() => expect(enter.disabled).toBe(false));
  await act(async () => {
    fireEvent.click(enter);
  });

  expect(onEnter).toHaveBeenCalledTimes(1);
  const opts = onEnter.mock.calls[0][0] as PreviewGateOpts;
  // PreviewGate is unmounted before RoomPage mounts, exactly as the real
  // App swaps the lobby for the room once the host commits.
  unmount();
  return opts;
}

// Render PreviewGate as a GUEST (joiner): a roomId is set and there is
// NO relay toggle, so the gate takes the joiner branch — it fetches
// `/api/room-state/:code`, may render the pre-entry warning, and only
// releases ENTER once that fetch (the onion-joiner gate) and the WebRTC
// probe have both settled. Returns the options the gate emitted.
async function enterViaGuestPreviewGate(
  expectOnionWarning: boolean,
): Promise<PreviewGateOpts> {
  const onEnter = vi.fn();
  const { unmount } = render(
    <PreviewGate
      voidPhrase={TEST_PHRASE}
      roomId={TEST_ROOM}
      onEnter={onEnter}
      onCancel={vi.fn()}
    />,
  );

  const enter = screen.getByTestId("enter-room") as HTMLButtonElement;
  // On a .onion origin ENTER is held by BOTH the WebRTC probe and the
  // onion-joiner room-state gate; on clearnet only the probe holds it.
  await waitFor(() => expect(enter.disabled).toBe(false));

  if (expectOnionWarning) {
    // The visibility requirement: the joiner-on-onion warning must be on
    // screen BEFORE the guest can commit, because the room was created
    // relayOnly:false (peers' IPs may be visible to them) — even though
    // their own side is forced relay-only over Tor.
    expect(screen.getByTestId("onion-join-warning")).toBeInTheDocument();
  } else {
    // A clearnet guest never sees the onion warning.
    expect(screen.queryByTestId("onion-join-warning")).toBeNull();
  }

  await act(async () => {
    fireEvent.click(enter);
  });

  expect(onEnter).toHaveBeenCalledTimes(1);
  const opts = onEnter.mock.calls[0][0] as PreviewGateOpts;
  // PreviewGate is unmounted before RoomPage mounts, exactly as the real
  // App swaps the lobby for the room once the guest commits.
  unmount();
  return opts;
}

// Simulate a live-call reconnect after the guest has joined. RoomPage's
// connection hook installs a `socket.io.on("reconnect", …)` handler that,
// on a circuit drop, destroys the old WebRTCManager, clears the peer
// list, re-emits `join-room`, and rebuilds the manager for every peer the
// rejoin reports. That rebuilt manager reads its `iceTransportPolicy`
// from the signaling hook's `iceTransportPolicyRef` — the SAME origin-
// derived value the first connection used, NOT the room's relayOnly flag.
// This helper fires that handler and answers the reconnect's `join-room`
// with a NON-relay-only room (the worst case): a refactor that re-derived
// the policy from `result.relayOnly` here would silently un-pin the
// guest's relay-only enforcement mid-call and leak their clearnet IP.
async function triggerReconnect(peers: string[]) {
  const ioOnCalls = (roomTestState.mockSocket.io.on as unknown as {
    mock: { calls: unknown[][] };
  }).mock.calls;
  const reconnectEntry = ioOnCalls.find((c) => c[0] === "reconnect");
  expect(reconnectEntry).toBeDefined();
  const handler = reconnectEntry![1] as () => Promise<void>;

  const before = roomTestState.mockSocket.__getEmit("join-room").length;
  await act(async () => {
    await handler();
  });

  // The reconnect handler must have re-emitted `join-room`; answer the
  // newest emit so RoomPage rebuilds the manager and re-offers to peers.
  const joinCalls = roomTestState.mockSocket.__getEmit("join-room");
  expect(joinCalls.length).toBeGreaterThan(before);
  const cb = joinCalls[joinCalls.length - 1][1] as EmitCallback;
  await act(async () => {
    cb({
      success: true,
      peers,
      maxUsers: 4,
      isHost: false,
      relayOnly: false,
      screenSharePeerId: null,
    });
  });
}

// Simulate the media-error "TRY AGAIN" recovery after the guest has
// joined. The reconnect handler is NOT the only path that rebuilds the
// WebRTCManager: RoomPage's media-error affordance calls
// `retryMedia()` in `useRoomConnection`, which bumps `mediaRetryNonce`
// and re-runs the WHOLE connection effect (re-acquire pipeline, rejoin,
// rebuild manager) without remounting RoomPage. That rebuild reads the
// SAME `signaling.iceTransportPolicyRef` the first connection used, NOT
// the room's relayOnly flag — so the same silent-leak risk lives here.
// This helper first reproduces a mid-call media failure (firing the
// pipeline `onError` RoomPage wired in, which sets `mediaError` and
// swaps in the error screen), then drives the real "TRY AGAIN" button
// so `retryMedia` runs, and finally answers the retry's `join-room`
// with a NON-relay-only room (the worst case): a refactor that
// re-derived the policy from `result.relayOnly` here would silently
// un-pin the guest's relay-only enforcement after a retry.
async function triggerMediaRetry(peers: string[]) {
  // 1. Reproduce a mid-call media failure so RoomPage swaps to the
  //    media-error screen (the only place "TRY AGAIN" is rendered).
  expect(captured.pipelineOnError).not.toBeNull();
  await act(async () => {
    captured.pipelineOnError!(new Error("camera lost mid-call"));
  });

  const tryAgain = await screen.findByText("TRY AGAIN");

  // 2. Click "TRY AGAIN". The handler re-probes getUserMedia (stubbed
  //    to succeed) and then calls retryMedia(), re-running the
  //    connection effect in place.
  const before = roomTestState.mockSocket.__getEmit("join-room").length;
  await act(async () => {
    fireEvent.click(tryAgain);
  });

  // 3. The re-run effect must have re-emitted `join-room`; answer the
  //    newest emit so RoomPage rebuilds the manager and re-offers.
  await waitFor(() => {
    expect(
      roomTestState.mockSocket.__getEmit("join-room").length,
    ).toBeGreaterThan(before);
  });
  const joinCalls = roomTestState.mockSocket.__getEmit("join-room");
  const cb = joinCalls[joinCalls.length - 1][1] as EmitCallback;
  await act(async () => {
    cb({
      success: true,
      peers,
      maxUsers: 4,
      isHost: false,
      relayOnly: false,
      screenSharePeerId: null,
    });
  });
}

describe("onion auto-default end-to-end (PreviewGate → RoomPage)", () => {
  it("on a .onion origin the host toggle defaults relay-only ON and RoomPage builds a relay-only RTCPeerConnection", async () => {
    setHostname(ONION_HOST);

    // Mechanism 1: the host toggle initialises ON, so the room the host
    // creates is itself relay-only.
    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(true);

    // Mechanism 2: local ICE enforcement is independent of the room
    // setting. Mount RoomPage on the same onion origin but answer the
    // join with a room that was NOT created relay-only — the local
    // PeerConnection must STILL be pinned to "relay" because
    // `initialIceTransportPolicy()` forces it from the origin alone.
    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin the host toggle defaults relay-only OFF and RoomPage builds an unrestricted RTCPeerConnection", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });

  it("on a .onion origin a GUEST joining a non-relay-only room still builds a relay-only RTCPeerConnection", async () => {
    setHostname(ONION_HOST);

    // The guest takes the joiner branch of PreviewGate: there is no relay
    // toggle to default ON (the room is the host's to configure), so the
    // emitted options carry relayOnly:false. The pre-entry warning must be
    // shown first because the joined room was created NOT relay-only.
    const opts = await enterViaGuestPreviewGate(true);
    expect(opts.relayOnly).toBe(false);

    // The contract under test: regardless of how the room was created
    // (here relayOnly:false) and regardless of the absent toggle, the
    // guest's local PeerConnection must STILL be pinned to "relay" — the
    // origin alone forces it via `initialIceTransportPolicy()`. This is
    // the trip a future refactor could silently break for Tor guests.
    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin a GUEST joining a non-relay-only room builds an unrestricted RTCPeerConnection", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaGuestPreviewGate(false);
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });

  it("on a .onion origin a GUEST's rebuilt RTCPeerConnections stay relay-only after a reconnect", async () => {
    setHostname(ONION_HOST);

    // Same guest trip as above: PreviewGate joiner branch → RoomPage,
    // joining a room that was NOT created relay-only. The first PC is
    // pinned to "relay" by the origin alone.
    const opts = await enterViaGuestPreviewGate(true);
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }

    // The contract under test: a live call drops and reconnects. Only
    // look at the connections RoomPage REBUILDS on the reconnect, so
    // forget the pre-drop ones first.
    captured.pcConfigs = [];

    // Reconnect and answer the rejoin with a fresh peer in a room that
    // is STILL relayOnly:false — exactly the value a refactor might (and
    // must not) feed back into the local policy.
    await triggerReconnect(["peer-yyyyyy-reconnect"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin a GUEST's rebuilt RTCPeerConnections stay unrestricted after a reconnect", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaGuestPreviewGate(false);
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }

    captured.pcConfigs = [];

    await triggerReconnect(["peer-yyyyyy-reconnect"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });

  it("on a .onion origin a GUEST's rebuilt RTCPeerConnections stay relay-only after a media-error TRY AGAIN retry", async () => {
    setHostname(ONION_HOST);

    // Same guest trip as the reconnect case: PreviewGate joiner branch →
    // RoomPage, joining a room that was NOT created relay-only. The first
    // PC is pinned to "relay" by the origin alone.
    const opts = await enterViaGuestPreviewGate(true);
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }

    // The contract under test: a media failure hits mid-call and the
    // guest taps "TRY AGAIN". That rebuilds the manager via retryMedia
    // (NOT the reconnect handler). Only look at the connections RoomPage
    // REBUILDS on the retry, so forget the pre-error ones first.
    captured.pcConfigs = [];

    // Retry and answer the rejoin with a fresh peer in a room that is
    // STILL relayOnly:false — exactly the value a refactor might (and
    // must not) feed back into the local policy on the retry path.
    await triggerMediaRetry(["peer-yyyyyy-retry"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin a GUEST's rebuilt RTCPeerConnections stay unrestricted after a media-error TRY AGAIN retry", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaGuestPreviewGate(false);
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }

    captured.pcConfigs = [];

    await triggerMediaRetry(["peer-yyyyyy-retry"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });

  it("on a .onion origin a HOST's rebuilt RTCPeerConnections stay relay-only after a reconnect", async () => {
    setHostname(ONION_HOST);

    // The host trip: PreviewGate's HOST branch (the relay toggle is
    // shown and defaults ON over Tor) → RoomPage. As with the
    // first-connection host case, mount on the same onion origin but
    // answer the join with a room that was NOT created relay-only — the
    // first PC is still pinned to "relay" by the origin alone.
    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(true);

    await joinRoom({ peers: ["peer-zzzzzz"], isHost: true, relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }

    // The contract under test on the HOST path: a live call drops and
    // reconnects. Only look at the connections RoomPage REBUILDS on the
    // reconnect, so forget the pre-drop ones first.
    captured.pcConfigs = [];

    // Reconnect and answer the rejoin with a fresh peer in a room that
    // is STILL relayOnly:false — exactly the value a refactor might (and
    // must not) feed back into the local policy on a host's reconnect.
    await triggerReconnect(["peer-yyyyyy-reconnect"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin a HOST's rebuilt RTCPeerConnections stay unrestricted after a reconnect", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], isHost: true, relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }

    captured.pcConfigs = [];

    await triggerReconnect(["peer-yyyyyy-reconnect"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });

  it("on a .onion origin a HOST's rebuilt RTCPeerConnections stay relay-only after a media-error TRY AGAIN retry", async () => {
    setHostname(ONION_HOST);

    // Same host trip as the reconnect case: PreviewGate HOST branch →
    // RoomPage, joining a room that was NOT created relay-only. The
    // first PC is pinned to "relay" by the origin alone.
    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(true);

    await joinRoom({ peers: ["peer-zzzzzz"], isHost: true, relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }

    // The contract under test on the HOST path: a media failure hits
    // mid-call and the host taps "TRY AGAIN". That rebuilds the manager
    // via retryMedia (NOT the reconnect handler). Only look at the
    // connections RoomPage REBUILDS on the retry, so forget the
    // pre-error ones first.
    captured.pcConfigs = [];

    // Retry and answer the rejoin with a fresh peer in a room that is
    // STILL relayOnly:false — exactly the value a refactor might (and
    // must not) feed back into the local policy on a host's retry path.
    await triggerMediaRetry(["peer-yyyyyy-retry"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("relay");
    }
  });

  it("on a clearnet origin a HOST's rebuilt RTCPeerConnections stay unrestricted after a media-error TRY AGAIN retry", async () => {
    setHostname(CLEARNET_HOST);

    const opts = await enterViaPreviewGate();
    expect(opts.relayOnly).toBe(false);

    await joinRoom({ peers: ["peer-zzzzzz"], isHost: true, relayOnly: false });
    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }

    captured.pcConfigs = [];

    await triggerMediaRetry(["peer-yyyyyy-retry"]);

    await waitFor(() => expect(captured.pcConfigs.length).toBeGreaterThan(0));
    for (const config of captured.pcConfigs) {
      expect(config.iceTransportPolicy).toBe("all");
    }
  });
});
