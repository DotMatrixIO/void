// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import cspReportRouter, { __testing } from "../routes/csp-report";
import { logger } from "../lib/logger";

// Task #252 — round-trip the CSP / Reporting-API violation sink.
//
// The route receives unauthenticated POSTs from browsers and must:
//   1. Parse both the modern Reporting-API shape (`application/reports+json`,
//      array of envelopes) and the legacy report-uri shape
//      (`application/csp-report`, `{ "csp-report": { … } }`).
//   2. Always reply 204 on success — never echo the body.
//   3. Emit a structured WARN with the salient fields the operator needs.
//   4. Drop traffic past the per-IP limit with 429.

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const app = express();
  app.set("trust proxy", 1);
  // Mirror app.ts: the global json parser only handles application/json,
  // and the CSP route mounts its own parser for the report content types.
  app.use(express.json());
  app.use("/api", cspReportRouter);
  const httpServer: HttpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

describe("POST /api/csp-report", () => {
  let server: TestServer;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    server = await startServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    __testing.resetRateLimit();
    warnSpy?.mockRestore();
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  it("accepts a Reporting-API batch and logs a structured violation", async () => {
    const payload = [
      {
        type: "csp-violation",
        age: 0,
        url: "https://example.com/page",
        user_agent: "TestAgent/1.0",
        body: {
          documentURL: "https://example.com/page",
          blockedURL: "https://evil.example/inject.js",
          effectiveDirective: "script-src",
          originalPolicy: "default-src 'self'",
          disposition: "enforce",
          statusCode: 200,
        },
      },
    ];

    const res = await fetch(`${server.url}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/reports+json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(204);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [fields, msg] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toMatch(/violation/i);
    expect(fields).toMatchObject({
      event: "csp_report",
      reportType: "csp-violation",
      blockedUrl: "https://evil.example/inject.js",
      documentUrl: "https://example.com/page",
      effectiveDirective: "script-src",
      disposition: "enforce",
    });
  });

  it("accepts a legacy report-uri envelope", async () => {
    const payload = {
      "csp-report": {
        "document-uri": "https://example.com/legacy",
        "blocked-uri": "inline",
        "violated-directive": "script-src 'self'",
        "effective-directive": "script-src",
        "original-policy": "default-src 'self'",
        disposition: "enforce",
        "status-code": 200,
      },
    };

    const res = await fetch(`${server.url}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(204);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [fields] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({
      event: "csp_report",
      reportType: "csp-violation",
      blockedUrl: "inline",
      effectiveDirective: "script-src",
    });
  });

  it("returns 204 even on an unrecognized payload shape (no oracle)", async () => {
    const res = await fetch(`${server.url}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totally: "not a report" }),
    });
    expect(res.status).toBe(204);
    // No structured violation log emitted for an unrecognized shape.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 204 on malformed JSON (no oracle via parse errors)", async () => {
    const res = await fetch(`${server.url}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/reports+json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(204);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("returns 204 on an oversized body (no oracle via 413)", async () => {
    // Build a payload comfortably larger than the 32 KB body cap.
    const big = "x".repeat(64 * 1024);
    const res = await fetch(`${server.url}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/reports+json" },
      body: JSON.stringify([{ type: "csp-violation", body: { blockedURL: big } }]),
    });
    expect(res.status).toBe(204);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("rate-limits a flood from a single IP with 429", async () => {
    const payload = JSON.stringify([{ type: "csp-violation", body: { blockedURL: "x" } }]);
    const headers = { "Content-Type": "application/reports+json" };

    // Spend the entire bucket — every request inside the limit returns 204.
    for (let i = 0; i < __testing.RATE_MAX_PER_IP; i++) {
      const ok = await fetch(`${server.url}/api/csp-report`, { method: "POST", headers, body: payload });
      expect(ok.status).toBe(204);
    }

    // The next one trips the limiter.
    const limited = await fetch(`${server.url}/api/csp-report`, { method: "POST", headers, body: payload });
    expect(limited.status).toBe(429);
  });
});
