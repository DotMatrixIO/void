// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #549 — Server-authoritative tier pricing.
//
// VOID's per-room sat amounts are pegged to a fixed USD purchasing-power
// target (STANDARD = $1, DAY = $3 in reference-month dollars), tracked
// against US BLS CPI-U for inflation adjustment and converted to sats via
// the current BTC/USD spot. The server is the single source of truth —
// the client fetches /paywall/tiers and displays whatever it gets.
//
// Fallback chain (per axis):
//   - CPI: live BLS fetch → last cached value → REFERENCE_CPI
//   - BTC/USD: live CoinGecko fetch → last cached value → null (no USD,
//     falls back to TIER_DEFAULT_SATS for the amount)
//
// Plausibility clamps protect against backend bugs / market dislocations:
// resolved sat amounts outside [MIN, MAX] per tier are discarded and the
// per-tier default is used instead. We log loudly when this happens.
//
// Onion-mirror short-circuit: when TOR_ONLY=1, the server never issues
// outbound clearnet fetches (BLS or CoinGecko) — it serves cached values
// only, or the per-tier defaults if no cache exists. This mirrors the
// client-side `isOnionOrigin()` gate in useSatsToUsd.

import { logger } from "../lib/logger";

export type Tier = "standard" | "day";

// Reference month + index pin the "what does $1 of purchasing power
// mean today" baseline. The reference CPI value is a placeholder
// (BLS CPI-U has not published 2026-05 at the time of writing); the
// resolver tolerates this — until a live CPI is fetched, the ratio is
// 1.0 and the USD targets are unadjusted.
export const REFERENCE_MONTH = "2026-05";
export const REFERENCE_CPI = 320.32;

// Per-tier purchasing-power targets, in reference-month USD.
interface TierTarget {
  usdReference: number;
  defaultSats: number;
  minSats: number;
  maxSats: number;
}

export const TIER_TARGETS: Record<Tier, TierTarget> = {
  standard: { usdReference: 1.0, defaultSats: 1000, minSats: 200, maxSats: 5000 },
  day: { usdReference: 3.0, defaultSats: 5000, minSats: 1000, maxSats: 25000 },
};

// Cache TTLs. CPI updates monthly; BTC moves intraday. We refresh on a
// schedule but the resolver is fully sync — it reads the last-known-good
// in-memory snapshot and never blocks an invoice request on network IO.
const CPI_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const BTC_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15min
const FETCH_TIMEOUT_MS = 8_000;

interface CachedValue {
  value: number;
  fetchedAt: number;
}

let cachedCpi: CachedValue | null = null;
let cachedBtcUsd: CachedValue | null = null;
let cpiTimer: ReturnType<typeof setTimeout> | null = null;
let btcTimer: ReturnType<typeof setTimeout> | null = null;

export function isTorOnly(): boolean {
  return process.env["TOR_ONLY"] === "1";
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the latest published CPI-U value from BLS. Returns null on any
 *  failure — the caller treats that as "keep using the previous cached
 *  value, or the reference baseline if no cache exists". */
async function fetchLatestCpi(): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      "https://api.bls.gov/publicAPI/v2/timeseries/data/CUUR0000SA0",
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      Results?: { series?: Array<{ data?: Array<{ value?: string }> }> };
    };
    const raw = data?.Results?.series?.[0]?.data?.[0]?.value;
    const n = typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  } catch {
    return null;
  }
}

/** Fetch BTC/USD spot from CoinGecko. Returns null on any failure. */
async function fetchBtcUsd(): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { bitcoin?: { usd?: unknown } };
    const v = data?.bitcoin?.usd;
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
    return v;
  } catch {
    return null;
  }
}

async function refreshCpi(): Promise<void> {
  if (isTorOnly()) return;
  const v = await fetchLatestCpi();
  if (v !== null) {
    cachedCpi = { value: v, fetchedAt: Date.now() };
  } else {
    logger.warn("CPI refresh failed; keeping previous cached value");
  }
}

async function refreshBtcUsd(): Promise<void> {
  if (isTorOnly()) return;
  const v = await fetchBtcUsd();
  if (v !== null) {
    cachedBtcUsd = { value: v, fetchedAt: Date.now() };
  } else {
    logger.warn("BTC/USD refresh failed; keeping previous cached value");
  }
}

/** Start the background refresh schedulers. Idempotent; safe to call once
 *  at server boot. On TOR_ONLY=1 we do not start the schedulers — the
 *  resolver will use defaults / cache only. */
export function startPricingRefreshers(): void {
  if (isTorOnly()) {
    logger.info("TOR_ONLY=1 set — pricing refreshers disabled, serving cached/default sat amounts");
    return;
  }
  if (cpiTimer === null) {
    void refreshCpi();
    cpiTimer = setInterval(refreshCpi, CPI_REFRESH_INTERVAL_MS);
    cpiTimer.unref?.();
  }
  if (btcTimer === null) {
    void refreshBtcUsd();
    btcTimer = setInterval(refreshBtcUsd, BTC_REFRESH_INTERVAL_MS);
    btcTimer.unref?.();
  }
}

export function stopPricingRefreshers(): void {
  if (cpiTimer !== null) {
    clearInterval(cpiTimer);
    cpiTimer = null;
  }
  if (btcTimer !== null) {
    clearInterval(btcTimer);
    btcTimer = null;
  }
}

export interface ResolvedTier {
  amountSats: number;
  /** Formatted USD-equivalent string ("1.00") or null when unavailable
   *  (no cached BTC rate, e.g. TOR_ONLY or first-boot before fetch). */
  usdApprox: string | null;
}

export interface ResolvedPricing {
  standard: ResolvedTier;
  day: ResolvedTier;
}

function resolveOne(tier: Tier): ResolvedTier {
  const target = TIER_TARGETS[tier];
  const cpiRatio =
    cachedCpi !== null && cachedCpi.value > 0
      ? cachedCpi.value / REFERENCE_CPI
      : 1.0;
  const usdAdjusted = target.usdReference * cpiRatio;
  const btc = cachedBtcUsd?.value ?? null;

  if (btc === null) {
    // No BTC rate — fall back to per-tier default. USD figure is hidden
    // (no double-rate on the client; the client trusts the server).
    return { amountSats: target.defaultSats, usdApprox: null };
  }

  const computed = Math.round((usdAdjusted / btc) * 100_000_000);
  if (computed < target.minSats || computed > target.maxSats) {
    logger.warn(
      {
        tier,
        computed,
        min: target.minSats,
        max: target.maxSats,
        usdAdjusted,
        btc,
      },
      "Resolved sat amount outside plausibility clamp; using per-tier default",
    );
    return { amountSats: target.defaultSats, usdApprox: usdAdjusted.toFixed(2) };
  }

  return { amountSats: computed, usdApprox: usdAdjusted.toFixed(2) };
}

/** Sync resolver. Returns the current best-known sat amount and USD
 *  approximation for each tier. Never blocks on network IO. */
export function resolveTierPricing(): ResolvedPricing {
  return {
    standard: resolveOne("standard"),
    day: resolveOne("day"),
  };
}

// Test-only helpers. Never invoked from production paths.
export const __testing = {
  setCpi(value: number | null): void {
    cachedCpi = value === null ? null : { value, fetchedAt: Date.now() };
  },
  setBtcUsd(value: number | null): void {
    cachedBtcUsd = value === null ? null : { value, fetchedAt: Date.now() };
  },
  reset(): void {
    cachedCpi = null;
    cachedBtcUsd = null;
  },
};
