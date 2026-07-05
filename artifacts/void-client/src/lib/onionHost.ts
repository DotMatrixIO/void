// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Single source of truth for what counts as a syntactically valid Tor v3
// `.onion` host. This definition is shared by BOTH the runtime origin check
// (src/lib/origin.ts → src/lib/onionMirror.ts → StartScreen) and the
// build-time "onion-bake inertness" guard wired into vite.config.ts, so the
// two can never disagree about what a valid onion address looks like.
//
// A Tor v3 onion address is EXACTLY 56 base32 characters (the alphabet is
// [a-z2-7]) immediately before the `.onion` TLD. The earlier check only
// asserted that the final label equalled "onion", which accepted bogus
// values like `foo.onion` or a truncated v2-length label. Tightening to the
// real v3 shape is what lets the build guard fail closed: a production build
// that bakes in an onion mirror affordance but ships a malformed (or unset)
// host would otherwise render nothing, silently shipping a "Tor-reachable"
// bundle whose onion affordance is inert.

/**
 * The base32 label of a Tor v3 onion address: exactly 56 characters drawn
 * from the RFC 4648 base32 alphabet, lowercased ([a-z2-7]).
 */
export const ONION_V3_LABEL_RE = /^[a-z2-7]{56}$/;

/**
 * True when `hostname`'s final label is `onion` (case-insensitive) and the
 * label immediately before it is a valid v3 base32 label. A trailing FQDN
 * dot is tolerated. Subdomains in front of the v3 label are allowed (e.g.
 * `www.<56-char>.onion`), but the v3 label itself must be exactly 56 base32
 * characters — so `foo.onion`, v2-length labels, and labels with non-base32
 * characters (0, 1, 8, 9) all return false.
 */
export function isOnionV3Hostname(
  hostname: string | null | undefined,
): boolean {
  if (!hostname) return false;
  // Strip any trailing dot(s) (FQDN form) before splitting, then lowercase
  // so the base32 alphabet check is case-insensitive.
  const cleaned = hostname.replace(/\.+$/, "").toLowerCase();
  if (!cleaned) return false;
  const labels = cleaned.split(".");
  if (labels.length < 2) return false;
  if (labels[labels.length - 1] !== "onion") return false;
  return ONION_V3_LABEL_RE.test(labels[labels.length - 2]);
}

/**
 * Normalize a raw `VITE_VOID_ONION_HOST` value — which may carry an
 * `http(s)://` scheme, a path, or trailing slashes — to its bare hostname,
 * or `null` if it is not a valid v3 `.onion` host. Shared by the onion
 * mirror URL builder and the build guard so both parse the env value the
 * same way.
 */
export function extractOnionHost(
  raw: string | null | undefined,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const host = stripped.split("/")[0];
  return isOnionV3Hostname(host) ? host : null;
}

/**
 * Inspect a raw `VITE_VOID_ONION_HOST` value and return a human-readable
 * reason it cannot be baked into an onion-reachable build, or `null` if it
 * is a valid v3 onion host. Used by the build guard to produce a precise
 * failure message (distinguishing "unset" from "malformed").
 */
export function onionBakeProblem(
  raw: string | null | undefined,
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return "VITE_VOID_ONION_HOST is unset or empty";
  }
  if (extractOnionHost(trimmed) === null) {
    return (
      `VITE_VOID_ONION_HOST=${JSON.stringify(raw)} is not a syntactically ` +
      `valid Tor v3 .onion host (expected a 56-character base32 [a-z2-7] ` +
      `label immediately before ".onion")`
    );
  }
  return null;
}

/**
 * Fail-closed assertion for the onion-bake build guard. Throws when the
 * supplied raw env value is unset or not a valid v3 onion host; returns
 * silently otherwise. Callers gate this on the build path (see
 * vite.config.ts) so dev builds stay permissive by default.
 */
export function assertOnionBake(raw: string | null | undefined): void {
  const problem = onionBakeProblem(raw);
  if (problem === null) return;
  throw new Error(
    `[onion-bake] ${problem}.\n` +
      `This build expects a Tor .onion mirror to be baked in (a canonical / ` +
      `NODE_ENV=production build, or one run with VOID_REQUIRE_ONION=1), but ` +
      `the onion affordance would resolve to null and render nothing — ` +
      `shipping a "Tor-reachable" bundle whose onion mirror link is silently ` +
      `inert. Set VITE_VOID_ONION_HOST to the deployment's ` +
      `<56-char-base32>.onion host, or build without the onion-bake ` +
      `requirement (unset NODE_ENV=production / VOID_REQUIRE_ONION) for a ` +
      `clearnet-only bundle.`,
  );
}
