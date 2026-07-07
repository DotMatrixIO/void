// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import type { SecureChannelFailureReason } from "@/lib/webrtc";

let sharedRemoteCtx: AudioContext | null = null;
let sharedRemoteCtxRefCount = 0;

export function getSharedRemoteCtx(): AudioContext {
  if (!sharedRemoteCtx || sharedRemoteCtx.state === "closed") {
    sharedRemoteCtx = new AudioContext();
    sharedRemoteCtxRefCount = 0;
  }
  sharedRemoteCtxRefCount++;
  return sharedRemoteCtx;
}

export function releaseSharedRemoteCtx() {
  if (!sharedRemoteCtx) return;
  sharedRemoteCtxRefCount = Math.max(0, sharedRemoteCtxRefCount - 1);
  if (sharedRemoteCtxRefCount === 0) {
    try { sharedRemoteCtx.close(); } catch {}
    sharedRemoteCtx = null;
  }
}

export function VuMeter({
  analyserOrStream,
  muted = false,
}: {
  analyserOrStream: AnalyserNode | MediaStream | null;
  // Task #737 defense-in-depth: when the peer advertises `micMuted` we
  // receiver-side silence their audio element (task #702), but the still-
  // arriving audio would keep this VU meter animating — a moving level that
  // contradicts the enforced "muted" state. When `muted` is set we read the
  // meter flat (level 0) and never spin up the analyser loop, so a buggy or
  // malicious sender that keeps transmitting audio shows no level. Reconciles
  // automatically when the prop flips back to false (the peer un-mutes).
  muted?: boolean;
}) {
  const [level, setLevel] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [audioTrackCount, setAudioTrackCount] = useState(0);

  useEffect(() => {
    if (!analyserOrStream || analyserOrStream instanceof AnalyserNode) {
      setAudioTrackCount(analyserOrStream ? 1 : 0);
      return;
    }
    const stream = analyserOrStream;
    setAudioTrackCount(stream.getAudioTracks().length);
    const onAddTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === "audio") setAudioTrackCount(stream.getAudioTracks().length);
    };
    const onRemoveTrack = (e: MediaStreamTrackEvent) => {
      if (e.track.kind === "audio") setAudioTrackCount(stream.getAudioTracks().length);
    };
    stream.addEventListener("addtrack", onAddTrack);
    stream.addEventListener("removetrack", onRemoveTrack);
    return () => {
      stream.removeEventListener("addtrack", onAddTrack);
      stream.removeEventListener("removetrack", onRemoveTrack);
    };
  }, [analyserOrStream]);

  useEffect(() => {
    if (muted) {
      // Force the meter flat and skip wiring any analyser while the peer is
      // reported muted — no level can leak from still-arriving audio.
      setLevel(0);
      return;
    }
    if (!analyserOrStream) return;

    let ownAnalyser = false;
    let localAnalyser: AnalyserNode;
    let srcNode: MediaStreamAudioSourceNode | null = null;

    if (analyserOrStream instanceof AnalyserNode) {
      localAnalyser = analyserOrStream;
    } else {
      if (analyserOrStream.getAudioTracks().length === 0) return;
      const ctx = getSharedRemoteCtx();
      localAnalyser = ctx.createAnalyser();
      localAnalyser.fftSize = 2048;
      srcNode = ctx.createMediaStreamSource(analyserOrStream);
      srcNode.connect(localAnalyser);
      ownAnalyser = true;
    }
    analyserRef.current = localAnalyser;

    const buf = new Float32Array(localAnalyser.fftSize);
    let lastUpdate = 0;
    let rafId = 0;

    function tick(now: number) {
      rafId = requestAnimationFrame(tick);
      if (now - lastUpdate < 100) return;
      lastUpdate = now;
      if (!analyserRef.current) return;
      analyserRef.current.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));
      const norm = Math.max(0, Math.min(1, (db + 60) / 50));
      setLevel(norm);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      if (srcNode) {
        srcNode.disconnect();
      }
      if (ownAnalyser) {
        releaseSharedRemoteCtx();
      }
      analyserRef.current = null;
    };
  }, [analyserOrStream, audioTrackCount, muted]);

  const blocks = 5;
  const active = muted ? 0 : Math.round(level * blocks);

  return (
    <div
      data-testid="vu-meter"
      data-vu-active={active}
      data-vu-muted={muted ? "true" : "false"}
      style={{
      position: "absolute",
      bottom: "8px",
      right: "8px",
      display: "flex",
      gap: "2px",
      zIndex: 5,
      pointerEvents: "none",
    }}>
      {Array.from({ length: blocks }, (_, i) => (
        <div
          key={i}
          style={{
            width: "6px",
            height: "10px",
            background: i < active ? "var(--gold)" : "var(--surface)",
            opacity: i < active ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

// Task #182: map the structured `SecureChannelFailureReason` into the
// short, plain-English copy shown inside the red per-peer overlay so a
// power user (or support reading a screenshot) can tell "active attack"
// (forged signature / wrong-room replay) apart from "transient transport
// failure" (ICE restart couldn't recover). The `kind` field drives the
// secondary hint copy and decides whether retrying is likely to help.
export function describeSecureChannelFailure(reason: SecureChannelFailureReason): {
  headline: string;
  detail: string;
  kind: "attack" | "transient";
} {
  switch (reason) {
    case "hello_invalid":
      return {
        headline: "WE CAN’T VERIFY THIS PEER’S IDENTITY",
        detail: "FORGED SIGNATURE OR WRONG ROOM. RETRY ONLY IF EXPECTED.",
        kind: "attack",
      };
    case "decrypt_failed":
      return {
        headline: "WE CAN’T DECRYPT THIS PEER’S MESSAGES",
        detail: "PHRASE MISMATCH OR TAMPERED TRAFFIC. VERIFY THE PHRASE.",
        kind: "attack",
      };
    case "ice_restart_failed":
      return {
        headline: "WE LOST THE CONNECTION AND COULDN’T RECOVER IT",
        detail: "NETWORK DROPPED MID-CALL. RETRY USUALLY HELPS.",
        kind: "transient",
      };
    case "ecdhe_failed":
    default:
      return {
        headline: "SECURE HANDSHAKE DIDN’T COMPLETE",
        detail: "KEY EXCHANGE FAILED. RETRY OR REJOIN THE ROOM.",
        kind: "transient",
      };
  }
}

export function NoSignalSlot() {
  return (
    <div className="void-no-signal">
      <div style={{ fontSize: "13px", letterSpacing: "3px", color: "#A89E90" }}>NO SIGNAL</div>
    </div>
  );
}

const VIDEO_AR = 4 / 3;
const MAX_CROP = 0.25;

type CropLayout = "contain" | "wide" | "tall";

function computeVideoSize(cw: number, ch: number): { w: number; h: number; layout: CropLayout } {
  const containerAR = cw / ch;

  if (Math.abs(containerAR - VIDEO_AR) < 0.01) {
    return { w: cw, h: ch, layout: "contain" };
  }

  if (containerAR > VIDEO_AR) {
    const containW = ch * VIDEO_AR;
    const containH = ch;
    const maxScale = 1 / (1 - MAX_CROP);
    const fillScale = cw / containW;
    const scale = Math.min(fillScale, maxScale);
    return { w: Math.round(containW * scale), h: Math.round(containH * scale), layout: "wide" };
  } else {
    const containW = cw;
    const containH = cw / VIDEO_AR;
    const maxScale = 1 / (1 - MAX_CROP);
    const fillScale = ch / containH;
    const scale = Math.min(fillScale, maxScale);
    return { w: Math.round(containW * scale), h: Math.round(containH * scale), layout: "tall" };
  }
}

export function VideoSlot({
  stream,
  muted = false,
  mirror = false,
  blankVideo = false,
}: {
  stream: MediaStream | null;
  muted?: boolean;
  mirror?: boolean;
  blankVideo?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number; layout: CropLayout }>({ w: 0, h: 0, layout: "contain" });

  // Task #718 defense-in-depth: when `blankVideo` is set (the peer reports
  // their camera off), bind an *audio-only* view of their stream so no live
  // video frames are rendered — not just covered by an overlay. This mirrors
  // the receiver-side audio mute (task #702): the sender already stops
  // transmitting video, but a buggy or malicious sender that keeps sending
  // frames must not be visible locally. Crucially we keep the media element
  // mounted and its audio tracks bound: remote audio playback is carried by
  // this same <video> element, so a cam-off peer who still has their mic open
  // must remain audible. We derive a fresh MediaStream from only the audio
  // tracks rather than mutating the shared incoming stream, keeping this a
  // purely local rendering decision that reconciles automatically when
  // `blankVideo` flips back to false.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (blankVideo && stream) {
      el.srcObject = new MediaStream(stream.getAudioTracks());
      el.play().catch(() => {});
      return;
    }
    el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream, blankVideo]);

  // Apply `muted` imperatively on the element. React's handling of the
  // `muted` prop on <video>/<audio> is unreliable (it is not reflected as
  // an attribute and can be skipped on mount — facebook/react#10389), so
  // for the privacy-critical receiver-side mute (task #702) we set the DOM
  // property directly whenever it changes. This guarantees a peer that
  // reports `micMuted` is actually silenced locally even if it keeps
  // transmitting audio.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = muted;
  }, [muted, stream]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !stream) return;

    const ro = new ResizeObserver(([entry]) => {
      const cw = entry.contentRect.width;
      const ch = entry.contentRect.height;
      if (cw === 0 || ch === 0) return;
      setDims(computeVideoSize(cw, ch));
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [stream]);

  if (!stream) return <NoSignalSlot />;

  const measured = dims.w > 0 && dims.h > 0;
  const transforms: string[] = [];
  let top: string;
  let left: string;

  if (!measured || dims.layout === "contain") {
    top = "50%";
    left = "50%";
    transforms.push("translate(-50%, -50%)");
  } else if (dims.layout === "wide") {
    top = "0";
    left = "50%";
    transforms.push("translateX(-50%)");
  } else {
    top = "50%";
    left = "50%";
    transforms.push("translate(-50%, -50%)");
  }
  if (mirror) transforms.push("scaleX(-1)");

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        style={{
          position: "absolute",
          top,
          left,
          width: measured ? `${dims.w}px` : "100%",
          height: measured ? `${dims.h}px` : "100%",
          objectFit: measured ? "cover" : "contain",
          objectPosition: "center top",
          display: "block",
          transform: transforms.join(" ") || undefined,
        }}
      />
    </div>
  );
}

// Tiny muted preview used inside the pre-share confirmation panels. We bind
// the very same MediaStream we would forward to peers so the user can see
// what is about to be broadcast and bail out if it is the wrong screen,
// window, or tab. The stream is owned by the panel's lifecycle (created
// when getDisplayMedia resolves, torn down on cancel/confirm), so this
// component does not stop any tracks itself — it only wires srcObject.
export function SharePreviewVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().catch(() => {});
    return () => {
      try { el.srcObject = null; } catch {}
    };
  }, [stream]);
  return (
    <video
      ref={videoRef}
      data-testid="share-preview-video"
      autoPlay
      playsInline
      muted
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#000",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}
