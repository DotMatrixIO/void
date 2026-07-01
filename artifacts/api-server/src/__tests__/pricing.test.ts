// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import paywallRouter from "../routes/paywall";
import {
  resolveTierPricing,
  startPricingRefreshers,
  stopPricingRefreshers,
  isTorOnly,
  REFERENCE_CPI,
  TIER_TARGETS,
  __testing as pricingTesting,
  type ResolvedPricing,
} from "../services/pricing";
import { logger } from "../lib/logger";

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

describe("services/pricing — resolveTierPricing", () => {
  beforeEach(() => {
    pricingTesting.reset();
  });

  afterEach(() => {
    pricingTesting.reset();
  });

  it("falls back to per-tier defaults when no BTC rate is cached", () => {
    const p = resolveTierPricing();
    expect(p.standard.amountSats).toBe(TIER_TARGETS.standard.defaultSats);
    expect(p.day.amountSats).toBe(TIER_TARGETS.day.defaultSats);
    // No BTC rate also hides the USD figure on both tiers — the client trusts
    // the server to decide and never recomputes USD on its own.
    expect(p.standard.usdApprox).toBeNull();
    expect(p.day.usdApprox).toBeNull();
  });

  it("computes sat amount inside the clamp window from a cached BTC rate", () => {
    // BTC = $100,000 → 1 sat = $0.001. Standard target ($1.00) → 100_000 sats,
    // which is above the standard max (5_000), so it would be clamped. Pick a
    // BTC price that lands BOTH tiers inside their clamp windows.
    //   standard $1, want ~1000 sats → BTC = 1 / (1000 * 1e-8) = $100_000_000?
    // That's absurd; reverse: at 1000 sats per $1, the BTC price is $100_000_000.
    // Easier: use a BTC price that lands the standard tier at exactly 500 sats.
    //   500 sats * 1e-8 BTC/sat = 5e-6 BTC; for $1 of value → BTC = $1 / 5e-6 = $200_000.
    pricingTesting.setBtcUsd(200_000);
    const p = resolveTierPricing();
    // Without CPI, ratio is 1.0; standard target USD = 1.0; sats = 1/200_000 * 1e8 = 500.
    expect(p.standard.amountSats).toBe(500);
    // Day target = $3 → 1500 sats. Inside [1000, 25000] clamp.
    expect(p.day.amountSats).toBe(1500);
    // USD figure is exposed once we have a rate.
    expect(p.standard.usdApprox).toBe("1.00");
    expect(p.day.usdApprox).toBe("3.00");
  });

  it("applies the CPI ratio to the USD target before converting to sats", () => {
    // CPI doubled relative to reference → $1 of reference purchasing power
    // now costs $2 nominal. Sat math: at BTC = $200_000, doubled USD target
    // means doubled sat amount.
    pricingTesting.setCpi(REFERENCE_CPI * 2);
    pricingTesting.setBtcUsd(200_000);
    const p = resolveTierPricing();
    expect(p.standard.amountSats).toBe(1000); // 500 * 2
    expect(p.day.amountSats).toBe(3000); // 1500 * 2
    expect(p.standard.usdApprox).toBe("2.00");
    expect(p.day.usdApprox).toBe("6.00");
  });

  it("falls back to per-tier defaults when the computed amount is below the floor", () => {
    // BTC absurdly high → 1 sat is "worth" so much that the standard tier
    // would cost <200 sats. Confirm we clamp to the default, not silently
    // undercharge.
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    pricingTesting.setBtcUsd(1_000_000_000); // $1B per BTC → standard ~0 sats
    const p = resolveTierPricing();
    expect(p.standard.amountSats).toBe(TIER_TARGETS.standard.defaultSats);
    expect(p.day.amountSats).toBe(TIER_TARGETS.day.defaultSats);
    // USD figure stays computed (we know the rate; only the SAT amount is clamped).
    expect(p.standard.usdApprox).toBe("1.00");
    // The clamp violation must be observable.
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to per-tier defaults when the computed amount is above the ceiling", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    // BTC collapses to $1 → standard target $1 → 100_000_000 sats, above
    // the 5_000-sat ceiling. Day target $3 → 300_000_000 sats, above 25_000.
    pricingTesting.setBtcUsd(1);
    const p = resolveTierPricing();
    expect(p.standard.amountSats).toBe(TIER_TARGETS.standard.defaultSats);
    expect(p.day.amountSats).toBe(TIER_TARGETS.day.defaultSats);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("never returns less than the per-tier floor (regression guard on the clamp)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    // Sweep a few BTC prices across the boundary; the returned amount must
    // always be >= the configured min for that tier.
    for (const btc of [1, 100, 10_000, 100_000, 1_000_000, 1_000_000_000]) {
      pricingTesting.setBtcUsd(btc);
      const p = resolveTierPricing();
      expect(p.standard.amountSats).toBeGreaterThanOrEqual(TIER_TARGETS.standard.minSats);
      expect(p.day.amountSats).toBeGreaterThanOrEqual(TIER_TARGETS.day.minSats);
    }
    warnSpy.mockRestore();
  });
});

describe("services/pricing — isTorOnly + refresher short-circuit", () => {
  const prevTor = process.env["TOR_ONLY"];

  afterEach(() => {
    if (prevTor === undefined) delete process.env["TOR_ONLY"];
    else process.env["TOR_ONLY"] = prevTor;
    stopPricingRefreshers();
    pricingTesting.reset();
    vi.unstubAllGlobals();
  });

  it("isTorOnly() reflects TOR_ONLY=1", () => {
    process.env["TOR_ONLY"] = "1";
    expect(isTorOnly()).toBe(true);
    process.env["TOR_ONLY"] = "0";
    expect(isTorOnly()).toBe(false);
    delete process.env["TOR_ONLY"];
    expect(isTorOnly()).toBe(false);
  });

  it("startPricingRefreshers() issues no outbound fetches when TOR_ONLY=1", async () => {
    process.env["TOR_ONLY"] = "1";
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be called under TOR_ONLY=1");
    });
    vi.stubGlobal("fetch", fetchMock);
    startPricingRefreshers();
    // Give any (incorrectly) scheduled microtasks a chance to run.
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolveTierPricing() under TOR_ONLY=1 with no cache returns per-tier defaults and no USD", () => {
    process.env["TOR_ONLY"] = "1";
    pricingTesting.reset();
    const p = resolveTierPricing();
    expect(p.standard.amountSats).toBe(TIER_TARGETS.standard.defaultSats);
    expect(p.day.amountSats).toBe(TIER_TARGETS.day.defaultSats);
    expect(p.standard.usdApprox).toBeNull();
    expect(p.day.usdApprox).toBeNull();
  });
});

