// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import proofBuildRouter, {
  __setReleaseFetchForTest,
  __resetReleaseCacheForTest,
} from "../routes/proof-build";

// Coverage for the /api/proof/latest-release endpoint (task #428).
//
// This endpoint powers the footer's "UPDATE AVAILABLE" hint by resolving
// the latest published release tag to a commit SHA server-side. It must:
//   - be SUPPRESSED under TOR_ONLY (source:"disabled", no SHA)
//   - resolve a real release to a 40-hex SHA (source:"github")
//   - degrade SILENTLY when GitHub is unreachable (source:"unavailable")
//   - rate-limit abusive callers
//
// All branches are exercised hermetically by injecting a fetch stub, so
// the suite never touches the network.

function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function shaTextRes(sha: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => sha,
  } as unknown as Response;
}

describe("GET /api/proof/latest-release", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  const ENV_KEYS = ["TOR_ONLY", "RELEASE_CHECK_REPO"] as const;
  const savedEnv: Record<string, string | undefined> = {};

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

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    __resetReleaseCacheForTest();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    __setReleaseFetchForTest(null);
    __resetReleaseCacheForTest();
  });

  it("is disabled under TOR_ONLY without making any outbound call", async () => {
    process.env.TOR_ONLY = "1";
    let called = false;
    __setReleaseFetchForTest(
      (async () => {
        called = true;
        throw new Error("should not be called");
      }) as unknown as typeof fetch,
    );

    const res = await fetch(`${baseUrl}/api/proof/latest-release`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("disabled");
    expect(body.latestSha).toBeNull();
    expect(body.latestTag).toBeNull();
    expect(called).toBe(false);
  });

  it("is disabled when RELEASE_CHECK_REPO is set to empty", async () => {
    delete process.env.TOR_ONLY;
    process.env.RELEASE_CHECK_REPO = "";

    const res = await fetch(`${baseUrl}/api/proof/latest-release`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("disabled");
    expect(body.latestSha).toBeNull();
  });

  it("resolves the latest release to a 40-hex commit SHA (source github)", async () => {
    delete process.env.TOR_ONLY;
    process.env.RELEASE_CHECK_REPO = "DotMatrixIO/void";
    const SHA = "a".repeat(40);

    __setReleaseFetchForTest((async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/releases/latest")) {
        return jsonRes({
          tag_name: "v1.2.3",
          html_url: "https://github.com/DotMatrixIO/void/releases/tag/v1.2.3",
        });
      }
      if (url.includes("/commits/")) {
        return shaTextRes(SHA);
      }
      throw new Error(`unexpected url: ${url}`);
    }) as unknown as typeof fetch);

    const res = await fetch(`${baseUrl}/api/proof/latest-release`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("github");
    expect(body.latestTag).toBe("v1.2.3");
    expect(body.latestSha).toBe(SHA);
    expect(body.htmlUrl).toBe(
      "https://github.com/DotMatrixIO/void/releases/tag/v1.2.3",
    );
    expect(body.caveat).toMatch(/network path/i);
  });

  it("degrades to unavailable when the upstream release lookup fails", async () => {
    delete process.env.TOR_ONLY;
    process.env.RELEASE_CHECK_REPO = "DotMatrixIO/void";

    __setReleaseFetchForTest((async () => {
      return {
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch);

    const res = await fetch(`${baseUrl}/api/proof/latest-release`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("unavailable");
    expect(body.latestSha).toBeNull();
    expect(body.latestTag).toBeNull();
  });

  it("degrades to unavailable when the tag resolves to a malformed SHA", async () => {
    delete process.env.TOR_ONLY;
    process.env.RELEASE_CHECK_REPO = "DotMatrixIO/void";

    __setReleaseFetchForTest((async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/releases/latest")) {
        return jsonRes({ tag_name: "v1.2.3", html_url: null });
      }
      return shaTextRes("not-a-sha");
    }) as unknown as typeof fetch);

    const res = await fetch(`${baseUrl}/api/proof/latest-release`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.source).toBe("unavailable");
    expect(body.latestSha).toBeNull();
  });

  it("rate-limits abusive callers from a single IP", async () => {
    process.env.TOR_ONLY = "1"; // cheap disabled path, no network
    let saw429 = false;
    for (let i = 0; i < 25; i++) {
      const res = await fetch(`${baseUrl}/api/proof/latest-release`);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});
