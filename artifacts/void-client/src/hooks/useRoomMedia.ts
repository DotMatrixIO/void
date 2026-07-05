// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useRef, useState } from "react";
import type {
  VideoStyle,
  WatermarkInfo,
  WatermarkedScreenShare,
} from "@/lib/mediaPipeline";
import type { WebRTCManager } from "@/lib/webrtc";
import { getAllowUnmaskedVideo } from "@/lib/maskingPrefs";

// Task #490: extracted from RoomPage. Owns the local-media state
// cohort — input toggles (mic/cam), the cycle modes (video style /
// voice mode), local-stream + pipeline refs, the screen-share state
// machine surface (pending preview, in-flight request, active share),
// and the watermark compositor handles.
//
// What is NOT here (intentionally):
//   - The actual `setup()` getUserMedia + pipeline construction, the
//     screen-share lifecycle methods (`confirmAndStartShare`,
//     `stopShareCleanup`, etc.), and the BURN teardown. Those reach
//     across socket emits, WebRTCManager.replaceVideoTrack, and the
//     pipelineStopRef they own here — splitting them out would force
//     a 20-argument hook signature and would not improve testability.
//     The hook owns the *state*; RoomPage still owns the wiring.
//   - The `useRoomCrypto` surface (peerSAS, secureChannelFailures,
//     handleRekey, etc.), which already has its own hook (Task #467).
export interface PendingShare {
  stream: MediaStream;
  track: MediaStreamTrack;
  surface: string;
}

export interface UseRoomMediaOptions {
  initialVideoStyle?: VideoStyle;
  initialVoiceMode?: number;
  initialLocalStream?: MediaStream | null;
}

export interface UseRoomMediaApi {
  // Input-toggle state.
  micMuted: boolean;
  setMicMuted: React.Dispatch<React.SetStateAction<boolean>>;
  micMutedRef: React.MutableRefObject<boolean>;
  camOff: boolean;
  setCamOff: React.Dispatch<React.SetStateAction<boolean>>;
  camOffRef: React.MutableRefObject<boolean>;

  // Cycle state — wired to the pipeline through the *Ref setters
  // below, which the camera pipeline mutates as the user cycles.
  videoStyle: VideoStyle;
  setVideoStyleState: React.Dispatch<React.SetStateAction<VideoStyle>>;
  videoStyleRef: React.MutableRefObject<VideoStyle>;
  setVideoStyleRef: React.MutableRefObject<((mode: VideoStyle) => void) | null>;
  voiceMode: number;
  setVoiceMode: React.Dispatch<React.SetStateAction<number>>;
  voiceModeRef: React.MutableRefObject<number>;
  setVoiceModeRef: React.MutableRefObject<((mode: number) => void) | null>;

  // Task #526: in-memory mirror of the pipeline's disabled-style set.
  // The pipeline coerces `setVideoStyle(disabled)` to passthrough as
  // a defensive backstop; this flag exists so the cycle handler in
  // RoomPage can skip the disabled mode entirely instead of landing
  // on a label whose mode the pipeline silently rewrites. In-memory
  // only — not persisted across calls, reloads, or rooms (per the
  // task's out-of-scope list).
  disabledVideoStyles: Set<VideoStyle>;
  markVideoStyleDisabled: (mode: VideoStyle) => void;
  // Task #526: cycle to the next enabled video style, skipping any
  // style currently in `disabledVideoStyles`. Also forwards the new
  // mode to the pipeline via `setVideoStyleRef` so the GL canvas
  // follows the UI. Lives on the hook (not on RoomPage) so the
  // skip-disabled-mode contract is unit-testable without mounting
  // the full page.
  cycleVideoStyle: () => void;

  // Local stream + analyser + pipeline teardown.
  localStream: MediaStream | null;
  setLocalStream: React.Dispatch<React.SetStateAction<MediaStream | null>>;
  localStreamRef: React.MutableRefObject<MediaStream | null>;
  localAnalyser: AnalyserNode | null;
  setLocalAnalyser: React.Dispatch<React.SetStateAction<AnalyserNode | null>>;
  pipelineStopRef: React.MutableRefObject<(() => void) | null>;

