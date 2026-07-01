// SPDX-License-Identifier: AGPL-3.0-or-later
// Per-device safety toggles for unmasked video/voice (Task #572).
//
// VOID's privacy-first posture means a single accidental tap on the
// in-room control bar can broadcast the user's real face or voice.
// These two booleans gate whether NONE is reachable at all:
//   - OFF (default): the in-room cycle skips NONE, and the PreviewGate
//     renders NONE as a disabled/greyed slot with a hint pointing the
//     user at the Hamburger menu.
//   - ON: NONE behaves exactly as before.
//
// Mirrors the `uiSounds.ts` pattern: single source of truth, no
// callsite reads `localStorage` directly. Adds a lightweight
// subscription mechanism (custom event on `window`) so PreviewGate /
// RoomPage / HamburgerMenu reflect changes live, plus the cross-tab
// `storage` event for the same key.

export const ALLOW_UNMASKED_VIDEO_KEY = "voidAllowUnmaskedVideo";
export const ALLOW_UNMASKED_VOICE_KEY = "voidAllowUnmaskedVoice";

export const UNMASKED_VIDEO_HINT_DISMISSED_KEY =
  "voidUnmaskedVideoHintDismissed";
export const UNMASKED_VOICE_HINT_DISMISSED_KEY =
  "voidUnmaskedVoiceHintDismissed";

// Defaults that the cycle / PreviewGate falls back to when a stream is
// currently sitting on NONE and the user flips the toggle OFF.
// Mirrors the existing PreviewGate first-mount defaults so the user
// gets the same "safe" mask either way.
export const DEFAULT_VIDEO_STYLE = 5; // ASCII
export const DEFAULT_VOICE_MODE = 3;  // SCRAMBLE

const CHANGE_EVENT = "void:masking-prefs-change";

function readBool(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* storage disabled (Safari Private) — silently degrade to default-off */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
  } catch {
    /* CustomEvent unavailable — subscribers will still see cross-tab
       updates via the native `storage` event. */
  }
}

export function getAllowUnmaskedVideo(): boolean {
  return readBool(ALLOW_UNMASKED_VIDEO_KEY);
}

export function setAllowUnmaskedVideo(value: boolean): void {
  writeBool(ALLOW_UNMASKED_VIDEO_KEY, value);
}

export function getAllowUnmaskedVoice(): boolean {
  return readBool(ALLOW_UNMASKED_VOICE_KEY);
}

export function setAllowUnmaskedVoice(value: boolean): void {
  writeBool(ALLOW_UNMASKED_VOICE_KEY, value);
}

export function getUnmaskedVideoHintDismissed(): boolean {
  return readBool(UNMASKED_VIDEO_HINT_DISMISSED_KEY);
}

export function setUnmaskedVideoHintDismissed(value: boolean): void {
  writeBool(UNMASKED_VIDEO_HINT_DISMISSED_KEY, value);
}

export function getUnmaskedVoiceHintDismissed(): boolean {
  return readBool(UNMASKED_VOICE_HINT_DISMISSED_KEY);
}

export function setUnmaskedVoiceHintDismissed(value: boolean): void {
  writeBool(UNMASKED_VOICE_HINT_DISMISSED_KEY, value);
}

// Subscribe to changes. Returns an unsubscribe function. Fires for any
// of the four keys above (toggle flips and per-stream hint dismisses);
// callers re-read the specific key they care about.
export function subscribeMaskingPrefs(listener: () => void): () => void {
  const onCustom = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === null
      || e.key === ALLOW_UNMASKED_VIDEO_KEY
      || e.key === ALLOW_UNMASKED_VOICE_KEY
      || e.key === UNMASKED_VIDEO_HINT_DISMISSED_KEY
      || e.key === UNMASKED_VOICE_HINT_DISMISSED_KEY
    ) {
      listener();
    }
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
