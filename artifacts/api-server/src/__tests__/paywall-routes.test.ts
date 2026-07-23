// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import paywallRouter, { PAYWALL_SECRET, __testing } from "../routes/paywall";
import { simulatePayment } from "../services/lightning";
import { logger } from "../lib/logger";

interface InvoiceOk {
  invoice: string;
  paymentHash: string;
  amountSats: number;
  tier: string;
}

interface InvoiceErr {
  error: string;
  tier?: unknown;
}

interface StatusOk {
  paid: true;
  token: string;
  tier: string;
  recoveryCode: string;
  expiresAt: number;
}

interface RecoverOk {
  token: string;
  tier: string;
  expiresAt: number;
}

interface RecoverErr {
  error: string;
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

describe("GET /paywall/status/:paymentHash ID validation (SSRF route boundary)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
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
    delete process.env["LIGHTNING_BACKEND"];
  });

  it("rejects a traversal-style ID with 400 (default backend)", async () => {
    delete process.env["LIGHTNING_BACKEND"];
    // %2e%2e%2f decodes to ../ in the route param — must never reach the
    // Lightning adapter's URL interpolation.
    const res = await fetch(`${baseUrl}/api/paywall/status/%2e%2e%2fdev-pay%2fx`);
    expect(res.status).toBe(400);
  });

  it("rejects a traversal-style ID with 400 under the BTCPay backend", async () => {
    process.env["LIGHTNING_BACKEND"] = "btcpay";
    const res = await fetch(`${baseUrl}/api/paywall/status/%2e%2e%2f%2e%2e%2fapi%2fv1%2fserver`);
    expect(res.status).toBe(400);
  });

  it("rejects BTCPay IDs containing dots, slashes, or percent signs", async () => {
    process.env["LIGHTNING_BACKEND"] = "btcpay";
    for (const bad of [
      "abc.def.ghi.jkl",
      "abcdef%2fghijkl",
      "abcde fghijklmn",
      "short",
      "a".repeat(65),
    ]) {
      const res = await fetch(`${baseUrl}/api/paywall/status/${encodeURIComponent(bad)}`);
      expect(res.status, `expected 400 for ${JSON.stringify(bad)}`).toBe(400);
    }
  });

  it("accepts a well-formed alphanumeric BTCPay invoice ID (not 400)", async () => {
    process.env["LIGHTNING_BACKEND"] = "btcpay";
    const res = await fetch(`${baseUrl}/api/paywall/status/AbCdEf123456_-X`);
    // The mock pending map has no such invoice, so paid=false — but the ID
    // itself must pass validation (i.e. anything except 400 is acceptable).
    expect(res.status).not.toBe(400);
  });
});

describe("POST /paywall/invoice tier validation", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    // Match production app.ts: trust 1 reverse-proxy hop so req.ip reflects
    // the actual client (the IP appended by the trusted proxy), and not a
    // spoofable leftmost X-Forwarded-For token.
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
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

  it("accepts the standard tier", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
    expect(status).toBe(200);
    const ok = body as InvoiceOk;
    expect(ok.tier).toBe("standard");
    expect(ok.amountSats).toBe(1000);
    expect(typeof ok.invoice).toBe("string");
    expect(typeof ok.paymentHash).toBe("string");
  });

  it("accepts the day tier", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "day" });
    expect(status).toBe(200);
    const ok = body as InvoiceOk;
    expect(ok.tier).toBe("day");
    expect(ok.amountSats).toBe(5000);
  });

  it("rejects the legacy week tier with 400 (no silent downgrade)", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "week" });
    expect(status).toBe(400);
    const err = body as InvoiceErr;
    expect(err.error).toBe("Unknown tier");
    expect(err.tier).toBe("week");
  });

  it("rejects an arbitrary unknown tier with 400", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "year" });
    expect(status).toBe(400);
    const err = body as InvoiceErr;
    expect(err.error).toBe("Unknown tier");
  });

  it("rejects an explicit null tier with 400 (locks in strict validation; null !== omitted)", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: null });
    expect(status).toBe(400);
    const err = body as InvoiceErr;
    expect(err.error).toBe("Unknown tier");
    expect(err.tier).toBe(null);
  });

  it("rejects a non-string tier with 400", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: 42 });
    expect(status).toBe(400);
    const err = body as InvoiceErr;
    expect(err.error).toBe("Unknown tier");
    expect(err.tier).toBe(42);
  });

  it("defaults to standard when tier is omitted", async () => {
    const { status, body } = await postJson(`${baseUrl}/api/paywall/invoice`, {});
    expect(status).toBe(200);
    const ok = body as InvoiceOk;
    expect(ok.tier).toBe("standard");
    expect(ok.amountSats).toBe(1000);
  });
});

