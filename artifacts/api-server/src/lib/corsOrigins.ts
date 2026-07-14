// SPDX-License-Identifier: AGPL-3.0-or-later
import { isValidOnionHostname } from "./torPosture";

/**
 * Resolve the CORS allowlist for both the Express `cors` middleware and the
 * Socket.io server. Single source of truth so the two can never disagree.
 *
 * Sources, in order:
 *  - Replit dev/prod domains (`REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS`) — the
 *    hosted deployment case.
 *  - Self-host public origin (`PUBLIC_ORIGIN`) — the documented self-host
 *    build/runtime origin (README-selfhost.md).
 *  - Onion mirror (`ONION_HOSTNAME`) — added as `http://<host>` because
 *    production .onion services run plain HTTP (TLS happens inside Tor).
 *
 * CodeQL #11: the previous behavior reflected ANY Origin when self-hosted
 * (`origin: true`). That is gone — when no origin can be derived the list is
 * empty and callers must fail closed (`origin: false`). Same-origin requests
 * are not CORS requests, so a fresh default self-host install (no
 * PUBLIC_ORIGIN / ONION_HOSTNAME set) keeps working: the browser never sends
 * a cross-origin preflight against its own origin.
 */
export function resolveAllowedOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins: string[] = [];

  const devDomain = env["REPLIT_DEV_DOMAIN"];
  if (devDomain) origins.push(`https://${devDomain}`);

  const prodDomain = env["REPLIT_DOMAINS"];
  if (prodDomain) {
    for (const d of prodDomain.split(",")) {
      const trimmed = d.trim();
      if (trimmed) origins.push(`https://${trimmed}`);
    }
  }

  const publicOrigin = (env["PUBLIC_ORIGIN"] ?? "").trim();
  if (publicOrigin) {
    try {
      const parsed = new URL(publicOrigin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        origins.push(parsed.origin);
      }
    } catch {
      // Malformed PUBLIC_ORIGIN: ignore rather than widen the allowlist.
    }
  }

  const onionHost = (env["ONION_HOSTNAME"] ?? "").trim();
  if (onionHost && isValidOnionHostname(onionHost)) {
    origins.push(`http://${onionHost}`);
  }

  return [...new Set(origins)];
}
