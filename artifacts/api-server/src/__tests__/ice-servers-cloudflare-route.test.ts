// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import iceServersRouter from "../routes/ice-servers";
import { resetCloudflareTurnCacheForTests } from "../lib/cloudflareTurn";

// Task #538 coverage: Cloudflare-TURN branch in /api/ice-servers.
// The coturn HMAC-SHA1 branch and the fail-closed unconfigured branch
// have their own coverage in `ice-servers-route.test.ts`; this file
// focuses on the new branch and its interactions (cache, coalescing,
// failure-mode mapping, precedence, rate-limit ordering).

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

async function getJson(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, init);
  return { status: res.status, body: await res.json() };
}

function cloudflareSuccessResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

describe("GET /api/ice-servers — Cloudflare TURN branch (#538)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: FetchCall[];

  const savedEnv = {
    stun: process.env["STUN_URL"],
    turnUrl: process.env["TURN_URL"],
    turnSecret: process.env["TURN_SECRET"],
    cfId: process.env["CLOUDFLARE_TURN_TOKEN_ID"],
    cfToken: process.env["CLOUDFLARE_TURN_API_TOKEN"],
  };

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use("/api", iceServersRouter);
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
    for (const [k, v] of Object.entries({
      STUN_URL: savedEnv.stun,
      TURN_URL: savedEnv.turnUrl,
      TURN_SECRET: savedEnv.turnSecret,
      CLOUDFLARE_TURN_TOKEN_ID: savedEnv.cfId,
      CLOUDFLARE_TURN_API_TOKEN: savedEnv.cfToken,
    })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  beforeEach(() => {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
    resetCloudflareTurnCacheForTests();
    originalFetch = globalThis.fetch;
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
    resetCloudflareTurnCacheForTests();
    vi.restoreAllMocks();
  });

  function setCloudflareCreds(id = "test-id", token = "test-token"): void {
    process.env["CLOUDFLARE_TURN_TOKEN_ID"] = id;
    process.env["CLOUDFLARE_TURN_API_TOKEN"] = token;
  }

  function installFetch(
    handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  ): void {
    const realFetch = originalFetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      // Only intercept Cloudflare API calls; the test itself uses
      // globalThis.fetch to hit the local express server.
      if (!u.includes("rtc.live.cloudflare.com")) {
        return realFetch(url as Parameters<typeof realFetch>[0], init);
      }
      fetchCalls.push({ url: u, init });
      return handler(u, init);
    }) as typeof globalThis.fetch;
  }

  it("happy path: forwards Cloudflare iceServers and caches across requests", async () => {
    setCloudflareCreds();
    const cfIceServers = [
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: ["turn:turn.cloudflare.com:3478"],
        username: "cf-user",
        credential: "cf-cred",
      },
    ];
    installFetch(() => cloudflareSuccessResponse({ iceServers: cfIceServers }));

    const first = await getJson(`${baseUrl}/api/ice-servers`);
    expect(first.status).toBe(200);
    const fb = first.body as Record<string, unknown>;
    expect(fb["iceServers"]).toEqual(cfIceServers);
    expect(typeof fb["ttl"]).toBe("number");
    expect(typeof fb["expiresAt"]).toBe("number");
    expect(fb["no_turn_configured"]).toBeUndefined();
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toContain(
      "rtc.live.cloudflare.com/v1/turn/keys/test-id/credentials/generate-ice-servers",
    );
    const headerInput = (fetchCalls[0]?.init?.headers ?? {}) as Record<
      string,
      string
    >;
    const authHeader = new Headers(headerInput).get("authorization");
    expect(authHeader).toBe("Bearer test-token");

    const second = await getJson(`${baseUrl}/api/ice-servers`);
    expect(second.status).toBe(200);
    expect((second.body as Record<string, unknown>)["iceServers"]).toEqual(
      cfIceServers,
    );
    // Cache hit — no second outbound call.
    expect(fetchCalls).toHaveLength(1);
  });

  it("fails closed on timeout / AbortError from fetch", async () => {
    setCloudflareCreds();
    // Simulate the abort path directly by throwing an AbortError —
    // exercises the same error-mapping branch as a real 5s timeout
    // without making the test wait that long. The route is wrapped
    // with an AbortController + 5_000ms in lib/cloudflareTurn.ts; the
    // mapping under test is "AbortError -> 503 + fail-closed shape".
    installFetch(() => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(503);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("fails closed on upstream 5xx", async () => {
    setCloudflareCreds();
    installFetch(() => new Response("boom", { status: 502 }));
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(503);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("fails closed on upstream 4xx (e.g. revoked token)", async () => {
    setCloudflareCreds();
    installFetch(() => new Response("unauthorized", { status: 401 }));
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(503);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("fails closed on malformed JSON", async () => {
    setCloudflareCreds();
    installFetch(
      () =>
        new Response("not json{{{", {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(503);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("fails closed when iceServers field is missing", async () => {
    setCloudflareCreds();
    installFetch(() => cloudflareSuccessResponse({ unexpected: "shape" }));
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(503);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("Cloudflare creds take precedence over coturn creds", async () => {
    setCloudflareCreds();
    process.env["TURN_URL"] = "turns:turn.void.example:5349?transport=tcp";
    process.env["TURN_SECRET"] = "test-secret-not-a-placeholder-1234567890";
    const cfIceServers = [
      { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" },
    ];
    installFetch(() => cloudflareSuccessResponse({ iceServers: cfIceServers }));

    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b["iceServers"]).toEqual(cfIceServers);
    // No coturn-shaped username present (HMAC username has `:` separator).
    const serialized = JSON.stringify(b["iceServers"]);
    expect(serialized).not.toMatch(/turn\.void\.example/);
  });

  it("rate-limit triggers BEFORE any outbound Cloudflare fetch", async () => {
    setCloudflareCreds();
    installFetch(() =>
      cloudflareSuccessResponse({ iceServers: [{ urls: "stun:x:3478" }] }),
    );

    // Use a spoofed X-Forwarded-For so we can isolate from other tests'
    // rate-bucket state (which is keyed by req.ip in the route).
    const ip = "203.0.113.99";
    const headers = { "X-Forwarded-For": ip };

    for (let i = 0; i < 10; i++) {
      const r = await getJson(`${baseUrl}/api/ice-servers`, { headers });
      expect(r.status).toBe(200);
    }
    const fetchCountBefore = fetchCalls.length;
    const limited = await getJson(`${baseUrl}/api/ice-servers`, { headers });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "RATE_LIMITED" });
    // The rate-limited 11th request must not have hit Cloudflare.
    expect(fetchCalls.length).toBe(fetchCountBefore);
  });
});
