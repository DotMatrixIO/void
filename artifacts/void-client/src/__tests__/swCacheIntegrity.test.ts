// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { webcrypto } from "node:crypto";

/**
 * Service-worker cache-integrity verification (task #489 / H-02).
 *
 * The shipped logic lives in `public/sw-integrity.js`, loaded into the
 * real SW via `importScripts(...)`. To prove the same code path the
 * browser exercises, this test loads that file into a fresh
 * `vm.createContext` with a mocked `self` (Cache API, fetch, crypto,
 * btoa). The three cases the task spec calls out are asserted directly:
 *
 *   1. Cached hash matches the known hash -> the cached Response is
 *      served unchanged (no refetch).
 *   2. Cached hash MISMATCHES the known hash -> entry is evicted from
 *      the cache, the SW refetches, the refetch passes integrity, and
 *      the verified response is served (and re-cached).
 *   3. Cached miss + fresh fetch ALSO mismatches the known hash -> the
 *      notifyIntegrityFailure callback fires (the same path that
 *      postMessages every client to raise the index.html:61-125
 *      integrity-failure overlay) and the SW returns the 502
 *      "integrity-failure" refusal instead of silently serving the
 *      tampered bytes.
 *
 * A fourth case — asset not in the SRI baseline (no expected hash) —
 * is asserted in passing to confirm the strict-superset property: the
 * pre-task-489 stale-while-revalidate behaviour is preserved for any
 * URL not listed in sw-known-hashes.json.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const swIntegrityPath = resolve(
  __dirname,
  "..",
  "..",
  "public",
  "sw-integrity.js",
);

interface SwIntegrityModule {
  sha384Base64: (buf: ArrayBuffer) => Promise<string>;
  verifyResponse: (
    response: Response,
    expected: string | null,
  ) => Promise<{ ok: boolean; actual: string | null; skipped?: boolean }>;
  pathnameKey: (url: string) => string;
  lookupExpected: (
    table: Record<string, string> | null,
    url: string,
  ) => string | null;
  handleAssetFetch: (opts: {
    request: Request;
    cache: Cache;
    knownHashes: Record<string, string>;
    fetchImpl: (req: Request) => Promise<Response>;
    notifyIntegrityFailure: (detail: {
      url: string;
      expected: string;
      actual: string | null;
    }) => Promise<void> | void;
  }) => Promise<Response>;
}

function loadSwIntegrity(): SwIntegrityModule {
  const sandbox: Record<string, unknown> = {
    crypto: webcrypto,
    btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    URL,
    Response,
    Request,
  };
  (sandbox as { self: unknown }).self = sandbox;
  const ctx = createContext(sandbox);
  const src = readFileSync(swIntegrityPath, "utf8");
  runInContext(src, ctx, { filename: swIntegrityPath });
  return (sandbox.SwIntegrity as unknown) as SwIntegrityModule;
}

// Mocked Cache API. Keys are request URLs; values are Responses we can
// clone on `match()` so the SW's own clone-and-hash does not consume the
// only readable copy.
function makeMockCache(): {
  cache: Cache;
  store: Map<string, Response>;
  deletes: string[];
  puts: Array<[string, Response]>;
} {
  const store = new Map<string, Response>();
  const deletes: string[] = [];
  const puts: Array<[string, Response]> = [];
  const cache: Partial<Cache> = {
    match: async (req: RequestInfo) => {
      const url = typeof req === "string" ? req : (req as Request).url;
      const r = store.get(url);
      return r ? r.clone() : undefined;
    },
    put: async (req: RequestInfo, resp: Response) => {
      const url = typeof req === "string" ? req : (req as Request).url;
      puts.push([url, resp.clone()]);
      store.set(url, resp.clone());
    },
    delete: async (req: RequestInfo) => {
      const url = typeof req === "string" ? req : (req as Request).url;
      deletes.push(url);
      return store.delete(url);
    },
  };
  return { cache: cache as Cache, store, deletes, puts };
}

let mod: SwIntegrityModule;
beforeAll(() => {
  mod = loadSwIntegrity();
});

async function sha384Of(bytes: Uint8Array): Promise<string> {
  const digest = await webcrypto.subtle.digest(
    "SHA-384",
    bytes as unknown as NodeJS.BufferSource,
  );
  return (
    "sha384-" +
    Buffer.from(new Uint8Array(digest)).toString("base64")
  );
}

const ASSET_URL = "https://void.test/assets/main-deadbeef.js";

describe("SW cache integrity (task #489 / H-02)", () => {
  it("serves cached response when its bytes match the known hash", async () => {
    const cleanBytes = new TextEncoder().encode("console.log('hi');\n");
    const expected = await sha384Of(cleanBytes);
    const { cache, store, deletes, puts } = makeMockCache();
    store.set(ASSET_URL, new Response(cleanBytes));

    let fetchCalls = 0;
    let notified = 0;
    const req = new Request(ASSET_URL);
    const out = await mod.handleAssetFetch({
      request: req,
      cache,
      knownHashes: { "/assets/main-deadbeef.js": expected },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response("should not be called", { status: 500 });
      },
      notifyIntegrityFailure: async () => {
        notified += 1;
      },
    });

    expect(fetchCalls).toBe(0);
    expect(deletes).toEqual([]);
    expect(puts).toEqual([]);
    expect(notified).toBe(0);
    expect(out.status).toBe(200);
    expect(await out.text()).toBe("console.log('hi');\n");
  });

  it("evicts and refetches when cached bytes mismatch; serves verified refetch", async () => {
    const cleanBytes = new TextEncoder().encode("export const x = 1;\n");
    const tamperedBytes = new TextEncoder().encode("export const x = 2;\n");
    const expected = await sha384Of(cleanBytes);
    const { cache, store, deletes, puts } = makeMockCache();
    store.set(ASSET_URL, new Response(tamperedBytes));

    let fetchCalls = 0;
    let notified = 0;
    const out = await mod.handleAssetFetch({
      request: new Request(ASSET_URL),
      cache,
      knownHashes: { "/assets/main-deadbeef.js": expected },
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response(cleanBytes, { status: 200 });
      },
      notifyIntegrityFailure: async () => {
        notified += 1;
      },
    });

    expect(fetchCalls).toBe(1);
    expect(deletes).toEqual([ASSET_URL]);
    expect(notified).toBe(0);
    expect(out.status).toBe(200);
    expect(await out.text()).toBe("export const x = 1;\n");
    // Verified refetch must be re-cached so the next request hits the
    // happy path instead of refetching every time.
    expect(puts.length).toBe(1);
    expect(puts[0][0]).toBe(ASSET_URL);
  });

  it("refuses and surfaces integrity-failure overlay when fresh fetch also mismatches", async () => {
    const cleanBytes = new TextEncoder().encode("export const ok = true;\n");
    const tamperedBytes = new TextEncoder().encode(
      "export const ok = false;\n",
    );
    const expected = await sha384Of(cleanBytes);
    const { cache, store, deletes, puts } = makeMockCache();
    // Cache miss for this case — the fresh fetch is what mismatches.
    expect(store.size).toBe(0);

    const notifications: Array<{
      url: string;
      expected: string;
      actual: string | null;
    }> = [];
    const out = await mod.handleAssetFetch({
      request: new Request(ASSET_URL),
      cache,
      knownHashes: { "/assets/main-deadbeef.js": expected },
      fetchImpl: async () =>
        new Response(tamperedBytes, { status: 200 }),
      notifyIntegrityFailure: async (detail) => {
        notifications.push(detail);
      },
    });

    expect(notifications.length).toBe(1);
    expect(notifications[0].url).toBe(ASSET_URL);
    expect(notifications[0].expected).toBe(expected);
    expect(notifications[0].actual).not.toBe(expected);
    expect(out.status).toBe(502);
    expect(out.statusText).toBe("integrity-failure");
    // Tampered bytes must NOT have been pinned into the cache.
    expect(puts).toEqual([]);
    expect(deletes).toEqual([]);
  });

  it("falls back to stale-while-revalidate for assets not in the SRI baseline", async () => {
    // Pre-task-489 superset property: a URL with no entry in
    // sw-known-hashes.json (e.g. /manifest.json, /favicon.ico) must
    // continue to be cached the old way so this change does not silently
    // break unhashed public/ assets.
    const FAVICON = "https://void.test/favicon.ico";
    const bytes = new TextEncoder().encode("\u0000\u0000fake-ico");
    const { cache, store, puts } = makeMockCache();

    const out = await mod.handleAssetFetch({
      request: new Request(FAVICON),
      cache,
      knownHashes: {},
      fetchImpl: async () => new Response(bytes, { status: 200 }),
      notifyIntegrityFailure: async () => {
        throw new Error("integrity overlay must not fire for unhashed assets");
      },
    });

    expect(out.status).toBe(200);
    // Either the fresh response is returned synchronously OR a cache.put
    // happened against the fresh response — the legacy stale-while-
    // revalidate semantics let either path succeed depending on cache
    // hit/miss; this test exercises the miss path.
    expect(store.has(FAVICON) || puts.length > 0).toBe(true);
  });
});
