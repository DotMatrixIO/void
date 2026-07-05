// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser shim around the shared signed-hello envelope library.
//
// All construction/verification logic lives in
// `@workspace/wire-core/hello-envelope` so there is a single shared
// implementation of the wire format. This file only adds
// browser-specific defaults (the identity / capabilities values the
// browser advertises) and a thin wrapper that fills the browser's
// roomId binding.
//
// Verification failure here is the trigger for the loud-fail teardown
// in `webrtc.ts` — never silently downgrade to room-wide phrase key.

import {
  PROTOCOL_VERSION,
  buildHelloBody,
  generateSigningIdentity,
  generateNonce,
  signHello,
  verifySignedHello,
  ecdhFingerprint,
  isSignedHello,
  HelloVerificationError,
  type WireIdentity,
  type WireCapabilities,
  type RoomType,
  type SignedHelloBody as HelloBody,
  type SignedHello,
  type SigningIdentity,
  type VerifyExpectations,
} from "@workspace/wire-core";

export {
  generateSigningIdentity,
  generateNonce,
  signHello,
  verifySignedHello,
  ecdhFingerprint,
  isSignedHello,
  HelloVerificationError,
};
export type { HelloBody, SignedHello, SigningIdentity, VerifyExpectations };

export const BROWSER_HELLO_IDENTITY: WireIdentity = {
  clientId: "void-browser",
  name: "VOID Browser Client",
  version: "1.0.0",
  vendor: "void.so",
};

export const BROWSER_HELLO_CAPABILITIES: WireCapabilities = {
  protocols: [PROTOCOL_VERSION],
  channels: [],
  transcriptMode: "none",
};

/**
 * Browser room type. VOID is human-only: every room is a "human" room,
 * so this is the single value the browser ever advertises inside its
 * signed hello body.
 */
export const BROWSER_HELLO_ROOM_TYPE: RoomType = "human";

/**
 * Build a browser hello body with the protocol-mandated identity,
 * capabilities, and room type, plus the browser-specific `roomId`
 * binding. Thin wrapper over the shared `buildHelloBody`.
 *
 * The room type is always "human" — VOID has no other room types — so it
 * is fixed here rather than passed in. It is advertised inside the
 * Ed25519-signed body so a verifying peer can cross-check it against its
 * own expectation.
 */
export async function buildBrowserHelloBody(opts: {
  ecdhPublicKey: string;
  roomId: string;
  nonce?: string;
  timestamp?: number;
}): Promise<HelloBody> {
  return buildHelloBody({
    identity: BROWSER_HELLO_IDENTITY,
    capabilities: BROWSER_HELLO_CAPABILITIES,
    roomType: BROWSER_HELLO_ROOM_TYPE,
    ecdhPublicKey: opts.ecdhPublicKey,
    roomId: opts.roomId,
    nonce: opts.nonce,
    timestamp: opts.timestamp,
  });
}
