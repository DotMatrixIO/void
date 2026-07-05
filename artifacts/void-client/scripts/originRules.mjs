// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * originRules.mjs
 *
 * Single source of truth for what counts as a valid PUBLIC_ORIGIN — the
 * absolute origin baked into the social-card OG pages. An acceptable value is
 * a well-formed absolute URL with an http(s) scheme and no path component
 * (pathname must be exactly "/").
 *
 * This rule is shared by:
 *   - gen-og-pages.mjs (validateOrigin, the build-time strict-mode guard), and
 *   - scripts/preflight-build-vars.mjs (the CI preflight that fails fast when
 *     PUBLIC_ORIGIN is missing or malformed, before any build step runs).
 *
 * Keeping the rule here means the preflight and the actual build can never
 * disagree about which origins are acceptable.
 *
 * Examples of values that FAIL:
 *   - "void.example.com"             — missing scheme
 *   - "ftp://void.example.com"       — non-http(s) scheme
 *   - "https://void.example.com/app" — non-root path
 */

/**
 * Return a human-readable reason `candidate` is not a valid absolute root
 * origin, or `null` if it is valid. Trailing slashes are tolerated by the
 * URL parser (pathname stays "/"), but any other path component is rejected.
 *
 * @param {string | null | undefined} candidate
 * @returns {string | null}
 */
export function originProblem(candidate) {
  if (candidate === null || candidate === undefined || candidate === "") {
    return "origin is unset or empty";
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return `"${candidate}": not a valid URL. Expected e.g. https://void.example.com`;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `"${candidate}": scheme must be http or https, got "${parsed.protocol}". Use e.g. https://void.example.com`;
  }
  if (parsed.pathname !== "/") {
    return `"${candidate}": must be a root URL with no path, got pathname "${parsed.pathname}". Strip the path and use e.g. ${parsed.protocol}//${parsed.host}`;
  }
  return null;
}
