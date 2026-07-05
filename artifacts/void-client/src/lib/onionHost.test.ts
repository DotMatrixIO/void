// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  ONION_V3_LABEL_RE,
  isOnionV3Hostname,
  extractOnionHost,
  onionBakeProblem,
  assertOnionBake,
} from "./onionHost";

// A canonical Tor v3 onion host: exactly 56 base32 [a-z2-7] characters.
const V3_LABEL = "voidexampleabcd234567abcd234567abcd234567abcd234567abcde";
const V3 = `${V3_LABEL}.onion`;

describe("ONION_V3_LABEL_RE", () => {
  it("matches exactly 56 base32 chars and nothing else", () => {
    expect(V3_LABEL).toHaveLength(56);
    expect(ONION_V3_LABEL_RE.test(V3_LABEL)).toBe(true);
    expect(ONION_V3_LABEL_RE.test(V3_LABEL.slice(1))).toBe(false); // 55
    expect(ONION_V3_LABEL_RE.test(`${V3_LABEL}a`)).toBe(false); // 57
    expect(ONION_V3_LABEL_RE.test("a".repeat(52) + "0189")).toBe(false); // non-base32
    expect(ONION_V3_LABEL_RE.test(V3_LABEL.toUpperCase())).toBe(false); // regex is lowercase-only
  });
});

describe("isOnionV3Hostname", () => {
  it("accepts a valid v3 host (and subdomains in front of it)", () => {
    expect(isOnionV3Hostname(V3)).toBe(true);
    expect(isOnionV3Hostname(`www.${V3}`)).toBe(true);
    expect(isOnionV3Hostname(V3.toUpperCase())).toBe(true);
    expect(isOnionV3Hostname(`${V3}.`)).toBe(true);
  });

  it("rejects non-v3 onion shapes, clearnet, and empty input", () => {
    expect(isOnionV3Hostname("foo.onion")).toBe(false);
    expect(isOnionV3Hostname(`${V3_LABEL.slice(1)}.onion`)).toBe(false); // 55
    expect(isOnionV3Hostname(`${V3_LABEL}a.onion`)).toBe(false); // 57
    expect(isOnionV3Hostname("example.com")).toBe(false);
    expect(isOnionV3Hostname("")).toBe(false);
    expect(isOnionV3Hostname(null)).toBe(false);
    expect(isOnionV3Hostname(undefined)).toBe(false);
  });
});

describe("extractOnionHost", () => {
  it("strips scheme / path / trailing slash and validates the host", () => {
    expect(extractOnionHost(V3)).toBe(V3);
    expect(extractOnionHost(`http://${V3}/`)).toBe(V3);
    expect(extractOnionHost(`https://${V3}`)).toBe(V3);
    expect(extractOnionHost(`  ${V3}  `)).toBe(V3);
    // Validation is case-insensitive; the returned host preserves input case.
    expect(extractOnionHost(V3.toUpperCase())).toBe(V3.toUpperCase());
  });

  it("returns null for unset or invalid values", () => {
    expect(extractOnionHost(undefined)).toBeNull();
    expect(extractOnionHost("")).toBeNull();
    expect(extractOnionHost("   ")).toBeNull();
    expect(extractOnionHost("http://example.com/")).toBeNull();
    expect(extractOnionHost("foo.onion")).toBeNull();
  });
});

describe("onionBakeProblem", () => {
  it("returns null for a valid baked-in onion host (pass path)", () => {
    expect(onionBakeProblem(V3)).toBeNull();
    expect(onionBakeProblem(`http://${V3}/`)).toBeNull();
  });

  it("distinguishes unset from malformed (fail paths)", () => {
    expect(onionBakeProblem(undefined)).toMatch(/unset or empty/);
    expect(onionBakeProblem("")).toMatch(/unset or empty/);
    expect(onionBakeProblem("   ")).toMatch(/unset or empty/);
    expect(onionBakeProblem("foo.onion")).toMatch(/not a syntactically valid/);
    expect(onionBakeProblem("example.com")).toMatch(/not a syntactically valid/);
  });
});

describe("assertOnionBake", () => {
  it("does not throw for a valid v3 onion host", () => {
    expect(() => assertOnionBake(V3)).not.toThrow();
    expect(() => assertOnionBake(`http://${V3}/`)).not.toThrow();
  });

  it("throws a loud [onion-bake] error when unset", () => {
    expect(() => assertOnionBake(undefined)).toThrow(/\[onion-bake\]/);
    expect(() => assertOnionBake("")).toThrow(/unset or empty/);
  });

  it("throws a loud [onion-bake] error when malformed", () => {
    expect(() => assertOnionBake("foo.onion")).toThrow(/\[onion-bake\]/);
    expect(() => assertOnionBake("foo.onion")).toThrow(
      /not a syntactically valid/,
    );
  });
});
