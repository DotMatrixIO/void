// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import type { PeerConnectionStates } from "@/lib/webrtc";

// Task #502: extracted from RoomPage. Owns the "still waiting for a
// peer to connect" hint shown after WAIT_HINT_DELAY_MS of an empty
// room or once a peer connection has flipped to "failed". Encapsulates
// the per-cycle bookkeeping (whether any peer connected this cycle,
// whether the hint already fired this cycle) so RoomPage only deals in
// `startWaitHintCycle()` / `dismissWaitHint()` calls and a single
// boolean.
//
// Task #597: the hint now also reports *why* it fired via
// `waitHintCause` so RoomPage can pick copy per cause:
//   - "signaling": the signaling socket dropped (highest priority — if
//     we cannot reach the signaling server nothing else matters).
//   - "failed": a peer connection flipped to "failed" (likely a relay /
//     NAT problem — surfaced before the timeout).
//   - "timeout": nobody joined within delayMs.
export type WaitHintCause = "timeout" | "failed" | "signaling" | null;

export interface UseWaitHintApi {
  showWaitHint: boolean;
  waitHintCause: WaitHintCause;
  startWaitHintCycle: () => void;
  dismissWaitHint: () => void;
}

export interface UseWaitHintOptions {
  peerConnectionStates: PeerConnectionStates;
  delayMs?: number;
  /**
   * Task #597: when defined and false, the signaling socket is
   * considered disconnected and the hint fires immediately with cause
   * "signaling" (takes priority over the timeout / peer-failed paths).
   * Left undefined by callers that do not track socket state so the
   * legacy behaviour is preserved.
   */
  signalingConnected?: boolean;
  /**
   * Optional initial value for the visible/dismissed wait-hint state.
   * Used by the snapshot/smoke harness (see `SmokeRoom.tsx`, task #519)
   * so the layout pass can render the real wait-hint bar without
   * having to wait the 20s delay or fake a peer-failed state.
   */
  initialShow?: boolean;
  /**
   * Optional initial cause to pair with `initialShow` for the smoke
   * harness so it can render the real per-cause copy.
   */
  initialCause?: WaitHintCause;
}

export function useWaitHint({
  peerConnectionStates,
  delayMs = 20_000,
  signalingConnected,
  initialShow = false,
  initialCause = null,
}: UseWaitHintOptions): UseWaitHintApi {
  const [showWaitHint, setShowWaitHint] = useState(initialShow);
  const [waitHintCause, setWaitHintCause] = useState<WaitHintCause>(
    initialShow ? (initialCause ?? "timeout") : initialCause,
  );
  const peerConnectedThisCycleRef = useRef(false);
  const waitHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitHintFiredThisCycleRef = useRef(false);

  const startWaitHintCycle = useCallback(() => {
    if (waitHintTimerRef.current) clearTimeout(waitHintTimerRef.current);
    peerConnectedThisCycleRef.current = false;
    waitHintFiredThisCycleRef.current = false;
    setShowWaitHint(false);
    setWaitHintCause(null);
    waitHintTimerRef.current = setTimeout(() => {
      waitHintTimerRef.current = null;
      if (!peerConnectedThisCycleRef.current) {
        waitHintFiredThisCycleRef.current = true;
        setWaitHintCause("timeout");
        setShowWaitHint(true);
      }
    }, delayMs);
  }, [delayMs]);

  const dismissWaitHint = useCallback(() => {
    setShowWaitHint(false);
    waitHintFiredThisCycleRef.current = true;
    if (waitHintTimerRef.current) {
      clearTimeout(waitHintTimerRef.current);
      waitHintTimerRef.current = null;
    }
  }, []);

  // Task #597: signaling-loss takes priority. If the socket is known to
  // be disconnected, fire (or update) the hint with cause "signaling"
  // regardless of the timeout / peer-failed bookkeeping. This is the one
  // path that can override an already-fired cause this cycle because it
  // is strictly more important to surface.
  useEffect(() => {
    if (signalingConnected === false && !peerConnectedThisCycleRef.current) {
      if (waitHintTimerRef.current) {
        clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      waitHintFiredThisCycleRef.current = true;
      setWaitHintCause("signaling");
      setShowWaitHint(true);
    }
  }, [signalingConnected]);

  useEffect(() => {
    const states = Object.values(peerConnectionStates);
    const anyConnected = states.some((s) => s === "connected");
    if (anyConnected) {
      peerConnectedThisCycleRef.current = true;
      if (waitHintTimerRef.current) {
        clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setShowWaitHint(false);
      setWaitHintCause(null);
      return;
    }
    if (peerConnectedThisCycleRef.current) return;
    // Signaling-loss owns the hint while the socket is down; don't let
    // the peer-failed path overwrite that more-important cause.
    if (signalingConnected === false) return;
    if (waitHintFiredThisCycleRef.current) return;
    const anyFailed = states.some((s) => s === "failed");
    if (anyFailed) {
      waitHintFiredThisCycleRef.current = true;
      if (waitHintTimerRef.current) {
        clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
      setWaitHintCause("failed");
      setShowWaitHint(true);
    }
  }, [peerConnectionStates, signalingConnected]);

  useEffect(() => {
    return () => {
      if (waitHintTimerRef.current) {
        clearTimeout(waitHintTimerRef.current);
        waitHintTimerRef.current = null;
      }
    };
  }, []);

  return { showWaitHint, waitHintCause, startWaitHintCycle, dismissWaitHint };
}
