// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DevToolsP2PModal from "./DevToolsP2PModal";

describe("DevToolsP2PModal", () => {
  it("does not render when open is false", () => {
    render(<DevToolsP2PModal open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("devtools-p2p-modal")).not.toBeInTheDocument();
  });

  it("renders the walkthrough when open is true", () => {
    render(<DevToolsP2PModal open={true} onClose={() => {}} />);
    expect(screen.getByTestId("devtools-p2p-modal")).toBeInTheDocument();
  });

  it("calls onClose when the explicit close button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DevToolsP2PModal open={true} onClose={onClose} />);
    const closeBtn = screen.getByRole("button", { name: /close/i });
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<DevToolsP2PModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders as a labelled dialog with aria-modal pointing at the heading", () => {
    render(<DevToolsP2PModal open={true} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "devtools-p2p-heading");
    expect(document.getElementById("devtools-p2p-heading")).toHaveTextContent(
      "PROVE IT YOURSELF",
    );
  });

  it("focuses the first focusable on mount and traps Tab inside the dialog", () => {
    render(<DevToolsP2PModal open={true} onClose={() => {}} />);
    const closeBtn = screen.getByTestId("devtools-p2p-modal-close");
    // The CLOSE button is the only focusable inside the dialog, so it must
    // both receive initial focus and be where Tab cycles back to.
    expect(closeBtn).toHaveFocus();
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(closeBtn).toHaveFocus();
  });
});
