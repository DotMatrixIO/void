// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DropSlot } from "./DropSlot";

beforeEach(() => {
  // Default the persisted state to "collapsed" so tests start from a
  // known compact baseline. Individual tests that need the expanded
  // editor click the compact bar (which is itself the expand
  // affordance) first.
  window.sessionStorage.clear();
});

function expand() {
  fireEvent.click(screen.getByTestId("drop-slot"));
}

describe("DropSlot", () => {
  it("renders the empty placeholder when value is empty", () => {
    render(<DropSlot value="" onSubmit={() => {}} screenShareActive={false} />);
    expect(screen.getByTestId("drop-slot-value")).toHaveTextContent("(empty)");
  });

  it("renders the value as React text (no HTML injection)", () => {
    render(
      <DropSlot
        value={"<script>alert(1)</script>"}
        onSubmit={() => {}}
        screenShareActive={false}
      />,
    );
    const slot = screen.getByTestId("drop-slot-value");
    expect(slot.textContent).toBe("<script>alert(1)</script>");
    // No actual script element rendered.
    expect(slot.querySelector("script")).toBeNull();
  });

  it("the slot is announced via aria-live", () => {
    render(<DropSlot value="hello" onSubmit={() => {}} screenShareActive={false} />);
    const slot = screen.getByTestId("drop-slot-value");
    expect(slot.getAttribute("aria-live")).toBe("polite");
    expect(slot.getAttribute("role")).toBe("status");
  });

  it("defaults to compact mode where the bar itself is the expand affordance", () => {
    render(<DropSlot value="" onSubmit={() => {}} screenShareActive={false} />);
    const slot = screen.getByTestId("drop-slot");
    expect(slot.getAttribute("data-mode")).toBe("compact");
    // The compact bar is the click target — role=button, focusable, and
    // there is no separate EXPAND button.
    expect(slot.getAttribute("role")).toBe("button");
    expect(slot.getAttribute("tabindex")).toBe("0");
    expect(screen.queryByTestId("drop-slot-expand")).toBeNull();
    // The full editor is not mounted while collapsed.
    expect(screen.queryByTestId("drop-slot-input")).toBeNull();
  });

  it("expands when the compact bar is clicked and reveals the editor", () => {
    render(<DropSlot value="" onSubmit={() => {}} screenShareActive={false} />);
    expand();
    expect(screen.getByTestId("drop-slot").getAttribute("data-mode")).toBe(
      "expanded",
    );
    expect(screen.getByTestId("drop-slot-input")).toBeInTheDocument();
    expect(screen.getByTestId("drop-slot-collapse")).toBeInTheDocument();
  });

  it("collapse button returns to compact mode", () => {
    render(<DropSlot value="hi" onSubmit={() => {}} screenShareActive={false} />);
    expand();
    fireEvent.click(screen.getByTestId("drop-slot-collapse"));
    expect(screen.getByTestId("drop-slot").getAttribute("data-mode")).toBe(
      "compact",
    );
    expect(screen.queryByTestId("drop-slot-input")).toBeNull();
  });

  it("expanded/collapsed preference is persisted across renders via sessionStorage", () => {
    const first = render(
      <DropSlot value="" onSubmit={() => {}} screenShareActive={false} />,
    );
    expand();
    expect(window.sessionStorage.getItem("void_drop_slot_expanded")).toBe("1");
    first.unmount();

    render(<DropSlot value="" onSubmit={() => {}} screenShareActive={false} />);
    // Fresh render should remember the expanded preference.
    expect(screen.getByTestId("drop-slot").getAttribute("data-mode")).toBe(
      "expanded",
    );

    fireEvent.click(screen.getByTestId("drop-slot-collapse"));
    expect(window.sessionStorage.getItem("void_drop_slot_expanded")).toBeNull();
  });

  it("submits the sanitized draft on Enter and clears input", () => {
    const onSubmit = vi.fn();
    render(<DropSlot value="" onSubmit={onSubmit} screenShareActive={false} />);
    expand();
    const ta = screen.getByTestId("drop-slot-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "hello\u200Bworld" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("helloworld");
    expect(ta.value).toBe("");
    expect(screen.getByTestId("drop-slot-hint").textContent).toMatch(
      /invisible characters/i,
    );
  });

  it("Shift+Enter does not submit", () => {
    const onSubmit = vi.fn();
    render(<DropSlot value="" onSubmit={onSubmit} screenShareActive={false} />);
    expand();
    const ta = screen.getByTestId("drop-slot-input") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "line1" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("paste reads text/plain only and submits atomically", () => {
    const onSubmit = vi.fn();
    render(<DropSlot value="" onSubmit={onSubmit} screenShareActive={false} />);
    expand();
    const ta = screen.getByTestId("drop-slot-input") as HTMLTextAreaElement;
    const clipboardData = {
      getData: (mime: string) =>
        mime === "text/plain" ? "pasted https://example.com" : "<b>nope</b>",
    };
    fireEvent.paste(ta, { clipboardData });
    expect(onSubmit).toHaveBeenCalledWith("pasted https://example.com");
  });

  it("replaces the input with [DISABLED DURING SCREEN SHARE] while presenting", () => {
    const onSubmit = vi.fn();
    render(
      <DropSlot value="incoming" onSubmit={onSubmit} screenShareActive={true} />,
    );
    expand();
    expect(screen.queryByTestId("drop-slot-input")).toBeNull();
    expect(screen.getByTestId("drop-slot-disabled")).toHaveTextContent(
      "[DISABLED DURING SCREEN SHARE]",
    );
    // Incoming slot still renders.
    expect(screen.getByTestId("drop-slot-value")).toHaveTextContent("incoming");
  });

  it("compact mode still renders the incoming value, truncated to one line", () => {
    render(
      <DropSlot
        value="a very long incoming value that should appear on the compact bar"
        onSubmit={() => {}}
        screenShareActive={false}
      />,
    );
    const slot = screen.getByTestId("drop-slot");
    expect(slot.getAttribute("data-mode")).toBe("compact");
    expect(screen.getByTestId("drop-slot-value")).toHaveTextContent(
      "a very long incoming value",
    );
  });
});
