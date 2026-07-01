// SPDX-License-Identifier: AGPL-3.0-or-later
// Reconnect-budget single source of truth (Task #748).
//
// A "reconnect budget" is the wall-clock SLA we hold the
// signaling/reconnection path to: from the moment the socket drops to
// the moment the client has re-emitted `join-room` and processed the
// ack (rejoined the room), the round trip must complete within this
// many milliseconds — otherwise, on a slow/jittery Tor circuit, a
// dropped socket silently strands the user in a half-dead call.
//
// The budget is **origin-aware** and deliberately reuses the same
// onion-detection utility (`isOnionOrigin`) that drives
// `initialIceTransportPolicy()` in `origin.ts`. That single source of
// truth is what already decides "this user is on Tor, pin relay-only";
// the same signal selects the right reconnect SLA so the two decisions
// can never drift apart.
//
// Why two numbers (and not one flat 30s)?
//
//   - CLEARNET (8 s). socket.io's reconnection backoff starts at
//     `reconnectionDelay` (1 s) and grows geometrically, capped at
//     `reconnectionDelayMax` (5 s) — see `socket.ts`. A clearnet
//     signaling round-trip is sub-second. So even a reconnect that
//     eats one capped 5 s backoff cycle plus a join round-trip lands
//     well under 8 s. Holding clearnet to 8 s means a clearnet user
//     is NOT made to wait the full Tor budget for a reconnect that
//     should take ~2 s; a regression that makes clearnet reconnection
//     sluggish fails the gate loudly instead of hiding behind the
//     generous onion number.
//
//   - ONION (30 s). A Tor circuit that has degraded or torn down must
//     be *rebuilt* before signaling can flow again — empirically ~5–15 s
//     for fresh circuit establishment — and every signaling round-trip
//     on top of that is multi-second and jittery. 30 s covers circuit
//     re-establishment (worst-case ~15 s) plus a couple of high-latency
//     join round-trips with margin, so a genuinely slow circuit does
//     NOT trip a false-positive "reconnect failed". This is the
//     task's recommended default.
//
// These numbers are pinned here, asserted against in
// `useRoomConnection.reconnect.test.tsx`, and their derivation is
// documented in `docs/tor-reconnect-notes.md`. Changing either value
// should be accompanied by an update to that note's rationale.
import { isOnionOrigin } from "./origin";

/** Reconnect SLA for a clearnet origin. See module header for derivation. */
export const CLEARNET_RECONNECT_BUDGET_MS = 8_000;

/** Reconnect SLA for a Tor `.onion` origin. See module header for derivation. */
export const ONION_RECONNECT_BUDGET_MS = 30_000;

/**
 * The reconnect budget (ms) that applies to the current origin. Returns
 * the longer onion budget when the page was loaded over a `.onion`
 * hostname (a slow circuit must not trip a false-positive failure) and
 * the shorter clearnet budget otherwise (a clearnet user should not wait
 * the full Tor budget for a reconnect that should take ~2 s).
 */
export function reconnectBudgetMs(): number {
  return isOnionOrigin()
    ? ONION_RECONNECT_BUDGET_MS
    : CLEARNET_RECONNECT_BUDGET_MS;
}
