// SPDX-License-Identifier: AGPL-3.0-or-later
import { asBufferSource } from "./bufferSource";
import { base64urlDecode, base64urlEncode } from "./signalCrypto";

// ─────────────────────────────────────────────────────────────────────────────
// Persistent host-claim credential storage (Task #191).
//
// Task #171 stashed the host's reclaim token in `sessionStorage`, which is
// wiped the moment the browser tab closes. That broke a real user case: a
// host on a 24-hour day-tier room who restarts their browser, switches
// devices, or whose tab crashes loses host on rejoin even though they paid
// for the full 24-hour window. The audit's "the JWT itself is the secret"
// mitigation only covers in-session reconnects, not cross-session continuity.
//
// This module holds the same JWT in `localStorage` so it survives a tab
// close, but with three privacy-preserving constraints:
//
//   1. The JWT is encrypted at rest using a key derived from the room
//      phrase. Without the phrase, an attacker reading localStorage cannot
//      recover the JWT body — and therefore cannot recover the embedded
//      `paymentHash`, `tier`, or `authorized` claim. This satisfies the
//      "no plaintext payment metadata" requirement.
//
//   2. The localStorage key is derived from the room phrase too (a
//      separate HKDF output, so it can't be inverted to the e2eKey or
//      roomId). This binds the credential to the phrase: room A's
//      persisted entry cannot be lifted from disk and used to claim host
//      on room B, because the lookup would never find it without phrase B.
//      An attacker without the phrase also cannot enumerate which rooms
//      the user has paid for — the storage tags look like random hex.
//
//   3. Entries carry a plaintext stored-at timestamp prefix so we can GC
//      stale entries without trying to decrypt them. The timestamp is the
//      only metadata in plaintext and it is not payment-identifying — it
//      reveals only "this browser wrote some host token at time T", which
//      is no worse than what a network observer already learns from the
//      paywall HTTP timing.
//
// Maximum tier window is 24 hours (day tier), so anything older than
// 24h + 5 min grace is guaranteed to be unusable and gets pruned. This
// bounds storage growth across many rooms over time.
//
// Encryption is HKDF-from-phrase (not argon2id) because the threat is
// only forensic disk access by someone who does NOT have the phrase. A
// holder of the phrase already has full access to the room and could mint
// their own paid token — the JWT body is not a secret from them.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "void.hk.";
const HKDF_INFO_TAG = new TextEncoder().encode("VOID-HOST-TOKEN-TAG-v1");
const HKDF_INFO_KEY = new TextEncoder().encode("VOID-HOST-TOKEN-KEY-v1");
const HKDF_SALT = new Uint8Array(32);
const TAG_BYTES = 16;
const IV_BYTES = 12;
const MAX_AGE_MS = 24 * 60 * 60 * 1000 + 5 * 60 * 1000;

interface DerivedSlot {
  storageKey: string;
  encKey: CryptoKey;
}

/** Normalize a phrase the same way `deriveFromPhrase` does in voidPhrase.ts
 *  so a user typing "Ability  About\n…" reaches the same slot as one typing
 *  "ability about …". The phrase is the entire identity here; minor
 *  whitespace/casing differences must not strand a paid host. */
function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function deriveSlot(phrase: string): Promise<DerivedSlot> {
  const ikm = new TextEncoder().encode(normalizePhrase(phrase));
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(ikm),
    "HKDF",
    false,
    ["deriveBits", "deriveKey"],
  );

  const tagBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO_TAG },
    hkdfKey,
    TAG_BYTES * 8,
  );
  const storageKey = STORAGE_PREFIX + bytesToHex(new Uint8Array(tagBits));

  const encKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO_KEY },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { storageKey, encKey };
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Sweep entries we wrote whose stored-at timestamp is older than the max
 *  possible paid window. We deliberately do NOT attempt to decrypt — the
 *  timestamp prefix is plaintext exactly so this cleanup is cheap and works
 *  across all of our entries (we can't decrypt any phrase but the one we
 *  hold for the current call). Run opportunistically on persist/load. */
