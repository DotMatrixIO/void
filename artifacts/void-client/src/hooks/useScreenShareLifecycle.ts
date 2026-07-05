// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback } from "react";
import {
  createWatermarkedScreenShareTrack,
  type WatermarkedScreenShare,
} from "@/lib/mediaPipeline";
import {
  loadLastSeenGrantNonce,
  saveLastSeenGrantNonce,
} from "@/lib/lastSeenGrantNonceStorage";
import { getSocket as defaultGetSocket } from "@/lib/socket";
import type { UseRoomMediaApi } from "./useRoomMedia";

// Task #496: extracted from RoomPage.tsx. Owns the screen-share
// *lifecycle* methods that cross from the useRoomMedia state surface
// into the WebRTCManager (replaceVideoTrack / clearVideoOverride) and
// the Socket.io wire (`request-screen-share`,
// `screen-share-started`, `screen-share-stopped`, `peer-media-state`).
//
// Why it's a hook and not free functions:
//   - The methods mutate the entire useRoomMedia state cohort
//     (pendingShare, isScreenSharing, screenShareRequesting,
//     displayTrackRef, screenShareWatermarkRef, preShareCamOffRef,
//     lastSeenGrantNonceRef, etc.); passing the media surface in as a
//     single dep keeps the call sites in RoomPage trivial and lets us
//     unit-test the start/stop sequence and the per-grant nonce dedup
//     guard (Task #303) without spinning up the whole page.
//   - The `getSocket` factory and `createWatermarkedScreenShareTrack`
//     are accepted as overridable dependencies so tests can drive the
//     ack callback synchronously and stub the watermark wrapper
//     without touching the real DOM compositor.
//
// What is NOT here:
//   - `handleToggleScreenShare` stays in RoomPage because it gates
//     on UI-level concerns (displayMediaSupported, the warning
//     dialog, the "another participant is sharing" toast) that don't
//     belong in the lifecycle layer.
//   - Reaction to inbound `screen-share-state` revocations stays in
//     RoomPage's socket subscription block; it just calls
//     `stopShareCleanup(false, "revoked")` from here.

export type StopShareReason = "manual" | "ended" | "revoked";

export interface ScreenShareLifecycleDeps {
  media: UseRoomMediaApi;
  // Task #1024: durable room id, kept for the grant-nonce store + dedup
  // keys (stable across epoch rotation so a reconnect still matches its
  // own prior reservation).
  roomCode: string;
  // Task #1024: live rendezvous handle — the value the screen-share
  // control-plane emits (request/started/stopped) actually route on.
  wireCodeRef: React.MutableRefObject<string>;
  peerIdRef: React.MutableRefObject<string>;
  onionOrigin: boolean;
  uiClick: () => void;
  // Optional overrides for tests; default to the production
  // singletons.
  getSocket?: typeof defaultGetSocket;
  createWatermarkedScreenShare?: typeof createWatermarkedScreenShareTrack;
  // The OS picker. Defaults to the real `navigator.mediaDevices`
  // surface; tests inject a fake that resolves/rejects synchronously.
  getDisplayMedia?: (
    constraints: DisplayMediaStreamOptions,
  ) => Promise<MediaStream>;
}

export interface ScreenShareLifecycleApi {
  stopShareCleanup: (emitStop: boolean, reason?: StopShareReason) => void;
  confirmAndStartShare: () => Promise<void>;
  promoteShareToPeers: (
    displayStream: MediaStream,
    displayTrack: MediaStreamTrack,
  ) => void;
  confirmPendingShare: () => void;
  cancelPendingShare: () => void;
  pickAnotherShareSource: () => Promise<void>;
}

const SHARE_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: {
    width: { ideal: 1280, max: 1280 },
    height: { ideal: 720, max: 720 },
    frameRate: { ideal: 8, max: 10 },
  },
  // `audio: false` is REQUIRED, not optional (Task #404). The OS
  // picker offers a "Share system audio" opt-in; if we omit `audio`
  // (or pass `undefined`) and the user leaves that checkbox ticked,
  // raw OS audio — notifications, a YouTube tab, a Slack ping —
  // would stream to peers WITHOUT passing through the voice mask,
  // noise gate, formant shift, or any other AudioWorklet stage.
  // That defeats the SILHOUETTE / voice-mask anonymity guarantee.
  // VOID has no product reason to ever forward system audio; if you
  // are tempted to add a "presenter music" or "share tab audio"
  // feature, see Task #404 first — it cannot pass through the
  // voice mask, so it would silently destroy the privacy guarantee.
  //
  // Task #412: this constraint AND the belt-and-suspenders
  // stop+remove cleanup below are enforced repo-wide by the static
  // check at `scripts/check-no-display-media-audio.mjs`.
  audio: false,
};

