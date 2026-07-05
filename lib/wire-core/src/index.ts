// SPDX-License-Identifier: AGPL-3.0-or-later
//
// `@workspace/wire-core` — neutral wire primitives shared by the browser
// client (`@workspace/void-client`) and the Node API server
// (`@workspace/api-server`).
//
// VOID is human-only: this package carries the shared transport wire
// surface (room type, signed-hello envelope, feature flags) and no
// agent-RPC surface. `scripts/check-publish-boundary.mjs`
// (`check:publish-boundary`) guards against reintroducing the removed
// agent packages.

export {
  RoomTypeSchema,
  TranscriptModeSchema,
  WireIdentitySchema,
  WireCapabilitiesSchema,
  HelloBodySchema,
  FeatureFlagSchema,
  ContentTypeSchema,
  PROTOCOL_VERSION,
  RELAY_SIGNAL_MAX_PAYLOAD_BYTES,
  SIGNING_CONTEXTS,
  canonicalize,
  signingPayload,
} from "./schemas.js";
export type {
  RoomType,
  TranscriptMode,
  WireIdentity,
  WireCapabilities,
  FeatureFlag,
  ContentType,
  HelloBody,
} from "./schemas.js";

export { markSecret, unwrapSecret } from "./brand.js";
export type { Brand, Secret } from "./brand.js";

export {
  ARGON2ID_ROOM_PARAMS,
  ROOM_DERIVATION_SALT,
  deriveRoomBytesArgon2id,
} from "./argon2.js";

export {
  generateSigningIdentity,
  generateNonce,
  signHello,
  verifySignedHello,
  buildHelloBody,
  ecdhFingerprint,
  isSignedHello,
  HelloVerificationError,
  base64urlEncode as envelopeBase64urlEncode,
  base64urlDecode as envelopeBase64urlDecode,
} from "./hello-envelope.js";
export type {
  HelloBody as SignedHelloBody,
  SignedHello,
  SigningIdentity,
  VerifyExpectations,
} from "./hello-envelope.js";
