// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Bip39PhraseGrid, { findFuzzyMatches } from "./Bip39PhraseGrid";

function Harness({
  initial,
  onSubmit,
  slotCount = 6,
  autoFocus = false,
  onPasteDistributed,
}: {
  initial?: string[];
  onSubmit?: () => void;
  slotCount?: number;
  autoFocus?: boolean;
  onPasteDistributed?: () => void;
}) {
  const [words, setWords] = useState<string[]>(
    initial ?? Array(slotCount).fill(""),
  );
  return (
    <Bip39PhraseGrid
      words={words}
      onChange={setWords}
      onSubmit={onSubmit}
      slotCount={slotCount}
      autoFocus={autoFocus}
      onPasteDistributed={onPasteDistributed}
    />
  );
}

function getSlot(idx: number): HTMLInputElement {
  return screen.getByRole("textbox", { name: `word ${idx + 1}` }) as HTMLInputElement;
}

describe("Bip39PhraseGrid autocomplete", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("narrows the suggestion list to a single word for a 4-char unique prefix", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("abil");

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("ability");
  });

  it("Tab accepts the highlighted suggestion and advances focus to the next slot", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("abil");
    await user.keyboard("{Tab}");

    expect(getSlot(0).value).toBe("ability");
    expect(document.activeElement).toBe(getSlot(1));
  });

  it("Enter accepts the highlighted suggestion and advances focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("abil");
    await user.keyboard("{Enter}");

    expect(getSlot(0).value).toBe("ability");
    expect(document.activeElement).toBe(getSlot(1));
  });

  it("ArrowDown moves the active highlight in the suggestion list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("ab");

    const optionsBefore = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(optionsBefore.length).toBeGreaterThan(1);
    expect(optionsBefore[0]).toHaveAttribute("aria-selected", "true");
    expect(optionsBefore[1]).toHaveAttribute("aria-selected", "false");

    await user.keyboard("{ArrowDown}");

    const optionsAfter = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(optionsAfter[0]).toHaveAttribute("aria-selected", "false");
    expect(optionsAfter[1]).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Enter}");
    expect(getSlot(0).value).toBe(optionsAfter[1].textContent);
  });

  it("ArrowUp wraps to the bottom of the suggestion list", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("ab");

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    await user.keyboard("{ArrowUp}");

    const after = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(after[options.length - 1]).toHaveAttribute("aria-selected", "true");
  });

  it("Escape closes the suggestion dropdown without changing the slot", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("abi");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(getSlot(0).value).toBe("abi");
  });

  it("pasting a 6-word phrase into any slot fills all six slots", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot3 = getSlot(2);
    await user.click(slot3);

    const phrase = "ability about above absent absorb abstract";
    await user.paste(phrase);

    expect(getSlot(0).value).toBe("ability");
    expect(getSlot(1).value).toBe("about");
    expect(getSlot(2).value).toBe("above");
    expect(getSlot(3).value).toBe("absent");
    expect(getSlot(4).value).toBe("absorb");
    expect(getSlot(5).value).toBe("abstract");
  });

  it("pasting a multi-word fragment distributes from the focused slot forward", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot2 = getSlot(1);
    await user.click(slot2);
    await user.paste("about above absent");

    expect(getSlot(0).value).toBe("");
    expect(getSlot(1).value).toBe("about");
    expect(getSlot(2).value).toBe("above");
    expect(getSlot(3).value).toBe("absent");
    expect(getSlot(4).value).toBe("");
  });

  it("marks an unknown word with aria-invalid and a wavy underline", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("zzzzz");
    await user.tab();

    expect(slot1).toHaveAttribute("aria-invalid", "true");
    expect(slot1.style.textDecoration).toContain("wavy");
  });

  it("calls onSubmit when Enter is pressed on the last slot with no open suggestions", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Harness
        initial={["abandon", "ability", "able", "about", "above", "absent"]}
        onSubmit={onSubmit}
      />,
    );

    const last = getSlot(5);
    await user.click(last);
    await user.keyboard("{Escape}");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("space advances to the next slot when the dropdown is closed", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["abandon", "", "", "", "", ""]} />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("{Escape}");
    await user.keyboard(" ");

    expect(document.activeElement).toBe(getSlot(1));
    expect(getSlot(0).value).toBe("abandon");
  });

  it("backspace on an empty slot moves focus back to the previous slot", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["abandon", "", "", "", "", ""]} />);
    const slot2 = getSlot(1);
    await user.click(slot2);
    await user.keyboard("{Backspace}");

    expect(document.activeElement).toBe(getSlot(0));
  });
});

