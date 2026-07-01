// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Leading + trailing throttle for the shared DROP slot.
 *
 * A hostile peer (or a buggy/automated client) can rewrite the 2 KB DROP
 * slot at data-channel speed. Each write triggers a React state update and
 * a border-pulse on every receiver — at channel speed that is a UI-thrash
 * / annoyance-DoS. This caps the per-sender update rate WITHOUT ever losing
 * the final value of a burst:
 *
 *   - LEADING edge: the first update after a quiet period renders at once,
 *     so a single normal edit feels instant.
 *   - TRAILING edge: every update inside the rate window is coalesced and
 *     the LAST value pushed is emitted when the window closes. A flood
 *     therefore never strands the receiver on a dropped-final stale value —
 *     the slot always converges on whatever was sent last.
 *
 * This is a naive-drop-excess replacement: we do NOT simply discard updates
 * that arrive too fast (that can drop the final, authoritative value); we
 * coalesce them and guarantee the tail lands.
 *
 * The same primitive throttles the OUTBOUND send path so this client cannot
 * itself become the heckler if its UI submits faster than the cap.
 *
 * Sanitization and the 2 KB / 4 KB size caps are unaffected — they run
 * before/around this layer (see `dropSanitize.ts` and `webrtc.ts`).
 */

/** Minimum wall-clock gap between rendered DROP updates from one sender. */
export const DROP_MIN_UPDATE_INTERVAL_MS = 150;

export interface ThrottleClock {
  now(): number;
  setTimer(fn: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(handle: ReturnType<typeof setTimeout>): void;
}

const defaultClock: ThrottleClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
};

export interface LeadingTrailingThrottle {
  /** Offer a value. May emit synchronously (leading) or schedule a
   *  trailing emit; the latest value offered in a window always wins. */
  push(value: string): void;
  /** Drop any pending trailing emit and reset. Used on teardown so a
   *  scheduled emit cannot fire after the peer/manager is gone. */
  cancel(): void;
}

/**
 * Build a leading+trailing throttle around `emit`. `intervalMs` is the
 * minimum gap between emits; `clock` is injectable for deterministic tests.
 */
export function createDropThrottle(
  emit: (value: string) => void,
  intervalMs: number = DROP_MIN_UPDATE_INTERVAL_MS,
  clock: ThrottleClock = defaultClock,
): LeadingTrailingThrottle {
  let lastEmit = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  let hasPending = false;

  const fire = (value: string) => {
    lastEmit = clock.now();
    emit(value);
  };

  const flushTrailing = () => {
    timer = null;
    if (!hasPending) return;
    const value = pending as string;
    hasPending = false;
    pending = null;
    fire(value);
  };

  return {
    push(value: string) {
      const elapsed = clock.now() - lastEmit;
      if (timer === null && elapsed >= intervalMs) {
        // Leading edge — first update in a quiet period renders at once.
        fire(value);
        return;
      }
      // Inside the rate window: coalesce. The LAST value pushed in a burst
      // is the one the trailing timer emits, so a flood never strands the
      // receiver on a dropped-final stale value.
      pending = value;
      hasPending = true;
      if (timer === null) {
        const wait = Math.max(0, intervalMs - elapsed);
        timer = clock.setTimer(flushTrailing, wait);
      }
    },
    cancel() {
      if (timer !== null) {
        clock.clearTimer(timer);
        timer = null;
      }
      hasPending = false;
      pending = null;
    },
  };
}
