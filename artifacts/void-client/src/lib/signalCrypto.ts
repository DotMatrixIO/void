// SPDX-License-Identifier: AGPL-3.0-or-later
import { asBufferSource } from "./bufferSource";

// AES-GCM IV is the spec default of 12 bytes (96 bits). Generated fresh
// per message via `crypto.getRandomValues` and prepended to the
// ciphertext on the wire. Do NOT switch to a counter or fixed nonce —
// AES-GCM IV reuse under the same key catastrophically breaks both
// confidentiality and authentication. (Spec invariant — no task ref;
// indexed in docs/code-quirks-index.md.)
const IV_BYTES = 12;

// Audit M-01 (Task #461): the optional `aad` parameter binds caller-supplied
// envelope context (in practice the sender peerId) into the AES-GCM
// authenticator. The relay server already validates that
// `senderUser.peerId === fromPeerId`, but that check is only meaningful
// while the server is honest. Binding the sender id into AAD makes
// reflection / re-addressing fail at decrypt time, regardless of the
// relay's behavior. Callers that omit `aad` get the previous (no-AAD)
// behavior for cross-impl compatibility with Node fixtures that do not
// yet thread a sender id.
export async function encryptSignal(
  key: CryptoKey,
  payload: unknown,
  aad?: string,
): Promise<string> {
  try {
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const params: AesGcmParams = { name: "AES-GCM", iv };
    if (aad !== undefined) {
      params.additionalData = new TextEncoder().encode(aad);
    }
    const ciphertext = await crypto.subtle.encrypt(params, key, plaintext);
    const combined = new Uint8Array(IV_BYTES + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), IV_BYTES);
    return base64urlEncode(combined);
  } catch {
    throw new Error("ENCRYPT_FAILED");
  }
}

export async function decryptSignal(
  key: CryptoKey,
  encoded: string,
  aad?: string,
): Promise<unknown> {
  try {
    const combined = base64urlDecode(encoded);
    const iv = combined.slice(0, IV_BYTES);
    const ciphertext = combined.slice(IV_BYTES);
    const params: AesGcmParams = { name: "AES-GCM", iv };
    if (aad !== undefined) {
      params.additionalData = new TextEncoder().encode(aad);
    }
    const plaintext = await crypto.subtle.decrypt(params, key, ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("DECRYPT_FAILED");
  }
}

// ECDH curve is P-384. P-384 is the Web Crypto common denominator
// across our supported browsers without polyfills (Safari historically
// did not ship X25519 in `subtle.generateKey` with the right algorithm
// shape, and P-256 was considered too low a margin against future
// cryptanalytic improvements). The PRIVATE key is `extractable: false`
// so it never leaves WebCrypto; the public key is intentionally
// exported (raw) below for the wire handshake, and only the HKDF-
// derived bits ever leave the subtle boundary on the secret side.
// Match this curve in any future raw-import / fingerprint helper.
// (Indexed in docs/code-quirks-index.md; no task ref — original
// protocol choice.)
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-384" },
    false,
    ["deriveBits"],
  );
}

export async function exportECDHPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return base64urlEncode(new Uint8Array(raw));
}

export async function importECDHPublicKey(encoded: string): Promise<CryptoKey> {
  const raw = base64urlDecode(encoded);
  return crypto.subtle.importKey(
    "raw",
    asBufferSource(raw),
    { name: "ECDH", namedCurve: "P-384" },
    false,
    [],
  );
}

// HKDF `info` strings domain-separate the AES session key from the SAS
// bits derived from the same shared ECDH secret. Both peers derive
// independently (the HKDF salt is 32 zero bytes — see `deriveSessionKey`
// — because RFC 5869's "salt not available" mode is a zero-byte salt
// and the ECDH output is already high-entropy IKM; a random salt would
// require an extra exchange the threat model does not permit). The two
// `info` strings give the AES key and SAS bits independent KDF outputs
// so leaking one cannot reveal the other. (Indexed in
// docs/code-quirks-index.md; protocol invariant, no task ref.)
const HKDF_INFO = new TextEncoder().encode("VOID-ECDHE-v1");
const SAS_HKDF_INFO = new TextEncoder().encode("VOID-SAS-v1");

export interface SessionKeyResult {
  key: CryptoKey;
  sas: [string, string];
}

export async function deriveSessionKey(
  privateKey: CryptoKey,
  remotePublicKey: CryptoKey,
): Promise<SessionKeyResult> {
  const { BIP39_WORDLIST } = await import("./voidPhrase");

  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: remotePublicKey },
    privateKey,
    384,
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveBits", "deriveKey"],
  );

  const sessionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: HKDF_INFO,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const sasBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: SAS_HKDF_INFO,
    },
    hkdfKey,
    32,
  );
  // SAS truncation. Read a single big-endian uint32 from the HKDF-SAS
  // output; pull two BIP-39 word indices from disjoint 11-bit ranges
  // (word 1 = bits 31..21, word 2 = bits 20..10). The shifts and mask
  // are the load-bearing wire contract — both peers must extract the
  // same bits in the same order, so do not reorder, repack, or
  // "cleanly" rewrite these two lines. 22 bits total ≈ 4M possible
  // word pairs; sufficient entropy for an interactive man-in-the-
  // middle check, not for long-term secrecy. (Indexed in
  // docs/code-quirks-index.md; protocol invariant, no task ref.)
  const sasView = new DataView(sasBits);
  const sasVal = sasView.getUint32(0, false);
  const word1 = BIP39_WORDLIST[(sasVal >>> 21) & 0x7FF];
  const word2 = BIP39_WORDLIST[(sasVal >>> 10) & 0x7FF];

  // Wipe the shared ECDH bits before returning. They are no longer
  // needed (HKDF has already absorbed them) and should not linger in
  // the JS heap. Best-effort — V8 may have already copied the buffer.
  new Uint8Array(sharedBits).fill(0);

  return { key: sessionKey, sas: [word1, word2] };
}

export function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(str: string): Uint8Array {
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  if (pad === 2) padded += "==";
  else if (pad === 3) padded += "=";
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
