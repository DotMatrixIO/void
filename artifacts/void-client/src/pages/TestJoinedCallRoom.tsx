// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import RoomPage, { type RoomSnapshotState } from "./RoomPage";
import { readCssToken } from "@/lib/cssTokens";

/**
 * Task #587 — DEV-only test route.
 *
 * Mounts the real `RoomPage` in a joined-call state with mocked local
 * media tracks (synthetic video + silent audio) and one mocked peer,
 * so the Playwright real-viewport layout gate
 * (`tests/playwright/control-bar-layout.spec.ts`) can drive the
 * production component without:
 *   • the Lightning paywall,
 *   • JWT minting / create-room,
 *   • camera + mic permission prompts,
 *   • the WebRTC handshake.
 *
 * Gated behind `import.meta.env.DEV` in `App.tsx` exactly like the
 * `/still/:variant` and `/__smoke/room` routes, so the production
 * bundle never ships it. The gating is verified by
 * `tests/playwright/control-bar-layout.spec.ts` (route reachable in
 * dev only) and by grep-ing the production build during PR review.
 *
 * Host role, full mode (not Focus), all shipped chrome present.
 */
const LOCAL_PEER_ID = "peer-587a";
const REMOTE_PEER_ID = "peer-587b";

function buildSyntheticVideoTrack(): MediaStreamTrack {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = readCssToken("--surface-dark");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const stream = (canvas as HTMLCanvasElement & {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(5);
  return stream.getVideoTracks()[0]!;
}

function buildSilentAudioTrack(): MediaStreamTrack {
  // OscillatorNode at zero gain — a valid live audio track with no
  // audible output. The layout gate does not depend on audio content,
  // but we want a real audio track so the call truly looks "joined".
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  return dest.stream.getAudioTracks()[0]!;
}

function buildLocalStream(): MediaStream {
  const stream = new MediaStream();
  stream.addTrack(buildSyntheticVideoTrack());
  try {
    stream.addTrack(buildSilentAudioTrack());
  } catch {
    /* AudioContext may be unavailable in some headless contexts;
       video-only is still a valid joined-call state for the layout
       gate. */
  }
  return stream;
}

function buildRemoteStream(): MediaStream {
  // Remote tile renders the peer's incoming stream as a normal video
  // element; a synthetic capture stream is indistinguishable from a
  // real remote track for layout purposes.
  const stream = new MediaStream();
  stream.addTrack(buildSyntheticVideoTrack());
  return stream;
}

export default function TestJoinedCallRoom() {
  const [snapshot, setSnapshot] = useState<{
    state: RoomSnapshotState;
    key: CryptoKey;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: MediaStream[] = [];
    (async () => {
      const localStream = buildLocalStream();
      created.push(localStream);
      const remoteStream = buildRemoteStream();
      created.push(remoteStream);
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      if (cancelled) return;
      setSnapshot({
        state: {
          peers: [REMOTE_PEER_ID],
          localStream,
          remoteStreams: { [REMOTE_PEER_ID]: remoteStream },
          peerMediaState: {
            [REMOTE_PEER_ID]: { camOff: false, micMuted: false },
          },
          isHost: true,
          hostPresent: true,
          hostPeerId: LOCAL_PEER_ID,
          myPeerId: LOCAL_PEER_ID,
          expiresAtWallClock: Date.now() + 47 * 60_000,
          remainingMs: 47 * 60_000,
          roomTier: "day",
        },
        key,
      });
    })();
    return () => {
      cancelled = true;
      for (const s of created) {
        try {
          s.getTracks().forEach((t) => t.stop());
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  if (!snapshot) {
    return (
      <div
        data-testid="test-joined-call-loading"
        style={{ padding: 24, fontFamily: "monospace" }}
      >
        loading test joined-call…
      </div>
    );
  }

  return (
    <RoomPage
      roomId="TEST-587"
      e2eKey={snapshot.key}
      voidPhrase="midnight cobalt fern lantern quartz harbour"
      fromUrl={false}
      snapshotState={snapshot.state}
    />
  );
}
