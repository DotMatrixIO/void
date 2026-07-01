// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRoomMedia, type UseRoomMediaApi } from "./useRoomMedia";
import {
  useScreenShareLifecycle,
  type ScreenShareLifecycleApi,
} from "./useScreenShareLifecycle";
import type { WatermarkedScreenShare } from "@/lib/mediaPipeline";

// Minimal Socket.io stand-in: records every emit and lets tests
// drive the `request-screen-share` ack synchronously.
interface RecordedEmit {
  event: string;
  args: unknown[];
}
function makeFakeSocket() {
  const emits: RecordedEmit[] = [];
  let pendingAck:
    | ((result: {
        success: boolean;
        error?: string;
        nonce?: string;
      }) => void)
    | null = null;
  const socket = {
    emit: vi.fn((event: string, ...rest: unknown[]) => {
      emits.push({ event, args: rest });
      if (event === "request-screen-share") {
        const ack = rest[rest.length - 1];
        if (typeof ack === "function") {
          pendingAck = ack as typeof pendingAck;
        }
      }
    }),
  };
  return {
    socket,
    emits,
    flushGrant: (result: {
      success: boolean;
      error?: string;
      nonce?: string;
    }) => {
      if (!pendingAck) throw new Error("no pending grant ack");
      const ack = pendingAck;
      pendingAck = null;
      return ack(result);
    },
    eventsOf: (event: string) => emits.filter((e) => e.event === event),
  };
}

function makeFakeTrack(): MediaStreamTrack {
  const t = {
    stop: vi.fn(),
    enabled: true,
    onended: null as null | (() => void),
    contentHint: "",
    getSettings: () => ({ displaySurface: "monitor" }),
    kind: "video",
  };
  return t as unknown as MediaStreamTrack;
}
function makeFakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    removeTrack: vi.fn(),
  } as unknown as MediaStream;
}

interface Harness {
  media: UseRoomMediaApi;
  lifecycle: ScreenShareLifecycleApi;
  socket: ReturnType<typeof makeFakeSocket>;
  webrtc: {
    replaceVideoTrack: ReturnType<typeof vi.fn>;
    clearVideoOverride: ReturnType<typeof vi.fn>;
    setLocalMediaState: ReturnType<typeof vi.fn>;
  };
  createWatermark: ReturnType<typeof vi.fn>;
  watermarkInstances: WatermarkedScreenShare[];
  getDisplayMedia: ReturnType<typeof vi.fn>;
}

function setupHarness(opts: {
  getDisplayMedia?: ReturnType<typeof vi.fn>;
  createWatermark?: ReturnType<typeof vi.fn>;
} = {}): Harness {
  const socket = makeFakeSocket();
  const webrtc = {
    replaceVideoTrack: vi.fn(),
    clearVideoOverride: vi.fn(),
    setLocalMediaState: vi.fn(),
  };
  const watermarkInstances: WatermarkedScreenShare[] = [];
  const createWatermark =
    opts.createWatermark ??
    vi.fn(() => {
      const inst = {
        track: makeFakeTrack(),
        stop: vi.fn(),
      } as unknown as WatermarkedScreenShare;
      watermarkInstances.push(inst);
      return inst;
    });
  const getDisplayMedia =
    opts.getDisplayMedia ??
    vi.fn(async () => makeFakeStream([makeFakeTrack()]));

  const result = renderHook(() => {
    const media = useRoomMedia();
    media.webrtcRef.current = webrtc as never;
    const lifecycle = useScreenShareLifecycle({
      media,
      roomCode: "ROOM-1",
      wireCodeRef: { current: "ROOM-1" } as React.MutableRefObject<string>,
      peerIdRef: { current: "peer-self" } as React.MutableRefObject<string>,
      onionOrigin: false,
      uiClick: () => {},
      getSocket: (() => socket.socket) as never,
      createWatermarkedScreenShare: createWatermark as never,
      getDisplayMedia: getDisplayMedia as never,
    });
    return { media, lifecycle };
  });

  return {
    get media() { return result.result.current.media; },
    get lifecycle() { return result.result.current.lifecycle; },
    socket,
    webrtc,
    createWatermark,
    watermarkInstances,
    getDisplayMedia,
  } as Harness;
}