describe("Bip39PhraseGrid mobile sanitization (Task #405)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("typing ABANDON then space lowercases slot 1 and advances focus to slot 2", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("ABANDON");
    await user.keyboard("{Escape}");
    await user.keyboard(" ");

    expect(getSlot(0).value).toBe("abandon");
    expect(document.activeElement).toBe(getSlot(1));
  });

  it("typing 'abandon ability' letter-by-letter distributes across two slots (no concat)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abandon");
    await user.keyboard("{Escape}");
    await user.keyboard(" ");
    await user.keyboard("ability");

    expect(getSlot(0).value).toBe("abandon");
    expect(getSlot(1).value).toBe("ability");
  });

  it("pasting a capitalized single word into a slot lowercases it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.paste("Abandon");

    expect(getSlot(0).value).toBe("abandon");
  });

  it("pasting 'abandon ability' into slot 1 distributes to slots 1-2", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.paste("abandon ability");

    expect(getSlot(0).value).toBe("abandon");
    expect(getSlot(1).value).toBe("ability");
  });

  it("pasting 'abandon\u2014ability' (em-dash) distributes across two slots", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.paste("abandon\u2014ability");

    expect(getSlot(0).value).toBe("abandon");
    expect(getSlot(1).value).toBe("ability");
  });

  it("pasting with trailing whitespace (single word) trims and lowercases", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.paste("ABANDON ");

    expect(getSlot(0).value).toBe("abandon");
  });
});

describe("Bip39PhraseGrid onPasteDistributed callback (Task #250)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("fires onPasteDistributed when a multi-word phrase is pasted", async () => {
    const user = userEvent.setup();
    const onPasteDistributed = vi.fn();
    render(<Harness onPasteDistributed={onPasteDistributed} />);

    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    expect(onPasteDistributed).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPasteDistributed for a single-word paste", async () => {
    const user = userEvent.setup();
    const onPasteDistributed = vi.fn();
    render(<Harness onPasteDistributed={onPasteDistributed} />);

    await user.click(getSlot(0));
    await user.paste("ability");

    expect(onPasteDistributed).not.toHaveBeenCalled();
  });

  it("does not fire onPasteDistributed for an empty paste", async () => {
    const user = userEvent.setup();
    const onPasteDistributed = vi.fn();
    render(<Harness onPasteDistributed={onPasteDistributed} />);

    await user.click(getSlot(0));
    await user.paste("");

    expect(onPasteDistributed).not.toHaveBeenCalled();
  });

  it("fires onPasteDistributed once per paste event, not once per word", async () => {
    const user = userEvent.setup();
    const onPasteDistributed = vi.fn();
    render(<Harness onPasteDistributed={onPasteDistributed} />);

    await user.click(getSlot(0));
    await user.paste("ability about above");
    await user.paste("absent absorb abstract");

    // Two separate paste events → exactly two callback fires.
    expect(onPasteDistributed).toHaveBeenCalledTimes(2);
  });
});

describe("Bip39PhraseGrid fuzzy 'did you mean' suggestions", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("findFuzzyMatches returns BIP39 words within edit distance 2", () => {
    expect(findFuzzyMatches("abilty")).toContain("ability");
    expect(findFuzzyMatches("ablity")).toContain("ability");
    expect(findFuzzyMatches("abandn")).toContain("abandon");
  });

  it("findFuzzyMatches excludes words farther than the threshold", () => {
    expect(findFuzzyMatches("zzzzz")).toEqual([]);
  });

  it("findFuzzyMatches never returns the input word itself", () => {
    expect(findFuzzyMatches("ability")).not.toContain("ability");
  });

  it("offers fuzzy suggestions when an unknown word has no prefix matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const slot1 = getSlot(0);
    await user.click(slot1);
    await user.keyboard("abilty");

    const listbox = screen.getByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    const words = options.map((o) => o.textContent);
    expect(words).toContain("ability");
  });

  it("labels fuzzy suggestions with a 'did you mean…?' header", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abilty");

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText(/did you mean/i)).toBeTruthy();
  });

  it("does not show the 'did you mean…?' header for prefix completions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abil");

    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryByText(/did you mean/i)).toBeNull();
    const options = within(listbox).getAllByRole("option");
    for (const opt of options) {
      expect(opt.getAttribute("data-suggestion-kind")).toBe("prefix");
    }
  });

  it("accepting a fuzzy suggestion replaces the typo and advances focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abilty");
    await user.keyboard("{Enter}");

    expect(getSlot(0).value).toBe("ability");
    expect(document.activeElement).toBe(getSlot(1));
  });
});

describe("Bip39PhraseGrid 'not a recovery word' hint", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("shows the hint when the typed word has no prefix or fuzzy matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("zzzzz");
    await user.tab();

    expect(screen.getByRole("alert")).toHaveTextContent(/not a recovery word/i);
  });

  it("does not show the hint for a valid BIP39 word", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["ability", "", "", "", "", ""]} />);
    await user.click(getSlot(1));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not show the hint for an empty slot", async () => {
    render(<Harness />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not show the hint when there are prefix suggestions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abil");
    await user.tab();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not show the hint when there are fuzzy suggestions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("abilty");
    await user.tab();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("hint disappears once the user types something that produces suggestions", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(getSlot(0));
    await user.keyboard("zzzzz");
    await user.tab();

    expect(screen.getByRole("alert")).toBeInTheDocument();

    await user.tripleClick(getSlot(0));
    await user.keyboard("abil");

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
