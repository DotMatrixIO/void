// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import RoomPage, { type RoomSnapshotState } from "./RoomPage";
import { readCssToken } from "@/lib/cssTokens";

// The social OG card (1200x630, X/nostr 1.91:1) is rendered here as a
// screenshot of the live RoomPage UI. Kept as a dedicated module so the
// still-poster drift checker can watch ONLY the source that actually
// affects the captured frame — adding or removing route variants in
// `StillPoster.tsx` (the thin route wrapper) should not force the
// social JPEG to be regenerated.
//
// Task #588 retired the `hero` variant; this module now contains the
// last remaining renderer for `scripts/gen-still-poster.mjs`.

const SOCIAL_WIDTH = 1200;
const SOCIAL_HEIGHT = 630;

const CAPTION_LINES = [
  "Right now, you are in a video call.",
  "In 47 minutes, no record of this call will exist.",
  "No recording.",
  "No transcripts.",
  "No archives.",
  "No logs.",
  "Speak accordingly.",
];

type Mode = "PIXEL" | "ASCII" | "CONTOUR";

interface PeerSpec {
  id: string;
  mode: Mode;
  seed: number;
  outline: string;
}

const REMOTE_PEERS: PeerSpec[] = [
  { id: "peer-a4f2", mode: "PIXEL", seed: 11, outline: "#E8A200" },
  { id: "peer-7c13", mode: "ASCII", seed: 23, outline: "#E8A200" },
  { id: "peer-9e08", mode: "CONTOUR", seed: 41, outline: "#E8A200" },
];

const LOCAL_PEER: PeerSpec = {
  id: "peer-3b81",
  mode: "PIXEL",
  seed: 7,
  outline: "#0D9D8B",
};

function makeRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function isInsideSilhouette(nx: number, ny: number) {
  const cx = nx - 0.5;
  const cy = ny - 0.45;
  const insideHead = (cx * cx) / 0.06 + (cy * cy) / 0.10 < 1;
  const insideShoulders = ny > 0.7 && Math.abs(cx) < 0.42 - (1 - ny) * 0.2;
  return insideHead || insideShoulders;
}

function drawConcrete(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = readCssToken("--surface-dark");
  ctx.fillRect(0, 0, w, h);
  const rng = makeRng(91);
  for (let i = 0; i < 1400; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const a = 0.04 + rng() * 0.08;
    ctx.fillStyle = `rgba(168, 158, 144, ${a.toFixed(3)})`;
    ctx.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 60; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = 8 + rng() * 24;
    ctx.fillStyle = `rgba(20, 17, 13, ${(0.3 + rng() * 0.4).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPixel(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number) {
  drawConcrete(ctx, w, h);
  const cols = 24;
  const rows = 16;
  const rng = makeRng(seed);
  const cellW = w / cols;
  const cellH = h / rows;
  ctx.fillStyle = color;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = (x + 0.5) / cols;
      const ny = (y + 0.5) / rows;
      if (!isInsideSilhouette(nx, ny)) continue;
      if (rng() <= 0.18) continue;
      ctx.fillRect(
        Math.round(x * cellW + cellW * 0.04),
        Math.round(y * cellH + cellH * 0.04),
        Math.ceil(cellW * 0.92),
        Math.ceil(cellH * 0.92),
      );
    }
  }
}

function drawAscii(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number) {
  drawConcrete(ctx, w, h);
  const cols = 36;
  const rows = 22;
  const chars = " .,:;i1tfLCG08@".split("");
  const rng = makeRng(seed);
  const cellW = w / cols;
  const cellH = h / rows;
  ctx.fillStyle = color;
  ctx.font = `${Math.floor(cellH * 0.95)}px ui-monospace, "JetBrains Mono", monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = (x + 0.5) / cols;
      const ny = (y + 0.5) / rows;
      if (!isInsideSilhouette(nx, ny)) continue;
      const cx = nx - 0.5;
      const cy = ny - 0.42;
      const lum = Math.max(0, 1 - Math.sqrt(cx * cx + cy * cy) * 2.6) + rng() * 0.45;
      const idx = Math.min(chars.length - 1, Math.max(0, Math.floor(lum * (chars.length - 1))));
      const ch = chars[idx];
      if (ch === " ") continue;
      ctx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2);
    }
  }
}

