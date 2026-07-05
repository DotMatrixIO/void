// SPDX-License-Identifier: AGPL-3.0-or-later
// Signed-Hello envelope — shared protocol library.
//
// This module is the single source of truth for the signed-hello
// envelope used by the browser client (`@workspace/void-client`).
// Construction + verification logic lives here so the wire format and
// crypto are owned in one place and cannot drift.
//
// Why a standalone wire-core module?
//   - The envelope is protocol-level. Putting it in
//     `@workspace/wire-core` next to `HelloBodySchema`,
//     `signingPayload`, and `SIGNING_CONTEXTS` makes the wire-core
//     package the sole owner of the wire contract.
//   - It stays browser-safe: no `node:crypto` imports (see the
//     runtime note below), so the browser bundle can import it
//     directly.
//
// Runtime: uses `globalThis.crypto.subtle`, which is available in
// browsers (Chrome 113+/Firefox 130+/Safari 17+) and Node ≥ 20.
// Ed25519 is used in `raw` SPKI form on the wire (32-byte public
// key, 64-byte signature, both base64url-encoded), matching what
// browsers and Node webcrypto already exchange. No node:crypto
// imports — keeps the bundle browser-safe.
//
// Optional extension fields on the body:
//
//   - `sessionId` — an optional per-session identifier. Reserved by
//     the schema; the browser client does not emit it.
//
//   - `ecdhFingerprint` — SHA-256 over `ecdhPublicKey`. Both peers
//     can derive it locally; when present we verify it matches.
//
//   - `roomId` — the room code the handshake belongs to. Browsers
//     emit this because all browser signaling rides the shared
//     relay-signal socket and there is no per-session channel
//     boundary; without binding the hello to a roomId, a hello
//     captured in room A could be replayed into room B by anyone
//     who learned the room A phrase. The SDK does not currently
//     emit this field over relay-signal, so `roomId` is OPTIONAL
//     at the schema level for SDK envelope interop. Verifier
//     callers control enforcement via `expectedRoomId`: when
//     supplied, both presence and equality are required.

import {
  SIGNING_CONTEXTS,
  signingPayload as protocolSigningPayload,
  PROTOCOL_VERSION,
} from "./schemas.js";
import { markSecret, type Secret } from "./brand.js";
import type {
  HelloBody as ProtocolHelloBody,
  WireIdentity,
  WireCapabilities,
  RoomType,
} from "./schemas.js";

const NONCE_BYTES = 24;
const MAX_TIMESTAMP_SKEW_MS = 5 * 60_000;

export interface HelloBody extends ProtocolHelloBody {
  ecdhFingerprint?: string;
  roomId?: string;
  sessionId?: string;
}

export interface SignedHello {
  hello: HelloBody;
  /** Ed25519 signature over the canonical signing payload, base64url-
   *  encoded. Branded `Secret<string>` because this value is the
   *  entire authentication artifact for the hello — anything that
   *  compares it with `===` / `==` / `Buffer.equals` is what the
   *  custom ESLint rule `no-secret-equality` is meant to catch. */
  signature: Secret<string>;
  signingKey: string;
}

export interface SigningIdentity {
  /** Ed25519 private key. Branded `Secret<CryptoKey>`. */
  privateKey: Secret<CryptoKey>;
  publicKeyB64: string;
}

export class HelloVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelloVerificationError";
  }
}

export interface VerifyExpectations {
  expectedEcdhPublicKey?: string;
  expectedRoomId?: string;
  /**
   * Task #313: optional room-type cross-check. When supplied, the
   * verifier rejects a hello whose signed `roomType` does not equal this
   * value with `HelloVerificationError("room_type_mismatch")`. The point
   * is to derive the expected type locally (the 6-word phrase invite the
   * client already holds always derives `human`) and refuse to trust any
   * room type a hostile signaling server might assert. Because `roomType`
   * lives *inside* the Ed25519-signed body, a peer cannot forge a matching
   * type without the signing key, so a mismatch is a genuine detection —
   * not just a wire-level disagreement. Optional and additive: callers
   * that don't set it keep the prior behaviour.
   */
  expectedRoomType?: RoomType;
  now?: number;
  /**
   * Task #483: optional same-sender replay defense. When supplied, the
   * verifier checks the body's `nonce` against this set (after the
   * timestamp-skew window and before the signature check) and throws
   * `HelloVerificationError("nonce_replayed")` on a hit. The verifier
   * does NOT mutate the set — the caller is responsible for adding
   * `verified.nonce` to the set on successful verification, scoped to
   * the (sender identity) it accepted the envelope from. This keeps the
   * "what counts as a duplicate" policy (per-peer, per-session, bounded
   * cache vs. permanent) at the caller layer where the session lifetime
   * is known. `verifySignedHello`'s own `MAX_TIMESTAMP_SKEW_MS` window
   * bounds how far back a replay can land, so a bounded cache is
   * sufficient — see `webrtc.ts` for the browser-side wiring.
   */
  seenNonces?: { has(nonce: string): boolean };
}

