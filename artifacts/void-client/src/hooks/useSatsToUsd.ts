// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect } from "react";
import { isOnionOrigin } from "@/lib/origin";

let cachedBtcUsd: number | null = null;
let inflight: Promise<number | null> | null = null;

function fetchBtcUsdOnce(): Promise<number | null> {
  if (cachedBtcUsd !== null) return Promise.resolve(cachedBtcUsd);
  // Onion fail-open audit (Task #385): coingecko.com is the only
  // outbound clearnet hostname any onion-origin page would otherwise
  // contact. Skip the fetch entirely when the page was loaded over a
  // `.onion` origin — the USD figure is a nice-to-have ("≈ $0.80")
  // shown on LandingPage and PaywallModal, and the hook already
  // returns null while loading or on failure, so every call site
  // hides the price gracefully. The audit doc
  // (docs/onion-fail-open-audit.md) and the regression test
  // (__tests__/onion-no-clearnet-egress.test.ts) pin this gate.
  if (isOnionOrigin()) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  )
    .then((r) =>
      r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
    )
    .then((data): number => {
      const v = data?.bitcoin?.usd;
      if (typeof v !== "number" || !isFinite(v) || v <= 0) {
        throw new Error("invalid price payload");
      }
      cachedBtcUsd = v;
      return v;
    })
    .catch(() => null);
  return inflight;
}

function formatSatsAsUsd(btcUsd: number, sats: number): string {
  const dollars = btcUsd * (sats / 100_000_000);
  const rounded = Math.round(dollars * 10) / 10;
  return rounded.toFixed(2);
}

/**
 * Returns the USD equivalent of `sats` rounded to the nearest dime,
 * formatted as e.g. "0.80" or "1.20". Returns null while loading or
 * on fetch failure — callers should hide or hedge the value rather
 * than invent a fallback.
 */
export function useSatsToUsd(sats: number): string | null {
  const [usd, setUsd] = useState<string | null>(() =>
    cachedBtcUsd !== null ? formatSatsAsUsd(cachedBtcUsd, sats) : null,
  );

  useEffect(() => {
    let cancelled = false;
    fetchBtcUsdOnce().then((v) => {
      if (!cancelled && v !== null) setUsd(formatSatsAsUsd(v, sats));
    });
    return () => {
      cancelled = true;
    };
  }, [sats]);

  return usd;
}
