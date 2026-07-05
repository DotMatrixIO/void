// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";

// ── Provider-down mid-payment (Task #747) ───────────────────────────────────
//
// lightning-timeout.test.ts pins the 503 mapping when the backend is
// unavailable for the ENTIRE request. This file covers the more dangerous
// sequence the launch gate calls out explicitly: an invoice is created
// successfully, the host pays, and THEN the Lightning backend goes dark
// mid-flight while the client is polling /paywall/status.
//
// Two properties must hold:
//   1. The status poll returns a typed 503 { error: "LIGHTNING_BACKEND_
//      UNAVAILABLE" } — not a 500, not a hung connection, not a false
//      {paid:false} that would tell the host their payment vanished.
//   2. The in-memory invoice state is NOT corrupted by the outage: once the
//      backend recovers, the very same paymentHash settles normally and mints
//      its token + recovery code. An outage must cost the host nothing.
//
// We mock ONLY checkPayment (toggleable via `failCheck`) and keep the real
// createInvoice + simulatePayment from the SAME importActual realm so all
// three operate on the same in-memory `pending` map.

describe("provider-down mid-payment: status poll fails then recovers", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let failCheck = false;
  // Captured from the dynamically-imported (mocked) module so the test reads
  // the same in-memory invoice-state map the router mutates.
  let testing: typeof import("../routes/paywall")["__testing"];
  let realSimulatePayment: typeof import("../services/lightning")["simulatePayment"];

  beforeEach(async () => {
    failCheck = false;
    vi.resetModules();
    vi.doMock("../services/lightning", async () => {
      const actual = await vi.importActual<typeof import("../services/lightning")>(
        "../services/lightning",
      );
      return {
        ...actual,
        // Real createInvoice + simulatePayment (via the spread) keep the
        // `pending` map authoritative; only the status check is toggleable.
        checkPayment: vi.fn(async (paymentHash: string) => {
          if (failCheck) {
            throw new actual.LightningBackendUnavailableError(
              "Lightning backend did not respond within 8000ms",
            );
          }
          return actual.checkPayment(paymentHash);
        }),
      };
    });

    const lightning = await import("../services/lightning");
    realSimulatePayment = lightning.simulatePayment;
    const paywall = await import("../routes/paywall");
    testing = paywall.__testing;
    testing.overrideJitter(0);

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywall.default);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    testing.clearJitterOverride();
    await new Promise<void>((r) => httpServer.close(() => r()));
    vi.doUnmock("../services/lightning");
    vi.resetModules();
  });

  it("503s on the poll, keeps the invoice state intact, then settles on recovery", async () => {
    // 1. Create the invoice while the backend is healthy.
    const invRes = await fetch(`${baseUrl}/api/paywall/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "standard" }),
    });
    expect(invRes.status).toBe(200);
    const inv = (await invRes.json()) as { paymentHash: string; tier: string };
    const { paymentHash } = inv;

    // The invoice-state entry exists and is unsettled.
    const before = testing.invoiceStates.get(paymentHash);
    expect(before).toBeDefined();
    expect(before?.tier).toBe("standard");
    expect(before?.settled).toBeUndefined();

    // 2. Backend goes dark mid-payment. The poll must surface a typed 503.
    failCheck = true;
    const downRes = await fetch(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(downRes.status).toBe(503);
    expect(await downRes.json()).toEqual({ error: "LIGHTNING_BACKEND_UNAVAILABLE" });

    // 3. The outage must NOT corrupt the invoice state — same entry, still
    //    unsettled, tier preserved. Nothing was minted from the failed poll.
    const during = testing.invoiceStates.get(paymentHash);
    expect(during).toBeDefined();
    expect(during?.tier).toBe("standard");
    expect(during?.settled).toBeUndefined();

    // 4. Backend recovers, the host's payment lands, and the SAME hash now
    //    settles normally with a token + recovery code.
    failCheck = false;
    expect(realSimulatePayment(paymentHash)).toBe(true);
    const okRes = await fetch(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(okRes.status).toBe(200);
    const ok = (await okRes.json()) as {
      paid: boolean;
      token: string;
      tier: string;
      recoveryCode: string;
    };
    expect(ok.paid).toBe(true);
    expect(typeof ok.token).toBe("string");
    expect(ok.tier).toBe("standard");
    expect(ok.recoveryCode).toMatch(/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/);
  });

  it("a transient outage between polls does not strand the invoice", async () => {
    // Invoice + payment land while healthy, but the FIRST poll hits the outage.
    const invRes = await fetch(`${baseUrl}/api/paywall/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "day" }),
    });
    const { paymentHash } = (await invRes.json()) as { paymentHash: string };
    expect(realSimulatePayment(paymentHash)).toBe(true);

    // First poll: backend is down → 503, no settlement.
    failCheck = true;
    const downRes = await fetch(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(downRes.status).toBe(503);
    expect(testing.invoiceStates.get(paymentHash)?.settled).toBeUndefined();

    // Second poll once recovered: the already-received payment is now visible.
    failCheck = false;
    const okRes = await fetch(`${baseUrl}/api/paywall/status/${paymentHash}`);
    expect(okRes.status).toBe(200);
    const ok = (await okRes.json()) as { paid: boolean; tier: string };
    expect(ok.paid).toBe(true);
    expect(ok.tier).toBe("day");
  });
});
