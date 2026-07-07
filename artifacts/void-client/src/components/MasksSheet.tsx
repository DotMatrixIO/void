// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useId, useRef, useState } from "react";
import type { VideoStyle } from "@/lib/mediaPipeline";
import { buildMediaPipeline, type MediaPipeline } from "@/lib/mediaPipeline";
import { getAudioContext } from "@/lib/sounds";
import { uiClick, uiSelectClick } from "@/lib/uiSounds";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  ALLOW_UNMASKED_VIDEO_CONFIRM_BODY,
  ALLOW_UNMASKED_VOICE_CONFIRM_BODY,
} from "@/components/AllowUnmaskedToggleControl";
import {
  DEFAULT_VIDEO_STYLE,
  DEFAULT_VOICE_MODE,
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
  setAllowUnmaskedVideo,
  setAllowUnmaskedVoice,
  subscribeMaskingPrefs,
} from "@/lib/maskingPrefs";

// Task #594: the two footer cyclers (VIDEO: / VOICE:) are replaced by a
// single MASKS button on the control bar that opens this sheet. The sheet
// owns ALL mask selection while in-call:
//   - One live self-preview pane that re-points a *single* preview
//     pipeline to whichever video mask is highlighted (no six-up live
//     grid — just static labelled tiles + one live pane).
//   - Voice tap-to-hear: tapping "TAP TO HEAR" records a few seconds of
//     the masked mic with the highlighted voice mask applied, then plays
//     that masked recording back. Nothing is captured before the tap; the
//     recording is flushed (dropped + playback stopped) on close / BURN /
//     leave so no captured audio ever outlives the sheet.
//   - CLEAR (unmasked video) and VOICE (unmasked voice) are permission
//     gated: selecting them when the corresponding ALLOW UNMASKED pref is
//     off routes through the existing confirm dialog and grants the pref
//     on confirm (grant-and-select).
//   - Selections are DRAFT until APPLY. Peers only see the change on
//     APPLY, so re-pointing the preview never makes peers flicker through
//     intermediate masks.

export const VIDEO_STYLE_LABELS: Record<number, string> = {
  0: "CLEAR",
  1: "GOLD",
  2: "PIXEL",
  3: "CONTOUR",
  4: "SILHOUETTE",
  5: "ASCII",
};
export const VOICE_MODE_LABELS = [
  "VOICE",
  "DEEP",
  "FORMANT",
  "SCRAMBLE",
  "COMBINED",
];
const VIDEO_STYLE_COUNT = 6;

export interface MasksSheetProps {
  open: boolean;
  onClose: () => void;
  /** Currently-applied (outgoing) styles — seed the draft on open. */
  videoStyle: VideoStyle;
  voiceMode: number;
  /** Commit the draft selection. Called once, on APPLY. */
  onApply: (next: { videoStyle: VideoStyle; voiceMode: number }) => void;
  allowUnmaskedVideo: boolean;
  allowUnmaskedVoice: boolean;
  /** Grant the corresponding pref (called from the confirm-on-select flow). */
  onGrantUnmaskedVideo: () => void;
  onGrantUnmaskedVoice: () => void;
  audioDeviceId?: string;
  /** Bump to force-flush the audio buffer (BURN / leave). */
  flushSignal?: number;
}

type PendingConfirm = "video" | "voice" | null;
type AudioState = "idle" | "recording" | "playing";

// Task #594: how many seconds of the masked mic "TAP TO HEAR" records
// before playing the masked recording back. Nothing is captured until the
// tap; the recording is flushed on close / BURN / leave so no captured
// audio ever outlives the sheet.
const RECORD_SECONDS = 3.5;