// Minimal local mirrors of the WebCrypto types so this module compiles
// under a `lib: ["es2022"]` tsconfig without requiring `dom` (which would
// clash with node:crypto's webcrypto type definitions).
interface SubtleCryptoLike {
  generateKey(algo: unknown, extractable: boolean, usages: string[]): Promise<unknown>;
  exportKey(format: string, key: CryptoKey): Promise<ArrayBuffer>;
  importKey(
    format: string,
    keyData: Uint8Array,
    algo: unknown,
    extractable: boolean,
    usages: string[],
  ): Promise<CryptoKey>;
  sign(algo: unknown, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>;
  verify(algo: unknown, key: CryptoKey, sig: Uint8Array, data: Uint8Array): Promise<boolean>;
  digest(algo: string, data: Uint8Array): Promise<ArrayBuffer>;
}
interface CryptoLike {
  subtle: SubtleCryptoLike;
  getRandomValues<T extends Uint8Array>(array: T): T;
}
interface CryptoKeyPairLike {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

function getSubtle(): SubtleCryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || !c.subtle) {
    throw new Error("WebCrypto subtle API is not available in this runtime");
  }
  return c.subtle;
}

function getRandom(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c) throw new Error("WebCrypto getRandomValues is not available");
  return c;
}

export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export async function generateSigningIdentity(): Promise<SigningIdentity> {
  const subtle = getSubtle();
  const pair = (await subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPairLike;
  const rawPub = await subtle.exportKey("raw", pair.publicKey);
  return {
    privateKey: markSecret(pair.privateKey),
    publicKeyB64: base64urlEncode(new Uint8Array(rawPub)),
  };
}

export function generateNonce(): string {
  const bytes = new Uint8Array(NONCE_BYTES);
  getRandom().getRandomValues(bytes);
  return base64urlEncode(bytes);
}

export async function ecdhFingerprint(ecdhPublicKeyB64: string): Promise<string> {
  const subtle = getSubtle();
  const data = new TextEncoder().encode(ecdhPublicKeyB64);
  const hash = await subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build a hello body. Caller supplies identity, capabilities,
 * roomType, and the negotiated `ecdhPublicKey`. Optional `roomId`
 * (browser↔browser binding) and `sessionId` (optional per-session
 * binding) are passed through. `ecdhFingerprint`, `nonce`, and
 * `timestamp` default to fresh values.
 */
export async function buildHelloBody(opts: {
  identity: WireIdentity;
  capabilities: WireCapabilities;
  roomType: RoomType;
  ecdhPublicKey: string;
  roomId?: string;
  sessionId?: string;
  nonce?: string;
  timestamp?: number;
  ecdhFingerprint?: string;
}): Promise<HelloBody> {
  const fp = opts.ecdhFingerprint ?? (await ecdhFingerprint(opts.ecdhPublicKey));
  const body: HelloBody = {
    protocol: PROTOCOL_VERSION,
    identity: opts.identity,
    capabilities: opts.capabilities,
    roomType: opts.roomType,
    ecdhPublicKey: opts.ecdhPublicKey,
    ecdhFingerprint: fp,
    nonce: opts.nonce ?? generateNonce(),
    timestamp: opts.timestamp ?? Date.now(),
  };
  if (opts.roomId !== undefined) body.roomId = opts.roomId;
  if (opts.sessionId !== undefined) body.sessionId = opts.sessionId;
  return body;
}

export async function signHello(
  identity: SigningIdentity,
  body: HelloBody,
): Promise<SignedHello> {
  const subtle = getSubtle();
  const payload = protocolSigningPayload(SIGNING_CONTEXTS.HELLO, body);
  const sig = await subtle.sign(
    { name: "Ed25519" },
    identity.privateKey,
    payload,
  );
  return {
    hello: body,
    signature: markSecret(base64urlEncode(new Uint8Array(sig))),
    signingKey: identity.publicKeyB64,
  };
}

function isHelloBody(v: unknown): v is HelloBody {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.ecdhPublicKey === "string" &&
    typeof o.protocol === "string" &&
    typeof o.nonce === "string" &&
    typeof o.timestamp === "number" &&
    Number.isFinite(o.timestamp) &&
    o.identity !== null &&
    typeof o.identity === "object" &&
    o.capabilities !== null &&
    typeof o.capabilities === "object" &&
    typeof o.roomType === "string" &&
    (o.ecdhFingerprint === undefined || typeof o.ecdhFingerprint === "string") &&
    (o.roomId === undefined || typeof o.roomId === "string") &&
    (o.sessionId === undefined || typeof o.sessionId === "string")
  );
}

export function isSignedHello(v: unknown): v is SignedHello {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    isHelloBody(o.hello) &&
    typeof o.signature === "string" &&
    typeof o.signingKey === "string"
  );
}

