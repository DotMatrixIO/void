// SPDX-License-Identifier: AGPL-3.0-or-later
// Startup guard against operators accidentally running the API server with the
// example/placeholder PAYWALL_SECRET committed to docs and example .env
// snippets.
//
// Why this lives in the API server: PAYWALL_SECRET is the HMAC key used to
// sign and verify the host-authorization JWTs minted by `routes/paywall.ts`
// and consumed by `socketHandlers.ts` at create-room. If that key is one of
// the publicly-known placeholders an operator pastes from README-selfhost.md
// or a tutorial, anyone on the internet can mint paid-room JWTs against the
// operator's server and create rooms for free. The API server is the right
// enforcement point because it is the one process that signs and verifies
// these tokens.
//
// Note on policy: the "unset" case is NOT rejected by the placeholder guard.
// When PAYWALL_SECRET is unset, `routes/paywall.ts` generates an ephemeral
// 32-byte secret per process — a strong value whose failure mode is "JWTs
// and recovery codes are invalidated on restart". That is acceptable for
// dev/preview, but in production it silently strands every paying host on
// each container restart (observed on the burndown.video VPS, Task #1143).
// So production posture is enforced separately by
// `assertPaywallSecretConfiguredInProduction` below: when NODE_ENV is
// "production" and PAYWALL_SECRET is unset/blank, the server refuses to
// start unless the operator explicitly opts into the ephemeral behavior via
// PAYWALL_ALLOW_EPHEMERAL_SECRET=1 — mirroring the TURN placeholder-refusal
// pattern (fail closed, loudly, before any port is bound).
//
// To add a new placeholder later, add a lowercase string to the array below.

import { markSecret, type Secret } from "@workspace/wire-core";

export const PAYWALL_SECRET_PLACEHOLDERS: readonly string[] = [
  // Variants used in README-selfhost.md prose / example .env snippets.
  "replace_with_long_random_secret",
  "replace_with_long_random_paywall_secret",
  "your_strong_secret",
  // Generic placeholders operators paste from tutorials.
  "your_secret_here",
  "replace_me",
  "changeme",
  "change_me",
  "secret",
  "password",
];

export class PlaceholderPaywallSecretError extends Error {
  constructor(public readonly placeholder: string) {
    super(
      `PAYWALL_SECRET is set to a known placeholder value (${placeholder}).`,
    );
    this.name = "PlaceholderPaywallSecretError";
  }
}

export function isPlaceholderPaywallSecret(rawSecret: string): boolean {
  const normalized = rawSecret.trim().toLowerCase();
  if (!normalized) return false;
  return PAYWALL_SECRET_PLACEHOLDERS.includes(normalized);
}

/**
 * Mark a configured PAYWALL_SECRET value with the `Secret` brand. The cast
 * happens here, at the declaration site of the paywall HMAC key, so the
 * brand survives end-to-end through `paywall.ts` (mint), `socketHandlers.ts`
 * (verify), and any `createPaywallRouter({ secret })` test wiring. The
 * custom ESLint rule `no-secret-equality` follows the brand and flags
 * `===` / `==` / `Buffer.equals` against any value statically inferred
 * to carry it.
 */
export function brandPaywallSecret(rawSecret: string): Secret<string> {
  return markSecret(rawSecret);
}

export class MissingPaywallSecretError extends Error {
  constructor() {
    super(
      "PAYWALL_SECRET is not set and NODE_ENV is production. Set a stable " +
        "secret (openssl rand -hex 32) or explicitly opt into ephemeral " +
        "per-process secrets with PAYWALL_ALLOW_EPHEMERAL_SECRET=1.",
    );
    this.name = "MissingPaywallSecretError";
  }
}

/**
 * Production-posture guard (Task #1143): refuse to start in production
 * without a configured PAYWALL_SECRET, unless the operator explicitly sets
 * PAYWALL_ALLOW_EPHEMERAL_SECRET=1. An unset secret means every restart
 * invalidates all outstanding host JWTs AND all 4-word recovery codes — a
 * paying host silently loses their room on any container restart. That is a
 * legitimate choice for a single-instance dev/demo box, so it stays
 * available behind the explicit opt-out; it must never be the accidental
 * default in production.
 */
export function assertPaywallSecretConfiguredInProduction(
  rawSecret: string | undefined,
  nodeEnv: string | undefined,
  allowEphemeral: string | undefined,
): void {
  if (nodeEnv !== "production") return;
  if (rawSecret !== undefined && rawSecret.trim() !== "") return;
  if (allowEphemeral === "1") return;
  throw new MissingPaywallSecretError();
}

export function assertPaywallSecretNotPlaceholder(
  rawSecret: string | undefined,
): void {
  // PAYWALL_SECRET is optional at startup. When unset, `routes/paywall.ts`
  // synthesizes a strong ephemeral secret per process (see block comment at
  // top of this file for why we don't reject that case here). Only enforce
  // when an operator has actually configured a value.
  if (rawSecret === undefined) return;
  const trimmed = rawSecret.trim();
  if (!trimmed) return;
  if (isPlaceholderPaywallSecret(trimmed)) {
    throw new PlaceholderPaywallSecretError(trimmed);
  }
}
