// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * sw.js — VOID service worker.
 *
 * Caches static assets with a verified stale-while-revalidate strategy.
 * Task #489 / H-02 added the verification half: every cached-asset serve
 * is re-checked against the SRI baseline emitted by gen-sw-known-hashes.mjs
 * so a one-time bad fetch (flaky CDN, partial corruption that beat the
 * initial-load SRI race) cannot pin into the cache and persist across
 * sessions. The integrity decision tree lives in sw-integrity.js; this
 * file is just the event wiring.
 *
 * On install:
 *   - Precache the entry HTML.
 *   - Fetch sw-known-hashes.json (the SRI table) and hold it in module
 *     state for the lifetime of this worker. A missing/failed fetch
 *     leaves the table empty, which downgrades behaviour to the
 *     pre-task-489 stale-while-revalidate for every asset — strictly no
 *     worse than the previous shipped SW.
 *
 * On fetch (asset):
 *   - Delegate to SwIntegrity.handleAssetFetch, which:
 *       1. Looks up the expected sha384 by URL pathname.
 *       2. If cached: verify; on match serve cached; on mismatch evict
 *          and refetch.
 *       3. On refetch: verify; on match cache + serve; on mismatch
 *          postMessage every controlled client to raise the existing
 *          integrity-failure overlay (index.html:61-125) and refuse to
 *          serve the tampered bytes (HTTP 502 "integrity-failure").
 */

importScripts("./sw-integrity.js");

const CACHE_NAME = "2bit-v1";
const PRECACHE = [
  "./",
];
const KNOWN_HASHES_URL = "./sw-known-hashes.json";

let knownHashesPromise = null;

function loadKnownHashes() {
  if (!knownHashesPromise) {
    knownHashesPromise = fetch(KNOWN_HASHES_URL, { cache: "no-store" })
      .then((r) => (r && r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return knownHashesPromise;
}

async function notifyIntegrityFailure(detail) {
  const clients = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  for (const client of clients) {
    try {
      client.postMessage({ type: "void:integrity-failure", ...detail });
    } catch (_err) {
      // best-effort broadcast
    }
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)),
      loadKnownHashes(),
    ]),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("socket.io")) return;
  if (url.pathname.endsWith("/sw-known-hashes.json")) return;

  // Runtime-proof carve-out. The /proof/runtime page must hash the bytes
  // the NETWORK actually served — otherwise a once-poisoned cache would
  // self-attest forever and a fresh CDN attack would be invisible to a
  // client serving cache-first bytes from here. `cache: "no-store"` alone
  // does NOT bypass us: the SW sits in front of the HTTP cache, so the
  // proof page marks its probe fetches with this header and we pass them
  // straight to the network, never touching the Cache API. This only
  // changes which bytes the proof page sees; integrity enforcement for
  // every normal asset load is unchanged. It does NOT (and cannot) defend
  // against an attacker who controls the bundle — that attacker also
  // controls this SW and the proof page itself.
  if (e.request.headers.get("x-void-proof-bypass") === "1") return;

  const isAsset = /\.(js|css|woff2?|ttf|png|svg|ico|webp|json|wav|mp3|ogg|webm)$/.test(url.pathname);

  if (isAsset) {
    e.respondWith(
      Promise.all([caches.open(CACHE_NAME), loadKnownHashes()]).then(
        ([cache, knownHashes]) =>
          self.SwIntegrity.handleAssetFetch({
            request: e.request,
            cache,
            knownHashes,
            fetchImpl: (req) => fetch(req),
            notifyIntegrityFailure,
          }),
      ),
    );
  } else {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
