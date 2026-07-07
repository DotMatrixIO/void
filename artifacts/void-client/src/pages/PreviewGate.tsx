// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback, useMemo, useId } from "react";
import { buildMediaPipeline, type VideoStyle, type MediaPipeline } from "@/lib/mediaPipeline";
import { getAudioContext, closeAudioContext, resumeAudio } from "@/lib/sounds";
import { uiBleep, uiClick, uiSelectClick } from "@/lib/uiSounds";
import {
  DEFAULT_VIDEO_STYLE as MASK_DEFAULT_VIDEO_STYLE,
  DEFAULT_VOICE_MODE as MASK_DEFAULT_VOICE_MODE,
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
  setAllowUnmaskedVideo,
  setAllowUnmaskedVoice,
  subscribeMaskingPrefs,
} from "@/lib/maskingPrefs";
import MasksSheet from "@/components/MasksSheet";
import PhraseShareModal from "@/components/PhraseShareModal";
import { buildJoinUrl } from "@/lib/buildJoinUrl";
import { rendezvousJoinCandidates } from "@/lib/rendezvous";
import BrowserBlockedScreen from "@/components/BrowserBlockedScreen";
import { isOnionOrigin } from "@/lib/origin";
import { describeUserAgent, isBraveBrowser } from "@/lib/userAgent";
import {
  probeWebRtcCapability,
  type WebRtcCapabilityStatus,
} from "@/lib/browserCapability";

// Visually-hidden helper: keep content in the DOM + accessibility tree
// (so screen readers and aria-describedby still reach it) while removing
// it from the visual layout. Used for the semantic screen heading and
// for the relay-only explanation that lives behind the ⓘ affordance.
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

const VIDEO_STYLE_COUNT = 6;
const VOICE_MODE_COUNT = 5;

// First-mount defaults when no stored preference exists.
const DEFAULT_VIDEO_STYLE: VideoStyle = 5; // ASCII
const DEFAULT_VOICE_MODE = 3; // SCRAMBLE
const STORAGE_KEY_VIDEO = "voidVideoStyle";
const STORAGE_KEY_VOICE = "voidVoiceMode";

function readStoredVideoStyle(): VideoStyle | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_VIDEO);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 0 && n < VIDEO_STYLE_COUNT) {
      return n as VideoStyle;
    }
    return null;
  } catch {
    return null;
  }
}

function readStoredVoiceMode(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_VOICE);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 0 && n < VOICE_MODE_COUNT) {
      return n;
    }
    return null;
  } catch {
    return null;
  }
}

export interface PreviewGateOpts {
  audioDeviceId?: string;
  videoStyle: VideoStyle;
  voiceMode: number;
  relayOnly: boolean;
}

interface Props {
  voidPhrase: string;
  showRelayToggle?: boolean;
  /**
   * Room code for the in-progress join. Used to query
   * `/api/room-state/:code` so a joiner reaching the gate from a `.onion`
   * origin can see, before they enter, whether the room they're about to
   * join was created with relay-only off (which would otherwise expose
   * their clearnet IP to peers via WebRTC). Optional — when omitted, the
   * pre-join warning simply isn't fetched.
   */
  roomId?: string;
  onEnter: (opts: PreviewGateOpts) => void;
  onCancel: () => void;
}

