// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import roomStateRouter, { RATE_MAX } from "../routes/room-state";
import { createRoom, joinRoom, destroyRoom, ROOM_TTLS } from "../rooms";

function freshCode(): string {
  return Array.from({ length: 32 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

describe("GET /api/room-state/:code", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use("/api", roomStateRouter);
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

  let code: string;
  beforeEach(() => {
    code = freshCode();
  });

  it("returns 400 INVALID_CODE for a too-short code", async () => {
    const { status, body } = await getJson(`${baseUrl}/api/room-state/abc`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "INVALID_CODE" });
  });

  it("returns 400 INVALID_CODE for an uppercase code", async () => {
    const upper = freshCode().toUpperCase();
    const { status, body } = await getJson(`${baseUrl}/api/room-state/${upper}`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "INVALID_CODE" });
  });

  it("returns 400 INVALID_CODE for a code with a non-hex char", async () => {
    const dirty = freshCode().slice(0, 31) + "g";
    const { status, body } = await getJson(`${baseUrl}/api/room-state/${dirty}`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: "INVALID_CODE" });
  });

  it("returns 200 with literal {} for a well-formed code with no live room", async () => {
    const { status, body } = await getJson(`${baseUrl}/api/room-state/${code}`);
    expect(status).toBe(200);
    expect(body).toEqual({});
  });

  it("returns the snapshot with public tier names for an active room", async () => {
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");
    joinRoom(code, "guest-socket", "peer-bbbbbb");

    const { status, body } = await getJson(`${baseUrl}/api/room-state/${code}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      exists: true,
      tier: "free",
      participantCount: 2,
      relayOnly: false,
    });
    const obj = body as Record<string, unknown>;
    expect(typeof obj["expiresAt"]).toBe("number");
    expect(obj["expiresAt"]).toBeGreaterThan(Date.now());
    expect(Object.keys(obj).sort()).toEqual(
      ["exists", "expiresAt", "participantCount", "relayOnly", "tier"].sort(),
    );
  });

  it("collapses a destroyed room into {} (same as never-existed)", async () => {
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");
    destroyRoom(code, "host-socket");

    const { status, body } = await getJson(`${baseUrl}/api/room-state/${code}`);
    expect(status).toBe(200);
    expect(body).toEqual({});
  });

  it("maps internal day-tier to public tier=paid_24h", async () => {
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.day, "day");
    joinRoom(code, "host-socket", "peer-aaaaaa");
    const { body } = await getJson(`${baseUrl}/api/room-state/${code}`);
    expect((body as Record<string, unknown>)["tier"]).toBe("paid_24h");
  });

  it("returns 429 RATE_LIMITED once the per-IP ceiling is exceeded, with a request under the ceiling still returning the normal body", async () => {
    // The route enforces a per-IP bucket (RATE_MAX requests / RATE_WINDOW_MS,
    // 10/minute). The module-level bucket is keyed by client IP and is shared
    // across every test in this file (all on loopback), so this test does not
    // assume an exact remaining count: it fires more than RATE_MAX requests
    // and asserts that (a) at least one request under the ceiling returned the
    // normal {} body, and (b) once the ceiling is crossed the route replies
    // 429 with the RATE_LIMITED wire shape used by /api/ice-servers.
    // RATE_MAX is imported from the route so the ceiling is a single
    // source of truth shared by runtime and test.
    const url = `${baseUrl}/api/room-state/${code}`;

    let sawNormalBody = false;
    let overLimit: { status: number; body: unknown } | null = null;
    for (let i = 0; i < RATE_MAX + 5; i++) {
      const res = await getJson(url);
      if (res.status === 200) {
        sawNormalBody = true;
        expect(res.body).toEqual({});
      } else {
        overLimit = res;
        break;
      }
    }

    expect(sawNormalBody).toBe(true);
    expect(overLimit).not.toBeNull();
    expect(overLimit?.status).toBe(429);
    expect(overLimit?.body).toEqual({ error: "RATE_LIMITED" });
  });
});
