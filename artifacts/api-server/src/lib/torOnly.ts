// SPDX-License-Identifier: AGPL-3.0-or-later
// Runtime behavior for the StartOS Tor-only deployment posture.
//
// Background: the load-bearing part of the Tor-only switch is the manifest
// edit that removes the `lan-config` block so the StartOS package ships
// .onion-only (see README-selfhost.md §6b). `TOR_ONLY=1` was reserved as an
// env-var contract so runtime code could later *protect* that posture without
// an env-var rename. This module is that runtime code.
//
// What "protecting the posture" means in practice:
//   1. Suppress any STUN fallback. A STUN binding request reveals the
//      client's public IP to the (clearnet) STUN server during ICE
//      gathering — exactly the disclosure an onion-only operator is trying
//      to avoid. Under TOR_ONLY the ICE-server response omits STUN entirely.
//   2. Warn at startup if TURN_URL is configured but does not appear to
//      terminate over Tor. A clearnet TURN relay reached off-Tor undermines
//      the onion-only intent; an over-Tor relay is a `turns:` endpoint on a
//      `.onion` host.
//   3. Print a startup banner so the operator can confirm the posture is
//      active from the logs.

const TOR_ONLY_ENV = "TOR_ONLY";

/**
 * True when the operator has opted into the onion-only posture via
 * `TOR_ONLY=1`. The contract is the literal string "1" (the value
 * documented in README-selfhost.md §5 and the manifests); any other value
 * — including "true", "0", or unset — leaves the posture off so a typo
 * does not silently change ICE behavior.
 */
export function isTorOnly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TOR_ONLY_ENV] === "1";
}

/**
 * Heuristic: does a configured TURN URL appear to terminate over Tor?
 *
 * An over-Tor TURN relay is a `turns:` (TLS-over-TCP) endpoint on a
 * `.onion` host — Tor only carries TCP, and the `.onion` host is what keeps
 * the relay reachable without a clearnet hop. We require BOTH conditions:
 * a plain `turn:` (often UDP) endpoint or a clearnet host both defeat the
 * onion-only intent. The check is intentionally conservative — it only
 * suppresses the startup warning for endpoints that clearly stay on Tor.
 */
export function turnUrlTerminatesOverTor(turnUrl: string): boolean {
  const trimmed = turnUrl.trim();
  // TURN URI grammar is `scheme ":" host [":" port] ["?transport=" ...]`.
  // Some operators paste a `//` after the scheme; tolerate it. Bracketed
  // IPv6 literals are never `.onion`, so the simple host capture is fine.
  const match = /^(turns?):(?:\/\/)?\[?([^\]/:?]+)\]?/i.exec(trimmed);
  if (!match) return false;
  const scheme = (match[1] ?? "").toLowerCase();
  const host = (match[2] ?? "").toLowerCase();
  return scheme === "turns" && host.endsWith(".onion");
}

/**
 * True when `url` is a STUN (`stun:` / `stuns:`) URI. Case-insensitive and
 * tolerant of leading whitespace. Used to strip STUN sources under TOR_ONLY
 * — a STUN binding request reveals the client's public IP to a clearnet
 * third party during ICE gathering, the disclosure onion-only routing exists
 * to prevent.
 */
export function isStunUrl(url: string): boolean {
  return /^stuns?:/i.test(url.trim());
}

/**
 * Remove every STUN URL from a list of ICE servers, dropping any entry left
 * with no URLs. An entry's `urls` may be a single string or an array (the
 * shape Cloudflare's credentials API returns), so we filter array members
 * individually and keep the entry only if a non-STUN URL survives.
 *
 * This enforces the onion-only posture on the Cloudflare-TURN branch of
 * /api/ice-servers, whose payload is minted upstream by Cloudflare and
 * routinely bundles a clearnet STUN entry alongside the TURN relay. The
 * configured-coturn and no-TURN branches already suppress STUN under
 * TOR_ONLY inline; this lets the Cloudflare branch do the same so no clearnet
 * ICE source is advertised and /api/proof/posture's `iceStunSuppressed`
 * claim holds for every branch.
 */