describe("recovery code lifecycle", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Disable the M-04 jitter so tests complete in milliseconds, not minutes.
    __testing.overrideJitter(0);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  // Walk the full pay→status→recover loop using the in-memory dev Lightning
  // backend. Each test mints a fresh paymentHash so the cases stay isolated.
  async function payAndIssue(tier: "standard" | "day"): Promise<StatusOk & { paymentHash: string }> {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier });
    expect(inv.status).toBe(200);
    const { paymentHash } = inv.body as InvoiceOk;
    expect(simulatePayment(paymentHash)).toBe(true);
    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(status.status).toBe(200);
    return { ...(status.body as StatusOk), paymentHash };
  }

  it("issues a recovery code alongside the JWT on successful payment", async () => {
    const issued = await payAndIssue("standard");
    expect(issued.tier).toBe("standard");
    expect(typeof issued.token).toBe("string");
    // 4 BIP-39 words, lowercase, single space separator.
    expect(issued.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
    expect(typeof issued.expiresAt).toBe("number");
    // Standard window is 1h ≈ 3600s; allow loose bounds for test scheduling.
    const remainingMs = issued.expiresAt - Date.now();
    expect(remainingMs).toBeGreaterThan(60 * 60 * 1000 - 5000);
    expect(remainingMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it("redeem succeeds once and returns a fresh JWT bound to the same tier and expiry", async () => {
    const issued = await payAndIssue("day");
    const res = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    expect(res.status).toBe(200);
    const ok = res.body as RecoverOk;
    expect(ok.tier).toBe("day");
    expect(ok.expiresAt).toBe(issued.expiresAt);
    // The fresh JWT must be a valid paywall token with the same tier claim.
    const decoded = jwt.verify(ok.token, PAYWALL_SECRET) as { authorized: boolean; tier: string; exp: number };
    expect(decoded.authorized).toBe(true);
    expect(decoded.tier).toBe("day");
    // exp (seconds) must not exceed the original window's wall-clock expiry.
    expect(decoded.exp * 1000).toBeLessThanOrEqual(issued.expiresAt + 1000);
  });

  it("redeem fails on second use (single-shot, even with the right code)", async () => {
    const issued = await payAndIssue("standard");
    const first = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    expect(first.status).toBe(200);
    const second = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    expect(second.status).toBe(404);
    expect((second.body as RecoverErr).error).toMatch(/unknown|already/i);
  });

  it("redeem fails on an invalid (never-issued) code", async () => {
    const res = await postJson(`${baseUrl}/api/paywall/recover`, {
      code: "abandon ability able about",
    });
    // The code is well-formed but was never issued — must 404, not 400.
    expect(res.status).toBe(404);
  });

  it("redeem fails with 404 (not 410) after the underlying paid window has expired", async () => {
    const issued = await payAndIssue("standard");
    // Fast-forward by mutating the entry's expiresAt directly. We don't fake
    // the clock here because jwt.sign reads its own clock and a faked clock
    // would also corrupt the issuance step above.
    const entry = __testing.recoveryCodes.get(issued.recoveryCode);
    expect(entry).toBeDefined();
    if (entry) entry.expiresAt = Date.now() - 1000;
    const res = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    // Expired must NOT surface a distinct 410 — that leaked that a guessed
    // code was once valid. It is now folded into the same 404 as unknown.
    expect(res.status).toBe(404);
    expect((res.body as RecoverErr).error).toMatch(/unknown|already/i);
    // And the entry should be gone afterwards (consumed on access).
    expect(__testing.recoveryCodes.has(issued.recoveryCode)).toBe(false);
  });

  it("unknown, redeemed, and expired codes are INDISTINGUISHABLE (identical status, body, and headers)", async () => {
    // This case makes several recover calls; reset the per-IP limiter so it
    // doesn't drain the budget shared (no per-test reset) by sibling tests.
    __testing.resetRecoverRateLimit();
    // Capture status + raw body + a header snapshot (minus the volatile
    // Date header). Single-shot consume-on-access means each probe must use
    // a fresh, already-consumed/never-valid code.
    async function probe(code: string): Promise<{
      status: number;
      body: string;
      headers: Record<string, string>;
    }> {
      const res = await fetch(`${baseUrl}/api/paywall/recover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.text();
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        if (k.toLowerCase() === "date") return;
        headers[k.toLowerCase()] = v;
      });
      return { status: res.status, body, headers };
    }

    // (1) Unknown — well-formed but never issued.
    const unknown = await probe("abandon ability able absent");

    // (2) Redeemed — issue, redeem once, then probe the spent code.
    const redeemedIssue = await payAndIssue("standard");
    const firstRedeem = await postJson(`${baseUrl}/api/paywall/recover`, {
      code: redeemedIssue.recoveryCode,
    });
    expect(firstRedeem.status).toBe(200);
    const redeemed = await probe(redeemedIssue.recoveryCode);

    // (3) Expired — issue, force the window into the past, then probe.
    const expiredIssue = await payAndIssue("standard");
    const expiredEntry = __testing.recoveryCodes.get(expiredIssue.recoveryCode);
    expect(expiredEntry).toBeDefined();
    if (expiredEntry) expiredEntry.expiresAt = Date.now() - 1000;
    const expired = await probe(expiredIssue.recoveryCode);

    // All three must be byte-identical in the response an attacker sees.
    expect(unknown.status).toBe(404);
    expect(redeemed.status).toBe(404);
    expect(expired.status).toBe(404);
    expect(redeemed.body).toBe(unknown.body);
    expect(expired.body).toBe(unknown.body);
    expect(redeemed.headers).toEqual(unknown.headers);
    expect(expired.headers).toEqual(unknown.headers);
  });

  it("redeem rejects malformed input with 400 (wrong word count)", async () => {
    const res = await postJson(`${baseUrl}/api/paywall/recover`, { code: "abandon ability able" });
    expect(res.status).toBe(400);
  });

  it("redeem rejects non-string input with 400", async () => {
    const res = await postJson(`${baseUrl}/api/paywall/recover`, { code: 12345 });
    expect(res.status).toBe(400);
  });

  it("redeem rejects words containing non-letters with 400", async () => {
    const res = await postJson(`${baseUrl}/api/paywall/recover`, {
      code: "abandon ability able about1",
    });
    expect(res.status).toBe(400);
  });

  it("redeem rejects four well-formed but non-BIP-39 words with 400", async () => {
    // All lowercase letters but none of these are in the BIP-39 wordlist —
    // a typo at this stage should fail fast at validation rather than
    // silently 404 at the lookup, helping legit users self-correct.
    const res = await postJson(`${baseUrl}/api/paywall/recover`, {
      code: "qwertyqq asdfgh zxcvbn poiuyt",
    });
    expect(res.status).toBe(400);
  });

  // ── Re-poll invariants ────────────────────────────────────────────────────
  // These guard the core "never extend the paid window" property of Task #117.
  // A host who refreshes the paywall modal (or whose client retries the poll)
  // must NOT be able to mint a fresh JWT with a later expiry, downgrade the
  // tier they paid for, or get a SECOND (different) recovery code. Since
  // Task #1143 the SAME code is re-included until the client acks receipt —
  // see the ack-recovery describe block below for the full delivery matrix.

  it("re-polling /paywall/status returns the same token and expiresAt", async () => {
    const first = await payAndIssue("standard");
    const second = await getJson(`${baseUrl}/api/paywall/status/${first.paymentHash}`);
    expect(second.status).toBe(200);
    const repoll = second.body as { paid: true; token: string; tier: string; expiresAt: number; recoveryCode?: string };
    expect(repoll.paid).toBe(true);
    expect(repoll.token).toBe(first.token);
    expect(repoll.expiresAt).toBe(first.expiresAt);
  });

  it("re-polling /paywall/status re-includes the SAME code until acked, never mints a second", async () => {
    const first = await payAndIssue("standard");
    const paymentHash = first.paymentHash;
    const codeCountBefore = __testing.recoveryCodes.size;
    const second = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(second.status).toBe(200);
    const repoll = second.body as { recoveryCode?: string };
    // Task #1143 ack-based delivery: before the ack, the re-poll carries the
    // IDENTICAL code (delivery-race fix) — never a fresh one.
    expect(repoll.recoveryCode).toBe(first.recoveryCode);
    // The map size must not have grown — no second code was minted.
    expect(__testing.recoveryCodes.size).toBe(codeCountBefore);

    // After the ack, the code disappears from status responses forever.
    const ack = await postJson(`${baseUrl}/api/paywall/ack-recovery`, { paymentHash });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ ok: true });
    const third = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect((third.body as { recoveryCode?: string }).recoveryCode).toBeUndefined();
  });

  // ── Ack-recovery abuse matrix (Task #1143) ────────────────────────────────
  it("replayed acks are idempotent and never re-expose the code or touch expiry", async () => {
    const issued = await payAndIssue("standard");
    const paymentHash = issued.paymentHash;
    const stateBefore = __testing.invoiceStates.get(paymentHash);
    const expiresBefore = stateBefore!.settled!.expiresAt;

    // First ack deletes the delivery copy.
    const ack1 = await postJson(`${baseUrl}/api/paywall/ack-recovery`, { paymentHash });
    expect(ack1.body).toEqual({ ok: true });
    expect(__testing.invoiceStates.get(paymentHash)!.settled!.recoveryCode).toBeUndefined();

    // Replayed acks: identical response, no state change, no expiry change.
    for (let i = 0; i < 3; i++) {
      const ackN = await postJson(`${baseUrl}/api/paywall/ack-recovery`, { paymentHash });
      expect(ackN.status).toBe(200);
      expect(ackN.body).toEqual({ ok: true });
    }
    const stateAfter = __testing.invoiceStates.get(paymentHash)!;
    expect(stateAfter.settled!.expiresAt).toBe(expiresBefore);

    // An attacker replaying status polls after the ack never re-obtains the code…
    const poll = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    const body = poll.body as { token: string; expiresAt: number; recoveryCode?: string };
    expect(body.recoveryCode).toBeUndefined();
    // …and the token/window are untouched (no extension via ack/poll games).
    expect(body.token).toBe(issued.token);
    expect(body.expiresAt).toBe(expiresBefore);

    // The REDEEMABLE copy is unaffected by acks — the code still redeems once.
    const redeem = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    expect(redeem.status).toBe(200);
    expect((redeem.body as RecoverOk).expiresAt).toBe(expiresBefore);
  });

  it("ack responds { ok: true } identically for unknown, malformed, and unpaid hashes", async () => {
    // Unknown well-formed hash.
    const unknown = await postJson(`${baseUrl}/api/paywall/ack-recovery`, {
      paymentHash: "f".repeat(64),
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ ok: true });

    // Malformed hashes and bodies — same response, no oracle.
    for (const bad of ["../etc/passwd", "", 42, null, undefined]) {
      const res = await postJson(`${baseUrl}/api/paywall/ack-recovery`, { paymentHash: bad });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }

    // Unpaid invoice: ack is a no-op — a later settlement still delivers the code.
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
    const { paymentHash } = inv.body as InvoiceOk;
    const preAck = await postJson(`${baseUrl}/api/paywall/ack-recovery`, { paymentHash });
    expect(preAck.body).toEqual({ ok: true });
    expect(simulatePayment(paymentHash)).toBe(true);
    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    const ok = status.body as StatusOk;
    expect(ok.paid).toBe(true);
    expect(ok.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
  });

  it("re-polling preserves the paid tier (day stays day, never downgrades)", async () => {
    const first = await payAndIssue("day");
    expect(first.tier).toBe("day");
    const paymentHash = first.paymentHash;
    const second = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(second.status).toBe(200);
    const repoll = second.body as { tier: string; expiresAt: number };
    expect(repoll.tier).toBe("day");
    // 24h window — must still be ~24h from issuance, not ~1h (would indicate downgrade).
    expect(repoll.expiresAt - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
  });

  // Audit M-1 (task #464) regression test: if jwt.sign throws after the
  // recovery code has already been deleted from the in-memory map, the
  // pre-fix code surfaced a 500 AND silently lost the code — the paying
  // user could never recover their paid window. Post-fix, the entry is
  // restored with its ORIGINAL expiresAt and a retry succeeds.
  it("restores the recovery code (and preserves its original expiresAt) when jwt.sign throws", async () => {
    const issued = await payAndIssue("standard");
    const codeEntryBefore = __testing.recoveryCodes.get(issued.recoveryCode);
    expect(codeEntryBefore).toBeDefined();
    const originalExpiresAt = codeEntryBefore!.expiresAt;

    // Force the next jwt.sign call to throw. Restore right after so the
    // retry below uses the real implementation.
    const signSpy = vi.spyOn(jwt, "sign").mockImplementation(() => {
      throw new Error("simulated kms outage");
    });

    const failed = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    signSpy.mockRestore();

    expect(failed.status).toBe(500);
    expect((failed.body as { error: string }).error).toMatch(/retry/i);

    // The code must still be present in the in-memory map.
    const restored = __testing.recoveryCodes.get(issued.recoveryCode);
    expect(restored).toBeDefined();
    // And critically: its expiresAt is the ORIGINAL value, not bumped.
    // Bumping on every throw would let a paid window be extended past
    // its bought duration by triggering sign failures.
    expect(restored!.expiresAt).toBe(originalExpiresAt);

    // The failed attempt counted against the per-IP /recover rate-limit
    // bucket. Clear it so the retry isn't 429'd by the limiter that's
    // unrelated to the M-1 fix under test.
    __testing.resetRecoverRateLimit();

    // Retry must succeed and return a fresh JWT bound to the same tier
    // and the same expiresAt.
    const retry = await postJson(`${baseUrl}/api/paywall/recover`, { code: issued.recoveryCode });
    expect(retry.status).toBe(200);
    const ok = retry.body as RecoverOk;
    expect(ok.tier).toBe("standard");
    expect(ok.expiresAt).toBe(originalExpiresAt);

    // After the successful retry, the code is single-shot consumed.
    expect(__testing.recoveryCodes.has(issued.recoveryCode)).toBe(false);
  });
});

// ── Abnormal-payment matrix (Task #747) ──────────────────────────────────────
//
// These guard the launch-gate failure modes that a real Lightning backend can
// surface but the happy-path tests never exercise: a host paying too little,
// paying too much, a duplicate/replayed settlement notification, and multiple
// invoices settling concurrently. The mock backend's amount-aware seam
// (simulatePayment(hash, receivedSats)) lets us drive each branch through the
// real express router + paywall handlers end-to-end.
describe("abnormal payment amounts", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    __testing.overrideJitter(0);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("underpayment never settles: status stays {paid:false} and no token is minted", async () => {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
    expect(inv.status).toBe(200);
    const { paymentHash, amountSats } = inv.body as InvoiceOk;
    expect(amountSats).toBe(1000);

    const codeCountBefore = __testing.recoveryCodes.size;
    // Host pays 1 sat short of the tier price.
    expect(simulatePayment(paymentHash, amountSats - 1)).toBe(true);

    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ paid: false });

    // No JWT, no recovery code, and no invoice-state was settled.
    expect(__testing.recoveryCodes.size).toBe(codeCountBefore);
    expect(__testing.invoiceStates.get(paymentHash)?.settled).toBeUndefined();
  });

  it("overpayment is accepted-and-logged: a token is minted and a warning is emitted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
      expect(inv.status).toBe(200);
      const { paymentHash, amountSats } = inv.body as InvoiceOk;

      // Host pays double the tier price.
      expect(simulatePayment(paymentHash, amountSats * 2)).toBe(true);

      const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
      expect(status.status).toBe(200);
      const ok = status.body as StatusOk;
      expect(ok.paid).toBe(true);
      expect(typeof ok.token).toBe("string");
      expect(ok.tier).toBe("standard");
      expect(ok.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);

      // The accept-and-log seam emitted exactly one operator-facing warning
      // carrying both the expected and received amounts.
      const overpaymentWarn = warnSpy.mock.calls.find((call) =>
        String(call[0] ?? "").includes("overpayment accepted"),
      );
      expect(overpaymentWarn).toBeDefined();
      expect(String(overpaymentWarn?.[0])).toContain(`expected=${amountSats}`);
      expect(String(overpaymentWarn?.[0])).toContain(`received=${amountSats * 2}`);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("exact payment settles normally (control for the amount-aware seam)", async () => {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
    const { paymentHash, amountSats } = inv.body as InvoiceOk;
    expect(simulatePayment(paymentHash, amountSats)).toBe(true);
    const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(status.status).toBe(200);
    expect((status.body as StatusOk).paid).toBe(true);
  });
});

// ── Duplicate / replayed settlement (Task #747) ──────────────────────────────
//
// A Lightning backend (or a flaky network) can deliver the same settlement
// more than once, and a host's client can poll /paywall/status repeatedly. The
// invoice state machine must treat the FIRST observed payment as authoritative
// and every subsequent observation as an idempotent re-poll: same token, same
// expiry, no second recovery code, no second JWT. This overlaps the re-poll
// invariants above but pins the duplicate-settlement framing the launch gate
// calls out explicitly.
describe("duplicate / replayed settlement is idempotent", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    __testing.overrideJitter(0);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("a replayed settlement + re-poll returns the same token and no second code", async () => {
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "day" });
    const { paymentHash } = inv.body as InvoiceOk;

    expect(simulatePayment(paymentHash)).toBe(true);
    const first = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(first.status).toBe(200);
    const firstOk = first.body as StatusOk;
    expect(firstOk.paid).toBe(true);
    expect(firstOk.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);

    const codeCountAfterFirst = __testing.recoveryCodes.size;

    // Replay the settlement notification, then poll again.
    expect(simulatePayment(paymentHash)).toBe(true);
    const second = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(second.status).toBe(200);
    const secondOk = second.body as {
      paid: true;
      token: string;
      tier: string;
      expiresAt: number;
      recoveryCode?: string;
    };

    // Identical credential, identical window, identical tier.
    expect(secondOk.token).toBe(firstOk.token);
    expect(secondOk.expiresAt).toBe(firstOk.expiresAt);
    expect(secondOk.tier).toBe("day");
    // Task #1143: until the client acks receipt, the replay re-delivers the
    // SAME code — never a fresh one (map size unchanged).
    expect(secondOk.recoveryCode).toBe(firstOk.recoveryCode);
    expect(__testing.recoveryCodes.size).toBe(codeCountAfterFirst);
  });
});

// ── Concurrent invoices (Task #747) ──────────────────────────────────────────
//
// Multiple hosts paying at the same time must each get their own isolated
// credential. The module-level invoice/recovery maps are keyed by paymentHash,
// so settling N invoices concurrently must yield N distinct tokens and N
// distinct recovery codes with no cross-talk.
describe("concurrent invoices settle independently", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    __testing.overrideJitter(0);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  it("three invoices paid concurrently yield three distinct tokens and recovery codes", async () => {
    const chains = await Promise.all(
      [0, 1, 2].map(async () => {
        const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier: "standard" });
        expect(inv.status).toBe(200);
        const { paymentHash } = inv.body as InvoiceOk;
        expect(simulatePayment(paymentHash)).toBe(true);
        const status = await getJson(`${baseUrl}/api/paywall/status/${paymentHash}`);
        expect(status.status).toBe(200);
        return { paymentHash, body: status.body as StatusOk };
      }),
    );

    // Distinct payment hashes (precondition — different invoices).
    expect(new Set(chains.map((c) => c.paymentHash)).size).toBe(3);
    // Distinct JWTs.
    expect(new Set(chains.map((c) => c.body.token)).size).toBe(3);
    // Distinct recovery codes.
    expect(new Set(chains.map((c) => c.body.recoveryCode)).size).toBe(3);
    // Every chain actually settled.
    for (const c of chains) {
      expect(c.body.paid).toBe(true);
      expect(c.body.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
    }
  });
});

// ── Issued-JWT shape per tier ────────────────────────────────────────────────
// These guard against the silent-downgrade regression called out in Task #112:
// a future refactor of paywall.ts could decouple the tier mapping from the
// JWT's `tier` claim or its `expiresIn`, and the existing assertions on the
// response body's `expiresAt`/`tier` fields would still pass while the JWT
// itself drifted. Decoding the JWT and pinning both `tier` and `exp` closes
// that gap. Extend this `it.each` table when a new tier is added.
describe("issued JWT shape per tier (regression guard for silent downgrade)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Disable the M-04 jitter so tests complete in milliseconds, not minutes.
    __testing.overrideJitter(0);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  interface TierCase {
    tier: "standard" | "day";
    amountSats: number;
    windowSeconds: number;
  }

  const cases: TierCase[] = [
    { tier: "standard", amountSats: 1000, windowSeconds: 60 * 60 },
    { tier: "day", amountSats: 5000, windowSeconds: 24 * 60 * 60 },
  ];

  it.each(cases)(
    "$tier tier: invoice → status → JWT carries tier=$tier and exp matches $windowSeconds s",
    async ({ tier, amountSats, windowSeconds }) => {
      // Invoice: amount and tier echo correctly.
      const inv = await postJson(`${baseUrl}/api/paywall/invoice`, { tier });
      expect(inv.status).toBe(200);
      const invBody = inv.body as InvoiceOk;
      expect(invBody.tier).toBe(tier);
      expect(invBody.amountSats).toBe(amountSats);

      // Pay and poll status.
      expect(simulatePayment(invBody.paymentHash)).toBe(true);
      const status = await getJson(`${baseUrl}/api/paywall/status/${invBody.paymentHash}`);
      expect(status.status).toBe(200);
      const issued = status.body as StatusOk;
      expect(issued.tier).toBe(tier);

      // The actual JWT must verify and embed the right tier + window. This is
      // the assertion that catches a refactor decoupling the response body
      // (which a passing-but-shallow test would still satisfy) from the
      // signed JWT (which is what socketHandlers actually trusts).
      const decoded = jwt.verify(issued.token, PAYWALL_SECRET) as {
        authorized: boolean;
        tier?: unknown;
        iat: number;
        exp: number;
      };
      expect(decoded.authorized).toBe(true);
      expect(decoded.tier).toBe(tier);
      // jwt.sign with a string `expiresIn` is deterministic: exp - iat is
      // exactly the requested window in seconds. No tolerance needed.
      expect(decoded.exp - decoded.iat).toBe(windowSeconds);

      // The server-reported expiresAt must align with the JWT's own exp claim
      // (within a second of clock drift). If they diverged, a client honoring
      // `expiresAt` would believe the room was alive past the JWT's lifetime.
      expect(Math.abs(issued.expiresAt - decoded.exp * 1000)).toBeLessThanOrEqual(1000);
    },
  );

  it("omitted-tier invoice still mints a tier=standard JWT (backward compat)", async () => {
    // A client that doesn't know about tiers (e.g. an older bundle) must keep
    // working: omitting `tier` in the body defaults to standard end-to-end,
    // including the JWT claim and exp window.
    const inv = await postJson(`${baseUrl}/api/paywall/invoice`, {});
    expect(inv.status).toBe(200);
    const invBody = inv.body as InvoiceOk;
    expect(invBody.tier).toBe("standard");

    expect(simulatePayment(invBody.paymentHash)).toBe(true);
    const status = await getJson(`${baseUrl}/api/paywall/status/${invBody.paymentHash}`);
    const issued = status.body as StatusOk;
    expect(issued.tier).toBe("standard");

    const decoded = jwt.verify(issued.token, PAYWALL_SECRET) as {
      authorized: boolean;
      tier?: unknown;
      iat: number;
      exp: number;
    };
    expect(decoded.tier).toBe("standard");
    expect(decoded.exp - decoded.iat).toBe(60 * 60);
  });
});

// ── Recover endpoint rate limiting ──────────────────────────────────────────
// /paywall/recover is the highest-value brute-force surface in the API: a
// successful guess of any 4-word BIP-39 code mints a fresh JWT for an unused
// paid window. The general signaling rate limiter does not cover this REST
// route, so we enforce a per-IP bucket here. These tests pin both the per-IP
// blocking behavior and the global circuit-breaker WARN log so a future
// refactor can't silently relax either.
describe("recover endpoint rate limiting", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Disable the M-04 jitter so the one test that mints a recovery code via
    // /paywall/status (to test the rate-limiter-blocks-valid-code-redemption
    // path) completes in milliseconds rather than blocking 10–60 s.
    __testing.overrideJitter(0);
    const app = express();
    // Same trust-proxy setting as production (app.ts). Without this, req.ip
    // would always be the loopback address (127.0.0.1), every request from
    // the test client would share a bucket, and we couldn't exercise the
    // per-IP isolation behavior. With trust=1, req.ip is the rightmost
    // X-Forwarded-For entry, which is what the tests below use to simulate
    // distinct client IPs.
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywallRouter);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    __testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
  });

  // Each test gets a clean limiter state so per-IP buckets and the global
  // counter from earlier tests don't bleed in. We also use distinct
  // X-Forwarded-For values per test to isolate IP-bucket state from
  // ambient localhost requests other tests in this file might issue.
  beforeEach(() => {
    __testing.resetRecoverRateLimit();
  });

  async function postRecover(
    code: unknown,
    sourceIp: string,
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}/api/paywall/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": sourceIp,
      },
      body: JSON.stringify({ code }),
    });
    return { status: res.status, body: await res.json() };
  }

  it("allows up to 10 recover attempts per IP, then returns 429 with RATE_LIMITED", async () => {
    const ip = "203.0.113.10";
    // First 10 attempts use a well-formed but never-issued code, so they
    // each return 404 (the expected "not found" outcome) while consuming
    // a bucket slot.
    for (let i = 0; i < 10; i++) {
      const { status } = await postRecover("abandon ability able about", ip);
      expect(status).toBe(404);
    }
    // 11th attempt — same IP — must be rate-limited regardless of code shape.
    const limited = await postRecover("abandon ability able about", ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "RATE_LIMITED" });
  });

  it("rate limit is per-IP: a different IP is unaffected by another's bucket", async () => {
    const attackerIp = "203.0.113.20";
    const victimIp = "203.0.113.21";
    for (let i = 0; i < 12; i++) {
      await postRecover("abandon ability able about", attackerIp);
    }
    // Sanity: attacker is now blocked.
    const blocked = await postRecover("abandon ability able about", attackerIp);
    expect(blocked.status).toBe(429);
    // A legitimate user from a different IP must still be served.
    const ok = await postRecover("abandon ability able about", victimIp);
    expect(ok.status).toBe(404);
  });

  it("rate limit applies even to malformed codes (attackers cannot probe for free)", async () => {
    const ip = "203.0.113.30";
    // Malformed codes return 400 individually but still consume bucket
    // slots — otherwise an attacker could spam well-formed-looking
    // wordlists indefinitely if they intentionally malformed the body.
    for (let i = 0; i < 10; i++) {
      const { status } = await postRecover("nope", ip);
      expect(status).toBe(400);
    }
    const limited = await postRecover("nope", ip);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "RATE_LIMITED" });
  });

  it("rate limit blocks valid-code redemption too — the bucket fills regardless of outcome", async () => {
    // Pin the invariant that the limiter sits in front of all recover paths,
    // including the success path. This protects against a refactor that
    // moves the limiter check below the lookup ("only count failed
    // attempts"), which would let an attacker who finds N valid codes mint
    // unlimited JWTs.
    const ip = "203.0.113.40";
    // Burn the bucket on cheap 404s.
    for (let i = 0; i < 10; i++) {
      await postRecover("abandon ability able about", ip);
    }
    // Now mint a real recovery code, then try to redeem it from the same
    // (already-blocked) IP. It must 429 instead of 200 — the user's window
    // is unaffected (code is preserved), only this IP is throttled.
    const inv = await fetch(`${baseUrl}/api/paywall/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "standard" }),
    });
    const { paymentHash } = (await inv.json()) as InvoiceOk;
    expect(simulatePayment(paymentHash)).toBe(true);
    const status = await fetch(`${baseUrl}/api/paywall/status/${paymentHash}`);
    const issued = (await status.json()) as StatusOk;

    const blocked = await postRecover(issued.recoveryCode, ip);
    expect(blocked.status).toBe(429);
    // The code itself must NOT have been consumed by a rate-limited
    // request — otherwise an attacker could grief a legitimate user by
    // exhausting the limiter, then watching the server eat their code on
    // the rejected attempt. Still present, still redeemable from a
    // non-throttled IP.
    expect(__testing.recoveryCodes.has(issued.recoveryCode)).toBe(true);
  });

  it("global circuit-breaker logs a WARN once per window when total attempts cross the threshold", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const threshold = __testing.RECOVER_GLOBAL_WARN_THRESHOLD;
      // Spread attempts across many IPs so no single per-IP bucket
      // returns 429 before we reach the global threshold. Each IP gets
      // at most RECOVER_RATE_MAX_PER_IP attempts.
      const perIp = __testing.RECOVER_RATE_MAX_PER_IP;
      const totalAttempts = threshold + 5;
      let issued = 0;
      let ipIndex = 0;
      while (issued < totalAttempts) {
        const ip = `198.51.100.${ipIndex++}`;
        const burst = Math.min(perIp, totalAttempts - issued);
        for (let i = 0; i < burst; i++) {
          await postRecover("abandon ability able about", ip);
          issued++;
        }
      }

      // Filter the spy calls to just the global-circuit-breaker WARN; the
      // ephemeral PAYWALL_SECRET WARN at module load (and any other
      // unrelated warnings) must not pollute the assertion.
      const matches = warnSpy.mock.calls.filter(([arg1]) => {
        if (typeof arg1 !== "object" || arg1 === null) return false;
        const o = arg1 as Record<string, unknown>;
        return o["threshold"] === threshold && typeof o["attempts"] === "number";
      });
      expect(matches.length).toBe(1);
      const [logArg] = matches[0]!;
      const logPayload = logArg as { attempts: number; threshold: number };
      expect(logPayload.attempts).toBeGreaterThan(threshold);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("a client cannot bypass the per-IP limit by spoofing the leftmost X-Forwarded-For", async () => {
    // Threat: an attacker sets `X-Forwarded-For: rotating.fake.ip` on every
    // request hoping the server keys its bucket on that value. With trust
    // proxy = 1 and the trusted reverse proxy appending the actual client
    // IP to the right of the chain, the server must key on the proxy-added
    // (rightmost) value — which stays constant for the real attacker — so
    // the bucket fills and 429s arrive on schedule.
    //
    // We simulate that here by sending XFF chains shaped like
    // `<spoofed>, <real_attacker>` where the rightmost token is what the
    // (simulated) reverse proxy added. The leftmost rotates per request;
    // the rightmost stays the same.
    const realAttackerIp = "203.0.113.99";
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/api/paywall/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `192.0.2.${i}, ${realAttackerIp}`,
        },
        body: JSON.stringify({ code: "abandon ability able about" }),
      });
      expect(res.status).toBe(404);
    }
    // 11th request, with yet another spoofed leftmost token. If the server
    // were keying on the leftmost (untrusted) value, this would mint a
    // fresh bucket and return 404. With proper trust-proxy handling it
    // shares the bucket of the real (rightmost) attacker IP and 429s.
    const blocked = await fetch(`${baseUrl}/api/paywall/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": `192.0.2.222, ${realAttackerIp}`,
      },
      body: JSON.stringify({ code: "abandon ability able about" }),
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "RATE_LIMITED" });
  });

  it("global circuit-breaker does not WARN below the threshold", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      // Stay well under the global threshold but still issue a few requests
      // across distinct IPs.
      for (let i = 0; i < 5; i++) {
        await postRecover("abandon ability able about", `198.51.100.${200 + i}`);
      }
      const matches = warnSpy.mock.calls.filter(([arg1]) => {
        if (typeof arg1 !== "object" || arg1 === null) return false;
        const o = arg1 as Record<string, unknown>;
        return o["threshold"] === __testing.RECOVER_GLOBAL_WARN_THRESHOLD;
      });
      expect(matches.length).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
