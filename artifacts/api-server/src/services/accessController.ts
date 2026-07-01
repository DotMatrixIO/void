// SPDX-License-Identifier: AGPL-3.0-or-later
// Paid-access gating service for the signaling layer (Task #447 step 3).
//
// Owns:
//   - paywall JWT verification for create-room, extend-room, and the
//     optional host-claim token on join-room
//   - replay-guard maps for both consumed creation tokens and consumed
//     extension tokens, with periodic sweep wiring
//   - cap-rejection log throttling
//
// The socket layer NEVER calls `jwt.verify` directly — every paywall
// decision flows through the typed helpers below. This keeps the auth
// policy (algorithm pinning, tier downgrade for
// legacy "week" JWTs, one-payment-one-room rule) in one place where it
// can be reasoned about and tested in isolation.

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { markSecret, type Secret } from "@workspace/wire-core";
import { PAYWALL_SECRET } from "../routes/paywall";
import type { RoomTier } from "../rooms";

// ── Cap-rejection log throttle ───────────────────────────────────────────

// Task #286: rate-limit cap-rejection log lines. Without this, an attacker
// driving the global cap to its ceiling could spam the operator's log at
// the create-room rate. One WARN per cap type per minute is enough signal
// for an operator to notice the cap firing without becoming the attack
// surface itself. The numeric counters in `getCapRejectionCounters()` are
// the source of truth for "how many"; this log is purely a "something is
// happening" nudge.
const CAP_LOG_INTERVAL_MS = 60_000;
const lastCapLogAt: Record<"ROOM_CAP_REACHED", number> = {
  ROOM_CAP_REACHED: 0,
};

export function logCapRejection(error: "ROOM_CAP_REACHED"): void {
  const now = Date.now();
  if (now - lastCapLogAt[error] < CAP_LOG_INTERVAL_MS) return;
  lastCapLogAt[error] = now;
  console.warn(`[rooms] capacity cap fired: ${error}`);
}

// Test-only: zero the per-cap "last logged at" timestamps so each test
// starts from a clean slate. Without this, the first test in the file
// burns the suppression window for the whole run.
export function __resetCapRejectionLogForTest(): void {
  lastCapLogAt.ROOM_CAP_REACHED = 0;
}

// ── Consumed-token replay maps ───────────────────────────────────────────

// Tracks the SHA-256 hash of every paywall JWT that has already been spent on
// a room extension, mapped to the JWT's own `exp` (ms epoch). Prevents a host
// from replaying one paid invoice to extend the same (or a different) room
// repeatedly. Pruned opportunistically when an extend-room event fires.
export const consumedExtensionTokens = new Map<string, number>();

export function sweepConsumedExtensionTokens(now: number = Date.now()): void {
  for (const [hash, expMs] of consumedExtensionTokens) {
    if (now >= expMs) consumedExtensionTokens.delete(hash);
  }
}

export function hashExtensionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Mirror of `consumedExtensionTokens` for the room-CREATION path. Keyed by
// the server-minted random `jti` (carried in the JWT payload by /paywall/status
// and /paywall/recover), mapped to the JWT's own `exp` (ms epoch). The `jti`
// replaced the Lightning `paymentHash` as the replay key so nothing
// payment-derived ever reaches the client (the JWT lives in browser
// `sessionStorage`); the guard's behavior is unchanged. Without this, the JWT
// minted for a single settled invoice is replayable for the entire tier window
// — the per-socket create-room rate limit (10/min) lets one paid invoice mint
// up to ~600 standard rooms or ~14,400 day rooms, which breaks the documented
// "one payment = one room" model and is also the largest paid-vector
// memory-exhaustion path against the rooms map.
// Pruned opportunistically when a create-room event fires.
export const consumedRoomCreationTokens = new Map<string, number>();

export function sweepConsumedRoomCreationTokens(now: number = Date.now()): void {
  for (const [hash, expMs] of consumedRoomCreationTokens) {
    if (now >= expMs) consumedRoomCreationTokens.delete(hash);
  }
}

// Sweep cadence: 60s. Worst-case overshoot is one full sweep
// interval past the token's TTL. Acceptable because TTL is
// bounded by JWT exp (60min standard, 24h day tier).
const CONSUMED_TOKEN_SWEEP_INTERVAL_MS = 60_000;
let sweepInterval: ReturnType<typeof setInterval> | null = null;

/** Start the periodic consumed-token map eviction sweep. Idempotent — calling
 *  twice does not stack timers. Without this, both `consumedExtensionTokens`
 *  and `consumedRoomCreationTokens` would grow monotonically with every
 *  consumed JWT until the process restarts. */
