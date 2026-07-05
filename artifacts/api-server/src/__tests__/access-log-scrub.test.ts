// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server as HttpServer } from "node:http";
import { createServer } from "node:http";
import net from "node:net";

// Task #374: pin the published "What we log" policy at the HTTP layer.
// The policy on /why says:
//   - 2xx access-log lines never carry the 32-hex room code.
//   - 4xx/5xx access-log lines may carry it for triage.
// This test hits a benign room-state route in both shapes and asserts
// the captured pino line matches the published rule. If a future
// refactor removes the scrub (or applies it on the failure path too),
// the published policy lies by omission — and this test fails.

// Capture pino log lines as structured objects. The shared logger
// writes to stdout via pino's default transport; we mock it before
// loading the app so every `logger.info({...}, "http")` call lands
// in the in-memory `lines` array.
const lines: Array<Record<string, unknown> & { msg: string }> = [];
vi.mock("../lib/logger", () => ({
  logger: {
    info: (obj: Record<string, unknown>, msg: string) => {
      lines.push({ ...obj, msg });
    },
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    debug: () => undefined,
  },
}));

// Mock the api-spec YAML imports so `routes/spec.ts` resolves under
// vitest without the build step. Same shape security-headers-proxy.test.ts
// uses — keep these in sync with the openapi/asyncapi spec wiring.
vi.mock("../../../../lib/api-spec/openapi.yaml", () => ({ default: "" }));
vi.mock("../../../../lib/api-spec/asyncapi.yaml", () => ({ default: "" }));

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

describe("HTTP access log scrubs room IDs on success only (Task #374)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    vi.resetModules();
    const { default: app } = await import("../app");
    const port = await pickFreePort();
    httpServer = createServer(app);
    await new Promise<void>((r) => httpServer.listen(port, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("2xx access-log line carries <room-id> in place of the room code", async () => {
    lines.length = 0;
    // 32-hex, well-formed code that does not match any live room — the
    // route returns 200 with an empty body (see routes/room-state.ts).
    const code = "ab".repeat(16);
    const res = await fetch(`${baseUrl}/api/room-state/${code}`);
    expect(res.status).toBe(200);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    expect(http!.status).toBe(200);
    const url = String(http!.url);
    // The room code MUST NOT appear anywhere in the success-path line.
    expect(url).not.toContain(code);
    expect(url).toContain("<room-id>");
  });

  it("4xx access-log line still carries the room code for triage", async () => {
    lines.length = 0;
    // Not 32-hex — route returns 400 INVALID_CODE. The malformed
    // value is what an operator wants to see when triaging a real
    // client error, so the scrub MUST NOT apply on the failure path.
    const bad = "not-a-valid-room-id";
    const res = await fetch(`${baseUrl}/api/room-state/${bad}`);
    expect(res.status).toBe(400);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    expect(http!.status).toBe(400);
    expect(String(http!.url)).toContain(bad);
  });

  it("paths without a room code are passed through verbatim on success", async () => {
    lines.length = 0;
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    expect(http!.url).toBe("/api/health");
  });

  // Task #881: the raw 64-hex Lightning paymentHash appears as a path segment
  // on /api/paywall/status/:paymentHash, so req.originalUrl would carry it into
  // the access line. It is a settlement-linkable identifier and must NEVER be
  // logged raw — on ANY status, unlike the room ID. Pin both: the raw hash is
  // gone and a non-reversible digest token stands in its place.
  it("access-log line never carries a raw paymentHash on the paywall status path", async () => {
    lines.length = 0;
    // 64-hex, well-formed paymentHash that was never created via /invoice. The
    // status route accepts the shape and returns 200 {paid:false} (unpaid).
    const hash = "ab".repeat(32);
    const res = await fetch(`${baseUrl}/api/paywall/status/${hash}`);
    expect([200, 503]).toContain(res.status);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    const url = String(http!.url);
    // The raw hash MUST NOT appear, and no 64-hex run may remain anywhere.
    expect(url).not.toContain(hash);
    expect(url).not.toMatch(/[0-9a-f]{64}/i);
    // A digest token stands in for the scrubbed hash.
    expect(url).toContain("<payment-hash:");
  });

  // The route guard is /^[0-9a-f]{64}$/i, so an UPPERCASE 64-hex hash is a valid
  // request. A lowercase-only scrub regex would leak it; assert it does not.
  it("scrubs an uppercase 64-hex paymentHash from the access line", async () => {
    lines.length = 0;
    const hash = "AB".repeat(32);
    const res = await fetch(`${baseUrl}/api/paywall/status/${hash}`);
    expect([200, 503]).toContain(res.status);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    const url = String(http!.url);
    expect(url).not.toContain(hash);
    expect(url).not.toMatch(/[0-9a-f]{64}/i);
    expect(url).toContain("<payment-hash:");
  });

  // Under the BTCPay backend the route accepts NON-hex :paymentHash IDs (the
  // guard only requires length >= 10 there). The access logger cannot know the
  // backend, so it scrubs the :paymentHash segment by POSITION regardless of
  // charset/case — even when this default-backend request is rejected (400),
  // the raw segment must not survive into the access line.
  it("scrubs a non-hex (BTCPay-shaped) paymentHash segment by position", async () => {
    lines.length = 0;
    const id = "btcpay_INV_abcDEF0123456789";
    const res = await fetch(`${baseUrl}/api/paywall/status/${id}`);
    // Default backend rejects the non-hex shape; the scrub still applies.
    expect([200, 400, 503]).toContain(res.status);

    const http = lines.find((l) => l.msg === "http");
    expect(http, "expected an http access-log line").toBeDefined();
    const url = String(http!.url);
    expect(url).not.toContain(id);
    expect(url).toContain("/api/paywall/status/<payment-hash:");
  });
});
