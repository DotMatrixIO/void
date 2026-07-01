// SPDX-License-Identifier: AGPL-3.0-or-later
// Relay-flip handshake (Task #450, Directive 1).
//
// Replaces the original `setTimeout(..., 250)` band-aid in
// RoomPage's `room-relay-mode-enabled` handler with a deterministic
// two-phase handshake. Both phases ride the existing `relay-signal`
// socket event — the server forwards them opaquely without any new
// handler (Task #450 Directive 3 forbids touching the API server).
//
// Why plaintext envelopes:
//   The server already knows when a flip happens — it broadcast
//   `room-relay-mode-enabled` moments earlier. The handshake payload
//   is `{ type, flipId }`: it carries no SDP, no candidate IPs, no
//   crypto material. Encrypting it would force one of two things, both
//   of which violate this task's scope:
//
//     (a) Encrypt with the room's phrase key → webrtc.ts's relay-signal
//         handler decrypts it, sees `payload.type !== "key-exchange"`,
//         and hard-fails the per-peer secure channel with
//         `ecdhe_failed`/`decrypt_failed` (see webrtc.ts lines 789, 818).
//         The handshake itself would tear down every peer it tried to
//         coordinate with — exactly the failure mode we're trying to fix.
//
//     (b) Encrypt with the per-pair session key → requires webrtc.ts to
//         expose `peerSessionKeys` publicly. Task #450 Directive 3
//         forbids modifying webrtc.ts in this task.
//
//   Plaintext envelopes pass the `else` branch of webrtc.ts's
//   relay-signal handler (line 826) — payload.type doesn't match any
//   known case, the type switch falls through, the handler returns
//   without touching peer state.
//
// Why per-peer (not broadcast):
//   The server's `relay-signal` forwarder is addressed (toPeerId is
//   required and validated). We emit one envelope per peer; the per-ack
//   collector below correlates by sender peerId, not by broadcast id.

import type { Socket } from "socket.io-client";

export const RELAY_FLIP_PENDING = "relay-flip-pending" as const;
export const RELAY_FLIP_ACK = "relay-flip-ack" as const;

/** Default fallback deadline: enough headroom that the previous 250 ms
 * band-aid's worst-case race is comfortably absorbed, while staying
 * short enough that a missing-ack peer still triggers the reinit in
 * under three seconds (well inside the user-perceptible "flipping…"
 * window). */
export const RELAY_FLIP_FALLBACK_MS = 2000;

export interface RelayFlipEnvelope {
  type: typeof RELAY_FLIP_PENDING | typeof RELAY_FLIP_ACK;
  flipId: string;
}

interface RelaySignalInbound {
  fromPeerId: string;
  payload: unknown;
}

interface RelaySignalOutbound {
  code: string;
  toPeerId: string;
  fromPeerId: string;
  payload: RelayFlipEnvelope;
}

export interface HandshakeArgs {
  socket: Pick<Socket, "emit" | "on" | "off">;
  code: string;
  myPeerId: string;
  /** Every other peer currently in the room. The handshake completes
   *  when every one of these has acked OR the fallback deadline fires. */
  otherPeers: string[];
  /** Override for tests; defaults to RELAY_FLIP_FALLBACK_MS. */
  fallbackMs?: number;
  /** Override for tests; defaults to Math.random()-based id. */
  flipIdOverride?: string;
  /** Override for tests; defaults to global setTimeout/clearTimeout. */
  scheduler?: {
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  };
}

export interface HandshakeResult {
  flipId: string;
  /** Peers that acked before the deadline. */
  acked: string[];
  /** Peers that did NOT ack before the deadline (handshake still
   *  resolves — fallback semantics preserve the previous "best-effort"
   *  behavior). */
  missing: string[];
  /** True iff every peer acked before the fallback fired. */
  completedCleanly: boolean;
}

