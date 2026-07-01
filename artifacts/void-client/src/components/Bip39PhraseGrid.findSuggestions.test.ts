// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { findSuggestions } from "./Bip39PhraseGrid";
import { BIP39_WORDLIST } from "@/lib/voidPhrase";

describe("findSuggestions", () => {
  it("returns an empty list for an empty prefix", () => {
    expect(findSuggestions("")).toEqual([]);
  });

  it("returns an empty list for a prefix that matches no BIP39 word", () => {
    expect(findSuggestions("zzzz")).toEqual([]);
  });

  it("returns matches that all start with the prefix", () => {
    const out = findSuggestions("aban");
    expect(out.length).toBeGreaterThan(0);
    for (const w of out) {
      expect(w.startsWith("aban")).toBe(true);
    }
    expect(out).toContain("abandon");
  });

  it("caps results at the default max of 6", () => {
    const out = findSuggestions("a");
    expect(out.length).toBe(6);
  });

  it("respects a custom max", () => {
    const out = findSuggestions("a", 3);
    expect(out.length).toBe(3);
  });

  it("narrows to a single suggestion for a sufficiently long unique prefix", () => {
    const out = findSuggestions("abil");
    expect(out).toEqual(["ability"]);
  });

  it("returns exactly the word when the prefix is the full word and it has no longer neighbours", () => {
    const out = findSuggestions("ability");
    expect(out).toEqual(["ability"]);
  });

  it("returns results in BIP39 sorted (lexicographic) order", () => {
    const out = findSuggestions("ab");
    const sorted = [...out].sort();
    expect(out).toEqual(sorted);
  });

  it("does not return any word that does not start with the prefix", () => {
    const out = findSuggestions("acc");
    for (const w of out) {
      expect(w.startsWith("acc")).toBe(true);
      expect(BIP39_WORDLIST).toContain(w);
    }
  });
});
