// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Coerce a `Uint8Array` into the `BufferSource` shape that `crypto.subtle`
 * accepts.
 *
 * ## Why this helper exists
 *
 * The current TypeScript DOM lib types `Uint8Array<ArrayBufferLike>`
 * (which includes `SharedArrayBuffer`), but the WebCrypto signatures
 * want `ArrayBufferView<ArrayBuffer>`. Without a cast, every call site
 * that passes a `Uint8Array` into `crypto.subtle.{sign,verify,importKey,
 * encrypt,decrypt,deriveBits}` fails type-checking. Centralizing the
 * cast here means we have one place to audit, one place to add a
 * runtime guard, and one place to delete when the TS lib types are
 * fixed upstream.
 *
 * ## REVISIT ON EVERY TYPESCRIPT MAJOR UPGRADE
 *
 * On each TS major version bump (or each time the project's
 * `lib.dom.d.ts` baseline shifts), check whether this helper is still
 * needed:
 *
 *   1. Delete the body of `asBufferSource`, leaving only
 *      `return u8;`. If `pnpm exec tsc --noEmit` in
 *      `artifacts/void-client` still passes, the underlying lib types
 *      have been fixed and this helper can be removed entirely —
 *      replace every call site with the bare `Uint8Array`.
 *   2. If TS still rejects it, leave the cast in place and bump the
 *      "last verified against TS X.Y" line below.
 *
 * Last verified against: TypeScript 5.x (the version pinned in this
 * workspace's root `package.json` at the time of writing).
 *
 * ## Runtime guard
 *
 * The cast is a static-type lie — at runtime nothing enforces the
 * shape. If a caller ever hands us something that is not a
 * `Uint8Array` (e.g. a plain array, a `Buffer` from a Node-ism that
 * leaks into the browser bundle, or a stale typed-array view), the
 * downstream WebCrypto call would otherwise fail with an opaque
 * `DOMException`. The brand check below makes that failure loud and
 * traceable to the call site instead.
 *
 * Note: `instanceof Uint8Array` is **not** safe here, because jsdom
 * (and any environment with multiple JS realms — iframes, vm
 * contexts, web workers passing structured-cloned typed arrays)
 * exposes more than one `Uint8Array` constructor. A `Uint8Array`
 * created in another realm passes every duck-test for "is a
 * Uint8Array" and works fine with WebCrypto, but fails
 * `instanceof Uint8Array` against the current realm's constructor.
 * `Object.prototype.toString.call(...) === "[object Uint8Array]"` is
 * the canonical cross-realm-safe brand check (it reads the
 * `Symbol.toStringTag` slot, which is set on the prototype and
 * preserved across realms).
 */
export function asBufferSource(u8: Uint8Array): BufferSource {
  if (Object.prototype.toString.call(u8) !== "[object Uint8Array]") {
    const desc =
      u8 === null
        ? "null"
        : typeof u8 === "object"
          ? `${Object.prototype.toString.call(u8)} (constructor: ${
              (u8 as object).constructor?.name ?? "unknown"
            })`
          : typeof u8;
    throw new TypeError(`asBufferSource expected a Uint8Array, got ${desc}`);
  }
  return u8 as unknown as BufferSource;
}
