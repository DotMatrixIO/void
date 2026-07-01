// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
}));

import PhraseShareModal from "./PhraseShareModal";

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const TEST_PHRASE = "ability about above absent absorb abstract";
const TEST_JOIN_URL =
  "https://void.example.com/#ability-about-above-absent-absorb-abstract";

function setupClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

describe("PhraseShareModal contents", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the room phrase and a QR <svg> that encodes the join URL", () => {
    const { container } = render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    // The phrase is shown verbatim so the host can read it off-screen
    // even if the QR scan fails.
    expect(screen.getByText(TEST_PHRASE)).toBeInTheDocument();

    // The QR must encode the full join URL (so a normal camera scan
    // opens the call), not the bare phrase.
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.children.length).toBeGreaterThan(0);
    // qrcode.react serializes its `value` prop directly into a parent
    // wrapper's data attribute, but a stable check is to render two
    // QRs (one with the phrase, one with the URL) and ensure the
    // modal's QR matches the URL one, not the phrase one. As a lighter
    // assertion, we ensure the prop wiring is present by re-rendering
    // with a known marker URL and checking the path geometry differs
    // from the bare-phrase rendering.
  });

  it("passes the joinUrl prop straight through to the on-screen QR (different from a bare-phrase QR)", () => {
    const { container: urlContainer } = render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );
    const urlSvg = urlContainer.querySelector("svg")!.outerHTML;

    const { container: phraseContainer } = render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_PHRASE}
        onClose={vi.fn()}
      />,
    );
    const phraseSvg = phraseContainer.querySelector("svg")!.outerHTML;

    // Different QR `value` inputs produce different rendered geometry —
    // proves the modal's QR is wired to `joinUrl`, not to `phrase`.
    expect(urlSvg).not.toBe(phraseSvg);
  });

  it("exposes the dialog with an aria-modal role for accessibility", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("renders the permanent fragment-leak caption beneath the share affordances (task #399)", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    // Exact wording pinned in scripts/check-required-literals.mjs. Drift here
    // softens the warning the host sees at the decision point.
    const caption = screen.getByText(
      /Phrase travels in the URL\. Anything that reads the URL — browser sync, history, extensions — reads the phrase\./,
    );
    // toBeVisible (not just toBeInTheDocument) so a future CSS change that
    // hides the caution — display:none, visibility:hidden, hidden attr — is
    // caught: the task is specifically about user-visibility, not mere
    // presence in the DOM.
    expect(caption).toBeVisible();
    // The check-required-literals guard only verifies the literal exists in
    // the source. This binds the rendered, user-visible text to the
    // literal-pinned element id so a refactor that leaves the string in a
    // dead branch (never mounted) fails here even while the guard passes.
    expect(caption).toHaveAttribute("id", "phrase-share-modal-fragment-caution");
  });

  it("renders the link-mangling caution so the host is warned before sharing a plain link (task #729)", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    // Exact wording pinned in scripts/check-required-literals.mjs. The guard
    // only proves the literal is in the file; this proves it actually renders
    // and is visible to the user (not stranded in a dead branch, an unmounted
    // element, or hidden by CSS).
    const caution = screen.getByText(
      /Some messengers and proxies \(Slack, LinkedIn\) can mangle the link\. Share the QR or read the six words aloud instead\./,
    );
    expect(caution).toBeVisible();
    expect(caution).toHaveAttribute("id", "phrase-share-modal-channel-caution");
  });

  it("renders the clipboard-caution caption wired to the COPY button (task #382)", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    // Literal-identical to the lobby (PreviewGate, task #373) and the in-room
    // share sheet (RoomShareSheet, task #375). The modal's COPY button writes
    // the phrase to the clipboard the same way, so a host who copies from here
    // must see the same caveat about older Android / in-app browsers and the
    // QR escape hatch. Drift breaks parity across the three surfaces.
    const caption = screen.getByText(
      /On older Android and many in-app browsers, other apps can read the clipboard\. QR doesn’t touch it\./,
    );
    expect(caption).toBeVisible();
    expect(caption).toHaveAttribute("id", "phrase-share-modal-copy-caution");

    // The caption is announced as part of the COPY button's description.
    const copyBtn = screen.getByRole("button", { name: /^copy$/i });
    expect(copyBtn).toHaveAttribute("aria-describedby", caption.id);
    expect(caption.id).toBeTruthy();
  });

  it("labels the dialog via aria-labelledby pointing at the ROOM PHRASE heading", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute(
      "aria-labelledby",
      "phrase-share-modal-title",
    );
    expect(
      document.getElementById("phrase-share-modal-title"),
    ).toHaveTextContent("ROOM PHRASE");
  });

  it("focuses the first control on mount and traps Tab inside the dialog", () => {
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);
    // First focusable inside the dialog is the ✕ Close button.
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toHaveFocus();

    // Tab from the last focusable cycles back to the first.
    const printBtn = screen.getByRole("button", { name: /^print$/i });
    printBtn.focus();
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(closeBtn).toHaveFocus();
  });
});

