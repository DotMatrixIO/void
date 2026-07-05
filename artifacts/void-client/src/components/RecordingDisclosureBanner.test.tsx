// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import RecordingDisclosureBanner from "./RecordingDisclosureBanner";

// The banner has to:
//   1. Show on initial mount.
//   2. Auto-dismiss after the configured window.
//   3. Re-show whenever the parent bumps `triggerKey` (a new peer joined).
//   4. Stay dismissed if the user clicks the × button, until the next bump.
//
// We freeze setTimeout so we can assert the auto-dismiss behavior
// deterministically without relying on real wall time.
//
// The component defers its initial show by one requestAnimationFrame so
// that Safari's layout settles before the fixed overlay appears. With
// vi.useFakeTimers() that RAF is also frozen; flush it with
// vi.advanceTimersByTime(16) before asserting visibility.
describe("RecordingDisclosureBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Flush the one requestAnimationFrame the component waits for before showing. */
  function flushRaf() {
    act(() => {
      vi.advanceTimersByTime(16);
    });
  }

  it("renders the recording-disclosure copy on initial mount", () => {
    render(<RecordingDisclosureBanner triggerKey={0} />);
    flushRaf();
    expect(screen.getByTestId("recording-disclosure-banner")).toBeInTheDocument();
    expect(
      screen.getByText("ANYONE HERE CAN BE RECORDING"),
    ).toBeInTheDocument();
  });

  it("auto-dismisses after the configured window", () => {
    render(<RecordingDisclosureBanner triggerKey={0} autoDismissMs={5000} />);
    flushRaf();
    expect(screen.getByTestId("recording-disclosure-banner")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByTestId("recording-disclosure-banner")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(
      screen.queryByTestId("recording-disclosure-banner"),
    ).not.toBeInTheDocument();
  });

  it("re-shows when triggerKey changes (e.g. a new peer joined)", () => {
    const { rerender } = render(
      <RecordingDisclosureBanner triggerKey={0} autoDismissMs={5000} />,
    );
    flushRaf();

    // Wait past the auto-dismiss so the banner is gone.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(
      screen.queryByTestId("recording-disclosure-banner"),
    ).not.toBeInTheDocument();

    // Parent bumps triggerKey → banner should re-appear after the RAF.
    rerender(<RecordingDisclosureBanner triggerKey={1} autoDismissMs={5000} />);
    flushRaf();
    expect(screen.getByTestId("recording-disclosure-banner")).toBeInTheDocument();

    // And the new instance respects its own auto-dismiss window.
    act(() => {
      vi.advanceTimersByTime(5001);
    });
    expect(
      screen.queryByTestId("recording-disclosure-banner"),
    ).not.toBeInTheDocument();
  });

  it("manual dismiss via the × button hides the banner immediately", () => {
    // We use fireEvent rather than userEvent here because userEvent
    // internally schedules its own setTimeout-based microtask waits
    // which deadlock against vitest's frozen timers (setup in
    // beforeEach above). fireEvent dispatches synchronously, which is
    // exactly what we want for this assertion.
    render(<RecordingDisclosureBanner triggerKey={0} autoDismissMs={5000} />);
    flushRaf();
    fireEvent.click(screen.getByTestId("recording-disclosure-dismiss"));
    expect(
      screen.queryByTestId("recording-disclosure-banner"),
    ).not.toBeInTheDocument();
  });

  it("manual dismiss does NOT block re-show on the next triggerKey bump", () => {
    const { rerender } = render(
      <RecordingDisclosureBanner triggerKey={0} autoDismissMs={5000} />,
    );
    flushRaf();
    fireEvent.click(screen.getByTestId("recording-disclosure-dismiss"));
    expect(
      screen.queryByTestId("recording-disclosure-banner"),
    ).not.toBeInTheDocument();

    rerender(<RecordingDisclosureBanner triggerKey={1} autoDismissMs={5000} />);
    flushRaf();
    expect(screen.getByTestId("recording-disclosure-banner")).toBeInTheDocument();
  });
});
