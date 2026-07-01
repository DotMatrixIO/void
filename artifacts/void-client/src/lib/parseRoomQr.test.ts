// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { parseRoomQr } from "./parseRoomQr";

const VALID = "ability about above absent absorb abstract";
const VALID_DASH = "ability-about-above-absent-absorb-abstract";

describe("parseRoomQr", () => {
  it("extracts the phrase from a full Void URL hash", () => {
    expect(parseRoomQr(`https://void.example.com/#${VALID_DASH}`)).toBe(VALID);
  });

  it("extracts the phrase from a Void URL with a base path", () => {
    expect(parseRoomQr(`https://example.com/some/base/#${VALID_DASH}`)).toBe(
      VALID,
    );
  });

  it("uppercases inside the URL hash are normalized", () => {
    expect(
      parseRoomQr(`https://void.example.com/#ABILITY-ABOUT-ABOVE-ABSENT-ABSORB-ABSTRACT`),
    ).toBe(VALID);
  });

  it("accepts a bare hash fragment", () => {
    expect(parseRoomQr(`#${VALID_DASH}`)).toBe(VALID);
  });

  it("accepts a bare dashed phrase without a leading hash", () => {
    expect(parseRoomQr(VALID_DASH)).toBe(VALID);
  });

  it("accepts a bare space-separated phrase (legacy printed phrase QRs / manual paste)", () => {
    expect(parseRoomQr(VALID)).toBe(VALID);
  });

  it("normalizes uppercase in a bare space-separated phrase", () => {
    expect(parseRoomQr(VALID.toUpperCase())).toBe(VALID);
  });

  it("returns null for a space-separated phrase with the wrong word count", () => {
    expect(parseRoomQr("ability about above")).toBeNull();
  });

  it("returns null for a space-separated phrase with a non-BIP39 word", () => {
    expect(parseRoomQr("ability about above absent absorb zzzzz")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseRoomQr(`  https://x/#${VALID_DASH}  `)).toBe(VALID);
  });

  it("returns null for a URL with no hash", () => {
    expect(parseRoomQr("https://void.example.com/")).toBeNull();
  });

  it("returns null for a URL whose hash is not a valid Void phrase", () => {
    expect(parseRoomQr("https://x/#hello-world")).toBeNull();
    expect(parseRoomQr("https://x/#zzzz-zzzz-zzzz-zzzz-zzzz-zzzz")).toBeNull();
  });

  it("returns null for empty / whitespace input", () => {
    expect(parseRoomQr("")).toBeNull();
    expect(parseRoomQr("   ")).toBeNull();
  });

  it("returns null for a hash fragment with the wrong word count", () => {
    expect(parseRoomQr("#ability-about-above")).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(parseRoomQr("just some random text")).toBeNull();
    expect(parseRoomQr("WIFI:S:foo;T:WPA;P:bar;;")).toBeNull();
  });
});
