// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import ConfirmDialog from "./ConfirmDialog";

afterEach(() => {
  cleanup();
});

function renderDialog(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <ConfirmDialog
      open
      title="ALLOW UNMASKED VIDEO?"
      body="Peers will see your real face."
      confirmLabel="ALLOW"
      cancelLabel="CANCEL"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("renders nothing when open is false", () => {
    const { queryByRole } = render(
      <ConfirmDialog
        open={false}
        title="t"
        body="b"
        confirmLabel="OK"
        cancelLabel="NO"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(queryByRole("dialog")).toBeNull();
  });

  it("renders as a modal dialog with labelled title and described body", () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(labelledBy && document.getElementById(labelledBy)?.textContent).toBe(
      "ALLOW UNMASKED VIDEO?",
    );
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(
      "Peers will see your real face.",
    );
  });

  it("invokes onConfirm only when the confirm button is clicked", async () => {
    const { onConfirm, onCancel } = renderDialog();
    await userEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("invokes onCancel on the cancel button, the backdrop, and Escape", async () => {
    const { onCancel, container } = renderDialog();
    await userEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Backdrop click — the overlay is the dialog's parent.
    const overlay = container.firstChild as HTMLElement;
    fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledTimes(2);
    // Escape key — useDialogFocusTrap wires this when active.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("does not cancel when clicks land inside the dialog panel", async () => {
    const { onCancel } = renderDialog();
    await userEvent.click(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  // Focus trap: useDialogFocusTrap moves focus into the dialog on open
  // and cycles Tab / Shift+Tab inside it. The privacy-sensitive
  // ConfirmDialog must not let a keyboard user tab out into the page
  // underneath (and then hit Enter on, say, the in-room control bar)
  // while the prompt is up.
  it("moves focus to the first focusable button when opened", () => {
    renderDialog();
    expect(document.activeElement).toBe(
      screen.getByTestId("confirm-dialog-cancel"),
    );
  });

  it("traps Tab cycling inside the dialog (last → first, first via Shift+Tab → last)", async () => {
    renderDialog();
    const cancel = screen.getByTestId("confirm-dialog-cancel");
    const confirm = screen.getByTestId("confirm-dialog-confirm");
    expect(document.activeElement).toBe(cancel);

    // Forward Tab from the last focusable wraps to the first.
    confirm.focus();
    expect(document.activeElement).toBe(confirm);
    await userEvent.tab();
    expect(document.activeElement).toBe(cancel);

    // Shift+Tab from the first focusable wraps to the last.
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("restores focus to the previously-focused element on close", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "open";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <ConfirmDialog
        open
        title="t"
        body="b"
        confirmLabel="OK"
        cancelLabel="NO"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).not.toBe(trigger);
    rerender(
      <ConfirmDialog
        open={false}
        title="t"
        body="b"
        confirmLabel="OK"
        cancelLabel="NO"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
