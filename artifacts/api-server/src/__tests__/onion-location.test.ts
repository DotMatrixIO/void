// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";

// The OpenAPI / AsyncAPI YAML files are imported as raw text by
// src/routes/spec.ts via an esbuild loader (see build.mjs). Vitest does
// not have that loader configured, so we stub the imports as empty
// strings — this test only cares about response headers.
vi.mock("../../../../lib/api-spec/openapi.yaml", () => ({ default: "" }));
vi.mock("../../../../lib/api-spec/asyncapi.yaml", () => ({ default: "" }));

// Task #384 — frictionless onion access.
//
// This file pins three contracts:
//   1. The Onion-Location header is emitted on https clearnet
//      responses when ONION_HOSTNAME is configured, with the value
//      `http://${ONION_HOSTNAME}${req.originalUrl}` so Tor Browser's
//      auto-prompt lands the user on the same path they were
//      reading — not the homepage. The exact constructed value is
//      pinned so a config drift (e.g. someone editing the onion
//      hostname for staging) fails this test loudly rather than
//      silently breaking Tor Browser auto-discovery.
//   2. Emission is suppressed in three cases that would either be
//      pointless or harmful: ONION_HOSTNAME unset, request arrived
//      over http (Tor Browser ignores the header on http), or
//      request itself came in via the onion (avoids a no-op
//      switch-prompt loop).
//   3. The full CSP response, when the request is served with a
//      synthetic onion Host header, contains no clearnet hostname
//      string — the CSP "parity audit" claim documented next to
//      the CSP definition in app.ts.

// Must be a valid base32 v3-shaped onion (alphabet [a-z2-7], length
// ≥16) so it passes the regex in app.ts. Using a real-looking 56-char
// v3 hostname here keeps the pinned header values realistic.
const ONION_HOSTNAME =
  "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz23456.onion";

async function startWithEnv(env: Record<string, string | undefined>): Promise<{
  httpServer: HttpServer;
  baseUrl: string;
  cleanup: () => Promise<void>;
}> {
  const prevEnv: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prevEnv[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  vi.resetModules();
  const mod = await import("../app");
  const app = mod.default;
  const httpServer = createServer(app);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    httpServer,
    baseUrl,
    cleanup: async () => {
      await new Promise<void>((r) => httpServer.close(() => r()));
      for (const k of Object.keys(prevEnv)) {
        if (prevEnv[k] === undefined) delete process.env[k];
        else process.env[k] = prevEnv[k];
      }
    },
  };
}

describe("Onion-Location header (Task #384)", () => {
  describe("ONION_HOSTNAME unset → header absent", () => {
    let baseUrl: string;
    let cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ baseUrl, cleanup } = await startWithEnv({ ONION_HOSTNAME: undefined }));
    });
    afterAll(async () => {
      await cleanup();
    });

    it("does not emit the header when no onion hostname is configured", async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "void.example" },
      });
      expect(res.headers.get("Onion-Location")).toBeNull();
    });
  });

  describe("ONION_HOSTNAME configured", () => {
    let baseUrl: string;
    let cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ baseUrl, cleanup } = await startWithEnv({
        ONION_HOSTNAME,
      }));
    });
    afterAll(async () => {
      await cleanup();
    });

    it("emits a path-equivalent header on an https clearnet request to the root", async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "void.example" },
      });
      // Exact-value pin — guards against config drift on the
      // hostname AND against someone changing the scheme to https
      // (the runbook's hidden service runs on plain HTTP).
      expect(res.headers.get("Onion-Location")).toBe(
        `http://${ONION_HOSTNAME}/api/health`,
      );
    });

    it("preserves query strings in the header value", async () => {
      const res = await fetch(`${baseUrl}/api/health?ref=tor`, {
        headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "void.example" },
      });
      expect(res.headers.get("Onion-Location")).toBe(
        `http://${ONION_HOSTNAME}/api/health?ref=tor`,
      );
    });

    it("emits the header on a 404 response too (helmet+Onion-Location both persist)", async () => {
      const res = await fetch(`${baseUrl}/api/does-not-exist`, {
        headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "void.example" },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get("Onion-Location")).toBe(
        `http://${ONION_HOSTNAME}/api/does-not-exist`,
      );
    });

    it("does NOT emit the header on a plain http request — Tor Browser ignores it there", async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        // No X-Forwarded-Proto → req.protocol === "http".
        headers: { "X-Forwarded-Host": "void.example" },
      });
      expect(res.headers.get("Onion-Location")).toBeNull();
    });

    it("does NOT emit the header when the request itself arrived via the .onion", async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: {
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": ONION_HOSTNAME,
        },
      });
      expect(res.headers.get("Onion-Location")).toBeNull();
    });

    it("ignores a malformed ONION_HOSTNAME (no header emitted)", async () => {
      // Re-spin a server with a non-onion hostname configured. The
      // validator in app.ts rejects anything that doesn't match the
      // `<base32>.onion` shape, so we should get no header at all
      // rather than a misleading clearnet pointer.
      const { baseUrl: bad, cleanup: cleanBad } = await startWithEnv({
        ONION_HOSTNAME: "example.com",
      });
      try {
        const res = await fetch(`${bad}/api/health`, {
          headers: { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "void.example" },
        });
        expect(res.headers.get("Onion-Location")).toBeNull();
      } finally {
        await cleanBad();
      }
    });
  });

  describe("CSP parity on the .onion origin", () => {
    let baseUrl: string;
    let cleanup: () => Promise<void>;
    beforeAll(async () => {
      ({ baseUrl, cleanup } = await startWithEnv({ ONION_HOSTNAME }));
    });
    afterAll(async () => {
      await cleanup();
    });

    it("CSP served to an onion-origin request names no clearnet hostname", async () => {
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: {
          "X-Forwarded-Proto": "https",
          "X-Forwarded-Host": ONION_HOSTNAME,
        },
      });
      const csp = res.headers.get("content-security-policy") ?? "";
      expect(csp.length).toBeGreaterThan(0);
      // No clearnet TLD substrings anywhere in the policy. If a
      // future directive adds `https://cdn.example.com`, this
      // assertion fires before review.
      for (const tld of [".com", ".net", ".io", ".org", ".dev", ".app", ".co"]) {
        expect(csp).not.toContain(tld);
      }
      // The policy must still actually contain its core
      // directives — guards against a "csp is empty, so it
      // trivially has no clearnet hostnames" regression.
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("connect-src 'self'");
    });
  });
});
