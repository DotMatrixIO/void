// SPDX-License-Identifier: AGPL-3.0-or-later
// Consolidated "effective runtime configuration" startup summary.
//
// Background: operators previously confirmed individual settings by scraping
// several separate startup log lines (the ICE/TURN posture banner, the
// TOR_ONLY banner, the opt-in log-retention check, and the Lightning
// fetch-timeout line). There was no single place to verify the server's
// resolved configuration at a glance. This module builds one boxed summary —
// printed once at startup alongside the existing lines — that reports the
// effective, post-clamp / post-fallback values for the main operator knobs.
//
// Privacy: secrets (TURN_SECRET, PAYWALL_SECRET, API tokens) are reported by
// PRESENCE / POSTURE only — their values are never echoed. The Cloudflare
// token is shown by its last-4 suffix only, matching the existing ICE banner.

import { isTorOnly, turnUrlTerminatesOverTor } from "./torOnly";
import {
  resolveAllowedOrigins,
  rejectedPublicOrigin,
  rejectedOnionHostname,
} from "./corsOrigins";
import { cloudflareCredsConfigured, tokenIdSuffix } from "./cloudflareTurn";
import { describeLogRetention } from "./logRetention";
import { lightningConfigSummary } from "../services/lightning";

function describeMode(env: NodeJS.ProcessEnv): string {
  return env["SERVE_STATIC"] === "1"
    ? "self-hosted single-origin (SERVE_STATIC=1)"
    : "split-origin (SERVE_STATIC unset)";
}

function describeTorOnly(env: NodeJS.ProcessEnv): string {
  return isTorOnly(env) ? "ACTIVE (TOR_ONLY=1)" : "off";
}

/**
 * One-line ICE/TURN posture mirroring the branch order in index.ts and
 * routes/ice-servers.ts: Cloudflare TURN takes precedence, then self-hosted
 * coturn (TURN_URL), then STUN-only / none. Reflects the TOR_ONLY STUN
 * suppression so the summary agrees with what /api/ice-servers will actually
 * advertise.
 */
function describeIceTurn(env: NodeJS.ProcessEnv): string {
  if (cloudflareCredsConfigured()) {
    const id = env["CLOUDFLARE_TURN_TOKEN_ID"] ?? "";
    return `Cloudflare TURN (token …${tokenIdSuffix(id)})`;
  }

  const turn = env["TURN_URL"]?.trim();
  const stun = env["STUN_URL"]?.trim();
  const torOnly = isTorOnly(env);

  if (turn) {
    const parts = ["self-hosted TURN configured"];
    if (stun) {
      parts.push(torOnly ? "STUN set but suppressed by TOR_ONLY" : "STUN configured");
    }
    if (torOnly && !turnUrlTerminatesOverTor(turn)) {
      parts.push("TURN does not look over-Tor — see warning above");
    }
    return parts.join("; ");
  }

  if (stun) {
    return torOnly
      ? "STUN set but suppressed by TOR_ONLY; no TURN — cross-NAT calls will fail"
      : "STUN only, no TURN — cross-NAT calls will fail";
  }

  return "no STUN/TURN — host candidates only; cross-NAT calls will fail";
}

/** Report a secret by presence only — never its value. */
function describePresence(raw: string | undefined): boolean {
  return raw !== undefined && raw.trim() !== "";
}

/**
 * Report the resolved CORS allowlist (lib/corsOrigins.ts). The allowlist is
 * fail-closed, so an empty list means every cross-origin browser request is
 * blocked — fine for a same-origin deploy (SERVE_STATIC=1), fatal for a
 * split-origin one. The loud warning for the latter lives in
 * buildCorsMisconfigWarning(); this row just states the facts.
 */
function describeCorsOrigins(env: NodeJS.ProcessEnv): string {
  const origins = resolveAllowedOrigins(env);
  return origins.length > 0
    ? origins.join(", ")
    : "none — same-origin requests only (fail-closed)";
}

/**
 * Boxed warning for the likely split-origin misconfiguration: the CORS
 * allowlist resolved empty AND SERVE_STATIC is unset. In that posture the
 * server is not serving the frontend itself, so the client must live on
 * another origin — and with an empty (fail-closed) allowlist every one of
 * its API calls and Socket.io connections will be silently blocked by the
 * browser. Returns null when the configuration looks fine.
 */