export function stripStunIceServers<T extends { urls: string | string[] }>(
  iceServers: T[],
): T[] {
  const result: T[] = [];
  for (const server of iceServers) {
    if (typeof server.urls === "string") {
      if (!isStunUrl(server.urls)) result.push(server);
      continue;
    }
    const kept = server.urls.filter((u) => !isStunUrl(u));
    if (kept.length > 0) result.push({ ...server, urls: kept });
  }
  return result;
}

/**
 * The multi-line startup banner confirming the onion-only posture is
 * active. Boxed like the ICE/TURN banner in index.ts so it is hard to miss
 * in a busy log.
 */
export function torOnlyStartupBanner(): string {
  return [
    "",
    "==============================================================================",
    "  TOR_ONLY=1 — onion-only posture ACTIVE",
    "------------------------------------------------------------------------------",
    "  /api/ice-servers will NOT advertise any STUN server — a STUN binding",
    "  request would reveal each peer's public IP to a clearnet third party",
    "  during ICE gathering, defeating onion-only routing.",
    "  Configure TURN only as a turns: relay on a .onion host, or expect",
    "  cross-NAT calls to fall back to host candidates only.",
    "  See README-selfhost.md §6b.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Returns the startup warning string when TURN_URL is configured but does
 * not appear to terminate over Tor, or null when no warning is warranted
 * (TURN unset, or it already looks like an over-Tor `turns:`/`.onion`
 * endpoint). index.ts logs the returned string at WARN.
 */
export function torOnlyTurnWarning(turnUrl: string | undefined): string | null {
  if (!turnUrl || !turnUrl.trim()) return null;
  if (turnUrlTerminatesOverTor(turnUrl)) return null;
  return (
    `TOR_ONLY=1 but TURN_URL (${turnUrl}) does not appear to terminate over ` +
    `Tor (expected a turns: relay on a .onion host). A clearnet TURN relay ` +
    `reached off-Tor undermines the onion-only posture. See ` +
    `README-selfhost.md §6b.`
  );
}

/**
 * Returns the startup warning string when Cloudflare TURN credentials are
 * configured under TOR_ONLY, or null when they are not. index.ts logs the
 * returned string at WARN.
 *
 * Task #1028 stripped the clearnet STUN entry from the Cloudflare branch of
 * /api/ice-servers under TOR_ONLY, so it no longer leaks peer IPs via a STUN
 * binding request. But the Cloudflare TURN *relay itself* terminates on
 * Cloudflare's clearnet edge: relayed call metadata (operator and peer IPs at
 * allocation time, packet timings) still transits a clearnet third party even
 * with TOR_ONLY=1. There is no `turns:`/`.onion` form of Cloudflare TURN that
 * would keep this on Tor — the host is fixed clearnet — so unlike
 * torOnlyTurnWarning there is no "looks over-Tor, suppress the warning" case:
 * any configured Cloudflare creds under TOR_ONLY warrant the warning.
 *
 * Decision — warn, do not hard-refuse. We mirror torOnlyTurnWarning's
 * warn-don't-block stance (a clearnet coturn TURN_URL is also only warned)
 * rather than silently dropping the relay and breaking cross-NAT calls. The
 * operator picked Cloudflare deliberately; an onion-only deployer who reads
 * the banner can unset the two env vars, while one who is briefly staging a
 * cross-NAT test keeps a working relay. Hard-refusal is captured as the
 * rejected alternative in README-selfhost.md §6b.
 */
export function torOnlyCloudflareWarning(
  cloudflareConfigured: boolean,
): string | null {
  if (!cloudflareConfigured) return null;
  return (
    `TOR_ONLY=1 but Cloudflare TURN credentials are configured. The ` +
    `Cloudflare relay terminates on Cloudflare's clearnet edge, so relayed ` +
    `call metadata (operator and peer IPs at allocation time, packet ` +
    `timings) still transits a clearnet third party off-Tor — undermining ` +
    `the onion-only posture even though STUN is suppressed. Use a turns: ` +
    `relay on a .onion host for production, or unset ` +
    `CLOUDFLARE_TURN_TOKEN_ID / CLOUDFLARE_TURN_API_TOKEN. See ` +
    `README-selfhost.md §6b.`
  );
}
