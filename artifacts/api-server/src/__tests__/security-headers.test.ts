// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The OpenAPI / AsyncAPI YAML files are imported as raw text by
// src/routes/spec.ts via an esbuild loader (see build.mjs). Vitest does
// not have that loader configured, so we stub the imports as empty
// strings — this test only cares about helmet-issued headers, not the
// /api/openapi.yaml response body.
vi.mock("../../../../lib/api-spec/openapi.yaml", () => ({ default: "" }));
vi.mock("../../../../lib/api-spec/asyncapi.yaml", () => ({ default: "" }));

// Mock the routes barrel to inject a guaranteed-throwing /__error route
// AHEAD of the production routes. This lets us assert that the helmet
// header surface persists on a true 5xx response (Property #2 of the
// Task #256 regression test) without needing to find a production route
// that throws on demand.
vi.mock("../routes", async (importActual) => {
  const actual = await importActual<typeof import("../routes")>();
  const expressMod = await import("express");
  const router = expressMod.Router();
  router.get("/__error", (_req, _res, next) => {
    next(new Error("intentional test error"));
  });
  router.use(actual.default);
  return { default: router };
});

// Task #256 — Tighten HTTP security headers on the API server.
//
// This file is the regression guard against silent removal or downgrade of
// the Permissions-Policy, Referrer-Policy, COOP, CORP, X-Permitted-Cross-
// Domain-Policies, and the existing CSP / HSTS / X-Frame-Options surface.
//
// Per the task spec, the test asserts FOUR properties:
//   1. Each header's value matches the expected exact string (not just
//      "header is present").
//   2. Headers persist on error responses (404, 500) — a future
//      middleware change cannot strip them by handling errors before
//      helmet runs.
//   3. Headers persist on OPTIONS preflight responses.
//   4. Headers persist on static-asset responses (JS, CSS, images) when
//      SERVE_STATIC=1, including under both CORP modes (same-origin
//      single-origin self-host vs same-site split-origin deployment).

interface AssertableHeaders {
  "content-security-policy"?: string;
  "permissions-policy"?: string;
  "referrer-policy"?: string;
  "cross-origin-opener-policy"?: string;
  "cross-origin-resource-policy"?: string;
  "x-frame-options"?: string;
  "strict-transport-security"?: string;
  "x-permitted-cross-domain-policies"?: string;
  "cross-origin-embedder-policy"?: string;
  "reporting-endpoints"?: string;
}

// Exact value helmet emits for our CSP config. Locked here so any
// directive add/remove/reorder fails this test loudly.
const EXPECTED_CSP =
  "default-src 'self';" +
  // 'wasm-unsafe-eval' permits WebAssembly compilation only (argon2id
  // room-key derivation via hash-wasm); JS eval() stays blocked. Under
  // SERVE_STATIC=1 the directive additionally carries sha256 hashes for
  // the inline SRI-diagnostic script in the built client HTML — not
  // present here because tests run without SERVE_STATIC.
  "script-src 'self' 'wasm-unsafe-eval';" +
  "style-src 'self' 'unsafe-inline';" +
  "connect-src 'self' wss:;" +
  "worker-src 'self' blob:;" +
  "media-src 'self' blob: mediastream:;" +
  "img-src 'self' data: blob:;" +
  "font-src 'self';" +
  "object-src 'none';" +
  "frame-src 'none';" +
  "base-uri 'none';" +
  "form-action 'self';" +
  "report-to default;" +
  "frame-ancestors 'self';" +
  "script-src-attr 'none';" +
  "upgrade-insecure-requests";

const EXPECTED_REPORTING_ENDPOINTS = `default="/api/csp-report"`;

const EXPECTED_PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "fullscreen=(self)",
  "autoplay=(self)",
  "web-share=(self)",
  "accelerometer=()",
  "ambient-light-sensor=()",
  "battery=()",
  "bluetooth=()",
  "browsing-topics=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "interest-cohort=()",
  "magnetometer=()",
  "midi=()",
  "otp-credentials=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "speaker-selection=()",
  "storage-access=()",
  "sync-xhr=()",
  "usb=()",
  "window-management=()",
  "xr-spatial-tracking=()",
].join(", ");

