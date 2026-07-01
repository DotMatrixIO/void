// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import proofBuildRouter from "../routes/proof-build";

// Regression coverage for the /api/proof/build endpoint (task #383).
// The shape MUST be stable because external verifiers (rebuild recipe
// in README-selfhost.md, the in-app /proof/runtime page) parse this
// JSON and compare it across hosts and across network paths. Any
// field rename or schemaVersion bump without a coordinated client +
// doc update is a breaking change.

describe("GET /api/proof/build", () => {
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

  it("exposes the documented schema with caveat text in-band", async () => {
    const res = await fetch(`${baseUrl}/api/proof/build`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.gitSha).toBe("string");
    expect(typeof body.gitShaShort).toBe("string");
    expect(typeof body.builtAt).toBe("string");
    expect(typeof body.nodeVersion).toBe("string");
    expect(body.sha256sums).toBeTypeOf("object");
    // Honesty caveat must travel with the response itself — a raw
    // curl reader should not need to find the doc to see it.
    expect(body.caveat).toMatch(/network path/i);
  });

  it("rate-limits abusive callers from a single IP", async () => {
    // Bucket is per-process and shared with the previous test. Hit the
    // endpoint enough times in a tight loop to exceed the 10/min cap
    // and observe 429. Any 429 within the burst proves the gate works.
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/proof/build`);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
