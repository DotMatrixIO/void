// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";
import { getAudioContext, closeAudioContext } from "@/lib/sounds";
import { uiBleep, uiBloop, uiSlide } from "@/lib/uiSounds";
import { type WatermarkInfo } from "@/lib/mediaPipeline";
import {
  acquireCameraPipeline,
  applyCameraPipelineToMedia,
  mapPipelineErrorToLabel,
} from "./cameraPipelineSetup";
import {
  WebRTCManager,
  type RemoteStreams,
  type PeerConnectionStates,
  type CryptoMismatchPeers,
  type PeerRelayStatuses,
  type WebRTCRoomType,
} from "@/lib/webrtc";
import { loadHostToken } from "@/lib/hostTokenStorage";
import { rendezvousJoinCandidates } from "@/lib/rendezvous";
import { sanitizeDrop } from "@/lib/dropSanitize";
import { DEFAULT_ICE_SERVERS } from "@/lib/iceServers";
import {
  runRelayFlipHandshake,
  sendRelayFlipAck,
  isRelayFlipEnvelope,
  RELAY_FLIP_PENDING,
} from "@/lib/relayFlipHandshake";
import type { UseRoomMediaApi } from "./useRoomMedia";
import type { UseRoomCryptoApi } from "./useRoomCrypto";
import type { UseRoomSignalingApi } from "./useRoomSignaling";
import type { StopShareReason } from "./useScreenShareLifecycle";

// Task #502: extracted from RoomPage. Owns the single big "join the
// room and wire up every Socket.io listener" effect that used to
// dominate RoomPage.tsx. Functionally identical to the inline
// useEffect it replaces — same `[confirmed, roomCode]` dependency,
// same cleanup, same `hasSetup` one-shot guard.
//
// Why pass a giant options object? Because the setup body mutates
// state across every cohort (media, signaling, crypto, screen-share,
// teardown, countdown, extension, wait-hint) — every dep is already
// owned by an existing hook. Threading them through one explicit
// object keeps the call site in RoomPage trivially auditable; the
// alternative was a 50-argument signature that nothing checks.
export interface UseRoomConnectionOptions {
  // Lifecycle gating.
  confirmed: boolean;
  isSnapshot: boolean;
  roomCode: string;
  /** Task #1024: the durable `roomCode` above is kept for local-only uses
   * (watermark, candidate derivation, effect dependency). The actual value
   * routed on the wire is the resolved per-epoch rendezvous handle, which
   * this hook writes into `wireCodeRef.current` once a join candidate wins.
   * RoomPage owns the ref and threads the same instance into every sibling
   * hook so all `code:`/`roomId:` emit sites converge on the live handle.
   * For agent/hybrid rooms the resolved value equals the durable roomId. */
  wireCodeRef: React.MutableRefObject<string>;
  voidPhrase: string;
  /** Task #313: room policy derived locally from the invite (never from
   * the server) by RoomPage and passed straight to `WebRTCManager`.
   * Required — no default — so a new callsite that forgets it is a
   * compile error rather than a silent pin to the "human" policy. */
  roomType: WebRTCRoomType;
  e2eKey: CryptoKey;
  audioDeviceId?: string;

  // Local identity.
  peerIdRef: React.MutableRefObject<string>;
  peerTagRef: React.MutableRefObject<string>;
  onionOrigin: boolean;

  // Cohort hooks.
  media: UseRoomMediaApi;
  crypto: UseRoomCryptoApi;
  signaling: UseRoomSignalingApi;
  stopShareCleanup: (emitStop: boolean, reason?: StopShareReason) => void;

  // Cross-hook callbacks owned by RoomPage.
  performLocalBurn: () => void;
  handleSessionExpired: () => void;
  startCountdown: (expiresAt: number, serverNow: number) => void;
  stopCountdown: () => void;
  startWaitHintCycle?: () => void;
  flashExtendNotice: (msg: string) => void;
  resetExpiryWarning: () => void;
  setRoomTier: React.Dispatch<
    React.SetStateAction<"standard" | "day" | null>
  >;

  // Local-to-RoomPage state that the connection effect needs to set.
  setRemoteStreams: React.Dispatch<React.SetStateAction<RemoteStreams>>;
  setPeerConnectionStates: React.Dispatch<
    React.SetStateAction<PeerConnectionStates>
  >;
  setPeerRelayPinned: React.Dispatch<React.SetStateAction<PeerRelayStatuses>>;
  setPeerJoinTrigger: React.Dispatch<React.SetStateAction<number>>;
  setDropText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setMediaError: React.Dispatch<React.SetStateAction<string | null>>;
  // Task #530: surfaces the `no_turn_configured` flag from
  // /api/ice-servers up to RoomPage so the operator-banner component
  // can render. Optional — older call sites and tests can omit it.
  setNoTurnConfigured?: React.Dispatch<React.SetStateAction<boolean>>;
  onLeave?: (reason?: string) => void;
}

export interface UseRoomConnectionApi {
  // Task #710: re-run the connection effect in place (re-acquire the
  // camera pipeline and rejoin) without reloading the page. The
  // caller (RoomPage's media-error "TRY AGAIN" handler) clears the
  // media-error state and calls this so recovery no longer re-runs
  // PBKDF2 or throws away in-room state.
  retryMedia: () => void;
}