export default function MasksSheet({
  open,
  onClose,
  videoStyle,
  voiceMode,
  onApply,
  allowUnmaskedVideo,
  allowUnmaskedVoice,
  onGrantUnmaskedVideo,
  onGrantUnmaskedVoice,
  audioDeviceId,
  flushSignal,
}: MasksSheetProps) {
  const headingId = useId();
  const [draftVideo, setDraftVideo] = useState<VideoStyle>(videoStyle);
  const [draftVoice, setDraftVoice] = useState<number>(voiceMode);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [audioState, setAudioState] = useState<AudioState>("idle");
  const [previewLive, setPreviewLive] = useState(false);
  // Task #597: REVOKE moved here from the in-call overflow menu. The
  // sheet mirrors the two ALLOW UNMASKED prefs live (the grant-on-select
  // flow can flip them while the sheet is open) so the revoke control
  // appears the moment either clear grant is active and disappears the
  // moment both are off. A short polite note confirms the snap-back.
  const [liveAllowVideo, setLiveAllowVideo] = useState<boolean>(allowUnmaskedVideo);
  const [liveAllowVoice, setLiveAllowVoice] = useState<boolean>(allowUnmaskedVoice);
  const [revokeNote, setRevokeNote] = useState<string | null>(null);

  const pipelineRef = useRef<MediaPipeline | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // Sheet-scoped on-demand capture of the masked mic. The Web Audio
  // capture nodes (source → processor → muted sink) are wired on open, but
  // the processor only appends frames to `chunks` while `capturing` is
  // true (i.e. during a TAP TO HEAR record window). `flushRing()` drops the
  // captured samples so nothing survives the sheet.
  const captureRef = useRef<{
    sampleRate: number;
    source: MediaStreamAudioSourceNode | null;
    processor: ScriptProcessorNode | null;
    sink: GainNode | null;
    chunks: Float32Array[];
    totalSamples: number;
    maxSamples: number;
    capturing: boolean;
  } | null>(null);
  const playbackRef = useRef<AudioBufferSourceNode | null>(null);
  const recordTimerRef = useRef<number | null>(null);

  const dialogRef = useDialogFocusTrap<HTMLDivElement>({
    onEscape: onClose,
    active: open && pendingConfirm === null,
  });

  // Clear the pending record-window timer, if any.
  function clearRecordTimer() {
    if (recordTimerRef.current !== null) {
      window.clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  }

  // Stop any in-flight playback node (does NOT discard captured samples).
  function stopPlayback() {
    const node = playbackRef.current;
    playbackRef.current = null;
    if (node) {
      try {
        node.stop();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
  }

  // Cancel any in-flight record window or playback and return to idle.
  // Does NOT drop already-captured samples on its own — `flushRing` does.
  function resetHear() {
    clearRecordTimer();
    stopPlayback();
    const c = captureRef.current;
    if (c) c.capturing = false;
    setAudioState("idle");
  }

  // Flush the capture: cancel record/playback AND drop the recorded
  // samples so the masked audio cannot be replayed. Called on close, BURN,
  // and leave (via `flushSignal`).
  function flushRing() {
    resetHear();
    const c = captureRef.current;
    if (c) {
      c.chunks = [];
      c.totalSamples = 0;
    }
  }

  // Fully tear down the capture nodes (called on sheet close).
  function teardownRing() {
    flushRing();
    const c = captureRef.current;
    captureRef.current = null;
    if (c) {
      try {
        if (c.processor) c.processor.onaudioprocess = null;
      } catch {}
      for (const node of [c.source, c.processor, c.sink]) {
        try {
          node?.disconnect();
        } catch {}
      }
    }
  }

  // Seed the draft + build the single preview pipeline whenever the sheet
  // opens. Tear everything down (pipeline, rAF, audio buffer, audio ctx)
  // on close so nothing keeps the camera/mic warm behind the sheet.
  useEffect(() => {
    if (!open) return;
    setDraftVideo(videoStyle);
    setDraftVoice(voiceMode);
    let cancelled = false;

    (async () => {
      try {
        const Ctor =
          typeof window !== "undefined"
            ? window.AudioContext ||
              (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext
            : undefined;
        const ctx: AudioContext = Ctor
          ? new Ctor()
          : (getAudioContext() as AudioContext);
        audioCtxRef.current = Ctor ? ctx : null;
        const pipeline = await buildMediaPipeline(ctx, { audioDeviceId });
        if (cancelled) {
          try {
            pipeline.stop();
          } catch {}
          return;
        }
        pipelineRef.current = pipeline;
        pipeline.setVideoStyle(videoStyle);
        pipeline.setVoiceMode(voiceMode);
        setPreviewLive(true);

        // Wire the masked (processed) mic track into a ScriptProcessor.
        // The sink gain is 0 so the live mic is never echoed to the
        // speakers. The processor only appends frames while a TAP TO HEAR
        // record window is active (`capturing` true); otherwise it is
        // inert, so nothing is captured before the user taps.
        try {
          const audioTrack = pipeline.processedStream.getAudioTracks()[0];
          if (
            audioTrack &&
            audioCtxRef.current &&
            typeof audioCtxRef.current.createMediaStreamSource === "function" &&
            typeof audioCtxRef.current.createScriptProcessor === "function"
          ) {
            const ac = audioCtxRef.current;
            const sampleRate = ac.sampleRate || 48000;
            const source = ac.createMediaStreamSource(
              new MediaStream([audioTrack]),
            );
            const processor = ac.createScriptProcessor(4096, 1, 1);
            const sink = ac.createGain();
            sink.gain.value = 0;
            processor.onaudioprocess = (e) => {
              const c = captureRef.current;
              if (!c || !c.capturing) return;
              const remaining = c.maxSamples - c.totalSamples;
              if (remaining <= 0) return;
              const input = e.inputBuffer.getChannelData(0);
              const take = Math.min(remaining, input.length);
              const copy = new Float32Array(take);
              for (let i = 0; i < take; i++) copy[i] = input[i];
              c.chunks.push(copy);
              c.totalSamples += take;
            };
            source.connect(processor);
            processor.connect(sink);
            sink.connect(ac.destination);
            captureRef.current = {
              sampleRate,
              source,
              processor,
              sink,
              chunks: [],
              totalSamples: 0,
              maxSamples: Math.max(1, Math.floor(sampleRate * RECORD_SECONDS)),
              capturing: false,
            };
          }
        } catch {
          // Capture is best-effort; selection UI works without it.
        }

        const draw = () => {
          const src = pipeline.canvas;
          const dst = previewCanvasRef.current;
          if (src && dst) {
            const c = dst.getContext("2d");
            if (c) {
              try {
                c.drawImage(src, 0, 0, dst.width, dst.height);
              } catch {}
            }
          }
          rafRef.current = requestAnimationFrame(draw);
        };
        rafRef.current = requestAnimationFrame(draw);
      } catch {
        // Preview is best-effort. The selection UI still works without it.
        setPreviewLive(false);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      teardownRing();
      const p = pipelineRef.current;
      pipelineRef.current = null;
      if (p) {
        try {
          p.stop();
        } catch {}
      }
      const ac = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ac) {
        try {
          void ac.close();
        } catch {}
      }
      setPreviewLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // BURN / leave force-flush the rolling capture (zero the ring + stop
  // any preview playback) without waiting for the sheet to unmount.
  useEffect(() => {
    if (flushSignal === undefined) return;
    flushRing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushSignal]);

  // Task #597: keep the live ALLOW UNMASKED mirror in sync. Re-seed from
  // the incoming props each time the sheet opens, then follow live flips
  // (grant-on-select here, or a flip from another surface) so the revoke
  // control's visibility always matches the real pref state.
  useEffect(() => {
    if (!open) return;
    setLiveAllowVideo(getAllowUnmaskedVideo());
    setLiveAllowVoice(getAllowUnmaskedVoice());
    setRevokeNote(null);
    return subscribeMaskingPrefs(() => {
      setLiveAllowVideo(getAllowUnmaskedVideo());
      setLiveAllowVoice(getAllowUnmaskedVoice());
    });
  }, [open]);

  // The snap-back note is transient — clear it after a short window.
  useEffect(() => {
    if (!revokeNote) return;
    const t = window.setTimeout(() => setRevokeNote(null), 4000);
    return () => window.clearTimeout(t);
  }, [revokeNote]);

  // Revoke both clear grants at once. Flips the prefs OFF (which the
  // RoomPage subscription snaps back to the masked defaults for the
  // outgoing stream) and, if the sheet's own draft is currently sitting
  // on a clear option, snaps the draft + preview back to the defaults so
  // APPLY can never re-commit an unmasked stream after a revoke.
  function revokeUnmasked() {
    uiClick();
    setAllowUnmaskedVideo(false);
    setAllowUnmaskedVoice(false);
    if (draftVideo === 0) {
      const next = DEFAULT_VIDEO_STYLE as VideoStyle;
      setDraftVideo(next);
      pipelineRef.current?.setVideoStyle(next);
    }
    if (draftVoice === 0) {
      setDraftVoice(DEFAULT_VOICE_MODE);
      pipelineRef.current?.setVoiceMode(DEFAULT_VOICE_MODE);
    }
    setRevokeNote("MASKS RESTORED — VIDEO: ASCII · VOICE: SCRAMBLE");
  }

  function selectVideo(idx: VideoStyle) {
    uiSelectClick();
    // Gate on the LIVE pref mirror, not the (possibly stale) prop. After
    // an in-sheet REVOKE flips the grant OFF, re-selecting CLEAR must
    // prompt the grant confirm again rather than silently re-committing
    // an unmasked stream.
    if (idx === 0 && !liveAllowVideo) {
      setPendingConfirm("video");
      return;
    }
    setDraftVideo(idx);
    pipelineRef.current?.setVideoStyle(idx);
  }

  function selectVoice(idx: number) {
    uiSelectClick();
    resetHear();
    if (idx === 0 && !liveAllowVoice) {
      setPendingConfirm("voice");
      return;
    }
    setDraftVoice(idx);
    pipelineRef.current?.setVoiceMode(idx);
  }

  function confirmPending() {
    if (pendingConfirm === "video") {
      onGrantUnmaskedVideo();
      setDraftVideo(0);
      pipelineRef.current?.setVideoStyle(0);
    } else if (pendingConfirm === "voice") {
      onGrantUnmaskedVoice();
      setDraftVoice(0);
      pipelineRef.current?.setVoiceMode(0);
    }
    setPendingConfirm(null);
  }

  // Tap-to-hear: record RECORD_SECONDS of the masked mic with the selected
  // voice mask applied, then play that masked recording back. Nothing is
  // captured before the tap; the recording is dropped the moment the
  // capture is flushed (close / BURN / leave).
  function hearVoice() {
    const c = captureRef.current;
    if (!c) return;
    if (audioState !== "idle") return;
    resetHear();
    pipelineRef.current?.setVoiceMode(draftVoice);

    c.chunks = [];
    c.totalSamples = 0;
    c.capturing = true;
    setAudioState("recording");

    recordTimerRef.current = window.setTimeout(() => {
      recordTimerRef.current = null;
      playRecording();
    }, Math.round(RECORD_SECONDS * 1000));
  }

  // Assemble the captured frames into one buffer and play it. Called when
  // the record window closes. A capture with no frames (silence / no audio
  // graph) simply returns to idle without playing anything.
  function playRecording() {
    const ac = audioCtxRef.current;
    const c = captureRef.current;
    if (!ac || !c) {
      setAudioState("idle");
      return;
    }
    c.capturing = false;
    const len = c.totalSamples;
    if (len === 0) {
      setAudioState("idle");
      return;
    }

    let out: AudioBuffer;
    try {
      out = ac.createBuffer(1, len, c.sampleRate);
    } catch {
      setAudioState("idle");
      return;
    }
    const data = out.getChannelData(0);
    let offset = 0;
    for (const chunk of c.chunks) {
      if (offset >= len) break;
      const room = len - offset;
      const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
      data.set(slice, offset);
      offset += slice.length;
    }

    let node: AudioBufferSourceNode;
    try {
      node = ac.createBufferSource();
    } catch {
      setAudioState("idle");
      return;
    }
    node.buffer = out;
    try {
      node.connect(ac.destination);
    } catch {}
    node.onended = () => {
      if (playbackRef.current === node) {
        playbackRef.current = null;
        setAudioState("idle");
      }
    };
    playbackRef.current = node;
    setAudioState("playing");
    try {
      node.start();
    } catch {
      playbackRef.current = null;
      setAudioState("idle");
    }
  }

  function handleApply() {
    uiClick();
    onApply({ videoStyle: draftVideo, voiceMode: draftVoice });
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="void-masks-sheet-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9000,
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        data-testid="masks-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "3px solid var(--gold)",
          maxWidth: "520px",
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: "20px",
          fontFamily: "var(--font-mono)",
          color: "var(--fg)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
        >
          <h2
            id={headingId}
            style={{
              fontFamily: "'Staatliches', system-ui, sans-serif",
              fontSize: "20px",
              letterSpacing: "3px",
              /* Task #1114: was var(--gold) on the var(--bg) panel (1.35:1,
                 unreadable). --fg passes AA; the 3px gold panel border keeps
                 the brand accent. */
              color: "var(--fg)",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            MASKS
          </h2>
          <button
            type="button"
            className="void-btn"
            data-testid="masks-sheet-cancel"
            onClick={onClose}
            style={{ fontSize: "16px", padding: "6px 12px", letterSpacing: "2px" }}
          >
            CANCEL
          </button>
        </div>

        {/* Single live self-preview pane reflecting the highlighted video mask. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            background: "#0A0908",
            border: "1px solid var(--fg-dim)",
          }}
        >
          <canvas
            ref={previewCanvasRef}
            data-testid="masks-sheet-preview"
            width={320}
            height={240}
            style={{
              width: "100%",
              maxWidth: "320px",
              height: "auto",
              imageRendering: "pixelated",
              opacity: previewLive ? 1 : 0.4,
            }}
          />
        </div>

        <div>
          <div className="void-masks-sheet-label">VIDEO MASK</div>
          <div
            className="void-masks-sheet-grid"
            role="group"
            aria-label="Video mask"
          >
            {Array.from({ length: VIDEO_STYLE_COUNT }, (_, idx) => {
              const i = idx as VideoStyle;
              const selected = draftVideo === i;
              const isClear = i === 0;
              return (
                <button
                  key={i}
                  type="button"
                  data-testid={`masks-sheet-video-option-${i}`}
                  aria-pressed={selected}
                  className={`void-btn${selected ? " void-btn--gold active" : ""}`}
                  onClick={() => selectVideo(i)}
                  style={{ fontSize: "13px", padding: "8px 6px", letterSpacing: "1px" }}
                >
                  {VIDEO_STYLE_LABELS[i]}
                  {isClear ? " ⚠" : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="void-masks-sheet-label">VOICE MASK</div>
          <div
            className="void-masks-sheet-grid"
            role="group"
            aria-label="Voice mask"
          >
            {VOICE_MODE_LABELS.map((label, i) => {
              const selected = draftVoice === i;
              const isClear = i === 0;
              return (
                <button
                  key={i}
                  type="button"
                  data-testid={`masks-sheet-voice-option-${i}`}
                  aria-pressed={selected}
                  className={`void-btn${selected ? " void-btn--gold active" : ""}`}
                  onClick={() => selectVoice(i)}
                  style={{ fontSize: "13px", padding: "8px 6px", letterSpacing: "1px" }}
                >
                  {label}
                  {isClear ? " ⚠" : ""}
                </button>
              );
            })}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px",
              marginTop: "8px",
            }}
          >
            <button
              type="button"
              className="void-btn"
              data-testid="masks-sheet-hear"
              onClick={hearVoice}
              disabled={audioState !== "idle"}
              style={{
                fontSize: "16px",
                padding: "8px 12px",
                letterSpacing: "1px",
              }}
            >
              {audioState === "playing"
                ? "PLAYING…"
                : audioState === "recording"
                  ? "RECORDING…"
                  : "TAP TO HEAR"}
            </button>
            <span
              data-testid="masks-sheet-hear-hint"
              style={{
                flex: "1 1 160px",
                minWidth: "140px",
                fontSize: "10px",
                lineHeight: 1.4,
                color: "var(--fg-dim)",
                letterSpacing: "0.4px",
              }}
            >
              {`Click "TAP TO HEAR", and say anything to hear your selected voice mask at work.`}
            </span>
          </div>
        </div>

        {(liveAllowVideo || liveAllowVoice) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              borderTop: "1px solid var(--fg-dim)",
              paddingTop: "12px",
            }}
          >
            <button
              type="button"
              className="void-btn void-btn--gold active"
              data-testid="masks-sheet-revoke"
              onClick={revokeUnmasked}
              style={{ fontSize: "16px", padding: "8px 12px", letterSpacing: "1px" }}
            >
              REVOKE UNMASK PERMISSION
            </button>
            <div
              style={{
                fontSize: "10px",
                lineHeight: 1.4,
                color: "var(--fg-dim)",
                letterSpacing: "0.4px",
              }}
            >
              This turns both clear grants off and restores the masked
              defaults for this call. You can grant them again here at any
              time.
            </div>
          </div>
        )}

        {revokeNote && (
          <div
            role="status"
            aria-live="polite"
            data-testid="masks-sheet-revoke-note"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              letterSpacing: "1px",
              color: "var(--gold)",
              textTransform: "uppercase",
              fontWeight: 700,
              padding: "2px 6px",
            }}
          >
            {revokeNote}
          </div>
        )}

        <div
          style={{ display: "flex", gap: "12px", justifyContent: "flex-end", flexWrap: "wrap" }}
        >
          <button
            type="button"
            className="void-btn"
            data-testid="masks-sheet-cancel-2"
            onClick={onClose}
            style={{ fontSize: "16px", padding: "10px 18px", letterSpacing: "2px" }}
          >
            CANCEL
          </button>
          <button
            type="button"
            className="void-btn void-btn--gold active"
            data-testid="masks-sheet-apply"
            onClick={handleApply}
            style={{ fontSize: "16px", padding: "10px 18px", letterSpacing: "2px" }}
          >
            APPLY
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingConfirm === "video"}
        testId="masks-sheet-video-confirm"
        title="ALLOW UNMASKED VIDEO?"
        body={ALLOW_UNMASKED_VIDEO_CONFIRM_BODY}
        confirmLabel="ALLOW"
        cancelLabel="CANCEL"
        onConfirm={confirmPending}
        onCancel={() => setPendingConfirm(null)}
      />
      <ConfirmDialog
        open={pendingConfirm === "voice"}
        testId="masks-sheet-voice-confirm"
        title="ALLOW UNMASKED VOICE?"
        body={ALLOW_UNMASKED_VOICE_CONFIRM_BODY}
        confirmLabel="ALLOW"
        cancelLabel="CANCEL"
        onConfirm={confirmPending}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