function drawContour(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number) {
  drawConcrete(ctx, w, h);
  const rng = makeRng(seed);
  const wobble = (amp: number) => (rng() - 0.5) * amp;
  ctx.strokeStyle = color;
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 1 - i * 0.25;
    ctx.lineWidth = Math.max(2, Math.floor(w * 0.005));
    ctx.beginPath();
    const cx = w * 0.5 + wobble(w * 0.02);
    const cy = h * 0.36 + wobble(h * 0.02);
    const rx = w * (0.18 + i * 0.015);
    const ry = h * (0.22 + i * 0.015);
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = 1 - i * 0.25;
    ctx.beginPath();
    ctx.moveTo(w * (0.20 - i * 0.02), h);
    ctx.quadraticCurveTo(w * 0.5, h * (0.72 - i * 0.04), w * (0.80 + i * 0.02), h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function buildPeerStream(spec: PeerSpec): { stream: MediaStream; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext("2d")!;
  if (spec.mode === "PIXEL") drawPixel(ctx, canvas.width, canvas.height, spec.outline, spec.seed);
  else if (spec.mode === "ASCII") drawAscii(ctx, canvas.width, canvas.height, spec.outline, spec.seed);
  else drawContour(ctx, canvas.width, canvas.height, spec.outline, spec.seed);
  const stream = (canvas as HTMLCanvasElement & {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(15);
  return { stream, canvas };
}

function CaptionPanel() {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        backgroundColor: "var(--surface-dark)",
        backgroundImage:
          "linear-gradient(rgba(20,17,13,0.92), rgba(20,17,13,0.92)), url('/concrete.jpeg')",
        backgroundSize: "auto, 400px auto",
        backgroundRepeat: "repeat",
        borderTop: "4px solid #E8A200",
        padding: "20px 26px 22px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        gap: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "#A89E90",
          flexShrink: 0,
        }}
      >
        <span style={{ color: "#E8A200", fontWeight: 700 }}>VOID</span>
        <span style={{ opacity: 0.5 }}>///</span>
        <span>SCREENSHOT FROM AN ACTIVE ROOM</span>
      </div>

      <div
        style={{
          fontFamily: "'Staatliches', system-ui, sans-serif",
          fontWeight: 400,
          fontSize: 20,
          lineHeight: 1.18,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "#F0E6D2",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {CAPTION_LINES.slice(0, -1).map((line, i) => {
          const accent = line.includes("47 minutes") || line.includes("no record");
          return (
            <div
              key={i}
              style={{
                color: accent ? "#E8A200" : "#F0E6D2",
                marginBottom: 4,
              }}
            >
              {line}
            </div>
          );
        })}
        <div
          style={{
            color: "#CC2200",
            marginTop: 10,
            fontSize: 26,
            letterSpacing: 2,
          }}
        >
          {CAPTION_LINES[CAPTION_LINES.length - 1]}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "#A89E90",
          flexShrink: 0,
          borderTop: "2px solid #5C5040",
          paddingTop: 12,
        }}
      >
        <span>MEET IN REAL TIME.</span>
        <span style={{ color: "#E8A200" }}>LEAVE LESS BEHIND.</span>
      </div>
    </div>
  );
}

function RoomFrame({ width, height }: { width: number; height: number }) {
  const [snapshot, setSnapshot] = useState<{
    state: RoomSnapshotState;
    key: CryptoKey;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdStreams: MediaStream[] = [];
    (async () => {
      const localBuilt = buildPeerStream(LOCAL_PEER);
      const remoteBuilt = REMOTE_PEERS.map((p) => ({ p, built: buildPeerStream(p) }));
      createdStreams = [
        localBuilt.stream,
        ...remoteBuilt.map((r) => r.built.stream),
      ];

      const remoteStreams: Record<string, MediaStream> = {};
      for (const { p, built } of remoteBuilt) {
        remoteStreams[p.id] = built.stream;
      }

      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      if (cancelled) return;

      const remainingMs = 47 * 60 * 1000;
      const expiresAtWallClock = Date.now() + remainingMs;

      setSnapshot({
        state: {
          peers: REMOTE_PEERS.map((p) => p.id),
          localStream: localBuilt.stream,
          remoteStreams,
          peerMediaState: REMOTE_PEERS.reduce((acc, p) => {
            acc[p.id] = { camOff: false, micMuted: false, voiceMode: 0 };
            return acc;
          }, {} as Record<string, { camOff: boolean; micMuted: boolean; voiceMode?: number }>),
          isHost: true,
          expiresAtWallClock,
          remainingMs,
          roomTier: "day",
          myPeerId: LOCAL_PEER.id,
        },
        key,
      });
    })();

    return () => {
      cancelled = true;
      for (const s of createdStreams) {
        try {
          s.getTracks().forEach((t) => t.stop());
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return (
    <div
      data-room-frame
      style={{
        width,
        height,
        position: "relative",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {snapshot && (
        <RoomPage
          roomId="DEMO-47"
          e2eKey={snapshot.key}
          voidPhrase="quiet · cedar · river · matchstick · graphite · canyon"
          fromUrl={false}
          snapshotState={snapshot.state}
        />
      )}
    </div>
  );
}

export default function SocialPoster() {
  useEffect(() => {
    document.title = `VOID · this room will not exist · social`;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Side-by-side layout (room left, caption right) so the room gets
  // the full vertical canvas to render its 2x2 grid + header +
  // control bar without clipping. Caption column takes ~42% to keep
  // enough room width for the 2x2 grid at the 1200x630 share size.
  const roomWidth = Math.round(SOCIAL_WIDTH * 0.58);

  return (
    <div
      style={{
        width: "100vw",
        minHeight: "100vh",
        background: "#0a0907",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
        padding: 0,
        margin: 0,
      }}
    >
      <div
        data-poster-canvas
        style={{
          width: SOCIAL_WIDTH,
          height: SOCIAL_HEIGHT,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          background: "var(--surface-dark)",
          backgroundImage: "url('/concrete.jpeg')",
          backgroundSize: "640px auto",
          backgroundRepeat: "repeat",
          overflow: "hidden",
          fontFamily: "var(--font-mono)",
        }}
      >
        <RoomFrame width={roomWidth} height={SOCIAL_HEIGHT} />
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <CaptionPanel />
        </div>
      </div>
    </div>
  );
}
