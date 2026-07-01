// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-peer "relay-pinned" probe extracted from webrtc.ts during the
// Refactor 2 decomposition (task #448).
//
// `isPeerRelayPinned` is the same module-level helper that
// `webrtc.relayPinned.test.ts` already imports — re-exported through
// webrtc.ts so existing consumers see no change.
//
// `runRelayProbe` is the per-tick body of the relay-status probe
// interval. The orchestrator owns the `setInterval` handle and the
// circuit-breaker counter; this module just does the work and
// reports whether the published map changed.

export type PeerRelayStatuses = Record<string, boolean>;

export const RELAY_STATUS_PROBE_INTERVAL_MS = 3000;

/**
 * Maximum number of consecutive probe failures (uncaught throws or
 * rejections from `runRelayProbe`) the orchestrator tolerates before
 * the probe circuit-breaks. Five ticks at 3s = 15s of continuous
 * failure before the interval is shut down — long enough to ride out
 * transient `getStats` hiccups, short enough that a genuinely broken
 * probe doesn't spam the console for the lifetime of the call.
 */
export const RELAY_PROBE_FAILURE_THRESHOLD = 5;

/**
 * Inspect a peer connection's currently selected candidate pair and
 * decide whether the only transport in use is a TURN relay (i.e. both
 * the local and remote candidates are of type "relay"). Pulled out as a
 * module-level helper so it can be unit-tested directly without standing
 * up a full WebRTCManager.
 */
export async function isPeerRelayPinned(pc: RTCPeerConnection): Promise<boolean> {
  let stats: RTCStatsReport;
  try {
    stats = await pc.getStats();
  } catch {
    return false;
  }
  let selectedPair: { localCandidateId?: string; remoteCandidateId?: string } | null = null;
  const setSelectedPair = (p: { localCandidateId?: string; remoteCandidateId?: string }) => {
    selectedPair = p;
  };
  const candidates = new Map<string, { candidateType?: string }>();
  stats.forEach((report: { type?: string; nominated?: boolean; selected?: boolean; state?: string; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string; id?: string }) => {
    if (report.type === "candidate-pair") {
      // Prefer a pair that is explicitly the in-use one. Browsers vary:
      // some set `nominated: true` + `state: "succeeded"`, others expose
      // `selected: true`. Either is sufficient evidence that this pair is
      // the live one.
      const isLive =
        (report.state === "succeeded" && report.nominated === true) ||
        report.selected === true;
      if (isLive) {
        setSelectedPair({
          localCandidateId: report.localCandidateId,
          remoteCandidateId: report.remoteCandidateId,
        });
      }
    } else if (
      report.type === "local-candidate" ||
      report.type === "remote-candidate"
    ) {
      if (report.id) {
        candidates.set(report.id, { candidateType: report.candidateType });
      }
    }
  });
  const pair = selectedPair as { localCandidateId?: string; remoteCandidateId?: string } | null;
  if (!pair) return false;
  const local = pair.localCandidateId
    ? candidates.get(pair.localCandidateId)
    : undefined;
  const remote = pair.remoteCandidateId
    ? candidates.get(pair.remoteCandidateId)
    : undefined;
  if (!local || !remote) return false;
  return local.candidateType === "relay" && remote.candidateType === "relay";
}

export interface RelayProbeContext {
  /** Live per-peer pc map. */
  peers: Map<string, { pc: RTCPeerConnection }>;
  /** Published per-peer relay-pinned state. Mutated in place. */
  peerRelayPinned: Map<string, boolean>;
}

/**
 * Single-tick body of the relay-status probe. Walks every connected
 * peer's selected candidate pair, updates `peerRelayPinned` in place,
 * and returns whether anything changed so the orchestrator can decide
 * to republish. Throws propagate to the caller — the orchestrator's
 * try/catch handles the circuit-breaker accounting.
 */
export async function runRelayProbe(ctx: RelayProbeContext): Promise<{ changed: boolean }> {
  let changed = false;
  const seen = new Set<string>();
  for (const [peerId, entry] of ctx.peers) {
    seen.add(peerId);
    if (entry.pc.connectionState !== "connected") {
      if (ctx.peerRelayPinned.has(peerId)) {
        ctx.peerRelayPinned.delete(peerId);
        changed = true;
      }
      continue;
    }
    let pinned = false;
    try {
      pinned = await isPeerRelayPinned(entry.pc);
    } catch {
      pinned = false;
    }
    const prev = ctx.peerRelayPinned.get(peerId);
    if (prev !== pinned) {
      ctx.peerRelayPinned.set(peerId, pinned);
      changed = true;
    }
  }
  for (const peerId of Array.from(ctx.peerRelayPinned.keys())) {
    if (!seen.has(peerId)) {
      ctx.peerRelayPinned.delete(peerId);
      changed = true;
    }
  }
  return { changed };
}
