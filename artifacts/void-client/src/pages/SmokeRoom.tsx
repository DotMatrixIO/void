// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";
import RoomPage, { type RoomSnapshotState } from "./RoomPage";
import type { SecureChannelFailures } from "@/lib/webrtc";
import { readCssToken } from "@/lib/cssTokens";

/**
 * SmokeRoom — task #519 layout smoke harness page.
 *
 * Mounts the real `RoomPage` in snapshot mode (no socket, no WebRTC, no
 * media-device prompts) with three forced conditions the layout test
 * pass needs:
 *
 *   1. Four participants (1 local + 3 remote) → 2x2 PeerTileGrid.
 *   2. Every remote peer is in the secure-channel-failure state, so the
 *      RETRY SECURE CHANNEL overlay shows in every one of the four
 *      tiles.
 *   3. The single-line wait-hint bar starts visible so the smoke pass
 *      doesn't have to fake peer-connection states or wait the 20s
 *      hint delay.
 *
 * This route is gated to `import.meta.env.DEV` (see `App.tsx`) so the
 * production bundle never ships it.
 */
const LOCAL_PEER_ID = "peer-3b81";
const REMOTE_PEER_IDS = ["peer-a4f2", "peer-7c13", "peer-9e08"];

function buildSilentStream(): MediaStream {
  // A minimal valid MediaStream is enough — the layout we are
  // measuring does not depend on the actual video content.
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = readCssToken("--surface-dark");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return (canvas as HTMLCanvasElement & {
    captureStream: (fps?: number) => MediaStream;
  }).captureStream(5);
}

export default function SmokeRoom() {
  const [snapshot, setSnapshot] = useState<{
    state: RoomSnapshotState;
    key: CryptoKey;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: MediaStream[] = [];
    (async () => {
      const localStream = buildSilentStream();
      created.push(localStream);
      const remoteStreams: Record<string, MediaStream> = {};
      for (const id of REMOTE_PEER_IDS) {
        const s = buildSilentStream();
        created.push(s);
        remoteStreams[id] = s;
      }
      // Every remote peer is parked in a representative failure so the
      // overlay + RETRY button is rendered in all 4 tiles (the local
      // tile keeps its normal preview).
      const secureChannelFailures: SecureChannelFailures = {};
      for (const id of REMOTE_PEER_IDS) {
        secureChannelFailures[id] = "ice_restart_failed";
      }
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      if (cancelled) return;
      setSnapshot({
        state: {
          peers: REMOTE_PEER_IDS,
          localStream,
          remoteStreams,
          isHost: true,
          hostPresent: true,
          hostPeerId: LOCAL_PEER_ID,
          myPeerId: LOCAL_PEER_ID,
          expiresAtWallClock: Date.now() + 47 * 60_000,
          remainingMs: 47 * 60_000,
          roomTier: "day",
          secureChannelFailures,
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
      <div data-testid="smoke-room-loading" style={{ padding: 24, fontFamily: "monospace" }}>
        loading smoke room…
      </div>
    );
  }

  return (
    <RoomPage
      roomId="SMOKE-519"
      e2eKey={snapshot.key}
      voidPhrase="midnight cobalt fern lantern quartz harbour"
      fromUrl={false}
      snapshotState={snapshot.state}
    />
  );
}
