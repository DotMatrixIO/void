// SPDX-License-Identifier: AGPL-3.0-or-later
// ─────────────────────────────────────────────────────────────────────────────
// Per-grant idempotency nonce persistence (Task #356).
//
// Task #303 introduced a per-grant nonce so a duplicated `request-screen-share`
// ack cannot be promoted twice and double-book the presenter slot. The client
// originally tracked the last-seen nonce in a `useRef` tied to the React
// component lifecycle. That guard evaporates the moment the room page is
// reloaded or the socket reconnect tears down and re-creates `RoomPage` —
// the ref resets to `null`, and a delayed/duplicated ack carrying the
// previous reservation's nonce could in principle slip through and re-enter
// the `getDisplayMedia` → `promoteShareToPeers` path for a grant the user
// already acted on.
//
// This module persists the last-seen grant nonce in `sessionStorage`, keyed
// by `roomCode + peerId`, so the dedup survives a full reload / socket
// reconnect for the same room+peer pair. We deliberately use `sessionStorage`
// (not `localStorage`):
//
//   • The nonce is only meaningful within a single browser session for a
//     specific reservation. A new tab is by definition a new participant
//     identity to the server (fresh `peerId` is minted on mount), so there
//     is nothing to dedup against from another tab.
//   • `sessionStorage` is wiped when the tab closes, which matches the
//     scope of the dedup window. Persisting beyond the tab would just leak
//     an obsolete tag onto disk for no benefit.
//   • The nonce itself is not payment-identifying or otherwise sensitive
//     beyond the room — it's a 16-byte random hex string scoped to one
//     reservation that has already been acted on. No encryption is needed.
//
// All operations silently no-op on storage failure: persisting the nonce is
// a hardening measure, and the in-memory ref still provides protection
// within the lifetime of a single component instance. Throwing here would
// be strictly worse than losing the cross-reload guarantee.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "void.lsgn.";

function storageKey(roomCode: string, peerId: string): string {
  return `${STORAGE_PREFIX}${roomCode}:${peerId}`;
}

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadLastSeenGrantNonce(roomCode: string, peerId: string): string | null {
  if (!roomCode || !peerId) return null;
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    return storage.getItem(storageKey(roomCode, peerId));
  } catch {
    return null;
  }
}

export function saveLastSeenGrantNonce(roomCode: string, peerId: string, nonce: string): void {
  if (!roomCode || !peerId || !nonce) return;
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(storageKey(roomCode, peerId), nonce);
  } catch {
    /* best-effort */
  }
}

export function clearLastSeenGrantNonce(roomCode: string, peerId: string): void {
  if (!roomCode || !peerId) return;
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(roomCode, peerId));
  } catch {
    /* best-effort */
  }
}

export const __testing = { STORAGE_PREFIX, storageKey };