export function useRoomConnection({
  confirmed,
  isSnapshot,
  roomCode,
  wireCodeRef,
  voidPhrase,
  roomType,
  e2eKey,
  audioDeviceId,
  peerIdRef,
  peerTagRef,
  onionOrigin,
  media,
  crypto,
  signaling,
  stopShareCleanup,
  performLocalBurn,
  handleSessionExpired,
  startCountdown,
  stopCountdown,
  startWaitHintCycle,
  flashExtendNotice,
  resetExpiryWarning,
  setRoomTier,
  setRemoteStreams,
  setPeerConnectionStates,
  setPeerRelayPinned,
  setPeerJoinTrigger,
  setDropText,
  setError,
  setMediaError,
  setNoTurnConfigured,
  onLeave,
}: UseRoomConnectionOptions): UseRoomConnectionApi {
  const hasSetup = useRef(false);
  // Task #710: a media retry bumps this nonce to force the connection
  // effect to tear down and re-run *in place* — re-acquiring the
  // camera pipeline and (re)joining the room without a full page
  // reload. A reload re-mounts App, which re-runs the expensive
  // PBKDF2 room-key derivation and discards every piece of live
  // React state (phrase, e2eKey, peers, timers). Re-running this
  // effect keeps all of that intact.
  const [mediaRetryNonce, setMediaRetryNonce] = useState(0);
  const iceServersRef = useRef<RTCIceServer[]>([...DEFAULT_ICE_SERVERS]);

  // Stable refs to the latest cross-hook callbacks so the captured
  // closures inside setup() always invoke the current version even
  // though the effect itself only re-runs on [confirmed, roomCode].
  const cbRef = useRef({
    performLocalBurn,
    handleSessionExpired,
    startCountdown,
    stopCountdown,
    startWaitHintCycle,
    flashExtendNotice,
    resetExpiryWarning,
    setRoomTier,
    setError,
    setMediaError,
    setRemoteStreams,
    setPeerConnectionStates,
    setPeerRelayPinned,
    setPeerJoinTrigger,
    setDropText,
    stopShareCleanup,
    onLeave,
  });
  cbRef.current = {
    performLocalBurn,
    handleSessionExpired,
    startCountdown,
    stopCountdown,
    startWaitHintCycle,
    flashExtendNotice,
    resetExpiryWarning,
    setRoomTier,
    setError,
    setMediaError,
    setRemoteStreams,
    setPeerConnectionStates,
    setPeerRelayPinned,
    setPeerJoinTrigger,
    setDropText,
    stopShareCleanup,
    onLeave,
  };

  // Task #710: clearing the one-shot guard and bumping the nonce makes
  // React run the connection effect's cleanup (tearing down any prior
  // manager / pipeline / socket listeners) and then re-run setup() —
  // all without unmounting RoomPage, so PBKDF2 is not repeated and the
  // phrase / e2eKey / confirmed state survive the retry.
  const retryMedia = useCallback(() => {
    hasSetup.current = false;
    setMediaRetryNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!confirmed) return;
    if (isSnapshot) return;
    if (hasSetup.current) return;
    hasSetup.current = true;

    let cancelled = false;
    const socket = getSocket();
    let reconnectHandler: (() => void | Promise<void>) | null = null;
    // Task #450: captured by setup() once the room-relay-mode-enabled
    // handler installs it; removed by cleanup() below via socket.off
    // with this exact reference so we do not strip webrtc.ts's
    // sibling listener on the same `relay-signal` event.
    let relayFlipPendingHandler:
      | ((inbound: { fromPeerId: string; payload: unknown }) => void)
      | null = null;

    function createManager(stream: MediaStream) {
      return new WebRTCManager({
        localStream: stream,
        socket,
        myPeerId: peerIdRef.current,
        // Task #1024: the manager routes relay-signal and binds its
        // signed hello to the resolved rendezvous handle (frozen by the
        // winning join candidate below) — never the durable roomId. Every
        // peer converges on the same handle, so the hello cross-check still
        // holds. createManager only runs after a successful join, so the
        // ref is populated by here.
        roomCode: wireCodeRef.current,
        // Task #313: locally-derived room type (see RoomPage). Drives the
        // signed-hello room-type cross-check and the timed-rekey gate.
        roomType,
        iceServers: iceServersRef.current,
        iceTransportPolicy: signaling.iceTransportPolicyRef.current,
        e2eKey: crypto.e2eKeyRef.current as CryptoKey,
        onUpdate: cbRef.current.setRemoteStreams,
        onConnectionStateUpdate: cbRef.current.setPeerConnectionStates,
        onSASUpdate: crypto.setPeerSAS,
        onCryptoMismatch: crypto.setCryptoMismatch as React.Dispatch<
          React.SetStateAction<CryptoMismatchPeers>
        >,
        onSecureChannelFailure: crypto.setSecureChannelFailures,
        onRekey: (pid, fp) => crypto.handleRekeyRef.current(pid, fp),
        onSilentRekey: (pid, fp, sas) =>
          crypto.handleSilentRekeyRef.current(pid, fp, sas),
        onPeerRelayStatusUpdate: cbRef.current.setPeerRelayPinned,
        // Task #443: receive side. Inbound bytes are already capped
        // at 2 KB on the wire; sanitize again here defensively
        // (NFC + invisible-strip) before publishing into React state
        // so a hostile peer cannot push spoofable glyphs into the
        // slot.
        onDropReceived: (text) => {
          const { text: clean } = sanitizeDrop(text);
          cbRef.current.setDropText(clean);
        },
        // Task #868: per-peer media-state now arrives over the encrypted
        // `void.media-state` data channel instead of the plaintext
        // `peer-media-state` signaling broadcast. The merge preserves a
        // prior cached voiceMode/viaOnion on a partial update (the
        // channel payload omits a field it didn't change), exactly as the
        // old WS listener did. The webrtc layer has already strictly
        // validated types + voiceMode range before this fires.
        onMediaStateReceived: (pid, state) => {
          signaling.setPeerMediaState((prev) => ({
            ...prev,
            [pid]: {
              camOff: state.camOff,
              micMuted: state.micMuted,
              voiceMode:
                typeof state.voiceMode === "number"
                  ? state.voiceMode
                  : prev[pid]?.voiceMode,
              viaOnion:
                typeof state.viaOnion === "boolean"
                  ? state.viaOnion
                  : prev[pid]?.viaOnion,
            },
          }));
        },
      });
    }

    async function setup() {
      crypto.e2eKeyRef.current = e2eKey;

      // Task #501: camera-pipeline acquire + apply delegated to
      // co-located helpers so the failure paths (denied mic, missing
      // device, PipelineError, OverconstrainedError) can be unit-
      // tested without mounting RoomPage. Behaviour is identical to
      // the previous inline block — same error labels, same audio-
      // context teardown on failure, same cancellation interleave.
      const acquireResult = await acquireCameraPipeline({
        audioContext: getAudioContext(),
        audioDeviceId,
        // Task #522: surface post-construction pipeline failures (the
        // GOLD blank-canvas sanity check is the only one today) via
        // the same setMediaError path construction-time PipelineErrors
        // use. The pipeline already stops its own output track and
        // halts its render loop before invoking this callback, so all
        // we need to do here is publish the label.
        onError: (err) => {
          // eslint-disable-next-line no-console
          console.error("[VOID] Media pipeline runtime error:", err.name, err.message, err);
          cbRef.current.setMediaError(mapPipelineErrorToLabel(err));
        },
        // Task #526: a video style was disabled at runtime (today only
        // GOLD via the blank-frame sanity check). The pipeline has
        // already coerced the current mode to passthrough if needed
        // and will refuse to re-arm the bad style; mirroring the flag
        // into the media hook lets the cycle button skip it.
        onVideoStyleDisabled: (mode) => {
          media.markVideoStyleDisabled(mode);
        },
      });
      if (!acquireResult.ok) {
        if (cancelled) return;
        cbRef.current.setMediaError(acquireResult.errorLabel);
        return;
      }
      const pipeline = acquireResult.pipeline;

      if (cancelled) {
        pipeline.stop();
        closeAudioContext().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[audio-teardown] closeAudioContext failed", err);
        });
        return;
      }

      try {
        const resp = await fetch("/api/ice-servers");
        const data = await resp.json();
        if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
          iceServersRef.current = data.iceServers;
        }
        // Task #530: hand the structured `no_turn_configured` flag up
        // to RoomPage so the host-only operator banner can render.
        // We only publish a `true` value — never overwrite with false
        // — because (a) the server omits/falsifies the field when
        // TURN is configured, which is the dismissal state anyway,
        // and (b) a transient fetch failure should not clear a
        // previously-raised warning.
        if (data && data.no_turn_configured === true) {
          setNoTurnConfigured?.(true);
        }
      } catch {}

      if (cancelled) {
        pipeline.stop();
        closeAudioContext().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[audio-teardown] closeAudioContext failed", err);
        });
        return;
      }

      // Apply the recording-honesty watermark immediately. Room ID
      // prefix is intentionally short (6 chars) so we never burn the
      // full bearer credential into outgoing video. The peer tag is
      // the local-only identifier; mapping it back to a person is
      // the host's job.
      const initialWatermark: WatermarkInfo = {
        roomId: roomCode.slice(0, 6).toUpperCase(),
        peerTag: peerTagRef.current,
      };
      applyCameraPipelineToMedia(pipeline, media, {
        watermark: initialWatermark,
        micMuted: media.micMutedRef.current,
        camOff: media.camOffRef.current,
      });

      // Task #171 / #191: forward the cached creation/extension
      // token (if any) so the original payer can reclaim host on
      // rejoin to a vacated room. Reads from `hostTokenStorage`,
      // which decrypts an entry kept in localStorage under a
      // phrase-derived slot — meaning a host who fully closed and
      // reopened their browser still finds their JWT and reclaims
      // host. Non-payers reading this page from the URL phrase have
      // no such entry and join as ordinary participants.
      const hostToken = await loadHostToken(voidPhrase);
      if (cancelled) {
        pipeline.stop();
        closeAudioContext().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[audio-teardown] closeAudioContext failed", err);
        });
        return;
      }

      // Task #1024: resolve the room's per-epoch rendezvous handle by
      // probing the candidate window (current epoch first, then the two
      // neighbours to tolerate a 24h-boundary crossing or clock skew).
      const candidates = await rendezvousJoinCandidates(roomCode);
      if (cancelled) {
        pipeline.stop();
        closeAudioContext().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[audio-teardown] closeAudioContext failed", err);
        });
        return;
      }

      const processJoinResult = (result: {
          success: boolean;
          error?: string;
          peers: string[];
          locked?: boolean;
          maxUsers?: number;
          knockPending?: boolean;
          knockMode?: boolean;
          relayOnly?: boolean;
          isHost?: boolean;
          hostPresent?: boolean;
          hostPeerId?: string | null;
          expiresAt?: number | null;
          serverNow?: number;
          tier?: "standard" | "day" | null;
          screenSharePeerId?: string | null;
        }) => {
          if (cancelled) return;

          if (!result.success) {
            if (result.error === "KNOCK_PENDING") {
              signaling.setKnockPending(true);
              return;
            }
            pipeline.stop();
            closeAudioContext().catch((err) => {
              // eslint-disable-next-line no-console
              console.warn("[audio-teardown] closeAudioContext failed", err);
            });
            if (result.error === "ROOM_FULL") {
              cbRef.current.setError("ROOM FULL");
            }
            // Task #467: server rejects new knocks beyond the
            // per-room queue cap with `KNOCK_QUEUE_FULL`
            // (knockPending:false). It used to fall through to the
            // generic CONNECTION ERROR toast, which read like the
            // network had failed and prompted the user to retry
            // instantly — which only stacks more queue pressure.
            // Surface plain copy that names the cause and tells them
            // retrying later is the right move.
            else if (result.error === "KNOCK_QUEUE_FULL")
              cbRef.current.setError("TOO MANY PEOPLE KNOCKING — TRY AGAIN");
            else if (result.error === "ROOM_LOCKED")
              cbRef.current.setError("ROOM LOCKED");
            else if (result.error === "ROOM_EXPIRED")
              cbRef.current.setError("ROOM EXPIRED");
            else if (result.error === "INVALID_CODE")
              cbRef.current.setError("INVALID CODE");
            // ROOM_NOT_FOUND, ROOM_DESTROYED, and any unrecognized
            // "this code maps to nothing live" answer collapse into
            // the dead-room overlay's exact copy. The privacy
            // property is that "never existed" must be
            // indistinguishable from "burned" — the UI cannot help
            // the attacker tell them apart.
            else if (result.error === "ROOM_NOT_FOUND")
              cbRef.current.setError("ROOM NOT FOUND");
            else if (result.error === "ROOM_DESTROYED")
              cbRef.current.setError("ROOM DESTROYED");
            else cbRef.current.setError("CONNECTION ERROR");
            return;
          }

          if (result.maxUsers) signaling.setMaxUsers(result.maxUsers);
          if (result.locked) signaling.setRoomLocked(true);
          if (result.knockMode) signaling.setKnockMode(true);
          if (result.relayOnly) {
            signaling.iceTransportPolicyRef.current = "relay";
            signaling.setRelayOnly(true);
          }
          signaling.setPeers(result.peers);
          signaling.setIsHost(result.isHost === true);
          // Task #190: server returns `hostPresent: false` when the
          // room currently has no moderator (the original payer
          // disconnected and a guest joined into the empty host
          // slot). Default to `true` for backward compatibility with
          // any older server that doesn't yet send the field.
          signaling.setHostPresent(result.hostPresent !== false);
          // Task #232: capture the host's peer ID off the same join
          // callback that already gave us `hostPresent`. `null` here
          // means either the server is older and didn't send the
          // field, or the host slot is currently vacant — in both
          // cases we render no "HOST: …" tag rather than guess.
          signaling.setHostPeerId(result.hostPeerId ?? null);
          media.setScreenSharePeerId(result.screenSharePeerId ?? null);
          signaling.setJoined(true);

          if (result.tier) cbRef.current.setRoomTier(result.tier);
          if (result.expiresAt && result.serverNow) {
            cbRef.current.startCountdown(result.expiresAt, result.serverNow);
          }
          uiBleep();
          uiSlide();
          cbRef.current.startWaitHintCycle?.();

          const manager = createManager(pipeline.processedStream);
          media.webrtcRef.current = manager;

          for (const remotePeer of result.peers) {
            manager.initiateOffer(remotePeer);
          }

          // Task #868: seed the manager's local media-state snapshot. It
          // is replayed over each peer's `void.media-state` channel the
          // moment that channel opens, so a peer we just offered to
          // converges to our current cam/mic/voice/onion state.
          manager.setLocalMediaState({
            camOff: media.camOffRef.current,
            micMuted: media.micMutedRef.current,
            voiceMode: media.voiceModeRef.current,
            viaOnion: onionOrigin,
          });
      };

      // Probe each candidate in order, advancing ONLY on ROOM_NOT_FOUND.
      // The first candidate that yields any other ack (success, or a
      // definitive error such as LOCKED / FULL / KNOCK_PENDING) is the
      // room's frozen handle; every peer converges on it for the rest of
      // the call. If all candidates report ROOM_NOT_FOUND the room is
      // genuinely dead — collapse to the same dead-room copy the single-
      // shot path used (the chosen handle is irrelevant past that point).
      let winning: Parameters<typeof processJoinResult>[0] | null = null;
      let winningCode = candidates[candidates.length - 1];
      for (const candidate of candidates) {
        const r = await new Promise<Parameters<typeof processJoinResult>[0]>(
          (resolve) => {
            socket.emit(
              "join-room",
              {
                code: candidate,
                peerId: peerIdRef.current,
                token: hostToken,
              },
              resolve,
            );
          },
        );
        if (cancelled) return;
        if (r.success || r.error !== "ROOM_NOT_FOUND") {
          winning = r;
          winningCode = candidate;
          break;
        }
      }
      wireCodeRef.current = winningCode;
      processJoinResult(
        winning ?? { success: false, error: "ROOM_NOT_FOUND", peers: [] },
      );

      socket.on("peer-joined", ({ peerId: newPeer }: { peerId: string }) => {
        signaling.setPeers((prev) => {
          if (prev.includes(newPeer)) return prev;
          uiBleep();
          // "Anyone here can be recording" just got bigger —
          // re-surface the disclosure banner so the new peer's
          // presence is reflected.
          cbRef.current.setPeerJoinTrigger((n) => n + 1);
          return [...prev, newPeer];
        });
        // Glare avoidance (SAS-mismatch / handshake-flap fix):
        // both this peer (via `peer-joined`) and the joining peer
        // (via its `join-room` result.peers loop) call
        // `initiateOffer` for the same pair. The manager filters by
        // `shouldInitiateTo` (smaller peerId initiates — matching
        // the existing `p > peerIdRef.current` rule in the
        // relay-flip and `reinitializeAllPeers` paths), so exactly
        // one side runs the ECDHE handshake and both derive the
        // same session key + SAS. Without this call, when two peers
        // open the room nearly simultaneously and each ends up
        // seeing the other in `result.peers`, both initiate → two
        // parallel ECDHE rounds → mismatched session keys → "duet
        // words don't match" and the "KEY EXCHANGE FAILED" overlay
        // flapping between the two peers.
        media.webrtcRef.current?.initiateOffer(newPeer);
      });

      socket.on("room-destroyed", () => {
        // Route through performLocalBurn so pending + active screen
        // share are torn down (inline cleanup previously missed
        // both).
        cbRef.current.performLocalBurn();
      });

      socket.on("room-expired", () => {
        cbRef.current.stopCountdown();
        cbRef.current.handleSessionExpired();
      });

      socket.on(
        "room-extended",
        ({
          expiresAt: extExpAt,
          serverNow: extSrvNow,
          tier: extTier,
        }: {
          expiresAt?: number;
          serverNow?: number;
          tier?: "standard" | "day";
        }) => {
          if (
            typeof extExpAt !== "number" ||
            typeof extSrvNow !== "number"
          )
            return;
          cbRef.current.startCountdown(extExpAt, extSrvNow);
          if (extTier) cbRef.current.setRoomTier(extTier);
          // The new window is fresh enough that any prior near-
          // expiry warning becomes stale — reset so it can fire
          // again on the new window if needed. This also applies to
          // guests so their own near-expiry warning re-arms on the
          // new window.
          cbRef.current.resetExpiryWarning();
          // The host already gets confirmation via the extend-room
          // ack (and would otherwise see a duplicate toast). Guests
          // have no other signal that the room window just grew, so
          // surface a brief confirmation toast for them.
          if (!signaling.isHostRef.current) {
            cbRef.current.flashExtendNotice("HOST EXTENDED THE ROOM ✓");
          }
        },
      );

      socket.on("peer-left", ({ peerId: leftPeer }: { peerId: string }) => {
        signaling.setPeers((prev) => {
          const updated = prev.filter((p) => p !== leftPeer);
          if (updated.length !== prev.length) uiBloop();
          return updated;
        });
        media.webrtcRef.current?.removePeer(leftPeer);
        cbRef.current.setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[leftPeer];
          return next;
        });
        cbRef.current.setPeerConnectionStates((prev) => {
          const next = { ...prev };
          delete next[leftPeer];
          return next;
        });
        signaling.setPeerMediaState((prev) => {
          const next = { ...prev };
          delete next[leftPeer];
          return next;
        });
        crypto.setPeerVerification((prev) => {
          if (!(leftPeer in prev)) return prev;
          const next = { ...prev };
          delete next[leftPeer];
          return next;
        });
        crypto.setPhraseChangedNotice((prev) => {
          if (!(leftPeer in prev)) return prev;
          const next = { ...prev };
          delete next[leftPeer];
          return next;
        });
        if (crypto.peerKeyFingerprintsRef.current[leftPeer]) {
          const next = { ...crypto.peerKeyFingerprintsRef.current };
          delete next[leftPeer];
          crypto.peerKeyFingerprintsRef.current = next;
        }
        // Task #209: drop any stale relay-only ACCEPT/DECLINE prompt
        // for a peer who just left. Without this, the host's prompt
        // list accumulates dead entries for peers who knocked, asked
        // for relay-only, then disconnected before the host
        // responded — and a peer reconnecting with the same peerId
        // would have its fresh ask collapsed into the stale prompt
        // instead of refreshing it.
        signaling.setPendingRelayRequests((prev) =>
          prev.includes(leftPeer)
            ? prev.filter((p) => p !== leftPeer)
            : prev,
        );
        crypto.setVerificationOpenFor((prev) => {
          if (prev === leftPeer) {
            crypto.setVerificationAnchor(null);
            return null;
          }
          return prev;
        });
      });

      // Task #229: the remote peer has clicked "Retry secure channel"
      // and signalled us to clear our own failure entry for them so
      // their incoming ECDHE offer is not silently dropped in
      // handleRelay.
      socket.on(
        "peer-secure-channel-retry",
        ({ fromPeerId }: { fromPeerId: string }) => {
          if (typeof fromPeerId === "string") {
            // Task #229 follow-up (SAS-flashes-then-overlay-returns):
            // open the post-retry grace window BEFORE removePeer so that
            // any ciphertext from the remote that is already in flight
            // (encrypted under the session key we're about to delete)
            // is silently dropped by handleRelay instead of triggering
            // `failSecureChannel("decrypt_failed")` and re-raising the
            // overlay the user just dismissed. Window auto-closes the
            // moment a fresh session key is installed.
            media.webrtcRef.current?.markPostRetryGrace(fromPeerId);
            media.webrtcRef.current?.removePeer(fromPeerId);
            // Glare avoidance (handshake-flap fix): if the local
            // peer is the entitled initiator for this pair
            // (smaller peerId — matching the existing
            // `p > peerIdRef.current` rule used by relay-flip and
            // `reinitializeAllPeers`), kick off the fresh
            // handshake from here too. The remote clicker also
            // calls `initiateOffer` inside `retrySecureChannel`,
            // but the manager's `shouldInitiateTo` filter
            // guarantees exactly one side actually runs the ECDHE
            // — so both peers derive the same session key + SAS
            // instead of racing two parallel rounds.
            media.webrtcRef.current?.initiateOffer(fromPeerId);
          }
        },
      );

      socket.on("room-locked", () => signaling.setRoomLocked(true));
      socket.on("room-unlocked", () => signaling.setRoomLocked(false));

      // Task #868: peer media-state (camOff/micMuted/voiceMode/viaOnion)
      // is no longer relayed by the signaling server. It now arrives
      // peer-to-peer over the encrypted `void.media-state` data channel
      // and is merged into React state via the manager's
      // `onMediaStateReceived` callback (wired in createManager above).

      socket.on(
        "knock-request",
        ({ peerId: knockPeer }: { peerId: string }) => {
          signaling.setPendingKnocks((prev) =>
            prev.includes(knockPeer) ? prev : [...prev, knockPeer],
          );
          uiBleep();
        },
      );

      // Cooperative relay-only flow (Task #106). Host sees an
      // accept/decline prompt; the underlying policy that "host
      // decides" is unchanged.
      socket.on(
        "relay-only-requested",
        ({ peerId: requesterPeer }: { peerId: string }) => {
          signaling.setPendingRelayRequests((prev) =>
            prev.includes(requesterPeer) ? prev : [...prev, requesterPeer],
          );
          uiBleep();
        },
      );

      // Requester-side acknowledgment when the host declines. Quiet
      // by design — no audible cue, and the badge cancellation alone
      // is the right "your ask was answered" signal.
      socket.on("relay-only-request-declined", () => {
        signaling.setRelayRequestSent(false);
        signaling.flashRelayResponseNotice("HOST DECLINED RELAY-ONLY");
      });

      // Host accepted (theirs or someone else's) → room is now
      // relay-only. Every member receives this and re-negotiates
      // their peer connections under iceTransportPolicy "relay" so
      // peer IPs stop leaking in subsequent ICE candidates.
      socket.on(
        "room-relay-mode-enabled",
        ({ requestedBy }: { requestedBy?: string }) => {
          // Setting the ref AND state — the ref is read by
          // createManager (used on knock-approved/reconnect paths)
          // and the state drives the visible RELAY ONLY badge and
          // the request button hiding.
          signaling.iceTransportPolicyRef.current = "relay";
          signaling.setRelayOnly(true);
          signaling.setRelayRequestSent(false);
          // Clear any pending host-side prompts. Once the room is
          // relay-only, every queued "asks for relay only" is
          // redundant — the ask is satisfied. Without this, hosts
          // who accepted one peer's ask would still see stale
          // ACCEPT/DECLINE prompts for any other peer who'd asked
          // in parallel.
          signaling.setPendingRelayRequests([]);
          signaling.flashRelayResponseNotice("RELAY ONLY ENABLED");
          // Show brief attribution when a peer's request triggered
          // the flip. The host self-trigger path emits no
          // `requestedBy`, so that case falls through without
          // changing the badge (current behavior).
          if (
            typeof requestedBy === "string" &&
            /^peer-[a-z0-9]{6}$/.test(requestedBy)
          ) {
            if (signaling.relayRequestedByTimerRef.current)
              clearTimeout(signaling.relayRequestedByTimerRef.current);
            signaling.setRelayRequestedBy(requestedBy);
            signaling.relayRequestedByTimerRef.current = setTimeout(() => {
              signaling.setRelayRequestedBy(null);
              signaling.relayRequestedByTimerRef.current = null;
            }, 6000);
          }

          const manager = media.webrtcRef.current;
          if (!manager) return;
          manager.setIceTransportPolicy("relay");

          // Deterministic initiator selection: only peers whose
          // peerId sorts AFTER mine get a fresh offer from us. The
          // other side does the same comparison and picks the
          // opposite half. Without this, every pair would get two
          // simultaneous offers (glare) when both sides receive the
          // broadcast.
          signaling.setPeers((currentPeers) => {
            const initiateTo = currentPeers.filter(
              (p) => p > peerIdRef.current,
            );
            const otherPeers = currentPeers.filter(
              (p) => p !== peerIdRef.current,
            );
            // Task #450 Directive 1: two-phase handshake replacing
            // the original 250 ms band-aid. Every peer that
            // received the `room-relay-mode-enabled` broadcast
            // acknowledges that it has torn down its pre-flip
            // RTCPeerConnections BEFORE we issue fresh offers —
            // eliminating the race where a receiver still holding
            // the policy="all" PC reuses it for the answer and
            // defeats the relay-only privacy guarantee.
            //
            // Plaintext envelopes ride the existing `relay-signal`
            // channel so the API server stays untouched (Directive
            // 3); they carry only `{ type, flipId }` and the server
            // already knows the flip is in progress from its own
            // broadcast. The handshake always resolves
            // (best-effort): on the fallback path (a peer drops
            // between the broadcast and the ack) we proceed anyway
            // so the user is never stranded with a half-flipped
            // room.
            void runRelayFlipHandshake({
              socket,
              code: wireCodeRef.current,
              myPeerId: peerIdRef.current,
              otherPeers,
            }).then((result) => {
              // Task #450 teardown-safety: the handshake's fallback
              // timeout (RELAY_FLIP_FALLBACK_MS = 2000ms) can
              // outlive the room — the user can BURN, the session
              // can expire, or the component can unmount between
              // sending pending and the .then resolving. If we
              // proceed blindly we would call reinitializeAllPeers
              // on a destroyed manager and emit peer-media-state
              // for a non-existent session.
              if (cancelled) return;
              if (media.webrtcRef.current !== manager) return;
              if (!result.completedCleanly) {
                // eslint-disable-next-line no-console
                console.warn(
                  "[VOID] relay-flip handshake incomplete — proceeding with fallback",
                  { missing: result.missing, flipId: result.flipId },
                );
              }
              manager.reinitializeAllPeers(initiateTo);
              // Re-publish media state so the new PCs carry the
              // same cam/mic/voice info as before the
              // renegotiation. The fresh `void.media-state` channels
              // replay this snapshot on open (Task #868).
              manager.setLocalMediaState({
                camOff: media.camOffRef.current,
                micMuted: media.micMutedRef.current,
                voiceMode: media.voiceModeRef.current,
                viaOnion: onionOrigin,
              });
            });
            return currentPeers;
          });
        },
      );

      // Task #450 Directive 1: inbound side of the relay-flip
      // handshake. When a peer sends us `relay-flip-pending` (over
      // the existing `relay-signal` channel), tear down their PC
      // locally FIRST, then ack — so by the time the initiator reads
      // our ack and starts issuing fresh offers, we are guaranteed
      // not to hold a stale pre-flip RTCPeerConnection.
      //
      // webrtc.ts's own `relay-signal` listener safely ignores these
      // envelopes (unknown payload.type → no-op in its type switch),
      // so a sibling listener here does not create a double-handle
      // race.
      //
      // Named function so cleanup below can `socket.off(
      // "relay-signal", relayFlipPendingHandler)` precisely without
      // ripping out webrtc.ts's own sibling listener on the same
      // event.
      relayFlipPendingHandler = (inbound: {
        fromPeerId: string;
        payload: unknown;
      }) => {
        if (!isRelayFlipEnvelope(inbound?.payload)) return;
        if (inbound.payload.type !== RELAY_FLIP_PENDING) return;
        const mgr = media.webrtcRef.current;
        if (mgr) mgr.removePeer(inbound.fromPeerId);
        sendRelayFlipAck({
          socket,
          code: wireCodeRef.current,
          myPeerId: peerIdRef.current,
          toPeerId: inbound.fromPeerId,
          flipId: inbound.payload.flipId,
        });
      };
      socket.on("relay-signal", relayFlipPendingHandler);

      socket.on(
        "knock-mode-changed",
        ({ enabled }: { enabled: boolean }) => {
          signaling.setKnockMode(enabled);
        },
      );

      socket.on(
        "knock-approved",
        ({
          code,
          peers: approvedPeers,
          relayOnly: rl,
          expiresAt: knockExpAt,
          serverNow: knockSrvNow,
          tier: knockTier,
          screenSharePeerId: knockSharePeerId,
          hostPresent: knockHostPresent,
          hostPeerId: knockHostPeerId,
        }: {
          code: string;
          peers: string[];
          relayOnly?: boolean;
          expiresAt?: number;
          serverNow?: number;
          tier?: "standard" | "day" | null;
          screenSharePeerId?: string | null;
          hostPresent?: boolean;
          hostPeerId?: string | null;
        }) => {
          // Task #1024: the server echoes back the WIRE code it routed on
          // (the rotating rendezvous handle for human rooms), not the durable
          // phrase-derived roomCode. Gate on the frozen wire handle this peer
          // joined under — comparing to the durable roomCode would drop every
          // human-room knock-approve and strand the admitted knocker pending.
          if (code !== wireCodeRef.current) return;
          signaling.setKnockPending(false);
          if (rl) {
            signaling.iceTransportPolicyRef.current = "relay";
            signaling.setRelayOnly(true);
          }
          signaling.setPeers(approvedPeers);
          // Task #190: same `!== false` defaulting as the join
          // callback — an older server that omits the field is
          // treated as "host present", so the pill never lights up
          // against an unmoderated build that nonetheless still has
          // a host.
          signaling.setHostPresent(knockHostPresent !== false);
          // Task #232: same `hostPeerId` capture as the primary join
          // path — a knock-approve hand-off lands us in the room
          // with the same server-truth fields, so the "HOST:
          // PEER-XYZ" tag should be populated immediately rather
          // than waiting for the next host-changed broadcast.
          signaling.setHostPeerId(knockHostPeerId ?? null);
          media.setScreenSharePeerId(knockSharePeerId ?? null);
          signaling.setJoined(true);
          if (knockTier) cbRef.current.setRoomTier(knockTier);
          if (knockExpAt && knockSrvNow) {
            cbRef.current.startCountdown(knockExpAt, knockSrvNow);
          }
          uiBleep();
          uiSlide();
          cbRef.current.startWaitHintCycle?.();
          if (media.localStreamRef.current) {
            const manager = createManager(media.localStreamRef.current);
            media.webrtcRef.current = manager;
            for (const rp of approvedPeers) {
              manager.initiateOffer(rp);
            }
            // Task #868: seed local media-state for convergence over the
            // new peers' `void.media-state` channels.
            manager.setLocalMediaState({
              camOff: media.camOffRef.current,
              micMuted: media.micMutedRef.current,
              voiceMode: media.voiceModeRef.current,
              viaOnion: onionOrigin,
            });
          }
        },
      );

      socket.on("knock-denied", () => {
        signaling.setKnockPending(false);
        cbRef.current.setError("ENTRY DENIED");
      });

      socket.on(
        "screen-share-state",
        ({
          activeScreenSharePeerId: sp,
        }: {
          activeScreenSharePeerId: string | null;
        }) => {
          media.setScreenSharePeerId(sp);
          if (sp !== peerIdRef.current && media.displayTrackRef.current) {
            cbRef.current.stopShareCleanup(false, "revoked");
          }
        },
      );

      // Task #190: react to the host slot vacating or being
      // reclaimed. The server emits this when a host disconnects
      // (leaving peers behind) and again when the original payer
      // rejoins and successfully reclaims via `claimHost`. The local
      // listener simply mirrors the server's truth so the "HOST
      // OFFLINE" pill and disabled lock/knock buttons appear and
      // disappear in sync with moderation actually being available.
      socket.on(
        "host-changed",
        ({
          hostPresent: nextPresent,
          hostPeerId: nextHostPeerId,
        }: {
          hostPresent: boolean;
          hostPeerId: string | null;
        }) => {
          signaling.setHostPresent(nextPresent === true);
          // Task #232: mirror the broadcast so the "HOST: PEER-XYZ"
          // tag updates live as the host slot changes hands. The
          // server sends `hostPeerId: null` when the slot is vacant
          // (`nextPresent` false) and a fresh ID when a reclaim
          // happens — both cases collapse to "use whatever the
          // server says".
          signaling.setHostPeerId(nextHostPeerId ?? null);
        },
      );

      reconnectHandler = async () => {
        if (cancelled || !media.localStreamRef.current) return;
        media.webrtcRef.current?.destroy();
        media.webrtcRef.current = null;
        signaling.setPeers([]);
        cbRef.current.setRemoteStreams({});
        cbRef.current.setPeerConnectionStates({});
        signaling.setPeerMediaState({});
        crypto.setPeerSAS({});
        crypto.setCryptoMismatch({});
        crypto.setPeerVerification({});
        crypto.setVerificationOpenFor(null);
        crypto.resetPhraseChangeTracking();
        cbRef.current.startWaitHintCycle?.();

        // Task #171 / #191: same host-token forwarding as the
        // primary join path — if a knock-approve hand-off lands in
        // a vacated room, the original payer can still reclaim host
        // on this rejoin. The load is async (decrypts the
        // encrypted-at-rest entry) so this handler is async; we
        // re-check `cancelled` after the await for the same reason
        // the primary path does.
        const hostToken = await loadHostToken(voidPhrase);
        if (cancelled || !media.localStreamRef.current) return;

        socket.emit(
          "join-room",
          {
            // Task #1024: reconnect reuses the handle the initial join
            // already froze into wireCodeRef — no re-windowing, the room
            // is registered under exactly this value.
            code: wireCodeRef.current,
            peerId: peerIdRef.current,
            token: hostToken,
          },
          (result: {
            success: boolean;
            error?: string;
            peers: string[];
            maxUsers?: number;
            expiresAt?: number | null;
            serverNow?: number;
            tier?: "standard" | "day" | null;
            screenSharePeerId?: string | null;
            hostPresent?: boolean;
            hostPeerId?: string | null;
          }) => {
            if (cancelled || !media.localStreamRef.current) return;
            if (!result.success) {
              if (result.error === "ROOM_FULL")
                cbRef.current.setError("ROOM FULL");
              else if (result.error === "ROOM_EXPIRED")
                cbRef.current.setError("ROOM EXPIRED");
              else if (result.error === "INVALID_CODE")
                cbRef.current.setError("INVALID CODE");
              // Same dead-room collapse as the primary join handler
              // — the room may have burned in the gap between
              // knock-approve and re-join. UI must not distinguish
              // "expired", "destroyed", and "never existed".
              else if (result.error === "ROOM_NOT_FOUND")
                cbRef.current.setError("ROOM NOT FOUND");
              else if (result.error === "ROOM_DESTROYED")
                cbRef.current.setError("ROOM DESTROYED");
              else cbRef.current.setError("CONNECTION ERROR");
              cbRef.current.onLeave?.();
              return;
            }
            if (result.maxUsers) signaling.setMaxUsers(result.maxUsers);
            signaling.setPeers(result.peers);
            // Task #190: rehydrate the host-presence pill on
            // reconnect too. A network drop that survived through
            // to the original payer reclaiming would otherwise
            // leave the pill stuck on its pre-drop value until the
            // next `host-changed` broadcast.
            signaling.setHostPresent(result.hostPresent !== false);
            // Task #232: rehydrate the host's peer ID on reconnect
            // for the same reason we rehydrate `hostPresent` — a
            // network drop that survived through a host change
            // would otherwise leave the "HOST: PEER-XYZ" tag stuck
            // on its pre-drop value until the next `host-changed`
            // broadcast.
            signaling.setHostPeerId(result.hostPeerId ?? null);
            media.setScreenSharePeerId(result.screenSharePeerId ?? null);

            if (result.tier) cbRef.current.setRoomTier(result.tier);
            if (result.expiresAt && result.serverNow) {
              cbRef.current.startCountdown(
                result.expiresAt,
                result.serverNow,
              );
            }

            const manager = createManager(media.localStreamRef.current);
            media.webrtcRef.current = manager;

            if (
              media.displayTrackRef.current &&
              media.displayTrackRef.current.readyState === "live"
            ) {
              // After a reconnect we must re-publish the
              // screen-share track, but ONLY through the watermark
              // wrapper. Per the loud-fail policy, if the wrapper
              // died with the previous socket session we tear the
              // share down rather than re-publishing the raw
              // (unwatermarked) display track — attribution must
              // hold across reconnects.
              const wmTrack = media.screenShareWatermarkRef.current?.track;
              if (wmTrack && wmTrack.readyState === "live") {
                manager.replaceVideoTrack(wmTrack);
              } else {
                // eslint-disable-next-line no-console
                console.error(
                  "[void] reconnect: watermark wrapper unavailable, aborting share to preserve attribution",
                );
                cbRef.current.stopShareCleanup(true, "ended");
                media.setShareNotice(
                  "SCREEN SHARE STOPPED · WATERMARK LOST ON RECONNECT",
                );
              }
            } else if (media.displayTrackRef.current) {
              cbRef.current.stopShareCleanup(true);
            }

            for (const remotePeer of result.peers) {
              manager.initiateOffer(remotePeer);
            }

            const sharingNow =
              media.displayTrackRef.current?.readyState === "live";
            // Task #868: re-seed media-state after reconnect so the new
            // peer connections converge over `void.media-state`.
            manager.setLocalMediaState({
              camOff: sharingNow ? false : media.camOffRef.current,
              micMuted: media.micMutedRef.current,
              voiceMode: media.voiceModeRef.current,
              viaOnion: onionOrigin,
            });
          },
        );
      };
      socket.io.on("reconnect", reconnectHandler);
    }

    setup();

    return () => {
      cancelled = true;
      socket.off("peer-joined");
      socket.off("peer-left");
      socket.off("room-locked");
      socket.off("room-unlocked");
      socket.off("room-destroyed");
      socket.off("room-expired");
      socket.off("room-extended");
      socket.off("knock-request");
      socket.off("knock-mode-changed");
      socket.off("knock-approved");
      socket.off("knock-denied");
      socket.off("screen-share-state");
      socket.off("host-changed");
      socket.off("relay-only-requested");
      socket.off("relay-only-request-declined");
      socket.off("room-relay-mode-enabled");
      socket.off("peer-secure-channel-retry");
      // Task #450: surgical removal of our sibling relay-signal
      // listener — webrtc.ts owns its own relay-signal handler on
      // this same event, so we MUST pass the exact handler reference
      // to socket.off (a bare `socket.off("relay-signal")` would
      // strip webrtc.ts's handler too and silently break key
      // exchange + ICE candidate plumbing on the next room).
      if (relayFlipPendingHandler) {
        socket.off("relay-signal", relayFlipPendingHandler);
        relayFlipPendingHandler = null;
      }
      if (media.displayTrackRef.current) {
        media.displayTrackRef.current.onended = null;
        media.displayTrackRef.current.stop();
        media.displayTrackRef.current = null;
      }
      // Tear down the screen-share watermark wrapper independently
      // of displayTrackRef. The compositor canvas, source <video>,
      // and rAF loop live inside the wrapper and would otherwise
      // leak across mount/unmount on this code path (we null
      // `onended` above, so stopShareCleanup will not fire from the
      // track-ended handler).
      if (media.screenShareWatermarkRef.current) {
        try {
          media.screenShareWatermarkRef.current.stop();
        } catch {}
        media.screenShareWatermarkRef.current = null;
      }
      if (media.pendingShareRef.current) {
        try {
          media.pendingShareRef.current.track.stop();
        } catch {}
        try {
          media.pendingShareRef.current.stream
            .getTracks()
            .forEach((t) => t.stop());
        } catch {}
        media.pendingShareRef.current = null;
      }
      if (reconnectHandler) socket.io.off("reconnect", reconnectHandler);
      media.webrtcRef.current?.destroy();
      media.webrtcRef.current = null;
      media.pipelineStopRef.current?.();
      media.pipelineStopRef.current = null;
      closeAudioContext().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[audio-teardown] closeAudioContext failed", err);
      });
      media.setVideoStyleRef.current = null;
      media.setVoiceModeRef.current = null;
      media.localStreamRef.current = null;
      cbRef.current.stopCountdown();
      if (media.shareNoticeTimerRef.current) {
        clearTimeout(media.shareNoticeTimerRef.current);
        media.shareNoticeTimerRef.current = null;
      }
      if (signaling.relayResponseNoticeTimerRef.current) {
        clearTimeout(signaling.relayResponseNoticeTimerRef.current);
        signaling.relayResponseNoticeTimerRef.current = null;
      }
      if (signaling.relayRequestedByTimerRef.current) {
        clearTimeout(signaling.relayRequestedByTimerRef.current);
        signaling.relayRequestedByTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed, roomCode, mediaRetryNonce]);

  return { retryMedia };
}
