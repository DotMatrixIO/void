// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from "react";

// Task #549 — Server-authoritative tier pricing.
//
// The /paywall/tiers endpoint on the API server is the single source of
// truth for both the sat amount and the USD-equivalent figure shown
// next to each tier. The client never recomputes USD on its own (no
// double-rate). When the fetch fails or the page is loaded over a
// `.onion` origin, the hook returns `usdApprox: null` for each tier
// and the call site hides the USD line.

export type TierId = "standard" | "day";

export interface ResolvedTier {
  amountSats: number;
  usdApprox: string | null;
}

export interface TierPricing {
  standard: ResolvedTier;
  day: ResolvedTier;
}

// Conservative defaults used while the fetch is in flight and as a
// last-resort fallback if /paywall/tiers is unreachable (older
// self-hosted server, transient network failure, etc). These match the
// per-tier defaults in the API server's services/pricing.ts and the
// values exercised by the existing test fixtures.
export const FALLBACK_TIER_PRICING: TierPricing = {
  standard: { amountSats: 1000, usdApprox: null },
  day: { amountSats: 5000, usdApprox: null },
};

const BASE_URL = import.meta.env.BASE_URL ?? "/";

function tiersUrl(): string {
  return BASE_URL.replace(/\/$/, "") + "/api/paywall/tiers";
}

let cached: TierPricing | null = null;
let inflight: Promise<TierPricing | null> | null = null;

function isOnion(): boolean {
  if (typeof window === "undefined") return false;
  return window.location?.hostname?.endsWith(".onion") === true;
}

function parseTier(raw: unknown): ResolvedTier | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const amt = rec["amountSats"];
  if (typeof amt !== "number" || !Number.isFinite(amt) || amt <= 0) return null;
  const usd = rec["usdApprox"];
  return {
    amountSats: Math.floor(amt),
    usdApprox: typeof usd === "string" && usd.length > 0 ? usd : null,
  };
}

function parsePayload(raw: unknown): TierPricing | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const s = parseTier(rec["standard"]);
  const d = parseTier(rec["day"]);
  if (!s || !d) return null;
  return { standard: s, day: d };
}

async function fetchTierPricing(): Promise<TierPricing | null> {
  if (cached !== null) return cached;
  if (inflight !== null) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(tiersUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      const parsed = parsePayload(data);
      if (parsed) cached = parsed;
      return parsed;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * React hook returning the server's authoritative tier pricing.
 *
 * `loading` is true on the initial render before the fetch resolves.
 * `pricing` is always present — falls back to FALLBACK_TIER_PRICING
 * (with usdApprox=null) until the server responds. On a `.onion`
 * origin the fetch is still attempted (same-origin, no clearnet egress
 * implied) but if it fails the USD figure simply stays hidden, which
 * is the desired onion-mirror behaviour.
 */
export function useTierPricing(): { pricing: TierPricing; loading: boolean } {
  const [pricing, setPricing] = useState<TierPricing>(
    () => cached ?? FALLBACK_TIER_PRICING,
  );
  const [loading, setLoading] = useState<boolean>(() => cached === null);

  useEffect(() => {
    let cancelled = false;
    void fetchTierPricing().then((p) => {
      if (cancelled) return;
      if (p) setPricing(p);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { pricing, loading };
}

// Test-only reset hook so vitest specs can clear the module-level cache
// between cases without resorting to vi.resetModules().
export const __testing = {
  reset(): void {
    cached = null;
    inflight = null;
  },
  isOnion,
};
