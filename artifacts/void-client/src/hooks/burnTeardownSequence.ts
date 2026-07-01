// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  stopPendingShare,
  clearVoidSessionStorage as defaultClearVoidSessionStorage,
  clearVoidLocalStorage as defaultClearVoidLocalStorage,
  clearVoidCaches as defaultClearVoidCaches,
  type PendingShareLike,
} from "@/lib/burnTeardown";
import { closeAudioContext as defaultCloseAudioContext } from "@/lib/sounds";
import { drainObjectUrlRegistry as defaultDrainObjectUrlRegistry } from "@/lib/objectUrlRegistry";

// Task #501: extracted from RoomPage.tsx's `performLocalBurn`. This
// module owns the privacy-critical release sequence — every track,
// pipeline, watermark, peer connection, and storage residue gets
// torn down in order, and a single failure cannot abort the rest.
//
// Pulling the safe() loop out of RoomPage lets us unit-test what the
// task #311 partial-failure resilience exists for: a track.stop()
// throws, a webrtc.destroy() throws, an audio context close
// rejects, etc. Previously these branches were only covered by
// full-page integration tests that had to mount the entire room.
//
// What is here:
//   - `performBurnTeardown`: runs the same safe-step sequence as the
//     inline version, returns the list of failed step labels so the
//     caller can populate the BURN INCOMPLETE banner.
//
// What is NOT here:
//   - The RoomPage-only state resets (setRemoteStreams, setPeerSAS,
//     setVerificationOpenFor, setBurned, etc.) and the host-token
//     clear. Those live in `performLocalBurn` / `handleBurnSession`
//     because they reach into hooks and refs that aren't part of
//     the teardown contract itself — the *teardown* is what this
//     module owns.

export interface BurnTeardownDeps {
  // Refs the teardown consumes (and nulls out) in order.
  pendingShareRef: { current: PendingShareLike | null };
  displayTrackRef: { current: MediaStreamTrack | null };
  webrtcRef: { current: { destroy: () => void } | null };
  pipelineStopRef: { current: (() => void) | null };
  localStreamRef: {
    current: { getTracks: () => MediaStreamTrack[] } | null;
  };

  // The active-share teardown that already exists on the screen-share
  // lifecycle hook. Called only when displayTrackRef holds a track.
  stopShareCleanup: (emit: boolean) => void;

  // RoomPage-owned state resets fired during the teardown. Wrapped in
  // a single callback so the helper does not need to know about React
  // setters; the failure of any of these is the caller's problem
  // (they run after the safe-step loop returns the failures list).
  clearPendingShareState: () => void;

  // Overridable for tests; default to the real implementations.
  closeAudioContext?: () => Promise<void>;
  drainObjectUrlRegistry?: () => void;
  clearVoidSessionStorage?: () => number;
  clearVoidLocalStorage?: () => number;
  clearVoidCaches?: () => Promise<number>;
}

export interface BurnTeardownResult {
  failures: string[];
}

export function performBurnTeardown(
  deps: BurnTeardownDeps,
): BurnTeardownResult {
  const {
    pendingShareRef,
    displayTrackRef,
    webrtcRef,
    pipelineStopRef,
    localStreamRef,
    stopShareCleanup,
    clearPendingShareState,
    closeAudioContext = defaultCloseAudioContext,
    drainObjectUrlRegistry = defaultDrainObjectUrlRegistry,
    clearVoidSessionStorage = defaultClearVoidSessionStorage,
    clearVoidLocalStorage = defaultClearVoidLocalStorage,
    clearVoidCaches = defaultClearVoidCaches,
  } = deps;

  const failures: string[] = [];
  const safe = (label: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      failures.push(label);
      // eslint-disable-next-line no-console
      console.error(`[BURN] ${label} failed`, err);
    }
  };

  safe("pending screen-share", () => {
    if (stopPendingShare(pendingShareRef.current)) {
      pendingShareRef.current = null;
      clearPendingShareState();
    }
  });
  safe("active screen-share", () => {
    if (displayTrackRef.current) {
      stopShareCleanup(true);
    }
  });

  safe("peer connections", () => {
    const w = webrtcRef.current;
    webrtcRef.current = null;
    w?.destroy();
  });

  safe("media pipeline", () => {
    // Null the ref BEFORE invoking, so a throw cannot leave the ref
    // pointing at an already-half-stopped pipeline (the unmount
    // effect would otherwise re-invoke it and throw again).
    const stop = pipelineStopRef.current;
    pipelineStopRef.current = null;
    stop?.();
  });
  safe("audio context", () => {
    // safe() catches sync throws, but not the async rejection from
    // closeAudioContext's underlying AudioContext.close() promise.
    closeAudioContext().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[audio-teardown] closeAudioContext failed", err);
    });
  });

  // Stop each track in isolation: if one throws we still want to
  // try every other one (otherwise the OS recording dot can stay on
  // for a track we never even attempted to stop).
  const tracks = localStreamRef.current?.getTracks() ?? [];
  for (const t of tracks) {
    safe(`local ${t.kind} track`, () => t.stop());
  }
  localStreamRef.current = null;

  // Task #398 residue: object URLs first (after the media sinks
  // above), then storage, then runtime caches in the background.
  safe("object URL registry", () => {
    drainObjectUrlRegistry();
  });
  safe("sessionStorage", () => {
    clearVoidSessionStorage();
  });
  safe("localStorage", () => {
    clearVoidLocalStorage();
  });
  safe("runtime caches", () => {
    void clearVoidCaches().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[BURN] runtime caches failed", err);
    });
  });

  return { failures };
}
