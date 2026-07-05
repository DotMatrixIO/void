// SPDX-License-Identifier: AGPL-3.0-or-later
// Local copy of the `Secret<T>` brand shape from
// `@workspace/wire-core`, kept here so the rule-tester
// fixtures don't need to resolve the workspace package off disk.
// The rule keys on the structural `__brand: "Secret"` tag, so any
// type-equivalent definition exercises the same code path.

export type Brand<K extends string> = { readonly __brand: K };
export type Secret<T = string> = T & Brand<"Secret">;
export function markSecret<T>(value: T): Secret<T> {
  return value as Secret<T>;
}
