// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";
import { uiBleep } from "@/lib/uiSounds";
import { deriveExpiryState, type ExpiryWarningPhase } from "@/lib/ExpiryStateMachine";

// Task #502: extracted from RoomPage. Owns the host "wrap it up"
// toast state machine: the phase (idle / shown / snoozed / urgent /
// dismissed), the per-window snooze and urgent-refire latches, and
// the audible cue at the urgent threshold. The phase derivation is
// the pure `deriveExpiryState` module; this hook just runs the side
// effects each time the inputs (`isHost`, `remainingMs`, `roomTier`)
// change.
//
// `resetForNewWindow()` is called by the host-extend and guest
// room-extended paths so the new window re-arms the warning machine.
export interface UseExpiryWarningOptions {
  isHost: boolean;
  remainingMs: number | null;
  roomTier: "standard" | "day" | null;
}

export interface UseExpiryWarningApi {
  expiryWarningPhase: ExpiryWarningPhase;
  expiryWarningSnoozeUsed: boolean;
  dismissExpiryWarning: () => void;
  snoozeExpiryWarning: () => void;
  resetForNewWindow: () => void;
}

export function useExpiryWarning({
  isHost,
  remainingMs,
  roomTier,
}: UseExpiryWarningOptions): UseExpiryWarningApi {
  const [expiryWarningPhase, setExpiryWarningPhase] =
    useState<ExpiryWarningPhase>("idle");
  const expiryWarningPhaseRef = useRef<ExpiryWarningPhase>("idle");
  expiryWarningPhaseRef.current = expiryWarningPhase;
  const [expiryWarningSnoozeUsed, setExpiryWarningSnoozeUsed] = useState(false);
  const expiryWarningSnoozeUsedRef = useRef(false);
  const snoozedAtRemainingMsRef = useRef<number | null>(null);
  // Task #121: guaranteed urgent-threshold re-fire latch — fires once
  // per window even if the host already dismissed/snoozed the lead
  // warning. Reset by `resetForNewWindow()` on extension.
  const expiryUrgentFiredRef = useRef(false);

  useEffect(() => {
    const { nextPhase, fireUrgent } = deriveExpiryState({
      isHost,
      remainingMs,
      tier: roomTier,
      phase: expiryWarningPhaseRef.current,
      snoozedAtRemainingMs: snoozedAtRemainingMsRef.current,
      urgentAlreadyFired: expiryUrgentFiredRef.current,
    });
    if (fireUrgent) {
      expiryUrgentFiredRef.current = true;
      // The urgent re-fire is the host's last-chance warning and must
      // not be snoozed away again — clear the snooze button by marking
      // the snooze as used.
      expiryWarningSnoozeUsedRef.current = true;
      setExpiryWarningSnoozeUsed(true);
      // Task #213: a host with the VOID tab in the background won't see
      // the visual toast until it's too late. Fire one audible cue at
      // the same moment the last-chance toast appears (one-shot per
      // window because deriveExpiryState gates this on
      // urgentAlreadyFired).
      uiBleep();
    }
    if (nextPhase !== expiryWarningPhaseRef.current) {
      setExpiryWarningPhase(nextPhase);
    }
  }, [isHost, remainingMs, roomTier]);

  const dismissExpiryWarning = useCallback(() => {
    setExpiryWarningPhase("dismissed");
  }, []);

  const snoozeExpiryWarning = useCallback(() => {
    if (expiryWarningSnoozeUsedRef.current) return;
    expiryWarningSnoozeUsedRef.current = true;
    setExpiryWarningSnoozeUsed(true);
    snoozedAtRemainingMsRef.current = remainingMs;
    setExpiryWarningPhase("snoozed");
  }, [remainingMs]);

  const resetForNewWindow = useCallback(() => {
    setExpiryWarningPhase("idle");
    expiryWarningSnoozeUsedRef.current = false;
    setExpiryWarningSnoozeUsed(false);
    snoozedAtRemainingMsRef.current = null;
    // Task #121: re-arm the guaranteed urgent re-fire on the new
    // window so a host who extends won't miss the next end-of-room
    // warning either.
    expiryUrgentFiredRef.current = false;
  }, []);

  return {
    expiryWarningPhase,
    expiryWarningSnoozeUsed,
    dismissExpiryWarning,
    snoozeExpiryWarning,
    resetForNewWindow,
  };
}
