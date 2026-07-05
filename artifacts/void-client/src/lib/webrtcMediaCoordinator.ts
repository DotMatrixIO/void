// SPDX-License-Identifier: AGPL-3.0-or-later
// Media pipeline coordinator extracted from webrtc.ts during the
// Refactor 2 decomposition (task #448). Owns the track-replacement
// and per-peer media cleanup paths that prevent "zombie tracks" —
// references kept alive on RTCRtpSenders after the underlying
// MediaStreamTrack has been stopped.
//
// IMPORTANT: this module does NOT manage the buildMediaPipeline()
// pipeline in mediaPipeline.ts — that's a separate Phase 5
// candidate per task #448 scope. This module only handles the
// per-peer sender bookkeeping that needs to happen when the
// orchestrator's `localStream` or `overrideVideoTrack` changes.

import { applyVideoConstraints } from "./webrtcPerPeer";

export interface MediaCoordinatorContext {
  /** Live per-peer pc map. Read-only from this module's perspective. */
  peers: Map<string, { pc: RTCPeerConnection; stream: MediaStream }>;
  /** Current local stream, mutated by `replaceLocalStream`. */
  localStream: MediaStream;
  /** Active video override (e.g. share-screen), mutated by the
   *  replace/clear helpers. */
  overrideVideoTrack: MediaStreamTrack | null;
  /** Snapshot of the pre-override camera track, restored by
   *  `clearVideoOverride`. */
  preOverrideVideoTrack: MediaStreamTrack | null;
}

/**
 * Swap the orchestrator's local stream and propagate matching tracks
 * to every connected peer via `RTCRtpSender.replaceTrack`. Skips the
 * video sender when an override is active so screen-share is not
 * clobbered by an underlying camera resume.
 *
 * Returns the new context state so the orchestrator can update its
 * own fields without aliasing the input object.
 */
export function replaceLocalStream(
  ctx: MediaCoordinatorContext,
  stream: MediaStream,
): MediaCoordinatorContext {
  ctx.localStream = stream;
  for (const { pc } of ctx.peers.values()) {
    const senders = pc.getSenders();
    for (const track of stream.getTracks()) {
      if (track.kind === "video" && ctx.overrideVideoTrack) continue;
      const sender = senders.find((s) => s.track?.kind === track.kind);
      if (sender) sender.replaceTrack(track);
    }
    applyVideoConstraints(pc);
  }
  return ctx;
}

/**
 * Install a video override (e.g. the screen-share track) on every
 * peer. Snapshots the pre-override camera track if we don't already
 * have one — the snapshot is used by `clearVideoOverride` to
 * restore correctly even after some browsers fire `ended` on the
 * captured display track read back through the RTCRtpSender (see
 * Task #285 note in webrtc.ts history).
 */
export function replaceVideoTrack(
  ctx: MediaCoordinatorContext,
  track: MediaStreamTrack,
): MediaCoordinatorContext {
  if (!ctx.preOverrideVideoTrack || ctx.preOverrideVideoTrack === ctx.overrideVideoTrack) {
    let snap: MediaStreamTrack | null = null;
    for (const { pc } of ctx.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === "video");
      if (sender?.track && sender.track !== ctx.overrideVideoTrack) {
        snap = sender.track;
        break;
      }
    }
    if (!snap) snap = ctx.localStream.getVideoTracks()[0] ?? null;
    ctx.preOverrideVideoTrack = snap;
  }
  ctx.overrideVideoTrack = track;
  for (const { pc } of ctx.peers.values()) {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video" || s.track === null);
    if (sender) sender.replaceTrack(track);
  }
  return ctx;
}

/**
 * Remove the current video override and restore the pre-override
 * camera track on every peer. Idempotent — calling with no override
 * active is a no-op (the senders already point at the camera track).
 */
export function clearVideoOverride(
  ctx: MediaCoordinatorContext,
): MediaCoordinatorContext {
  ctx.overrideVideoTrack = null;
  const cameraTrack =
    ctx.preOverrideVideoTrack ?? ctx.localStream.getVideoTracks()[0] ?? null;
  ctx.preOverrideVideoTrack = null;
  for (const { pc } of ctx.peers.values()) {
    const sender = pc.getSenders().find((s) => s.track?.kind === "video" || s.track === null);
    if (sender) sender.replaceTrack(cameraTrack);
  }
  return ctx;
}
