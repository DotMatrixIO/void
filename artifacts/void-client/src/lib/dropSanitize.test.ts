// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { sanitizeDrop, DROP_MAX_BYTES } from "./dropSanitize";

describe("sanitizeDrop", () => {
  it("returns empty unchanged", () => {
    expect(sanitizeDrop("")).toEqual({ text: "", mutated: false });
  });

  it("passes a plain ASCII string through untouched", () => {
    const r = sanitizeDrop("https://example.com/path?a=1");
    expect(r.text).toBe("https://example.com/path?a=1");
    expect(r.mutated).toBe(false);
  });

  it("normalizes CRLF to LF", () => {
    const r = sanitizeDrop("a\r\nb\rc");
    expect(r.text).toBe("a\nb\nc");
    expect(r.mutated).toBe(true);
  });

  it("preserves TAB and LF but strips other control bytes", () => {
    const r = sanitizeDrop("a\tb\nc\u0007d\u001Fe\u007Ff");
    expect(r.text).toBe("a\tb\ncdef");
    expect(r.mutated).toBe(true);
  });

  it("strips zero-width and word-joiner code points", () => {
    const r = sanitizeDrop("ab\u200Bcd\u200Cef\u200Dgh\u2060ij\uFEFFkl");
    expect(r.text).toBe("abcdefghijkl");
    expect(r.mutated).toBe(true);
  });

  it("strips RTL-override / bidi-isolate code points (Trojan Source class)", () => {
    const r = sanitizeDrop("hello\u202Eworld\u2066and\u2069friends");
    expect(r.text).toBe("helloworldandfriends");
    expect(r.mutated).toBe(true);
  });

  it("NFC-normalizes decomposed sequences", () => {
    // 'é' as 'e' + U+0301 combining acute
    const decomposed = "cafe\u0301";
    const r = sanitizeDrop(decomposed);
    expect(r.text).toBe("café");
    expect(r.mutated).toBe(true);
    // Re-running on already-NFC input is a no-op.
    const r2 = sanitizeDrop("café");
    expect(r2.text).toBe("café");
    expect(r2.mutated).toBe(false);
  });

  it("caps at 2048 UTF-8 bytes and never splits a code point", () => {
    // 4-byte emoji repeated. 600 of them = 2400 bytes > 2048.
    const big = "😀".repeat(600);
    const r = sanitizeDrop(big);
    expect(r.mutated).toBe(true);
    const bytes = new TextEncoder().encode(r.text).length;
    expect(bytes).toBeLessThanOrEqual(DROP_MAX_BYTES);
    // No half-surrogates: re-encoding the output must give the same bytes
    // and decoding must round-trip.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(new TextEncoder().encode(r.text))).toBe(r.text);
    // Should be exactly floor(2048 / 4) = 512 emoji.
    expect([...r.text].length).toBe(512);
  });

  it("accepts a string at exactly the byte budget", () => {
    const s = "a".repeat(DROP_MAX_BYTES);
    const r = sanitizeDrop(s);
    expect(r.text).toBe(s);
    expect(r.mutated).toBe(false);
  });

  it("treats non-string input as empty + mutated", () => {
    // @ts-expect-error — intentional defensive call
    const r = sanitizeDrop(null);
    expect(r).toEqual({ text: "", mutated: true });
  });
});
