// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";
import { resumeAudio } from "@/lib/sounds";
import { uiClick, uiSelectClick } from "@/lib/uiSounds";
import { getSelfViewVisible, setSelfViewVisible } from "@/lib/selfView";
import {
  DEFAULT_VIDEO_STYLE,
  DEFAULT_VOICE_MODE,
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
  getUnmaskedVideoHintDismissed,
  getUnmaskedVoiceHintDismissed,
  setUnmaskedVideoHintDismissed,
  setUnmaskedVoiceHintDismissed,
  setAllowUnmaskedVideo,
  setAllowUnmaskedVoice,
  subscribeMaskingPrefs,
} from "@/lib/maskingPrefs";
import { type VideoStyle } from "@/lib/mediaPipeline";
import MasksSheet from "@/components/MasksSheet";
import { type RemoteStreams, type PeerConnectionStates, type PeerRelayStatuses } from "@/lib/webrtc";
import RoomHeaderBar from "./room/RoomHeaderBar";
import HostModerationRow from "./room/HostModerationRow";
import ExpiryWarningToast from "./room/ExpiryWarningToast";
import ScreenShareModals from "./room/ScreenShareModals";
import PeerTileGrid from "./room/PeerTileGrid";
import { phraseToHash } from "@/lib/voidPhrase";
import { buildJoinUrl } from "@/lib/buildJoinUrl";
import RoomShareSheet from "@/components/RoomShareSheet";
import PaywallModal from "@/components/PaywallModal";
import RecordingDisclosureBanner from "@/components/RecordingDisclosureBanner";
import DevToolsP2PModal from "@/components/DevToolsP2PModal";
import DeadRoomOverlay, { isDeadRoomError } from "@/components/DeadRoomOverlay";
import BurnedOverlay from "@/components/BurnedOverlay";
import SasVerificationDialog from "@/components/SasVerificationDialog";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";
import { DropSlot } from "@/components/DropSlot";
import DirectP2PBadge from "@/components/DirectP2PBadge";
import { isOnionOrigin } from "@/lib/origin";
import { getOnionMirrorUrl } from "@/lib/onionMirror";
import { consumePaidCreateOnion } from "@/lib/paidCreateOnion";
import {
  getExpiryWarnLeadMs,
  getExpiryUrgentThresholdMs,
} from "@/lib/expiryWarning";
import { deriveRoomPhase } from "@/lib/RoomStateMachine";
import { useRoomCrypto } from "@/hooks/useRoomCrypto";
import { useRoomMedia } from "@/hooks/useRoomMedia";
import { useScreenShareLifecycle } from "@/hooks/useScreenShareLifecycle";
import { useRoomSignaling } from "@/hooks/useRoomSignaling";
import { useRoomCountdown } from "@/hooks/useRoomCountdown";
import { useExpiryWarning } from "@/hooks/useExpiryWarning";
import { useRoomExtension } from "@/hooks/useRoomExtension";
import { useRoomTeardown } from "@/hooks/useRoomTeardown";
import { useRoomConnection } from "@/hooks/useRoomConnection";
import NoTurnBanner from "@/components/NoTurnBanner";
import { useAllowUnmaskedToggleControl } from "@/components/AllowUnmaskedToggleControl";
import { VuMeter, VideoSlot, SharePreviewVideo, describeSecureChannelFailure } from "./room/videoTiles";

/** Snapshot mode: pre-populate state for marketing-still capture (no socket/media/RTC). */
export interface RoomSnapshotState {
  peers: string[];
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  peerMediaState?: Record<string, { camOff: boolean; micMuted: boolean; voiceMode?: number; viaOnion?: boolean }>;
  isHost?: boolean;
  hostPresent?: boolean;
  hostPeerId?: string | null;
  expiresAtWallClock?: number;
  remainingMs?: number;
  roomTier?: "standard" | "day" | null;
  myPeerId?: string;
  /**
   * Task #519: optional snapshot seeds so the layout smoke harness
   * (`SmokeRoom.tsx`) can mount the real RoomPage with every tile in
   * the secure-channel-failure state and the single-line wait-hint
   * already visible, without driving WebRTC or waiting the 20s hint
   * delay. Both default to off so existing snapshot callers (the
   * marketing still poster) are unaffected.
   */
  secureChannelFailures?: import("@/lib/webrtc").SecureChannelFailures;
}

interface Props {
  roomId: string;
  e2eKey: CryptoKey;
  voidPhrase: string;
  fromUrl?: boolean;
  onLeave?: (reason?: string) => void;
  audioDeviceId?: string;
  initialVideoStyle?: VideoStyle;
  initialVoiceMode?: number;
  snapshotState?: RoomSnapshotState;
}

