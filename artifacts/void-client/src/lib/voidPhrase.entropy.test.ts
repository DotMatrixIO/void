// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from "vitest";
import { generateVoidPhrase } from "./voidPhrase";

// Minimum entropy budget for a 6-word BIP39 phrase: 6 * 11 bits = 66 bits ≈ 11 bytes.
// The current implementation requests Uint32Array(6) = 24 bytes per call. Pinning the
// expected per-call byte count to 24 means a refactor that silently shrinks the request
// (e.g. to Uint8Array(6) = 6 bytes, which would fall below the 11-byte floor) fails CI
// rather than quietly collapsing the entropy floor.
const EXPECTED_BYTES_PER_CALL = 24;
const MIN_ENTROPY_BYTES_PER_CALL = 11;
const GENERATION_RUNS = 4;

describe("generateVoidPhrase entropy source", () => {
  it("uses crypto.getRandomValues only — never Math.random — and requests at least the 6-word entropy budget", () => {
    const realGetRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    const requestedByteCounts: number[] = [];

    const mathRandomSpy = vi.spyOn(Math, "random");
    const getRandomValuesSpy = vi
      .spyOn(globalThis.crypto, "getRandomValues")
      .mockImplementation(<T extends ArrayBufferView | null>(arr: T): T => {
        if (arr && typeof (arr as ArrayBufferView).byteLength === "number") {
          requestedByteCounts.push((arr as ArrayBufferView).byteLength);
        }
        return realGetRandomValues(arr as unknown as ArrayBufferView) as unknown as T;
      });

    try {
      for (let i = 0; i < GENERATION_RUNS; i++) {
        const phrase = generateVoidPhrase();
        expect(phrase.split(" ")).toHaveLength(6);
      }

      expect(mathRandomSpy).toHaveBeenCalledTimes(0);
      expect(getRandomValuesSpy.mock.calls.length).toBeGreaterThanOrEqual(GENERATION_RUNS);

      // Hard floor: every single call must clear the 66-bit minimum.
      for (const bytes of requestedByteCounts) {
        expect(bytes).toBeGreaterThanOrEqual(MIN_ENTROPY_BYTES_PER_CALL);
      }
      // Pinned current invariant: catches accidental shrink to e.g. Uint8Array(6).
      const totalBytes = requestedByteCounts.reduce((sum, n) => sum + n, 0);
      expect(totalBytes).toBeGreaterThanOrEqual(EXPECTED_BYTES_PER_CALL * GENERATION_RUNS);
    } finally {
      mathRandomSpy.mockRestore();
      getRandomValuesSpy.mockRestore();
    }
  });
});
