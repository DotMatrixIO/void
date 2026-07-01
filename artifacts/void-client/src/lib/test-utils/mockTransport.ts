// SPDX-License-Identifier: AGPL-3.0-or-later
// Deterministic socket.io transport mock for degraded-circuit tests
// (Task #748).
//
// This is a reusable primitive — NOT embedded in a single test file —
// so future Tor-related work (signaling backpressure, message-order
// under latency) can drive the same controllable transport. It models
// just enough of the socket.io client surface that `useRoomConnection`
// consumes:
//
//   - `socket.on(event, fn)` / `socket.off(event[, fn])`  (room events)
//   - `socket.emit(event, payload[, ack])`                (with ack delivery)
//   - `socket.io.on("reconnect", fn)` / `socket.io.off(...)` (manager events)
//
// Controllable knobs, all deterministic (no `Math.random`) so the suite
// stays CI-friendly:
//
//   - `latencyMs`               one-way signaling latency; an emit→ack
//                               round-trip therefore takes 2 × latencyMs.
//   - `reconnectionDelayMs`     base reconnect backoff (socket.io default 1000).
//   - `reconnectionDelayMaxMs`  backoff cap (socket.io default 5000).
//   - `failedReconnectAttempts` how many reconnect attempts fail (and burn
//                               a backoff cycle) before one succeeds — the
//                               packet-drop / jitter stand-in.
//
// Abrupt disconnection is `disconnectAbruptly()`; slow reconnect is
// `reconnect()` driving the backoff timeline. Drive the timeline with
// vitest fake timers (`vi.advanceTimersByTimeAsync`).
//
// This is intentionally a unit/integration primitive: per the task it
// must NOT spin up a real Tor instance or SOCKS proxy — real-circuit
// verification is the manual rehearsal gate (#746).

type Handler = (...args: unknown[]) => void;
type AckResponder = (payload: unknown) => unknown;

export interface MockTransportKnobs {
  /** One-way signaling latency in ms. Round-trip ack = 2 × this. */
  latencyMs?: number;
  /** Base reconnect backoff in ms (socket.io `reconnectionDelay`). */
  reconnectionDelayMs?: number;
  /** Reconnect backoff cap in ms (socket.io `reconnectionDelayMax`). */
  reconnectionDelayMaxMs?: number;
  /** Failed reconnect attempts before one succeeds (jitter/drop stand-in). */
  failedReconnectAttempts?: number;
}

export class MockSocketTransport {
  connected = true;

  latencyMs: number;
  reconnectionDelayMs: number;
  reconnectionDelayMaxMs: number;
  failedReconnectAttempts: number;

  /** Every `emit(event, payload)` is recorded here for assertions. */
  readonly emitted: Array<{ event: string; payload: unknown }> = [];

  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly ioHandlers = new Map<string, Set<Handler>>();
  private readonly ackResponders = new Map<string, AckResponder>();

  /** Manager-level (`socket.io`) event surface. */
  readonly io = {
    on: (event: string, fn: Handler) => this.addTo(this.ioHandlers, event, fn),
    off: (event: string, fn?: Handler) =>
      this.removeFrom(this.ioHandlers, event, fn),
  };

  constructor(knobs: MockTransportKnobs = {}) {
    this.latencyMs = knobs.latencyMs ?? 50;
    this.reconnectionDelayMs = knobs.reconnectionDelayMs ?? 1000;
    this.reconnectionDelayMaxMs = knobs.reconnectionDelayMaxMs ?? 5000;
    this.failedReconnectAttempts = knobs.failedReconnectAttempts ?? 0;
  }

  // ─── socket.io client surface consumed by useRoomConnection ──────────

  on(event: string, fn: Handler): this {
    this.addTo(this.handlers, event, fn);
    return this;
  }

  off(event: string, fn?: Handler): this {
    this.removeFrom(this.handlers, event, fn);
    return this;
  }

  emit(event: string, payload?: unknown, ack?: (result: unknown) => void): this {
    this.emitted.push({ event, payload });
    if (typeof ack === "function") {
      const responder = this.ackResponders.get(event);
      const result = responder ? responder(payload) : undefined;
      // Deliver the ack after a full round-trip (out + back).
      setTimeout(() => ack(result), this.latencyMs * 2);
    }
    return this;
  }

  // ─── Test driving helpers ────────────────────────────────────────────

  /** Register the canned ack a given emitted event resolves with. */
  setAckResponder(event: string, responder: AckResponder): this {
    this.ackResponders.set(event, responder);
    return this;
  }

  /** Deliver an inbound server event to every registered socket handler. */
  emitServerEvent(event: string, payload?: unknown): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }

  /** Abrupt disconnection: mark dead and fire the socket `disconnect`. */
  disconnectAbruptly(reason = "transport close"): void {
    this.connected = false;
    const set = this.handlers.get("disconnect");
    if (set) for (const fn of [...set]) fn(reason);
  }

  /**
   * Drive the socket.io reconnection backoff timeline. `failedReconnectAttempts`
   * attempts each burn a (growing, capped) backoff cycle before a final
   * successful attempt fires the manager `reconnect` event. Schedule all
   * timers now; the caller advances fake timers to play them out.
   */
  reconnect(): void {
    let elapsed = 0;
    for (let i = 0; i < this.failedReconnectAttempts; i++) {
      elapsed += this.backoffForAttempt(i);
      const attemptNo = i + 1;
      setTimeout(() => this.fireIo("reconnect_attempt", attemptNo), elapsed);
    }
    elapsed += this.backoffForAttempt(this.failedReconnectAttempts);
    setTimeout(() => {
      this.connected = true;
      this.fireIo("reconnect", this.failedReconnectAttempts + 1);
    }, elapsed);
  }

  /**
   * Wall-clock ms from `reconnect()` being called until the manager
   * `reconnect` event fires (sum of every backoff cycle). Add `latencyMs * 2`
   * for the subsequent `join-room` round-trip to get the full rejoin time.
   */
  timeToReconnectMs(): number {
    let total = 0;
    for (let i = 0; i <= this.failedReconnectAttempts; i++) {
      total += this.backoffForAttempt(i);
    }
    return total;
  }

  /** Full drop→rejoin wall-clock: reconnect backoff + join round-trip. */
  timeToRejoinMs(): number {
    return this.timeToReconnectMs() + this.latencyMs * 2;
  }

  // ─── internals ───────────────────────────────────────────────────────

  private backoffForAttempt(attempt: number): number {
    // Geometric backoff (factor 2) capped at the max — socket.io's model
    // without the random jitter, so tests are deterministic.
    return Math.min(
      this.reconnectionDelayMs * Math.pow(2, attempt),
      this.reconnectionDelayMaxMs,
    );
  }

  private fireIo(event: string, ...args: unknown[]): void {
    const set = this.ioHandlers.get(event);
    if (!set) return;
    for (const fn of [...set]) fn(...args);
  }

  private addTo(map: Map<string, Set<Handler>>, event: string, fn: Handler) {
    const set = map.get(event) ?? new Set<Handler>();
    set.add(fn);
    map.set(event, set);
  }

  private removeFrom(
    map: Map<string, Set<Handler>>,
    event: string,
    fn?: Handler,
  ) {
    if (!fn) {
      map.delete(event);
      return;
    }
    map.get(event)?.delete(fn);
  }
}
