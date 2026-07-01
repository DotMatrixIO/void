// SPDX-License-Identifier: AGPL-3.0-or-later
// Self-view visibility toggle (Task #571).
//
// Per-device, local-only preference that hides the user's own video tile
// from their own screen. Peers are unaffected — outgoing camera frames
// (with the masked/processed stream produced by buildMediaPipeline) keep
// flowing exactly as before. The toggle exists because some users find
// staring at themselves for an hour exhausting; it is NOT a privacy
// feature and the UI surface is honest about that.
//
// Default is `true` (visible) to preserve the historical behavior — no
// existing user opens the app one day and finds their tile gone. The
// "off" state is the only one we persist (writing "0"); the "on" state
// is represented by absence of the key, mirroring the localStorage
// shape used by `./uiSounds`.

export const SELF_VIEW_KEY = "2bit_self_view_visible";

export function getSelfViewVisible(): boolean {
  try {
    return localStorage.getItem(SELF_VIEW_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setSelfViewVisible(visible: boolean): void {
  try {
    if (visible) localStorage.removeItem(SELF_VIEW_KEY);
    else localStorage.setItem(SELF_VIEW_KEY, "0");
  } catch {
    /* storage disabled (Safari Private) — silently degrade to default-on */
  }
}
