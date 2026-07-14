// SPDX-License-Identifier: AGPL-3.0-or-later
import { isValidOnionHostname } from "./torPosture";

/**
 * Classify a (trimmed, non-empty) PUBLIC_ORIGIN value. `ok: true` means the
 * value parses as a URL with an http(s) scheme and will contribute its origin
 * to the CORS allowlist. Otherwise `reason` says why it was rejected, so the
 * startup warning can name the exact problem instead of leaving the operator
 * with an empty allowlist and no explanation.
 */
export function classifyPublicOrigin(
  value: string,
): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      reason:
        "not a parseable URL — a scheme is required (e.g. https://void.example.com, not void.example.com)",
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `unsupported scheme "${parsed.protocol.replace(/:$/, "")}" — only http and https are allowed`,
    };
  }
  return { ok: true };
}

/**
 * Return the rejected PUBLIC_ORIGIN value and the reason it was rejected, or
 * null when PUBLIC_ORIGIN is unset/empty or valid. Used by the startup
 * warning in lib/effectiveConfig.ts.
 */
export function rejectedPublicOrigin(
  env: NodeJS.ProcessEnv = process.env,
): { value: string; reason: string } | null {
  const publicOrigin = (env["PUBLIC_ORIGIN"] ?? "").trim();
  if (!publicOrigin) return null;
  const verdict = classifyPublicOrigin(publicOrigin);
  if (verdict.ok) return null;
  return { value: publicOrigin, reason: verdict.reason };
}

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
  if (publicOrigin && classifyPublicOrigin(publicOrigin).ok) {
    origins.push(new URL(publicOrigin).origin);
  }

  const onionHost = (env["ONION_HOSTNAME"] ?? "").trim();
  if (onionHost && isValidOnionHostname(onionHost)) {
    origins.push(`http://${onionHost}`);
  }

  return [...new Set(origins)];
}
