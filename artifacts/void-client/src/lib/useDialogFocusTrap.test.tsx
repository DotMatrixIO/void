// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useDialogFocusTrap } from "./useDialogFocusTrap";

function Harness({
  initialOpen = true,
  onEscape,
}: {
  initialOpen?: boolean;
  onEscape?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const ref = useDialogFocusTrap<HTMLDivElement>({
    active: open,
    onEscape: onEscape ?? (() => setOpen(false)),
  });
  return (
    <>
      <button data-testid="outside-before">before</button>
      {open && (
        <div ref={ref} role="dialog" aria-label="harness" data-testid="dialog">
          <button data-testid="first">first</button>
          <button data-testid="second">second</button>
          <button data-testid="last">last</button>
        </div>
      )}
      <button data-testid="outside-after">after</button>
    </>
  );
}

describe("useDialogFocusTrap", () => {
  it("focuses the first focusable inside the dialog on mount", () => {
    render(<Harness />);
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("calls onEscape when Escape is pressed", async () => {
    let escaped = 0;
    const user = userEvent.setup();
    render(<Harness onEscape={() => { escaped += 1; }} />);
    await user.keyboard("{Escape}");
    expect(escaped).toBe(1);
  });

  it("wraps Tab from the last focusable back to the first", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByTestId("last").focus();
    await user.tab();
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable back to the last", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByTestId("first").focus();
    await user.tab({ shift: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("restores focus to the previously-focused element when the dialog closes", async () => {
    function OpenCloseHarness() {
      const [open, setOpen] = useState(false);
      const ref = useDialogFocusTrap<HTMLDivElement>({
        active: open,
        onEscape: () => setOpen(false),
      });
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            open
          </button>
          {open && (
            <div ref={ref} role="dialog" aria-label="harness" data-testid="dialog">
              <button data-testid="first">first</button>
              <button data-testid="last">last</button>
            </div>
          )}
        </>
      );
    }

    const user = userEvent.setup();
    render(<OpenCloseHarness />);

    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    // After opening, focus should jump into the dialog.
    expect(screen.getByTestId("first")).toHaveFocus();

    await user.keyboard("{Escape}");
    // After closing, focus should return to the trigger that opened it.
    expect(trigger).toHaveFocus();
  });

  it("is a no-op when active is false", () => {
    function InertHarness() {
      const ref = useDialogFocusTrap<HTMLDivElement>({ active: false });
      return (
        <>
          <button data-testid="outside">outside</button>
          <div ref={ref} role="dialog" aria-label="inert">
            <button data-testid="inside">inside</button>
          </div>
        </>
      );
    }
    render(<InertHarness />);
    // Nothing inside the dialog should have grabbed focus on mount.
    expect(screen.getByTestId("inside")).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });
});
