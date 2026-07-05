// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";

// ── Lightning fetch timeout (Task #265) ─────────────────────────────────────
//
// These tests guard the user-facing failure mode end-to-end. The Lightning
// service wraps every backend `fetch(...)` with an AbortController firing at
// LIGHTNING_FETCH_TIMEOUT_MS, surfacing AbortError as the typed
// `LightningBackendUnavailableError`. The paywall route maps that error
// to HTTP 503 `{ error: "LIGHTNING_BACKEND_UNAVAILABLE" }`.
//
// The ts test below exercises the route with a mocked Lightning service
// that throws the typed error directly, pinning the 503 mapping against
// regression. The "fetch timeout" test below exercises the underlying
// AbortController path against a hung response.

describe("paywall route maps LightningBackendUnavailableError → HTTP 503", () => {
  let httpServer: HttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("../services/lightning", async () => {
      const actual = await vi.importActual<typeof import("../services/lightning")>(
        "../services/lightning",
      );
      return {
        ...actual,
        createInvoice: vi.fn(async () => {
          throw new actual.LightningBackendUnavailableError(
            "Lightning backend did not respond within 8000ms",
          );
        }),
        checkPayment: vi.fn(async () => {
          throw new actual.LightningBackendUnavailableError(
            "Lightning backend did not respond within 8000ms",
          );
        }),
      };
    });
    const { default: paywallRouter } = await import("../routes/paywall");
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

  afterEach(async () => {
    await new Promise<void>((r) => httpServer.close(() => r()));
    vi.doUnmock("../services/lightning");
    vi.resetModules();
  });

  it("/paywall/invoice returns 503 LIGHTNING_BACKEND_UNAVAILABLE on Lightning timeout", async () => {
    const res = await fetch(`${baseUrl}/api/paywall/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier: "standard" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "LIGHTNING_BACKEND_UNAVAILABLE" });
  });

  it("/paywall/status returns 503 LIGHTNING_BACKEND_UNAVAILABLE on Lightning timeout", async () => {
    const fakeHash = "a".repeat(64);
    const res = await fetch(`${baseUrl}/api/paywall/status/${fakeHash}`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "LIGHTNING_BACKEND_UNAVAILABLE" });
  });
});

describe("resolveLightningFetchTimeoutMs honors LIGHTNING_FETCH_TIMEOUT_MS", () => {
  const KEY = "LIGHTNING_FETCH_TIMEOUT_MS";
  let saved: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    saved = process.env[KEY];
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
    warnSpy.mockRestore();
    vi.resetModules();
  });

  async function resolve(): Promise<number> {
    vi.resetModules();
    const mod = await import("../services/lightning");
    return mod.resolveLightningFetchTimeoutMs();
  }

  it("falls back to the default when unset", async () => {
    delete process.env[KEY];
    const { DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to the default when blank", async () => {
    process.env[KEY] = "   ";
    const { DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS);
  });

  it("accepts a valid in-range override", async () => {
    process.env[KEY] = "12000";
    expect(await resolve()).toBe(12_000);
  });

  it("clamps values above the maximum and warns", async () => {
    process.env[KEY] = "120000";
    const { MAX_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(MAX_LIGHTNING_FETCH_TIMEOUT_MS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("clamps values below the minimum and warns", async () => {
    process.env[KEY] = "100";
    const { MIN_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(MIN_LIGHTNING_FETCH_TIMEOUT_MS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to the default on non-numeric input and warns", async () => {
    process.env[KEY] = "soon";
    const { DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("falls back to the default on non-positive input and warns", async () => {
    process.env[KEY] = "0";
    const { DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } = await import("../services/lightning");
    expect(await resolve()).toBe(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS);
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("describeLightningFetchTimeout reports the effective value", () => {
  it("notes the default when the env var is unset", async () => {
    const { describeLightningFetchTimeout, DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } =
      await import("../services/lightning");
    expect(
      describeLightningFetchTimeout(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS, undefined),
    ).toBe(
      `Lightning: fetch timeout ${DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS}ms (default; LIGHTNING_FETCH_TIMEOUT_MS unset)`,
    );
  });

  it("notes the default when the env var is blank", async () => {
    const { describeLightningFetchTimeout, DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } =
      await import("../services/lightning");
    expect(
      describeLightningFetchTimeout(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS, "   "),
    ).toContain("default; LIGHTNING_FETCH_TIMEOUT_MS unset");
  });

  it("confirms an accepted in-range override", async () => {
    const { describeLightningFetchTimeout } = await import("../services/lightning");
    expect(describeLightningFetchTimeout(12_000, "12000")).toBe(
      "Lightning: fetch timeout 12000ms (set via LIGHTNING_FETCH_TIMEOUT_MS)",
    );
  });

  it("notes when the effective value was clamped from the requested value", async () => {
    const { describeLightningFetchTimeout, MAX_LIGHTNING_FETCH_TIMEOUT_MS } =
      await import("../services/lightning");
    expect(
      describeLightningFetchTimeout(MAX_LIGHTNING_FETCH_TIMEOUT_MS, "120000"),
    ).toBe(
      `Lightning: fetch timeout ${MAX_LIGHTNING_FETCH_TIMEOUT_MS}ms (clamped from requested 120000ms set via LIGHTNING_FETCH_TIMEOUT_MS)`,
    );
  });

  it("notes when an invalid value fell back to the default", async () => {
    const { describeLightningFetchTimeout, DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } =
      await import("../services/lightning");
    expect(
      describeLightningFetchTimeout(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS, "soon"),
    ).toBe(
      `Lightning: fetch timeout ${DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS}ms (default; ignored invalid LIGHTNING_FETCH_TIMEOUT_MS="soon")`,
    );
  });

  it("notes when a non-positive value fell back to the default", async () => {
    const { describeLightningFetchTimeout, DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS } =
      await import("../services/lightning");
    expect(
      describeLightningFetchTimeout(DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS, "0"),
    ).toContain('ignored invalid LIGHTNING_FETCH_TIMEOUT_MS="0"');
  });
});

describe("Lightning fetch timeout fires within the documented window", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("rejects with LightningBackendUnavailableError when the backend never responds", async () => {
    // Replace global fetch with a handler that hangs forever unless aborted.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return; // never resolves
        if (signal.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof globalThis.fetch;

    process.env["LIGHTNING_BACKEND"] = "lnbits";
    process.env["LNBITS_URL"] = "http://localhost:0";
    process.env["LNBITS_API_KEY"] = "test-key";

    vi.resetModules();
    const { createInvoice } = await import("../services/lightning");

    const start = Date.now();
    // We assert against `error.name` rather than `instanceof` because
    // `vi.resetModules()` produces a fresh module realm for the dynamic
    // import above, and the class identity therefore differs from any
    // statically-imported reference.
    await expect(createInvoice(1000)).rejects.toMatchObject({
      name: "LightningBackendUnavailableError",
    });
    const elapsedMs = Date.now() - start;
    // Must fire at the configured 8s deadline, not hang. Allow a generous
    // upper slack so a slow CI worker doesn't make this flaky.
    expect(elapsedMs).toBeGreaterThanOrEqual(7_500);
    expect(elapsedMs).toBeLessThan(15_000);
  }, 20_000);
});
