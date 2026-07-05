// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-peer connection lifecycle helpers extracted from webrtc.ts
// during the Refactor 2 decomposition (task #448).
//
// The orchestrator owns the per-peer state Maps; this module
// provides the focused functions that build a single
// RTCPeerConnection with all of its handlers wired, and that apply
// the project's per-track encoding caps. Splitting these out makes
// the Phase 2 Perfect-Negotiation work modify a focused factory
// rather than a 1,100-line god class.

export interface PerPeerBuildContext {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  localStream: MediaStream;
  overrideVideoTrack: MediaStreamTrack | null;

  /** Test/observability hook — see WebRTCManager `onPeerConnectionCreated`. */
  onPeerConnectionCreated: (peerId: string, pc: RTCPeerConnection) => void;
  /** Called for the manager's per-peer state bookkeeping. */
  registerPeer: (peerId: string, pc: RTCPeerConnection, remoteStream: MediaStream) => void;
  /** Called from `pc.onicecandidate` with a fresh candidate to relay. */
  onIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => void;
  /** Called from `pc.ondatachannel` for the supported channel labels. */
  attachDataChannel: (peerId: string, channel: RTCDataChannel) => void;
  /** Called from `pc.ontrack` with the freshly added inbound track. */
  onTrack: (peerId: string, track: MediaStreamTrack) => void;
  /** Called from `pc.onconnectionstatechange` with the new state. */
  onConnectionStateChange: (peerId: string, pc: RTCPeerConnection) => void;
}

/**
 * Build a fresh RTCPeerConnection for `remotePeerId`, wire up every
 * handler the orchestrator needs, and add the local stream's tracks
 * (substituting the override video track if one is set). The
 * orchestrator is responsible for closing and removing the
 * connection later — this factory does not retain a reference.
 *
 * The ICE leak audit comment from the original site is preserved
 * here: `iceTransportPolicy` defaults to "all" (host+srflx+relay)
 * and switches to "relay" when the server returns relayOnly: true,
 * masking the user's IP behind TURN. No custom ICE candidate
 * scraping or local IP exposure to the UI — we rely on standard
 * browser mDNS obfuscation.
 */
export function buildPC(
  ctx: PerPeerBuildContext,
  remotePeerId: string,
): RTCPeerConnection {
  const pc = new RTCPeerConnection({
    iceServers: ctx.iceServers,
    iceTransportPolicy: ctx.iceTransportPolicy,
  });
  ctx.onPeerConnectionCreated(remotePeerId, pc);

  for (const track of ctx.localStream.getTracks()) {
    if (track.kind === "video" && ctx.overrideVideoTrack) {
      pc.addTrack(ctx.overrideVideoTrack, ctx.localStream);
    } else {
      pc.addTrack(track, ctx.localStream);
    }
  }

  const remoteStream = new MediaStream();
  ctx.registerPeer(remotePeerId, pc, remoteStream);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ctx.onIceCandidate(remotePeerId, e.candidate.toJSON());
    }
  };

  // Task #443: accept inbound DROP data channels opened by the remote
  // peer. The orchestrator decides which labels are recognized.
  pc.ondatachannel = (e) => {
    ctx.attachDataChannel(remotePeerId, e.channel);
  };

  pc.ontrack = (e) => {
    ctx.onTrack(remotePeerId, e.track);
  };

  pc.onconnectionstatechange = () => {
    ctx.onConnectionStateChange(remotePeerId, pc);
  };

  return pc;
}

/**
 * Apply the project's per-sender encoding caps (200 kbps, 15 fps)
 * to every video sender on the supplied peer connection. Failures
 * on any one sender are swallowed — matches the original behavior
 * because some Firefox/Safari versions reject `setParameters` mid-
 * call but recover on the next renegotiation.
 */
export async function applyVideoConstraints(pc: RTCPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 200_000;
      params.encodings[0].maxFramerate = 15;
      await sender.setParameters(params);
    } catch {}
  }
}
