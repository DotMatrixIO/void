// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  persistHostToken,
  loadHostToken,
  clearHostToken,
  __testing,
} from "./hostTokenStorage";

const PHRASE_A = "ability about above absent absorb abstract";
const PHRASE_B = "abandon ability able about above absent";
const TOKEN_A = "header.payload-aaaaaaaa.signature";
const TOKEN_B = "header.payload-bbbbbbbb.signature";

function clearAllVoidEntries() {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(__testing.STORAGE_PREFIX)) toRemove.push(key);
  }
  for (const k of toRemove) localStorage.removeItem(k);
}

describe("hostTokenStorage", () => {
  beforeEach(() => {
    clearAllVoidEntries();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips the JWT for the same phrase", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    const loaded = await loadHostToken(PHRASE_A);
    expect(loaded).toBe(TOKEN_A);
  });

  it("survives a 'process restart' (storage is the only state)", async () => {
    // The module holds no mutable state; everything that matters lives in
    // localStorage. Re-import simulates a fresh page load — if the module
    // ever introduced an in-memory cache, this test would catch it.
    await persistHostToken(PHRASE_A, TOKEN_A);
    vi.resetModules();
    const fresh = await import("./hostTokenStorage");
    const loaded = await fresh.loadHostToken(PHRASE_A);
    expect(loaded).toBe(TOKEN_A);
  });

  it("returns undefined when no entry exists for this phrase", async () => {
    const loaded = await loadHostToken(PHRASE_A);
    expect(loaded).toBeUndefined();
  });

  it("normalizes whitespace and casing on the phrase", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    const messy = "  Ability  ABOUT\tabove\nabsent  absorb abstract  ";
    const loaded = await loadHostToken(messy);
    expect(loaded).toBe(TOKEN_A);
  });

  it("isolates entries by phrase — phrase B cannot read phrase A's slot", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    await persistHostToken(PHRASE_B, TOKEN_B);
    expect(await loadHostToken(PHRASE_A)).toBe(TOKEN_A);
    expect(await loadHostToken(PHRASE_B)).toBe(TOKEN_B);
  });

  it("stores under different localStorage keys for different phrases", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    await persistHostToken(PHRASE_B, TOKEN_B);
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(__testing.STORAGE_PREFIX)) keys.push(k);
    }
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("never writes the JWT in plaintext to localStorage", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    const allValues: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k);
      if (v) allValues.push(v);
    }
    expect(allValues.length).toBeGreaterThan(0);
    for (const v of allValues) {
      expect(v).not.toContain(TOKEN_A);
      expect(v).not.toContain("payload-aaaaaaaa");
    }
  });

  it("never writes the phrase in plaintext to localStorage", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    const allKeysAndValues: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      allKeysAndValues.push(k);
      const v = localStorage.getItem(k);
      if (v) allKeysAndValues.push(v);
    }
    const haystack = allKeysAndValues.join("|");
    for (const word of PHRASE_A.split(" ")) {
      expect(haystack).not.toContain(word);
    }
  });

  it("storage slot name does not directly reveal the room phrase", async () => {
    // The slot is HKDF-derived from the phrase. An attacker without the
    // phrase cannot guess the slot, and the slot does not equal the
    // public roomId (which is also phrase-derived but via argon2id —
    // different derivation, different bytes).
    await persistHostToken(PHRASE_A, TOKEN_A);
    let foundKey: string | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(__testing.STORAGE_PREFIX)) {
        foundKey = k;
        break;
      }
    }
    expect(foundKey).not.toBeNull();
    // Tag is 16 bytes hex = 32 chars, after the prefix.
    const tag = foundKey!.slice(__testing.STORAGE_PREFIX.length);
    expect(tag).toMatch(/^[0-9a-f]{32}$/);
  });

  it("clearHostToken removes the entry for that phrase only", async () => {
    await persistHostToken(PHRASE_A, TOKEN_A);
    await persistHostToken(PHRASE_B, TOKEN_B);
    await clearHostToken(PHRASE_A);
    expect(await loadHostToken(PHRASE_A)).toBeUndefined();
    expect(await loadHostToken(PHRASE_B)).toBe(TOKEN_B);
  });

  it("opportunistically GCs entries older than MAX_AGE_MS on persist", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);

    await persistHostToken(PHRASE_A, TOKEN_A);
    expect(await loadHostToken(PHRASE_A)).toBe(TOKEN_A);

    // Jump past the max age.
    vi.setSystemTime(start + __testing.MAX_AGE_MS + 1);

    // Persisting under a different phrase triggers GC, which must wipe
    // the now-stale phrase-A entry.
    await persistHostToken(PHRASE_B, TOKEN_B);
    expect(await loadHostToken(PHRASE_A)).toBeUndefined();
    expect(await loadHostToken(PHRASE_B)).toBe(TOKEN_B);
  });

  it("loadHostToken returns undefined and prunes a stale entry", async () => {
    const start = 1_700_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(start);

    await persistHostToken(PHRASE_A, TOKEN_A);
    vi.setSystemTime(start + __testing.MAX_AGE_MS + 1);
    expect(await loadHostToken(PHRASE_A)).toBeUndefined();

    // After load-time GC the slot should be gone — confirm by counting.
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(__testing.STORAGE_PREFIX)) count++;
    }
    expect(count).toBe(0);
  });

  it("ignores empty phrase / empty token without throwing", async () => {
    await expect(persistHostToken("", TOKEN_A)).resolves.toBeUndefined();
    await expect(persistHostToken(PHRASE_A, "")).resolves.toBeUndefined();
    await expect(loadHostToken("")).resolves.toBeUndefined();
    await expect(clearHostToken("")).resolves.toBeUndefined();
    // None of those should have written anything.
    let count = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(__testing.STORAGE_PREFIX)) count++;
    }
    expect(count).toBe(0);
  });

  it("swallows localStorage failures (quota exceeded) without throwing", async () => {
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
    try {
      await expect(persistHostToken(PHRASE_A, TOKEN_A)).resolves.toBeUndefined();
    } finally {
      Storage.prototype.setItem = origSet;
    }
  });

  it("returns undefined and does not delete on transient decrypt failure", async () => {
    // Corrupt the ciphertext while preserving a valid timestamp prefix and
    // base64 shape. Decrypt will fail; we must NOT remove the entry on
    // this branch (per the comment in loadHostToken — could be a benign
    // race with another tab rewriting the slot).
    await persistHostToken(PHRASE_A, TOKEN_A);
    let storageKey: string | null = null;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(__testing.STORAGE_PREFIX)) {
        storageKey = k;
        break;
      }
    }
    expect(storageKey).not.toBeNull();
    const orig = localStorage.getItem(storageKey!)!;
    const dot = orig.indexOf(".");
    const ts = orig.slice(0, dot);
    // Replace the ciphertext blob with same-length nonsense (still valid
    // base64url, but not what we encrypted).
    const corruptBlob = "A".repeat(orig.length - dot - 1);
    localStorage.setItem(storageKey!, `${ts}.${corruptBlob}`);

    expect(await loadHostToken(PHRASE_A)).toBeUndefined();
    expect(localStorage.getItem(storageKey!)).not.toBeNull();
  });

  it("prunes malformed entries (no timestamp prefix) on next persist", async () => {
    // Externally seed a junk entry under our prefix. GC must catch it.
    const junkKey = `${__testing.STORAGE_PREFIX}deadbeef`;
    localStorage.setItem(junkKey, "not-a-valid-shape");
    await persistHostToken(PHRASE_A, TOKEN_A);
    expect(localStorage.getItem(junkKey)).toBeNull();
  });
});
