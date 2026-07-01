// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import proofBuildRouter from "../routes/proof-build";
import {
  isValidOnionHostname,
  getOnionIngress,
  buildPostureAttestation,
} from "../lib/torPosture";

// Coverage for the Tor-only / onion-ingress posture attestation (task #1023).
// The /api/proof/posture shape is parsed by the in-app /proof/runtime page and
// by curl-wielding verifiers, so the fields and their honest-degradation
// branches must stay stable.

describe("isValidOnionHostname", () => {
  it("accepts a >=16-char base32 .onion host (case-insensitive)", () => {
    expect(isValidOnionHostname("abcdefghijklmnop.onion")).toBe(true);
    expect(isValidOnionHostname("ABCDEFGHIJKLMNOP.onion")).toBe(true);
    // A full v3 host (56 chars) is also accepted by the looser server rule.
    expect(isValidOnionHostname(`${"a".repeat(56)}.onion`)).toBe(true);
  });

  it("rejects malformed values", () => {
    expect(isValidOnionHostname("")).toBe(false);
    expect(isValidOnionHostname("short.onion")).toBe(false); // <16 chars
    expect(isValidOnionHostname("abcdefghijklmnop.com")).toBe(false);
    expect(isValidOnionHostname("contains1890digits.onion")).toBe(false); // 1,8,9,0 not base32
    expect(isValidOnionHostname("abcdefghijklmnop.onion.evil.com")).toBe(false);
  });
});

describe("getOnionIngress", () => {
  it("reports configured + lowercased hostname for a valid value", () => {
    const r = getOnionIngress({ ONION_HOSTNAME: "ABCDEFGHIJKLMNOP.onion" });
    expect(r).toEqual({ configured: true, hostname: "abcdefghijklmnop.onion" });
  });

  it("fails closed (configured:false) for blank or malformed values", () => {
    expect(getOnionIngress({})).toEqual({ configured: false, hostname: null });
    expect(getOnionIngress({ ONION_HOSTNAME: "  " })).toEqual({
      configured: false,
      hostname: null,
    });
    expect(getOnionIngress({ ONION_HOSTNAME: "nope.com" })).toEqual({
      configured: false,
      hostname: null,
    });
  });
});

describe("buildPostureAttestation", () => {
  const build = {
    gitSha: "a".repeat(40),
    gitShaShort: "aaaaaaa",
    releaseTag: "v1.2.3",
  };
  const onion = "abcdefghijklmnop.onion";

  it("reports onionOnlyPostureActive only when ALL facts hold", () => {
    const a = buildPostureAttestation(build, {
      TOR_ONLY: "1",
      ONION_HOSTNAME: onion,
    });
    expect(a.torOnly).toBe(true);
    expect(a.iceStunSuppressed).toBe(true);
    expect(a.onionIngress).toEqual({ configured: true, hostname: onion });
    expect(a.onionOnlyPostureActive).toBe(true);
  });

  it("degrades honestly: TOR_ONLY off ⇒ STUN not suppressed, posture inactive", () => {
    const a = buildPostureAttestation(build, { ONION_HOSTNAME: onion });
    expect(a.torOnly).toBe(false);
    expect(a.iceStunSuppressed).toBe(false);
    expect(a.onionIngress.configured).toBe(true);
    expect(a.onionOnlyPostureActive).toBe(false);
  });

  it("posture inactive when onion ingress is missing even if TOR_ONLY on", () => {
    const a = buildPostureAttestation(build, { TOR_ONLY: "1" });
    expect(a.torOnly).toBe(true);
    expect(a.onionIngress.configured).toBe(false);
    expect(a.onionOnlyPostureActive).toBe(false);
  });

  it("binds to the build identity and stamps the read time", () => {
    const now = new Date("2026-06-17T00:00:00.000Z");
    const a = buildPostureAttestation(build, { TOR_ONLY: "1" }, now);
    expect(a.gitSha).toBe(build.gitSha);
    expect(a.gitShaShort).toBe(build.gitShaShort);
    expect(a.releaseTag).toBe("v1.2.3");
    expect(a.attestedAt).toBe(now.toISOString());
  });

  it("carries the non-claims caveat in-band", () => {
    const a = buildPostureAttestation(build, { TOR_ONLY: "1" });
    // Must name the un-modified-binary, TOCTOU, and logging-proxy non-claims.
    expect(a.caveat).toMatch(/un-modified/i);
    expect(a.caveat).toMatch(/time-of-check/i);
    expect(a.caveat).toMatch(/logging proxy/i);
  });
});

describe("GET /api/proof/posture", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use("/api", proofBuildRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("serves the documented schema with no-store and an in-band caveat", async () => {
    const res = await fetch(`${baseUrl}/api/proof/posture`);
    expect(res.status).toBe(200);
    // Posture is runtime-mutable, so it must never be cached (TOCTOU).
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.gitSha).toBe("string");
    expect(typeof body.gitShaShort).toBe("string");
    expect(typeof body.torOnly).toBe("boolean");
    expect(typeof body.iceStunSuppressed).toBe("boolean");
    expect(body.onionIngress).toBeTypeOf("object");
    expect(typeof body.onionOnlyPostureActive).toBe("boolean");
    expect(typeof body.attestedAt).toBe("string");
    expect(typeof body.caveat).toBe("string");
  });

  it("rate-limits abusive callers from a single IP", async () => {
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/proof/posture`);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
