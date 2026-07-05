// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadLastSeenGrantNonce,
  saveLastSeenGrantNonce,
  clearLastSeenGrantNonce,
  __testing,
} from "./lastSeenGrantNonceStorage";

const ROOM_A = "ROOMAAAA";
const ROOM_B = "ROOMBBBB";
const PEER_A = "peer-aaaaaa";
const PEER_B = "peer-bbbbbb";
const NONCE_1 = "00112233445566778899aabbccddeeff";
const NONCE_2 = "ffeeddccbbaa99887766554433221100";

function clearAllEntries() {
  const toRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(__testing.STORAGE_PREFIX)) toRemove.push(key);
  }
  for (const k of toRemove) sessionStorage.removeItem(k);
}

describe("lastSeenGrantNonceStorage", () => {
  beforeEach(() => {
    clearAllEntries();
  });

  it("round-trips a nonce for the same room+peer", () => {
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_1);
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBe(NONCE_1);
  });

  it("returns null when no nonce has been stored for that slot", () => {
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBeNull();
  });

  it("scopes nonces per (roomCode, peerId): different room or peer is a different slot", () => {
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_1);
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_B)).toBeNull();
    expect(loadLastSeenGrantNonce(ROOM_B, PEER_A)).toBeNull();
  });

  it("overwrites the slot when a fresh grant is stored", () => {
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_1);
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_2);
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBe(NONCE_2);
  });

  it("clearLastSeenGrantNonce removes the stored slot", () => {
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_1);
    clearLastSeenGrantNonce(ROOM_A, PEER_A);
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBeNull();
  });

  it("save/load are no-ops for empty room or peer or nonce", () => {
    saveLastSeenGrantNonce("", PEER_A, NONCE_1);
    saveLastSeenGrantNonce(ROOM_A, "", NONCE_1);
    saveLastSeenGrantNonce(ROOM_A, PEER_A, "");
    expect(loadLastSeenGrantNonce("", PEER_A)).toBeNull();
    expect(loadLastSeenGrantNonce(ROOM_A, "")).toBeNull();
    expect(loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBeNull();
  });

  it("survives a 'page reload' (storage is the only state)", async () => {
    // The module holds no in-memory state; everything that matters lives
    // in sessionStorage. Re-importing simulates the fresh module load that
    // happens on a full page reload — if the module ever introduced an
    // in-memory cache, this test would catch it.
    saveLastSeenGrantNonce(ROOM_A, PEER_A, NONCE_1);
    vi.resetModules();
    const fresh = await import("./lastSeenGrantNonceStorage");
    expect(fresh.loadLastSeenGrantNonce(ROOM_A, PEER_A)).toBe(NONCE_1);
  });

  // End-to-end dedup-after-reload simulation. This mirrors the exact
  // scenario the task targets: a grant ack is acted on, the React tree
  // (including the in-memory `lastSeenGrantNonceRef`) is torn down by a
  // page reload, the user re-mounts RoomPage, and a duplicated grant ack
  // carrying the SAME nonce arrives. Without persistence, the freshly
  // re-mounted ref is null and the duplicate would slip through. With
  // persistence, the duplicate is detected and dropped, so no second
  // promotion happens.
  it("dedups a duplicated grant ack that arrives after a page reload", () => {
    // Mimic the exact ack-handler dedup logic from RoomPage.tsx so the
    // test is faithful to the production code path. If that logic ever
    // changes shape, this helper is the single place to update.
    function makeAckHandler() {
      let ref: string | null = null;
      let promotionsTriggered = 0;
      return {
        handleAck(nonce: string) {
          if (typeof nonce === "string" && nonce.length > 0) {
            if (ref === null) {
              const persisted = loadLastSeenGrantNonce(ROOM_A, PEER_A);
              if (persisted) ref = persisted;
            }
            if (ref === nonce) return;
            ref = nonce;
            saveLastSeenGrantNonce(ROOM_A, PEER_A, nonce);
          }
          promotionsTriggered++;
        },
        get promotions() { return promotionsTriggered; },
      };
    }

    // Pre-reload: first grant ack arrives and is acted on.
    const before = makeAckHandler();
    before.handleAck(NONCE_1);
    expect(before.promotions).toBe(1);

    // Tab reloads — the React component (and its ref) is torn down. A new
    // RoomPage mounts. Storage persists across the reload.
    const after = makeAckHandler();

    // The duplicated/retransmitted grant ack carrying the SAME nonce
    // arrives at the freshly-mounted component.
    after.handleAck(NONCE_1);

    // The persisted nonce caught the duplicate, so no second promotion
    // was triggered post-reload.
    expect(after.promotions).toBe(0);

    // Sanity: a genuinely fresh nonce from a new reservation IS still
    // honored after the reload (the dedup is per-nonce, not a permanent
    // lockout).
    after.handleAck(NONCE_2);
    expect(after.promotions).toBe(1);
  });
});
