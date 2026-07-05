// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { uiClick, uiSlide } from "@/lib/uiSounds";
import { closeAudioContext } from "@/lib/sounds";
import { performBurnTeardown } from "./burnTeardownSequence";
import { clearHostToken } from "@/lib/hostTokenStorage";
import type { RemoteStreams } from "@/lib/webrtc";
import type { UseRoomMediaApi } from "./useRoomMedia";
import type { UseRoomCryptoApi } from "./useRoomCrypto";
import type { StopShareReason } from "./useScreenShareLifecycle";

// Task #502: extracted from RoomPage. The single BURN/expired
// coordinator for the in-room session — every release path (host
// BURN, remote `room-destroyed`, `room-expired`, the per-second
// countdown reaching zero) funnels through `performLocalBurn()` or
// `handleSessionExpired()` here so we never double-stop media or
// leave a half-torn-down session. Owns the terminal-state flags
// (`burned`, `sessionEnded`, `burnReason`, `burnTokenWarning`) that
// drive the ROOM BURNED / ROOM ENDED overlays.
//
// All cross-cohort cleanup (media tracks, WebRTCManager, crypto
// state, screen-share, wait-hint, storage residue) is delegated
// through the injected hook APIs / setters — this hook is the
// orchestrator, not the owner of those sub-systems.
export interface UseRoomTeardownOptions {
  // Task #1024: live rendezvous handle (epoch-rotated for human rooms).
  // leave-room/destroy-room/burn-room all route on this value.
  wireCodeRef: React.MutableRefObject<string>;
  voidPhrase: string;
  isHost: boolean;
  peerIdRef: React.MutableRefObject<string>;
  onLeave?: (reason?: string) => void;

  media: UseRoomMediaApi;
  crypto: UseRoomCryptoApi;
  stopShareCleanup: (emitStop: boolean, reason?: StopShareReason) => void;

  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStreams>>;
  dismissWaitHint?: () => void;
  stopCountdown: () => void;
}

export interface UseRoomTeardownApi {
  burned: boolean;
  burnReason: string | null;
  burnTokenWarning: boolean;
  sessionEnded: boolean;
  sessionEndedReason: string | null;
  sessionEndedRef: React.MutableRefObject<boolean>;
  performLocalBurn: () => void;
  handleSessionExpired: () => void;
  handleBurnSession: () => Promise<void>;
}

