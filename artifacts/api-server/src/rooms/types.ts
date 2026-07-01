// SPDX-License-Identifier: AGPL-3.0-or-later
// Server-side capacity cap per room (Task #286 — server-side
// enforcement of the documented mesh ceiling). The client also
// enforces this via the join button, but the cap is the contract — a
// hand-crafted socket client bypasses any client-side check, so
// `joinRoom` rejects with `ROOM_FULL` once the room reaches this
// count. Four is the product-defined ceiling for human rooms (small
// enough that mesh WebRTC stays viable without an SFU). Do not
// introduce per-tier or per-roomType variants without revisiting the
// mesh-fanout math in `webrtc.ts`. (Indexed in
// docs/code-quirks-index.md.)
export const MAX_USERS = 4;

export type RoomType = "human";
export type RoomTier = "standard" | "day";

export interface RoomUser {
  socketId: string;
  peerId: string;
}

export interface PendingKnock {
  socketId: string;
  peerId: string;
  knockedAt: number;
}

export interface ScreenShareReservation {
  peerId: string;
  socketId: string;
  expiresAt: number;
  // Per-grant idempotency nonce (Task #303). Returned on the
  // `request-screen-share` ack and echoed in the `screen-share-granted`
  // event so the client can dedup a duplicate ack (retransmit / out-of-
  // order delivery) and avoid promoting the same grant twice into a
  // double-booked presenter slot.
  nonce: string;
}

export interface RoomState {
  users: RoomUser[];
  hostSocketId: string | null;
  // Set of KEYED HMACs — `HMAC(PAYWALL_SECRET, reclaimToken)` — of the
  // per-room RECLAIM TOKENS that may claim host on rejoin. The reclaim token is
  // a high-entropy random value minted per paid window by the paywall and is
  // DECOUPLED from the Lightning `paymentHash`: nothing payment-derived is held
  // here or persisted, so a snapshot + secret leak cannot correlate a room to
  // an invoice. Seeded with the creator's reclaim token at create-room time and
  // grown on every paid extension (Task #171, finding M-02 in the 2026-04
  // audit). The set lets a host who refreshed/reconnected reclaim host using
  // EITHER the original creation JWT or any subsequent extension JWT — both
  // carry a valid `reclaimToken` claim and either is sufficient proof that this
  // socket belongs to the original payer. The set is persisted verbatim to
  // `data/rooms.json` and compared HMAC-to-HMAC in `claimHost`.
  hostReclaimTokenHashes: Set<string>;
  locked: boolean;
  lockedBy: string | null;
  knockMode: boolean;
  knockModeBy: string | null;
  pendingKnocks: PendingKnock[];
  relayOnly: boolean;
  roomType: RoomType;
  tier: RoomTier;
  createdAt: number;
  expiresAt: number;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  activeScreenSharePeerId: string | null;
  screenShareReservation: ScreenShareReservation | null;
  screenShareReservationTimer: ReturnType<typeof setTimeout> | null;
}

export const ROOM_TTL_MS = 65 * 60 * 1000;
export const ROOM_TTL_DAY_MS = 24 * 60 * 60 * 1000;
export const ROOM_TTL_MIN_MS = 60 * 1000;
export const ROOM_TTL_MAX_MS = ROOM_TTL_DAY_MS;
// 30s sweep (Task #56). Each room also has its own per-room expiry
// `setTimeout` scheduled in `createRoom` / `extendRoomExpiry` that fires
// precisely at `expiresAt`, so the typical broadcast latency is sub-second.
// This sweep exists as a safety net for the corner cases where the per-room
// timer drifts or fails to fire — chiefly long timers across system
// suspend/resume, or any future bug that loses a room's `expiryTimer`
// reference. At 30s the worst-case server-side broadcast lag drops from
// ~5 minutes to ~30 seconds while the periodic work remains negligible
// (one Map iteration per 30s, no I/O, no broadcast unless a room actually
// crossed expiresAt and still has connected peers).
export const GC_INTERVAL_MS = 30 * 1000;

// Note: there is intentionally no "empty room prune" timer. The host paid
// for the room to exist for its full TTL (standard or day); the room exists
// for that window whether or not anyone is currently connected. Hard
// cleanup is handled by the per-room expiry timer plus the periodic GC
// sweep below. This lets a host who refreshes mid-call, or steps away for
// a few minutes, return and rejoin via the phrase URL without paying again.

export const ROOM_TTLS = {
  standard: ROOM_TTL_MS,
  day: ROOM_TTL_DAY_MS,
} as const;

// Task #286: hard cap on the total number of concurrent rooms. Generous
// enough that it only bites under attack — a server hitting 10k live rooms
// is already an outlier — but ensures the `rooms` Map cannot grow without
// bound under a paid-creation flood (the per-paymentHash replay guard
// prevents one invoice minting many rooms, but a botnet with many invoices
// would still be unbounded otherwise).
export const MAX_TOTAL_ROOMS_DEFAULT = 10_000;

export type RoomCapacityRejection = "ROOM_CAP_REACHED";

export interface GcSweepCounters {
  totalSweeps: number;
  totalEvicted: number;
  lastSweepEvicted: number;
  maxSweepEvicted: number;
  lastSweepAt: number;
}

// Identity-free snapshot for GET /api/room-state/:code. No peer ids,
// IPs, socket ids, void phrase, SAS, or room type.
export interface RoomStateSnapshot {
  exists: true;
  tier: RoomTier;
  expiresAt: number;
  participantCount: number;
  relayOnly: boolean;
}

export const SCREEN_SHARE_RESERVATION_TTL_MS = 12_000;