export function startConsumedTokenSweep(): void {
  if (sweepInterval !== null) return;
  sweepInterval = setInterval(() => {
    sweepConsumedExtensionTokens();
    sweepConsumedRoomCreationTokens();
  }, CONSUMED_TOKEN_SWEEP_INTERVAL_MS);
  // Don't keep the Node event loop alive solely for this housekeeping timer
  // — graceful shutdown should still let the process exit.
  if (typeof sweepInterval === "object" && sweepInterval !== null && "unref" in sweepInterval) {
    (sweepInterval as { unref: () => void }).unref();
  }
}

/** Stop the consumed-token sweep timer. Used by graceful shutdown handlers
 *  and by tests to avoid leaking timers across vitest worker boundaries. */
export function stopConsumedTokenSweep(): void {
  if (sweepInterval !== null) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

// ── Paywall JWT verification ─────────────────────────────────────────────

/** Resolve the paywall HMAC secret used to verify every paywall JWT.
 *  Tests pass an explicit secret via `registerSocketHandlers({ paywallSecret })`;
 *  production calls fall back to the module-level `PAYWALL_SECRET`. The raw
 *  `string` branch is re-branded so every downstream `jwt.verify` site
 *  receives a `Secret<string>`. The custom ESLint rule `no-secret-equality`
 *  follows the brand to flag accidental `==` / `===` on the secret value. */
export function resolvePaywallSecret(override?: Secret<string> | string): Secret<string> {
  return override !== undefined ? markSecret(override) : PAYWALL_SECRET;
}

function isTier(value: unknown): value is RoomTier {
  return value === "standard" || value === "day";
}

export type CreationTokenError =
  | "PAYMENT_REQUIRED"
  | "TOKEN_ALREADY_USED";

export interface VerifiedCreationToken {
  tier: RoomTier;
  jwtExpMs: number | null;
  jti: string;
  // Per-room random reclaim token, decoupled from the replay-guard `jti`. Used
  // to seed the room's host-reclaim set (stored as a keyed HMAC, never on disk
  // in raw or payment-derived form). May be null for tokens minted by an older
  // build that predate the claim — such a room is created but offers no host
  // reclaim (the host re-pays to reclaim), the same "fail and re-pay" migration
  // the on-disk set already had.
  reclaimToken: string | null;
}

/** Verify a `create-room` JWT.
 *
 * Returns the tier, JWT `exp` (ms), and `jti` on success. Returns
 * `PAYMENT_REQUIRED` if the token is invalid, unauthorized, or lacks a
 * `jti` (the latter is required so the one-payment-one-room replay guard
 * has a key to remember).
 *
 * Returns `TOKEN_ALREADY_USED` when the token's `jti` was already spent on
 * a room — protects against the per-socket create-room rate limit being
 * multiplied across rooms by replaying one paid invoice's JWT.
 *
 * `algorithms: ["HS256"]` pins the verifier so a future change to the
 * secret type (or a library default change) cannot accidentally accept
 * asymmetric algorithms or `alg: none`. The paywall only ever mints
 * HS256, so this is a behavior-preserving lock.
 */
export function verifyCreationToken(
  token: string,
  secret: Secret<string>,
  now: number = Date.now(),
): { ok: true; value: VerifiedCreationToken } | { ok: false; error: CreationTokenError } {
  let tier: RoomTier = "standard";
  let jwtExpMs: number | null = null;
  let jti: string | null = null;
  let reclaimToken: string | null = null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
      authorized?: boolean;
      tier?: unknown;
      exp?: number;
      jti?: unknown;
      reclaimToken?: unknown;
    };
    if (!decoded.authorized) return { ok: false, error: "PAYMENT_REQUIRED" };
    if (isTier(decoded.tier)) {
      tier = decoded.tier;
    } else if (decoded.tier === "week") {
      // Legacy "week" JWT issued before Task #115 capped paid rooms at 24h.
      // Cap at the new ceiling instead of silently downgrading to standard (65m).
      tier = "day";
    }
    if (typeof decoded.exp === "number" && Number.isFinite(decoded.exp)) {
      jwtExpMs = decoded.exp * 1000;
    }
    if (typeof decoded.jti === "string" && decoded.jti.length > 0) {
      jti = decoded.jti;
    }
    if (typeof decoded.reclaimToken === "string" && decoded.reclaimToken.length > 0) {
      reclaimToken = decoded.reclaimToken;
    }
  } catch {
    return { ok: false, error: "PAYMENT_REQUIRED" };
  }

  sweepConsumedRoomCreationTokens(now);
  // Tokens minted before this claim was added (in-flight at deploy time)
  // lack `jti`; reject those too rather than letting them bypass the cap —
  // `PAYWALL_SECRET` is regenerated on restart by default, so any pre-deploy
  // token is already invalid in practice, and operators who pin the secret
  // can simply re-pay. The replay guard is keyed on the server-minted random
  // `jti` (one settled invoice → one room); the `reclaimToken` is a separate,
  // on-disk-safe capability and is intentionally NOT the replay key.
  if (!jti) return { ok: false, error: "PAYMENT_REQUIRED" };
  if (consumedRoomCreationTokens.has(jti)) {
    return { ok: false, error: "TOKEN_ALREADY_USED" };
  }
  return { ok: true, value: { tier, jwtExpMs, jti, reclaimToken } };
}