/**
 * Verify a signed hello envelope. Throws `HelloVerificationError`
 * on any failure. Callers must treat any thrown error as a
 * loud-fail signal — never silently downgrade to room-wide
 * encryption.
 */
export async function verifySignedHello(
  signed: unknown,
  expect: VerifyExpectations = {},
): Promise<HelloBody> {
  if (!isSignedHello(signed)) {
    throw new HelloVerificationError("malformed_envelope");
  }
  const { hello, signature, signingKey } = signed;

  if (hello.protocol !== PROTOCOL_VERSION) {
    throw new HelloVerificationError("protocol_version_mismatch");
  }

  const now = expect.now ?? Date.now();
  if (Math.abs(now - hello.timestamp) > MAX_TIMESTAMP_SKEW_MS) {
    throw new HelloVerificationError("timestamp_skew");
  }

  // Task #483: same-sender replay defense. A hostile signaling server
  // that captured a `(IV, ciphertext)` pair carrying a `key-exchange`
  // envelope can re-emit it later under the original sender id; the AAD
  // bind on `fromPeerId` does not catch this (the sender id is
  // unchanged). The timestamp-skew window above bounds how far back a
  // replay can land; the caller's `seenNonces` cache catches replays
  // inside that window. Checked here, before the signature verify,
  // because if it's a known nonce we already rejected the original
  // payload's signature attempt is moot — the replay is a no-op even if
  // the signature is otherwise valid.
  if (expect.seenNonces && expect.seenNonces.has(hello.nonce)) {
    throw new HelloVerificationError("nonce_replayed");
  }

  if (hello.ecdhFingerprint !== undefined) {
    const expectedFingerprint = await ecdhFingerprint(hello.ecdhPublicKey);
    if (expectedFingerprint !== hello.ecdhFingerprint) {
      throw new HelloVerificationError("ecdh_fingerprint_mismatch");
    }
  }

  if (
    expect.expectedEcdhPublicKey !== undefined &&
    expect.expectedEcdhPublicKey !== hello.ecdhPublicKey
  ) {
    throw new HelloVerificationError("ecdh_public_key_mismatch");
  }

  if (expect.expectedRoomId !== undefined) {
    if (hello.roomId === undefined) {
      throw new HelloVerificationError("room_id_missing");
    }
    if (expect.expectedRoomId !== hello.roomId) {
      throw new HelloVerificationError("room_id_mismatch");
    }
  }

  // Task #313: room-type cross-check. The expected type is derived
  // locally from the invite, never from anything the signaling server
  // says, so a hostile server cannot relax the policy by claiming a
  // peer is in a "human" room. The asserted `roomType` is inside the
  // signed body, so a mismatch can only come from a peer with a
  // genuinely different (signed) room type — fail closed.
  if (
    expect.expectedRoomType !== undefined &&
    expect.expectedRoomType !== hello.roomType
  ) {
    throw new HelloVerificationError("room_type_mismatch");
  }

  const subtle = getSubtle();
  let pubKey: CryptoKey;
  try {
    pubKey = await subtle.importKey(
      "raw",
      base64urlDecode(signingKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new HelloVerificationError("signing_key_invalid");
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64urlDecode(signature);
  } catch {
    throw new HelloVerificationError("signature_invalid_encoding");
  }

  const payload = protocolSigningPayload(SIGNING_CONTEXTS.HELLO, hello);

  let valid = false;
  try {
    valid = await subtle.verify(
      { name: "Ed25519" },
      pubKey,
      sigBytes,
      payload,
    );
  } catch {
    throw new HelloVerificationError("signature_verify_threw");
  }
  if (!valid) {
    throw new HelloVerificationError("signature_invalid");
  }

  return hello;
}
