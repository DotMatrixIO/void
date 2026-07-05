// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SasVerificationDialog from "./SasVerificationDialog";

function renderWithAnchor(props: Partial<React.ComponentProps<typeof SasVerificationDialog>> = {}) {
  const anchor = document.createElement("button");
  anchor.textContent = "TAP TO VERIFY";
  document.body.appendChild(anchor);
  anchor.focus();

  const onClose = vi.fn();
  const onVerified = vi.fn();
  const onMismatch = vi.fn();

  const utils = render(
    <SasVerificationDialog
      sas={["alpha", "bravo"]}
      vState="unverified"
      peerLabel="P1"
      peerVoiceModeLabel={null}
      isNarrowViewport={false}
      anchor={anchor}
      onClose={onClose}
      onVerified={onVerified}
      onMismatch={onMismatch}
      {...props}
    />,
  );
  return { ...utils, anchor, onClose, onVerified, onMismatch };
}

describe("SasVerificationDialog", () => {
  it("renders as an aria-modal dialog whose accessible name identifies the peer", () => {
    renderWithAnchor({ peerLabel: "P2" });
    const dialog = screen.getByRole("dialog", {
      name: "Verify SAS phrase pair with P2",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const heading = screen.getByRole("heading", { name: "VERIFY SAS" });
    expect(heading.tagName).toBe("H2");
  });

  it("focuses the first focusable element inside the dialog when opened", () => {
    renderWithAnchor();
    const wordsMatch = screen.getByRole("button", { name: "WORDS MATCH" });
    expect(document.activeElement).toBe(wordsMatch);
  });

  it("traps Tab focus inside the dialog (forward wraps from last to first)", async () => {
    const user = userEvent.setup();
    renderWithAnchor();
    const wordsMatch = screen.getByRole("button", { name: "WORDS MATCH" });
    const dontMatch = screen.getByRole("button", { name: "DON’T MATCH" });

    expect(document.activeElement).toBe(wordsMatch);
    await user.tab();
    expect(document.activeElement).toBe(dontMatch);
    await user.tab();
    expect(document.activeElement).toBe(wordsMatch);
  });

  it("traps Shift+Tab focus inside the dialog (backward wraps from first to last)", async () => {
    const user = userEvent.setup();
    renderWithAnchor();
    const wordsMatch = screen.getByRole("button", { name: "WORDS MATCH" });
    const dontMatch = screen.getByRole("button", { name: "DON’T MATCH" });

    expect(document.activeElement).toBe(wordsMatch);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(dontMatch);
  });

  it("restores focus to the previously focused element on unmount", () => {
    const { unmount, anchor } = renderWithAnchor();
    expect(document.activeElement).not.toBe(anchor);
    act(() => {
      unmount();
    });
    expect(document.activeElement).toBe(anchor);
  });

  it("invokes onVerified and onClose when WORDS MATCH is clicked", () => {
    const { onVerified, onClose } = renderWithAnchor();
    fireEvent.click(screen.getByRole("button", { name: "WORDS MATCH" }));
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onMismatch and onClose when DON'T MATCH is clicked", () => {
    const { onMismatch, onClose } = renderWithAnchor();
    fireEvent.click(screen.getByRole("button", { name: "DON’T MATCH" }));
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when Escape is pressed (keyboard dismissal)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderWithAnchor();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the voice mask warning when peer voice mode is active", () => {
    renderWithAnchor({ peerVoiceModeLabel: "DEEP" });
    expect(screen.getByText(/VOICE MASK ACTIVE \(DEEP\)/)).toBeInTheDocument();
  });
});
