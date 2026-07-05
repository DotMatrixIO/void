// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import express from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";

import { createPaywallRouter, __testing as paywallTesting } from "../routes/paywall";
// Disable settlement jitter for all tests in this file — the jitter is a
// privacy mitigation (M-04) that sleeps 10–60 s per first-paid poll, which
// would make integration tests take minutes. Tests verify the functional
// contract; timing-channel properties are not assertable in unit tests.
paywallTesting.overrideJitter(0);
import { simulatePayment } from "../services/lightning";
import { registerSocketHandlers } from "../socketHandlers";
import { ROOM_TTLS, __setRoomExpiresAtForTest } from "../rooms";

// ── End-to-end integration test: paywall HTTP ←→ socket create-room ──────────
//
// Why this test exists (Task #123):
//   The split tests in `paywall-routes.test.ts` and `socket-handlers.test.ts`
//   both exercise the JWT contract, but they sign and verify with two DIFFERENT
//   secrets — paywall-routes uses the module-level PAYWALL_SECRET (an ephemeral
//   random value generated on import), while the socket helper signs its own
//   tokens with TEST_PAYWALL_SECRET. Neither test would catch a refactor that
//   broke the link between how /paywall/status mints JWTs and how the socket
//   handler verifies them — for example, switching one side to a different env
//   var, or changing the claim shape on only one side.
//
// What this test does:
//   1. Wires the REAL paywall router and the REAL socket handler together with
//      a SINGLE explicit secret (no env vars, no module-level fallback).
//   2. Pays an invoice via HTTP, polls /paywall/status, and takes the JWT
//      verbatim from the response body — no test-only minting.
//   3. Connects a socket client and uses that exact JWT for create-room.
//   4. Asserts the resulting room's expiresAt matches both:
//        - the JWT's own `exp` claim (decoded fresh), and
//        - the tier window declared in ROOM_TTLS.
//   Both standard and day tiers are covered; a mismatch in either direction
//   (downgrade, drift, or extension) fails this test.

const SHARED_PAYWALL_SECRET = crypto.randomBytes(32).toString("hex");

interface InvoiceOk {
  invoice: string;
  paymentHash: string;
  amountSats: number;
  tier: string;
}

interface StatusOk {
  paid: true;
  token: string;
  tier: "standard" | "day";
  recoveryCode: string;
  expiresAt: number;
}

interface CreateRoomOk {
  success?: boolean;
  error?: string;
  tier?: "standard" | "day";
  expiresAt?: number | null;
  serverNow?: number;
}

