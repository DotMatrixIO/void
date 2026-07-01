// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  MediaPipeline,
  VideoStyle,
  WatermarkInfo,
} from "@/lib/mediaPipeline";
import {
  buildMediaPipeline as defaultBuildMediaPipeline,
  type MediaPipelineOptions,
} from "@/lib/mediaPipeline";
import { closeAudioContext as defaultCloseAudioContext } from "@/lib/sounds";

// Task #501: extracted from RoomPage.tsx's `setup()` effect (the
// camera-pipeline half — getUserMedia + buildMediaPipeline + analyser
// wiring). Pulling this out lets the failure paths (mic/cam denied,
// missing device, pipeline mid-build throw, OverconstrainedError) get
// unit-tested directly instead of through a full RoomPage render.
//
// What is here:
//   - `acquireCameraPipeline`: drives `buildMediaPipeline`, maps the
//     thrown error name → user-visible label using exactly the same
//     mapping the inline code used (CAM/MIC DENIED, NO CAMERA/MIC,
//     NOT SUPPORTED, CAM/MIC SETTINGS ERROR, PIPELINE: <msg>, generic
//     MEDIA ERROR fallback), and on failure closes the audio context
//     the caller already opened so a mounted error state holds no
//     live audio engine.
//   - `applyCameraPipelineToMedia`: pure sync helper that performs
//     the post-build wiring (refs, watermark, analyser, stream
//     toggles) — identical to the inline block in RoomPage. Kept
//     separate from acquire() so callers can interleave a
//     cancellation check between the two halves, matching the
//     original `if (cancelled) return;` after the await.
//
// What is NOT here:
//   - The signaling flow (join-room, peer-joined, screen-share)
//     stays in RoomPage. This module only owns the local-media
//     pipeline bring-up.

export interface AcquireCameraPipelineDeps {
  audioContext: AudioContext;
  audioDeviceId?: string;
  // Task #522: forwarded to MediaPipelineOptions.onError so a
  // post-construction failure (a future hard failure category that
  // genuinely should kill the call) reaches the same user-visible
  // error surface as construction-time PipelineErrors. As of task
  // #526 the GOLD blank-canvas sanity check no longer uses this
  // path; see `onVideoStyleDisabled` below.
  onError?: (err: Error) => void;
  // Task #526: forwarded to MediaPipelineOptions.onVideoStyleDisabled.
  // The pipeline fires this when a video style gets disabled at
  // runtime (currently only GOLD when its blank-frame sanity check
  // trips); the caller mirrors the flag so the cycle button can skip
  // the unavailable mode without ever raising a user-visible error.
  onVideoStyleDisabled?: (mode: VideoStyle) => void;
  // Overridable for tests; defaults to the real implementations.
  buildMediaPipeline?: (
    ctx: AudioContext,
    opts?: MediaPipelineOptions,
  ) => Promise<MediaPipeline>;
  closeAudioContext?: () => Promise<void>;
}

export type AcquireCameraPipelineResult =
  | { ok: true; pipeline: MediaPipeline }
  | { ok: false; errorLabel: string };

export function mapPipelineErrorToLabel(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : "";
  if (name === "PipelineError") return `PIPELINE: ${msg}`;
  if (name === "NotAllowedError") return "CAM/MIC DENIED";
  if (name === "NotFoundError") return "NO CAMERA/MIC";
  if (name === "NotSupportedError") return "NOT SUPPORTED";
  if (name === "OverconstrainedError") return "CAM/MIC SETTINGS ERROR";
  return `MEDIA ERROR: ${msg || name || "UNKNOWN"}`;
}

export async function acquireCameraPipeline(
  deps: AcquireCameraPipelineDeps,
): Promise<AcquireCameraPipelineResult> {
  const {
    audioContext,
    audioDeviceId,
    onError,
    onVideoStyleDisabled,
    buildMediaPipeline = defaultBuildMediaPipeline,
    closeAudioContext = defaultCloseAudioContext,
  } = deps;

  try {
    const pipeline = await buildMediaPipeline(audioContext, {
      audioDeviceId,
      onError,
      onVideoStyleDisabled,
    });
    return { ok: true, pipeline };
  } catch (err: unknown) {
    // The caller already opened an audio context (so getAudioContext()
    // could pass it in). On failure, close it so a mounted error state
    // does not hold a live audio engine.
    closeAudioContext().catch((closeErr) => {
      // eslint-disable-next-line no-console
      console.warn("[audio-teardown] closeAudioContext failed", closeErr);
    });
    // eslint-disable-next-line no-console
    console.error(
      "[VOID] Media pipeline error:",
      err instanceof Error ? err.name : "",
      err instanceof Error ? err.message : "",
      err,
    );
    return { ok: false, errorLabel: mapPipelineErrorToLabel(err) };
  }
}

// Minimal media-state surface used by applyCameraPipelineToMedia.
// A subset of UseRoomMediaApi — typed structurally so tests can
// hand in a plain object without spinning up useRoomMedia.
export interface CameraPipelineMediaSurface {
  pipelineStopRef: { current: (() => void) | null };
  setVideoStyleRef: { current: ((mode: VideoStyle) => void) | null };
  setVoiceModeRef: { current: ((mode: number) => void) | null };
  setWatermarkRef: {
    current: ((info: WatermarkInfo | null) => void) | null;
  };
  watermarkRef: { current: WatermarkInfo | null };
  videoStyleRef: { current: VideoStyle };
  voiceModeRef: { current: number };
  localStreamRef: { current: MediaStream | null };
  setLocalAnalyser: (a: AnalyserNode | null) => void;
  setLocalStream: (s: MediaStream | null) => void;
}

export interface ApplyCameraPipelineOptions {
  watermark: WatermarkInfo;
  micMuted: boolean;
  camOff: boolean;
}

export function applyCameraPipelineToMedia(
  pipeline: MediaPipeline,
  media: CameraPipelineMediaSurface,
  opts: ApplyCameraPipelineOptions,
): void {
  media.pipelineStopRef.current = pipeline.stop;
  media.setVideoStyleRef.current = pipeline.setVideoStyle;
  media.setVoiceModeRef.current = pipeline.setVoiceMode;
  media.setWatermarkRef.current = pipeline.setWatermark;

  media.watermarkRef.current = opts.watermark;
  pipeline.setWatermark(opts.watermark);

  media.setLocalAnalyser(pipeline.analyser);
  pipeline.setVideoStyle(media.videoStyleRef.current);
  if (media.voiceModeRef.current > 0) {
    pipeline.setVoiceMode(media.voiceModeRef.current);
  }

  media.localStreamRef.current = pipeline.processedStream;
  pipeline.processedStream.getAudioTracks().forEach((t) => {
    t.enabled = !opts.micMuted;
  });
  pipeline.processedStream.getVideoTracks().forEach((t) => {
    t.enabled = !opts.camOff;
  });
  media.setLocalStream(pipeline.processedStream);
}
