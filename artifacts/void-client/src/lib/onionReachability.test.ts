// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  probeOnionReachability,
  detectOnionReachability,
  getCachedOnionReachability,
  clearCachedOnionReachability,
  ONION_REACHABILITY_CACHE_KEY,
  DEFAULT_ONION_PROBE_TIMEOUT_MS,
} from "./onionReachability";

const ONION_URL = "http://voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion/";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("probeOnionReachability", () => {
  it("returns 'unknown' when navigator reports offline", async () => {
    const fetchImpl = vi.fn();
    const result = await probeOnionReachability(ONION_URL, {
      onLine: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("unknown");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 'reachable' when the no-cors HEAD probe resolves", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const result = await probeOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("reachable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ONION_URL);
    expect(init).toMatchObject({ method: "HEAD", mode: "no-cors", cache: "no-store" });
  });

  it("returns 'unreachable' when fetch rejects synchronously (DNS/connect failure)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network error"));
    const result = await probeOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("unreachable");
  });

  it("returns 'unknown' when our internal timeout aborts the probe", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const promise = probeOnionReachability(ONION_URL, {
      onLine: true,
      timeoutMs: 50,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(await promise).toBe("unknown");
  });

  it("returns 'unknown' when the external signal is aborted", async () => {
    const ctrl = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const promise = probeOnionReachability(ONION_URL, {
      onLine: true,
      signal: ctrl.signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    ctrl.abort();
    expect(await promise).toBe("unknown");
  });

  it("uses the documented default timeout", () => {
    expect(DEFAULT_ONION_PROBE_TIMEOUT_MS).toBe(3000);
  });
});

describe("detectOnionReachability", () => {
  it("caches results in sessionStorage so subsequent calls do not re-probe", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network error"));
    const first = await detectOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(first).toBe("unreachable");
    expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBe("unreachable");

    const second = await detectOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(second).toBe("unreachable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads a pre-existing cache entry without invoking fetch", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "reachable");
    const fetchImpl = vi.fn();
    const result = await detectOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("reachable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clearCachedOnionReachability removes the entry so a fresh probe runs", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "unreachable");
    expect(getCachedOnionReachability()).toBe("unreachable");
    clearCachedOnionReachability();
    expect(getCachedOnionReachability()).toBeNull();
    expect(sessionStorage.getItem(ONION_REACHABILITY_CACHE_KEY)).toBeNull();

    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const result = await detectOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("reachable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores garbage cache values and re-probes", async () => {
    sessionStorage.setItem(ONION_REACHABILITY_CACHE_KEY, "not-a-real-value");
    expect(getCachedOnionReachability()).toBeNull();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const result = await detectOnionReachability(ONION_URL, {
      onLine: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toBe("reachable");
  });
});
