// SPDX-License-Identifier: AGPL-3.0-or-later
// One-shot, per-tab signal that the host just completed a *fresh paid create*
// — a brand-new Lightning invoice settled, not a recovery/resume and not an
// in-room extension — while VOID was loaded over a Tor `.onion` origin.
//
// Reaching VOID over an onion address hides the host's network identity at the
// signaling layer, but paying the Lightning invoice from a clearnet wallet
// links their IP to this room at whoever runs the payment server. The paywall
// already nudges the host to pay from a Tor-routed wallet *before* they pay
// (see PaywallModal's onion hint), but that hint is easy to miss. This marker
// lets the room raise a single, quieter in-room reminder *after* a paid create
// so a host who paid from a clearnet wallet anyway knows to wrap up sooner or
// rotate wallets next time.
//
// The create flow (StartScreen) sets the marker the moment the payment
// settles; RoomPage consumes it exactly once on entry. sessionStorage (not
// localStorage) so it never outlives the tab, and the consume removes it so
// the note is shown at most once per paid room.
const KEY = "void_paid_create_onion";

export function markPaidCreateOnion(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // sessionStorage can be unavailable (private-mode quotas, sandboxed
    // iframes). The reminder is best-effort — losing it is acceptable.
  }
}

export function consumePaidCreateOnion(): boolean {
  try {
    const present = sessionStorage.getItem(KEY) === "1";
    if (present) sessionStorage.removeItem(KEY);
    return present;
  } catch {
    return false;
  }
}
