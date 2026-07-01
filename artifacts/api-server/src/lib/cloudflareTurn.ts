// SPDX-License-Identifier: AGPL-3.0-or-later
// Cloudflare-hosted TURN credential helper (task #538).
//
// Self-hosted coturn (`TURN_URL` + `TURN_SECRET`) remains the canonical
// production path and is implemented inline in `routes/ice-servers.ts`.
// This helper adds a *testing-only* alternative branch: when an operator
// sets `CLOUDFLARE_TURN_TOKEN_ID` and `CLOUDFLARE_TURN_API_TOKEN`, the
// `/api/ice-servers` route POSTs to Cloudflare's credentials API and
// forwards the pre-minted `iceServers` array to the client.
//
// Privacy caveat: Cloudflare TURN means TURN-relayed call metadata
// (operator IPs, peer IPs at relay-allocation time, packet timings)
// transits Cloudflare's edge. Use self-hosted coturn for production
// where sovereignty matters. See README-selfhost.md §4 for the
// operator-facing framing.
//
// Design notes:
//   * Single in-process cache keyed by token-ID, with TTL minus a small
//     safety buffer so we don't hand a credential to a client that's
//     about to expire mid-call.
//   * Concurrent cache-miss requests coalesce on one in-flight fetch
//     so a flood of clients can't be amplified into a flood of
//     Cloudflare API calls (the per-IP `RATE_MAX=10/min` limit on the
//     route itself is the first line of defense; this is the second).
//   * Outbound fetch is wrapped with an `AbortController` and a
//     5-second timeout. All failure modes (timeout, 4xx, 5xx, malformed
//     JSON, missing `iceServers`) fail closed with a structured error
//     the route maps to `{ iceServers: [], no_turn_configured: true }`
//     and a 503 — never a 500 stack trace, never a silent empty array
//     masquerading as success.
//   * The `CLOUDFLARE_TURN_API_TOKEN` value is branded `Secret<string>`
//     at the env-read site so the custom `no-secret-equality` eslint
//     rule catches any accidental `===` compare against it.

import { markSecret, unwrapSecret, type Secret } from "@workspace/wire-core";
import { logger } from "./logger";

const CLOUDFLARE_TURN_ENDPOINT =
  "https://rtc.live.cloudflare.com/v1/turn/keys";

const FETCH_TIMEOUT_MS = 5_000;
const CACHE_SAFETY_BUFFER_MS = 60_000;

export interface CloudflareIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface CacheEntry {
  iceServers: CloudflareIceServer[];
  ttl: number;
  expiresAt: number;
}

export interface CloudflareTurnSuccess {
  ok: true;
  iceServers: CloudflareIceServer[];
  ttl: number;
  expiresAt: number;
  cached: boolean;
}

export interface CloudflareTurnFailure {
  ok: false;
  status: number;
  reason: string;
}

export type CloudflareTurnResult =
  | CloudflareTurnSuccess
  | CloudflareTurnFailure;

interface ResolvedCreds {
  tokenId: string;
  apiToken: Secret<string>;
}

export function readCloudflareCreds(): ResolvedCreds | null {
  const tokenId = process.env["CLOUDFLARE_TURN_TOKEN_ID"];
  const rawApiToken = process.env["CLOUDFLARE_TURN_API_TOKEN"];
  if (!tokenId || !rawApiToken) return null;
  return { tokenId, apiToken: markSecret(rawApiToken) };
}

export function cloudflareCredsConfigured(): boolean {
  return readCloudflareCreds() !== null;
}

export function tokenIdSuffix(tokenId: string): string {
  if (tokenId.length <= 4) return tokenId;
  return tokenId.slice(-4);
}

// Cache + coalescing state. Module-scoped on purpose: one cache per
// process matches the deployment model (one server, one Cloudflare
// account at a time). `resetCloudflareTurnCacheForTests` clears it
// between vitest cases.
let cacheByTokenId = new Map<string, CacheEntry>();
let inflightByTokenId = new Map<string, Promise<CloudflareTurnResult>>();

export function resetCloudflareTurnCacheForTests(): void {
  cacheByTokenId = new Map();
  inflightByTokenId = new Map();
}

function isFreshCacheEntry(entry: CacheEntry, now: number): boolean {
  return entry.expiresAt * 1000 - CACHE_SAFETY_BUFFER_MS > now;
}

async function fetchFromCloudflare(
  creds: ResolvedCreds,
  ttl: number,
): Promise<CloudflareTurnResult> {
  const url = `${CLOUDFLARE_TURN_ENDPOINT}/${encodeURIComponent(creds.tokenId)}/credentials/generate-ice-servers`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        // Unwrap the brand only at the third-party (Cloudflare HTTP)
        // boundary. The token never participates in an equality
        // compare anywhere in this module.
        Authorization: `Bearer ${unwrapSecret(creds.apiToken)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl }),
      signal: controller.signal,
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timeout"
        : "fetch_error";
    logger.warn(
      { reason, tokenIdSuffix: tokenIdSuffix(creds.tokenId) },
      "Cloudflare TURN fetch failed",
    );
    return { ok: false, status: 503, reason };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    logger.warn(
      {
        status: res.status,
        tokenIdSuffix: tokenIdSuffix(creds.tokenId),
      },
      "Cloudflare TURN responded with non-2xx",
    );
    // 4xx (credentials wrong / token revoked / token-id wrong) and 5xx
    // (Cloudflare upstream blip) both surface as a 503 to the client
    // — operators can disambiguate from the WARN log line. Returning
    // the upstream 4xx unchanged would mislead the client into
    // thinking *its* request was malformed.
    return { ok: false, status: 503, reason: `upstream_${res.status}` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    logger.warn(
      { tokenIdSuffix: tokenIdSuffix(creds.tokenId) },
      "Cloudflare TURN returned malformed JSON",
    );
    return { ok: false, status: 503, reason: "malformed_json" };
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { iceServers?: unknown }).iceServers)
  ) {
    logger.warn(
      { tokenIdSuffix: tokenIdSuffix(creds.tokenId) },
      "Cloudflare TURN response missing iceServers field",
    );
    return { ok: false, status: 503, reason: "missing_ice_servers" };
  }

  const iceServers = (body as { iceServers: CloudflareIceServer[] })
    .iceServers;
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ttl;
  return {
    ok: true,
    iceServers,
    ttl,
    expiresAt,
    cached: false,
  };
}

/**
 * Get a Cloudflare-minted ICE-servers payload, using the per-process
 * cache when fresh and coalescing concurrent cache-misses onto a
 * single outbound fetch.
 */
export async function getCloudflareIceServers(
  ttl: number,
): Promise<CloudflareTurnResult> {
  const creds = readCloudflareCreds();
  if (!creds) {
    return { ok: false, status: 503, reason: "not_configured" };
  }

  const now = Date.now();
  const cached = cacheByTokenId.get(creds.tokenId);
  if (cached && isFreshCacheEntry(cached, now)) {
    return {
      ok: true,
      iceServers: cached.iceServers,
      ttl: cached.ttl,
      expiresAt: cached.expiresAt,
      cached: true,
    };
  }

  const inflight = inflightByTokenId.get(creds.tokenId);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const result = await fetchFromCloudflare(creds, ttl);
      if (result.ok) {
        cacheByTokenId.set(creds.tokenId, {
          iceServers: result.iceServers,
          ttl: result.ttl,
          expiresAt: result.expiresAt,
        });
      }
      return result;
    } finally {
      inflightByTokenId.delete(creds.tokenId);
    }
  })();

  inflightByTokenId.set(creds.tokenId, promise);
  return promise;
}