describe("PhraseShareModal COPY action", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the phrase to the clipboard when COPY is clicked", async () => {
    const user = userEvent.setup();
    const writeText = setupClipboard();
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(TEST_PHRASE);
  });

  it("flips the COPY label to 'COPIED ✓' after a successful clipboard write and reverts after the timeout", async () => {
    // Fake only the timer primitives — leaving microtask APIs alone so the
    // awaited clipboard.writeText promise can settle and React can flush
    // the state update that flips the label.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    setupClipboard();
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);

    const copyBtn = screen.getByRole("button", { name: /^copy$/i });
    expect(copyBtn).toHaveTextContent(/^COPY$/);

    fireEvent.click(copyBtn);
    await flushMicrotasks();

    expect(copyBtn).toHaveTextContent(/COPIED ✓/);

    // Just before the 2s timeout the label should still read COPIED ✓.
    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(copyBtn).toHaveTextContent(/COPIED ✓/);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(copyBtn).toHaveTextContent(/^COPY$/);
  });

  it("does not throw and does not flip the label when the clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^copy$/i }));

    // Label remains COPY; no "COPIED" affordance ever appeared.
    expect(screen.getByRole("button", { name: /^copy$/i })).toHaveTextContent(
      /^COPY$/,
    );
    expect(screen.queryByRole("button", { name: /^COPIED ✓$/i })).toBeNull();
  });
});

describe("PhraseShareModal join URL display + COPY LINK action", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the join URL as readable text alongside the QR so the host can paste it", () => {
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );
    const urlEl = document.getElementById("phrase-share-modal-join-url");
    expect(urlEl).not.toBeNull();
    expect(urlEl).toHaveTextContent(TEST_JOIN_URL);
  });

  it("writes the join URL to the clipboard when COPY LINK is clicked (and leaves the phrase COPY untouched)", async () => {
    const user = userEvent.setup();
    const writeText = setupClipboard();
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^copy link$/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(TEST_JOIN_URL);

    // The bare-phrase COPY button must NOT have flipped its label — the two
    // copy affordances track independent state.
    expect(screen.getByRole("button", { name: /^copy$/i })).toHaveTextContent(
      /^COPY$/,
    );
  });

  it("flips the COPY LINK label to 'LINK COPIED ✓' after a successful clipboard write and reverts after the timeout", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    setupClipboard();
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    const linkBtn = screen.getByRole("button", { name: /^copy link$/i });
    expect(linkBtn).toHaveTextContent(/^COPY LINK$/);

    fireEvent.click(linkBtn);
    await flushMicrotasks();

    expect(linkBtn).toHaveTextContent(/LINK COPIED ✓/);

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(linkBtn).toHaveTextContent(/LINK COPIED ✓/);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(linkBtn).toHaveTextContent(/^COPY LINK$/);
  });

  it("does not throw and does not flip the label when the clipboard API is unavailable", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^copy link$/i }));

    expect(
      screen.getByRole("button", { name: /^copy link$/i }),
    ).toHaveTextContent(/^COPY LINK$/);
    expect(screen.queryByRole("button", { name: /LINK COPIED ✓/i })).toBeNull();
  });
});

// A phrase that contains every HTML-special character so the escapeHtml path is exercised.
const HTML_PHRASE = 'word <b> & "quote" it\'s done';
const HTML_PHRASE_ESCAPED = "word &lt;b&gt; &amp; &quot;quote&quot; it&#39;s done";