function expectCommonHeaders(headers: AssertableHeaders, corpMode: "same-origin" | "same-site") {
  // Property 1 — exact value match, not "header is present".
  expect(headers["content-security-policy"]).toBe(EXPECTED_CSP);
  expect(headers["permissions-policy"]).toBe(EXPECTED_PERMISSIONS_POLICY);
  expect(headers["reporting-endpoints"]).toBe(EXPECTED_REPORTING_ENDPOINTS);
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe(corpMode);
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-permitted-cross-domain-policies"]).toBe("none");
  expect(headers["strict-transport-security"]).toBe(
    "max-age=31536000; includeSubDomains; preload",
  );

  // COEP is intentionally NOT enabled — see app.ts comment. Assert the
  // header is absent so a future re-enable surfaces here for a deliberate
  // audit-doc decision.
  expect(headers["cross-origin-embedder-policy"]).toBeUndefined();
}

function lowerCaseHeaders(res: Response): AssertableHeaders {
  const out: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out as AssertableHeaders;
}

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

  // Re-import app.ts fresh so it picks up the just-set env vars
  // (the SERVE_STATIC branch is evaluated at module-load time).
  vi.resetModules();
  const mod = await import("../app");
  const app = mod.default;

  // The /__error route that triggers the 500 path is injected via
  // vi.mock("../routes") at the top of this file, so it's mounted
  // under /api ahead of the real router.
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

describe("HTTP security headers — split-origin deployment (SERVE_STATIC unset)", () => {
  let baseUrl: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ baseUrl, cleanup } = await startWithEnv({ SERVE_STATIC: undefined }));
  });

  afterAll(async () => {
    await cleanup();
  });

  it("sets the full header surface on a normal 200 response", async () => {
    // /api/health is a real route that returns 200.
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-site");
  });

  it("Property 2: headers persist on a 404 response", async () => {
    const res = await fetch(`${baseUrl}/api/this-route-does-not-exist`);
    expect(res.status).toBe(404);
    expectCommonHeaders(lowerCaseHeaders(res), "same-site");
  });

  it("Property 2: headers persist on a 500 response", async () => {
    const res = await fetch(`${baseUrl}/api/__error`);
    expect(res.status).toBe(500);
    expectCommonHeaders(lowerCaseHeaders(res), "same-site");
  });

  it("Property 3: headers persist on OPTIONS preflight", async () => {
    const res = await fetch(`${baseUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.test",
        "Access-Control-Request-Method": "GET",
      },
    });
    expectCommonHeaders(lowerCaseHeaders(res), "same-site");
  });
});

describe("HTTP security headers — single-origin self-host (SERVE_STATIC=1)", () => {
  let baseUrl: string;
  let cleanup: () => Promise<void>;
  let tmpDir: string;

  beforeAll(async () => {
    // Build a minimal client dist so the static handler has something to
    // serve; we only need the JS file to verify Property 4.
    tmpDir = mkdtempSync(path.join(tmpdir(), "void-static-"));
    mkdirSync(path.join(tmpDir, "assets"), { recursive: true });
    writeFileSync(path.join(tmpDir, "index.html"), "<!doctype html><title>v</title>");
    writeFileSync(path.join(tmpDir, "assets", "app.js"), "/* test */ export {};");
    writeFileSync(path.join(tmpDir, "assets", "app.css"), "/* test */");
    // 1x1 transparent PNG — minimum-viable image asset for Property #4.
    const pngBytes = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489000000" +
        "0a49444154789c6300010000000500017a82d0a90000000049454e44ae426082",
      "hex",
    );
    writeFileSync(path.join(tmpDir, "assets", "logo.png"), pngBytes);

    ({ baseUrl, cleanup } = await startWithEnv({
      SERVE_STATIC: "1",
      CLIENT_DIST: tmpDir,
    }));
  });

  afterAll(async () => {
    await cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses CORP same-origin when API and client share an origin", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-origin");
  });

  it("Property 4: headers persist on JS asset responses", async () => {
    const res = await fetch(`${baseUrl}/assets/app.js`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-origin");
  });

  it("Property 4: headers persist on CSS asset responses", async () => {
    const res = await fetch(`${baseUrl}/assets/app.css`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-origin");
  });

  it("Property 4: headers persist on image asset responses", async () => {
    const res = await fetch(`${baseUrl}/assets/logo.png`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-origin");
  });

  it("Property 4: headers persist on the SPA fallback index.html", async () => {
    const res = await fetch(`${baseUrl}/some/spa/route`);
    expect(res.status).toBe(200);
    expectCommonHeaders(lowerCaseHeaders(res), "same-origin");
  });
});
