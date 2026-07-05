// SPDX-License-Identifier: AGPL-3.0-or-later
// Single source of truth for "what IP do we attribute this request to?".
//
// Why this helper exists (security audit H-01):
// `X-Forwarded-For` is appended to as a request walks a chain of proxies.
// The *leftmost* token is whatever the original upstream peer claimed; an
// attacker can put any value they like there. Each *trusted* proxy in our
// chain appends the IP it actually saw to the *right*. So with our deployment
// topology (`app.set("trust proxy", 1)` in app.ts — see TRUST_PROXY_HOPS for
// operator-overridable hop count), the rightmost N entries are added by
// proxies WE control and are safe to read; everything to the left of that
// is attacker-controlled.
//
// Reading the leftmost token (the previous bug) lets a single source rotate
// spoofed values to mint unlimited per-IP rate-limit buckets and bypass the
// per-IP connection cap and per-IP join-failure throttle. Express's `req.ip`
// already does the right thing via `proxy-addr` because we set the trust
// proxy count globally; this helper exists for code paths (notably the
// Socket.io connection middleware) that don't have an Express `req` to read
// `req.ip` off of, so they need a manual implementation that uses the same
// rule. Do not introduce another path that splits `x-forwarded-for` and
// indexes `[0]`.

const TRUST_PROXY_HOPS = (() => {
  const raw = Number(process.env["TRUST_PROXY_HOPS"] ?? "1");
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 1;
})();

interface RawIpSource {
  remoteAddress: string | undefined;
  forwardedHeader: string | string[] | undefined;
}

function resolveTrustedIp(source: RawIpSource, trustedHops: number): string {
  const headerValue = Array.isArray(source.forwardedHeader)
    ? source.forwardedHeader.join(",")
    : source.forwardedHeader ?? "";

  const xffEntries = headerValue
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Build the proxy chain in front-to-back order (closest to us first):
  //   chain[0] = the immediate TCP peer (always a trusted hop, since the
  //              connection terminated at us through it)
  //   chain[i] = the i-th hop walking back toward the client; sourced from
  //              the X-Forwarded-For header in right-to-left order.
  //
  // The first `trustedHops` chain entries were appended by proxies we trust,
  // so the first untrusted address is `chain[trustedHops]`. If the chain is
  // shorter than that (the request didn't traverse as many proxies as we
  // claim to trust), every entry is trusted and the safest value is the
  // last (leftmost) one — which is the actual client.
  const chain: string[] = [
    source.remoteAddress ?? "",
    ...xffEntries.slice().reverse(),
  ];

  const trusted = chain[trustedHops] ?? chain[chain.length - 1] ?? "";
  return trusted.length > 0 ? trusted : "unknown";
}

export function getTrustedClientIp(socket: import("socket.io").Socket): string {
  return resolveTrustedIp(
    {
      remoteAddress: socket.handshake.address,
      forwardedHeader: socket.handshake.headers["x-forwarded-for"],
    },
    TRUST_PROXY_HOPS,
  );
}

// Internal seam exposed for unit tests so they can exercise the chain-walk
// logic without spinning up a real Socket.io server. Not part of the public
// API; nothing else in the codebase should import this.
export const __test = { resolveTrustedIp, TRUST_PROXY_HOPS };
