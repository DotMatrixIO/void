// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sw-integrity.js (task #489 / H-02)
 *
 * Pure helpers for the service worker's cache-integrity check. Loaded into
 * `sw.js` via `importScripts('./sw-integrity.js')`; loaded into unit tests
 * via `vm.runInContext()` against a mocked `self` so the same code paths
 * the browser exercises are the ones the vitest suite asserts on.
 *
 * Why a separate file and not inline in sw.js:
 *   sw.js's responsibility is event wiring (install / activate / fetch).
 *   The integrity logic is ~80 lines of crypto/cache plumbing whose
 *   correctness is best proven in a vitest with a mocked Cache API.
 *   Keeping them separate lets the SW stay a thin event-handler shell and
 *   lets the logic be exercised by tests without bringing a real
 *   ServiceWorkerGlobalScope into the test runtime.
 *
 * Exposes `self.SwIntegrity` with three pure functions:
 *   - sha384Base64(bytes): compute "sha384-<base64>" from an ArrayBuffer.
 *   - verifyResponse(response, expected): clone+hash a Response and
 *     compare against the SRI string from sw-known-hashes.json.
 *   - handleAssetFetch({ request, cache, knownHashes, fetchImpl,
 *       notifyIntegrityFailure }): the full cache-or-fetch decision tree
 *     for one asset request. Returns a Response or a refusal Response on
 *     integrity failure.
 *
 * The decision tree:
 *   1. Look up `expected` by URL pathname in `knownHashes`.
 *   2. If no expected hash (asset is not in the SRI baseline — e.g. a
 *      public/ file that pre-dates Vite's emit), fall back to the old
 *      stale-while-revalidate behaviour so this script is a strict
 *      superset of the pre-task-489 SW.
 *   3. If expected and cached: hash the cached bytes; on match, serve
 *      cached; on mismatch, evict and fall through to refetch.
 *   4. Refetch with `fetchImpl(request)`. If the response is not ok,
 *      return it as-is (network errors are not integrity failures — they
 *      are the operator's normal "offline" UX).
 *   5. Hash the fresh response; on match, cache and serve; on mismatch,
 *      call notifyIntegrityFailure() so the client overlay
 *      (index.html:61-125) surfaces, and return a 502 refusal so the
 *      caller does not silently render tampered bytes.
 */
(function (scope) {
  "use strict";

  function bytesToBase64(view) {
    let bin = "";
    for (let i = 0; i < view.length; i++) bin += String.fromCharCode(view[i]);
    return scope.btoa(bin);
  }

  async function sha384Base64(buffer) {
    const digest = await scope.crypto.subtle.digest("SHA-384", buffer);
    return "sha384-" + bytesToBase64(new Uint8Array(digest));
  }

  async function verifyResponse(response, expected) {
    if (!expected) return { ok: true, skipped: true, actual: null };
    const cloned = response.clone();
    const bytes = await cloned.arrayBuffer();
    const actual = await sha384Base64(bytes);
    return { ok: actual === expected, actual, expected };
  }

  function pathnameKey(requestUrl) {
    try {
      return new URL(requestUrl).pathname;
    } catch (_err) {
      return requestUrl;
    }
  }

  function lookupExpected(knownHashes, requestUrl) {
    if (!knownHashes) return null;
    const path = pathnameKey(requestUrl);
    return knownHashes[path] || null;
  }

  async function handleAssetFetch(opts) {
    const {
      request,
      cache,
      knownHashes,
      fetchImpl,
      notifyIntegrityFailure,
    } = opts;
    const expected = lookupExpected(knownHashes, request.url);

    // No SRI baseline for this URL — preserve the original
    // stale-while-revalidate behaviour so this script is a strict superset
    // of the pre-task-489 SW (favicons, splash screens, manifest.json,
    // worker scripts that ship outside the Vite graph).
    if (!expected) {
      const cached = await cache.match(request);
      const fetched = Promise.resolve(fetchImpl(request))
        .then((response) => {
          if (response && response.ok) {
            // cache.put returns a promise; do not block the serve on it.
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        })
        .catch(() => cached || null);
      return cached || fetched;
    }

    const cached = await cache.match(request);
    if (cached) {
      const verdict = await verifyResponse(cached, expected);
      if (verdict.ok) return cached;
      // Cached bytes do not match the known hash. Evict so the next
      // request after a successful refetch starts from a clean slate, and
      // fall through to refetch.
      try {
        await cache.delete(request);
      } catch (_err) {
        // best-effort eviction; refetch path is what actually matters.
      }
    }

    let fresh;
    try {
      fresh = await fetchImpl(request);
    } catch (err) {
      // Genuine network failure (offline, DNS, etc.) is not an integrity
      // failure. Surface the underlying error to the caller — the SW's
      // fetch handler is the place to decide between offline-fallback
      // and propagation.
      throw err;
    }

    if (!fresh || !fresh.ok) {
      // Non-2xx is not an integrity failure either; the operator sees
      // their normal network-error UX (e.g. 404 if an asset was deleted
      // out from under a stale HTML reference).
      return fresh;
    }

    const freshVerdict = await verifyResponse(fresh, expected);
    if (!freshVerdict.ok) {
      // Loud-fail: same mode as install-time SRI. Tell every client to
      // raise the integrity-failure overlay (index.html:61-125) and
      // refuse to serve the tampered bytes.
      try {
        await notifyIntegrityFailure({
          url: request.url,
          expected,
          actual: freshVerdict.actual,
        });
      } catch (_err) {
        // postMessage failures must not mask the refusal below.
      }
      return new Response("", {
        status: 502,
        statusText: "integrity-failure",
      });
    }

    try {
      await cache.put(request, fresh.clone());
    } catch (_err) {
      // Cache write failures must not block serving the verified bytes.
    }
    return fresh;
  }

  scope.SwIntegrity = {
    sha384Base64,
    verifyResponse,
    pathnameKey,
    lookupExpected,
    handleAssetFetch,
  };
})(typeof self !== "undefined" ? self : globalThis);