export function buildCorsMisconfigWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env["SERVE_STATIC"] === "1") return null;
  if (resolveAllowedOrigins(env).length > 0) return null;

  return [
    "",
    "==============================================================================",
    "  CORS ALLOWLIST EMPTY IN SPLIT-ORIGIN MODE — browser requests will be blocked",
    "------------------------------------------------------------------------------",
    "  SERVE_STATIC is unset, so this server is not serving the frontend itself,",
    "  yet no allowed origin could be derived from the environment. The CORS",
    "  allowlist is fail-closed: with no entries, every cross-origin API call and",
    "  Socket.io connection from the client will be silently blocked by the",
    "  browser.",
    "  To fix: set PUBLIC_ORIGIN to the client's origin (e.g.",
    "  https://your-domain.example) in the runtime env. See README-selfhost.md §5.",
    "  If this server DOES serve the frontend, set SERVE_STATIC=1 instead —",
    "  same-origin requests are not CORS requests and need no allowlist entry.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Boxed warning for a set-but-rejected PUBLIC_ORIGIN. resolveAllowedOrigins()
 * silently drops a malformed or non-http(s) value rather than widening the
 * allowlist — correct, but confusing: the operator believes they configured
 * split-origin CORS while the allowlist stays empty. This banner names the
 * rejected value, the reason, and the expected shape (https://host) so the
 * symptom becomes a one-line fix. Returns null when PUBLIC_ORIGIN is unset,
 * empty, or valid.
 */
export function buildPublicOriginRejectedWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const rejected = rejectedPublicOrigin(env);
  if (!rejected) return null;

  return [
    "",
    "==============================================================================",
    "  PUBLIC_ORIGIN SET BUT REJECTED — it will NOT be added to the CORS allowlist",
    "------------------------------------------------------------------------------",
    `  Rejected value: ${rejected.value}`,
    `  Reason:         ${rejected.reason}`,
    "  Expected format: a full origin with an http(s) scheme and no path, e.g.",
    "  https://void.example.com",
    "  Until this is fixed the value is ignored, so cross-origin browser requests",
    "  from your client origin will be blocked. See README-selfhost.md §5.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Boxed warning for a set-but-rejected ONION_HOSTNAME. Same failure mode as
 * PUBLIC_ORIGIN above: resolveAllowedOrigins() silently drops a value that
 * fails isValidOnionHostname(), and app.ts likewise stops emitting the
 * Onion-Location header — so the operator believes the Tor mirror is wired
 * up while neither the CORS allowlist nor Tor Browser's mirror hint ever see
 * it. Names the rejected value and the expected v3 shape (56 base32 chars +
 * .onion). Returns null when ONION_HOSTNAME is unset, empty, or valid.
 *
 * The hostname is PUBLIC (it ships in the Onion-Location header and the page
 * footer), so echoing the rejected value discloses nothing sensitive.
 */
export function buildOnionHostnameRejectedWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const rejected = rejectedOnionHostname(env);
  if (!rejected) return null;

  return [
    "",
    "==============================================================================",
    "  ONION_HOSTNAME SET BUT REJECTED — the Tor mirror will NOT be advertised",
    "------------------------------------------------------------------------------",
    `  Rejected value: ${rejected.value}`,
    "  Expected format: a v3 onion address — 56 base32 characters ([a-z2-7])",
    "  followed by .onion, e.g.",
    "  vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd.onion",
    "  (no scheme, no port, no path — the bare hostname only).",
    "  Until this is fixed the value is ignored: the onion origin is NOT added",
    "  to the CORS allowlist and the Onion-Location header is NOT emitted, so",
    "  Tor Browser users are never told the mirror exists. See",
    "  README-selfhost.md.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Boxed warning for a half-configured Cloudflare TURN pair. readCloudflareCreds()
 * requires BOTH CLOUDFLARE_TURN_TOKEN_ID and CLOUDFLARE_TURN_API_TOKEN; with
 * only one set it returns null and the server silently falls back to the next
 * ICE branch (self-hosted TURN, STUN, or nothing). An operator who typo'd one
 * variable name would never learn why Cloudflare TURN is inactive. Names the
 * variable that is MISSING — never any value (the API token is a secret).
 * Returns null when both or neither are set.
 */
export function buildCloudflareTurnPartialWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const hasTokenId = describePresence(env["CLOUDFLARE_TURN_TOKEN_ID"]);
  const hasApiToken = describePresence(env["CLOUDFLARE_TURN_API_TOKEN"]);
  if (hasTokenId === hasApiToken) return null;

  const missing = hasTokenId
    ? "CLOUDFLARE_TURN_API_TOKEN"
    : "CLOUDFLARE_TURN_TOKEN_ID";
  const present = hasTokenId
    ? "CLOUDFLARE_TURN_TOKEN_ID"
    : "CLOUDFLARE_TURN_API_TOKEN";

  return [
    "",
    "==============================================================================",
    "  CLOUDFLARE TURN HALF-CONFIGURED — it will NOT be used",
    "------------------------------------------------------------------------------",
    `  ${present} is set, but ${missing} is not.`,
    "  Cloudflare TURN requires BOTH variables; with one missing the pair is",
    "  ignored and the server falls back to the next ICE option (self-hosted",
    "  TURN, STUN, or none — see the ICE / TURN row in the summary above).",
    `  To fix: set ${missing}, or unset ${present} if Cloudflare`,
    "  TURN is not intended. See README-selfhost.md §4.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Boxed warning for half-configured ntfy alerting: NTFY_SERVER and/or
 * NTFY_TOKEN set while NTFY_TOPIC is not. publishNtfy() is an intentional
 * silent no-op without a topic, so an operator who set the server URL (or an
 * access token) but forgot the topic believes alerting is on while every
 * operator alert is silently dropped. Never echoes any value — the topic is a
 * secret and the token doubly so; only variable NAMES are reported. Returns
 * null when NTFY_TOPIC is set, or when nothing ntfy-related is set at all.
 */
export function buildNtfyPartialWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (describePresence(env["NTFY_TOPIC"])) return null;
  const present = ["NTFY_SERVER", "NTFY_TOKEN"].filter((name) =>
    describePresence(env[name]),
  );
  if (present.length === 0) return null;

  return [
    "",
    "==============================================================================",
    "  NTFY ALERTING HALF-CONFIGURED — operator alerts will NOT be sent",
    "------------------------------------------------------------------------------",
    `  ${present.join(" and ")} ${present.length > 1 ? "are" : "is"} set, but NTFY_TOPIC is not.`,
    "  Alert publishing is a silent no-op without a topic, so CSP-violation",
    "  waves, Lightning backend shape changes, and repeated payment-service",
    "  slowness will page nobody.",
    `  To fix: set NTFY_TOPIC, or unset ${present.join(" and ")} if alerting`,
    "  is not intended. See README-selfhost.md.",
    "==============================================================================",
    "",
  ].join("\n");
}

/**
 * Boxed warning for a malformed NTFY_SERVER value: set, but not parseable as
 * an http(s) URL (missing scheme, wrong scheme, trailing garbage). publishNtfy()
 * swallows fetch errors by design, so a bad server URL fails silently at alert
 * time — every operator alert is dropped with only a warn-level log line.
 * The server URL is not a secret, so the offending value is echoed to make the
 * fix obvious; the topic and token are never echoed. Returns null when
 * NTFY_SERVER is unset or parses as a valid http(s) URL.
 */
export function buildNtfyServerUrlWarning(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env["NTFY_SERVER"];
  if (!describePresence(raw)) return null;
  const value = (raw as string).trim();

  let parsed: URL | null = null;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (parsed && (parsed.protocol === "http:" || parsed.protocol === "https:")) {
    return null;
  }

  const reason = parsed
    ? `uses the unsupported scheme "${parsed.protocol.replace(/:$/, "")}"`
    : "is not a parseable URL (missing scheme?)";

  return [
    "",
    "==============================================================================",
    "  NTFY_SERVER IS NOT A VALID URL — operator alerts will NOT be sent",
    "------------------------------------------------------------------------------",
    `  NTFY_SERVER is set to "${value}", which ${reason}.`,
    "  Alert publishing swallows transport errors by design, so every operator",
    "  alert (CSP-violation waves, Lightning backend shape changes, repeated",
    "  payment-service slowness) will fail silently at send time.",
    '  To fix: set NTFY_SERVER to a full http(s) URL, e.g. "https://ntfy.sh"',
    "  or your self-hosted server's base URL, or unset it to use the default.",
    "  See README-selfhost.md.",
    "==============================================================================",
    "",
  ].join("\n");
}

function describePaywallSecret(env: NodeJS.ProcessEnv): string {
  return describePresence(env["PAYWALL_SECRET"])
    ? "set (operator-provided)"
    : "unset (ephemeral per-process default)";
}

function describeTurnSecret(env: NodeJS.ProcessEnv): string {
  return describePresence(env["TURN_SECRET"]) ? "set" : "unset";
}

/**
 * Build the boxed, multi-line effective-configuration summary. Pure: takes
 * the environment as an argument (defaulting to `process.env`) and returns
 * the string; index.ts logs it at startup. Boxed like the ICE/TURN and
 * TOR_ONLY banners so it is easy to spot in a busy log.
 */
export function buildEffectiveConfigSummary(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const rows: [string, string][] = [
    ["Mode", describeMode(env)],
    ["Tor-only", describeTorOnly(env)],
    ["ICE / TURN", describeIceTurn(env)],
    ["CORS origins", describeCorsOrigins(env)],
    ["Lightning", lightningConfigSummary()],
    ["Log retention", describeLogRetention({ env })],
    ["PAYWALL_SECRET", describePaywallSecret(env)],
    ["TURN_SECRET", describeTurnSecret(env)],
  ];

  const labelWidth = Math.max(...rows.map(([k]) => k.length)) + 1; // +1 for ":"
  const body = rows.map(
    ([k, v]) => `  ${(k + ":").padEnd(labelWidth)} ${v}`,
  );

  return [
    "",
    "==============================================================================",
    "  VOID — effective runtime configuration",
    "------------------------------------------------------------------------------",
    ...body,
    "  Secrets are reported by presence/posture only; their values are never logged.",
    "  See README-selfhost.md §4f.",
    "==============================================================================",
    "",
  ].join("\n");
}
