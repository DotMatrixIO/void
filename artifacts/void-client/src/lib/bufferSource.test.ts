// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { asBufferSource } from "./bufferSource";

describe("asBufferSource", () => {
  it("returns the same reference for a Uint8Array", () => {
    const u8 = new Uint8Array([1, 2, 3, 4]);
    expect(asBufferSource(u8)).toBe(u8);
  });

  it("accepts an empty Uint8Array", () => {
    const u8 = new Uint8Array(0);
    expect(asBufferSource(u8)).toBe(u8);
  });

  it("accepts a Uint8Array constructed in another JS realm (cross-realm safety)", () => {
    // Simulate a value that would fail `instanceof Uint8Array` against this
    // realm's constructor but is structurally a Uint8Array — exactly what
    // jsdom hands us when test fixtures cross realms. We fake the realm
    // boundary by overriding the prototype chain so `instanceof` fails
    // while the Symbol.toStringTag brand stays intact.
    const u8 = new Uint8Array([5, 6, 7]);
    const fakeForeignProto = Object.create(Object.prototype, {
      [Symbol.toStringTag]: { value: "Uint8Array", configurable: true },
    });
    Object.setPrototypeOf(u8, fakeForeignProto);
    expect(u8 instanceof Uint8Array).toBe(false);
    expect(asBufferSource(u8 as unknown as Uint8Array)).toBe(u8);
  });

  it("throws TypeError for null", () => {
    expect(() => asBufferSource(null as unknown as Uint8Array)).toThrow(
      /asBufferSource expected a Uint8Array, got null/,
    );
  });

  it("throws TypeError for a plain array", () => {
    expect(() => asBufferSource([1, 2, 3] as unknown as Uint8Array)).toThrow(
      TypeError,
    );
  });

  it("throws TypeError for an ArrayBuffer (not a view)", () => {
    expect(() =>
      asBufferSource(new ArrayBuffer(8) as unknown as Uint8Array),
    ).toThrow(/asBufferSource expected a Uint8Array/);
  });

  it("throws TypeError for a different typed array (Int8Array)", () => {
    expect(() =>
      asBufferSource(new Int8Array(4) as unknown as Uint8Array),
    ).toThrow(/asBufferSource expected a Uint8Array/);
  });

  it("throws TypeError for a string", () => {
    expect(() => asBufferSource("hello" as unknown as Uint8Array)).toThrow(
      TypeError,
    );
  });
});