describe("PhraseShareModal PRINT action", () => {
  it("opens a popup window and writes the escaped phrase, QR svg, and auto-print script into it", () => {
    // Build a fake popup document that accumulates written chunks.
    let written = "";
    const fakeDoc = {
      write: vi.fn((chunk: string) => { written += chunk; }),
      close: vi.fn(),
    };
    const fakeWindow = { document: fakeDoc };
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakeWindow as unknown as Window);

    const { container } = render(
      <PhraseShareModal phrase={HTML_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^print$/i }));

    // window.open must have been called once with the right signature.
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("", "_blank", expect.stringContaining("width="));

    // document.write must have received content and document.close must have been called.
    expect(fakeDoc.write).toHaveBeenCalled();
    expect(fakeDoc.close).toHaveBeenCalledTimes(1);

    // The phrase must appear HTML-escaped — raw special chars must NOT be present.
    expect(written).toContain(HTML_PHRASE_ESCAPED);
    expect(written).not.toContain(HTML_PHRASE);

    // The inline QR <svg> rendered by qrcode.react must appear in the print document.
    const svgEl = container.querySelector("svg");
    expect(svgEl).not.toBeNull();
    expect(written).toContain("<svg");

    // The auto-print bootstrap script must be present so the browser print dialog
    // fires automatically when the popup loads.
    expect(written).toContain("window.print()");

    openSpy.mockRestore();
  });

  it("is a no-op and does not write to a document when window.open returns null (popup blocked)", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    // Provide a fake window at the global level so that if the guard ever regresses
    // and tries to write despite a null popup, we can catch it.
    const writeSpy = vi.fn();
    const origWrite = document.write.bind(document);
    document.write = writeSpy;

    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={vi.fn()} />);

    // Clicking PRINT when the popup is blocked must not throw.
    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: /^print$/i }));
    }).not.toThrow();

    // No document.write should have been attempted on any document.
    expect(writeSpy).not.toHaveBeenCalled();

    document.write = origWrite;
    openSpy.mockRestore();
  });
});

describe("PhraseShareModal SHARE VIA… action (native share sheet)", () => {
  function enableNativeShare(shareImpl: typeof navigator.share) {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: shareImpl,
    });
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 0,
    });
    // Remove the share shim so unrelated tests see a desktop-like navigator.
    delete (navigator as { share?: unknown }).share;
  });

  it("hides the SHARE VIA… button on desktop / where navigator.share is unavailable", () => {
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /share via/i }),
    ).toBeNull();
  });

  it("shows the SHARE VIA… button and calls navigator.share with the join URL on touch devices", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    enableNativeShare(share);

    const user = userEvent.setup();
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    const shareBtn = screen.getByRole("button", { name: /^share via…$/i });
    await user.click(shareBtn);

    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: TEST_JOIN_URL }),
    );
  });

  it("flips the label to 'SHARED ✓' after a successful share and reverts after the timeout", async () => {
    enableNativeShare(vi.fn().mockResolvedValue(undefined));
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    const shareBtn = screen.getByRole("button", { name: /^share via…$/i });
    fireEvent.click(shareBtn);
    await flushMicrotasks();

    expect(shareBtn).toHaveTextContent(/SHARED ✓/);

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(shareBtn).toHaveTextContent(/SHARED ✓/);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(shareBtn).toHaveTextContent(/^SHARE VIA…$/);
  });

  it("does not flip the label when the host dismisses the share sheet (AbortError)", async () => {
    const abort = vi
      .fn()
      .mockRejectedValue(new DOMException("dismissed", "AbortError"));
    enableNativeShare(abort);

    const user = userEvent.setup();
    render(
      <PhraseShareModal
        phrase={TEST_PHRASE}
        joinUrl={TEST_JOIN_URL}
        onClose={vi.fn()}
      />,
    );

    const shareBtn = screen.getByRole("button", { name: /^share via…$/i });
    await user.click(shareBtn);
    await flushMicrotasks();

    expect(abort).toHaveBeenCalledTimes(1);
    expect(shareBtn).toHaveTextContent(/^SHARE VIA…$/);
  });
});

describe("PhraseShareModal close affordances", () => {
  it("invokes onClose when the close (✕) button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes onClose when the host presses Escape", () => {
    const onClose = vi.fn();
    render(<PhraseShareModal phrase={TEST_PHRASE} joinUrl={TEST_JOIN_URL} onClose={onClose} />);

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
