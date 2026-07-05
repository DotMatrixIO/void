// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeadRoomOverlay, {
  DEAD_ROOM_COPY,
  DEAD_ROOM_ERROR_STRINGS,
  isDeadRoomError,
} from "./DeadRoomOverlay";

describe("DeadRoomOverlay", () => {
  it("renders the verbatim copy as a single sentence", () => {
    render(<DeadRoomOverlay onBack={() => {}} />);
    expect(screen.getByTestId("dead-room-overlay")).toHaveTextContent(
      "Room destroyed — this URL is gone. If you refresh, it should stay gone.",
    );
    expect(DEAD_ROOM_COPY).toBe(
      "Room destroyed — this URL is gone. If you refresh, it should stay gone.",
    );
  });

  it("calls onBack when BACK TO MENU is clicked", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<DeadRoomOverlay onBack={onBack} />);
    await user.click(screen.getByRole("button", { name: /BACK TO MENU/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders as an alertdialog with a labelled heading and modal flag", () => {
    render(<DeadRoomOverlay onBack={() => {}} />);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "dead-room-dialog-title");
    expect(document.getElementById("dead-room-dialog-title")).toHaveTextContent(
      DEAD_ROOM_COPY,
    );
  });

  it("auto-focuses the BACK TO MENU button on mount", () => {
    render(<DeadRoomOverlay onBack={() => {}} />);
    expect(screen.getByRole("button", { name: /BACK TO MENU/i })).toHaveFocus();
  });

  it("dismisses via Escape key", async () => {
    const onBack = vi.fn();
    const user = userEvent.setup();
    render(<DeadRoomOverlay onBack={onBack} />);
    await user.keyboard("{Escape}");
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("isDeadRoomError", () => {
  it("returns true for all four dead-room error strings", () => {
    for (const e of DEAD_ROOM_ERROR_STRINGS) {
      expect(isDeadRoomError(e)).toBe(true);
    }
    expect(isDeadRoomError("ROOM EXPIRED")).toBe(true);
    expect(isDeadRoomError("INVALID CODE")).toBe(true);
    expect(isDeadRoomError("ROOM NOT FOUND")).toBe(true);
    expect(isDeadRoomError("ROOM DESTROYED")).toBe(true);
  });

  it("returns false for non-dead-room errors and null", () => {
    expect(isDeadRoomError("ROOM FULL")).toBe(false);
    expect(isDeadRoomError("ROOM LOCKED")).toBe(false);
    expect(isDeadRoomError("CONNECTION ERROR")).toBe(false);
    expect(isDeadRoomError("ENTRY DENIED")).toBe(false);
    expect(isDeadRoomError(null)).toBe(false);
    expect(isDeadRoomError("")).toBe(false);
  });
});