describe("GET /paywall/tiers", () => {
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
  });

  beforeEach(() => {
    pricingTesting.reset();
  });

  it("returns the default tier amounts (and null USD) when no rate is cached", async () => {
    const { status, body } = await getJson(`${baseUrl}/api/paywall/tiers`);
    expect(status).toBe(200);
    const p = body as ResolvedPricing;
    expect(p.standard.amountSats).toBe(TIER_TARGETS.standard.defaultSats);
    expect(p.day.amountSats).toBe(TIER_TARGETS.day.defaultSats);
    expect(p.standard.usdApprox).toBeNull();
    expect(p.day.usdApprox).toBeNull();
  });

  it("reflects a cached BTC rate in both sat amounts and USD strings", async () => {
    pricingTesting.setBtcUsd(200_000);
    const { status, body } = await getJson(`${baseUrl}/api/paywall/tiers`);
    expect(status).toBe(200);
    const p = body as ResolvedPricing;
    expect(p.standard.amountSats).toBe(500);
    expect(p.day.amountSats).toBe(1500);
    expect(p.standard.usdApprox).toBe("1.00");
    expect(p.day.usdApprox).toBe("3.00");
  });

  it("never returns less than the per-tier floor (route-level regression guard)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => undefined as never);
    // BTC absurdly high → would compute below the floor → must clamp to default.
    pricingTesting.setBtcUsd(1_000_000_000);
    const { status, body } = await getJson(`${baseUrl}/api/paywall/tiers`);
    expect(status).toBe(200);
    const p = body as ResolvedPricing;
    expect(p.standard.amountSats).toBeGreaterThanOrEqual(TIER_TARGETS.standard.minSats);
    expect(p.day.amountSats).toBeGreaterThanOrEqual(TIER_TARGETS.day.minSats);
    warnSpy.mockRestore();
  });
});