async function postJson(url: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

function emitCreateRoom(
  client: ClientSocket,
  data: { roomId: string; token: string },
): Promise<CreateRoomOk> {
  return new Promise((resolve) => {
    client.emit("create-room", data, (result: CreateRoomOk) => resolve(result));
  });
}

interface ExtendRoomOk {
  success?: boolean;
  error?: string;
  tier?: "standard" | "day";
  expiresAt?: number;
  serverNow?: number;
}

function emitExtendRoom(
  client: ClientSocket,
  data: { code: string; token: string },
): Promise<ExtendRoomOk> {
  return new Promise((resolve) => {
    client.emit("extend-room", data, (result: ExtendRoomOk) => resolve(result));
  });
}

describe("paywall ↔ socket integration: end-to-end JWT contract", () => {
  let httpServer: HttpServer;
  let socketHttpServer: HttpServer;
  let io: SocketIOServer;
  let baseUrl: string;
  let socketPort: number;

  beforeAll(async () => {
    // HTTP server hosting the paywall router, signed with the SHARED secret.
    const app = express();
    app.use(express.json());
    app.use("/api", createPaywallRouter({ secret: SHARED_PAYWALL_SECRET }));
    httpServer = createHttpServer(app);
    await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
    const httpAddr = httpServer.address();
    const httpPort = typeof httpAddr === "object" && httpAddr ? httpAddr.port : 0;
    baseUrl = `http://127.0.0.1:${httpPort}`;

    // Socket server with the socket handler wired to the SAME secret.
    socketHttpServer = createHttpServer();
    io = new SocketIOServer(socketHttpServer, { cors: { origin: "*" } });
    registerSocketHandlers(io, { paywallSecret: SHARED_PAYWALL_SECRET });
    await new Promise<void>((resolve) => socketHttpServer.listen(0, () => resolve()));
    const sockAddr = socketHttpServer.address();
    socketPort = typeof sockAddr === "object" && sockAddr ? sockAddr.port : 0;
  });

  afterAll(async () => {
    io.close();
    await new Promise<void>((r) => socketHttpServer.close(() => r()));
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  /** Walk the full pay → status flow against the HTTP server and return the
   *  JWT verbatim, exactly as a real client would. We intentionally do NOT
   *  reach into the paywall's internal state here — the whole point is to
   *  prove the wire-format JWT round-trips through to the socket handler. */
  async function payAndIssueToken(tier: "standard" | "day"): Promise<StatusOk> {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier });
    expect(inv.status).toBe(200);
    const { paymentHash } = inv.body as InvoiceOk;
    expect(simulatePayment(paymentHash)).toBe(true);
    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(status.status).toBe(200);
    const issued = status.body as StatusOk;
    expect(issued.paid).toBe(true);
    expect(issued.tier).toBe(tier);
    return issued;
  }

  function connectSocket(): Promise<ClientSocket> {
    return new Promise((resolve) => {
      const client = ioClient(`http://localhost:${socketPort}`, { transports: ["websocket"] });
      client.on("connect", () => resolve(client));
    });
  }

  it.each<{ tier: "standard" | "day" }>([
    { tier: "standard" },
    { tier: "day" },
  ])(
    "$tier tier: token from /paywall/status creates a room whose TTL matches ROOM_TTLS[$tier] and outlives the JWT exp",
    async ({ tier }) => {
      const issued = await payAndIssueToken(tier);

      // Decode the issued JWT with the SAME shared secret. If the paywall
      // router and socket handler ever drift onto different secrets, this
      // verify (or the create-room call below) is what catches it.
      const decoded = jwt.verify(issued.token, SHARED_PAYWALL_SECRET) as {
        authorized: boolean;
        tier: "standard" | "day";
        iat: number;
        exp: number;
      };
      expect(decoded.authorized).toBe(true);
      expect(decoded.tier).toBe(tier);

      // Take the JWT verbatim and use it for create-room — no re-signing,
      // no test-only token helper. This is the actual integration assertion.
      const client = await connectSocket();
      try {
        const roomId = crypto.randomBytes(16).toString("hex");
        const result = await emitCreateRoom(client, { roomId, token: issued.token });

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(result.tier).toBe(tier);
        expect(typeof result.expiresAt).toBe("number");
        expect(typeof result.serverNow).toBe("number");

        const expiresAt = result.expiresAt as number;
        const serverNow = result.serverNow as number;

        // The room's wall-clock TTL must match the tier's declared window —
        // this is the assertion that catches a refactor where the JWT's
        // tier claim no longer drives the room's TTL (e.g. socketHandlers
        // ignores the claim and pins everything to standard, or a new tier
        // is added on one side but not the other). Allow a small tolerance
        // for scheduling jitter between the create call and the server
        // timestamping it.
        const ttlMs = ROOM_TTLS[tier];
        const observedTtl = expiresAt - serverNow;
        expect(observedTtl).toBeGreaterThan(ttlMs - 2000);
        expect(observedTtl).toBeLessThanOrEqual(ttlMs);

        // Cross-check the JWT's own validity window against TIERS. The room
        // TTL is intentionally allowed to outlive the JWT (the standard tier
        // grants a 65-min room from a 60-min JWT as a grace buffer), so we
        // can't directly assert expiresAt == decoded.exp. What we CAN assert
        // is that the JWT's exp - iat exactly equals the tier's documented
        // JWT window — a divergence here would mean the paywall mint and the
        // tier table fell out of sync.
        const expectedJwtWindowSec = tier === "day" ? 24 * 60 * 60 : 60 * 60;
        expect(decoded.exp - decoded.iat).toBe(expectedJwtWindowSec);

        // And the room must outlive the JWT (or match it) — never the other
        // way around. A room that expires BEFORE its JWT would mean a host
        // whose payment is still valid gets booted early.
        expect(expiresAt).toBeGreaterThanOrEqual(decoded.exp * 1000 - 1000);
      } finally {
        client.disconnect();
      }
    },
  );

  // ── Recovery-code flow (Task #127) ────────────────────────────────────────
  //
  // /paywall/recover deliberately shrinks the recovered JWT's `expiresIn` to
  // the REMAINING wall-clock seconds of the original paid window. The bug:
  // create-room used to stamp the room with the FULL ROOM_TTLS[tier] and
  // never consult the JWT's `exp`, so a recovery code redeemed near the end
  // of its window would unlock a fresh tier-length room — a stealth upgrade
  // from "a few minutes left" to a full standard (65m) or day (24h) window.
  //
  // We reproduce that scenario by warping the recovery entry's `expiresAt`
  // forward to within ~2 minutes of now (well under both tier ceilings, but
  // comfortably above the room's lower-bound clamp), redeeming it, and then
  // creating a room with the recovered JWT. The room's expiresAt must NOT
  // exceed the (warped) original paid-window expiresAt.
  it.each<{ tier: "standard" | "day" }>([
    { tier: "standard" },
    { tier: "day" },
  ])(
    "$tier tier: recovered JWT near end of paid window does NOT unlock a fresh tier-length room",
    async ({ tier }) => {
      const issued = await payAndIssueToken(tier);
      const recoveryCode = issued.recoveryCode;
      const tierTtlMs = ROOM_TTLS[tier];
      // Standard tier ROOM_TTLS (65m) intentionally exceeds its JWT window
      // (60m) by 5 min as a host-side grace buffer; day tier has 0 grace.
      // The clamp preserves that grace for recoveries too — so the bound on
      // a recovered room is (warpedExpiresAt + tier grace), not the raw
      // warpedExpiresAt. The grace is tiny relative to the bug's behavior
      // (full 65m or 24h fresh room), so this still catches the regression.
      const tierGraceMs = tier === "standard" ? 5 * 60_000 : 0;

      // Find the recovery entry minted by /paywall/status. The code-shape
      // normalization in /paywall/recover means the map key matches what
      // the client sees verbatim.
      const entry = paywallTesting.recoveryCodes.get(recoveryCode);
      expect(entry).toBeDefined();
      if (!entry) throw new Error("recovery entry missing");

      // Warp the original paid window forward to ~2 minutes from now. This
      // is well below ROOM_TTLS.standard (65m) and ROOM_TTLS.day (24h), so
      // any escalation will jump out as a multi-order-of-magnitude TTL gap.
      // Two minutes (not five seconds) keeps us safely above the
      // ROOM_TTL_MIN_MS lower-bound clamp inside createRoom — that clamp
      // exists so a host whose JWT has only seconds left isn't booted
      // mid-handshake, and we don't want it to mask the bug we're testing.
      const warpedExpiresAt = Date.now() + 120_000;
      entry.expiresAt = warpedExpiresAt;

      // Redeem the (now-near-expiry) recovery code via the real HTTP route.
      const recovered = await postJson(`${baseUrl}/api/paywall/recover`, { code: recoveryCode });
      expect(recovered.status).toBe(200);
      const recoveredBody = recovered.body as { token: string; tier: "standard" | "day"; expiresAt: number };
      expect(recoveredBody.tier).toBe(tier);
      expect(recoveredBody.expiresAt).toBe(warpedExpiresAt);

      // The recovered JWT's exp must reflect the SHRUNK remaining window,
      // not the full tier window. This is the recover-route invariant the
      // socket clamp depends on.
      const decoded = jwt.verify(recoveredBody.token, SHARED_PAYWALL_SECRET) as {
        authorized: boolean;
        tier: "standard" | "day";
        iat: number;
        exp: number;
      };
      expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(121);
      expect(decoded.exp - decoded.iat).toBeGreaterThan(60);

      // Hand the recovered JWT to create-room and confirm the room is
      // bounded by the original paid window — NOT by ROOM_TTLS[tier].
      const client = await connectSocket();
      try {
        const roomId = crypto.randomBytes(16).toString("hex");
        const result = await emitCreateRoom(client, { roomId, token: recoveredBody.token });

        expect(result.error).toBeUndefined();
        expect(result.success).toBe(true);
        expect(result.tier).toBe(tier);
        expect(typeof result.expiresAt).toBe("number");

        const roomExpiresAt = result.expiresAt as number;

        // PRIMARY ASSERTION: the room must not outlive the original paid
        // window (plus the tier's natural grace buffer). We allow a 1.5s
        // tolerance because /paywall/recover stores remainingSeconds as
        // floor((entry.expiresAt - now) / 1000), so the JWT's exp can be
        // up to ~1s less than warpedExpiresAt, and the socket clamp adds
        // another small jitter. The bug we're catching produces a TTL of
        // 65m or 24h above the window — orders of magnitude larger than
        // either of these terms.
        expect(roomExpiresAt).toBeLessThanOrEqual(warpedExpiresAt + tierGraceMs + 1500);

        // SECONDARY ASSERTION: the room must be much smaller than the full
        // tier window. If the bug regresses (e.g. someone removes the
        // clamp), this assertion fails dramatically — observed TTL would
        // be ~65 minutes (standard) or ~24 hours (day) instead of ~2 min
        // (or ~7 min for standard, with grace).
        const observedTtl = roomExpiresAt - Date.now();
        expect(observedTtl).toBeLessThan(tierTtlMs / 2);
        expect(observedTtl).toBeGreaterThan(60_000);
      } finally {
        client.disconnect();
      }
    },
  );

  // ── Task #141: extension clamp on near-expiry recovery JWTs ──────────────
  //
  // Mirror of the create-room recovery test above for the extend-room handler.
  // Pre-fix, the extend handler added the FULL ROOM_TTLS[tier] (standard:
  // 65m, day: 24h) to the room's expiresAt on every successful extension and
  // never consulted the JWT's `exp`. A host who redeemed a recovery code
  // with only minutes left in their original paid window could then extend
  // their existing room by a full tier window — the same stealth paid-window
  // upgrade Task #127 closed for room creation, but on the extension path.
  //
  // Reproduction: pay → create the room with the original full JWT (so we
  // have something to extend), warp the recovery entry forward, redeem the
  // (now-near-expiry) recovery code, then call extend-room with the
  // shrunken JWT and assert the extension delta is bounded by the JWT's
  // remaining proof (plus tier grace), not by ROOM_TTLS[tier].
  it.each<{ tier: "standard" | "day" }>([
    { tier: "standard" },
    { tier: "day" },
  ])(
    "$tier tier: recovered JWT near end of paid window does NOT unlock a fresh tier-length extension",
    async ({ tier }) => {
      const issued = await payAndIssueToken(tier);
      const recoveryCode = issued.recoveryCode;
      const tierTtlMs = ROOM_TTLS[tier];
      // Same grace contract as the create-room recovery test: standard
      // gets 5 min of grace (ROOM_TTLS.standard 65m vs 60m JWT window),
      // day tier has 0 grace (room TTL == window).
      const tierGraceMs = tier === "standard" ? 5 * 60_000 : 0;

      const client = await connectSocket();
      try {
        // Create the room with the ORIGINAL full JWT first. The original
        // `jti` gets consumed by create-room's one-payment-one-room
        // map; that's fine — extend-room has its own consumption map keyed
        // by token hash, so the recovered JWT (different signature) sails
        // through the extension path without colliding.
        const roomId = crypto.randomBytes(16).toString("hex");
        const created = await emitCreateRoom(client, { roomId, token: issued.token });
        expect(created.success).toBe(true);
        expect(typeof created.expiresAt).toBe("number");

        // Warp BOTH the room's expiresAt AND the recovery entry's
        // expiresAt forward to ~2 minutes from now. The room warp is
        // necessary for the day tier: createRoom stamps day rooms at the
        // 24h ROOM_TTL_MAX_MS ceiling, and extendRoomExpiry then clamps
        // any addition back down to that ceiling — so a buggy 24h
        // additionalMs would observe delta ≈ 0, masking the regression.
        // Warping the room back to "near end of window" is what real
        // hosts experience after spending most of their paid window in
        // the room, and lets the additionalMs value drive the observed
        // delta directly.
        const warpedExpiresAt = Date.now() + 120_000;
        expect(__setRoomExpiresAtForTest(roomId, warpedExpiresAt)).toBe(true);
        const oldExpiresAt = warpedExpiresAt;

        // Two minutes (not seconds) keeps us above the recover-route's
        // floor() rounding so the recovered JWT still has > 60s of proof.
        const entry = paywallTesting.recoveryCodes.get(recoveryCode);
        expect(entry).toBeDefined();
        if (!entry) throw new Error("recovery entry missing");
        entry.expiresAt = warpedExpiresAt;

        // Redeem the now-near-expiry recovery code and immediately use
        // the shrunken JWT to extend the room.
        const recovered = await postJson(`${baseUrl}/api/paywall/recover`, { code: recoveryCode });
        expect(recovered.status).toBe(200);
        const recoveredBody = recovered.body as { token: string; tier: "standard" | "day"; expiresAt: number };
        expect(recoveredBody.tier).toBe(tier);

        const extended = await emitExtendRoom(client, { code: roomId, token: recoveredBody.token });
        expect(extended.error).toBeUndefined();
        expect(extended.success).toBe(true);
        expect(extended.tier).toBe(tier);
        expect(typeof extended.expiresAt).toBe("number");

        const newExpiresAt = extended.expiresAt as number;
        const delta = newExpiresAt - oldExpiresAt;
        const jwtRemainingMs = warpedExpiresAt - Date.now();

        // PRIMARY ASSERTION: the extension delta must be bounded by the
        // JWT's remaining proof (plus the tier's natural grace buffer).
        // Pre-fix, delta == ROOM_TTLS[tier] — orders of magnitude above
        // this bound. The 1500ms tolerance covers the recover-route's
        // floor()ing of remainingSeconds and small scheduling jitter
        // between issuing the JWT and the socket clamp reading `now`.
        expect(delta).toBeLessThanOrEqual(jwtRemainingMs + tierGraceMs + 1500);

        // SECONDARY ASSERTION: the extension delta must be much smaller
        // than the full tier window. If a future change drops the clamp,
        // this fails dramatically — observed delta would jump from a few
        // minutes to ~65 minutes (standard) or ~24 hours (day).
        expect(delta).toBeLessThan(tierTtlMs / 2);
        // And the extension must actually grant something — sanity check
        // that the clamp didn't accidentally drop the extension to zero.
        expect(delta).toBeGreaterThan(60_000);
      } finally {
        client.disconnect();
      }
    },
  );

  it("rejects a JWT signed with a DIFFERENT secret (regression: secret-isolation guard)", async () => {
    // This test guards the inverse direction: if a future refactor accidentally
    // made the socket handler accept tokens signed under any secret (e.g. by
    // dropping the verify step or falling back to a second key), the previous
    // tests would still pass. Sign with an unrelated secret and confirm the
    // socket handler rejects it.
    const wrongSecret = crypto.randomBytes(32).toString("hex");
    const badToken = jwt.sign({ authorized: true, tier: "standard", paymentHash: crypto.randomBytes(32).toString("hex") }, wrongSecret, { expiresIn: "1h" });

    const client = await connectSocket();
    try {
      const roomId = crypto.randomBytes(16).toString("hex");
      const result = await emitCreateRoom(client, { roomId, token: badToken });
      expect(result.success).toBeUndefined();
      expect(result.error).toBe("PAYMENT_REQUIRED");
    } finally {
      client.disconnect();
    }
  });

  // ── Task #169: one paid invoice → one room ────────────────────────────────
  //
  // Regression test for audit finding H-05. Before the fix, the JWT minted
  // by /paywall/status had no replay-guard claim and was not consumed at
  // create-room — a host could replay one paid invoice's JWT to create up
  // to ~600 standard rooms (per-socket rate limit × 60-min window) or
  // ~14,400 day rooms, breaking the documented "one payment = one room"
  // model and exhausting server memory at near-zero attacker cost.
  //
  // The fix has two halves and this test exercises both end-to-end:
  //   1. paywall.ts mints the JWT with a server-minted random `jti` in the
  //      payload (Task #889 replaced the Lightning `paymentHash` here so
  //      nothing payment-derived ever reaches the client).
  //   2. accessController.ts tracks consumed `jti`s and rejects reuse
  //      with a clear, dedicated error code.
  //
  // We pay one invoice, take its JWT verbatim, create a room with it
  // successfully, then attempt a SECOND create-room with the SAME JWT
  // (different roomId) and assert the dedicated rejection. Using a fresh
  // roomId rules out the pre-existing ROOM_EXISTS guard masking the new
  // one — only the new consumed-token check can trip on this path.
  it("rejects re-use of the same paywall JWT for a second room (one paid invoice → one room, H-05)", async () => {
    const issued = await payAndIssueToken("standard");

    const client = await connectSocket();
    try {
      // First create-room: must succeed.
      const firstRoomId = crypto.randomBytes(16).toString("hex");
      const first = await emitCreateRoom(client, { roomId: firstRoomId, token: issued.token });
      expect(first.error).toBeUndefined();
      expect(first.success).toBe(true);

      // Second create-room with the SAME JWT but a DIFFERENT roomId. Pre-fix
      // this would have succeeded (the only mutex was on roomId). Post-fix
      // the consumed-`jti` map rejects with TOKEN_ALREADY_USED.
      const secondRoomId = crypto.randomBytes(16).toString("hex");
      expect(secondRoomId).not.toBe(firstRoomId);
      const second = await emitCreateRoom(client, { roomId: secondRoomId, token: issued.token });
      expect(second.success).toBeUndefined();
      expect(second.error).toBe("TOKEN_ALREADY_USED");
    } finally {
      client.disconnect();
    }
  });

  it("rejects a JWT that lacks the jti claim (closes the no-claim bypass for H-05)", async () => {
    // An attacker who somehow obtains a valid JWT signature without the
    // `jti` claim would otherwise sail past the consumed-token check
    // (no key to look up). The handler treats a missing claim as a hard
    // reject. This guards against (a) legacy in-flight tokens minted before
    // the claim was added and (b) any future code path that forgets to set it.
    const tokenNoJti = jwt.sign({ authorized: true, tier: "standard" }, SHARED_PAYWALL_SECRET, { expiresIn: "1h" });

    const client = await connectSocket();
    try {
      const roomId = crypto.randomBytes(16).toString("hex");
      const result = await emitCreateRoom(client, { roomId, token: tokenNoJti });
      expect(result.success).toBeUndefined();
      expect(result.error).toBe("PAYMENT_REQUIRED");
    } finally {
      client.disconnect();
    }
  });

  // ── Task #889: the JWT shipped to the client carries NO payment-derived value
  //
  // The host-authorization JWT lives in the browser's `sessionStorage`, so any
  // value embedded in it is exfiltrable by an XSS/supply-chain vector. The
  // single-use create-room replay guard previously keyed on the Lightning
  // `paymentHash` and shipped it in the JWT; it now keys on a fresh
  // server-minted random `jti` instead. This test verifies the wire payload of
  // a real /paywall/status JWT: it MUST carry a `jti` and MUST NOT carry a
  // `paymentHash` (or any value equal to the settled invoice's payment hash).
  it("issues a JWT carrying a random jti and no paymentHash (Task #889)", async () => {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
    expect(inv.status).toBe(200);
    const { paymentHash } = inv.body as { paymentHash: string };
    expect(simulatePayment(paymentHash)).toBe(true);

    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(status.status).toBe(200);
    const issued = status.body as { token: string };

    const decoded = jwt.verify(issued.token, SHARED_PAYWALL_SECRET) as Record<string, unknown>;
    expect(typeof decoded.jti).toBe("string");
    expect((decoded.jti as string).length).toBeGreaterThanOrEqual(32);
    // No payment-derived value reaches the client: neither a `paymentHash`
    // claim nor any claim whose value equals the settled invoice's hash.
    expect(decoded).not.toHaveProperty("paymentHash");
    expect(Object.values(decoded)).not.toContain(paymentHash);
  });
});
