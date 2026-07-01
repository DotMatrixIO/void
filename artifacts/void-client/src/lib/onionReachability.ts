// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #389 — best-effort probe for whether the current browser's
// network can reach our `.onion` mirror.
//
// Motivation: the always-visible "ALSO ON .ONION" footer link
// (Task #384) is helpful for users on Tor Browser / Orbot, but a
// clearnet user on a vanilla browser who clicks it just sees a DNS
// error a few seconds later. We want to surface a short inline hint
// ("requires Tor Browser") when we can tell the network plainly
// cannot route .onion, without resorting to User-Agent sniffing.
//
// Signals (in order):
//   1. `navigator.onLine === false` → no signal, return "unknown".
//   2. A `no-cors` HEAD fetch to the onion URL with a short timeout.
//      - Resolves (even opaquely) → the network reached *something*
//        for that hostname → "reachable". In practice this only
//        happens on Tor-aware browsers; vanilla browsers will hit a
//        DNS failure long before the response.
//      - Rejects synchronously (TypeError on DNS/connect failure)
//        without our timeout firing → "unreachable".
//      - Our timeout fires first → "unknown" (could be slow Tor,
//        could be a captive portal, we don't pretend to know).
//
// The result is cached in `sessionStorage` so we probe at most once
// per browser session per page-load chain. Failures from the cache
// helper (e.g. storage disabled in private mode on some browsers)
// degrade silently — the probe simply re-runs.

export type OnionReachability = "reachable" | "unreachable" | "unknown";

export const ONION_REACHABILITY_CACHE_KEY = "void.onionReachability.v1";
export const DEFAULT_ONION_PROBE_TIMEOUT_MS = 3000;

// Task #426 — when the tab returns to foreground we only re-probe if it
// was backgrounded for at least this long. A quick alt-tab shouldn't
// burn a probe, but a tab the user left for a coffee break (during
// which they may have started Tor Browser / Orbot) should.
export const ONION_BACKGROUND_REPROBE_THRESHOLD_MS = 30_000;

export function getCachedOnionReachability(): OnionReachability | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const v = sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY);
    if (v === "reachable" || v === "unreachable" || v === "unknown") return v;
  } catch {
    // Storage access can throw (Safari private mode, sandboxed
    // iframes, policy denials). Treat as a cache miss.
  }
  return null;
}

function setCachedOnionReachability(value: OnionReachability): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, value);
  } catch {
    // See getCachedOnionReachability — storage may be unavailable.
  }
}

// Task #426 — invalidate the cached probe result so the next render
// of the footer triggers a fresh probe. Used when the browser fires
// `online` after being offline, or when the tab returns to foreground
// after a long background period: the previous "unreachable"/"unknown"
// answer may no longer reflect reality (the user may have started Tor
// Browser / Orbot, left a captive portal, etc.).
export function clearCachedOnionReachability(): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.removeItem(ONION_REACHABILITY_CACHE_KEY);
  } catch {
    // See getCachedOnionReachability — storage may be unavailable.
  }
}

export interface ProbeOnionReachabilityOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onLine?: boolean;
}

/**
 * Run the probe once, bypassing the session cache. Exposed so tests
 * can drive the probe deterministically; production code should
 * prefer `detectOnionReachability` which adds caching.
 */
export async function probeOnionReachability(
  url: string,
  options: ProbeOnionReachabilityOptions = {},
): Promise<OnionReachability> {
  const onLine =
    options.onLine ?? (typeof navigator !== "undefined" ? navigator.onLine : true);
  if (onLine === false) return "unknown";

  const fetchImpl =
    options.fetchImpl ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
  if (!fetchImpl) return "unknown";

  const timeoutMs = options.timeoutMs ?? DEFAULT_ONION_PROBE_TIMEOUT_MS;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onExternalAbort = () => ctrl.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    await fetchImpl(url, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      redirect: "follow",
      signal: ctrl.signal,
    });
    return "reachable";
  } catch {
    if (options.signal?.aborted) return "unknown";
    if (timedOut) return "unknown";
    return "unreachable";
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Probe with session-scoped caching. Safe to call from every footer
 * render — the actual network request fires at most once per session
 * per page-load chain.
 */
export async function detectOnionReachability(
  url: string,
  options: ProbeOnionReachabilityOptions = {},
): Promise<OnionReachability> {
  const cached = getCachedOnionReachability();
  if (cached) return cached;
  const result = await probeOnionReachability(url, options);
  setCachedOnionReachability(result);
  return result;
}