  // Screen-share state machine.
  isScreenSharing: boolean;
  setIsScreenSharing: React.Dispatch<React.SetStateAction<boolean>>;
  screenSharePeerId: string | null;
  setScreenSharePeerId: React.Dispatch<React.SetStateAction<string | null>>;
  screenShareRequesting: boolean;
  setScreenShareRequesting: React.Dispatch<React.SetStateAction<boolean>>;
  localPreviewStream: MediaStream | null;
  setLocalPreviewStream: React.Dispatch<React.SetStateAction<MediaStream | null>>;
  showShareWarning: boolean;
  setShowShareWarning: React.Dispatch<React.SetStateAction<boolean>>;
  pendingShare: PendingShare | null;
  setPendingShare: React.Dispatch<React.SetStateAction<PendingShare | null>>;
  pendingShareRef: React.MutableRefObject<PendingShare | null>;
  shareNotice: string | null;
  setShareNotice: React.Dispatch<React.SetStateAction<string | null>>;
  shareNoticeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  displayTrackRef: React.MutableRefObject<MediaStreamTrack | null>;
  preShareCamOffRef: React.MutableRefObject<boolean>;
  screenShareWatermarkRef: React.MutableRefObject<WatermarkedScreenShare | null>;
  // Per-grant idempotency nonce of the most recently-acted screen-share
  // grant (Task #303): the server returns a fresh `nonce` on every
  // successful `request-screen-share` ack; if a duplicated ack carrying
  // the same nonce arrives, the grant handler ignores it.
  lastSeenGrantNonceRef: React.MutableRefObject<string | null>;

  // Watermark handles for the camera pipeline + screen-share wrapper.
  watermarkRef: React.MutableRefObject<WatermarkInfo | null>;
  setWatermarkRef: React.MutableRefObject<
    ((info: WatermarkInfo | null) => void) | null
  >;

  // Shared WebRTCManager handle — held here so the screen-share
  // lifecycle methods owned by RoomPage can replace the outgoing video
  // track without threading it through every helper.
  webrtcRef: React.MutableRefObject<WebRTCManager | null>;

  // Helpers.
  showShareNotice: (text: string) => void;
  resetScreenShareState: () => void;
}