export default function RoomPage({ roomId, e2eKey, voidPhrase, fromUrl = false, onLeave, audioDeviceId, initialVideoStyle, initialVoiceMode, snapshotState }: Props) {
  const roomCode = roomId;
  // Task #1024: the durable, phrase-derived `roomCode` above is kept for
  // local-only uses (recording watermark, screen-share nonce store, effect
  // deps). The value actually routed on the wire is the per-epoch rendezvous
  // handle, which useRoomConnection resolves via a windowed join and freezes
  // into this ref; every sibling hook + inline emit reads `.current` so all
  // `code:`/`roomId:` fields converge on the live handle. Seeded with the
  // durable id so any emit that somehow fires pre-join is still well-formed.
  const wireCodeRef = useRef(roomCode);
  const isSnapshot = !!snapshotState;
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(isSnapshot ? true : !fromUrl);
  const [copied, setCopied] = useState(false);
  const [shareMethod, setShareMethod] = useState<"sent" | "copied">("copied");
  // Item 5: one-time "you are alone — share the link" prompt for a host who has
  // just landed in an empty room, so they don't have to discover the SHARE
  // control on their own. Dismissed permanently for this room once acted on or
  // closed; it also disappears naturally the moment a peer joins (count > 1).
  const [aloneDismissed, setAloneDismissed] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  // Task #594: MASKS sheet (replaces the two footer cyclers) and the
  // per-session phrase-row reveal. phraseRevealed starts true so the full
  // 6-word phrase is shown on entry; the explicit dismiss lives in
  // component state (not localStorage) so it resets on reload / rejoin.
  const [masksSheetOpen, setMasksSheetOpen] = useState(false);
  // Task #594: bump to force the MasksSheet to flush its rolling audio
  // ring buffer (zero captured samples + stop playback) the instant the
  // session ends — BURN, server-side session end, or an explicit leave —
  // so no masked audio survives the teardown even mid-preview.
  const [masksFlushSignal, setMasksFlushSignal] = useState(0);
  const [blinkOn, setBlinkOn] = useState(true);
  const showEchoWarn = !isSnapshot;
  const [remoteStreams, setRemoteStreams] = useState<RemoteStreams>(snapshotState?.remoteStreams ?? {});
  const [peerConnectionStates, setPeerConnectionStates] = useState<PeerConnectionStates>({});
  const [retryFailed, setRetryFailed] = useState(false);
  const [devToolsP2PModalOpen, setDevToolsP2PModalOpen] = useState(false);
  const crypto = useRoomCrypto({
    initialSecureChannelFailures: snapshotState?.secureChannelFailures,
  });
  const {
    peerSAS,
    setPeerSAS,
    cryptoMismatch,
    setCryptoMismatch,
    secureChannelFailures,
    setSecureChannelFailures,
    peerVerification,
    setPeerVerification,
    verificationOpenFor,
    setVerificationOpenFor,
    verificationAnchor,
    setVerificationAnchor,
    phraseChangedNotice,
    setPhraseChangedNotice,
    silentRekeyNotice,
    handleRekey,
    sasFingerprintFor,
    verifyStateFor,
    setVerifyStatus,
  } = crypto;
  const signaling = useRoomSignaling({
    wireCodeRef,
    initialPeers: snapshotState?.peers ?? [],
    initialJoined: isSnapshot,
    initialIsHost: snapshotState?.isHost ?? false,
    initialHostPresent: snapshotState?.hostPresent ?? true,
    initialHostPeerId: snapshotState?.hostPeerId ?? null,
    initialPeerMediaState: snapshotState?.peerMediaState ?? {},
  });
  const {
    peers, setPeers,
    joined,
    isHost, isHostRef,
    hostPresent,
    hostPeerId,
    roomLocked,
    maxUsers,
    knockMode,
    knockPending, setKnockPending,
    pendingKnocks,
    relayOnly,
    relayRequestSent,
    pendingRelayRequests,
    relayResponseNotice,
    relayRequestedBy,
    peerMediaState,
    handleToggleLock,
    handleToggleKnock,
    handleApproveKnock,
    handleDenyKnock,
    handleRequestRelayOnly,
    handleRespondRelayRequest,
  } = signaling;
  const roomMedia = useRoomMedia({
    initialVideoStyle: initialVideoStyle ?? 0,
    initialVoiceMode: initialVoiceMode ?? 0,
    initialLocalStream: snapshotState?.localStream ?? null,
  });
  const {
    micMuted, setMicMuted, micMutedRef,
    camOff, setCamOff, camOffRef,
    videoStyle, setVideoStyleState, videoStyleRef, setVideoStyleRef,
    voiceMode, setVoiceMode, voiceModeRef, setVoiceModeRef,
    localStream, setLocalStream, localStreamRef,
    localAnalyser, setLocalAnalyser,
    pipelineStopRef,
    isScreenSharing, setIsScreenSharing,
    screenSharePeerId, setScreenSharePeerId,
    screenShareRequesting, setScreenShareRequesting,
    localPreviewStream, setLocalPreviewStream,
    showShareWarning, setShowShareWarning,
    pendingShare, setPendingShare, pendingShareRef,
    shareNotice, setShareNotice, shareNoticeTimerRef,
    displayTrackRef,
    preShareCamOffRef,
    screenShareWatermarkRef,
    lastSeenGrantNonceRef,
    watermarkRef, setWatermarkRef,
    webrtcRef,
    showShareNotice,
  } = roomMedia;
  const [peerRelayPinned, setPeerRelayPinned] = useState<PeerRelayStatuses>({});
  const [isNarrowViewport, setIsNarrowViewport] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 600px)").matches : false,
  );
  const [layoutTick, setLayoutTick] = useState(0);
  const [dropText, setDropText] = useState<string>("");
  const displayMediaSupported = typeof navigator?.mediaDevices?.getDisplayMedia === "function";

  // Focus traps; sessionEndedDialogRef is declared after useRoomTeardown.
  const mediaErrorDialogRef = useDialogFocusTrap<HTMLDivElement>({
    active: mediaError !== null,
    onEscape: () => goBack(),
  });
  const knockPendingDialogRef = useDialogFocusTrap<HTMLDivElement>({
    active: knockPending,
    onEscape: () => {
      uiClick();
      const socket = getSocket();
      socket.emit("cancel-knock", { code: wireCodeRef.current });
      setKnockPending(false);
      goBack();
    },
  });
  const shareWarningDialogRef = useDialogFocusTrap<HTMLDivElement>({
    active: showShareWarning,
    onEscape: () => setShowShareWarning(false),
  });
  const pendingShareDialogRef = useDialogFocusTrap<HTMLDivElement>({
    active: pendingShare !== null,
    onEscape: () => cancelPendingShare(),
  });

  const peerId = useRef(snapshotState?.myPeerId ?? `peer-${Math.random().toString(36).slice(2, 8)}`);
  // Per-peer watermark tag (uppercase) — stable for the room session, burned into video.
  const peerTag = useRef(peerId.current.replace(/^peer-/, "PEER-").toUpperCase());
  // Monotonic counter so RecordingDisclosureBanner re-triggers its auto-dismiss timer.
  const [peerJoinTrigger, setPeerJoinTrigger] = useState(0);
  // Task #530: surfaces the `no_turn_configured: true` flag from
  // /api/ice-servers. Rendered as a host-only operator banner below
  // so a self-hoster who forgot to set TURN_URL sees the
  // misconfiguration from the running app, not just from logs.
  const [noTurnConfigured, setNoTurnConfigured] = useState(false);
  // Task #597: track signaling-socket connectivity so the wait-hint can
  // surface a dedicated "lost the signaling server" cause (which takes
  // priority over the generic timeout / peer-failed copy). Seeded from
  // the live socket's current connected flag and kept in sync via the
  // socket's connect / disconnect events. Skipped under the snapshot
  // harness (no real socket there).
  const [signalingConnected, setSignalingConnected] = useState(true);
  useEffect(() => {
    if (isSnapshot) return;
    const socket = getSocket();
    setSignalingConnected(socket.connected);
    const onConnect = () => setSignalingConnected(true);
    const onDisconnect = () => setSignalingConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [isSnapshot]);
  const onionOrigin = useRef(isOnionOrigin()).current;
  // Task #1022: when a .onion mirror is published but this session reached
  // VOID over clearnet, surface the connection path explicitly so "clearnet"
  // is a visible, known state rather than a silent default. Suppressed when
  // no .onion mirror exists (there is no alternative path to offer) or when
  // the page itself loaded over the onion origin (the positive "Connected
  // via Tor onion" badge covers that case).
  const onionMirrorConfigured = useRef(getOnionMirrorUrl() !== null).current;

  // Task #345: if this room was just opened via a fresh paid create over a
  // .onion origin (marker set by StartScreen the moment the Lightning payment
  // settled), raise a single dismissible reminder that paying from a clearnet
  // wallet linked the host's IP to this room at the operator's Lightning node.
  // We consume the marker exactly once on mount — re-running it is guarded by a
  // ref so a re-render or a dev double-invoke can't lose the flag — and gate on
  // `onionOrigin` so clearnet rooms are never affected even if the marker
  // somehow lingers. Once dismissed (or after a reload, since the marker was
  // consumed) it never re-appears for this room.
  const [showLightningIpNotice, setShowLightningIpNotice] = useState(false);
  const lightningIpNoticeConsumedRef = useRef(false);
  useEffect(() => {
    if (isSnapshot || lightningIpNoticeConsumedRef.current) return;
    lightningIpNoticeConsumedRef.current = true;
    if (onionOrigin && consumePaidCreateOnion()) {
      setShowLightningIpNotice(true);
    }
  }, [isSnapshot, onionOrigin]);

  const {
    stopShareCleanup,
    confirmAndStartShare,
    confirmPendingShare,
    cancelPendingShare,
    pickAnotherShareSource,
  } = useScreenShareLifecycle({
    media: roomMedia,
    roomCode,
    wireCodeRef,
    peerIdRef: peerId,
    onionOrigin,
    uiClick,
  });

  // Task #502 hooks wiring: waitHint → countdown → expiry → teardown → extension → connection.
  const sessionExpiredRef = useRef<(() => void) | null>(null);
  const countdown = useRoomCountdown({
    initialRemainingMs: snapshotState?.remainingMs ?? null,
    initialExpiresAtWallClock: snapshotState?.expiresAtWallClock ?? null,
    initialRoomTier: snapshotState?.roomTier ?? null,
    onExpired: () => sessionExpiredRef.current?.(),
  });
  const { remainingMs, expiresAtWallClock, roomTier, setRoomTier,
    startCountdown, stopCountdown } = countdown;
  const expiry = useExpiryWarning({ isHost, remainingMs, roomTier });
  const {
    expiryWarningPhase,
    expiryWarningSnoozeUsed,
    dismissExpiryWarning,
    snoozeExpiryWarning,
  } = expiry;
  const teardown = useRoomTeardown({
    wireCodeRef,
    voidPhrase,
    isHost,
    peerIdRef: peerId,
    onLeave,
    media: roomMedia,
    crypto,
    stopShareCleanup,
    setRemoteStreams,
    stopCountdown,
  });
  const {
    burned,
    burnReason,
    burnTokenWarning,
    sessionEnded,
    sessionEndedReason,
    performLocalBurn,
    handleSessionExpired,
    handleBurnSession,
  } = teardown;
  sessionExpiredRef.current = handleSessionExpired;
  // Task #594: when the session ends (BURN or server-side end), force the
  // MasksSheet to flush its rolling audio ring buffer immediately — even
  // if the sheet is still mounted mid-preview.
  useEffect(() => {
    if (burned || sessionEnded) setMasksFlushSignal((n) => n + 1);
  }, [burned, sessionEnded]);
  const extension = useRoomExtension({
    wireCodeRef,
    voidPhrase,
    onExtended: (expiresAt, serverNow, tier) => {
      startCountdown(expiresAt, serverNow);
      if (tier) setRoomTier(tier);
    },
    resetExpiryWarning: expiry.resetForNewWindow,
    // Task #926: a paid extend leaks the host's IP to the payment server
    // from a clearnet wallet exactly like the original paid create does.
    // Re-raise the same one-time, dismissible Lightning IP-linkage reminder
    // when this room is loaded over a .onion origin. Gated on `onionOrigin`
    // so clearnet extends never surface it.
    onPaidExtendSuccess: () => {
      if (onionOrigin) setShowLightningIpNotice(true);
    },
  });
  const {
    extendModalOpen,
    setExtendModalOpen,
    extendInFlight,
    extendNotice,
    flashExtendNotice,
    handleOpenExtend,
    handleExtendPaid,
  } = extension;
  const sessionEndedDialogRef = useDialogFocusTrap<HTMLDivElement>({
    active: sessionEnded,
  });
  function handleConfirmJoin() {
    resumeAudio();
    uiClick();
    setConfirmed(true);
  }
  const { retryMedia } = useRoomConnection({
    confirmed,
    isSnapshot,
    roomCode,
    wireCodeRef,
    voidPhrase,
    // VOID is human-only: every room is a "human" room.
    roomType: "human",
    e2eKey,
    audioDeviceId,
    peerIdRef: peerId,
    peerTagRef: peerTag,
    onionOrigin,
    media: roomMedia,
    crypto,
    signaling,
    stopShareCleanup,
    performLocalBurn,
    handleSessionExpired,
    startCountdown,
    stopCountdown,
    flashExtendNotice,
    resetExpiryWarning: expiry.resetForNewWindow,
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
  });

  function handleToggleScreenShare() {
    uiClick();

    if (isScreenSharing) {
      stopShareCleanup(true, "manual");
      return;
    }

    if (!displayMediaSupported) return;
    if (screenShareRequesting) return;
    if (screenSharePeerId && screenSharePeerId !== peerId.current) {
      showShareNotice("ANOTHER PARTICIPANT IS SHARING");
      return;
    }

    setShowShareWarning(true);
  }

  useEffect(() => {
    const interval = setInterval(() => setBlinkOn((v) => !v), 600);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("in-call", joined);
    return () => {
      document.body.classList.remove("in-call");
    };
  }, [joined]);

  useEffect(() => {
    if (verificationOpenFor === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVerificationOpenFor(null);
        setVerificationAnchor(null);
      }
    };
    const onLayout = () => setLayoutTick((t) => t + 1);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onLayout);
    window.addEventListener("scroll", onLayout, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onLayout);
      window.removeEventListener("scroll", onLayout, true);
    };
  }, [verificationOpenFor]);

  useEffect(() => {
    if (verificationOpenFor === null) return;
    if (!peerSAS[verificationOpenFor] || cryptoMismatch[verificationOpenFor]) {
      setVerificationOpenFor(null);
      setVerificationAnchor(null);
    }
  }, [verificationOpenFor, peerSAS, cryptoMismatch]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 600px)");
    const onChange = (e: MediaQueryListEvent) => setIsNarrowViewport(e.matches);
    setIsNarrowViewport(mq.matches);
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);



  function buildShareUrl() {
    return buildJoinUrl(voidPhrase);
  }

  function handleShowQR() {
    uiClick();
    setShareSheetOpen(true);
  }

  async function handleShareLink() {
    uiClick();
    const url = buildShareUrl();
    const expiryHint = (() => {
      if (expiresAtWallClock === null) return null;
      const d = new Date(expiresAtWallClock);
      const now = new Date();
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const sameDay = d.toDateString() === now.toDateString();
      const when = sameDay ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
      const tier = roomTier === "day" ? "24H" : roomTier === "standard" ? "65M" : null;
      return `Expires ${when}${tier ? ` (${tier} tier)` : ""}`;
    })();
    const clipboardText = expiryHint ? `${url}\n${expiryHint}` : url;
    const shareText = expiryHint ? `Join my Void call · ${expiryHint}` : "Join my Void call";

    async function copyFallback() {
      if (!navigator.clipboard?.writeText) return;
      try {
        await navigator.clipboard.writeText(clipboardText);
        setShareMethod("copied");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {}
    }

    const isMobile = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (isMobile && "share" in navigator) {
      try {
        await navigator.share({ title: "Void", text: shareText, url });
        setShareMethod("sent");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        await copyFallback();
      }
    } else {
      await copyFallback();
    }
  }

  // Task #594: VIDEO/VOICE selection now lives in the MasksSheet, which
  // owns its own labels. VOICE_MODE_LABELS is retained here only for the
  // peer verification label (peer-media-state voiceMode → readable name).
  const VOICE_MODE_LABELS = ["VOICE", "DEEP", "FORMANT", "SCRAMBLE", "COMBINED"];

  // Task #572: first-time-in-call hint. The first time the user lands
  // on NONE via the in-room cycle for a given stream, surface a small
  // dismissable inline note ("UNMASKED — peers see/hear your real
  // …") next to the control bar. The dismiss flag is per-device and
  // per-stream — once cleared, the hint never re-appears even after
  // remount or a new room. Initial state reads localStorage so a
  // prior dismissal is honoured immediately.
  const [showVideoUnmaskedHint, setShowVideoUnmaskedHint] = useState(false);
  const [showVoiceUnmaskedHint, setShowVoiceUnmaskedHint] = useState(false);
  useEffect(() => {
    if (videoStyle === 0 && !getUnmaskedVideoHintDismissed()) {
      setShowVideoUnmaskedHint(true);
    }
  }, [videoStyle]);
  useEffect(() => {
    if (voiceMode === 0 && !getUnmaskedVoiceHintDismissed()) {
      setShowVoiceUnmaskedHint(true);
    }
  }, [voiceMode]);
  function dismissVideoUnmaskedHint() {
    setUnmaskedVideoHintDismissed(true);
    setShowVideoUnmaskedHint(false);
  }
  function dismissVoiceUnmaskedHint() {
    setUnmaskedVoiceHintDismissed(true);
    setShowVoiceUnmaskedHint(false);
  }

  // Task #573: one-tap UNDO from the unmasked hint. Snaps the affected
  // stream back to its default masked mode (ASCII for video, SCRAMBLE
  // for voice) without scrubbing through the cycle. Voice mirrors the
  // existing cycle behaviour and emits peer-media-state so peers see
  // the recovery (the in-room voice cycle is unidirectional, so this
  // is the only fast way back). Video has no peer-media-state coupling
  // for style today, matching the existing cycle handler. Both clear
  // the hint locally — no need to also persist the dismiss flag, the
  // hint will simply not re-show until videoStyle/voiceMode return to
  // 0 again.
  function undoVideoUnmasked() {
    uiSelectClick();
    const next = DEFAULT_VIDEO_STYLE as VideoStyle;
    videoStyleRef.current = next;
    setVideoStyleRef.current?.(next);
    setVideoStyleState(next);
    setShowVideoUnmaskedHint(false);
  }
  function undoVoiceUnmasked() {
    uiSelectClick();
    const next = DEFAULT_VOICE_MODE;
    voiceModeRef.current = next;
    setVoiceModeRef.current?.(next);
    setVoiceMode(next);
    setShowVoiceUnmaskedHint(false);
    if (joined) {
      // Task #868: publish over the encrypted `void.media-state` channel
      // (not the plaintext signaling event) so peers see the voice
      // recovery.
      webrtcRef.current?.setLocalMediaState({
        camOff: camOffRef.current,
        micMuted: micMutedRef.current,
        voiceMode: next,
        viaOnion: onionOrigin,
      });
    }
  }

  // Task #586: ALLOW UNMASKED * toggles no longer live in the bottom
  // control bar. The combined "ALLOW CLEAR A/V" header control
  // (RoomHeaderBar → useCombinedAllowUnmaskedHeaderControl) is the
  // single in-call surface; HamburgerMenu / PreviewGate still use
  // the per-stream hook. RoomPage retains only the subscription
  // below that snaps NONE → default when the pref flips OFF
  // mid-call — the safety-critical part.
  const maskingPrefsMountedRef = useRef(false);

  // Task #572: when the user flips ALLOW UNMASKED * from ON → OFF in
  // the Hamburger menu while currently sitting on NONE for that
  // stream, snap immediately to the default masked mode (ASCII /
  // SCRAMBLE) — no grace period, no confirmation. The subscription
  // also covers cross-tab flips via the native `storage` event.
  useEffect(() => {
    const apply = () => {
      // Task #586: the user-visible "switched back to …" status note
      // now lives in the header (header-allow-clear-snap-note from
      // useCombinedAllowUnmaskedHeaderControl). RoomPage retains only
      // the safety-critical state snap below.
      if (!getAllowUnmaskedVideo() && videoStyleRef.current === 0) {
        const next = DEFAULT_VIDEO_STYLE as VideoStyle;
        videoStyleRef.current = next;
        setVideoStyleRef.current?.(next);
        setVideoStyleState(next);
      }
      if (!getAllowUnmaskedVoice() && voiceModeRef.current === 0) {
        const next = DEFAULT_VOICE_MODE;
        voiceModeRef.current = next;
        setVoiceModeRef.current?.(next);
        setVoiceMode(next);
        if (joined) {
          // Task #868: publish the forced-mask snap over the encrypted
          // `void.media-state` channel.
          webrtcRef.current?.setLocalMediaState({
            camOff: camOffRef.current,
            micMuted: micMutedRef.current,
            voiceMode: next,
            viaOnion: onionOrigin,
          });
        }
      }
    };
    // Mount-time clamp: a device with a pre-existing
    // voidVideoStyle/voidVoiceMode=0 persisted from before the
    // safety toggles existed must NOT start in NONE while the
    // corresponding ALLOW UNMASKED rail is OFF. Apply once
    // immediately, then subscribe for live flips. Note: the mounted
    // flag is set AFTER the first apply so the mount-time clamp
    // doesn't surface a "Switched back to …" note for a state the
    // user did not just create.
    apply();
    maskingPrefsMountedRef.current = true;
    return subscribeMaskingPrefs(apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, roomCode]);

  // Task #594: the MASKS sheet commits both streams at once on APPLY.
  // Peers only see the change here (not while the user previews drafts in
  // the sheet), so re-pointing the sheet's preview never flickers peers
  // through intermediate masks. Mirrors the voice peer-media-state emit
  // from the old cycle handlers so verification labels stay in sync.
  function applyMasks(next: { videoStyle: VideoStyle; voiceMode: number }) {
    videoStyleRef.current = next.videoStyle;
    setVideoStyleRef.current?.(next.videoStyle);
    setVideoStyleState(next.videoStyle);
    voiceModeRef.current = next.voiceMode;
    setVoiceModeRef.current?.(next.voiceMode);
    setVoiceMode(next.voiceMode);
    if (joined) {
      // Task #868: commit both mask changes to peers over the encrypted
      // `void.media-state` channel so verification labels stay in sync.
      webrtcRef.current?.setLocalMediaState({
        camOff: camOffRef.current,
        micMuted: micMutedRef.current,
        voiceMode: next.voiceMode,
        viaOnion: onionOrigin,
      });
    }
  }

  function toggleMic() {
    uiClick();
    setMicMuted((v) => {
      const next = !v;
      // Privacy-critical: actually stop the outgoing audio track so the
      // peer hears nothing. The peer-media-state emit below only drives a
      // cosmetic muted indicator on the receiver; it does NOT stop audio
      // transmission. Disabling the local track is what makes "MIC OFF"
      // truthful.
      localStreamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      // Task #868: cosmetic muted indicator now travels P2P over the
      // encrypted `void.media-state` channel; the track-disable above is
      // what actually silences audio.
      webrtcRef.current?.setLocalMediaState({ camOff, micMuted: next, voiceMode: voiceModeRef.current, viaOnion: onionOrigin });
      return next;
    });
  }

  function toggleCam() {
    if (isScreenSharing) return;
    uiClick();
    setCamOff((v) => {
      const next = !v;
      // Privacy-critical: actually stop the outgoing video track so no
      // frames reach the peer. The peer-media-state emit below only drives a
      // cosmetic hidden tile on the receiver (PeerTileGrid); it does NOT stop
      // video transmission. Disabling the local track is what makes "CAM OFF"
      // truthful even against a hostile peer that ignores peer-media-state.
      localStreamRef.current?.getVideoTracks().forEach((t) => {
        t.enabled = !next;
      });
      // Task #868: cosmetic hidden-tile indicator now travels P2P over
      // the encrypted `void.media-state` channel; the track-disable above
      // is what actually stops video frames.
      webrtcRef.current?.setLocalMediaState({ camOff: next, micMuted, voiceMode: voiceModeRef.current, viaOnion: onionOrigin });
      return next;
    });
  }

  const allParticipants: Array<{ id: string; isMe: boolean }> = [
    { id: peerId.current, isMe: true },
    ...peers.map((id) => ({ id, isMe: false })),
  ];

  const count = allParticipants.length;

  // Task #571: per-device, local-only self-view toggle. The persisted
  // boolean controls whether the local tile is rendered for THIS user;
  // outgoing camera frames are unchanged. `transientPreview` is a
  // one-shot escape hatch from the solo placeholder ("PREVIEW
  // YOURSELF") that auto-clears on ANY peer join — so a user who
  // dropped the toggle off doesn't accidentally start showing their
  // tile the moment a peer arrives. Peer departures do NOT re-arm it.
  const [selfViewVisible, setSelfViewVisibleState] = useState<boolean>(
    () => getSelfViewVisible(),
  );
  const [transientPreview, setTransientPreview] = useState(false);
  const prevPeerCountRef = useRef(peers.length);
  useEffect(() => {
    if (peers.length > prevPeerCountRef.current && transientPreview) {
      setTransientPreview(false);
    }
    prevPeerCountRef.current = peers.length;
  }, [peers.length, transientPreview]);

  function handleToggleSelfView(next: boolean) {
    // Persist FIRST so a reload mid-flip preserves the user's intent.
    setSelfViewVisible(next);
    setSelfViewVisibleState(next);
    // Flipping the persistent toggle (in either direction) supersedes
    // the transient preview: turning ON makes the tile visible the
    // normal way; turning OFF re-hides it and the user can press
    // PREVIEW YOURSELF again if they want a peek.
    setTransientPreview(false);
    uiClick();
  }

  const showLocalTile = selfViewVisible || transientPreview;
  const visibleParticipants = showLocalTile
    ? allParticipants
    : allParticipants.filter((p) => !p.isMe);
  // Preserve the historical solo behavior (data-slots="2" with a
  // NO SIGNAL placeholder in the second slot) only when the local
  // tile is actually being shown. When self is hidden we render the
  // dedicated solo placeholder below instead, so this branch is unused.
  const displayCount = showLocalTile
    ? (visibleParticipants.length === 1 ? 2 : visibleParticipants.length)
    : visibleParticipants.length;

  function goBack() {
    // Task #594: flush the MasksSheet rolling audio ring before leaving.
    setMasksFlushSignal((n) => n + 1);
    onLeave?.();
  }

  const roomPhase = deriveRoomPhase({
    burned,
    sessionEnded,
    confirmed,
    mediaError,
    error,
    knockPending,
    joined,
  });

  if (roomPhase === "burned") {
    return (
      <BurnedOverlay
        tokenWarning={burnTokenWarning}
        onDismiss={() => {
          // After ROOM BURNED we must drop the user back on the home page
          // AND discard the fiber tree / refs / AudioContext. onLeave is the
          // shared leave convergence point: it strips the phrase from the URL
          // (replaceState to BASE_URL) and resets in-app room state. Wrap it
          // so a teardown throw can never strand the user on the burned screen
          // (firedRef makes the overlay single-use, so a throw here was a
          // permanent dead-end).
          try { onLeave?.(); } catch { /* never block the reload below */ }
          try {
            // Defensively strip the phrase from the URL before reloading, so
            // the reloaded app cannot re-derive the room from a leftover hash
            // even if onLeave was a no-op (e.g. RoomPage mounted without a
            // leave handler).
            const url = new URL(window.location.href);
            url.hash = "";
            window.history.replaceState(null, "", url.toString());
            // Hard-reload the *current* document instead of navigating to a
            // constructed BASE_URL. reload() re-requests the exact URL the app
            // is already served from, so it stays on the correct path inside
            // the proxied Replit preview — a location.replace(BASE_URL) there
            // escapes the artifact's path and lands on a blank page with no
            // app chrome. With the phrase stripped above, the reloaded app
            // boots straight to the landing page.
            window.location.reload();
          } catch { /* jsdom / sandboxed iframes may block */ }
        }}
        reason={burnReason}
      />
    );
  }

  if (roomPhase === "sessionEnded") {
    return (
      <div
        ref={sessionEndedDialogRef}
        role="alertdialog"
        aria-live="assertive"
        aria-labelledby="session-ended-dialog-title"
        aria-describedby="session-ended-dialog-desc"
        data-testid="session-ended-overlay"
        className="void-overlay"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: "16px",
          background: "#0A0908",
        }}
      >
        <h2
          id="session-ended-dialog-title"
          style={{
            fontSize: "28px",
            letterSpacing: "8px",
            color: "var(--gold)",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            textTransform: "uppercase",
            animation: "void-pulse 1.4s ease-in-out 1",
            margin: 0,
          }}
        >
          ROOM ENDED
        </h2>
        <div
          id="session-ended-dialog-desc"
          style={{
            fontSize: "12px",
            letterSpacing: "3px",
            color: "var(--fg-dim)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
          }}
        >
          ROOM TIME EXPIRED
        </div>
        {sessionEndedReason ? (
          <div
            data-testid="session-ended-overlay-reason"
            role="status"
            style={{
              maxWidth: "560px",
              padding: "0 24px",
              fontSize: "11px",
              letterSpacing: "2px",
              // Mirror BurnedOverlay's reason line (Task #406): --bg
              // (~9:1 on #0A0908) for the informational copy so users
              // actually read why their media may not have shut down
              // cleanly; the pulsing ROOM ENDED headline is the signal.
              color: "var(--bg)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            {sessionEndedReason}
          </div>
        ) : null}
      </div>
    );
  }

  /* ─── Confirmation overlay (fromUrl) ─── */
  if (roomPhase === "confirm") {
    return (
      <div className="void-overlay">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "12px", letterSpacing: "3px", color: "var(--fg-dim)", marginBottom: "12px", textTransform: "uppercase" }}>
            Incoming Room
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: "16px",
              letterSpacing: "2px",
              textTransform: "lowercase",
              color: "var(--fg)",
              marginBottom: "8px",
              lineHeight: 1.6,
              wordSpacing: "6px",
            }}
          >
            {voidPhrase}
          </div>
          <div style={{ fontSize: "12px", letterSpacing: "2px", color: "var(--fg-dim)" }}>
            JOIN THIS ROOM?
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            className="void-btn void-btn--teal active"
            onClick={handleConfirmJoin}
            style={{ fontSize: "16px", padding: "16px 32px", letterSpacing: "2px", minWidth: "120px" }}
          >
            YES
          </button>
          <button
            className="void-btn void-btn--red active"
            onClick={goBack}
            style={{ fontSize: "16px", padding: "16px 32px", letterSpacing: "2px", minWidth: "120px" }}
          >
            NO
          </button>
        </div>
      </div>
    );
  }

  /* ─── Media permission error ─── */
  async function handleRetryMedia() {
    uiClick();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setRetryFailed(false);
      setMediaError(null);
      // Task #710: recover in place instead of reloading the page.
      // The old `window.location.href = ...` navigation re-mounted
      // App, which re-ran the expensive PBKDF2 room-key derivation and
      // discarded all in-room state (peers, phrase, timers). retryMedia
      // re-runs the connection effect — re-acquiring the camera pipeline
      // and rejoining — without any navigation, so the derived key and
      // room state survive.
      retryMedia();
    } catch {
      setRetryFailed(true);
    }
  }

  function detectBrowser(): "safari" | "chrome" | "firefox" | "other" {
    const ua = navigator.userAgent;
    if (/CriOS/i.test(ua)) return "chrome";
    if (/FxiOS/i.test(ua) || /Firefox/i.test(ua)) return "firefox";
    if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return "safari";
    if (/Chrome/i.test(ua)) return "chrome";
    return "other";
  }

  if (roomPhase === "mediaError" && mediaError) {
    const isNotSupported = mediaError === "NOT SUPPORTED";
    const isPipelineError = mediaError.startsWith("PIPELINE:");
    const browser = detectBrowser();

    return (
      <div className="void-overlay">
        <div
          ref={mediaErrorDialogRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="media-error-dialog-title"
          aria-describedby="media-error-dialog-desc"
          data-testid="media-error-overlay"
          style={{
            textAlign: "center",
            background: "var(--surface)",
            padding: "32px 28px",
            border: "3px solid var(--red)",
            maxWidth: "360px",
            width: "100%",
          }}
        >
          <h2
            id="media-error-dialog-title"
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: "16px",
              color: "var(--red)",
              marginBottom: "16px",
              marginTop: 0,
              letterSpacing: "2px",
              textTransform: "uppercase",
            }}
          >
            {mediaError}
          </h2>

          <div id="media-error-dialog-desc" style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "1px", lineHeight: "2", marginBottom: "20px", textTransform: "uppercase" }}>
            {isPipelineError ? (
              <>VIDEO PROCESSING PIPELINE<br />FAILED TO INITIALIZE.<br />TRY RELOADING OR USE<br />A DIFFERENT BROWSER.</>
            ) : isNotSupported ? (
              <>THIS BROWSER CANNOT ACCESS YOUR CAMERA.<br />TRY SAFARI OR CHROME.</>
            ) : !retryFailed ? (
              <>TAP ALLOW WHEN YOUR<br />BROWSER ASKS FOR<br />CAMERA + MIC ACCESS.<br />IF EMBEDDED, USE “OPEN IN NEW TAB”.</>
            ) : (
              <>
                {browser === "safari" && <>1. TAP aA IN ADDRESS BAR<br />2. WEBSITE SETTINGS<br />3. SET CAMERA → ALLOW<br />4. SET MIC → ALLOW</>}
                {browser === "chrome" && <>1. TAP LOCK ICON<br />2. PERMISSIONS<br />3. SET CAMERA → ALLOW<br />4. SET MIC → ALLOW</>}
                {browser === "firefox" && <>1. TAP LOCK ICON<br />2. CLEAR PERMISSIONS<br />3. TAP ALLOW ON PROMPT</>}
                {browser === "other" && <>1. OPEN BROWSER SETTINGS<br />2. FIND SITE PERMISSIONS<br />3. ALLOW CAMERA + MIC</>}
              </>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <button className="void-btn void-btn--teal active" onClick={handleRetryMedia} style={{ width: "100%", fontSize: "13px", padding: "14px" }}>
              TRY AGAIN
            </button>
            {window.top !== window.self && (
              <button
                className="void-btn void-btn--gold active"
                onClick={() => {
                  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                  window.open(`${window.location.origin}${base}/${phraseToHash(voidPhrase)}`, "_blank");
                }}
                style={{ width: "100%", fontSize: "16px", padding: "14px" }}
              >
                OPEN IN NEW TAB
              </button>
            )}
            <button className="void-btn" onClick={goBack} style={{ width: "100%", fontSize: "16px", padding: "12px", color: "var(--fg-dim)", borderColor: "var(--fg-dim)" }}>
              BACK
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Socket / room error ─── */
  if (roomPhase === "error" && error) {
    if (isDeadRoomError(error)) {
      return <DeadRoomOverlay onBack={goBack} />;
    }
    return (
      <div className="void-overlay">
        <div
          data-testid="room-error-overlay"
          style={{
            textAlign: "center",
            background: "var(--surface)",
            padding: "32px 28px",
            border: "3px solid var(--red)",
            maxWidth: "320px",
            width: "100%",
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--red)", marginBottom: "12px", letterSpacing: "2px" }}>
            {error}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--fg-dim)",
              marginBottom: "24px",
              letterSpacing: "1px",
              lineHeight: 1.6,
              textTransform: "uppercase",
            }}
          >
            {error === "ROOM FULL" ? "THIS ROOM IS FULL (MAX 4)" : "COULD NOT JOIN ROOM"}
          </div>
          <button className="void-btn void-btn--red active" onClick={goBack} style={{ width: "100%", fontSize: "13px", padding: "14px" }}>
            BACK TO MENU
          </button>
        </div>
      </div>
    );
  }

  /* ─── Knock pending ─── */
  if (roomPhase === "knockPending") {
    function handleCancelKnock() {
      uiClick();
      const socket = getSocket();
      socket.emit("cancel-knock", { code: wireCodeRef.current });
      setKnockPending(false);
      goBack();
    }

    return (
      <div className="void-overlay">
        <div
          ref={knockPendingDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="knock-pending-dialog-title"
          aria-describedby="knock-pending-dialog-desc"
          data-testid="knock-pending-overlay"
          style={{
            textAlign: "center",
            background: "var(--surface)",
            padding: "32px 28px",
            border: "3px solid var(--gold)",
            maxWidth: "320px",
            width: "100%",
          }}
        >
          <h2
            id="knock-pending-dialog-title"
            style={{
              display: "inline-block",
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--gold)",
              marginBottom: "16px",
              marginTop: 0,
              letterSpacing: "2px",
              background: "var(--surface-dark)",
              border: "1px solid var(--gold)",
              padding: "8px 14px",
            }}
          >
            KNOCKING...
          </h2>
          <div
            id="knock-pending-dialog-desc"
            className="blink"
            style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "1px", marginBottom: "24px" }}
          >
            WAITING FOR HOST TO LET YOU IN
          </div>
          <button className="void-btn void-btn--red active" onClick={handleCancelKnock} style={{ width: "100%", fontSize: "13px", padding: "14px" }}>
            CANCEL
          </button>
        </div>
      </div>
    );
  }

  /* ─── Connecting / acquiring media ─── */
  if (roomPhase === "connecting") {
    return (
      <div className="void-shell">
        <div className="void-header">
          <div className="void-wordmark">V&nbsp;&nbsp;&nbsp;[]&nbsp;&nbsp;&nbsp;I&nbsp;&nbsp;&nbsp;D</div>
          <div style={{ fontSize: "12px", color: "#A89E90", letterSpacing: "1px", textTransform: "lowercase", wordSpacing: "4px" }}>
            {voidPhrase}
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
          <div style={{ fontSize: "14px", letterSpacing: "3px", color: "var(--fg-dim)", textTransform: "uppercase" }} className="blink">
            {localStream ? "JOINING..." : "INITIALIZING..."}
          </div>
          {!localStream && (
            <div style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "2px" }}>
              ALLOW CAMERA + MIC
            </div>
          )}
        </div>
        <div className="void-control-bar">
          <button
            className={`void-btn${micMuted ? " void-btn--red active" : ""}`}
            onClick={toggleMic}
            style={{ fontSize: "12px" }}
          >
            {micMuted ? "MIC OFF" : "MIC"}
          </button>
          <button
            className={`void-btn${camOff ? " void-btn--red active" : ""}`}
            onClick={toggleCam}
            style={{ fontSize: "12px" }}
          >
            {camOff ? "CAM OFF" : "CAM"}
          </button>
        </div>
      </div>
    );
  }

  /* ─── In-room UI ─── */
  const tierLabel = (() => {
    if (roomTier === "day") return "24H";
    if (roomTier === "standard") return "65M";
    return null;
  })();

  // Tier-scaled thresholds (lib/expiryWarning) so the header switches at
  // the same moment the host wrap-it-up toast fires.
  const warnThresholdMs = getExpiryWarnLeadMs(roomTier) ?? 10 * 60_000;
  const urgentThresholdMs = getExpiryUrgentThresholdMs(roomTier) ?? 60_000;

  const isNearExpiry = remainingMs !== null && remainingMs <= warnThresholdMs;
  const countdownUrgent = remainingMs !== null && remainingMs <= urgentThresholdMs;

  const formatRemaining = (ms: number): string => {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const formatWallClock = (epochMs: number): string => {
    const d = new Date(epochMs);
    const hh = d.getHours().toString().padStart(2, "0");
    const mm = d.getMinutes().toString().padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const expiryDisplay = (() => {
    if (remainingMs === null || expiresAtWallClock === null) return null;
    if (isNearExpiry) {
      return `ENDS IN ${formatRemaining(remainingMs)}`;
    }
    return `ENDS ${formatWallClock(expiresAtWallClock)}`;
  })();

  const countdownColor = (() => {
    if (remainingMs === null) return "#A89E90";
    if (countdownUrgent) return "var(--red)";
    if (isNearExpiry) return "var(--gold)";
    return "#A89E90";
  })();

  const remotePeerIds = allParticipants.filter((p) => !p.isMe).map((p) => p.id);
  const eligibleForVerify = remotePeerIds.filter(
    (pid) => sasFingerprintFor(pid) !== null && !cryptoMismatch[pid],
  );
  const verifiedCount = eligibleForVerify.filter((pid) => verifyStateFor(pid) === "verified").length;
  const aggregateTotal = eligibleForVerify.length;

  const slots = Array.from({ length: Math.max(1, displayCount) }, (_, i) => {
    const participant = visibleParticipants[i] ?? null;
    return { participant, index: i };
  });

  return (
    <div className="void-shell">
      <RoomHeaderBar
        voidPhrase={voidPhrase}
        expiryDisplay={expiryDisplay}
        expiresAtWallClock={expiresAtWallClock}
        tierLabel={tierLabel}
        countdownColor={countdownColor}
        countdownUrgent={countdownUrgent}
        count={count}
        maxUsers={maxUsers}
        isHost={isHost}
        hostPresent={hostPresent}
        hostPeerId={hostPeerId}
        peerTag={peerTag}
        verifiedCount={verifiedCount}
        aggregateTotal={aggregateTotal}
        knockMode={knockMode}
        roomLocked={roomLocked}
        copied={copied}
        shareMethod={shareMethod}
        handleToggleKnock={handleToggleKnock}
        handleToggleLock={handleToggleLock}
        handleShareLink={handleShareLink}
        handleShowQR={handleShowQR}
        selfViewVisible={selfViewVisible}
        onToggleSelfView={handleToggleSelfView}
      />

      <MasksSheet
        open={masksSheetOpen}
        onClose={() => setMasksSheetOpen(false)}
        videoStyle={videoStyle}
        voiceMode={voiceMode}
        onApply={applyMasks}
        allowUnmaskedVideo={getAllowUnmaskedVideo()}
        allowUnmaskedVoice={getAllowUnmaskedVoice()}
        onGrantUnmaskedVideo={() => setAllowUnmaskedVideo(true)}
        onGrantUnmaskedVoice={() => setAllowUnmaskedVoice(true)}
        audioDeviceId={audioDeviceId}
        flushSignal={masksFlushSignal}
      />

      {shareSheetOpen && (
        <RoomShareSheet
          url={buildShareUrl()}
          phrase={voidPhrase}
          tierLabel={tierLabel}
          expiresAtWallClock={expiresAtWallClock}
          onClose={() => setShareSheetOpen(false)}
        />
      )}

      {/* Task #345: one-time Lightning IP-linkage reminder. Shown only after
          a fresh paid create over a .onion origin (see showLightningIpNotice
          above). The host reached VOID over Tor but the Lightning payment
          gathers the wallet's network path independently — paying from a
          clearnet wallet leaves the operator's node holding the host's IP
          against this room. Quiet, dismissible, once per room. */}
      {joined && showLightningIpNotice && (
        <div
          role="note"
          data-testid="lightning-ip-leak-notice"
          style={{
            background: "var(--surface)",
            border: "2px solid var(--gold)",
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "1px",
            lineHeight: 1.6,
            padding: "12px 14px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span style={{ flex: "1 1 220px" }}>
            You reached this room over Tor, but if you paid from a normal
            wallet the payment server now knows the IP address that opened this
            room. Wrap up sooner, and pay from a Tor-routed wallet next time to
            keep it hidden.
          </span>
          <button
            type="button"
            aria-label="dismiss Lightning IP reminder"
            onClick={() => setShowLightningIpNotice(false)}
            style={{
              background: "none",
              color: "var(--fg-dim)",
              border: "2px solid var(--fg-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              letterSpacing: "2px",
              padding: "6px 10px",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Item 5: alone-in-room prompt. Host has joined a fresh room with no
          peers yet — nudge them to share the link instead of waiting in an
          empty room wondering what to do next. Hides on dismiss or once a
          second participant appears. */}
      {joined && isHost && count === 1 && !aloneDismissed && (
        <div
          data-testid="alone-in-room-prompt"
          style={{
            background: "var(--surface)",
            border: "2px solid var(--gold)",
            color: "var(--fg)",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "1px",
            lineHeight: 1.6,
            padding: "12px 14px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
          }}
        >
          <span style={{ flex: "1 1 180px" }}>
            You’re the only one here. Share the link to invite someone.
          </span>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => {
                void handleShareLink();
              }}
              style={{
                background: "var(--gold)",
                color: "var(--surface-dark)",
                border: "2px solid var(--gold)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "2px",
                padding: "6px 12px",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              SHARE LINK
            </button>
            <button
              type="button"
              aria-label="dismiss alone prompt"
              onClick={() => setAloneDismissed(true)}
              style={{
                background: "none",
                color: "var(--fg-dim)",
                border: "2px solid var(--fg-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "2px",
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Recording-honesty reminder. Floating, auto-dismisses after ~5s
          and re-shows on every peer-joined event so the room stays
          visibly aware that any participant could be recording. Task
          #597: the headphones echo hint now rides as a secondary line on
          this same reminder instead of a separate top banner. */}
      <RecordingDisclosureBanner
        triggerKey={peerJoinTrigger}
        headphonesHint={showEchoWarn}
      />

      {/* Task #530: host-only operator banner that surfaces a missing
          TURN configuration so a self-hoster does not have to scrape
          logs to discover the misconfiguration. Gated on `isHost` so
          guests never see operator-config noise; dismissal persists
          per-origin in localStorage. */}
      <NoTurnBanner show={isHost && noTurnConfigured} />

      <HostModerationRow
        isHost={isHost}
        pendingKnocks={pendingKnocks}
        pendingRelayRequests={pendingRelayRequests}
        handleApproveKnock={handleApproveKnock}
        handleDenyKnock={handleDenyKnock}
        handleRespondRelayRequest={handleRespondRelayRequest}
      />

      {/* E2E indicator. */}
      {joined && (
        <div style={{
          background: "var(--teal)",
          color: "#fff",
          fontSize: "12px",
          letterSpacing: "2px",
          textAlign: "center",
          padding: "3px 8px",
          fontFamily: "var(--font-mono)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          flexWrap: "wrap",
        }}>
          <span>E2E ENCRYPTED</span>
          {/* DIRECT P2P / RELAY ONLY are mutually exclusive room-mode badges. */}
          <DirectP2PBadge
            peerConnectionStates={peerConnectionStates}
            relayOnly={relayOnly}
            onOpenWalkthrough={() => setDevToolsP2PModalOpen(true)}
          />
          {onionOrigin && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                data-testid="tor-onion-indicator"
                title="You loaded VOID over a Tor .onion address. Your local connection is forced to relay-only so peers cannot see your clearnet IP."
                style={{ letterSpacing: "2px", color: "var(--teal)" }}
              >
                Connected via Tor onion
              </span>
            </>
          )}
          {/* Task #1022: explicit clearnet-path state. When a .onion mirror is
              published but this session loaded over clearnet, name the path so
              it is a known choice, not an invisible default. Non-alarming
              (--fg-dim, not red); the actionable switch lives in the footer
              .onion affordance and on the home screen. */}
          {!onionOrigin && onionMirrorConfigured && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                data-testid="clearnet-path-indicator"
                title="You reached VOID over the public internet (clearnet), not our .onion address. To put our signaling layer behind a Tor hidden service, open the .onion address in Tor Browser before your next call. It does not hide your IP from the other people on the call."
                style={{ letterSpacing: "2px", color: "var(--fg-dim)" }}
              >
                CLEARNET PATH
              </span>
            </>
          )}
          {/* Task #349: host-via-.onion badge for non-host peers (informational; ICE
              enforcement still local). Suppressed when self is host (covered above). */}
          {hostPeerId !== null
            && hostPeerId !== peerId.current
            && peerMediaState[hostPeerId]?.viaOnion === true && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                data-testid="host-via-onion-indicator"
                title="The host loaded VOID over a Tor .onion address. Informational — does not change connection enforcement."
                style={{ letterSpacing: "2px", color: "var(--teal)" }}
              >
                HOST VIA .ONION
              </span>
            </>
          )}
          {relayOnly && (
            <>
              <span style={{ opacity: 0.5 }}>·</span>
              <span
                title="Relay-only mode is on. All peer media routes through the TURN relay; peers cannot see each other’s IP addresses."
                style={{ letterSpacing: "2px" }}
              >
                RELAY ONLY
                {relayRequestedBy && (
                  <span
                    data-testid="relay-requested-by"
                    style={{ opacity: 0.7, marginLeft: "6px", letterSpacing: "1px" }}
                  >
                    · REQUESTED BY {relayRequestedBy.toUpperCase()}
                  </span>
                )}
              </span>
            </>
          )}
          {/* Task #106: cooperative relay-only request, non-host peers only. */}
          {!relayOnly && !isHost && (
            <button
              type="button"
              onClick={handleRequestRelayOnly}
              disabled={relayRequestSent}
              data-testid="request-relay-only"
              title="Ask the host to switch this room to relay-only so peers can’t see each other’s IPs."
              style={{
                background: relayRequestSent ? "transparent" : "rgba(255,255,255,0.15)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.6)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "2px",
                padding: "2px 8px",
                cursor: relayRequestSent ? "default" : "pointer",
                opacity: relayRequestSent ? 0.7 : 1,
              }}
            >
              {relayRequestSent ? "ASKED HOST…" : "REQUEST RELAY ONLY"}
            </button>
          )}
        </div>
      )}

      {/* Requester-side toast — accept/decline acknowledgment, rate-limit
          warning, etc. Auto-clears after a few seconds. */}
      {relayResponseNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="relay-response-notice"
          style={{
            background: "var(--surface)",
            borderBottom: "2px solid var(--teal)",
            color: "var(--teal)",
            fontSize: "12px",
            letterSpacing: "2px",
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          {relayResponseNotice}
        </div>
      )}

      <HostModerationRow
        isHost={isHost}
        pendingKnocks={pendingKnocks}
        pendingRelayRequests={pendingRelayRequests}
        handleApproveKnock={handleApproveKnock}
        handleDenyKnock={handleDenyKnock}
        handleRespondRelayRequest={handleRespondRelayRequest}
      />

      <DevToolsP2PModal
        open={devToolsP2PModalOpen}
        onClose={() => setDevToolsP2PModalOpen(false)}
      />


      {/* Active sharing banner */}
      {isScreenSharing && (
        <div style={{
          background: "var(--gold)", color: "var(--bg)", fontSize: "12px",
          letterSpacing: "2px", textAlign: "center", padding: "6px 12px",
          fontFamily: "var(--font-mono)", fontWeight: 700, display: "flex",
          alignItems: "center", justifyContent: "center", gap: "12px",
        }}>
          <span style={{ animation: "blink 1s step-end infinite" }}>&#9679;</span>
          YOU ARE SHARING YOUR SCREEN
          <button
            onClick={() => { uiClick(); stopShareCleanup(true, "manual"); }}
            style={{
              background: "var(--surface-dark)", color: "var(--gold)",
              border: "2px solid var(--surface-dark)", padding: "2px 10px", fontSize: "12px",
              letterSpacing: "2px", fontFamily: "var(--font-mono)",
              fontWeight: 700, cursor: "pointer",
            }}
          >STOP</button>
        </div>
      )}

      <ExpiryWarningToast
        isHost={isHost}
        expiryWarningPhase={expiryWarningPhase}
        expiresAtWallClock={expiresAtWallClock}
        remainingMs={remainingMs}
        roomTier={roomTier}
        extendInFlight={extendInFlight}
        expiryWarningSnoozeUsed={expiryWarningSnoozeUsed}
        formatWallClock={formatWallClock}
        formatRemaining={formatRemaining}
        handleOpenExtend={handleOpenExtend}
        snoozeExpiryWarning={snoozeExpiryWarning}
        dismissExpiryWarning={dismissExpiryWarning}
      />

      {/* Share notice (denial / ended) */}
      {shareNotice && (
        <div style={{
          background: "var(--surface-dark)",
          borderBottom: "2px solid var(--gold)",
          color: "var(--gold)",
          fontSize: "12px",
          letterSpacing: "2px",
          textAlign: "center",
          padding: "6px 12px",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
        }}>
          {shareNotice}
        </div>
      )}

      {/* Extension result notice (success or server-side failure) */}
      {extendNotice && (
        <div
          role="status"
          aria-live="polite"
          data-testid="extend-notice"
          style={{
            background: "var(--surface-dark)",
            borderBottom: "2px solid var(--gold)",
            color: "var(--gold)",
            fontSize: "12px",
            letterSpacing: "2px",
            textAlign: "center",
            padding: "6px 12px",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
          }}
        >
          {extendNotice}
        </div>
      )}

      <ScreenShareModals
        showShareWarning={showShareWarning}
        shareWarningDialogRef={shareWarningDialogRef}
        setShowShareWarning={setShowShareWarning}
        confirmAndStartShare={confirmAndStartShare}
        screenShareRequesting={screenShareRequesting}
        pendingShare={pendingShare}
        pendingShareDialogRef={pendingShareDialogRef}
        cancelPendingShare={cancelPendingShare}
        pickAnotherShareSource={pickAnotherShareSource}
        confirmPendingShare={confirmPendingShare}
      />

      {visibleParticipants.length === 0 ? (
        // Task #571: solo + self-view OFF. Render the placeholder
        // instead of an empty grid so the screen tells the user where
        // their tile went, and gives them a one-shot peek button.
        // Camera is still on for any peer who joins — copy says so.
        // `aria-live="polite"` lets a screen reader hear the swap
        // when SELF goes OFF (and when a peer joins and we flip back
        // into the grid).
        <div
          className="void-video-grid"
          data-testid="self-view-solo-placeholder"
          role="status"
          aria-live="polite"
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-dark)",
            backgroundImage:
              "linear-gradient(rgba(20,17,13,0.85), rgba(20,17,13,0.85)), url('/concrete.jpeg')",
            backgroundSize: "auto, 400px auto",
            backgroundRepeat: "repeat",
            padding: "32px",
            gap: "16px",
            textAlign: "center",
          }}
        >
          <div
            data-testid="self-view-waiting-headline"
            style={{
              fontSize: "28px",
              letterSpacing: "6px",
              color: "var(--gold)",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            [ WAITING FOR PEER ]
          </div>
          <div
            style={{
              fontSize: "12px",
              letterSpacing: "2px",
              color: "#A89E90",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              maxWidth: "320px",
              lineHeight: 1.6,
              textTransform: "uppercase",
            }}
          >
            SELF VIEW OFF.
            <br />
            YOUR CAMERA IS STILL ON FOR PEERS.
          </div>
          <button
            type="button"
            data-testid="self-view-preview-yourself"
            onClick={() => {
              uiClick();
              setTransientPreview(true);
            }}
            className="void-btn"
            style={{
              fontSize: "12px",
              letterSpacing: "1.5px",
              padding: "8px 14px",
              color: "var(--bg)",
            }}
          >
            PREVIEW YOURSELF
          </button>
        </div>
      ) : (
      <PeerTileGrid
        slots={slots}
        displayCount={displayCount}
        hostPresent={hostPresent}
        hostPeerId={hostPeerId}
        isScreenSharing={isScreenSharing}
        localPreviewStream={localPreviewStream}
        localStream={localStream}
        remoteStreams={remoteStreams}
        peerTag={peerTag}
        screenSharePeerId={screenSharePeerId}
        relayOnly={relayOnly}
        peerRelayPinned={peerRelayPinned}
        peerMediaState={peerMediaState}
        secureChannelFailures={secureChannelFailures}
        cryptoMismatch={cryptoMismatch}
        phraseChangedNotice={phraseChangedNotice}
        silentRekeyNotice={silentRekeyNotice}
        peerSAS={peerSAS}
        camOff={camOff}
        micMuted={micMuted}
        localAnalyser={localAnalyser}
        webrtcRef={webrtcRef}
        verificationOpenFor={verificationOpenFor}
        setVerificationOpenFor={setVerificationOpenFor}
        setVerificationAnchor={setVerificationAnchor}
        verifyStateFor={verifyStateFor}
        setVerifyStatus={setVerifyStatus}
        uiClick={uiClick}
      />
      )}

      {/* Task #443: shared DROP slot. Placed under the video grid so
          incoming overwrites are announced in the natural reading
          order beneath the call surface. The input is gated off
          while THIS user is the active screen presenter — see
          DropSlot for the [DISABLED DURING SCREEN SHARE] placeholder
          and the rationale in ThreatModelPage "THE SHARED DROP
          SLOT". */}
      {/* Task #518 follow-up: cap the DROP slot's width to roughly the
          combined width of the MIC + CAM buttons in the control bar
          (the control bar has ~6 stretched flex:1 buttons, so 2/6 ≈
          33%). On narrow viewports we let it grow up to the full row
          minus the side padding so it stays readable. */}
      <div
        style={{
          padding: "0 4px",
          width: "100%",
          maxWidth: isNarrowViewport ? "100%" : "33%",
          position: "relative",
        }}
      >
        <DropSlot
          value={dropText}
          screenShareActive={isScreenSharing}
          onSubmit={(text) => {
            // Local-echo (already sanitized in DropSlot).
            setDropText(text);
            webrtcRef.current?.sendDrop(text);
          }}
        />
      </div>

      {/* Task #572: first-time-in-call hint surfaced when the user
          lands on NONE via the in-room cycle. Polite live region so
          screen readers announce on appearance; dismiss persists per
          device per stream in localStorage so the hint stays gone
          after dismissal. The two streams' hints are independent. */}
      {(showVideoUnmaskedHint || showVoiceUnmaskedHint) && (
        <div
          role="status"
          aria-live="polite"
          data-testid="unmasked-hint-region"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            padding: "4px 8px",
          }}
        >
          {showVideoUnmaskedHint && (
            <div
              data-testid="unmasked-video-hint"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                padding: "4px 10px",
                background: "rgba(20,17,13,0.92)",
                border: "1px solid var(--red)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "1.2px",
                color: "var(--red)",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              <span>UNMASKED — peers see your real face.</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "0 0 auto" }}>
                <button
                  type="button"
                  onClick={undoVideoUnmasked}
                  aria-label="Undo: re-mask video to ASCII"
                  data-testid="unmasked-video-hint-undo"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--red)",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    padding: "2px 6px",
                    lineHeight: 1,
                  }}
                >
                  UNDO
                </button>
                <button
                  type="button"
                  onClick={dismissVideoUnmaskedHint}
                  aria-label="Dismiss unmasked video hint"
                  data-testid="unmasked-video-hint-dismiss"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "0 4px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )}
          {showVoiceUnmaskedHint && (
            <div
              data-testid="unmasked-voice-hint"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
                padding: "4px 10px",
                background: "rgba(20,17,13,0.92)",
                border: "1px solid var(--red)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "1.2px",
                color: "var(--red)",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              <span>UNMASKED — peers hear your real voice.</span>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: "0 0 auto" }}>
                <button
                  type="button"
                  onClick={undoVoiceUnmasked}
                  aria-label="Undo: re-mask voice to SCRAMBLE"
                  data-testid="unmasked-voice-hint-undo"
                  style={{
                    background: "transparent",
                    border: "1px solid var(--red)",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    cursor: "pointer",
                    padding: "2px 6px",
                    lineHeight: 1,
                  }}
                >
                  UNDO
                </button>
                <button
                  type="button"
                  onClick={dismissVoiceUnmaskedHint}
                  aria-label="Dismiss unmasked voice hint"
                  data-testid="unmasked-voice-hint-dismiss"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "0 4px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Control bar — Task #594: exactly 5 buttons in this fixed
          order: MIC, CAM, SHARE SCREEN, MASKS, BURN. The two footer
          cyclers (VIDEO: / VOICE:) are replaced by a single MASKS button
          that opens the MasksSheet. ALLOW UNMASKED toggles live in the
          header.
          Task #585: `data-testid="room-control-bar"` is the anchor for
          the narrow-viewport layout gate (jsdom,
          `RoomPage.layout.test.tsx`).
          Task #587: the same testid is the entry point for the
          Playwright real-viewport layout gate
          (`tests/playwright/control-bar-layout.spec.ts`). */}
      <div className="void-control-bar" data-testid="room-control-bar">
        <button
          className={`void-btn${micMuted ? " void-btn--red active" : ""}`}
          onClick={toggleMic}
        >
          {micMuted ? "MIC OFF" : "MIC"}
        </button>
        <button
          className={`void-btn${camOff ? " void-btn--red active" : ""}${isScreenSharing ? " void-btn--disabled" : ""}`}
          onClick={toggleCam}
          disabled={isScreenSharing}
        >
          {camOff ? "CAM OFF" : "CAM"}
        </button>
        {displayMediaSupported && (
          <button
            className={`void-btn${isScreenSharing ? " void-btn--teal active" : ""}${screenShareRequesting ? " void-btn--gold active" : ""}${(screenSharePeerId && screenSharePeerId !== peerId.current) ? " void-btn--disabled" : ""}`}
            onClick={handleToggleScreenShare}
            disabled={screenShareRequesting || (!!screenSharePeerId && screenSharePeerId !== peerId.current)}
            title={screenSharePeerId && screenSharePeerId !== peerId.current ? "Another participant is sharing" : undefined}
          >
            {isScreenSharing ? "STOP SHARE" : screenShareRequesting ? "..." : (screenSharePeerId && screenSharePeerId !== peerId.current) ? "IN USE" : "SHARE SCREEN"}
          </button>
        )}
        <button
          className="void-btn void-btn--gold active"
          onClick={() => {
            uiClick();
            setMasksSheetOpen(true);
          }}
          disabled={isScreenSharing}
          data-testid="incall-masks-button"
          title="Open masks — choose video and voice disguises"
        >
          MASKS
        </button>
        {/* Task #436: BURN button with hover/focus tooltip (aria-describedby). */}
        <span
          style={{ position: "relative", display: "inline-block" }}
          className="void-burn-tooltip-host"
        >
          <button
            className="void-btn void-btn--red active"
            onClick={handleBurnSession}
            style={{ letterSpacing: "2px" }}
            aria-describedby="burn-button-tooltip"
          >
            BURN
          </button>
          <span
            id="burn-button-tooltip"
            role="tooltip"
            data-testid="burn-button-tooltip"
            className="void-burn-tooltip"
            style={{
              position: "absolute",
              bottom: "calc(100% + 8px)",
              right: 0,
              minWidth: "240px",
              maxWidth: "300px",
              padding: "10px 12px",
              background: "var(--surface-dark)",
              color: "var(--fg)",
              border: "2px solid var(--gold)",
              fontSize: "11px",
              lineHeight: 1.5,
              letterSpacing: "0.5px",
              textTransform: "none",
              textAlign: "left",
              zIndex: 50,
              pointerEvents: "none",
            }}
          >
            BURN ends the call for everyone and rotates the credential,
            so the room ID is gone. It does not undo what anyone already
            saw or heard.
          </span>
        </span>
      </div>
      {(() => {
        if (!verificationOpenFor) return null;
        const pid = verificationOpenFor;
        const sas = peerSAS[pid];
        if (!sas || cryptoMismatch[pid]) return null;
        const vState = verifyStateFor(pid);
        const peerVoiceMode = peerMediaState[pid]?.voiceMode;
        const peerVoiceModeLabel =
          typeof peerVoiceMode === "number" && peerVoiceMode > 0
            ? VOICE_MODE_LABELS[peerVoiceMode] ?? "MASK"
            : null;
        const closePanel = () => {
          setVerificationOpenFor(null);
          setVerificationAnchor(null);
        };
        // Mirror PeerTileGrid's per-slot label (`P${index + 1}`) so the
        // dialog's accessible name names the same peer the user clicked.
        const peerSlotIndex = visibleParticipants.findIndex(
          (p) => p.id === pid,
        );
        const peerLabel = `P${(peerSlotIndex >= 0 ? peerSlotIndex : 0) + 1}`;
        return (
          <SasVerificationDialog
            key={pid}
            sas={sas}
            vState={vState}
            peerLabel={peerLabel}
            peerVoiceModeLabel={peerVoiceModeLabel}
            isNarrowViewport={isNarrowViewport}
            anchor={verificationAnchor}
            onClose={closePanel}
            onVerified={() => setVerifyStatus(pid, "verified")}
            onMismatch={() => setVerifyStatus(pid, "mismatch")}
            layoutTick={layoutTick}
          />
        );
      })()}

      {/* Top-up paywall modal — opened from host expiry-warning toast. */}
      {extendModalOpen && (
        <PaywallModal
          headerLabel="⚡ EXTEND THIS ROOM"
          successLabel="EXTEND ROOM"
          onClose={() => setExtendModalOpen(false)}
          onSuccess={handleExtendPaid}
          extendPreview={
            expiresAtWallClock !== null
              ? { currentExpiresAtMs: expiresAtWallClock, ceilingMs: 24 * 60 * 60 * 1000 }
              : undefined
          }
        />
      )}
    </div>
  );
}
