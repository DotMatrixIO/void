// SPDX-License-Identifier: AGPL-3.0-or-later
// UI sound presence toggle (Task #407).
//
// In a high-discretion physical setting (someone running the SILHOUETTE
// shader because they don't want bystanders to know what app they're on),
// a distinct retro "peer joined" bleep from the device speaker outs them
// as a VOID user. The voice mask and shader privacy work is undone by a
// 200ms bloop. The policy is therefore the simplest safe one: UI sounds
// default OFF everywhere, behind a single user-visible toggle. If the
// retro ambience matters, the user opts in once.
//
// This module is the SINGLE source of truth for whether a UI event may
// emit a sound. Every callsite in the client goes through one of the
// `ui*` wrappers below (or `shouldPlayUiSound()` directly) — no callsite
// invokes the raw synthesisers in `./sounds` for UI events. Background
// music is handled separately by `./music` with its own toggle.
import {
  playBleep,
  playBloop,
  playClick,
  playSelectClick,
  playSlide,
} from "./sounds";

export const UI_SOUNDS_KEY = "2bit_ui_sounds_enabled";

export function getUiSoundsEnabled(): boolean {
  try {
    return localStorage.getItem(UI_SOUNDS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setUiSoundsEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(UI_SOUNDS_KEY, "1");
    else localStorage.removeItem(UI_SOUNDS_KEY);
  } catch {
    /* storage disabled (Safari Private) — silently degrade to default-off */
  }
}

export function shouldPlayUiSound(): boolean {
  return getUiSoundsEnabled();
}

// Thin wrappers. Every UI-event callsite uses these instead of the raw
// `play*` functions in `./sounds`. Keeping the gate at the callsite (not
// inside the synthesiser) means tests that mock `@/lib/sounds` see no
// invocations of `playBleep` when the toggle is off — which is exactly
// the audit guarantee the task calls for.
export function uiBleep(): void {
  if (shouldPlayUiSound()) playBleep();
}
export function uiBloop(): void {
  if (shouldPlayUiSound()) playBloop();
}
export function uiClick(): void {
  if (shouldPlayUiSound()) playClick();
}
export function uiSelectClick(): void {
  if (shouldPlayUiSound()) playSelectClick();
}
export function uiSlide(): void {
  if (shouldPlayUiSound()) playSlide();
}