describe("useScreenShareLifecycle", () => {
  beforeEach(() => {
    try {
      window.sessionStorage.clear();
    } catch {}
    try {
      delete (window as unknown as { __voidMetrics?: unknown }).__voidMetrics;
    } catch {}
  });

  it("happy path: confirmAndStart → confirm → promote runs the full start sequence", async () => {
    const harness = setupHarness();

    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    expect(harness.media.screenShareRequesting).toBe(true);
    const requestEmit = harness.socket.eventsOf("request-screen-share")[0];
    expect(requestEmit).toBeDefined();
    expect(requestEmit.args[0]).toMatchObject({
      code: "ROOM-1",
      peerId: "peer-self",
    });

    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "nonce-1" });
    });

    expect(harness.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(harness.media.pendingShare).not.toBeNull();
    expect(harness.media.pendingShare?.surface).toBe("monitor");
    expect(harness.media.lastSeenGrantNonceRef.current).toBe("nonce-1");

    act(() => {
      harness.lifecycle.confirmPendingShare();
    });
    expect(harness.media.pendingShare).toBeNull();
    expect(harness.media.isScreenSharing).toBe(true);
    expect(harness.media.screenShareRequesting).toBe(false);
    expect(harness.webrtc.replaceVideoTrack).toHaveBeenCalledTimes(1);
    expect(harness.createWatermark).toHaveBeenCalledTimes(1);
    expect(harness.socket.eventsOf("screen-share-started")).toHaveLength(1);

    // stopShareCleanup tears it back down and emits the stop event.
    act(() => {
      harness.lifecycle.stopShareCleanup(true, "manual");
    });
    expect(harness.media.isScreenSharing).toBe(false);
    expect(harness.webrtc.clearVideoOverride).toHaveBeenCalledTimes(1);
    expect(harness.socket.eventsOf("screen-share-stopped")).toHaveLength(1);
    // "manual" reason suppresses the SCREEN SHARING ENDED notice.
    expect(harness.media.shareNotice).toBeNull();
    expect(harness.watermarkInstances[0].stop).toHaveBeenCalled();
  });

  it("duplicate-nonce guard: a second grant carrying the same nonce is dropped without re-entering getDisplayMedia", async () => {
    const harness = setupHarness();

    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "nonce-dup" });
    });
    expect(harness.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(harness.media.pendingShare).not.toBeNull();

    // A second start (e.g. the server retransmits the ack on a
    // reconnect) must NOT re-invoke the OS picker for the same
    // reservation and must NOT clobber the in-flight pending share.
    const pendingBefore = harness.media.pendingShare;
    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "nonce-dup" });
    });

    expect(harness.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(harness.media.pendingShare).toBe(pendingBefore);
    const metrics = (window as unknown as {
      __voidMetrics?: Record<string, number>;
    }).__voidMetrics;
    expect(metrics?.duplicateScreenShareGrants).toBe(1);
  });

  it("cleanup-on-revoke: stopShareCleanup(false, 'revoked') tears down the active share, surfaces a notice, and does NOT emit screen-share-stopped", async () => {
    const harness = setupHarness();

    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "nonce-x" });
    });
    act(() => {
      harness.lifecycle.confirmPendingShare();
    });
    expect(harness.media.isScreenSharing).toBe(true);

    const stopsBefore =
      harness.socket.eventsOf("screen-share-stopped").length;

    act(() => {
      harness.lifecycle.stopShareCleanup(false, "revoked");
    });

    expect(harness.media.isScreenSharing).toBe(false);
    expect(harness.media.localPreviewStream).toBeNull();
    expect(harness.media.displayTrackRef.current).toBeNull();
    expect(harness.media.screenShareWatermarkRef.current).toBeNull();
    expect(harness.webrtc.clearVideoOverride).toHaveBeenCalled();
    expect(harness.watermarkInstances[0].stop).toHaveBeenCalled();
    // The server revoked us — re-emitting screen-share-stopped would
    // be redundant and could race the server's own state machine.
    expect(
      harness.socket.eventsOf("screen-share-stopped").length,
    ).toBe(stopsBefore);
    // Non-manual reason surfaces the user-facing toast.
    expect(harness.media.shareNotice).toBe("SCREEN SHARING ENDED");
  });

  it("camera restore after share: re-enables the local video track when CAM was ON before sharing", async () => {
    const harness = setupHarness();
    // A live camera track on the local stream, transmitting before
    // the share starts (CAM ON ⇒ enabled true).
    const camTrack = makeFakeTrack();
    camTrack.enabled = true;
    harness.media.localStreamRef.current = makeFakeStream([camTrack]);

    // CAM is ON (camOff defaults to false) when the share begins.
    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "cam-on" });
    });
    act(() => {
      harness.lifecycle.confirmPendingShare();
    });
    expect(harness.media.isScreenSharing).toBe(true);
    // confirmAndStartShare snapshots the pre-share CAM state.
    expect(harness.media.preShareCamOffRef.current).toBe(false);

    // End the share: the camera must come back, i.e. the source track
    // must be re-enabled (false-branch of preShareCamOffRef).
    act(() => {
      harness.lifecycle.stopShareCleanup(true, "ended");
    });
    expect(camTrack.enabled).toBe(true);
    expect(harness.media.camOff).toBe(false);
  });

  it("camera restore after share: keeps the local video track disabled when CAM was OFF before sharing", async () => {
    const harness = setupHarness();
    // Task #701 disables the camera track at the source on CAM OFF, so
    // the local track starts already disabled.
    const camTrack = makeFakeTrack();
    camTrack.enabled = false;
    harness.media.localStreamRef.current = makeFakeStream([camTrack]);

    // Turn CAM OFF before the share starts.
    act(() => {
      harness.media.setCamOff(true);
    });
    expect(harness.media.camOffRef.current).toBe(true);

    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "cam-off" });
    });
    act(() => {
      harness.lifecycle.confirmPendingShare();
    });
    expect(harness.media.isScreenSharing).toBe(true);
    expect(harness.media.preShareCamOffRef.current).toBe(true);

    // End the share: the camera must NOT resume — the source track must
    // stay disabled (true-branch of preShareCamOffRef) so no frames leak
    // after a share for a user who had CAM OFF.
    act(() => {
      harness.lifecycle.stopShareCleanup(true, "ended");
    });
    expect(camTrack.enabled).toBe(false);
    expect(harness.media.camOff).toBe(true);
  });

  it("cancelPendingShare stops the captured tracks and clears the in-flight flag without emitting screen-share-stopped", async () => {
    const harness = setupHarness();

    await act(async () => {
      await harness.lifecycle.confirmAndStartShare();
    });
    await act(async () => {
      await harness.socket.flushGrant({ success: true, nonce: "nonce-c" });
    });
    const pending = harness.media.pendingShareRef.current!;
    const stopsBefore =
      harness.socket.eventsOf("screen-share-stopped").length;

    act(() => {
      harness.lifecycle.cancelPendingShare();
    });

    expect(pending.track.stop).toHaveBeenCalled();
    expect(harness.media.pendingShare).toBeNull();
    expect(harness.media.screenShareRequesting).toBe(false);
    expect(
      harness.socket.eventsOf("screen-share-stopped").length,
    ).toBe(stopsBefore);
  });
});