export function useRoomTeardown({
  wireCodeRef,
  voidPhrase,
  isHost,
  peerIdRef,
  onLeave,
  media,
  crypto,
  stopShareCleanup,
  setRemoteStreams,
  dismissWaitHint,
  stopCountdown,
}: UseRoomTeardownOptions): UseRoomTeardownApi {
  const [burned, setBurned] = useState(false);
  // Task #311: when BURN cannot fully release every track (e.g. a
  // track.stop() throws or the GL pipeline is mid-frame) we still
  // want the user to see the BURN screen, but with a clear, short
  // reason so they're not left guessing why their call ended. `null`
  // = clean burn.
  const [burnReason, setBurnReason] = useState<string | null>(null);
  // Task #450: separate, security-grade signal — flips true when the
  // explicit BURN path could not delete the persisted host reclaim
  // token (the JWT lives encrypted in localStorage under a phrase-
  // derived slot; if the delete throws, the encrypted blob may
  // outlive the BURN). Rendered as the "BURN INCOMPLETE — TOKEN MAY
  // PERSIST" warning inside BurnedOverlay. We deliberately do NOT
  // expose a similar UI on the session-expiry path: the user is being
  // navigated away anyway, and a stale token past the room's `exp` is
  // unusable by construction.
  const [burnTokenWarning, setBurnTokenWarning] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Task #336: the session-expiry teardown is a privacy guarantee just
  // like BURN — when the room's paid window runs out we MUST release
  // every local track even if an earlier release step throws. If any
  // step fails we still show the ROOM ENDED screen, but with a short,
  // plain-language reason so the user knows their camera/mic may not
  // have shut down cleanly (mirrors `burnReason`). `null` = clean
  // teardown.
  const [sessionEndedReason, setSessionEndedReason] = useState<string | null>(
    null,
  );
  const sessionEndedRef = useRef(false);

  // Keep `isHost` available in a ref so the click handlers don't
  // capture a stale value. (The hook re-renders any time `isHost`
  // flips, but we touch it in async branches.)
  const isHostRefLocal = useRef(isHost);
  isHostRefLocal.current = isHost;

  const performLocalBurn = useCallback(() => {
    // Idempotent: host BURN, remote room-destroyed, and the
    // post-ack leave-room callback can all reach this point. The
    // ref-flag guard means a second click (or a race with a remote
    // room-destroyed event) is a no-op — we never re-stop tracks
    // that are already gone, and we never re-emit destroy-room.
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;

    // Task #311 / #501: BURN is the privacy guarantee — every release
    // step MUST be attempted even if an earlier one throws. The
    // ordered safe-step loop lives in `performBurnTeardown` so its
    // per-step failure branches are directly unit-testable; the
    // RoomPage-only state resets stay here below.
    const { failures } = performBurnTeardown({
      pendingShareRef: media.pendingShareRef,
      displayTrackRef: media.displayTrackRef,
      webrtcRef: media.webrtcRef,
      pipelineStopRef: media.pipelineStopRef,
      localStreamRef: media.localStreamRef,
      stopShareCleanup,
      clearPendingShareState: () => {
        media.setPendingShare(null);
        media.setScreenShareRequesting(false);
      },
    });
    media.setScreenSharePeerId(null);

    crypto.e2eKeyRef.current = null;
    setRemoteStreams({});
    crypto.setPeerSAS({});
    crypto.setCryptoMismatch({});
    crypto.setPeerVerification({});
    crypto.setVerificationOpenFor(null);
    crypto.resetPhraseChangeTracking();
    dismissWaitHint?.();
    media.setLocalStream(null);

    if (failures.length > 0) {
      // Short, plain-language reason. We deliberately do not echo
      // the raw error message (could contain device names / stack
      // frames); the developer-facing detail is already in
      // console.error above.
      setBurnReason(
        `Some media could not be released cleanly (${failures.join(", ")}). ` +
          `Close this tab to be safe.`,
      );
    }
    setBurned(true);
  }, [
    media,
    crypto,
    stopShareCleanup,
    setRemoteStreams,
    dismissWaitHint,
  ]);

  const handleSessionExpired = useCallback(() => {
    if (sessionEndedRef.current) return;
    sessionEndedRef.current = true;
    // Task #191: the room's paid window just ran out — the persisted
    // JWT is past its `exp` and can never claim host again. Drop it
    // now so we don't keep an unusable blob on disk waiting for the
    // 24h+grace GC.
    // Task #450: a stale-past-`exp` token is unusable by
    // construction, so we log the failure but do not surface a UI
    // warning (the user is already being navigated away by the
    // ROOM EXPIRED screen).
    clearHostToken(voidPhrase).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[expiry] clearHostToken failed", err);
    });
    const socket = getSocket();
    socket.emit("leave-room", { code: wireCodeRef.current, peerId: peerIdRef.current });

    // Task #336: mirror the BURN partial-failure resilience. Each media
    // release step runs in isolation — a thrown track.stop() or a
    // crashed pipeline can no longer abort the rest of the teardown and
    // leave the camera/mic live with the OS recording dot still on.
    const failures: string[] = [];
    const safe = (label: string, fn: () => void) => {
      try {
        fn();
      } catch (err) {
        failures.push(label);
        // eslint-disable-next-line no-console
        console.error(`[expiry] ${label} failed`, err);
      }
    };

    safe("pending screen-share", () => {
      const pending = media.pendingShareRef.current;
      if (!pending) return;
      // Null the ref before stopping so a throw mid-teardown cannot
      // leave it pointing at a half-stopped share.
      media.pendingShareRef.current = null;
      try {
        pending.track.stop();
      } finally {
        pending.stream.getTracks().forEach((t) => t.stop());
      }
      media.setPendingShare(null);
      media.setScreenShareRequesting(false);
    });
    safe("active screen-share", () => {
      if (media.displayTrackRef.current) {
        stopShareCleanup(true);
      }
    });
    media.setScreenSharePeerId(null);

    safe("peer connections", () => {
      const w = media.webrtcRef.current;
      media.webrtcRef.current = null;
      w?.destroy();
    });
    safe("media pipeline", () => {
      // Null the ref BEFORE invoking, so a throw cannot leave the ref
      // pointing at an already-half-stopped pipeline (the unmount
      // effect would otherwise re-invoke it and throw again).
      const stop = media.pipelineStopRef.current;
      media.pipelineStopRef.current = null;
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

    // Stop each track in isolation: if one throws we still want to try
    // every other one (otherwise the OS recording dot can stay on for a
    // track we never even attempted to stop).
    const tracks = media.localStreamRef.current?.getTracks() ?? [];
    for (const t of tracks) {
      safe(`local ${t.kind} track`, () => t.stop());
    }
    media.localStreamRef.current = null;
    crypto.e2eKeyRef.current = null;
    setRemoteStreams({});
    crypto.setPeerSAS({});
    crypto.setCryptoMismatch({});
    crypto.setPeerVerification({});
    crypto.setVerificationOpenFor(null);
    crypto.resetPhraseChangeTracking();
    dismissWaitHint?.();
    media.setLocalStream(null);

    if (failures.length > 0) {
      // Short, plain-language reason. We deliberately do not echo the
      // raw error message (could contain device names / stack frames);
      // the developer-facing detail is already in console.error above.
      // Same UX shape as the BURN `burnReason` line.
      setSessionEndedReason(
        `Some media could not be released cleanly (${failures.join(", ")}). ` +
          `Close this tab to be safe.`,
      );
    }
    setSessionEnded(true);
    stopCountdown();
    setTimeout(() => {
      onLeave?.("ROOM EXPIRED — TIME ENDED");
    }, 1500);
  }, [
    voidPhrase,
    wireCodeRef,
    peerIdRef,
    media,
    crypto,
    stopShareCleanup,
    setRemoteStreams,
    dismissWaitHint,
    stopCountdown,
    onLeave,
  ]);

  const handleBurnSession = useCallback(async () => {
    uiClick();
    uiSlide();
    const socket = getSocket();

    if (isHostRefLocal.current) {
      // Task #191: a host who deliberately burns the room can never
      // reclaim it (the room is gone server-side), so the persisted
      // host token in localStorage is now useless. Drop it eagerly so
      // we don't leave stale-but-still-decryptable JWTs sitting on
      // disk past their usefulness — opportunistic GC would catch
      // them eventually, but explicit cleanup is the right shape for
      // an explicit BURN.
      //
      // Task #450 Directive 2: if the delete throws (storage quota,
      // racing tab, crypto subtle unavailable in some embedded
      // WebView) surface "BURN INCOMPLETE — TOKEN MAY PERSIST" on
      // the burned overlay. We AWAIT the delete before
      // performLocalBurn() so the warning state is set BEFORE
      // BurnedOverlay first renders — making the failure signal
      // guaranteed-visible (not a timing-dependent race against the
      // overlay's 3 s auto-dismiss). The delete is a localStorage
      // round-trip plus a SubtleCrypto operation; both resolve in
      // single-digit ms in normal browsers, so the perceptible delay
      // before the overlay appears is well under one frame.
      try {
        await clearHostToken(voidPhrase);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          "[BURN] clearHostToken failed — persisted token may remain on disk",
          err,
        );
        setBurnTokenWarning(true);
      }
      // Release local capture immediately; do not gate on the
      // destroy-room ack — the server may be down or draining.
      performLocalBurn();
      socket.emit(
        "destroy-room",
        { code: wireCodeRef.current },
        (result: { success: boolean; error?: string }) => {
          if (!result?.success) {
            socket.emit("leave-room", {
              code: wireCodeRef.current,
              peerId: peerIdRef.current,
            });
          }
        },
      );
    } else {
      // Task #696: a JOINER's BURN must destroy the room for EVERYONE,
      // not just drop this peer. The old `leave-room` here removed the
      // joiner but left the room (and its phrase) live server-side, so
      // the host could still re-join the supposedly-burned room and the
      // phrase remained valid — breaking the "session burned, all keys
      // destroyed" promise. `burn-room` is the member-authorized
      // teardown: the server drops the room and broadcasts
      // `room-destroyed` to the host. As with the host path, release
      // local capture immediately and do not gate on the ack — the
      // server may be down or draining.
      performLocalBurn();
      socket.emit(
        "burn-room",
        { code: wireCodeRef.current, peerId: peerIdRef.current },
        (result: { success: boolean; error?: string }) => {
          if (!result?.success) {
            // Best-effort fallback: if the burn could not be applied
            // (e.g. the server reports the room already gone, or the
            // member check raced a reconnect) still sever this peer's
            // membership so we don't linger in a room we believe is
            // burned.
            socket.emit("leave-room", {
              code: wireCodeRef.current,
              peerId: peerIdRef.current,
            });
          }
        },
      );
    }
  }, [voidPhrase, wireCodeRef, peerIdRef, performLocalBurn]);

  return {
    burned,
    burnReason,
    burnTokenWarning,
    sessionEnded,
    sessionEndedReason,
    sessionEndedRef,
    performLocalBurn,
    handleSessionExpired,
    handleBurnSession,
  };
}
