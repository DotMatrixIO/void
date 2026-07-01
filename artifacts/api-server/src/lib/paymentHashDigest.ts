// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";

/**
 * Produce a short, non-reversible triage digest of a Lightning `paymentHash`
 * for operator logs.
 *
 * This is DELIBERATELY a plain (unkeyed) SHA-256 prefix, NOT a keyed HMAC.
 * The goal here is narrow: give an operator just enough to line up separate
 * log lines that refer to the same payment within one log corpus, while never
 * writing the raw 64-hex `paymentHash` — the same identifier that appears in
 * Lightning settlement records — to disk. The property we want is
 * non-reversibility (you cannot recover the `paymentHash` from the digest
 * alone). This is NOT correlation-resistance: because the hash is unkeyed, a
 * party who already holds a set of candidate payment hashes (e.g. a Lightning
 * backend's settlement records) can hash each candidate and match the prefix.
 * Defeating that holder is out of scope for this digest — see the contrast
 * with the keyed snapshot HMAC below.
 *
 * Contrast with the on-disk `hostReclaimTokenHashes` snapshot, which uses a
 * *keyed* HMAC(PAYWALL_SECRET, reclaimToken) of a per-room RECLAIM TOKEN that
 * is decoupled from the `paymentHash` entirely (Task #886): there nothing
 * payment-derived is stored, so even a holder of BOTH the snapshot file and the
 * secret cannot correlate it against Lightning records. Do NOT "consolidate"
 * these two into one primitive — they defend different things (triage digest
 * here vs. file-holder non-correlatability there).
 */
export function digestPaymentHash(paymentHash: string): string {
  return createHash("sha256").update(paymentHash).digest("hex").slice(0, 12);
}
