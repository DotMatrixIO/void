// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  acquireCameraPipeline,
  applyCameraPipelineToMedia,
  mapPipelineErrorToLabel,
  type CameraPipelineMediaSurface,
} from "./cameraPipelineSetup";
import type { MediaPipeline, WatermarkInfo } from "@/lib/mediaPipeline";

// Stand in for an AudioContext — the helper never touches it, only
// passes it through to the buildMediaPipeline injection.
const fakeAudioContext = {} as unknown as AudioContext;

function makeFakePipeline(overrides: Partial<MediaPipeline> = {}): MediaPipeline {
  const audioTracks = [{ enabled: true, kind: "audio" }];
  const videoTracks = [{ enabled: true, kind: "video" }];
  const processedStream = {
    getAudioTracks: () => audioTracks,
    getVideoTracks: () => videoTracks,
    getTracks: () => [...audioTracks, ...videoTracks],
  } as unknown as MediaStream;
  const analyser = { fftSize: 2048 } as unknown as AnalyserNode;
  return {
    processedStream,
    analyser,
    stop: vi.fn(),
    setVideoStyle: vi.fn(),
    setVoiceMode: vi.fn(),
    setWatermark: vi.fn(),
    ...overrides,
  } as MediaPipeline;
}

describe("mapPipelineErrorToLabel", () => {
  it("maps each well-known DOMException name to its short label", () => {
    const cases: Array<[string, string, string]> = [
      ["NotAllowedError", "", "CAM/MIC DENIED"],
      ["NotFoundError", "", "NO CAMERA/MIC"],
      ["NotSupportedError", "", "NOT SUPPORTED"],
      ["OverconstrainedError", "", "CAM/MIC SETTINGS ERROR"],
    ];
    for (const [name, msg, expected] of cases) {
      const e = new Error(msg);
      e.name = name;
      expect(mapPipelineErrorToLabel(e)).toBe(expected);
    }
  });

  it("preserves the message for PipelineError so the user sees the failing stage", () => {
    const e = new Error("Shader compile error: bad sampler");
    e.name = "PipelineError";
    expect(mapPipelineErrorToLabel(e)).toBe(
      "PIPELINE: Shader compile error: bad sampler",
    );
  });

  it("falls back to MEDIA ERROR with the message for unknown errors", () => {
    const e = new Error("EBUSY");
    e.name = "AbortError";
    expect(mapPipelineErrorToLabel(e)).toBe("MEDIA ERROR: EBUSY");
  });

  it("falls back to MEDIA ERROR: UNKNOWN when there is no name or message", () => {
    expect(mapPipelineErrorToLabel(null)).toBe("MEDIA ERROR: UNKNOWN");
    expect(mapPipelineErrorToLabel(undefined)).toBe("MEDIA ERROR: UNKNOWN");
    expect(mapPipelineErrorToLabel("boom")).toBe("MEDIA ERROR: UNKNOWN");
  });
});