/** Mark a creation token spent. Stored against the JWT's own `exp` so the
 *  entry self-prunes once the token would have expired anyway. Keyed by the
 *  token's server-minted random `jti`. */
export function recordConsumedCreationToken(jti: string, expMs: number): void {
  consumedRoomCreationTokens.set(jti, expMs);
}

export type ExtensionTokenError =
  | "PAYMENT_REQUIRED"
  | "TOKEN_ALREADY_USED";

export interface VerifiedExtensionToken {
  tier: RoomTier;
  tokenExpMs: number;
  // Per-room random reclaim token from the extension JWT, decoupled from any
  // payment identifier. Added to the room's host-reclaim set so a host who paid
  // for an extension can reclaim host using the extension JWT. May be null on a
  // token minted by an older build (extension still succeeds; no new reclaim
  // capability is granted).
  reclaimToken: string | null;
  tokenHash: string;
}

/** Verify an `extend-room` JWT.
 *
 * Extension is a paid-tier-only flow — free/legacy tokens with no tier
 * claim cannot be used to extend, hence the `PAYMENT_REQUIRED` fall-
 * through when `tier` is absent. The token hash (SHA-256 of the raw JWT)
 * is returned so the caller can mark the token consumed after the room
 * write succeeds — keying the replay map by JWT hash (rather than by
 * `paymentHash`) lets a single invoice mint sequential extensions only
 * if /paywall re-issues distinct JWTs for them. */
export function verifyExtensionToken(
  token: string,
  secret: Secret<string>,
  now: number = Date.now(),
): { ok: true; value: VerifiedExtensionToken } | { ok: false; error: ExtensionTokenError } {
  let tier: RoomTier;
  let tokenExpMs: number;
  let reclaimToken: string | null = null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
      authorized?: boolean;
      tier?: unknown;
      exp?: number;
      reclaimToken?: unknown;
    };
    if (!decoded.authorized) return { ok: false, error: "PAYMENT_REQUIRED" };
    if (isTier(decoded.tier)) {
      tier = decoded.tier;
    } else if (decoded.tier === "week") {
      // Legacy "week" JWT (pre-Task #115) — treat as the day cap.
      tier = "day";
    } else {
      // Free/legacy tokens with no tier claim cannot be used to extend
      // — extension is a paid-tier-only flow.
      return { ok: false, error: "PAYMENT_REQUIRED" };
    }
    tokenExpMs = (decoded.exp ?? 0) * 1000;
    if (typeof decoded.reclaimToken === "string" && decoded.reclaimToken.length > 0) {
      reclaimToken = decoded.reclaimToken;
    }
  } catch {
    return { ok: false, error: "PAYMENT_REQUIRED" };
  }

  sweepConsumedExtensionTokens(now);
  const tokenHash = hashExtensionToken(token);
  if (consumedExtensionTokens.has(tokenHash)) {
    return { ok: false, error: "TOKEN_ALREADY_USED" };
  }
  return { ok: true, value: { tier, tokenExpMs, reclaimToken, tokenHash } };
}

/** Mark an extension token spent. Falls back to a forward-looking expiry
 *  if the JWT didn't carry an `exp` (defensive — paywall always issues one). */
export function recordConsumedExtensionToken(tokenHash: string, expMs: number): void {
  consumedExtensionTokens.set(tokenHash, expMs);
}

/** Optional host-claim token check used by the `join-room` path. Returns
 *  the `reclaimToken` from the JWT if it verifies and carries one;
 *  otherwise null. Invalid/expired tokens — and valid tokens minted by an
 *  older build that carry no `reclaimToken` — are SILENT: a non-paying
 *  phrase-holder (or a pre-migration host) simply doesn't get host, no
 *  client-visible error. The actual host promotion (and the room-side
 *  `hostReclaimTokenHashes` set check) is delegated to `claimHost` in
 *  rooms/registry.ts. The `reclaimToken` is decoupled from `paymentHash`,
 *  so this path never touches a payment identifier. */
export function extractJoinClaimReclaimToken(
  token: string | undefined,
  secret: Secret<string>,
): string | null {
  if (typeof token !== "string" || token.length === 0) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as {
      authorized?: boolean;
      reclaimToken?: unknown;
    };
    if (!decoded.authorized) return null;
    if (typeof decoded.reclaimToken !== "string" || decoded.reclaimToken.length === 0) return null;
    return decoded.reclaimToken;
  } catch {
    return null;
  }
}