export function useRoomMedia({
  initialVideoStyle = 0,
  initialVoiceMode = 0,
  initialLocalStream = null,
}: UseRoomMediaOptions = {}): UseRoomMediaApi {
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const micMutedRef = useRef(false);
  micMutedRef.current = micMuted;
  const camOffRef = useRef(false);
  camOffRef.current = camOff;

  const [videoStyle, setVideoStyleState] = useState<VideoStyle>(initialVideoStyle);
  const [voiceMode, setVoiceMode] = useState(initialVoiceMode);
  const videoStyleRef = useRef<VideoStyle>(initialVideoStyle);
  const voiceModeRef = useRef<number>(initialVoiceMode);
  const setVideoStyleRef = useRef<((mode: VideoStyle) => void) | null>(null);
  const setVoiceModeRef = useRef<((mode: number) => void) | null>(null);

  // Task #526: mirror of the pipeline's runtime-disabled video styles.
  // Today only GOLD (mode 1) ever gets added, when the in-pipeline
  // blank-frame sanity check trips. The state is a Set so future
  // disable causes don't require reshaping the API.
  const [disabledVideoStyles, setDisabledVideoStyles] = useState<Set<VideoStyle>>(
    () => new Set<VideoStyle>(),
  );
  const markVideoStyleDisabled = useCallback((mode: VideoStyle) => {
    setDisabledVideoStyles((prev) => {
      if (prev.has(mode)) return prev;
      const next = new Set(prev);
      next.add(mode);
      return next;
    });
  }, []);

  const disabledVideoStylesRef = useRef<Set<VideoStyle>>(disabledVideoStyles);
  disabledVideoStylesRef.current = disabledVideoStyles;

  const cycleVideoStyle = useCallback(() => {
    setVideoStyleState((prev) => {
      // Walk forward from prev+1, skipping disabled modes. The loop
      // is bounded by the total number of styles (6) so even an
      // all-disabled pathological state lands deterministically on
      // the first slot it tried and exits — no spin.
      //
      // Task #572: when ALLOW UNMASKED VIDEO is OFF (default), index
      // 0 (NONE / CLEAR) is treated as disabled for the purposes of
      // cycling so the user can never accidentally land on their
      // real face. The pref is read at click time (not subscribed)
      // because flipping the pref ON should immediately make NONE
      // reachable on the next tap without re-mounting the hook.
      const TOTAL = 6;
      const disabled = disabledVideoStylesRef.current;
      const allowUnmasked = getAllowUnmaskedVideo();
      const skipNone = !allowUnmasked;
      let next = ((prev + 1) % TOTAL) as VideoStyle;
      for (
        let hops = 0;
        hops < TOTAL && (disabled.has(next) || (skipNone && next === 0));
        hops++
      ) {
        next = ((next + 1) % TOTAL) as VideoStyle;
      }
      videoStyleRef.current = next;
      setVideoStyleRef.current?.(next);
      return next;
    });
  }, []);

  const [localStream, setLocalStream] = useState<MediaStream | null>(
    initialLocalStream,
  );
  const localStreamRef = useRef<MediaStream | null>(initialLocalStream);
  const [localAnalyser, setLocalAnalyser] = useState<AnalyserNode | null>(null);
  const pipelineStopRef = useRef<(() => void) | null>(null);

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenSharePeerId, setScreenSharePeerId] = useState<string | null>(null);
  const [screenShareRequesting, setScreenShareRequesting] = useState(false);
  const [localPreviewStream, setLocalPreviewStream] = useState<MediaStream | null>(
    null,
  );
  const [showShareWarning, setShowShareWarning] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const pendingShareRef = useRef<PendingShare | null>(null);
  pendingShareRef.current = pendingShare;
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const shareNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const displayTrackRef = useRef<MediaStreamTrack | null>(null);
  const preShareCamOffRef = useRef(false);
  const screenShareWatermarkRef = useRef<WatermarkedScreenShare | null>(null);
  const lastSeenGrantNonceRef = useRef<string | null>(null);

  const watermarkRef = useRef<WatermarkInfo | null>(null);
  const setWatermarkRef = useRef<((info: WatermarkInfo | null) => void) | null>(
    null,
  );

  const webrtcRef = useRef<WebRTCManager | null>(null);

  const showShareNotice = useCallback((text: string) => {
    if (shareNoticeTimerRef.current) {
      clearTimeout(shareNoticeTimerRef.current);
      shareNoticeTimerRef.current = null;
    }
    setShareNotice(text);
    shareNoticeTimerRef.current = setTimeout(() => {
      setShareNotice(null);
      shareNoticeTimerRef.current = null;
    }, 4000);
  }, []);

  const resetScreenShareState = useCallback(() => {
    setIsScreenSharing(false);
    setScreenSharePeerId(null);
    setScreenShareRequesting(false);
    setLocalPreviewStream(null);
    setPendingShare(null);
    pendingShareRef.current = null;
    displayTrackRef.current = null;
    if (screenShareWatermarkRef.current) {
      try {
        screenShareWatermarkRef.current.stop();
      } catch {}
      screenShareWatermarkRef.current = null;
    }
  }, []);

  return {
    micMuted,
    setMicMuted,
    micMutedRef,
    camOff,
    setCamOff,
    camOffRef,
    videoStyle,
    setVideoStyleState,
    videoStyleRef,
    setVideoStyleRef,
    voiceMode,
    setVoiceMode,
    voiceModeRef,
    setVoiceModeRef,
    disabledVideoStyles,
    markVideoStyleDisabled,
    cycleVideoStyle,
    localStream,
    setLocalStream,
    localStreamRef,
    localAnalyser,
    setLocalAnalyser,
    pipelineStopRef,
    isScreenSharing,
    setIsScreenSharing,
    screenSharePeerId,
    setScreenSharePeerId,
    screenShareRequesting,
    setScreenShareRequesting,
    localPreviewStream,
    setLocalPreviewStream,
    showShareWarning,
    setShowShareWarning,
    pendingShare,
    setPendingShare,
    pendingShareRef,
    shareNotice,
    setShareNotice,
    shareNoticeTimerRef,
    displayTrackRef,
    preShareCamOffRef,
    screenShareWatermarkRef,
    lastSeenGrantNonceRef,
    watermarkRef,
    setWatermarkRef,
    webrtcRef,
    showShareNotice,
    resetScreenShareState,
  };
}
