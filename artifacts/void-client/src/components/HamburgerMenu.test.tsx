// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HamburgerMenu from "./HamburgerMenu";
import {
  ALLOW_UNMASKED_VIDEO_KEY,
  ALLOW_UNMASKED_VOICE_KEY,
  getAllowUnmaskedVideo,
  getAllowUnmaskedVoice,
} from "@/lib/maskingPrefs";

// UiSoundsToggle pokes the AudioContext on first render in some
// runtimes; stub it down to a label so this suite stays focused on
// the ALLOW UNMASKED toggle rows added by task #572.
vi.mock("@/components/UiSoundsToggle", () => ({
  default: () => <div data-testid="ui-sounds-toggle-stub" />,
}));

vi.mock("@/lib/uiSounds", () => ({
  uiClick: vi.fn(),
  uiSelectClick: vi.fn(),
  uiBleep: vi.fn(),
}));

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /Open menu/i }));
}

describe("HamburgerMenu masking-safety toggles", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders both toggles OFF by default with aria-pressed=false and the un-checked label", async () => {
    render(<HamburgerMenu />);
    await openMenu();

    const video = screen.getByTestId("allow-unmasked-video-toggle");
    const voice = screen.getByTestId("allow-unmasked-voice-toggle");
    expect(video).toHaveAttribute("aria-pressed", "false");
    expect(voice).toHaveAttribute("aria-pressed", "false");
    expect(video.textContent).toBe("ALLOW UNMASKED VIDEO");
    expect(voice.textContent).toBe("ALLOW UNMASKED VOICE");
  });

  it("OFF → ON for video opens the ConfirmDialog and does NOT flip the pref until ALLOW is clicked", async () => {
    render(<HamburgerMenu />);
    await openMenu();

    const toggle = screen.getByTestId("allow-unmasked-video-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);

    // Confirm prompt appears — pref untouched until confirmed.
    const dialog = await screen.findByTestId("allow-unmasked-video-confirm");
    expect(dialog).toBeInTheDocument();
    expect(getAllowUnmaskedVideo()).toBe(false);
    expect(localStorage.getItem(ALLOW_UNMASKED_VIDEO_KEY)).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Confirm flips the pref and updates the toggle.
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(getAllowUnmaskedVideo()).toBe(true);
    expect(localStorage.getItem(ALLOW_UNMASKED_VIDEO_KEY)).toBe("1");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.textContent).toBe("✓ ALLOW UNMASKED VIDEO");
    expect(screen.queryByTestId("allow-unmasked-video-confirm")).toBeNull();
  });

  it("OFF → ON cancel path leaves the pref OFF (Cancel button, Escape, and backdrop)", async () => {
    render(<HamburgerMenu />);
    await openMenu();
    const toggle = screen.getByTestId("allow-unmasked-voice-toggle");

    // Cancel button.
    await userEvent.click(toggle);
    expect(
      screen.getByTestId("allow-unmasked-voice-confirm"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(screen.queryByTestId("allow-unmasked-voice-confirm")).toBeNull();
    expect(getAllowUnmaskedVoice()).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Escape.
    await userEvent.click(toggle);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(getAllowUnmaskedVoice()).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("ON → OFF for video is immediate — no ConfirmDialog, pref flips synchronously", async () => {
    // Pre-arrange: pref already ON.
    localStorage.setItem(ALLOW_UNMASKED_VIDEO_KEY, "1");

    render(<HamburgerMenu />);
    await openMenu();
    const toggle = screen.getByTestId("allow-unmasked-video-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);

    // No confirm dialog for the ON → OFF path — flipping back to safe
    // is friction-free by design.
    expect(screen.queryByTestId("allow-unmasked-video-confirm")).toBeNull();
    expect(getAllowUnmaskedVideo()).toBe(false);
    expect(localStorage.getItem(ALLOW_UNMASKED_VIDEO_KEY)).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.textContent).toBe("ALLOW UNMASKED VIDEO");
  });

  it("ON → OFF for voice is immediate too, independent of the video toggle", async () => {
    localStorage.setItem(ALLOW_UNMASKED_VOICE_KEY, "1");
    render(<HamburgerMenu />);
    await openMenu();

    const voice = screen.getByTestId("allow-unmasked-voice-toggle");
    expect(voice).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(voice);
    expect(screen.queryByTestId("allow-unmasked-voice-confirm")).toBeNull();
    expect(getAllowUnmaskedVoice()).toBe(false);
    // Video pref untouched.
    expect(getAllowUnmaskedVideo()).toBe(false);
    expect(
      screen.getByTestId("allow-unmasked-video-toggle"),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("nests the nav links under an expandable WORDS heading (#599)", async () => {
    render(<HamburgerMenu />);
    await openMenu();

    const wordsToggle = screen.getByTestId("words-section-toggle");
    // Default expanded: links visible, PREFERENCES still present.
    expect(wordsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /WHY NOT ZOOM/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /THREAT MODEL/i })).toBeInTheDocument();
    expect(screen.getByText("PREFERENCES")).toBeInTheDocument();

    // Collapse hides the links but keeps PREFERENCES.
    await userEvent.click(wordsToggle);
    expect(wordsToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /WHY NOT ZOOM/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /THREAT MODEL/i })).toBeNull();
    expect(screen.getByText("PREFERENCES")).toBeInTheDocument();

    // Expand restores them.
    await userEvent.click(wordsToggle);
    expect(wordsToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /THREAT MODEL/i })).toBeInTheDocument();
  });

  it("exposes a top-level MEDIA entry (sibling of WORDS) pointing at /media", async () => {
    render(<HamburgerMenu />);
    await openMenu();

    const media = screen.getByTestId("media-nav-link");
    expect(media.getAttribute("href")).toBe("/media");
    expect(media.textContent).toMatch(/MEDIA/);

    // MEDIA is independent of the WORDS umbrella: collapsing WORDS hides the
    // nested nav links but leaves MEDIA in place.
    await userEvent.click(screen.getByTestId("words-section-toggle"));
    expect(screen.queryByRole("link", { name: /THREAT MODEL/i })).toBeNull();
    expect(screen.getByTestId("media-nav-link")).toBeInTheDocument();
  });

  it("reflects a cross-tab storage flip live without re-opening the menu", async () => {
    render(<HamburgerMenu />);
    await openMenu();
    const toggle = screen.getByTestId("allow-unmasked-video-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    // Simulate another tab writing the pref. The HamburgerMenu's
    // subscribeMaskingPrefs hook listens for the native storage event.
    localStorage.setItem(ALLOW_UNMASKED_VIDEO_KEY, "1");
    fireEvent(
      window,
      new StorageEvent("storage", { key: ALLOW_UNMASKED_VIDEO_KEY }),
    );

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle.textContent).toBe("✓ ALLOW UNMASKED VIDEO");
  });
});
