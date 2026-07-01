// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performBurnTeardown } from "./burnTeardownSequence";

function makeTrack(kind: "audio" | "video", stopImpl?: () => void) {
  return {
    kind,
    stop: vi.fn(stopImpl ?? (() => {})),
  } as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[]) {
  return { getTracks: () => tracks };
}

interface HarnessOverrides {
  pendingShare?: unknown;
  displayTrack?: MediaStreamTrack | null;
  webrtcDestroy?: () => void;
  pipelineStop?: () => void;
  localTracks?: MediaStreamTrack[];
  stopShareCleanup?: ReturnType<typeof vi.fn>;
  closeAudioContext?: () => Promise<void>;
  drainObjectUrlRegistry?: () => void;
  clearVoidSessionStorage?: () => number;
  clearVoidLocalStorage?: () => number;
  clearVoidCaches?: () => Promise<number>;
}

function makeHarness(o: HarnessOverrides = {}) {
  const pendingShareTrackStop = vi.fn();
  const defaultPending = {
    track: { stop: pendingShareTrackStop },
    stream: { getTracks: () => [] },
  };
  const pendingShareRef = {
    current:
      o.pendingShare === undefined
        ? null
        : (o.pendingShare as typeof defaultPending),
  };
  const displayTrackRef = {
    current: o.displayTrack === undefined ? null : o.displayTrack,
  };
  const webrtcDestroy = vi.fn(o.webrtcDestroy ?? (() => {}));
  const webrtcRef: { current: { destroy: () => void } | null } = {
    current: { destroy: webrtcDestroy },
  };
  const pipelineStop = vi.fn(o.pipelineStop ?? (() => {}));
  const pipelineStopRef: { current: (() => void) | null } = {
    current: pipelineStop,
  };
  const localTracks = o.localTracks ?? [
    makeTrack("audio"),
    makeTrack("video"),
  ];
  const localStreamRef: {
    current: { getTracks: () => MediaStreamTrack[] } | null;
  } = { current: makeStream(localTracks) };
  const stopShareCleanup = o.stopShareCleanup ?? vi.fn();
  const clearPendingShareState = vi.fn();
  const closeAudioContext = vi.fn(o.closeAudioContext ?? (async () => {}));
  const drainObjectUrlRegistry = vi.fn(o.drainObjectUrlRegistry ?? (() => {}));
  const clearVoidSessionStorage = vi.fn(
    o.clearVoidSessionStorage ?? (() => 0),
  );
  const clearVoidLocalStorage = vi.fn(o.clearVoidLocalStorage ?? (() => 0));
  const clearVoidCaches = vi.fn(o.clearVoidCaches ?? (async () => 0));

  return {
    refs: { pendingShareRef, displayTrackRef, webrtcRef, pipelineStopRef, localStreamRef },
    spies: {
      pendingShareTrackStop,
      webrtcDestroy,
      pipelineStop,
      localTracks,
      stopShareCleanup,
      clearPendingShareState,
      closeAudioContext,
      drainObjectUrlRegistry,
      clearVoidSessionStorage,
      clearVoidLocalStorage,
      clearVoidCaches,
    },
    run: () =>
      performBurnTeardown({
        pendingShareRef,
        displayTrackRef,
        webrtcRef,
        pipelineStopRef,
        localStreamRef,
        stopShareCleanup: stopShareCleanup as unknown as (emit: boolean) => void,
        clearPendingShareState,
        closeAudioContext,
        drainObjectUrlRegistry,
        clearVoidSessionStorage,
        clearVoidLocalStorage,
        clearVoidCaches,
      }),
  };
}

