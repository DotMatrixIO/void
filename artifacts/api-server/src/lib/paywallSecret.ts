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
// Note on policy: the "unset" case is intentionally NOT rejected here. When
// PAYWALL_SECRET is unset, `routes/paywall.ts` generates an ephemeral
// 32-byte secret per process — documented as the single-instance dev/default
// behavior (see README-selfhost.md and replit.md). That ephemeral value is
// strong; the failure mode it has is "JWTs are invalidated on restart",
// which is a UX problem, not a security weakness. The placeholder problem
// is categorically different — a guessable HMAC key — and so is enforced
// independently of the unset-vs-set question.
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
