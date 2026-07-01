// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Neutral wire-core schemas: the transport / signed-hello envelope
// primitives shared by the browser client and the Node API server. This
// package knows the hello-envelope wire format and the room-key
// derivation contract. VOID is a single human-only product; there is no
// agent room type or agent-invite grammar.
import { z } from "zod";

export const RoomTypeSchema = z.enum(["human"]);
export type RoomType = z.infer<typeof RoomTypeSchema>;

export const TranscriptModeSchema = z.enum(["none", "local", "shared"]);
export type TranscriptMode = z.infer<typeof TranscriptModeSchema>;

// Signed-hello wire primitives. The `Wire`-prefixed identity/capabilities
// types below, the `void-wire/1` protocol string (`PROTOCOL_VERSION`,
// `HelloBody.protocol`), and the `SIGNING_CONTEXTS` strings define the
// human browser↔browser signed-hello handshake. Their exact bytes are part
// of the wire format and the Ed25519 signature inputs, so they are
// load-bearing: do not change any of these literals without a coordinated
// wire-version bump (and corresponding updates to the signing / doc-drift
// guards) — doing so breaks wire and signature compatibility.
//
// Wire-version history: these strings were originally named with an agent-SDK
// prefix (a leftover from a removed agent SDK). VOID is now a single
// human-only product, so they were renamed to the neutral `void-wire/1` /
// `Wire*` as a deliberate version bump. The cutover is HARD, not a
// dual-accept window: the browser client and API server are built and
// deployed together from this one repo, there is no independently-versioned
// external client speaking the old string, and a peer left on an old build
// during a rolling deploy is rejected loud (`protocol_version_mismatch`)
// and simply reconnects — acceptable for ephemeral calls with no long-lived
// sessions.
export const WireIdentitySchema = z.object({
  clientId: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  vendor: z.string().max(128).optional(),
});
export type WireIdentity = z.infer<typeof WireIdentitySchema>;

export const FeatureFlagSchema = z.enum([
  "streaming",
  "human-loop",
  "media",
  "transcript",
]);
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const ContentTypeSchema = z.enum([
  "application/json",
  "text/plain",
  "application/octet-stream",
  "text/markdown",
  "image/png",
  "image/jpeg",
]);
export type ContentType = z.infer<typeof ContentTypeSchema>;

export const WireCapabilitiesSchema = z.object({
  protocols: z.array(z.string().min(1).max(64)),
  channels: z.array(z.enum(["void.control", "void.rpc", "void.stream"])),
  transcriptMode: TranscriptModeSchema,
  maxEnvelopeBytes: z.number().int().positive().max(65536).optional(),
  features: z.array(FeatureFlagSchema).optional(),
  contentTypes: z.array(ContentTypeSchema).optional(),
  toolNamespaces: z.array(z.string().min(1).max(64)).optional(),
});
export type WireCapabilities = z.infer<typeof WireCapabilitiesSchema>;

export const HelloBodySchema = z.object({
  protocol: z.literal("void-wire/1"),
  identity: WireIdentitySchema,
  capabilities: WireCapabilitiesSchema,
  roomType: RoomTypeSchema,
  ecdhPublicKey: z.string().min(1),
  nonce: z.string().min(16).max(64),
  timestamp: z.number().int().positive(),
});
export type HelloBody = z.infer<typeof HelloBodySchema>;

export const PROTOCOL_VERSION = "void-wire/1" as const;

// Task #461 / audit L-03: hard cap on the inbound `relay-signal` `payload`
// field. Defined here (shared package) so the API server and the browser
// client cannot drift on the value. The server drops oversize payloads in
// `signalingRelay.ts`; the client mirrors the check in `webrtc.ts
// handleRelay` before invoking `decryptSignal`, so the client memory bound
// holds even against an alternate (non-VOID) signaling server that skips
// the cap. Real WebRTC SDP / ICE blobs encrypted by the client are well
// under 16 KiB; 64 KiB leaves comfortable headroom.
export const RELAY_SIGNAL_MAX_PAYLOAD_BYTES = 64 * 1024;

// NUL-delimited signing contexts. Each protocol message is signed
// over `${context}\0${canonicalize(body)}` so a signature for one
// message type cannot be replayed as a different type. The `\0`
// separator (a single byte that cannot appear inside the canonical
// JSON output) is the load-bearing delimiter — changing or omitting
// it allows cross-context signature confusion. Keep the strings
// stable across versions; both peers must agree byte-for-byte.
// (Indexed in docs/code-quirks-index.md.)
export const SIGNING_CONTEXTS = {
  HELLO: "void-wire/1\0hello\0",
  ENVELOPE: "void-wire/1\0envelope\0",
} as const;

function sortKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// Deterministic JSON serialization for signing. Object keys are
// emitted in sorted order (lexicographic on UTF-16 code units, which
// is what `Array.prototype.sort` does by default) so the same logical
// body produces the same byte sequence on every implementation.
// `JSON.stringify` alone is non-deterministic across runtimes for
// object key ordering. Both peers MUST canonicalize before signing /
// verifying — never sign the raw `JSON.stringify` output. (Indexed
// in docs/code-quirks-index.md.)
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

export function signingPayload(context: string, data: unknown): Uint8Array {
  const canonical = canonicalize(data);
  return new TextEncoder().encode(context + canonical);
}