function gcStaleEntries(storage: Storage, now: number): void {
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
    const value = storage.getItem(key);
    if (!value) {
      toRemove.push(key);
      continue;
    }
    const dot = value.indexOf(".");
    if (dot <= 0) {
      // Malformed (no timestamp prefix) — purge so we don't accumulate junk.
      toRemove.push(key);
      continue;
    }
    const storedAt = Number(value.slice(0, dot));
    if (!Number.isFinite(storedAt) || now - storedAt > MAX_AGE_MS) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    try { storage.removeItem(key); } catch { /* ignore */ }
  }
}

/** Encrypt and persist the host-claim JWT under a phrase-derived slot.
 *  Silently no-ops on any failure (storage quota, missing crypto, etc.) —
 *  losing persistence is recoverable (the user can pay the recovery code
 *  flow), but throwing here would interrupt the create-room / extend-room
 *  happy path. */
export async function persistHostToken(phrase: string, token: string): Promise<void> {
  const storage = getLocalStorage();
  if (!storage) return;
  if (!phrase || !token) return;
  try {
    gcStaleEntries(storage, Date.now());
    const { storageKey, encKey } = await deriveSlot(phrase);
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      encKey,
      new TextEncoder().encode(token),
    );
    const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_BYTES);
    const value = `${Date.now()}.${base64urlEncode(combined)}`;
    storage.setItem(storageKey, value);
  } catch {
    /* persistence is best-effort; on failure the host falls back to recovery */
  }
}

/** Look up and decrypt the host-claim JWT for this phrase, if any. Returns
 *  undefined if no entry exists, the entry is older than the max paid
 *  window, or decryption fails (corruption, wrong phrase, etc.). Removes
 *  the offending entry on detected corruption / staleness so a stuck bad
 *  blob doesn't haunt the slot forever. */
export async function loadHostToken(phrase: string): Promise<string | undefined> {
  const storage = getLocalStorage();
  if (!storage) return undefined;
  if (!phrase) return undefined;
  try {
    gcStaleEntries(storage, Date.now());
    const { storageKey, encKey } = await deriveSlot(phrase);
    const value = storage.getItem(storageKey);
    if (!value) return undefined;
    const dot = value.indexOf(".");
    if (dot <= 0) {
      try { storage.removeItem(storageKey); } catch { /* ignore */ }
      return undefined;
    }
    const storedAt = Number(value.slice(0, dot));
    if (!Number.isFinite(storedAt) || Date.now() - storedAt > MAX_AGE_MS) {
      try { storage.removeItem(storageKey); } catch { /* ignore */ }
      return undefined;
    }
    const combined = base64urlDecode(value.slice(dot + 1));
    if (combined.length <= IV_BYTES) {
      try { storage.removeItem(storageKey); } catch { /* ignore */ }
      return undefined;
    }
    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asBufferSource(iv) },
      encKey,
      asBufferSource(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Decrypt failure here means either (a) the phrase changed, (b) the
    // entry was rewritten by another tab between our read and decrypt, or
    // (c) genuine corruption. In all three cases the entry is unusable; the
    // caller will see undefined and (for case a) will not attempt a stale
    // claim. We do NOT delete on this branch because case (b) is benign and
    // we shouldn't race the other tab into deleting a fresh entry.
    return undefined;
  }
}

/** Drop the persisted entry for this phrase. Called on explicit BURN /
 *  destroy-room / room-expired so a host who deliberately ended the room
 *  doesn't leave a now-useless host token sitting on disk. */
export async function clearHostToken(phrase: string): Promise<void> {
  const storage = getLocalStorage();
  if (!storage) return;
  if (!phrase) return;
  try {
    const { storageKey } = await deriveSlot(phrase);
    storage.removeItem(storageKey);
  } catch {
    /* best-effort cleanup */
  }
}

export const __testing = {
  STORAGE_PREFIX,
  MAX_AGE_MS,
  gcStaleEntries,
};
