// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-page object-URL registry (Task #398).
//
// Any `URL.createObjectURL(blob)` call site inside the room (or any
// other privacy-critical surface) that wants its blob URL to be
// guaranteed-revoked at BURN time should route the URL through
// `registerObjectUrl`. BURN calls `drainObjectUrlRegistry()` which
// revokes every still-registered URL and forgets them.
//
// Why a registry instead of "everyone remembers their own URL":
// each call site already has best-effort cleanup on its own
// lifecycle (audio test playback ends, video srcObject swap, etc.).
// The registry is the BURN-only safety net for the case where the
// call site never reached its normal cleanup branch because the
// user pressed BURN mid-flow. Double-revoke is a no-op, so the
// registry path and the per-site cleanup path do not conflict.
//
// We deliberately do NOT wrap `URL.createObjectURL` globally because:
//   - that would also drain blobs owned by libraries we don't control,
//   - call sites outside the room (marketing pages, the StartScreen
//     paywall modal previews) have their own lifecycle and should not
//     be torn down by a room-scoped BURN.
// Explicit opt-in via this module keeps the BURN contract auditable.

const registry = new Set<string>();

export function registerObjectUrl(url: string): string {
  if (url) registry.add(url);
  return url;
}

export function unregisterObjectUrl(url: string): void {
  registry.delete(url);
}

/** Revoke every URL currently in the registry. Safe to call multiple
 *  times. Individual revoke failures are swallowed — a URL that was
 *  already revoked by its owning call site simply no-ops. */
export function drainObjectUrlRegistry(): number {
  const urls = Array.from(registry);
  registry.clear();
  for (const u of urls) {
    try { URL.revokeObjectURL(u); } catch { /* already revoked */ }
  }
  return urls.length;
}

export const __testing = {
  size: () => registry.size,
  clear: () => registry.clear(),
};
