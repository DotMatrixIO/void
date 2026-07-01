// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import type { Socket } from "socket.io-client";
import {
  runRelayFlipHandshake,
  sendRelayFlipAck,
  isRelayFlipEnvelope,
  RELAY_FLIP_PENDING,
  RELAY_FLIP_ACK,
  RELAY_FLIP_FALLBACK_MS,
} from "../relayFlipHandshake";

interface EmittedRelaySignal {
  code: string;
  toPeerId: string;
  fromPeerId: string;
  payload: { type: string; flipId: string };
}

type MockRelaySocket = Pick<Socket, "emit" | "on" | "off"> & {
  emitted: EmittedRelaySignal[];
  deliver(event: string, arg: unknown): void;
  activeListenerCount(event: string): number;
};

type MockScheduler = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  fire(): void;
  readonly pendingMs: number | null;
};

function makeSocket(): MockRelaySocket {
  const listeners = new Map<string, Array<(arg: unknown) => void>>();
  const emitted: EmittedRelaySignal[] = [];
  return {
    emitted,
    on(event: string, handler: (arg: unknown) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    off(event: string, handler: (arg: unknown) => void) {
      const list = listeners.get(event);
      if (!list) return;
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    },
    emit(event: string, arg: unknown) {
      if (event === "relay-signal") emitted.push(arg as EmittedRelaySignal);
    },
    // Test helper: deliver a relay-signal "from the wire" to all
    // listeners (mirrors what socket.io would do when the server
    // forwards another peer's emit).
    deliver(event: string, arg: unknown) {
      const list = listeners.get(event) ?? [];
      for (const h of [...list]) h(arg);
    },
    activeListenerCount(event: string) {
      return listeners.get(event)?.length ?? 0;
    },
  } as unknown as MockRelaySocket;
}

function makeScheduler(): MockScheduler {
  let pending: { cb: () => void; ms: number } | null = null;
  return {
    setTimeout(cb: () => void, ms: number) {
      pending = { cb, ms };
      return Symbol("handle");
    },
    clearTimeout(_handle: unknown) {
      pending = null;
    },
    fire() {
      const p = pending;
      pending = null;
      if (p) p.cb();
    },
    get pendingMs() {
      return pending?.ms ?? null;
    },
  } as unknown as MockScheduler;
}

describe("relayFlipHandshake", () => {
  it("isRelayFlipEnvelope accepts well-formed envelopes and rejects others", () => {
    expect(isRelayFlipEnvelope({ type: RELAY_FLIP_PENDING, flipId: "abc" })).toBe(true);
    expect(isRelayFlipEnvelope({ type: RELAY_FLIP_ACK, flipId: "abc" })).toBe(true);
    expect(isRelayFlipEnvelope({ type: "offer", flipId: "abc" })).toBe(false);
    expect(isRelayFlipEnvelope({ type: RELAY_FLIP_PENDING })).toBe(false);
    expect(isRelayFlipEnvelope(null)).toBe(false);
    expect(isRelayFlipEnvelope("string")).toBe(false);
    expect(isRelayFlipEnvelope({ type: RELAY_FLIP_PENDING, flipId: "" })).toBe(false);
  });

  it("resolves synchronously when there are no other peers", async () => {
    const socket = makeSocket();
    const result = await runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: [],
    });
    expect(result.acked).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.completedCleanly).toBe(true);
    expect(socket.emitted).toHaveLength(0);
    // No listener should be left attached.
    expect(socket.activeListenerCount("relay-signal")).toBe(0);
  });

  it("happy path: every peer acks → resolves cleanly without firing fallback", async () => {
    const socket = makeSocket();
    const scheduler = makeScheduler();

    const promise = runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: ["peer-bbb", "peer-ccc"],
      flipIdOverride: "flip-1",
      scheduler,
    });

    // Two relay-flip-pending envelopes should have been emitted, one
    // per peer.
    expect(socket.emitted).toHaveLength(2);
    for (const out of socket.emitted) {
      expect(out.code).toBe("ROOM-A");
      expect(out.fromPeerId).toBe("peer-aaa");
      expect(out.payload).toEqual({ type: RELAY_FLIP_PENDING, flipId: "flip-1" });
    }
    expect(socket.emitted.map((e) => e.toPeerId).sort()).toEqual(["peer-bbb", "peer-ccc"]);

    // Fallback timer should have been scheduled with the right deadline.
    expect(scheduler.pendingMs).toBe(RELAY_FLIP_FALLBACK_MS);

    // Both peers ack.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-1" },
    });
    socket.deliver("relay-signal", {
      fromPeerId: "peer-ccc",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-1" },
    });

    const result = await promise;
    expect(result.completedCleanly).toBe(true);
    expect(result.acked.sort()).toEqual(["peer-bbb", "peer-ccc"]);
    expect(result.missing).toEqual([]);
    // Fallback should have been cancelled and listener detached.
    expect(scheduler.pendingMs).toBe(null);
    expect(socket.activeListenerCount("relay-signal")).toBe(0);
  });

  it("timeout path: one peer never acks → fallback fires, handshake resolves with missing peer", async () => {
    const socket = makeSocket();
    const scheduler = makeScheduler();

    const promise = runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: ["peer-bbb", "peer-ccc"],
      flipIdOverride: "flip-2",
      scheduler,
    });

    // Only peer-bbb acks.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-2" },
    });

    // Fire the fallback deadline.
    scheduler.fire();

    const result = await promise;
    expect(result.completedCleanly).toBe(false);
    expect(result.acked).toEqual(["peer-bbb"]);
    expect(result.missing).toEqual(["peer-ccc"]);
    expect(socket.activeListenerCount("relay-signal")).toBe(0);
  });

  it("ignores acks for a different flipId (e.g. stale ack from a previous flip)", async () => {
    const socket = makeSocket();
    const scheduler = makeScheduler();

    const promise = runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: ["peer-bbb"],
      flipIdOverride: "flip-current",
      scheduler,
    });

    // Stale ack from a prior flip.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-previous" },
    });
    // Non-flip payload (e.g. an actual WebRTC offer) — must be ignored
    // without affecting the handshake.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: "offer", sdp: { type: "offer", sdp: "" } },
    });

    // The correct ack now arrives.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-current" },
    });

    const result = await promise;
    expect(result.completedCleanly).toBe(true);
    expect(result.acked).toEqual(["peer-bbb"]);
  });

  it("ignores acks from peers we did not include in otherPeers", async () => {
    const socket = makeSocket();
    const scheduler = makeScheduler();

    const promise = runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: ["peer-bbb"],
      flipIdOverride: "flip-3",
      scheduler,
    });

    // Spoofed ack from a peer we didn't address.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-zzz",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-3" },
    });
    // Real ack from the legitimate peer.
    socket.deliver("relay-signal", {
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-3" },
    });

    const result = await promise;
    expect(result.acked).toEqual(["peer-bbb"]);
    expect(result.missing).toEqual([]);
  });

  it("sendRelayFlipAck emits a correctly-shaped envelope", () => {
    const socket = makeSocket();
    sendRelayFlipAck({
      socket,
      code: "ROOM-B",
      myPeerId: "peer-bbb",
      toPeerId: "peer-aaa",
      flipId: "flip-xyz",
    });
    expect(socket.emitted).toHaveLength(1);
    expect(socket.emitted[0]).toEqual({
      code: "ROOM-B",
      toPeerId: "peer-aaa",
      fromPeerId: "peer-bbb",
      payload: { type: RELAY_FLIP_ACK, flipId: "flip-xyz" },
    });
  });

  it("uses fallbackMs override when provided", () => {
    const socket = makeSocket();
    const scheduler = makeScheduler();
    void runRelayFlipHandshake({
      socket,
      code: "ROOM-A",
      myPeerId: "peer-aaa",
      otherPeers: ["peer-bbb"],
      flipIdOverride: "flip-4",
      fallbackMs: 50,
      scheduler,
    });
    expect(scheduler.pendingMs).toBe(50);
  });

  it("vitest fake timers still cleanly handles unsubscription on resolution", async () => {
    // Belt-and-braces: ensure the real setTimeout default also works
    // end-to-end without our scheduler shim.
    vi.useFakeTimers();
    try {
      const socket = makeSocket();
      const promise = runRelayFlipHandshake({
        socket,
        code: "ROOM-A",
        myPeerId: "peer-aaa",
        otherPeers: ["peer-bbb"],
        flipIdOverride: "flip-5",
        fallbackMs: 100,
      });
      socket.deliver("relay-signal", {
        fromPeerId: "peer-bbb",
        payload: { type: RELAY_FLIP_ACK, flipId: "flip-5" },
      });
      const result = await promise;
      expect(result.completedCleanly).toBe(true);
      expect(socket.activeListenerCount("relay-signal")).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