export default function PreviewGate({ voidPhrase, showRelayToggle = false, roomId, onEnter, onCancel }: Props) {
  // Tor `.onion` access: pre-default host relay-only on, fetch room
  // state for joiner pre-entry warning. Local ICE enforcement lives in
  // RoomPage. See audit §2.3.
  const onion = useMemo(() => isOnionOrigin(), []);

  // WebRTC capability pre-flight (task #368). Browsers that ship with
  // WebRTC disabled or restricted (Vanadium, Tor Browser, Mullvad,
  // LibreWolf, Brave on Strict, managed Chrome/Edge with
  // `WebRtcLocalIpsAllowedUrls`) silently fail with a generic ICE
  // timeout 30+s into the call. The probe stands up a throwaway
  // RTCPeerConnection and reports whether any usable candidate
  // arrives. If not, we swap PreviewGate's UI for a dedicated fix-it
  // screen instead of letting media start. The probe runs in parallel
  // with the media pipeline so it adds no perceptible latency for the
  // 95% of users on a normal browser.
  const [webrtcStatus, setWebrtcStatus] = useState<WebRtcCapabilityStatus | "pending">(
    "pending",
  );
  const [isBrave, setIsBrave] = useState(false);
  const ua = useMemo(() => describeUserAgent(), []);
  useEffect(() => {
    let cancelled = false;
    // Note: probeWebRtcCapability defaults its ICE config to
    // `DEFAULT_ICE_SERVERS` (lib/iceServers.ts), which is the same set
    // RoomPage uses for the real call. The probe and the call see the
    // same network reachability surface; passing here means the live
    // call has a real chance.
    probeWebRtcCapability().then((result) => {
      if (!cancelled) setWebrtcStatus(result.status);
    }).catch(() => {
      // Defensive: probe is engineered not to throw, but if it does
      // we degrade open rather than block a real user.
      if (!cancelled) setWebrtcStatus("ok");
    });
    isBraveBrowser().then((b) => { if (!cancelled) setIsBrave(b); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState("");
  const [videoStyle, setVideoStyle] = useState<VideoStyle>(() =>
    readStoredVideoStyle() ?? DEFAULT_VIDEO_STYLE,
  );
  const [voiceMode, setVoiceModeState] = useState<number>(() =>
    readStoredVoiceMode() ?? DEFAULT_VOICE_MODE,
  );

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_VIDEO, String(videoStyle)); } catch {}
  }, [videoStyle]);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY_VOICE, String(voiceMode)); } catch {}
  }, [voiceMode]);
  // Onion + host: relay-only is pre-checked. Disabling is gated by a
  // one-time confirmation modal in the same session.
  const [relayOnly, setRelayOnly] = useState<boolean>(() => onion && showRelayToggle);
  const [confirmDisableOpen, setConfirmDisableOpen] = useState(false);
  const [onionDisableConfirmed, setOnionDisableConfirmed] = useState(false);
  // joinedRoomRelayOnly: only set on a successful fetch — null otherwise
  // so we never show a warning we can't justify. roomStateChecked tracks
  // whether the joiner-on-onion fetch has terminated (success or failure)
  // and is what gates ENTER ROOM.
  const [joinedRoomRelayOnly, setJoinedRoomRelayOnly] = useState<boolean | null>(null);
  const [roomStateChecked, setRoomStateChecked] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewError, setPreviewError] = useState("");
  // Task #636: VIDEO/VOICE mask selection now lives in the shared
  // MasksSheet, opened from a single label-only MASKS button — same sheet
  // RoomPage uses in-call. The sheet owns its own preview, tap-to-hear,
  // and ALLOW UNMASKED grant flow.
  const [masksSheetOpen, setMasksSheetOpen] = useState(false);

  // Host-only "share room" affordance (task #637, simplified task #645). The
  // heavy phrase block moved into the room itself; the lobby now carries a
  // single SHARE button that opens the existing PhraseShareModal (QR + join
  // link). The two URL-leak cautions live behind an accessible ⓘ disclosure
  // rather than shouting at every host inline.
  const [shareCautionsOpen, setShareCautionsOpen] = useState(false);
  const [phraseShareOpen, setPhraseShareOpen] = useState(false);

  // Joiner-on-onion: fetch room state to drive the pre-entry warning
  // and to release the ENTER gate. Local relay enforcement still applies
  // even if the fetch fails — failure resolves to `false` so ENTER is
  // not held forever on a network blip.
  useEffect(() => {
    if (!onion || showRelayToggle || !roomId) return;
    let cancelled = false;
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    // Task #1024: for a human room the durable `roomId` is NOT the value the
    // room is registered under server-side — signaling routes on the live
    // per-epoch rendezvous handle. Probe the same ordered window the join
    // uses (H(E), H(E-1), H(E+1)) and read the state from the first handle
    // that resolves. Best-effort: any failure still releases the ENTER gate
    // so a network blip can't strand the joiner.
    (async () => {
      try {
        const candidates = await rendezvousJoinCandidates(roomId);
        for (const code of candidates) {
          if (cancelled) return;
          try {
            const r = await fetch(`${base}/api/room-state/${code}`);
            if (!r.ok) continue;
            const data = await r.json();
            if (data && typeof data.relayOnly === "boolean") {
              if (!cancelled) setJoinedRoomRelayOnly(data.relayOnly);
              break;
            }
          } catch {
            // Try the next candidate; a single fetch failure shouldn't
            // abandon the rest of the window.
          }
        }
      } finally {
        if (!cancelled) setRoomStateChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onion, showRelayToggle, roomId, voidPhrase]);

  const pipelineRef = useRef<MediaPipeline | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const startingRef = useRef(false);
  // Set when stopPreview runs while a buildMediaPipeline await is in
  // flight, so the late-resolving pipeline can be torn down instead of
  // leaking past unmount.
  const startCancelledRef = useRef(false);
  const stopDrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    function refreshDevices() {
      navigator.mediaDevices?.enumerateDevices?.()
        .then((devices) => {
          if (cancelled) return;
          const inputs = devices.filter((d) => d.kind === "audioinput" && d.label);
          setAudioDevices(inputs);
        })
        .catch(() => {});
    }
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
    };
  }, []);

  const stopPreview = useCallback(() => {
    // Mark any in-flight startPreview await as cancelled so a
    // late-resolving pipeline tears itself down instead of binding to
    // a now-unmounted component.
    startCancelledRef.current = true;
    stopDrawRef.current?.();
    stopDrawRef.current = null;
    if (pipelineRef.current) {
      pipelineRef.current.disableMonitor();
      pipelineRef.current.stop();
      pipelineRef.current = null;
    }
    void closeAudioContext();
    setPreviewActive(false);
  }, []);

  const startPreview = useCallback(async () => {
    if (startingRef.current || pipelineRef.current) return;
    startingRef.current = true;
    startCancelledRef.current = false;
    setPreviewError("");
    try {
      const pipeline = await buildMediaPipeline(getAudioContext(), {
        audioDeviceId: selectedAudioDevice || undefined,
      });
      // Cancellation guard: if stopPreview/unmount ran while the build
      // was awaiting, the late-resolving pipeline must be stopped and
      // the AudioContext closed here — cleanup has already passed.
      if (startCancelledRef.current) {
        try { pipeline.stop(); } catch {}
        void closeAudioContext();
        return;
      }
      pipelineRef.current = pipeline;
      if (previewCanvasRef.current) {
        const ctx2d = previewCanvasRef.current.getContext("2d");
        const srcCanvas = pipeline.canvas;
        previewCanvasRef.current.width = srcCanvas.width;
        previewCanvasRef.current.height = srcCanvas.height;
        let rafId = 0;
        let stopped = false;
        function drawFrame() {
          if (stopped) return;
          if (ctx2d && srcCanvas.width > 0) {
            ctx2d.drawImage(srcCanvas, 0, 0);
          }
          rafId = requestAnimationFrame(drawFrame);
        }
        rafId = requestAnimationFrame(drawFrame);
        stopDrawRef.current = () => {
          stopped = true;
          if (rafId) cancelAnimationFrame(rafId);
          rafId = 0;
        };
      }
      pipeline.setVideoStyle(videoStyle);
      if (voiceMode > 0) pipeline.setVoiceMode(voiceMode);
      setPreviewActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setPreviewError(msg);
      void closeAudioContext();
    } finally {
      startingRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioDevice]);

  // Unmount cleanup: always tear down the pipeline + AudioContext when
  // PreviewGate unmounts, regardless of whether a preview ever started.
  // Kept separate from the auto-start effect below so the gating of
  // startPreview on the WebRTC probe (task #368) does not skip cleanup
  // in the "never started" case.
  useEffect(() => {
    return () => {
      stopPreview();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start preview on mount — gated on the WebRTC probe.
  // Task #368: don't open the camera/mic until we know the browser can
  // gather ICE candidates. If the probe reports blocked/no-rtc the UI
  // swaps to BrowserBlockedScreen below and we never start the
  // pipeline at all (no permission prompt the user is about to waste).
  // The probe budget is bounded to ~3s, so this adds at most a few
  // hundred ms on the happy path before camera startup.
  useEffect(() => {
    if (webrtcStatus !== "ok") return;
    resumeAudio();
    startPreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webrtcStatus]);

  // Restart pipeline when audio device changes (only after first start)
  useEffect(() => {
    if (!pipelineRef.current) return;
    stopPreview();
    startPreview();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAudioDevice]);

  // Task #636: gated-NONE semantics are preserved even though mask
  // selection now lives in the MasksSheet. When ALLOW UNMASKED video/voice
  // is OFF and the current selection is NONE (0) — e.g. a stored
  // voidVideoStyle/voidVoiceMode=0 predating the rail, or a REVOKE from
  // the MasksSheet / Hamburger menu — snap it back to the default mask so
  // PreviewGate never carries an unmasked selection into the room while
  // the matching pref is off. Runs on mount and on every prefs change.
  useEffect(() => {
    const apply = () => {
      if (!getAllowUnmaskedVideo()) {
        setVideoStyle((prev) => {
          if (prev !== 0) return prev;
          const next = MASK_DEFAULT_VIDEO_STYLE as VideoStyle;
          pipelineRef.current?.setVideoStyle(next);
          return next;
        });
      }
      if (!getAllowUnmaskedVoice()) {
        setVoiceModeState((prev) => {
          if (prev !== 0) return prev;
          const next = MASK_DEFAULT_VOICE_MODE;
          pipelineRef.current?.setVoiceMode(next);
          return next;
        });
      }
    };
    apply();
    return subscribeMaskingPrefs(apply);
  }, []);

  // Task #636: relay-only explanatory copy is demoted behind a ⓘ
  // affordance. The text stays in the DOM (visually hidden) and is linked
  // to the toggle button for assistive tech; tapping ⓘ reveals it.
  const [relayInfoOpen, setRelayInfoOpen] = useState(false);
  const relayInfoId = useId();
  const screenHeadingId = useId();

  // Task #636: commit a MasksSheet selection back into the lobby state and
  // reflect it on the live self-preview pipeline (videoStyle 0 / voiceMode
  // 0 are valid — the sheet only offers them once the matching ALLOW
  // UNMASKED pref has been granted).
  const applyMasks = useCallback(
    (next: { videoStyle: VideoStyle; voiceMode: number }) => {
      setVideoStyle(next.videoStyle);
      setVoiceModeState(next.voiceMode);
      pipelineRef.current?.setVideoStyle(next.videoStyle);
      pipelineRef.current?.setVoiceMode(next.voiceMode);
    },
    [],
  );

  // Onion-joiner gate: when the joiner reaches the gate from a `.onion`
  // origin and we have a roomId, ENTER ROOM is held until the room-state
  // fetch resolves. This guarantees the inline warning has had a chance
  // to render before the user can commit. The local relay enforcement in
  // RoomPage protects them either way, but the visibility requirement
  // demands the warning be visible BEFORE entry, not concurrently with it.
  const onionJoinerGateOpen =
    !showRelayToggle && onion && !!roomId && !roomStateChecked;

  // Hard gate on the WebRTC probe: keep ENTER ROOM disabled until the
  // probe has both settled and returned "ok". "pending" or any non-ok
  // outcome must hold the button — see handleEnter() for rationale.
  const webrtcProbeGateOpen = webrtcStatus !== "ok";
  const enterDisabled = onionJoinerGateOpen || webrtcProbeGateOpen;

  function handleEnter() {
    if (onionJoinerGateOpen) return;
    // Hard gate: the probe must have finished AND reported "ok" before
    // we let the user commit. "pending" means the ~3s probe hasn't
    // settled yet — letting the user click through here would unmount
    // PreviewGate and bypass the blocked-browser screen entirely,
    // reintroducing the original failure mode (generic call timeout).
    // Anything other than "ok" means BrowserBlockedScreen is about to
    // render (or has rendered) and entry must be denied.
    if (webrtcStatus !== "ok") return;
    uiBleep();
    stopPreview();
    onEnter({
      audioDeviceId: selectedAudioDevice || undefined,
      videoStyle,
      voiceMode,
      relayOnly,
    });
  }

  // Loud-fail when the probe reports the browser refused to gather
  // any ICE candidates. Pre-empts handleEnter and replaces the
  // entire preview UI with the dedicated fix-it screen below.
  // `error` (RTCPeerConnection construction throwing) is treated as
  // blocked too: a runtime that can't even build a peer connection is
  // certain to fail the real call. Better to show the fix-it screen
  // than to leave the preview UI visible with the camera never
  // starting (per code review of task #368).
  const webrtcBlocked =
    webrtcStatus === "blocked"
    || webrtcStatus === "no-rtc"
    || webrtcStatus === "error";

  if (webrtcBlocked) {
    return (
      <BrowserBlockedScreen
        detected={ua.privacyBrowser}
        brave={isBrave}
        onBack={() => {
          stopPreview();
          onCancel();
        }}
      />
    );
  }

  function handleBack() {
    uiClick();
    stopPreview();
    onCancel();
  }

  return (
    <div
      style={{
        minHeight: "100svh",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
        position: "relative",
      }}
    >
      {/* Header */}
      <div style={{
        position: "relative",
        zIndex: 50,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: "3px solid var(--gold)",
        backgroundColor: "var(--surface-dark)",
        backgroundImage: "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
        backgroundSize: "auto, 400px auto",
        backgroundRepeat: "repeat",
        gap: "12px",
      }}>
        <img src="/void-icon.png" alt="VOID" style={{ height: "32px", width: "32px", flexShrink: 0 }} />
        <div style={{ fontSize: "12px", color: "var(--gold)", letterSpacing: "2px" }}>
          PREVIEW
        </div>
        {/* Task #420: the SOUNDS toggle was removed from PreviewGate
            and consolidated into the HamburgerMenu's PREFERENCES section
            (reachable from any page that mounts the menu). The in-room
            toggle in RoomHeaderBar is unchanged. */}
      </div>

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px 24px 32px",
          gap: "20px",
          position: "relative",
          zIndex: 20,
        }}
      >
        {/* Task #636: the visible "Set Up Before Going Live" body heading
            was removed to calm the screen, but a semantic, visually-hidden
            heading is kept so the page still announces its purpose to
            assistive tech and has a real document outline. */}
        <h1 id={screenHeadingId} style={SR_ONLY}>
          Set up your camera and mic before entering the room
        </h1>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px", width: "100%", maxWidth: "340px" }}>
          {/* Task #637: host-only share affordance. A joiner already has the
              phrase (they arrived via the link), so the lobby shows nothing
              for them. The full phrase display, QR/PRINT trio and the two
              warning paragraphs moved into the room itself; here the host
              gets a single SHARE button (native sheet on mobile, clipboard
              fallback on desktop), a secondary "show QR" link, and the two
              URL-leak cautions tucked behind an accessible ⓘ disclosure.
              `showRelayToggle` is the host flag in this component (App passes
              `current.isHost`), and the relay toggle below is already gated on
              the same signal — so host-only lobby controls share one gate.
              Task #636 (merge): the visible "Set Up Before Going Live"
              heading is dropped for a visually-hidden H1, and the headphones
              advisory is demoted to a small line by the mic selector below —
              so the big HEADPHONES callout that used to sit here is gone. */}
          {showRelayToggle && (
            <div
              data-testid="preview-share-affordance"
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  letterSpacing: "1px",
                  color: "var(--fg-dim)",
                  textTransform: "uppercase",
                }}
              >
                <button
                  type="button"
                  data-testid="preview-share-button"
                  onClick={() => { uiClick(); setPhraseShareOpen(true); }}
                  aria-label="Share room — show QR code or join link"
                  className="void-btn"
                  style={{
                    fontSize: "16px",
                    padding: "8px 16px",
                    letterSpacing: "2px",
                  }}
                >
                  SHARE
                </button>
                <button
                  type="button"
                  data-testid="preview-share-cautions-toggle"
                  aria-label="About sharing safety"
                  aria-expanded={shareCautionsOpen}
                  aria-controls="preview-share-cautions"
                  onClick={() => { uiClick(); setShareCautionsOpen((v) => !v); }}
                  style={{
                    minWidth: "44px",
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    color: shareCautionsOpen ? "var(--teal)" : "var(--fg-dim)",
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)",
                    fontSize: "14px",
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ⓘ
                </button>
              </div>
              {/* The two URL-leak cautions stay in the DOM (and in source, so
                  scripts/check-required-literals.mjs still finds them) but are
                  collapsed by default behind the ⓘ disclosure above. The host
                  who cares opens them; everyone else sees a calm one-liner.
                  Clipboard caution pinned by task #373; fragment-leak caution
                  pinned by task #399 — both load-bearing literals. */}
              {shareCautionsOpen && (
                <div
                  id="preview-share-cautions"
                  data-testid="preview-share-cautions"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    marginTop: "2px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                    color: "var(--fg-dim)",
                    textAlign: "center",
                    lineHeight: 1.5,
                    padding: "0 4px",
                  }}
                >
                  <div>
                    On older Android and many in-app browsers, other apps can read the clipboard. QR doesn’t touch it.
                  </div>
                  <div>
                    Phrase travels in the URL. Anything that reads the URL — browser sync, history, extensions — reads the phrase.
                  </div>
                </div>
              )}
            </div>
          )}

          {audioDevices.length > 1 && (
            <div style={{ width: "100%" }}>
              <label style={{
                display: "block",
                fontSize: "12px",
                letterSpacing: "2px",
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                fontFamily: "var(--font-mono)",
                marginBottom: "4px",
              }}>
                MIC INPUT
              </label>
              <select
                value={selectedAudioDevice}
                onChange={(e) => setSelectedAudioDevice(e.target.value)}
                style={{
                  width: "100%",
                  background: "var(--surface)",
                  color: "var(--fg)",
                  border: "2px solid var(--fg-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  padding: "8px 10px",
                  cursor: "pointer",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  outline: "none",
                  appearance: "auto",
                }}
              >
                <option value="">DEFAULT</option>
                {audioDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `MIC ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              {/* Task #636: the headphones advisory was demoted from a
                  large gold callout to a small quiet line next to the mic
                  selector — same advice, much less visual weight. */}
              <div style={{
                fontSize: "11px",
                lineHeight: 1.4,
                color: "var(--fg-dim)",
                letterSpacing: "0.5px",
                marginTop: "6px",
              }}>
                Headphones recommended — helps prevent echo.
              </div>
            </div>
          )}

          {/* Task #636: when there's only one mic the selector is hidden,
              but the headphones advisory should still appear. */}
          {audioDevices.length <= 1 && (
            <div style={{
              width: "100%",
              fontSize: "11px",
              lineHeight: 1.4,
              color: "var(--fg-dim)",
              letterSpacing: "0.5px",
            }}>
              Headphones recommended — helps prevent echo.
            </div>
          )}

          <div style={{
            width: "100%",
            border: "2px solid var(--fg-dim)",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}>
            <div style={{
              width: "100%",
              maxWidth: "280px",
              aspectRatio: "4/3",
              background: "#0A0908",
              border: "2px solid var(--fg-dim)",
              position: "relative",
              overflow: "hidden",
            }}>
              <canvas
                ref={previewCanvasRef}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: previewActive ? "block" : "none",
                  imageRendering: "pixelated",
                }}
              />
              {!previewActive && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "column",
                  gap: "8px",
                  padding: "0 8px",
                }}>
                  {previewError ? (
                    <>
                      {/* Task #421: this preview-failure line is the sole
                          indicator of what went wrong, with no redundant red
                          affordance to lean on. --red glyphs on the dark
                          canvas surface fall below body-text AA, so recolor
                          to --fg-on-dark and move the red signal onto a
                          bordered pill (audited in check-contrast.mjs). */}
                      <div style={{
                        fontSize: "12px",
                        color: "var(--fg-on-dark)",
                        letterSpacing: "1px",
                        textAlign: "center",
                        border: "1px solid var(--red)",
                        borderRadius: "4px",
                        padding: "6px 12px",
                      }}>
                        {previewError}
                      </div>
                      <button
                        className="void-btn void-btn--teal active"
                        onClick={startPreview}
                        style={{ fontSize: "16px", padding: "8px 14px", letterSpacing: "2px" }}
                      >
                        RETRY
                      </button>
                    </>
                  ) : (
                    <div style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "2px" }}>
                      STARTING...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Task #636: the unfolded video/audio cyclers, the two
                ALLOW UNMASKED toggles and the "to test audio masks" line
                collapse into one label-only MASKS button. It opens the
                same MasksSheet RoomPage uses, which owns the preview,
                tap-to-hear test and the ALLOW UNMASKED grant flow. */}
            <button
              type="button"
              data-testid="preview-masks-button"
              onClick={() => { uiClick(); setMasksSheetOpen(true); }}
              className="void-btn"
              style={{
                width: "100%",
                maxWidth: "280px",
                padding: "12px 14px",
                fontSize: "16px",
                letterSpacing: "3px",
                fontWeight: 700,
              }}
            >
              MASKS
            </button>

          </div>

          {showRelayToggle && (
            <div style={{ width: "100%" }}>
              {/* Task #645: the relay ⓘ now sits to the RIGHT of the
                  relay-only box (in a flex row with it) rather than centered
                  underneath. The disclosure text it controls still renders
                  below the row. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                }}
              >
                <button
                  data-testid="relay-only-toggle"
                  onClick={() => {
                    uiSelectClick();
                    if (relayOnly && onion && !onionDisableConfirmed) {
                      setConfirmDisableOpen(true);
                      return;
                    }
                    setRelayOnly((v) => !v);
                  }}
                  style={{
                    flex: 1,
                    background: relayOnly ? "var(--teal)" : "transparent",
                    border: `2px solid ${relayOnly ? "var(--teal)" : "var(--fg-dim)"}`,
                    color: relayOnly ? "#fff" : "var(--fg-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "16px",
                    padding: "10px 12px",
                    cursor: "pointer",
                    letterSpacing: "1px",
                    textAlign: "center",
                    textTransform: "uppercase",
                    lineHeight: 1.4,
                  }}
                >
                  {relayOnly ? "✓ " : ""}RELAY-ONLY MODE — HIDE MY IP FROM PEERS
                </button>
                {/* Task #636/#645: the general relay explanation is a small ⓘ
                    affordance, now anchored to the right of the relay box. The
                    explanatory text stays in the DOM at all times (visually
                    hidden when collapsed) so it never leaves the accessibility
                    tree, is linked via aria-describedby, and the button is a
                    44x44px, keyboard-operable (Enter/Space) target. */}
                <button
                  type="button"
                  data-testid="relay-info-toggle"
                  aria-label="What relay-only mode does"
                  aria-expanded={relayInfoOpen}
                  aria-describedby={relayInfoId}
                  onClick={() => { uiClick(); setRelayInfoOpen((v) => !v); }}
                  style={{
                    flex: "0 0 auto",
                    width: "44px",
                    height: "44px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "transparent",
                    border: "none",
                    color: "var(--fg-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "16px",
                    cursor: "pointer",
                  }}
                >
                  ⓘ
                </button>
              </div>
              {onion && (
                <div
                  data-testid="onion-relay-explanation"
                  style={{
                    marginTop: "6px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    letterSpacing: "0.5px",
                    color: "var(--teal)",
                    textAlign: "left",
                    lineHeight: 1.5,
                    padding: "8px 10px",
                    border: "1px dashed var(--teal)",
                  }}
                >
                  Detected Tor onion access. Relay-only is on by default for
                  the whole room. Your own connection is forced to relay
                  regardless of this toggle, because you reached VOID via
                  .onion — disabling here only affects what other peers do.
                </div>
              )}
              <div
                id={relayInfoId}
                data-testid="relay-info-text"
                style={
                  relayInfoOpen
                    ? {
                        marginTop: "2px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                        letterSpacing: "0.5px",
                        color: "var(--fg-dim)",
                        textAlign: "center",
                        lineHeight: 1.5,
                        padding: "0 4px",
                      }
                    : SR_ONLY
                }
              >
                All traffic routes through the TURN relay. Your peers cannot see your IP address.{" "}
                <span style={{ textDecoration: "underline" }}>Slower for everyone</span> in the room.
              </div>
            </div>
          )}

          {/* Joiner-on-onion warning. Local relay enforcement still
              applies via RoomPage; the warning informs about the room. */}
          {onion && !showRelayToggle && joinedRoomRelayOnly === false && (
            <div
              data-testid="onion-join-warning"
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "0.5px",
                color: "var(--gold)",
                textAlign: "left",
                lineHeight: 1.5,
                padding: "10px 12px",
                border: "2px solid var(--gold)",
                background: "var(--surface-dark)",
              }}
            >
              Privacy notice: this room is not relay-only, so other peers’ IP
              addresses may be visible to you. Your own clearnet IP stays
              hidden — because you reached this room over Tor, VOID forces
              relay-only on your side of the connection.
            </div>
          )}
          {onionJoinerGateOpen && (
            <div
              data-testid="onion-join-gate-pending"
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "1px",
                color: "var(--fg-dim)",
                textAlign: "center",
              }}
            >
              CHECKING ROOM SETTINGS…
            </div>
          )}
          {!onionJoinerGateOpen && webrtcProbeGateOpen && (
            <div
              data-testid="webrtc-probe-pending"
              style={{
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "1px",
                color: "var(--fg-dim)",
                textAlign: "center",
              }}
            >
              CHECKING BROWSER COMPATIBILITY…
            </div>
          )}

          <button
            className="void-btn void-btn--gold active"
            onClick={handleEnter}
            disabled={enterDisabled}
            data-testid="enter-room"
            style={{
              width: "100%",
              fontSize: "16px",
              padding: "18px",
              letterSpacing: "2px",
              border: "4px solid #C85A00",
              opacity: enterDisabled ? 0.55 : 1,
              cursor: enterDisabled ? "not-allowed" : "pointer",
            }}
          >
            ENTER ROOM
          </button>
          <button
            className="void-btn"
            onClick={handleBack}
            style={{ width: "100%", fontSize: "16px", padding: "14px", letterSpacing: "2px", color: "var(--fg-dim)", borderColor: "var(--fg-dim)" }}
          >
            BACK
          </button>
        </div>
      </div>
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
        audioDeviceId={selectedAudioDevice || undefined}
      />
      {phraseShareOpen && (
        <PhraseShareModal
          phrase={voidPhrase}
          joinUrl={buildJoinUrl(voidPhrase)}
          onClose={() => setPhraseShareOpen(false)}
        />
      )}
      {confirmDisableOpen && (
        <div
          data-testid="onion-disable-confirm"
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            style={{
              maxWidth: "440px",
              width: "100%",
              background: "var(--surface-dark)",
              border: "2px solid var(--gold)",
              padding: "20px",
              fontFamily: "var(--font-mono)",
              /* Task #1112: --fg is 1.09:1 on --surface-dark (invisible).
                 --fg-on-dark is the body-text-on-dark token. */
              color: "var(--fg-on-dark)",
              fontSize: "13px",
              letterSpacing: "1px",
              lineHeight: 1.5,
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: "var(--gold)",
                textTransform: "uppercase",
              }}
            >
              Disable relay-only?
            </div>
            <div>
              You reached VOID over Tor. Your own connection stays
              relay-only either way — VOID forces it because of the
              .onion origin. Turning this off only changes the room-wide
              default, so other peers will be allowed to offer their own
              clearnet IPs to each other. Continue?
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                data-testid="onion-disable-cancel"
                onClick={() => {
                  uiClick();
                  setConfirmDisableOpen(false);
                }}
                style={{
                  background: "transparent",
                  /* Task #1112: --fg-dim is 1.39:1 on the --surface-dark modal —
                     #A89E90 is the audited dim-on-dark token (7.13:1). */
                  border: "1px solid #A89E90",
                  color: "#A89E90",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  letterSpacing: "2px",
                  padding: "10px 14px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                Keep on
              </button>
              <button
                type="button"
                data-testid="onion-disable-confirm-btn"
                onClick={() => {
                  uiClick();
                  setRelayOnly(false);
                  setOnionDisableConfirmed(true);
                  setConfirmDisableOpen(false);
                }}
                style={{
                  background: "transparent",
                  border: "1px solid var(--red)",
                  color: "var(--red)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  letterSpacing: "2px",
                  padding: "10px 14px",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                Yes, disable
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
