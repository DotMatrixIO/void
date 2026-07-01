// SPDX-License-Identifier: AGPL-3.0-or-later
import { argon2id } from "hash-wasm";

/**
 * Canonical argon2id parameters for room-key derivation.
 *
 * These values are the single source of truth. The browser and the
 * Node API server both import this constant — there is no path where one
 * surface uses different parameters than another.
 *
 * Tuning rationale (see docs/security-audit-public-2026-04.md §1.1):
 *   - Memory hardness (m) is the load-bearing defense against well-funded
 *     attackers with GPU/ASIC budgets. Iteration count (t) is secondary.
 *   - m = 64 MiB sits at the conservative end of the allowed 64-128 MiB
 *     range and matches the RFC 9106 second recommendation.
 *   - t = 3 lands derivation near the ~1-second target on a 2019-era
 *     Android (measured indirectly; see migration notes in §1.1).
 *   - p = 1 keeps a single derivation thread, which matches the WebCrypto
 *     execution model and avoids surprising worker-pool behavior in the
 *     browser.
 *   - hashLength = 48 bytes: 16 bytes for the room ID + 32 bytes for the
 *     AES-256 key, matching the previous PBKDF2 layout exactly so
 *     downstream split logic does not need to change.
 *
 * If you need to change these values, you must:
 *   1. Re-derive any hardcoded argon2id expected vectors in tests that pin
 *      this derivation, and re-run the void-client test suite.
 *   2. Re-document the tuning rationale and any new measurement evidence in
 *      docs/security-audit-public-2026-04.md §1.1.
 *
 * Do not introduce a flag, fallback, or version-negotiation path that lets
 * a peer unilaterally downgrade to PBKDF2 or to weaker argon2id parameters.
 */
export const ARGON2ID_ROOM_PARAMS = {
  memorySize: 65_536,
  iterations: 3,
  parallelism: 1,
  hashLength: 48,
} as const;

/**
 * Fixed 32-byte salt for room-key derivation.
 *
 * Per the audit (§1.1), a per-room salt is structurally impossible — the
 * phrase is the only shared secret between participants who never reveal
 * an identity to the server. A per-room salt would have to be either
 * derived from the phrase itself (no extra entropy) or negotiated server-
 * side (defeats the model). The fixed salt is intentional, not an
 * oversight.
 *
 * The byte values here match the salt that was used by the prior PBKDF2
 * derivation. Reused verbatim because there is no security benefit to
 * rotating it — the salt is public regardless.
 */
export const ROOM_DERIVATION_SALT = new Uint8Array([
  0xd3, 0x4a, 0x7f, 0x1c, 0xe8, 0x92, 0x0b, 0x56,
  0xa1, 0x3d, 0xf7, 0x68, 0xc4, 0x05, 0xbe, 0x9a,
  0x72, 0xe6, 0x1b, 0x83, 0x5f, 0xd0, 0x47, 0xac,
  0x39, 0x8e, 0xf4, 0x2d, 0xb6, 0x01, 0xca, 0x75,
]);

/**
 * Derive raw bytes from a normalized phrase using argon2id with the
 * canonical room-derivation parameters and salt.
 *
 * Returns ARGON2ID_ROOM_PARAMS.hashLength bytes (currently 48).
 *
 * This is the single canonical derivation primitive. The browser client
 * (artifacts/void-client/src/lib/voidPhrase.ts) is its consumer; the API
 * server never derives room credentials, it only sees the already-derived
 * hex room ID.
 */
export async function deriveRoomBytesArgon2id(
  normalizedPhrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const out = await argon2id({
    password: normalizedPhrase,
    salt: ROOM_DERIVATION_SALT,
    iterations: ARGON2ID_ROOM_PARAMS.iterations,
    parallelism: ARGON2ID_ROOM_PARAMS.parallelism,
    memorySize: ARGON2ID_ROOM_PARAMS.memorySize,
    hashLength: ARGON2ID_ROOM_PARAMS.hashLength,
    outputType: "binary",
  });
  // hash-wasm returns Uint8Array<ArrayBufferLike>; copy into a fresh
  // ArrayBuffer-backed Uint8Array so callers can pass it (or slices of it)
  // directly to WebCrypto APIs that require BufferSource (i.e.
  // Uint8Array<ArrayBuffer>).
  const copy = new Uint8Array(out.byteLength);
  copy.set(out);
  return copy;
}
