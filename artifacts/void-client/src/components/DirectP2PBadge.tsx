// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PeerConnectionStates } from "@/lib/webrtc";

// Shows when at least one peer is connected and relayOnly is off.
// Click opens the DevTools walkthrough.

interface Props {
  peerConnectionStates: PeerConnectionStates;
  relayOnly: boolean;
  onOpenWalkthrough: () => void;
}

export function shouldShowDirectP2PBadge(
  peerConnectionStates: PeerConnectionStates,
  relayOnly: boolean,
): boolean {
  if (relayOnly) return false;
  return Object.values(peerConnectionStates).some((s) => s === "connected");
}

export default function DirectP2PBadge({
  peerConnectionStates,
  relayOnly,
  onOpenWalkthrough,
}: Props) {
  if (!shouldShowDirectP2PBadge(peerConnectionStates, relayOnly)) return null;
  return (
    <>
      <span style={{ opacity: 0.5 }}>·</span>
      <button
        type="button"
        data-testid="direct-p2p-badge"
        onClick={onOpenWalkthrough}
        title="Click to verify direct P2P in DevTools"
        style={{
          background: "transparent",
          border: "1px solid #fff",
          color: "#fff",
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          fontWeight: 700,
          letterSpacing: "2px",
          padding: "1px 6px",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        DIRECT P2P
      </button>
    </>
  );
}
