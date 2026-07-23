// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Task #1143: local sanity check on the stored paywall JWT.
//
// Root cause of the "HOST ROOM stays dead after refresh" bug: StartScreen
// treated the mere PRESENCE of sessionStorage `void_token` as proof of a
// usable payment and skipped the paywall. When the token was expired (or
// invalidated by a server restart under an ephemeral PAYWALL_SECRET), the
// create-room emit failed downstream — and nothing ever cleared the stored
// token, so every subsequent click (surviving refresh, since sessionStorage
// does) took the same dead path.
//
// This helper decodes the JWT payload LOCALLY (no signature check — the
// server remains the only authority; this is purely a client-side hygiene
// filter) and reports whether the token is structurally sound and unexpired.
// Anything unparseable is treated as expired so it gets cleared rather than
// wedging the flow again.

export function tokenLooksExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    if (typeof json.exp !== "number") return true;
    return json.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}
