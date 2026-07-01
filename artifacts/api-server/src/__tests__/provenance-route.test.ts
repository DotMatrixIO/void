// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import provenanceRouter, { _provenanceForTest } from "../routes/provenance";

// Regression coverage for /api/provenance.json (task #491 / M-6).
//
// The threat-model page in void-client documents this endpoint as the
// SRI-vs-served-HTML cross-check that pairs with /api/proof/build, so
// the shape and cache discipline are load-bearing — a future refactor
// of routes/provenance.ts or build.mjs's writeProvenance() must not
// silently drop a documented field or change the cache header. Mirrors
// the bar set by proof-build.test.ts.

describe("GET /api/provenance.json", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use("/api", provenanceRouter);
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

  it("serves the documented schema with the immutable cache header", async () => {
    const res = await fetch(`${baseUrl}/api/provenance.json`);
    expect(res.status).toBe(200);
    // Threat-model page promises max-age=3600 (same as /api/openapi.yaml)
    // because provenance for a given commit is immutable.
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");

    const body = (await res.json()) as Record<string, unknown>;

    // Every field documented on the threat-model page must be present.
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.commit).toBe("string");
    expect(typeof body.builtAt).toBe("string");
    expect(typeof body.builder).toBe("string");
    expect(body.sriDigests).toBeTypeOf("object");
    expect(body.sriDigests).not.toBeNull();
    // releaseTag is nullable per the schema (null on dev builds and on
    // CI builds for commits that aren't tagged releases) but the key
    // must be present.
    expect("releaseTag" in body).toBe(true);
    expect(body.releaseTag === null || typeof body.releaseTag === "string").toBe(
      true,
    );
    // Honesty caveat must travel with the response itself — a raw
    // curl reader should not need to find the doc to see it.
    expect(typeof body.caveat).toBe("string");
    expect(body.caveat).toMatch(/network path/i);
  });

  it("every sriDigests value is a sha384-<base64> string keyed by /assets/ path", async () => {
    const res = await fetch(`${baseUrl}/api/provenance.json`);
    const body = (await res.json()) as { sriDigests: Record<string, string> };
    for (const [key, value] of Object.entries(body.sriDigests)) {
      // Keys must be the in-HTML reference shape so a verifier can
      // line them up against `integrity=` attributes without ambiguity.
      expect(key, `sriDigests key shape: ${key}`).toMatch(/^\/assets\//);
      // Values must be sha384 base64 (44 chars + '=' padding).
      expect(value, `sriDigests value shape for ${key}`).toMatch(
        /^sha384-[A-Za-z0-9+/]+=*$/,
      );
    }
  });

  it("the loaded provenance is structurally well-formed (never 500s)", () => {
    // The route module loads provenance once at import time. Whether
    // it comes from a real provenance.json on disk (CI/built test env)
    // or the in-route dev-mode placeholder (clean checkout), the
    // resulting object must satisfy the documented schema so the
    // endpoint can serve without crashing.
    expect(_provenanceForTest.schemaVersion).toBe(1);
    expect(typeof _provenanceForTest.commit).toBe("string");
    expect(typeof _provenanceForTest.builder).toBe("string");
    expect(_provenanceForTest.sriDigests).toBeTypeOf("object");
    expect(typeof _provenanceForTest.caveat).toBe("string");
  });
});
