// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NoTurnBanner from "./NoTurnBanner";

// Task #530: the banner is operator-facing and gated on the
// `no_turn_configured: true` flag from /api/ice-servers (caller also
// gates on isHost so guests never see it). Dismissal must persist
// per-origin in localStorage so a host who acknowledged the warning
// is not nagged on every join.
describe("NoTurnBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders nothing when show=false", () => {
    render(<NoTurnBanner show={false} />);
    expect(screen.queryByTestId("no-turn-banner")).not.toBeInTheDocument();
  });

  it("renders when show=true and not previously dismissed", () => {
    render(<NoTurnBanner show={true} />);
    expect(screen.getByTestId("no-turn-banner")).toBeInTheDocument();
    expect(
      screen.getByText(/NO TURN CONFIGURED/i),
    ).toBeInTheDocument();
  });

  it("hides immediately after clicking dismiss and persists the choice", () => {
    const { unmount } = render(<NoTurnBanner show={true} />);
    fireEvent.click(screen.getByTestId("no-turn-banner-dismiss"));
    expect(screen.queryByTestId("no-turn-banner")).not.toBeInTheDocument();
    unmount();

    // Subsequent mount on the same origin: should stay hidden
    // because dismissal is persisted in localStorage.
    render(<NoTurnBanner show={true} />);
    expect(screen.queryByTestId("no-turn-banner")).not.toBeInTheDocument();
  });

  it("does not render if show flips false even when not dismissed", () => {
    const { rerender } = render(<NoTurnBanner show={true} />);
    expect(screen.getByTestId("no-turn-banner")).toBeInTheDocument();
    rerender(<NoTurnBanner show={false} />);
    expect(screen.queryByTestId("no-turn-banner")).not.toBeInTheDocument();
  });
});
