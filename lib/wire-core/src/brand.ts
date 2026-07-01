// SPDX-License-Identifier: AGPL-3.0-or-later
// Nominal brand types for compile-time tagging of values that look like
// ordinary `string` / `Buffer` / `Uint8Array` to TypeScript but carry
// security-critical meaning (HMAC keys, JWT signing keys, signed-hello
// signature inputs, recovery codes, room-token bytes,
// invite-key fingerprints).
//
// The brand exists for two reasons:
//
//   1. **Compile-time discipline.** A function that accepts `Secret<string>`
//      cannot silently receive an unrelated string from a public field.
//      Threading the brand through call signatures forces every secret
//      handoff to be annotated at the type level, which makes a code
//      reviewer (and the eslint plugin in `tools/eslint-plugin-secrets/`)
//      able to spot regressions trivially.
//
//   2. **A static lint anchor.** The custom ESLint rule
//      `@workspace/eslint-plugin-secrets/no-secret-equality` queries the
//      TypeScript program type information for the `__brand: "Secret"`
//      tag and flags `===`, `==`, and `Buffer.equals(...)` against any
//      branded value, regardless of how the secret flowed through the
//      program (function parameters, destructuring, utility wrappers).
//      The rule replaces the narrower grep guard from #257 (which only
//      caught equality against values imported from a conventional
//      `lib/secrets/` path).
//
// The pattern is the standard nominal-branding trick:
//
//   type Brand<K extends string> = { readonly __brand: K };
//
// `__brand` is a phantom property that exists in the TS type system only;
// no runtime field is added. `as Secret<string>` (or `markSecret(...)`)
// is the explicit cast point — keep those narrow and at the declaration
// site of the secret, not deep inside helpers.

export type Brand<K extends string> = { readonly __brand: K };

/**
 * Mark a value as a `Secret<T>`. Use this *at the declaration site* of
 * a secret value (env-var read, randomBytes call, JWT sign output,
 * recovery code mint, etc.). Downstream code
 * that handles the value should accept the `Secret<T>` type so the
 * brand survives through call chains.
 *
 * The runtime is a no-op; the brand exists in the type system only.
 */
export type Secret<T = string> = T & Brand<"Secret">;

export function markSecret<T>(value: T): Secret<T> {
  return value as Secret<T>;
}

/**
 * Strip the brand and return the raw value. Use sparingly — every call
 * is a place where the static no-secret-equality lint can no longer
 * follow the value. Acceptable use: passing the secret into a
 * third-party signature that types its input as a plain `string` or
 * `Buffer` (e.g. `jwt.sign`, `crypto.createHmac`, `crypto.timingSafeEqual`).
 */
export function unwrapSecret<T>(value: Secret<T>): T {
  return value as T;
}
