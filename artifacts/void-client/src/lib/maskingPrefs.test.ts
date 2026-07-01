// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ALLOW_UNMASKED_VIDEO_KEY,
  ALLOW_UNMASKED_VOICE_KEY,
  UNMASKED_VIDEO_HINT_DISMISSED_KEY,
  UNMASKED_VOICE_HINT_DISMISSED_KEY,
  DEFAULT_VIDEO_STYLE,
  DEFAULT_VOICE_MODE,
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
  getUnmaskedVideoHintDismissed,
  getUnmaskedVoiceHintDismissed,
  setAllowUnmaskedVideo,
  setAllowUnmaskedVoice,
  setUnmaskedVideoHintDismissed,
  setUnmaskedVoiceHintDismissed,
  subscribeMaskingPrefs,
} from "./maskingPrefs";

describe("maskingPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false for both ALLOW UNMASKED toggles", () => {
    expect(getAllowUnmaskedVideo()).toBe(false);
    expect(getAllowUnmaskedVoice()).toBe(false);
  });

  it("defaults to false for both hint-dismissed flags", () => {
    expect(getUnmaskedVideoHintDismissed()).toBe(false);
    expect(getUnmaskedVoiceHintDismissed()).toBe(false);
  });

  it("publishes the canonical default fallback indices", () => {
    // ASCII for video, SCRAMBLE for voice — the values that the cycle
    // / PreviewGate snap to when the pref flips OFF mid-NONE.
    expect(DEFAULT_VIDEO_STYLE).toBe(5);
    expect(DEFAULT_VOICE_MODE).toBe(3);
  });

  it("round-trips video toggle via localStorage with a stable key", () => {
    setAllowUnmaskedVideo(true);
    expect(localStorage.getItem(ALLOW_UNMASKED_VIDEO_KEY)).toBe("1");
    expect(getAllowUnmaskedVideo()).toBe(true);
    setAllowUnmaskedVideo(false);
    expect(localStorage.getItem(ALLOW_UNMASKED_VIDEO_KEY)).toBeNull();
    expect(getAllowUnmaskedVideo()).toBe(false);
  });

  it("round-trips voice toggle via localStorage with a stable key", () => {
    setAllowUnmaskedVoice(true);
    expect(localStorage.getItem(ALLOW_UNMASKED_VOICE_KEY)).toBe("1");
    expect(getAllowUnmaskedVoice()).toBe(true);
    setAllowUnmaskedVoice(false);
    expect(localStorage.getItem(ALLOW_UNMASKED_VOICE_KEY)).toBeNull();
  });

  it("round-trips both hint-dismissed flags independently", () => {
    setUnmaskedVideoHintDismissed(true);
    expect(getUnmaskedVideoHintDismissed()).toBe(true);
    expect(getUnmaskedVoiceHintDismissed()).toBe(false);
    expect(localStorage.getItem(UNMASKED_VIDEO_HINT_DISMISSED_KEY)).toBe("1");
    setUnmaskedVoiceHintDismissed(true);
    expect(getUnmaskedVoiceHintDismissed()).toBe(true);
    expect(localStorage.getItem(UNMASKED_VOICE_HINT_DISMISSED_KEY)).toBe("1");
  });

  it("notifies subscribers on local set via CustomEvent", () => {
    const listener = vi.fn();
    const unsub = subscribeMaskingPrefs(listener);
    setAllowUnmaskedVideo(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setAllowUnmaskedVoice(true);
    expect(listener).toHaveBeenCalledTimes(2);
    setUnmaskedVideoHintDismissed(true);
    expect(listener).toHaveBeenCalledTimes(3);
    unsub();
    setAllowUnmaskedVideo(false);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("notifies subscribers on cross-tab storage events for any of the 4 keys", () => {
    const listener = vi.fn();
    const unsub = subscribeMaskingPrefs(listener);
    // Cross-tab updates don't fire CustomEvent in this tab — they
    // arrive via the native `storage` event with a matching key.
    for (const key of [
      ALLOW_UNMASKED_VIDEO_KEY,
      ALLOW_UNMASKED_VOICE_KEY,
      UNMASKED_VIDEO_HINT_DISMISSED_KEY,
      UNMASKED_VOICE_HINT_DISMISSED_KEY,
    ]) {
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }
    expect(listener).toHaveBeenCalledTimes(4);
    // Unrelated keys must NOT wake the subscriber up.
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(listener).toHaveBeenCalledTimes(4);
    unsub();
  });

  it("treats a storage clear (key=null) as a relevant change", () => {
    const listener = vi.fn();
    const unsub = subscribeMaskingPrefs(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });
});
