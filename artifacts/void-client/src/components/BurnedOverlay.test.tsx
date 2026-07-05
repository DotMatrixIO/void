// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import BurnedOverlay, { BURN_AUTO_DISMISS_MS } from "./BurnedOverlay";

describe("BurnedOverlay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders as an alertdialog with assertive aria-live and labelled title/description", () => {
    render(<BurnedOverlay onDismiss={() => {}} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-live", "assertive");
    expect(dialog).toHaveAttribute("aria-labelledby", "burn-dialog-title");
    expect(dialog).toHaveAttribute("aria-describedby", "burn-dialog-desc");
    expect(screen.getByText("ROOM BURNED")).toHaveAttribute("id", "burn-dialog-title");
    expect(screen.getByText("ALL KEYS DESTROYED")).toHaveAttribute("id", "burn-dialog-desc");
  });

  it("auto-dismisses after the 3 second default (long enough for screen readers)", () => {
    expect(BURN_AUTO_DISMISS_MS).toBe(3000);
    const onDismiss = vi.fn();
    render(<BurnedOverlay onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(2999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses immediately when ESC is pressed", () => {
    const onDismiss = vi.fn();
    render(<BurnedOverlay onDismiss={onDismiss} />);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not double-fire if ESC is pressed before the auto-dismiss timer elapses", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<BurnedOverlay onDismiss={onDismiss} />);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    unmount();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
