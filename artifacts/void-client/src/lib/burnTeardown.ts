// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure helpers used by the BURN / room-destroyed teardown paths.
// Extracted so the privacy-critical "every track is .stop()'d"
// contract can be unit-tested without driving the full RoomPage.

export interface PendingShareLike {
  track: { stop: () => void };
  stream: { getTracks: () => Array<{ stop: () => void }> };
}

export function stopPendingShare(pending: PendingShareLike | null | undefined): boolean {
  if (!pending) return false;
  try { pending.track.stop(); } catch { /* track may already be ended */ }
  try { pending.stream.getTracks().forEach((t) => t.stop()); } catch { /* stream may be torn down */ }
  return true;
}

export function stopAllTracksOf(stream: { getTracks: () => Array<{ stop: () => void }> } | null | undefined): boolean {
  if (!stream) return false;
  try { stream.getTracks().forEach((t) => t.stop()); } catch { return false; }
  return true;
}

// ─── Task #398: BURN actually burns ──────────────────────────────────────────
// The teardown below covers residue that survives the track-stop /
// pipeline-stop loop above. Each helper is intentionally narrow-scoped and
// best-effort: BURN runs in one shot from a click handler, must not block on
// the network or service worker, and must not crash if a browser feature is
// missing (sessionStorage disabled in Safari Private mode, no CacheStorage in
// some embedded webviews, etc.). Failure of any individual helper is reported
// back to the caller so the BurnedOverlay can surface a user-visible reason.

// Anything we wrote into sessionStorage that names VOID. The single
// authoritative criterion is the "void"-prefix namespace convention used by
// every storage call site:
//   - `void_token`                            (paid-room JWT, hottest target)
//   - `void:tor-wallet-prompt-dismissed`      (StartScreen UX flag)
//   - `void.lsgn.<room>:<peer>`               (grant-nonce dedupe)
// Other artifacts (api-server, mockup-sandbox) do not use the `void`-prefix
// in this client's sessionStorage, so a startsWith filter is both sufficient
// and safe.
export function clearVoidSessionStorage(): number {
  if (typeof sessionStorage === "undefined") return 0;
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && /^void[._:]?/i.test(key)) toRemove.push(key);
    }
    for (const k of toRemove) {
      try { sessionStorage.removeItem(k); } catch { /* best effort */ }
    }
  } catch { /* storage disabled (Safari Private) */ }
  return toRemove.length;
}

// VOID's runtime service-worker cache name (see public/sw.js). We match on
// either the literal name or known VOID-owned prefixes so a future rename
// (e.g. "2bit-v2") is still drained, while neighboring artifacts that may
// register their own caches under different names are left alone — that's
// the "scoped to VOID-owned cache names so we do not break neighboring
// artifacts" requirement.
function isVoidOwnedCacheName(name: string): boolean {
  return /^(2bit-|void[-_.])/i.test(name);
}

export async function clearVoidCaches(): Promise<number> {
  if (typeof caches === "undefined") return 0;
  try {
    const names = await caches.keys();
    const targets = names.filter(isVoidOwnedCacheName);
    await Promise.all(targets.map((n) =>
      caches.delete(n).catch(() => false)
    ));
    return targets.length;
  } catch {
    return 0;
  }
}

// Task #407: localStorage residue. The known VOID-owned localStorage keys
// are namespaced under the `2bit_` prefix (the legacy retro brand):
//   - `2bit_music_enabled`        (background music opt-in)
//   - `2bit_ui_sounds_enabled`    (UI sound presence opt-in, Task #407)
// Anything else with that prefix that future tasks add is automatically
// covered. We deliberately do not blanket-clear `localStorage` because
// neighboring artifacts (api-server, mockup-sandbox) may write under
// other prefixes that we must not stomp on. The "BURN actually burns"
// promise is broken if a localStorage audit reveals VOID-owned residue.
export function clearVoidLocalStorage(): number {
  if (typeof localStorage === "undefined") return 0;
  const toRemove: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && /^2bit[._:]?/i.test(key)) toRemove.push(key);
    }
    for (const k of toRemove) {
      try { localStorage.removeItem(k); } catch { /* best effort */ }
    }
  } catch { /* storage disabled (Safari Private) */ }
  return toRemove.length;
}

export const __testing = { isVoidOwnedCacheName };
