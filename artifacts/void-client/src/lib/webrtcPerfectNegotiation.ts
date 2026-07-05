// SPDX-License-Identifier: AGPL-3.0-or-later
// Perfect-Negotiation seam — STUB ONLY (task #448).
//
// This module defines the interface that the future polite/impolite
// glare-handling logic will implement, without changing any of
// today's offer/answer behavior. The Refactor 2 decomposition
// requires this seam to exist so the Phase 2 task can land its
// implementation against a stable shape without re-touching every
// call site in webrtc.ts.
//
// DO NOT add behavior here in task #448 — that's explicitly out of
// scope and reviewer-rejectable. The Phase 2 task owns:
//   - polite/impolite tie-breaking on the offerer side
//   - rollback handling when both peers create offers concurrently
//   - SDP munging coordination across data channels and media
//
// Today every WebRTCManager pair uses the trivial "I always send
// offers when I'm the offerer" path, which is functionally
// equivalent to passing through `createOfferRequest` and
// `acceptRemoteOffer` unchanged. The orchestrator does not yet
// route through this module — the seam exists for the next task
// to consume.

export interface PerfectNegotiationContext {
  pc: RTCPeerConnection;
  /** True if this side won the deterministic peerId tie-break for
   *  this pair, and so should rollback on glare rather than holding
   *  its own offer. Today: unused — every pair runs the simple
   *  pattern. Phase 2: drives the rollback decision. */
  polite: boolean;
}

export interface PerfectNegotiationHandler {
  /** Called when the local side wants to send a fresh offer
   *  (initial setup or ICE restart). Returns the SDP to relay, or
   *  null if the implementation has decided to back off. */
  createOfferRequest(
    ctx: PerfectNegotiationContext,
    opts?: { iceRestart?: boolean },
  ): Promise<RTCSessionDescriptionInit | null>;

  /** Called when a remote offer arrives. Returns the answer SDP to
   *  relay, or null if the implementation rolled back to allow the
   *  remote offer to win the glare. */
  acceptRemoteOffer(
    ctx: PerfectNegotiationContext,
    offer: RTCSessionDescriptionInit,
  ): Promise<RTCSessionDescriptionInit | null>;

  /** Called when a remote answer arrives for our outstanding offer. */
  acceptRemoteAnswer(
    ctx: PerfectNegotiationContext,
    answer: RTCSessionDescriptionInit,
  ): Promise<void>;
}
