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
import {
  isTorOnly,
  turnUrlTerminatesOverTor,
  torOnlyStartupBanner,
  torOnlyTurnWarning,
  torOnlyCloudflareWarning,
  isStunUrl,
  stripStunIceServers,
} from "../lib/torOnly";
import { resetCloudflareTurnCacheForTests } from "../lib/cloudflareTurn";

describe("isTorOnly", () => {
  it("is true only for the literal '1'", () => {
    expect(isTorOnly({ TOR_ONLY: "1" })).toBe(true);
  });

  it("is false when unset", () => {
    expect(isTorOnly({})).toBe(false);
  });

  it("is false for values other than '1' (no typo-promotes-to-on)", () => {
    expect(isTorOnly({ TOR_ONLY: "true" })).toBe(false);
    expect(isTorOnly({ TOR_ONLY: "0" })).toBe(false);
    expect(isTorOnly({ TOR_ONLY: "" })).toBe(false);
    expect(isTorOnly({ TOR_ONLY: " 1 " })).toBe(false);
  });
});

describe("turnUrlTerminatesOverTor", () => {
  it("accepts a turns: relay on a .onion host", () => {
    expect(
      turnUrlTerminatesOverTor(
        "turns:abcdefghij234567.onion:5349?transport=tcp",
      ),
    ).toBe(true);
  });

  it("tolerates a // after the scheme", () => {
    expect(
      turnUrlTerminatesOverTor("turns://abcdefghij234567.onion:5349"),
    ).toBe(true);
  });

  it("rejects a plain turn: (non-TLS) .onion endpoint", () => {
    expect(turnUrlTerminatesOverTor("turn:abcdefghij234567.onion:3478")).toBe(
      false,
    );
  });

  it("rejects a turns: relay on a clearnet host", () => {
    expect(
      turnUrlTerminatesOverTor("turns:turn.void.example:5349?transport=tcp"),
    ).toBe(false);
  });

  it("rejects a clearnet IP TURN endpoint", () => {
    expect(turnUrlTerminatesOverTor("turn:203.0.113.7:3478")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(turnUrlTerminatesOverTor("not-a-turn-url")).toBe(false);
    expect(turnUrlTerminatesOverTor("")).toBe(false);
  });
});

describe("torOnlyTurnWarning", () => {
  it("returns null when TURN_URL is unset", () => {
    expect(torOnlyTurnWarning(undefined)).toBeNull();
    expect(torOnlyTurnWarning("")).toBeNull();
    expect(torOnlyTurnWarning("   ")).toBeNull();
  });

  it("returns null for an over-Tor turns:/.onion endpoint", () => {
    expect(
      torOnlyTurnWarning("turns:abcdefghij234567.onion:5349?transport=tcp"),
    ).toBeNull();
  });

  it("warns for a clearnet TURN endpoint and names the URL", () => {
    const warning = torOnlyTurnWarning("turn:203.0.113.7:3478");
    expect(warning).toContain("TOR_ONLY=1");
    expect(warning).toContain("turn:203.0.113.7:3478");
    expect(warning).toContain(".onion");
  });
});

describe("torOnlyCloudflareWarning", () => {
  it("returns null when Cloudflare creds are not configured", () => {
    expect(torOnlyCloudflareWarning(false)).toBeNull();
  });

  it("warns when Cloudflare creds are configured, naming the clearnet relay and the env vars to unset", () => {
    const warning = torOnlyCloudflareWarning(true);
    expect(warning).toContain("TOR_ONLY=1");
    expect(warning).toContain("Cloudflare");
    expect(warning).toContain("clearnet");
    expect(warning).toContain("CLOUDFLARE_TURN_TOKEN_ID");
    expect(warning).toContain("CLOUDFLARE_TURN_API_TOKEN");
    expect(warning).toContain("README-selfhost.md §6b");
  });
});

describe("torOnlyStartupBanner", () => {
  it("names the active posture and the STUN suppression consequence", () => {
    const banner = torOnlyStartupBanner();
    expect(banner).toContain("TOR_ONLY=1");
    expect(banner).toContain("onion-only posture ACTIVE");
    expect(banner).toContain("STUN");
  });
});

describe("isStunUrl", () => {
  it("matches stun: and stuns: case-insensitively, tolerating whitespace", () => {
    expect(isStunUrl("stun:stun.example:3478")).toBe(true);
    expect(isStunUrl("stuns:stun.example:5349")).toBe(true);
    expect(isStunUrl("STUN:stun.example:3478")).toBe(true);
    expect(isStunUrl("  stun:stun.example:3478")).toBe(true);
  });

  it("does not match turn:/turns: or other schemes", () => {
    expect(isStunUrl("turn:turn.example:3478")).toBe(false);
    expect(isStunUrl("turns:turn.example:5349")).toBe(false);
    expect(isStunUrl("https://example")).toBe(false);
    expect(isStunUrl("")).toBe(false);
  });
});

describe("stripStunIceServers", () => {
  it("drops string-urls STUN entries and keeps TURN ones", () => {
    const out = stripStunIceServers([
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" },
    ]);
    expect(out).toEqual([
      { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" },
    ]);
  });

  it("filters STUN members out of an array-urls entry, keeping the entry", () => {
    const out = stripStunIceServers([
      {
        urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478"],
        username: "u",
        credential: "c",
      },
    ]);
    expect(out).toEqual([
      {
        urls: ["turn:turn.cloudflare.com:3478"],
        username: "u",
        credential: "c",
      },
    ]);
  });

  it("drops an array-urls entry left with no non-STUN members", () => {
    const out = stripStunIceServers([
      { urls: ["stun:a:3478", "stuns:b:5349"] },
      { urls: ["turn:c:3478"], username: "u", credential: "c" },
    ]);
    expect(out).toEqual([
      { urls: ["turn:c:3478"], username: "u", credential: "c" },
    ]);
  });

  it("returns an empty list when every source is STUN", () => {
    expect(
      stripStunIceServers([
        { urls: "stun:a:3478" },
        { urls: ["stun:b:3478"] },
      ]),
    ).toEqual([]);
  });

  it("is a no-op when there are no STUN sources", () => {
    const input = [
      { urls: "turns:abc.onion:5349", username: "u", credential: "c" },
    ];
    expect(stripStunIceServers(input)).toEqual(input);
  });
});

// Route-level gating: under TOR_ONLY the ICE-server response must omit any
// STUN fallback (a STUN binding request would leak each peer's public IP to
// a clearnet third party during ICE gathering).
describe("GET /api/ice-servers TOR_ONLY STUN suppression", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  const savedStun = process.env["STUN_URL"];
  const savedTurnUrl = process.env["TURN_URL"];
  const savedTurnSecret = process.env["TURN_SECRET"];
  const savedTorOnly = process.env["TOR_ONLY"];
  // Ambient Cloudflare creds would route to the Cloudflare branch and
  // bypass the coturn STUN/TURN path under test; save, clear, restore.
  const savedCfTokenId = process.env["CLOUDFLARE_TURN_TOKEN_ID"];
  const savedCfApiToken = process.env["CLOUDFLARE_TURN_API_TOKEN"];

  async function getJson(): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}/api/ice-servers`);
    return { status: res.status, body: await res.json() };
  }

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
    const restore = (key: string, val: string | undefined) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };
    restore("STUN_URL", savedStun);
    restore("TURN_URL", savedTurnUrl);
    restore("TURN_SECRET", savedTurnSecret);
    restore("TOR_ONLY", savedTorOnly);
    restore("CLOUDFLARE_TURN_TOKEN_ID", savedCfTokenId);
    restore("CLOUDFLARE_TURN_API_TOKEN", savedCfApiToken);
  });

  beforeEach(() => {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["TOR_ONLY"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  });

  afterEach(() => {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["TOR_ONLY"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  });

  it("omits the STUN entry from the TURN response when TOR_ONLY=1", async () => {
    process.env["TOR_ONLY"] = "1";
    process.env["TURN_URL"] = "turns:abcdefghij234567.onion:5349?transport=tcp";
    process.env["TURN_SECRET"] = "test-secret-not-a-placeholder-1234567890";
    process.env["STUN_URL"] = "stun:stun.void.example:3478";

    const { status, body } = await getJson();
    expect(status).toBe(200);
    const b = body as { iceServers: { urls: string }[] };
    const urls = b.iceServers.map((s) => s.urls);
    expect(urls).not.toContain("stun:stun.void.example:3478");
    expect(urls).toContain(
      "turns:abcdefghij234567.onion:5349?transport=tcp",
    );
  });

  it("still includes STUN in the TURN response when TOR_ONLY is unset", async () => {
    process.env["TURN_URL"] = "turns:turn.void.example:5349?transport=tcp";
    process.env["TURN_SECRET"] = "test-secret-not-a-placeholder-1234567890";
    process.env["STUN_URL"] = "stun:stun.void.example:3478";

    const { status, body } = await getJson();
    expect(status).toBe(200);
    const b = body as { iceServers: { urls: string }[] };
    const urls = b.iceServers.map((s) => s.urls);
    expect(urls).toContain("stun:stun.void.example:3478");
  });

  it("returns an empty STUN-suppressed list when only STUN_URL is set under TOR_ONLY", async () => {
    process.env["TOR_ONLY"] = "1";
    process.env["STUN_URL"] = "stun:stun.void.example:3478";

    const { status, body } = await getJson();
    expect(status).toBe(200);
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });
});

// The Cloudflare-TURN branch is minted upstream and routinely bundles a
// clearnet STUN server alongside the relay. Under TOR_ONLY that STUN entry
// must be stripped too — otherwise an onion-only operator would advertise a
// clearnet ICE source while /api/proof/posture claims iceStunSuppressed.
describe("GET /api/ice-servers TOR_ONLY — Cloudflare branch", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let originalFetch: typeof globalThis.fetch;

  const saved = {
    stun: process.env["STUN_URL"],
    turnUrl: process.env["TURN_URL"],
    turnSecret: process.env["TURN_SECRET"],
    torOnly: process.env["TOR_ONLY"],
    cfId: process.env["CLOUDFLARE_TURN_TOKEN_ID"],
    cfToken: process.env["CLOUDFLARE_TURN_API_TOKEN"],
  };

  function clearEnv(): void {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["TOR_ONLY"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  }

  function cloudflareResponse(iceServers: unknown): Response {
    return new Response(JSON.stringify({ iceServers }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  }

  function installFetch(iceServers: unknown): void {
    const realFetch = originalFetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (!u.includes("rtc.live.cloudflare.com")) {
        return realFetch(url as Parameters<typeof realFetch>[0], init);
      }
      return cloudflareResponse(iceServers);
    }) as typeof globalThis.fetch;
  }

  async function getJson(): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}/api/ice-servers`);
    return { status: res.status, body: await res.json() };
  }

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
    const restore = (key: string, val: string | undefined) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    };
    restore("STUN_URL", saved.stun);
    restore("TURN_URL", saved.turnUrl);
    restore("TURN_SECRET", saved.turnSecret);
    restore("TOR_ONLY", saved.torOnly);
    restore("CLOUDFLARE_TURN_TOKEN_ID", saved.cfId);
    restore("CLOUDFLARE_TURN_API_TOKEN", saved.cfToken);
  });

  beforeEach(() => {
    clearEnv();
    resetCloudflareTurnCacheForTests();
    originalFetch = globalThis.fetch;
    process.env["CLOUDFLARE_TURN_TOKEN_ID"] = "test-id";
    process.env["CLOUDFLARE_TURN_API_TOKEN"] = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearEnv();
    resetCloudflareTurnCacheForTests();
    vi.restoreAllMocks();
  });

  it("strips the STUN entry from the Cloudflare payload when TOR_ONLY=1", async () => {
    process.env["TOR_ONLY"] = "1";
    installFetch([
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: "turn:turn.cloudflare.com:3478",
        username: "cf-user",
        credential: "cf-cred",
      },
    ]);

    const { status, body } = await getJson();
    expect(status).toBe(200);
    const b = body as { iceServers: { urls: string }[] };
    const serialized = JSON.stringify(b.iceServers);
    expect(serialized).not.toMatch(/stun:/);
    expect(b.iceServers).toEqual([
      {
        urls: "turn:turn.cloudflare.com:3478",
        username: "cf-user",
        credential: "cf-cred",
      },
    ]);
  });

  it("strips STUN members from an array-urls Cloudflare entry under TOR_ONLY", async () => {
    process.env["TOR_ONLY"] = "1";
    installFetch([
      {
        urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478"],
        username: "cf-user",
        credential: "cf-cred",
      },
    ]);

    const { status, body } = await getJson();
    expect(status).toBe(200);
    const b = body as { iceServers: { urls: string[] }[] };
    expect(b.iceServers).toEqual([
      {
        urls: ["turn:turn.cloudflare.com:3478"],
        username: "cf-user",
        credential: "cf-cred",
      },
    ]);
  });

  it("leaves the Cloudflare STUN entry intact when TOR_ONLY is unset", async () => {
    const cfIceServers = [
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: "turn:turn.cloudflare.com:3478",
        username: "cf-user",
        credential: "cf-cred",
      },
    ];
    installFetch(cfIceServers);

    const { status, body } = await getJson();
    expect(status).toBe(200);
    const b = body as { iceServers: { urls: string }[] };
    expect(b.iceServers).toEqual(cfIceServers);
  });
});
