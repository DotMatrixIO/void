// SPDX-License-Identifier: AGPL-3.0-or-later
// Startup guard against operators accidentally running the API server with the
// example/placeholder TURN shared secret committed to docs and example configs.
//
// Why this lives in the API server: the API server is what mints ephemeral
// HMAC-SHA1 TURN credentials against the shared secret (see
// `routes/ice-servers.ts`). If that secret is a publicly-known placeholder,
// anyone on the internet can mint valid credentials for the operator's relay
// and use it as free bandwidth — an "open relay" outcome. Coturn itself accepts
// whatever secret it is given; the API server is the right enforcement point
// because it is the one party that derives credentials from the secret.
//
// To add a new placeholder later, add a lowercase string to the array below.

import { markSecret, type Secret } from "@workspace/wire-core";

export const TURN_SECRET_PLACEHOLDERS: readonly string[] = [
  // Currently shipped in `coturn/turnserver.conf.example`.
  "your_secret_here",
  // Variants used in README-selfhost.md prose / example snippets.
  "replace_with_your_turn_secret",
  "replace_with_long_random_turn_secret",
  "replace_with_the_same_secret",
  // Generic placeholders operators paste from tutorials.
  "changeme",
  "change_me",
  "secret",
  "password",
];

// Minimum acceptable length (in characters, post-trim) for a configured
// TURN_SECRET. The API server uses the secret as the HMAC-SHA1 key when minting
// ephemeral TURN credentials in `routes/ice-servers.ts`. A short secret (e.g.
// `TURN_SECRET=x`) is trivially brute-forceable from a single observed
// credential, which would let any attacker mint valid relay credentials and use
// the operator's Coturn as free bandwidth — the same "open relay" outcome the
// placeholder check exists to prevent. 16 characters is a conservative floor:
// well below any reasonable randomly-generated secret (e.g. `openssl rand -hex
// 32` produces 64 chars) but high enough to reject obvious typos and
// single-word secrets.
export const TURN_SECRET_MIN_LENGTH = 16;

export class PlaceholderTurnSecretError extends Error {
  constructor(
    public readonly placeholder: string,
    message?: string,
  ) {
    super(
      message ??
        `TURN secret is set to a known placeholder value (${placeholder}).`,
    );
    this.name = "PlaceholderTurnSecretError";
  }
}

export function isPlaceholderTurnSecret(rawSecret: string): boolean {
  const normalized = rawSecret.trim().toLowerCase();
  if (!normalized) return false;
  return TURN_SECRET_PLACEHOLDERS.includes(normalized);
}

/**
 * Mark a configured TURN_SECRET value with the `Secret` brand. The cast
 * happens at the declaration site of the TURN HMAC key so the brand
 * survives through the credential-minting code in `routes/ice-servers.ts`.
 * The custom ESLint rule `no-secret-equality` follows the brand and
 * flags any equality compare against it.
 */
export function brandTurnSecret(rawSecret: string): Secret<string> {
  return markSecret(rawSecret);
}

export function assertTurnSecretNotPlaceholder(
  rawSecret: string | undefined,
): void {
  // TURN is optional. When unset, `routes/ice-servers.ts` falls back to public
  // STUN servers — no relay is offered, no credentials are minted, no risk of
  // an open relay. Only enforce when an operator has actually configured a
  // secret.
  if (rawSecret === undefined) return;
  const trimmed = rawSecret.trim();
  if (!trimmed) return;
  if (isPlaceholderTurnSecret(trimmed)) {
    throw new PlaceholderTurnSecretError(trimmed);
  }
  if (trimmed.length < TURN_SECRET_MIN_LENGTH) {
    throw new PlaceholderTurnSecretError(
      trimmed,
      `TURN secret is too short (${trimmed.length} characters); ` +
        `must be at least ${TURN_SECRET_MIN_LENGTH} characters to resist ` +
        `brute-force of HMAC-SHA1 TURN credentials.`,
    );
  }
}