describe("acquireCameraPipeline", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok with the pipeline on success and does NOT close the audio context", async () => {
    const pipeline = makeFakePipeline();
    const closeAudioContext = vi.fn(async () => {});
    const buildMediaPipeline = vi.fn(async () => pipeline);
    const result = await acquireCameraPipeline({
      audioContext: fakeAudioContext,
      audioDeviceId: "mic-1",
      buildMediaPipeline,
      closeAudioContext,
    });
    expect(result).toEqual({ ok: true, pipeline });
    expect(buildMediaPipeline).toHaveBeenCalledWith(fakeAudioContext, {
      audioDeviceId: "mic-1",
    });
    expect(closeAudioContext).not.toHaveBeenCalled();
  });

  it("mic-denied path: maps NotAllowedError to CAM/MIC DENIED and closes the audio context", async () => {
    const e = new Error("permission denied");
    e.name = "NotAllowedError";
    const closeAudioContext = vi.fn(async () => {});
    const result = await acquireCameraPipeline({
      audioContext: fakeAudioContext,
      buildMediaPipeline: async () => {
        throw e;
      },
      closeAudioContext,
    });
    expect(result).toEqual({ ok: false, errorLabel: "CAM/MIC DENIED" });
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("pipeline-throws-mid-build path: PipelineError surfaces with its message", async () => {
    const e = new Error("captureStream did not yield a video track");
    e.name = "PipelineError";
    const closeAudioContext = vi.fn(async () => {});
    const result = await acquireCameraPipeline({
      audioContext: fakeAudioContext,
      buildMediaPipeline: async () => {
        throw e;
      },
      closeAudioContext,
    });
    expect(result).toEqual({
      ok: false,
      errorLabel: "PIPELINE: captureStream did not yield a video track",
    });
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("does not propagate a rejected closeAudioContext after a build failure (best-effort teardown)", async () => {
    const e = new Error("denied");
    e.name = "NotAllowedError";
    const closeAudioContext = vi.fn(async () => {
      throw new Error("close failed");
    });
    await expect(
      acquireCameraPipeline({
        audioContext: fakeAudioContext,
        buildMediaPipeline: async () => {
          throw e;
        },
        closeAudioContext,
      }),
    ).resolves.toEqual({ ok: false, errorLabel: "CAM/MIC DENIED" });
    // Allow the unhandled-then to settle so the spy registers it.
    await Promise.resolve();
    await Promise.resolve();
    expect(closeAudioContext).toHaveBeenCalledTimes(1);
  });
});

describe("applyCameraPipelineToMedia", () => {
  function makeMediaSurface(): CameraPipelineMediaSurface {
    return {
      pipelineStopRef: { current: null },
      setVideoStyleRef: { current: null },
      setVoiceModeRef: { current: null },
      setWatermarkRef: { current: null },
      watermarkRef: { current: null },
      videoStyleRef: { current: 0 },
      voiceModeRef: { current: 0 },
      localStreamRef: { current: null },
      setLocalAnalyser: vi.fn(),
      setLocalStream: vi.fn(),
    };
  }

  it("wires every pipeline handle into the media surface and applies the watermark", () => {
    const pipeline = makeFakePipeline();
    const media = makeMediaSurface();
    const wm: WatermarkInfo = { roomId: "ABC123", peerTag: "PEER-abcdef" };

    applyCameraPipelineToMedia(pipeline, media, {
      watermark: wm,
      micMuted: false,
      camOff: false,
    });

    expect(media.pipelineStopRef.current).toBe(pipeline.stop);
    expect(media.setVideoStyleRef.current).toBe(pipeline.setVideoStyle);
    expect(media.setVoiceModeRef.current).toBe(pipeline.setVoiceMode);
    expect(media.setWatermarkRef.current).toBe(pipeline.setWatermark);
    expect(media.watermarkRef.current).toBe(wm);
    expect(pipeline.setWatermark).toHaveBeenCalledWith(wm);
    expect(media.setLocalAnalyser).toHaveBeenCalledWith(pipeline.analyser);
    expect(pipeline.setVideoStyle).toHaveBeenCalledWith(0);
    expect(media.localStreamRef.current).toBe(pipeline.processedStream);
    expect(media.setLocalStream).toHaveBeenCalledWith(pipeline.processedStream);
  });

  it("only invokes setVoiceMode when the ref is non-zero (mirrors RoomPage's `if (voiceModeRef.current > 0)` guard)", () => {
    const pipelineA = makeFakePipeline();
    const mediaA = makeMediaSurface();
    applyCameraPipelineToMedia(pipelineA, mediaA, {
      watermark: { roomId: "X", peerTag: "Y" },
      micMuted: false,
      camOff: false,
    });
    expect(pipelineA.setVoiceMode).not.toHaveBeenCalled();

    const pipelineB = makeFakePipeline();
    const mediaB = makeMediaSurface();
    mediaB.voiceModeRef.current = 3;
    applyCameraPipelineToMedia(pipelineB, mediaB, {
      watermark: { roomId: "X", peerTag: "Y" },
      micMuted: false,
      camOff: false,
    });
    expect(pipelineB.setVoiceMode).toHaveBeenCalledWith(3);
  });

  it("respects an initial muted-mic / cam-off snapshot when toggling track.enabled", () => {
    const pipeline = makeFakePipeline();
    const media = makeMediaSurface();
    applyCameraPipelineToMedia(pipeline, media, {
      watermark: { roomId: "X", peerTag: "Y" },
      micMuted: true,
      camOff: true,
    });
    for (const t of pipeline.processedStream.getAudioTracks()) {
      expect(t.enabled).toBe(false);
    }
    for (const t of pipeline.processedStream.getVideoTracks()) {
      expect(t.enabled).toBe(false);
    }
  });
});
