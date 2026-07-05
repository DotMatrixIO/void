// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import iceServersRouter from "../routes/ice-servers";

// Load-bearing fail-closed invariant for task #372: when neither
// STUN_URL nor TURN_URL is configured, the route MUST return an empty
// `iceServers` list — never a Google fallback, never `undefined`,
// never 500. Re-introducing a public (Google) STUN fallback here would
// silently leak both peers' public IPs to a third party on every call;
// this test exists specifically to fail loudly if anyone does.

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/ice-servers fail-closed defaults (#372)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  const savedStun = process.env["STUN_URL"];
  const savedTurnUrl = process.env["TURN_URL"];
  const savedTurnSecret = process.env["TURN_SECRET"];
  // Cloudflare TURN creds may be set in the ambient env (staging Repls
  // have CLOUDFLARE_TURN_TOKEN_ID / CLOUDFLARE_TURN_API_TOKEN as
  // secrets). The fail-closed branch under test here is the
  // unconfigured path; ambient Cloudflare creds would route requests
  // to the Cloudflare branch instead and break these assertions. Save
  // and clear them, restore on teardown. When the Cloudflare branch is
  // removed (post-coturn migration), these six lines become dead code
  // and should be deleted alongside it.
  const savedCfTokenId = process.env["CLOUDFLARE_TURN_TOKEN_ID"];
  const savedCfApiToken = process.env["CLOUDFLARE_TURN_API_TOKEN"];

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
    if (savedStun === undefined) delete process.env["STUN_URL"];
    else process.env["STUN_URL"] = savedStun;
    if (savedTurnUrl === undefined) delete process.env["TURN_URL"];
    else process.env["TURN_URL"] = savedTurnUrl;
    if (savedTurnSecret === undefined) delete process.env["TURN_SECRET"];
    else process.env["TURN_SECRET"] = savedTurnSecret;
    if (savedCfTokenId === undefined) delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    else process.env["CLOUDFLARE_TURN_TOKEN_ID"] = savedCfTokenId;
    if (savedCfApiToken === undefined) delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
    else process.env["CLOUDFLARE_TURN_API_TOKEN"] = savedCfApiToken;
  });

  beforeEach(() => {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  });

  afterEach(() => {
    delete process.env["STUN_URL"];
    delete process.env["TURN_URL"];
    delete process.env["TURN_SECRET"];
    delete process.env["CLOUDFLARE_TURN_TOKEN_ID"];
    delete process.env["CLOUDFLARE_TURN_API_TOKEN"];
  });

  it("returns { iceServers: [], no_turn_configured: true } when neither STUN_URL nor TURN_URL is set", async () => {
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(200);
    // Load-bearing for #372: empty iceServers must still be present.
    expect(body).toEqual({ iceServers: [], no_turn_configured: true });
  });

  it("never returns a Google STUN fallback", async () => {
    const { body } = await getJson(`${baseUrl}/api/ice-servers`);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/google\.com/i);
  });

  it("returns the configured STUN_URL as the only entry when TURN is unset (and flags no_turn_configured)", async () => {
    process.env["STUN_URL"] = "stun:stun.void.example:3478";
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(200);
    expect(body).toEqual({
      iceServers: [{ urls: "stun:stun.void.example:3478" }],
      no_turn_configured: true,
    });
  });

  // Task #530: when TURN is properly configured, the response must NOT
  // carry `no_turn_configured: true` — otherwise the client would
  // perpetually nag operators whose deployments are correct.
  it("omits no_turn_configured (or sets it falsy) when TURN_URL is configured", async () => {
    process.env["TURN_URL"] = "turns:turn.void.example:5349?transport=tcp";
    process.env["TURN_SECRET"] = "test-secret-not-a-placeholder-1234567890";
    const { status, body } = await getJson(`${baseUrl}/api/ice-servers`);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b["iceServers"])).toBe(true);
    expect((b["iceServers"] as unknown[]).length).toBeGreaterThan(0);
    expect(b["no_turn_configured"]).toBeFalsy();
  });
});
