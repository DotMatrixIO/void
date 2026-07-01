// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll } from "vitest";
import {
  generateSigningIdentity,
  signHello,
  verifySignedHello,
  buildBrowserHelloBody,
  generateNonce,
  HelloVerificationError,
  isSignedHello,
  BROWSER_HELLO_IDENTITY,
  BROWSER_HELLO_CAPABILITIES,
  BROWSER_HELLO_ROOM_TYPE,
  type HelloBody,
  type SignedHello,
  type SigningIdentity,
} from "./helloEnvelope";
import { generateECDHKeyPair, exportECDHPublicKey } from "./signalCrypto";
import { PROTOCOL_VERSION } from "@workspace/wire-core";

const ROOM_ID = "abcdef0123456789";

let identity: SigningIdentity;
let ecdhPub: string;
let body: HelloBody;
let signed: SignedHello;

beforeAll(async () => {
  identity = await generateSigningIdentity();
  const pair = await generateECDHKeyPair();
  ecdhPub = await exportECDHPublicKey(pair.publicKey);
  body = await buildBrowserHelloBody({
    ecdhPublicKey: ecdhPub,
    roomId: ROOM_ID,
  });
  signed = await signHello(identity, body);
});

describe("buildBrowserHelloBody — protocol conformance", () => {
  it("produces a body that conforms to the void-wire signed-hello envelope contract and binds the roomId", () => {
    expect(body.protocol).toBe(PROTOCOL_VERSION);
    expect(body.identity).toEqual(BROWSER_HELLO_IDENTITY);
    expect(body.capabilities).toEqual(BROWSER_HELLO_CAPABILITIES);
    expect(body.roomType).toBe(BROWSER_HELLO_ROOM_TYPE);
    expect(body.ecdhPublicKey).toBe(ecdhPub);
    expect(body.roomId).toBe(ROOM_ID);
    expect(typeof body.ecdhFingerprint).toBe("string");
    expect(typeof body.nonce).toBe("string");
    expect(typeof body.timestamp).toBe("number");
  });
});

describe("verifySignedHello — successful negotiation", () => {
  it("accepts a freshly-signed envelope", async () => {
    const verified = await verifySignedHello(signed);
    expect(verified.ecdhPublicKey).toBe(ecdhPub);
    expect(verified.roomId).toBe(ROOM_ID);
  });

  it("accepts when expectedEcdhPublicKey and expectedRoomId both match", async () => {
    const verified = await verifySignedHello(signed, {
      expectedEcdhPublicKey: ecdhPub,
      expectedRoomId: ROOM_ID,
    });
    expect(verified.ecdhPublicKey).toBe(ecdhPub);
  });
});

describe("verifySignedHello — malformed envelope rejection", () => {
  it("rejects an envelope that is not an object", async () => {
    await expect(
      verifySignedHello("nope" as unknown),
    ).rejects.toBeInstanceOf(HelloVerificationError);
  });

  it("rejects an envelope missing the signature field", async () => {
    const bad = { hello: body, signingKey: identity.publicKeyB64 };
    await expect(verifySignedHello(bad)).rejects.toBeInstanceOf(HelloVerificationError);
  });

  it("rejects an envelope missing the hello body", async () => {
    const bad = { signature: signed.signature, signingKey: signed.signingKey };
    await expect(verifySignedHello(bad)).rejects.toBeInstanceOf(HelloVerificationError);
  });

  it("rejects an envelope missing required hello fields", async () => {
    const bad: unknown = {
      hello: { ecdhPublicKey: ecdhPub },
      signature: signed.signature,
      signingKey: signed.signingKey,
    };
    await expect(verifySignedHello(bad)).rejects.toBeInstanceOf(HelloVerificationError);
  });
});

describe("verifySignedHello — binding checks", () => {
  it("rejects when expectedRoomId does not match the signed roomId (anti cross-room replay)", async () => {
    await expect(
      verifySignedHello(signed, { expectedRoomId: "deadbeefdeadbeef" }),
    ).rejects.toMatchObject({ message: "room_id_mismatch" });
  });

  it("rejects when expectedRoomId is required but the hello omits roomId entirely", async () => {
    // SDK-shaped hello (no roomId) MUST NOT pass when the caller
    // explicitly requires room binding — e.g., on the
    // browser-to-browser relay-signal path.
    const sdkShapedBody: HelloBody = { ...body };
    delete sdkShapedBody.roomId;
    const sdkShapedSigned = await signHello(identity, sdkShapedBody);
    await expect(
      verifySignedHello(sdkShapedSigned, { expectedRoomId: ROOM_ID }),
    ).rejects.toMatchObject({ message: "room_id_missing" });
  });

  it("rejects when expectedEcdhPublicKey does not match", async () => {
    await expect(
      verifySignedHello(signed, { expectedEcdhPublicKey: "different-key" }),
    ).rejects.toMatchObject({ message: "ecdh_public_key_mismatch" });
  });

  it("rejects an envelope whose ecdhFingerprint does not match the embedded ecdhPublicKey", async () => {
    const tampered: SignedHello = {
      ...signed,
      hello: { ...signed.hello, ecdhFingerprint: "0".repeat(64) },
    };
    await expect(verifySignedHello(tampered)).rejects.toMatchObject({
      message: "ecdh_fingerprint_mismatch",
    });
  });

  it("rejects an envelope whose timestamp is far outside the freshness window", async () => {
    const stale = await signHello(identity, {
      ...body,
      timestamp: Date.now() - 60 * 60_000,
    });
    await expect(verifySignedHello(stale)).rejects.toMatchObject({
      message: "timestamp_skew",
    });
  });

  it("rejects an envelope whose protocol version does not match PROTOCOL_VERSION", async () => {
    const wrongProto = await signHello(identity, {
      ...body,
      protocol: "void-wire/0" as typeof body.protocol,
      nonce: generateNonce(),
      timestamp: Date.now(),
    });
    await expect(verifySignedHello(wrongProto)).rejects.toMatchObject({
      message: "protocol_version_mismatch",
    });
  });
});

describe("verifySignedHello — signature validation", () => {
  it("rejects an envelope whose signature was forged for a different body", async () => {
    const otherBody = {
      ...body,
      nonce: generateNonce(),
      timestamp: Date.now(),
    };
    const otherSignature = (await signHello(identity, otherBody)).signature;
    const tampered: SignedHello = { ...signed, signature: otherSignature };
    await expect(verifySignedHello(tampered)).rejects.toMatchObject({
      message: "signature_invalid",
    });
  });

  it("rejects an envelope signed by a different identity than the one bundled", async () => {
    const attacker = await generateSigningIdentity();
    const forgedBody = { ...body };
    const forgedSig = (await signHello(attacker, forgedBody)).signature;
    const tampered: SignedHello = {
      hello: forgedBody,
      signature: forgedSig,
      signingKey: signed.signingKey,
    };
    await expect(verifySignedHello(tampered)).rejects.toMatchObject({
      message: "signature_invalid",
    });
  });
});

describe("isSignedHello", () => {
  it("returns true for a well-formed envelope", () => {
    expect(isSignedHello(signed)).toBe(true);
  });

  it("returns false for null, primitives, and missing fields", () => {
    expect(isSignedHello(null)).toBe(false);
    expect(isSignedHello("hi")).toBe(false);
    expect(isSignedHello({ hello: body })).toBe(false);
  });
});
