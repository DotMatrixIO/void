// SPDX-License-Identifier: AGPL-3.0-or-later
// Tor circuit-degradation resilience tests (Task #748).
//
// These exercise the REAL `useRoomConnection` reconnect path against a
// deterministic socket.io transport mock (`mockTransport.ts`) — NO real
// Tor, no SOCKS proxy. They pin three invariants that protect a VOID
// call on a slow/jittery circuit:
//
//   (a) RECONNECT WITHIN BUDGET. A socket dropped under high latency
//       with several failed reconnect attempts still rejoins the room
//       within the origin-aware budget (`reconnectBudgetMs`).
//   (b) NO DUPLICATE TILES. The peer list never holds two entries for
//       the same peer ID across a reconnect, and the previous
//       RTCPeerConnection is closed BEFORE a new one is built.
//   (c) RELAY-ONLY PERSISTS. After reconnecting on a `.onion` origin,
//       every RTCPeerConnection — including ones built for a peer that
//       joins AFTER the reconnect — keeps `iceTransportPolicy: "relay"`.
//       This is privacy-critical: a regression here leaks a Tor user's
//       host/srflx candidates, so it must fail loudly.
//
// See docs/tor-reconnect-notes.md for the baseline characterization and
// the derivation of the pinned budgets.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { MockSocketTransport } from "@/lib/test-utils/mockTransport";
import {
  reconnectBudgetMs,
  CLEARNET_RECONNECT_BUDGET_MS,
  ONION_RECONNECT_BUDGET_MS,
} from "@/lib/reconnectBudget";
import {
  RENDEZVOUS_EPOCH_MS,
  currentRendezvousEpoch,
  deriveRendezvousHandle,
  rendezvousCreateCode,
} from "@/lib/rendezvous";

// ─── Module mocks ──────────────────────────────────────────────────────
// getSocket() returns whichever transport the active test installed.
const hoisted = vi.hoisted(() => ({
  transport: null as MockSocketTransport | null,
}));
vi.mock("@/lib/socket", () => ({
  getSocket: () => hoisted.transport,
  disconnectSocket: () => {},
}));
vi.mock("@/lib/sounds", () => ({
  getAudioContext: () => ({}) as unknown as AudioContext,
  closeAudioContext: async () => {},
}));
vi.mock("@/lib/uiSounds", () => ({
  uiBleep: () => {},
  uiBloop: () => {},
  uiSlide: () => {},
  uiClick: () => {},
}));
vi.mock("@/lib/hostTokenStorage", () => ({
  loadHostToken: async () => null,
}));
// Camera pipeline acquire/apply — return a fake pipeline and wire the
// media refs the reconnect path guards on (`localStreamRef`).
vi.mock("./cameraPipelineSetup", () => ({
  acquireCameraPipeline: async () => ({
    ok: true,
    pipeline: {
      processedStream: {
        getTracks: () => [],
        getAudioTracks: () => [],
        getVideoTracks: () => [],
      } as unknown as MediaStream,
      stop: () => {},
    },
  }),
  applyCameraPipelineToMedia: (
    pipeline: { processedStream: MediaStream; stop: () => void },
    media: { localStreamRef: { current: MediaStream | null }; pipelineStopRef: { current: (() => void) | null } },
  ) => {
    media.localStreamRef.current = pipeline.processedStream;
    media.pipelineStopRef.current = pipeline.stop;
  },
  mapPipelineErrorToLabel: (e: Error) => e.message,
}));

// Now import the hook under test (after the mocks are registered).
import { useRoomConnection } from "./useRoomConnection";
import type { UseRoomConnectionOptions } from "./useRoomConnection";
import type { WebRTCManager } from "@/lib/webrtc";

// ─── RTCPeerConnection / MediaStream fakes that log lifecycle ──────────
interface PcEvent {
  type: "construct" | "close";
  policy?: RTCIceTransportPolicy;
}
let pcEvents: PcEvent[] = [];
let pcConstructorConfigs: RTCConfiguration[] = [];

