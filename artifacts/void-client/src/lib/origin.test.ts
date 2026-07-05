// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, afterEach } from "vitest";
import { hostnameIsOnion, isOnionOrigin } from "./origin";

// A canonical Tor v3 onion host: exactly 56 base32 [a-z2-7] characters
// before `.onion`. `hostnameIsOnion` only accepts this shape (see
// src/lib/onionHost.ts — the single source of truth shared with the
// build-time onion-bake guard).
const V3 = "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";
const V3_LABEL = V3.replace(/\.onion$/, "");

describe("hostnameIsOnion", () => {
  it("returns true for a valid v3 onion hostname", () => {
    expect(V3_LABEL).toHaveLength(56);
    expect(hostnameIsOnion(V3)).toBe(true);
  });

  it("returns true for a subdomain in front of a valid v3 label", () => {
    expect(hostnameIsOnion(`www.${V3}`)).toBe(true);
    expect(hostnameIsOnion(`a.b.c.${V3}`)).toBe(true);
  });

  it("is case-insensitive across the whole host", () => {
    expect(hostnameIsOnion(V3.toUpperCase())).toBe(true);
    expect(hostnameIsOnion(`${V3_LABEL.toUpperCase()}.OnIoN`)).toBe(true);
  });

  it("tolerates a trailing FQDN dot", () => {
    expect(hostnameIsOnion(`${V3}.`)).toBe(true);
  });

  it("rejects a bare `.onion` whose label is not v3-length", () => {
    // The old check accepted any label before `.onion`; v3 requires exactly
    // 56 base32 characters, so these must now be false.
    expect(hostnameIsOnion("foo.onion")).toBe(false);
    expect(hostnameIsOnion("abcdefghijklmnop.onion")).toBe(false); // 16 (v2-ish)
    expect(hostnameIsOnion("example.onion")).toBe(false);
  });

  it("rejects a 55- or 57-character base32 label (off-by-one)", () => {
    expect(hostnameIsOnion(`${V3_LABEL.slice(1)}.onion`)).toBe(false); // 55
    expect(hostnameIsOnion(`${V3_LABEL}a.onion`)).toBe(false); // 57
  });

  it("rejects a 56-character label with non-base32 characters", () => {
    // 0, 1, 8, 9 are not in the base32 alphabet [a-z2-7].
    const bad = "a".repeat(52) + "0189";
    expect(bad).toHaveLength(56);
    expect(hostnameIsOnion(`${bad}.onion`)).toBe(false);
  });

  it("returns false when a short label sits in front of a non-v3 label", () => {
    expect(hostnameIsOnion("subdomain.example.onion")).toBe(false);
    expect(hostnameIsOnion("a.b.c.example.onion")).toBe(false);
  });

  it("returns false for localhost and IP literals", () => {
    expect(hostnameIsOnion("localhost")).toBe(false);
    expect(hostnameIsOnion("127.0.0.1")).toBe(false);
    expect(hostnameIsOnion("0.0.0.0")).toBe(false);
    expect(hostnameIsOnion("::1")).toBe(false);
    expect(hostnameIsOnion("192.168.1.1")).toBe(false);
  });

  it("returns false for clearnet hostnames", () => {
    expect(hostnameIsOnion("void.example.com")).toBe(false);
    expect(hostnameIsOnion("example.org")).toBe(false);
  });

  it("returns false when .onion is only a substring, not the final label", () => {
    expect(hostnameIsOnion(`onion.example.com`)).toBe(false);
    expect(hostnameIsOnion(`${V3_LABEL}.oniona`)).toBe(false);
    expect(hostnameIsOnion("notreallyonion")).toBe(false);
    expect(hostnameIsOnion(`${V3}.com`)).toBe(false);
  });

  it("returns false for empty / null / undefined input", () => {
    expect(hostnameIsOnion("")).toBe(false);
    expect(hostnameIsOnion(null)).toBe(false);
    expect(hostnameIsOnion(undefined)).toBe(false);
    expect(hostnameIsOnion(".")).toBe(false);
  });
});

describe("isOnionOrigin", () => {
  const original = window.location.hostname;
  function setHostname(host: string) {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, hostname: host },
    });
  }
  afterEach(() => {
    setHostname(original);
  });

  it("reads window.location.hostname", () => {
    setHostname(V3);
    expect(isOnionOrigin()).toBe(true);
    setHostname("example.com");
    expect(isOnionOrigin()).toBe(false);
  });

  it("returns false for a non-v3 `.onion` hostname", () => {
    setHostname("abc.onion");
    expect(isOnionOrigin()).toBe(false);
  });

  it("ignores .onion appearing only in a clearnet hostname", () => {
    setHostname("notonion.example.com");
    expect(isOnionOrigin()).toBe(false);
  });
});
