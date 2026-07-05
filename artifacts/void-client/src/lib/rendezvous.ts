// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ─────────────────────────────────────────────────────────────────────────────
// Per-epoch rendezvous handles (Task #1024).
//
// The signaling server routes every room on an opaque 32-hex token. Until now
// that token WAS the durable, phrase-derived `roomId` — stable for the life of
// the phrase — so a live operator watching the wire could build a lasting
// `IP ↔ room` map. This module replaces the durable token on the wire with a
// short-lived handle derived from the roomId and the current epoch:
//
//   handle = HKDF-SHA256(IKM = roomId-bytes, salt = epoch, info = "…handle-v1")
//
// The server still sees only an opaque 32-hex token, but now it rotates per
// epoch, so the in-memory view degrades from `IP ↔ stable room` to
// `IP ↔ ephemeral token`. HKDF is one-way: the server (which never holds the
// phrase or the durable roomId) cannot invert a handle back to the durable id.
// ─────────────────────────────────────────────────────────────────────────────

// Epoch length for handle rotation. Chosen ≥ the longest room TTL (the day
// tier is 24h) so an established call never has to rotate its routing handle
// mid-conversation: a live room spans at most ONE epoch boundary, and the
// join window below tolerates that boundary by also probing the neighbouring
// epochs. Rotation therefore only changes which handle *fresh discovery* uses
// across days — never an in-progress call.
export const RENDEZVOUS_EPOCH_MS = 24 * 60 * 60 * 1000;

const HANDLE_INFO = new TextEncoder().encode("VOID-rendezvous-handle-v1");

/** Floor-divide wall-clock time into fixed-width epochs. */
export function currentRendezvousEpoch(now: number = Date.now()): number {
  return Math.floor(now / RENDEZVOUS_EPOCH_MS);
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * Derive the epoch-scoped rendezvous handle from the durable, phrase-derived
 * `roomId` (32 lowercase hex chars). Output is 16 bytes → 32 hex chars, so it
 * is shape-identical to the legacy room code and satisfies the server's
 * `ROOM_CODE_RE` (`/^[0-9a-f]{32}$/`) with no server change.
 */
export async function deriveRendezvousHandle(
  roomId: string,
  epoch: number,
): Promise<string> {
  const ikm = hexToBytes(roomId);
  const salt = new TextEncoder().encode(`VOID-epoch-${epoch}`);
  const key = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: HANDLE_INFO },
    key,
    16 * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

/**
 * The wire room id a HOST registers under via `create-room` — the
 * current-epoch rendezvous handle.
 */
export async function rendezvousCreateCode(
  roomId: string,
  now: number = Date.now(),
): Promise<string> {
  return deriveRendezvousHandle(roomId, currentRendezvousEpoch(now));
}

/**
 * The ordered list of wire room ids a JOINER probes, most-likely first:
 *   1. current epoch          — the overwhelming common case
 *   2. previous epoch         — a (day-tier) room that crossed a 24h boundary
 *   3. next epoch             — tolerates a joiner whose clock leads the host's
 *
 * The caller tries each in order and advances ONLY on `ROOM_NOT_FOUND`; the
 * first candidate that yields any other ack (success or a definitive error
 * such as LOCKED / FULL / KNOCK_PENDING) is the room's frozen handle and is
 * what every peer converges on for the rest of the call.
 */
export async function rendezvousJoinCandidates(
  roomId: string,
  now: number = Date.now(),
): Promise<string[]> {
  const e = currentRendezvousEpoch(now);
  return Promise.all(
    [e, e - 1, e + 1].map((epoch) => deriveRendezvousHandle(roomId, epoch)),
  );
}
