// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useRef, useState } from "react";

// Task #502: extracted from RoomPage. Owns the wall-clock countdown
// state cohort — remainingMs / expiresAtWallClock / roomTier — plus
// the ticking interval that drives the live MM:SS display in the
// header. `startCountdown(expiresAt, serverNow)` applies the server's
// clock offset and (re)starts the per-second tick; `stopCountdown()`
// just clears the interval. Expiry detection is delegated to the
// `onExpired` callback so the teardown coordinator in RoomPage owns
// the actual end-of-room flow.
export interface UseRoomCountdownOptions {
  initialRemainingMs?: number | null;
  initialExpiresAtWallClock?: number | null;
  initialRoomTier?: "standard" | "day" | null;
  onExpired: () => void;
}

export interface UseRoomCountdownApi {
  remainingMs: number | null;
  expiresAtWallClock: number | null;
  roomTier: "standard" | "day" | null;
  setRoomTier: React.Dispatch<
    React.SetStateAction<"standard" | "day" | null>
  >;
  startCountdown: (expiresAt: number, serverNow: number) => void;
  stopCountdown: () => void;
  countdownIntervalRef: React.MutableRefObject<
    ReturnType<typeof setInterval> | null
  >;
}

export function useRoomCountdown({
  initialRemainingMs = null,
  initialExpiresAtWallClock = null,
  initialRoomTier = null,
  onExpired,
}: UseRoomCountdownOptions): UseRoomCountdownApi {
  const [remainingMs, setRemainingMs] = useState<number | null>(
    initialRemainingMs,
  );
  const [expiresAtWallClock, setExpiresAtWallClock] = useState<number | null>(
    initialExpiresAtWallClock,
  );
  const [roomTier, setRoomTier] = useState<"standard" | "day" | null>(
    initialRoomTier,
  );

  const effectiveExpiresAtRef = useRef<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Keep onExpired in a ref so startCountdown's setInterval closure
  // always sees the latest version without forcing re-creates.
  const onExpiredRef = useRef(onExpired);
  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  const stopCountdown = useCallback(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(
    (expiresAt: number, serverNow: number) => {
      const offset = Date.now() - serverNow;
      effectiveExpiresAtRef.current = expiresAt + offset;
      setExpiresAtWallClock(effectiveExpiresAtRef.current);
      setRemainingMs(
        Math.max(0, effectiveExpiresAtRef.current - Date.now()),
      );

      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
      countdownIntervalRef.current = setInterval(() => {
        if (effectiveExpiresAtRef.current === null) return;
        const left = Math.max(0, effectiveExpiresAtRef.current - Date.now());
        setRemainingMs(left);
        if (left <= 0) {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          onExpiredRef.current();
        }
      }, 1000);
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, []);

  return {
    remainingMs,
    expiresAtWallClock,
    roomTier,
    setRoomTier,
    startCountdown,
    stopCountdown,
    countdownIntervalRef,
  };
}