class FakePC {
  onicecandidate: ((e: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((e: { track: MediaStreamTrack }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((e: { channel: unknown }) => void) | null = null;
  connectionState: RTCPeerConnectionState = "new";
  constructor(config?: RTCConfiguration) {
    pcConstructorConfigs.push(config ?? {});
    pcEvents.push({ type: "construct", policy: config?.iceTransportPolicy });
  }
  addTrack() {
    return {} as RTCRtpSender;
  }
  getSenders() {
    return [];
  }
  getReceivers() {
    return [];
  }
  async getStats() {
    return new Map();
  }
  createDataChannel() {
    return {
      onmessage: null,
      onclose: null,
      readyState: "connecting",
      send() {},
      close() {},
    };
  }
  async createOffer() {
    return { type: "offer", sdp: "" };
  }
  async setLocalDescription() {}
  close() {
    this.connectionState = "closed";
    pcEvents.push({ type: "close" });
  }
}

class FakeMediaStream {
  getTracks() {
    return [];
  }
  addTrack() {}
}

// ─── Hand fakes for the cohort hook APIs the connection effect touches ──
function makeFakeMedia() {
  return {
    localStreamRef: { current: null as MediaStream | null },
    micMutedRef: { current: false },
    camOffRef: { current: false },
    voiceModeRef: { current: 0 },
    webrtcRef: { current: null as WebRTCManager | null },
    displayTrackRef: { current: null as MediaStreamTrack | null },
    screenShareWatermarkRef: { current: null as { track: MediaStreamTrack } | null },
    pendingShareRef: { current: null },
    pipelineStopRef: { current: null as (() => void) | null },
    setVideoStyleRef: { current: null },
    setVoiceModeRef: { current: null },
    shareNoticeTimerRef: { current: null },
    markVideoStyleDisabled: vi.fn(),
    setScreenSharePeerId: vi.fn(),
    setShareNotice: vi.fn(),
  };
}

function makeFakeCrypto() {
  return {
    e2eKeyRef: { current: null as CryptoKey | null },
    handleRekeyRef: { current: vi.fn() },
    peerKeyFingerprintsRef: { current: {} as Record<string, string> },
    resetPhraseChangeTracking: vi.fn(),
    setCryptoMismatch: vi.fn(),
    setPeerSAS: vi.fn(),
    setPeerVerification: vi.fn(),
    setPhraseChangedNotice: vi.fn(),
    setSecureChannelFailures: vi.fn(),
    setVerificationAnchor: vi.fn(),
    setVerificationOpenFor: vi.fn(),
  };
}

// Signaling fake: a real `setPeers` that applies updater functions and
// records every snapshot (so we can assert the no-duplicate invariant),
// plus a real `iceTransportPolicyRef` we seed for the onion test.
function makeFakeSignaling(policy: RTCIceTransportPolicy) {
  let peers: string[] = [];
  const peerSnapshots: string[][] = [];
  const setPeers = (action: string[] | ((prev: string[]) => string[])) => {
    peers = typeof action === "function" ? action(peers) : action;
    peerSnapshots.push([...peers]);
  };
  return {
    api: {
      setPeers,
      setJoined: vi.fn(),
      setIsHost: vi.fn(),
      setHostPresent: vi.fn(),
      setHostPeerId: vi.fn(),
      setMaxUsers: vi.fn(),
      setRoomLocked: vi.fn(),
      setKnockMode: vi.fn(),
      setKnockPending: vi.fn(),
      setPendingKnocks: vi.fn(),
      setRelayOnly: vi.fn(),
      setRelayRequestSent: vi.fn(),
      setPendingRelayRequests: vi.fn(),
      setRelayRequestedBy: vi.fn(),
      setPeerMediaState: vi.fn(),
      flashRelayResponseNotice: vi.fn(),
      isHostRef: { current: false },
      iceTransportPolicyRef: { current: policy },
      relayRequestedByTimerRef: { current: null },
      relayResponseNoticeTimerRef: { current: null },
    },
    getPeers: () => peers,
    getPeerSnapshots: () => peerSnapshots,
  };
}

// Build a full options object for the hook from the cohort fakes.
function makeOptions(opts: {
  transport: MockSocketTransport;
  myPeerId: string;
  onionOrigin: boolean;
  policy: RTCIceTransportPolicy;
  roomCode?: string;
  roomType?: "human" | "agent" | "hybrid";
}) {
  const media = makeFakeMedia();
  const crypto = makeFakeCrypto();
  const signaling = makeFakeSignaling(opts.policy);
  const roomCode = opts.roomCode ?? "room-abcdef";
  const options = {
    confirmed: true,
    isSnapshot: false,
    roomCode,
    roomType: opts.roomType,
    wireCodeRef: { current: roomCode },
    voidPhrase: "phrase",
    e2eKey: {} as CryptoKey,
    peerIdRef: { current: opts.myPeerId },
    peerTagRef: { current: "TAG-1" },
    onionOrigin: opts.onionOrigin,
    media,
    crypto,
    signaling: signaling.api,
    stopShareCleanup: vi.fn(),
    performLocalBurn: vi.fn(),
    handleSessionExpired: vi.fn(),
    startCountdown: vi.fn(),
    stopCountdown: vi.fn(),
    startWaitHintCycle: vi.fn(),
    flashExtendNotice: vi.fn(),
    resetExpiryWarning: vi.fn(),
    setRoomTier: vi.fn(),
    setRemoteStreams: vi.fn(),
    setPeerConnectionStates: vi.fn(),
    setPeerRelayPinned: vi.fn(),
    setPeerJoinTrigger: vi.fn(),
    setDropText: vi.fn(),
    setError: vi.fn(),
    setMediaError: vi.fn(),
    setNoTurnConfigured: vi.fn(),
    onLeave: vi.fn(),
  } as unknown as UseRoomConnectionOptions;
  return { options, media, crypto, signaling };
}

// A join-room ack responder that reports the given peer set.
function joinAck(peers: string[]) {
  return () => ({
    success: true,
    peers,
    maxUsers: 4,
    isHost: false,
    hostPresent: true,
    hostPeerId: null,
    screenSharePeerId: null,
  });
}

beforeEach(() => {
  pcEvents = [];
  pcConstructorConfigs = [];
  // @ts-expect-error - jsdom polyfill
  globalThis.RTCPeerConnection = FakePC;
  // @ts-expect-error - jsdom polyfill
  globalThis.MediaStream = FakeMediaStream;
  globalThis.fetch = vi.fn(async () => ({
    json: async () => ({ iceServers: [] }),
  })) as unknown as typeof fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  hoisted.transport = null;
});

// The REAL setTimeout, captured at module-evaluation time — before any
// test installs fake timers. Used to yield a genuine macrotask so
// promises that resolve off the JS thread (crypto.subtle HKDF in
// `rendezvousJoinCandidates`, run on Node's threadpool) can settle while
// fake timers are active. `vi.advanceTimersByTimeAsync` only flushes
// microtasks between fake-timer firings, so without this yield the
// setup() chain races the real threadpool and the join lands (or not)
// nondeterministically — the root cause of the historical flake here.
const realSetTimeout = globalThis.setTimeout;
function yieldRealMacrotask(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

// Interleave real-macrotask yields with fake-timer advancement until
// `predicate()` holds. Deterministic: the fake clock only ever advances
// in fixed steps, and the loop stops the moment the condition is met.
async function pumpUntil(
  predicate: () => boolean,
  { stepMs = 50, maxSteps = 400 }: { stepMs?: number; maxSteps?: number } = {},
): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    // Let threadpool-backed promises (crypto.subtle) settle first.
    await yieldRealMacrotask();
    await yieldRealMacrotask();
    if (predicate()) return;
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  await yieldRealMacrotask();
  if (!predicate()) {
    throw new Error(
      `pumpUntil: condition not met after ${maxSteps} steps of ${stepMs}ms fake time`,
    );
  }
}

// Render the hook and pump until the initial join-room ack has resolved
// (camera acquire + host-token load + HKDF handle derivation are async,
// then a `latencyMs * 2` round-trip). Returns once `webrtcRef` is
// populated and the peer list has been applied.
async function joinInitial(
  harness: ReturnType<typeof makeOptions>,
  transport: MockSocketTransport,
) {
  renderHook(() => useRoomConnection(harness.options));
  await pumpUntil(() => harness.media.webrtcRef.current !== null, {
    // Step small relative to the join round-trip so we never overshoot
    // meaningfully, but bound total fake time well past latencyMs * 2.
    stepMs: Math.max(50, Math.ceil(transport.latencyMs / 10)),
  });
}

describe("useRoomConnection — Tor reconnect budget", () => {
  it("rejoins within the ONION budget under high latency + multiple failed attempts", async () => {
    const transport = new MockSocketTransport({
      latencyMs: 2000, // multi-second onion round-trip
      failedReconnectAttempts: 3, // jittery: several attempts fail first
    });
    transport.setAckResponder("join-room", joinAck(["peer-aaaaaa"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz", // sorts AFTER remotes → initiateOffer is a no-op
      onionOrigin: true,
      policy: "relay",
    });
    await joinInitial(harness, transport);
    expect(harness.media.webrtcRef.current).not.toBeNull();
    expect(harness.signaling.getPeers()).toEqual(["peer-aaaaaa"]);

    // The mock's modeled worst-case Tor drop→rejoin must fit the budget.
    const modelled = transport.timeToRejoinMs();
    expect(modelled).toBeLessThanOrEqual(ONION_RECONNECT_BUDGET_MS);

    // Drop the socket and play out the reconnection backoff timeline.
    // (The peer list is cleared by the reconnect handler, not on the bare
    // disconnect — verified via the no-duplicate-snapshot assertions.)
    transport.disconnectAbruptly();
    transport.reconnect();

    // Advance exactly the modelled rejoin time — the code must have
    // rejoined by now (so the real rejoin completes within budget).
    await vi.advanceTimersByTimeAsync(modelled);
    expect(harness.signaling.getPeers()).toEqual(["peer-aaaaaa"]);
    expect(harness.media.webrtcRef.current).not.toBeNull();
  });

  it("rejoins within the CLEARNET budget on a fast link", async () => {
    const transport = new MockSocketTransport({
      latencyMs: 150,
      failedReconnectAttempts: 1,
    });
    transport.setAckResponder("join-room", joinAck(["peer-aaaaaa"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
    });
    await joinInitial(harness, transport);

    const modelled = transport.timeToRejoinMs();
    expect(modelled).toBeLessThanOrEqual(CLEARNET_RECONNECT_BUDGET_MS);

    transport.disconnectAbruptly();
    transport.reconnect();
    await vi.advanceTimersByTimeAsync(modelled);
    expect(harness.signaling.getPeers()).toEqual(["peer-aaaaaa"]);
  });
});

describe("useRoomConnection — no duplicate tiles across reconnect", () => {
  it("never lists a peer twice and tears the old PC down before building a new one", async () => {
    const transport = new MockSocketTransport({
      latencyMs: 1000,
      failedReconnectAttempts: 2,
    });
    // The same peer is present before AND after the drop — the classic
    // duplicate-tile trigger.
    transport.setAckResponder("join-room", joinAck(["peer-aaaaaa"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
    });
    await joinInitial(harness, transport);

    // Build a live PC on the first manager for the existing peer so the
    // teardown ordering is observable (initiateOffer is a no-op here
    // because myPeerId sorts last).
    const firstManager = harness.media.webrtcRef.current as unknown as {
      buildPC: (peerId: string) => RTCPeerConnection;
    };
    firstManager.buildPC("peer-aaaaaa");
    expect(pcEvents).toEqual([{ type: "construct", policy: "all" }]);

    // Drop + reconnect with the same peer returning.
    transport.disconnectAbruptly();
    transport.reconnect();
    await vi.advanceTimersByTimeAsync(transport.timeToRejoinMs());

    // A brand-new manager exists and the peer list is repopulated.
    expect(harness.media.webrtcRef.current).not.toBeNull();
    expect(harness.signaling.getPeers()).toEqual(["peer-aaaaaa"]);

    // Invariant (a): no snapshot ever held a duplicate ID.
    for (const snapshot of harness.signaling.getPeerSnapshots()) {
      expect(new Set(snapshot).size).toBe(snapshot.length);
    }

    // Invariant (b): the old PC was closed before any new PC was built.
    // Build a PC on the new manager for the same peer and check ordering.
    const newManager = harness.media.webrtcRef.current as unknown as {
      buildPC: (peerId: string) => RTCPeerConnection;
    };
    newManager.buildPC("peer-aaaaaa");
    const firstClose = pcEvents.findIndex((e) => e.type === "close");
    const lastConstruct = pcEvents.length - 1; // the buildPC we just did
    expect(pcEvents[lastConstruct].type).toBe("construct");
    expect(firstClose).toBeGreaterThanOrEqual(0);
    expect(firstClose).toBeLessThan(lastConstruct);
  });
});

describe("useRoomConnection — relay-only persists across reconnect (.onion)", () => {
  it("keeps iceTransportPolicy 'relay' on the rebuilt manager and on late-joiner PCs", async () => {
    const transport = new MockSocketTransport({
      latencyMs: 2000,
      failedReconnectAttempts: 2,
    });
    transport.setAckResponder("join-room", joinAck(["peer-aaaaaa"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: true,
      policy: "relay",
    });
    await joinInitial(harness, transport);

    // Pre-drop sanity: the first manager is relay-pinned.
    expect(
      (harness.media.webrtcRef.current as unknown as { iceTransportPolicy: string })
        .iceTransportPolicy,
    ).toBe("relay");

    transport.disconnectAbruptly();
    transport.reconnect();
    await vi.advanceTimersByTimeAsync(transport.timeToRejoinMs());

    const newManager = harness.media.webrtcRef.current;
    expect(newManager).not.toBeNull();
    // The rebuilt manager MUST still be relay-pinned — the policy ref is
    // never reset by the reconnect path.
    expect(
      (newManager as unknown as { iceTransportPolicy: string }).iceTransportPolicy,
    ).toBe("relay");

    // A peer that joins AFTER the reconnect gets a PC built by the new
    // manager — it too must be relay-only (privacy-critical).
    pcConstructorConfigs = [];
    (newManager as unknown as { buildPC: (peerId: string) => RTCPeerConnection }).buildPC(
      "peer-bbbbbb-late",
    );
    expect(pcConstructorConfigs).toHaveLength(1);
    expect(pcConstructorConfigs[0].iceTransportPolicy).toBe("relay");

    // And the policy ref the manager factory reads is still "relay".
    expect(harness.signaling.api.iceTransportPolicyRef.current).toBe("relay");
  });
});

describe("useRoomConnection — knock-approved gates on the wire handle (Task #1024)", () => {
  it("admits a knocker when knock-approved carries the rotated wire handle, and ignores one carrying the durable roomCode", async () => {
    const transport = new MockSocketTransport({
      latencyMs: 150,
      failedReconnectAttempts: 0,
    });
    transport.setAckResponder("join-room", joinAck([]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
    });
    await joinInitial(harness, transport);

    // For a human room the durable phrase-derived id and the rotating wire
    // handle DIFFER. Pin them to distinct sentinels so the knock-approved
    // gate is observable — the server emits the wire handle it routed on,
    // never the durable roomCode.
    const DURABLE = "room-abcdef";
    const WIRE = "ffeeddccbbaa00112233445566778899";
    harness.options.wireCodeRef.current = WIRE;

    const setKnockPending = harness.signaling.api
      .setKnockPending as ReturnType<typeof vi.fn>;
    const setJoined = harness.signaling.api.setJoined as ReturnType<typeof vi.fn>;
    setKnockPending.mockClear();
    setJoined.mockClear();

    // A stale gate on the durable roomCode would wrongly accept this frame.
    // With the wire-handle gate it must be dropped: the knocker stays pending.
    transport.emitServerEvent("knock-approved", {
      code: DURABLE,
      peers: ["peer-aaaaaa"],
    });
    expect(setKnockPending).not.toHaveBeenCalled();
    expect(setJoined).not.toHaveBeenCalled();
    expect(harness.signaling.getPeers()).toEqual([]);

    // The real server frame carries the routed wire handle — this admits us.
    transport.emitServerEvent("knock-approved", {
      code: WIRE,
      peers: ["peer-aaaaaa"],
    });
    expect(setKnockPending).toHaveBeenCalledWith(false);
    expect(setJoined).toHaveBeenCalledWith(true);
    expect(harness.signaling.getPeers()).toEqual(["peer-aaaaaa"]);
  });
});

// ─── Day-boundary convergence (Task #1031) ────────────────────────────
//
// Human rooms route on a per-epoch (24h) rendezvous handle. A joiner
// probes an ordered window — current epoch, then previous, then next —
// advancing ONLY on ROOM_NOT_FOUND and freezing on the first candidate
// that yields any other ack. These tests simulate a host registered
// under one epoch and a joiner whose wall clock sits in an adjacent
// epoch, then assert the joiner converges on the EXACT wire handle the
// host registered under (`rendezvousCreateCode`), end-to-end through the
// real `useRoomConnection` windowed-join path.

// A valid 32-lowercase-hex durable roomId so the real HKDF handle
// derivation runs (the default "room-abcdef" fixture is not hex).
const DURABLE_ROOM_ID = "0123456789abcdef0123456789abcdef";

// A join-room ack responder that admits ONLY the given wire handle (the
// one the host registered under). Every other candidate — i.e. every
// other epoch in the joiner's probe window — looks like a dead room, so
// the joiner must keep advancing until it hits the host's handle.
function epochScopedJoinAck(hostHandle: string, peers: string[]) {
  return (payload: unknown) => {
    const code = (payload as { code: string }).code;
    if (code === hostHandle) {
      return {
        success: true,
        peers,
        maxUsers: 4,
        isHost: false,
        hostPresent: true,
        hostPeerId: peers[0] ?? null,
        screenSharePeerId: null,
      };
    }
    return { success: false, error: "ROOM_NOT_FOUND", peers: [] };
  };
}

// The ordered list of wire handles join-room was actually emitted under.
function emittedJoinCodes(transport: MockSocketTransport): string[] {
  return transport.emitted
    .filter((e) => e.event === "join-room")
    .map((e) => (e.payload as { code: string }).code);
}

// Mid-epoch wall-clock instant for a given epoch index (so no rounding
// lands us on a boundary).
function midEpochMs(epoch: number): number {
  return epoch * RENDEZVOUS_EPOCH_MS + RENDEZVOUS_EPOCH_MS / 2;
}

describe("useRoomConnection — day-boundary handle convergence (Task #1031)", () => {
  // These tests drive the REAL windowed-join path, whose candidate
  // derivation runs HKDF (`crypto.subtle.deriveBits`) — a macrotask that
  // does not settle reliably under fake timers. So we run on real timers
  // and pin the clock by mocking `Date.now` instead of `setSystemTime`
  // (which requires fake timers). The chosen epoch index is arbitrary and
  // fixed, so the test is deterministic regardless of the real wall clock.
  let nowSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    // The shared beforeEach installed fake timers; the join round-trips
    // here are tiny and real, so swap back to real timers.
    vi.useRealTimers();
  });

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = null;
  });

  function pinClock(epoch: number): void {
    nowSpy = vi.spyOn(Date, "now").mockReturnValue(midEpochMs(epoch));
  }

  // Poll (on real timers) until the windowed join has frozen a wire
  // handle different from the durable seed, or we give up.
  async function waitForJoinSettled(
    wireCodeRef: { current: string },
    seed: string,
    transport: MockSocketTransport,
  ): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (wireCodeRef.current !== seed) return;
      await new Promise((r) => setTimeout(r, transport.latencyMs));
    }
  }

  it("converges on the host's PREVIOUS-epoch handle when the joiner has crossed midnight", async () => {
    const joinerEpoch = 20000; // arbitrary, fixed epoch index
    const hostEpoch = joinerEpoch - 1; // host created just before midnight
    pinClock(joinerEpoch);

    // The handle the host actually registered under (one epoch earlier).
    const hostHandle = await rendezvousCreateCode(
      DURABLE_ROOM_ID,
      midEpochMs(hostEpoch),
    );

    // Sanity: across the boundary the host's handle IS the joiner's
    // previous-epoch candidate, and differs from its current-epoch one.
    const joinerCurrent = await deriveRendezvousHandle(DURABLE_ROOM_ID, joinerEpoch);
    const joinerPrev = await deriveRendezvousHandle(DURABLE_ROOM_ID, hostEpoch);
    expect(hostHandle).toBe(joinerPrev);
    expect(hostHandle).not.toBe(joinerCurrent);

    const transport = new MockSocketTransport({ latencyMs: 5, failedReconnectAttempts: 0 });
    transport.setAckResponder("join-room", epochScopedJoinAck(hostHandle, ["peer-host"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
      roomCode: DURABLE_ROOM_ID,
      roomType: "human",
    });
    renderHook(() => useRoomConnection(harness.options));
    await waitForJoinSettled(harness.options.wireCodeRef, DURABLE_ROOM_ID, transport);

    // Convergence: the joiner froze onto the EXACT handle the host
    // registered under, and landed in the room with the host.
    expect(harness.options.wireCodeRef.current).toBe(hostHandle);
    expect(harness.signaling.getPeers()).toEqual(["peer-host"]);

    // advance-only-on-ROOM_NOT_FOUND: it probed the current epoch first
    // (dead), then the previous epoch (the host) — and froze there. The
    // next-epoch candidate was never tried.
    expect(emittedJoinCodes(transport)).toEqual([joinerCurrent, hostHandle]);
  });

  it("converges on the host's NEXT-epoch handle when the joiner's clock lags the host", async () => {
    // The joiner's wall clock lags a full epoch behind the host's, so the
    // host's handle is the joiner's NEXT-epoch (e+1) candidate — reached
    // only after the current and previous candidates miss.
    const joinerEpoch = 20000;
    const hostEpoch = joinerEpoch + 1;
    pinClock(joinerEpoch);

    const hostHandle = await rendezvousCreateCode(
      DURABLE_ROOM_ID,
      midEpochMs(hostEpoch),
    );

    const joinerCurrent = await deriveRendezvousHandle(DURABLE_ROOM_ID, joinerEpoch);
    const joinerPrev = await deriveRendezvousHandle(DURABLE_ROOM_ID, joinerEpoch - 1);
    const joinerNext = await deriveRendezvousHandle(DURABLE_ROOM_ID, hostEpoch);
    expect(hostHandle).toBe(joinerNext);

    const transport = new MockSocketTransport({ latencyMs: 5, failedReconnectAttempts: 0 });
    transport.setAckResponder("join-room", epochScopedJoinAck(hostHandle, ["peer-host"]));
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
      roomCode: DURABLE_ROOM_ID,
      roomType: "human",
    });
    renderHook(() => useRoomConnection(harness.options));
    await waitForJoinSettled(harness.options.wireCodeRef, DURABLE_ROOM_ID, transport);

    expect(harness.options.wireCodeRef.current).toBe(hostHandle);
    expect(harness.signaling.getPeers()).toEqual(["peer-host"]);

    // All three candidates were probed in order; the joiner advanced past
    // the two dead epochs and froze on the host's (next) handle.
    expect(emittedJoinCodes(transport)).toEqual([
      joinerCurrent,
      joinerPrev,
      hostHandle,
    ]);
  });

  it("freezes on the FIRST non-ROOM_NOT_FOUND ack and probes no further (terminal rule)", async () => {
    // Even a definitive *error* on the current-epoch handle is terminal:
    // the joiner must NOT keep walking the window looking for a friendlier
    // ack. Here the current epoch reports ROOM_LOCKED — the joiner freezes
    // on that handle and never probes the neighbouring epochs.
    const joinerEpoch = 20000;
    pinClock(joinerEpoch);

    const currentHandle = await deriveRendezvousHandle(DURABLE_ROOM_ID, joinerEpoch);

    const transport = new MockSocketTransport({ latencyMs: 5, failedReconnectAttempts: 0 });
    transport.setAckResponder("join-room", (payload) => {
      const code = (payload as { code: string }).code;
      if (code === currentHandle) {
        return { success: false, error: "ROOM_LOCKED", peers: [] };
      }
      return { success: false, error: "ROOM_NOT_FOUND", peers: [] };
    });
    hoisted.transport = transport;

    const harness = makeOptions({
      transport,
      myPeerId: "peer-zzzzzz",
      onionOrigin: false,
      policy: "all",
      roomCode: DURABLE_ROOM_ID,
      roomType: "human",
    });
    renderHook(() => useRoomConnection(harness.options));
    await waitForJoinSettled(harness.options.wireCodeRef, DURABLE_ROOM_ID, transport);

    // Frozen on the current-epoch handle after a single probe.
    expect(harness.options.wireCodeRef.current).toBe(currentHandle);
    expect(emittedJoinCodes(transport)).toEqual([currentHandle]);
    expect(
      harness.options.setError as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledWith("ROOM LOCKED");
  });
});

describe("reconnectBudgetMs — origin-aware SLA", () => {
  const original = globalThis.location;
  afterEach(() => {
    Object.defineProperty(globalThis, "location", {
      value: original,
      configurable: true,
    });
  });

  function setHostname(hostname: string) {
    Object.defineProperty(globalThis, "location", {
      value: { ...original, hostname, href: `https://${hostname}/` },
      configurable: true,
    });
  }

  it("returns the onion budget on a .onion hostname and clearnet otherwise", () => {
    setHostname("voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion");
    expect(reconnectBudgetMs()).toBe(ONION_RECONNECT_BUDGET_MS);

    setHostname("void.example.com");
    expect(reconnectBudgetMs()).toBe(CLEARNET_RECONNECT_BUDGET_MS);
  });

  it("pins the clearnet budget strictly shorter than the onion budget", () => {
    expect(CLEARNET_RECONNECT_BUDGET_MS).toBeLessThan(ONION_RECONNECT_BUDGET_MS);
  });
});
