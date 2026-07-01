// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHmac, randomBytes } from "node:crypto";

// Keyed HMAC of a per-room host RECLAIM TOKEN, used as the on-disk comparison
// form for the room-state snapshot.
//
// The reclaim token is a high-entropy random value minted per paid window by
// `routes/paywall.ts` and carried in the host-authorization JWT alongside the
// server-minted random `jti` (the create-room replay-guard id). It is
// DECOUPLED from the Lightning `paymentHash`: nothing derived from the raw
// payment identifier is ever computed here or written to disk — and as of
// Task #889 the JWT no longer carries the `paymentHash` to the client at all.
// This is the whole point — see below.
//
// Why a decoupled token at all (vs. the previous HMAC-of-paymentHash):
//   Even a keyed HMAC of the `paymentHash` is a deterministic function of the
//   payment identifier. A holder of BOTH the seized `data/rooms.json` snapshot
//   AND `PAYWALL_SECRET` could recompute `HMAC(secret, candidate)` for every
//   candidate `paymentHash` in a Lightning backend's settlement set and match
//   a room code to an invoice. Minting a random reclaim token unrelated to the
//   `paymentHash` removes that correlation entirely: the on-disk value is a
//   function of a random secret, not of any payment identifier, so a snapshot
//   + secret leak reveals nothing about which invoice paid for which room.
//
// Why STILL keyed (not the raw token, not a plain hash):
//   The reclaim token is itself a capability — a holder can reclaim host on
//   the room. Storing the keyed HMAC (not the raw token) means a holder of a
//   PASSIVELY seized snapshot file cannot reclaim host without also holding
//   `PAYWALL_SECRET`. (Do NOT consolidate this with `digestPaymentHash` — they
//   defend different things; see that file.)
//
// Keyed on `PAYWALL_SECRET` deliberately, so the on-disk HMAC inherits the
// EXACT stable-secret precondition that host reclaim already has — it adds no
// new one:
//   - When the operator sets `PAYWALL_SECRET`, this key equals the JWT
//     verification key. The stored HMAC is stable across a restart, so
//     reclaim-on-rejoin works after a restart — which is the only config in
//     which it ever worked.
//   - When `PAYWALL_SECRET` is unset, `routes/paywall.ts` mints an ephemeral
//     JWT secret per process and we likewise key off an ephemeral value here.
//     After a restart the stored JWT already fails verification (its secret
//     was regenerated), so reclaim is already impossible regardless of this
//     snapshot. We therefore lose nothing by keying off an ephemeral value in
//     that config.
//
// Honest scope: this reduces the value of a PASSIVELY seized snapshot file.
// It does not defend against an active operator under compulsion — they hold
// `PAYWALL_SECRET`. But because the reclaim token is decoupled from the
// `paymentHash`, even that operator cannot correlate the snapshot to invoices
// from the snapshot alone (the JWT does still carry the raw `paymentHash` to
// the client — a separate, out-of-scope surface).
//
// Migration is "fail and re-pay": any snapshot written by an older build holds
// a value derived from the `paymentHash` (raw pre-#882, or `HMAC(secret,
// paymentHash)` from #882). Neither equals `hmacReclaimToken(token)` for the
// random token in a freshly minted JWT, so that host simply re-pays once. We
// deliberately do NOT best-effort upconvert old values — they were already on
// disk in a payment-derived form, so re-keying them protects nothing already
// seized.

let hmacKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (hmacKey === null) {
    const env = process.env["PAYWALL_SECRET"];
    const material = env && env.length > 0 ? env : randomBytes(32).toString("hex");
    hmacKey = Buffer.from(material, "utf8");
  }
  return hmacKey;
}

/**
 * Compute `HMAC-SHA256(PAYWALL_SECRET, reclaimToken)` as a lowercase hex
 * string. The output is fixed-length (64 hex chars), which is what makes the
 * `claimHost` timing-safe full-scan comparison genuinely uniform in length.
 */
export function hmacReclaimToken(reclaimToken: string): string {
  return createHmac("sha256", resolveKey()).update(reclaimToken, "utf8").digest("hex");
}

/**
 * Test-only: override the resolved HMAC key (pass a string) or reset it so the
 * next call re-resolves from the environment / ephemeral default (pass null).
 * Used to exercise the rotated-secret negative path in the persistence tests.
 */
export function __setHostHashHmacKeyForTest(key: string | null): void {
  hmacKey = key === null ? null : Buffer.from(key, "utf8");
}