describe("performBurnTeardown", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: every step runs, refs are nulled, no failures reported", () => {
    const h = makeHarness({
      pendingShare: {
        track: { stop: vi.fn() },
        stream: { getTracks: () => [{ stop: vi.fn() }] },
      },
      displayTrack: { kind: "video" } as unknown as MediaStreamTrack,
    });
    const { failures } = h.run();
    expect(failures).toEqual([]);

    // Pending share teardown ran and state was cleared.
    expect(h.refs.pendingShareRef.current).toBeNull();
    expect(h.spies.clearPendingShareState).toHaveBeenCalledTimes(1);

    // Active share teardown ran (because displayTrack was set).
    expect(h.spies.stopShareCleanup).toHaveBeenCalledWith(true);

    // Peer connections destroyed and ref nulled.
    expect(h.spies.webrtcDestroy).toHaveBeenCalledTimes(1);
    expect(h.refs.webrtcRef.current).toBeNull();

    // Pipeline stopped and ref nulled.
    expect(h.spies.pipelineStop).toHaveBeenCalledTimes(1);
    expect(h.refs.pipelineStopRef.current).toBeNull();

    // Audio context closed.
    expect(h.spies.closeAudioContext).toHaveBeenCalledTimes(1);

    // Every local track stopped.
    for (const t of h.spies.localTracks) {
      expect(t.stop).toHaveBeenCalledTimes(1);
    }
    expect(h.refs.localStreamRef.current).toBeNull();

    // Storage residue cleared.
    expect(h.spies.drainObjectUrlRegistry).toHaveBeenCalledTimes(1);
    expect(h.spies.clearVoidSessionStorage).toHaveBeenCalledTimes(1);
    expect(h.spies.clearVoidLocalStorage).toHaveBeenCalledTimes(1);
    expect(h.spies.clearVoidCaches).toHaveBeenCalledTimes(1);
  });

  it("skips active-share teardown when displayTrack is null and skips pending-share state-clear when no pending", () => {
    const h = makeHarness({ pendingShare: null, displayTrack: null });
    const { failures } = h.run();
    expect(failures).toEqual([]);
    expect(h.spies.stopShareCleanup).not.toHaveBeenCalled();
    expect(h.spies.clearPendingShareState).not.toHaveBeenCalled();
  });

  it("partial-failure: a thrown webrtc.destroy() does NOT abort pipeline/track/storage teardown (Task #311)", () => {
    const h = makeHarness({
      webrtcDestroy: () => {
        throw new Error("destroy boom");
      },
    });
    const { failures } = h.run();
    expect(failures).toContain("peer connections");
    // The ref was still nulled BEFORE destroy() threw — the inline
    // code orders it that way so the unmount effect cannot re-enter.
    expect(h.refs.webrtcRef.current).toBeNull();
    // Subsequent steps still ran.
    expect(h.spies.pipelineStop).toHaveBeenCalled();
    expect(h.spies.closeAudioContext).toHaveBeenCalled();
    for (const t of h.spies.localTracks) {
      expect(t.stop).toHaveBeenCalled();
    }
    expect(h.spies.clearVoidSessionStorage).toHaveBeenCalled();
  });

  it("partial-failure: a thrown pipeline.stop() leaves the ref nulled and continues into storage teardown", () => {
    const h = makeHarness({
      pipelineStop: () => {
        throw new Error("pipeline boom");
      },
    });
    const { failures } = h.run();
    expect(failures).toContain("media pipeline");
    expect(h.refs.pipelineStopRef.current).toBeNull();
    expect(h.spies.closeAudioContext).toHaveBeenCalled();
    expect(h.spies.drainObjectUrlRegistry).toHaveBeenCalled();
  });

  it("partial-failure: a thrown track.stop() is reported per-kind and every other track still stops", () => {
    const goodAudio = makeTrack("audio");
    const badVideo = makeTrack("video", () => {
      throw new Error("track frozen");
    });
    const goodVideo2 = makeTrack("video");
    const h = makeHarness({ localTracks: [goodAudio, badVideo, goodVideo2] });
    const { failures } = h.run();
    expect(failures).toContain("local video track");
    expect(failures).not.toContain("local audio track");
    expect(goodAudio.stop).toHaveBeenCalled();
    expect(badVideo.stop).toHaveBeenCalled();
    expect(goodVideo2.stop).toHaveBeenCalled();
    expect(h.refs.localStreamRef.current).toBeNull();
  });

  it("partial-failure: a thrown clearVoidSessionStorage does not stop clearVoidLocalStorage / clearVoidCaches", () => {
    const h = makeHarness({
      clearVoidSessionStorage: () => {
        throw new Error("storage disabled");
      },
    });
    const { failures } = h.run();
    expect(failures).toContain("sessionStorage");
    expect(h.spies.clearVoidLocalStorage).toHaveBeenCalled();
    expect(h.spies.clearVoidCaches).toHaveBeenCalled();
  });

  it("an async closeAudioContext rejection does NOT throw out of the teardown (rejection is handled in-place)", async () => {
    const h = makeHarness({
      closeAudioContext: async () => {
        throw new Error("close rejected");
      },
    });
    const { failures } = h.run();
    // The closeAudioContext rejection is logged via .catch, not
    // surfaced as a failure label, because safe() only catches sync
    // throws and the rejection is intentionally swallowed.
    expect(failures).not.toContain("audio context");
    // Make sure the rejection settles without bringing down the test.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spies.closeAudioContext).toHaveBeenCalled();
  });

  it("collects multiple failures in order so the BURN INCOMPLETE banner can list them", () => {
    const h = makeHarness({
      webrtcDestroy: () => {
        throw new Error("a");
      },
      pipelineStop: () => {
        throw new Error("b");
      },
      drainObjectUrlRegistry: () => {
        throw new Error("c");
      },
    });
    const { failures } = h.run();
    expect(failures).toEqual([
      "peer connections",
      "media pipeline",
      "object URL registry",
    ]);
  });
});
