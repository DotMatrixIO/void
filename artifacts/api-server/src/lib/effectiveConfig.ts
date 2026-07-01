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