function stripStragglerAudio(displayStream: MediaStream): void {
  // Belt-and-suspenders (Task #404): if a future browser or shim
  // ever returns an audio track despite `audio: false`, stop and
  // remove it BEFORE the stream reaches any RTCPeerConnection. The
  // constraint is the primary defense; this is the second wall.
  const stragglerAudioTracks = displayStream.getAudioTracks();
  for (const t of stragglerAudioTracks) {
    try { t.stop(); } catch {}
  }
  for (const t of stragglerAudioTracks) {
    try { displayStream.removeTrack(t); } catch {}
  }
}

export function useScreenShareLifecycle(
  deps: ScreenShareLifecycleDeps,
): ScreenShareLifecycleApi {
  const {
    media,
    roomCode,
    wireCodeRef,
    peerIdRef,
    onionOrigin,
    uiClick,
    getSocket = defaultGetSocket,
    createWatermarkedScreenShare = createWatermarkedScreenShareTrack,
    getDisplayMedia = (constraints) =>
      navigator.mediaDevices.getDisplayMedia(constraints),
  } = deps;

  const stopShareCleanup = useCallback(
    (emitStop: boolean, reason?: StopShareReason) => {
      const wasSharing = !!media.displayTrackRef.current;
      const socket = getSocket();
      if (media.displayTrackRef.current) {
        media.displayTrackRef.current.onended = null;
        media.displayTrackRef.current.stop();
        media.displayTrackRef.current = null;
      }
      // Tear down the watermark wrapper compositor (hidden video +
      // canvas) before clearing the override so the wrapped output
      // track stops first.
      if (media.screenShareWatermarkRef.current) {
        media.screenShareWatermarkRef.current.stop();
        media.screenShareWatermarkRef.current = null;
      }
      media.webrtcRef.current?.clearVideoOverride();
      media.setIsScreenSharing(false);
      media.setLocalPreviewStream(null);

      const wasCamOff = media.preShareCamOffRef.current;
      if (wasCamOff) {
        media.setCamOff(true);
        media.localStreamRef.current?.getVideoTracks().forEach((t) => {
          t.enabled = false;
        });
      } else {
        media.setCamOff(false);
        media.localStreamRef.current?.getVideoTracks().forEach((t) => {
          t.enabled = true;
        });
      }

      // Task #868: restore the post-share camOff state to peers over the
      // encrypted `void.media-state` channel. Screen-share start/stop
      // itself stays server-arbitrated (see `screen-share-stopped` below
      // and docs/signaling-envelope-audit.md), but the camera indicator
      // it implies travels P2P.
      media.webrtcRef.current?.setLocalMediaState({
        camOff: wasCamOff,
        micMuted: media.micMutedRef.current,
        voiceMode: media.voiceModeRef.current,
        viaOnion: onionOrigin,
      });

      if (emitStop) {
        socket.emit("screen-share-stopped", {
          code: wireCodeRef.current,
          peerId: peerIdRef.current,
        });
      }

      if (wasSharing && reason !== "manual") {
        media.showShareNotice("SCREEN SHARING ENDED");
      }
    },
    [media, wireCodeRef, peerIdRef, onionOrigin, getSocket],
  );

  const promoteShareToPeers = useCallback(
    (displayStream: MediaStream, displayTrack: MediaStreamTrack) => {
      const socket = getSocket();
      try {
        displayTrack.contentHint = "detail";
      } catch {}

      media.displayTrackRef.current = displayTrack;

      displayTrack.onended = () => {
        stopShareCleanup(true, "ended");
      };

      // Wrap the screen-share track with the recording-honesty
      // watermark so the same room-id / timestamp / peer-tag overlay
      // burned into camera frames is also burned into screen-share
      // frames. Per the project's loud-fail policy (no silent
      // fallbacks), if the wrapper cannot be constructed we abort
      // the share entirely and surface a visible notice rather than
      // silently sending an unwatermarked track.
      let wmShare: WatermarkedScreenShare;
      try {
        wmShare = createWatermarkedScreenShare(
          displayStream,
          () => media.watermarkRef.current,
        );
      } catch (err) {
        console.error(
          "[void] screen-share watermark wrapper failed; aborting share",
          err,
        );
        try { displayTrack.onended = null; } catch {}
        try { displayTrack.stop(); } catch {}
        try { displayStream.getTracks().forEach((t) => t.stop()); } catch {}
        media.displayTrackRef.current = null;
        media.setScreenShareRequesting(false);
        media.setShareNotice("SCREEN SHARE BLOCKED · WATERMARK FAILED");
        return;
      }
      media.screenShareWatermarkRef.current = wmShare;
      const outgoingTrack: MediaStreamTrack = wmShare.track;

      media.webrtcRef.current?.replaceVideoTrack(outgoingTrack);
      media.setIsScreenSharing(true);
      media.setLocalPreviewStream(displayStream);
      media.setScreenShareRequesting(false);

      // Task #868: a live screen share implies camera-on for the tile;
      // publish that over the encrypted `void.media-state` channel. The
      // screen-share start signal itself remains server-arbitrated below.
      media.webrtcRef.current?.setLocalMediaState({
        camOff: false,
        micMuted: media.micMutedRef.current,
        voiceMode: media.voiceModeRef.current,
        viaOnion: onionOrigin,
      });

      socket.emit("screen-share-started", {
        code: wireCodeRef.current,
        peerId: peerIdRef.current,
      });
    },
    [
      media,
      wireCodeRef,
      peerIdRef,
      onionOrigin,
      getSocket,
      createWatermarkedScreenShare,
      stopShareCleanup,
    ],
  );

  const confirmAndStartShare = useCallback(async () => {
    media.setShowShareWarning(false);
    const socket = getSocket();

    media.setScreenShareRequesting(true);

    socket.emit(
      "request-screen-share",
      { code: wireCodeRef.current, peerId: peerIdRef.current },
      async (result: {
        success: boolean;
        error?: string;
        nonce?: string;
      }) => {
        if (!result.success) {
          media.setScreenShareRequesting(false);
          if (result.error === "SCREEN_SHARE_ACTIVE") {
            media.showShareNotice("ANOTHER PARTICIPANT IS SHARING");
          }
          return;
        }

        // Idempotency guard (Task #303). The server attaches a
        // per-grant nonce to every successful ack; ignore a
        // duplicated ack carrying a nonce we have already acted on.
        // Without this, a retransmit or out-of-order delivery would
        // re-enter the getDisplayMedia → promoteShareToPeers path
        // for the same reservation and double-book the presenter
        // slot. We only update the ref AFTER confirming the nonce
        // is fresh, and we only treat a non-empty nonce as a valid
        // token (a missing nonce from a pre-#303 server falls
        // through to the legacy code path below — there's nothing
        // to dedup against).
        if (typeof result.nonce === "string" && result.nonce.length > 0) {
          // Hydrate the in-memory ref from sessionStorage on first
          // use (Task #356). The ref is wiped whenever the React
          // component is torn down — e.g. a full page reload, or a
          // socket reconnect that re-creates RoomPage — so without
          // a persisted backstop a duplicated ack carrying the
          // prior reservation's nonce would slip past the dedup
          // guard. sessionStorage is scoped to the tab (matches the
          // dedup window) and keyed by roomCode + peerId so two
          // participants in different tabs cannot collide.
          if (media.lastSeenGrantNonceRef.current === null) {
            const persisted = loadLastSeenGrantNonce(
              roomCode,
              peerIdRef.current,
            );
            if (persisted) media.lastSeenGrantNonceRef.current = persisted;
          }
          if (media.lastSeenGrantNonceRef.current === result.nonce) {
            // Duplicate grant: leave any in-flight flow alone (the
            // original grant handler already set
            // screenShareRequesting and is owning the share
            // lifecycle) and silently drop. We still log + bump a
            // counter so QA and field debugging can detect server
            // retransmits (Task #357).
            console.warn("[void] duplicate screen-share grant ignored", {
              roomCode,
              nonce: result.nonce,
            });
            try {
              const w = window as unknown as {
                __voidMetrics?: Record<string, number>;
              };
              const metrics = w.__voidMetrics ?? (w.__voidMetrics = {});
              metrics.duplicateScreenShareGrants =
                (metrics.duplicateScreenShareGrants ?? 0) + 1;
            } catch {}
            return;
          }
          media.lastSeenGrantNonceRef.current = result.nonce;
          saveLastSeenGrantNonce(roomCode, peerIdRef.current, result.nonce);
        }

        media.preShareCamOffRef.current = media.camOffRef.current;

        let displayStream: MediaStream;
        try {
          displayStream = await getDisplayMedia(SHARE_CONSTRAINTS);
          stripStragglerAudio(displayStream);
        } catch {
          // Failure path runs the same clearVideoOverride
          // restoration as the graceful-end case so both land in
          // the same post-restore state, and surfaces a notice so
          // the presenter sees that the share didn't start.
          media.setScreenShareRequesting(false);
          media.webrtcRef.current?.clearVideoOverride();
          socket.emit("screen-share-stopped", {
            code: wireCodeRef.current,
            peerId: peerIdRef.current,
          });
          media.showShareNotice("SCREEN SHARING ENDED");
          return;
        }

        const displayTrack = displayStream.getVideoTracks()[0];
        if (!displayTrack) {
          media.setScreenShareRequesting(false);
          media.webrtcRef.current?.clearVideoOverride();
          socket.emit("screen-share-stopped", {
            code: wireCodeRef.current,
            peerId: peerIdRef.current,
          });
          media.showShareNotice("SCREEN SHARING ENDED");
          return;
        }

        let surface: string | undefined;
        try {
          surface = displayTrack.getSettings().displaySurface;
        } catch {}

        // Always show a preflight panel with a live preview of the
        // captured stream before broadcasting. The OS picker
        // thumbnail is small and disappears immediately, so users
        // can pick the wrong monitor / wrong window without
        // realizing it. Rendering the very MediaStream we are about
        // to forward to peers lets the user literally see what their
        // peers are about to see, and bail out if it is wrong. The
        // "monitor" case keeps its loud red treatment because
        // entire-screen captures carry the highest leak risk; other
        // surfaces get a lighter "preflight check" panel.
        media.setPendingShare({
          stream: displayStream,
          track: displayTrack,
          surface: surface ?? "unknown",
        });
      },
    );
  }, [media, roomCode, peerIdRef, getSocket, getDisplayMedia]);

  const confirmPendingShare = useCallback(() => {
    const pending = media.pendingShareRef.current;
    if (!pending) return;
    uiClick();
    media.setPendingShare(null);
    promoteShareToPeers(pending.stream, pending.track);
  }, [media, uiClick, promoteShareToPeers]);

  const cancelPendingShare = useCallback(() => {
    const pending = media.pendingShareRef.current;
    if (!pending) return;
    uiClick();
    try { pending.track.stop(); } catch {}
    try { pending.stream.getTracks().forEach((t) => t.stop()); } catch {}
    media.setPendingShare(null);
    media.setScreenShareRequesting(false);
    // Intentionally do NOT emit "screen-share-stopped": the share
    // never started, and the server's 12-second slot reservation
    // will expire on its own.
  }, [media, uiClick]);

  // Re-open the OS picker without releasing the in-flight slot
  // reservation. Used when the preflight preview reveals that the
  // user picked the wrong screen / window / tab — saves them from
  // having to CANCEL, re-open the share menu, click "I UNDERSTAND"
  // again, and race the OS picker. We stop the currently-captured
  // tracks first (otherwise Chrome will keep the previous source
  // live alongside the new one), then re-invoke getDisplayMedia. We
  // do NOT emit a fresh `request-screen-share`: the server-side
  // reservation is still ours for the rest of its 12-second window,
  // and re-knocking would only add latency and a chance of losing
  // the slot to another peer.
  const pickAnotherShareSource = useCallback(async () => {
    const pending = media.pendingShareRef.current;
    if (!pending) return;
    uiClick();

    try { pending.track.stop(); } catch {}
    try { pending.stream.getTracks().forEach((t) => t.stop()); } catch {}
    media.setPendingShare(null);

    let displayStream: MediaStream;
    try {
      displayStream = await getDisplayMedia(SHARE_CONSTRAINTS);
      stripStragglerAudio(displayStream);
    } catch {
      // User cancelled the OS picker the second time. Previous
      // tracks already stopped above; clear the in-flight flag and
      // run the shared restoration path. The server's slot
      // reservation will expire on its own — same as
      // `cancelPendingShare`.
      media.setScreenShareRequesting(false);
      media.webrtcRef.current?.clearVideoOverride();
      media.showShareNotice("SCREEN SHARING ENDED");
      return;
    }

    const displayTrack = displayStream.getVideoTracks()[0];
    if (!displayTrack) {
      media.setScreenShareRequesting(false);
      media.webrtcRef.current?.clearVideoOverride();
      media.showShareNotice("SCREEN SHARING ENDED");
      return;
    }

    let surface: string | undefined;
    try {
      surface = displayTrack.getSettings().displaySurface;
    } catch {}

    media.setPendingShare({
      stream: displayStream,
      track: displayTrack,
      surface: surface ?? "unknown",
    });
  }, [media, uiClick, getDisplayMedia]);

  return {
    stopShareCleanup,
    confirmAndStartShare,
    promoteShareToPeers,
    confirmPendingShare,
    cancelPendingShare,
    pickAnotherShareSource,
  };
}