/** Run a two-phase relay-flip handshake. Resolves once every peer in
 *  `otherPeers` has acked OR the fallback deadline elapses, whichever
 *  is first. Never rejects — relay-flip is a best-effort cooperation
 *  signal, not a hard ordering primitive. */
export function runRelayFlipHandshake(args: HandshakeArgs): Promise<HandshakeResult> {
  const {
    socket,
    code,
    myPeerId,
    otherPeers,
    fallbackMs = RELAY_FLIP_FALLBACK_MS,
    flipIdOverride,
    scheduler = { setTimeout, clearTimeout },
  } = args;

  const flipId = flipIdOverride ?? generateFlipId();

  // Empty peer set → resolve synchronously on the next tick. Saves a
  // wasted fallback timer when the user is alone in the room.
  if (otherPeers.length === 0) {
    return Promise.resolve({
      flipId,
      acked: [],
      missing: [],
      completedCleanly: true,
    });
  }

  return new Promise<HandshakeResult>((resolve) => {
    const pending = new Set<string>(otherPeers);
    const acked: string[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onRelaySignal(inbound: RelaySignalInbound) {
      const env = inbound?.payload;
      if (!isRelayFlipEnvelope(env)) return;
      if (env.type !== RELAY_FLIP_ACK) return;
      if (env.flipId !== flipId) return;
      if (!pending.has(inbound.fromPeerId)) return;

      pending.delete(inbound.fromPeerId);
      acked.push(inbound.fromPeerId);
      if (pending.size === 0) finish(true);
    }

    function finish(cleanly: boolean) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) scheduler.clearTimeout(timer);
      socket.off("relay-signal", onRelaySignal);
      resolve({
        flipId,
        acked: [...acked],
        missing: Array.from(pending),
        completedCleanly: cleanly && pending.size === 0,
      });
    }

    socket.on("relay-signal", onRelaySignal);

    // Send the pending envelope to every other peer. If a peer dropped
    // between the room-relay-mode-enabled broadcast and now, the server
    // silently drops the forward — the fallback deadline still resolves.
    for (const toPeerId of otherPeers) {
      const out: RelaySignalOutbound = {
        code,
        toPeerId,
        fromPeerId: myPeerId,
        payload: { type: RELAY_FLIP_PENDING, flipId },
      };
      socket.emit("relay-signal", out);
    }

    timer = scheduler.setTimeout(() => finish(false), fallbackMs);
  });
}

/** Send a `relay-flip-ack` in response to an inbound `relay-flip-pending`.
 *  Caller side (the peer that received the pending) drives this — it lets
 *  the host wait deterministically for "every peer has acknowledged the
 *  upcoming PC tear-down" before issuing fresh offers. */
export function sendRelayFlipAck(args: {
  socket: Pick<Socket, "emit">;
  code: string;
  myPeerId: string;
  toPeerId: string;
  flipId: string;
}): void {
  const out: RelaySignalOutbound = {
    code: args.code,
    toPeerId: args.toPeerId,
    fromPeerId: args.myPeerId,
    payload: { type: RELAY_FLIP_ACK, flipId: args.flipId },
  };
  args.socket.emit("relay-signal", out);
}

export function isRelayFlipEnvelope(value: unknown): value is RelayFlipEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.type === RELAY_FLIP_PENDING || v.type === RELAY_FLIP_ACK) &&
    typeof v.flipId === "string" &&
    v.flipId.length > 0
  );
}

function generateFlipId(): string {
  // 64 bits of randomness is enough — flipIds only need to be unique
  // within a single in-flight handshake per room. Collisions across
  // rooms or across non-overlapping flips have zero effect.
  const buf = new Uint8Array(8);
  // Audit I-03 (Task #461): the prior Math.random fallback was dead code on
  // every supported runtime (the rest of the app — AES-GCM, ECDHE, IV
  // generation — cannot run without WebCrypto). Throw explicitly instead so
  // a future regression in environment detection cannot silently degrade
  // flipId randomness to a non-CSPRNG path.
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("CSPRNG_UNAVAILABLE");
  }
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
