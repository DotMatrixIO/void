// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  RENDEZVOUS_EPOCH_MS,
  currentRendezvousEpoch,
  deriveRendezvousHandle,
  rendezvousCreateCode,
  rendezvousJoinCandidates,
} from "./rendezvous";

// A 32-hex durable room id fixture (shape the app produces).
const ROOM_A = "0123456789abcdef0123456789abcdef";
const ROOM_B = "fedcba9876543210fedcba9876543210";
const HEX32 = /^[0-9a-f]{32}$/;

// Pin a wall-clock so epoch math is deterministic. Pick a time well inside
// an epoch so neighbour epochs are unambiguous.
const T = 1_700_000_000_000;

describe("currentRendezvousEpoch", () => {
  it("floor-divides wall-clock into fixed-width epochs", () => {
    expect(currentRendezvousEpoch(0)).toBe(0);
    expect(currentRendezvousEpoch(RENDEZVOUS_EPOCH_MS - 1)).toBe(0);
    expect(currentRendezvousEpoch(RENDEZVOUS_EPOCH_MS)).toBe(1);
    expect(currentRendezvousEpoch(T)).toBe(Math.floor(T / RENDEZVOUS_EPOCH_MS));
  });
});

describe("deriveRendezvousHandle", () => {
  it("returns a 32-hex token (server ROOM_CODE_RE shape)", async () => {
    const h = await deriveRendezvousHandle(ROOM_A, 100);
    expect(h).toMatch(HEX32);
  });

  it("is deterministic for the same (roomId, epoch)", async () => {
    const a = await deriveRendezvousHandle(ROOM_A, 100);
    const b = await deriveRendezvousHandle(ROOM_A, 100);
    expect(a).toBe(b);
  });

  it("differs across epochs (rotation) and across rooms (isolation)", async () => {
    const e100 = await deriveRendezvousHandle(ROOM_A, 100);
    const e101 = await deriveRendezvousHandle(ROOM_A, 101);
    const otherRoom = await deriveRendezvousHandle(ROOM_B, 100);
    expect(e100).not.toBe(e101);
    expect(e100).not.toBe(otherRoom);
  });

  it("does not leak the durable roomId (handle != roomId)", async () => {
    const h = await deriveRendezvousHandle(ROOM_A, 100);
    expect(h).not.toBe(ROOM_A);
  });
});

describe("rendezvousCreateCode", () => {
  it("human rooms register under the current-epoch handle", async () => {
    const code = await rendezvousCreateCode(ROOM_A, T);
    const expected = await deriveRendezvousHandle(
      ROOM_A,
      currentRendezvousEpoch(T),
    );
    expect(code).toBe(expected);
    expect(code).not.toBe(ROOM_A);
  });
});

describe("rendezvousJoinCandidates", () => {
  it("human rooms probe [E, E-1, E+1] in order", async () => {
    const candidates = await rendezvousJoinCandidates(ROOM_A, T);
    const e = currentRendezvousEpoch(T);
    expect(candidates).toEqual([
      await deriveRendezvousHandle(ROOM_A, e),
      await deriveRendezvousHandle(ROOM_A, e - 1),
      await deriveRendezvousHandle(ROOM_A, e + 1),
    ]);
  });

  it("human candidates are all distinct 32-hex tokens", async () => {
    const candidates = await rendezvousJoinCandidates(ROOM_A, T);
    expect(candidates).toHaveLength(3);
    for (const c of candidates) expect(c).toMatch(HEX32);
    expect(new Set(candidates).size).toBe(3);
  });

  it("the create handle is the first join candidate (creator/joiner converge)", async () => {
    const created = await rendezvousCreateCode(ROOM_A, T);
    const candidates = await rendezvousJoinCandidates(ROOM_A, T);
    expect(candidates[0]).toBe(created);
  });
});
