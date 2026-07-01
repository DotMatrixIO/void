// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const qrCodeSvgSpy = vi.fn();
vi.mock("qrcode.react", () => ({
  QRCodeSVG: (props: Record<string, unknown>) => {
    qrCodeSvgSpy(props);
    return <svg data-testid="qr-stub" data-value={String(props.value ?? "")} />;
  },
}));

import RoomShareSheet from "./RoomShareSheet";

const URL = "https://void.example/r/test-room";
const PHRASE = "abandon ability able about above absent";

function setupClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

function freezeNow(now: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

describe("RoomShareSheet expiry badge", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("does not render the LINK EXPIRES badge when no expiry is provided", () => {
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("LINK EXPIRES")).not.toBeInTheDocument();
  });

  it("does not render the LINK EXPIRES badge when expiresAtWallClock is null", () => {
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={null}
        tierLabel="STANDARD"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByText("LINK EXPIRES")).not.toBeInTheDocument();
  });

  it("renders the LINK EXPIRES badge with the tier label when expiry is provided", () => {
    freezeNow(new Date("2026-04-29T10:00:00"));

    const expiresAt = new Date("2026-04-29T10:30:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        tierLabel="STANDARD"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("LINK EXPIRES")).toBeInTheDocument();
    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(
      screen.getByText(`${expectedTime} · STANDARD`),
    ).toBeInTheDocument();
  });

  it("renders the LINK EXPIRES badge without a tier suffix when no tierLabel is given", () => {
    freezeNow(new Date("2026-04-29T10:00:00"));

    const expiresAt = new Date("2026-04-29T10:30:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("LINK EXPIRES")).toBeInTheDocument();
    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
  });
});

describe("RoomShareSheet expiry weekday prefix", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("omits the weekday prefix when expiry is on the same calendar day as now", () => {
    freezeNow(new Date("2026-04-29T08:00:00"));

    const expiresAt = new Date("2026-04-29T23:30:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        onClose={() => {}}
      />,
    );

    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const weekday = new Date(expiresAt).toLocaleDateString([], {
      weekday: "short",
    });
    expect(screen.getByText(expectedTime)).toBeInTheDocument();
    expect(
      screen.queryByText(`${weekday} ${expectedTime}`),
    ).not.toBeInTheDocument();
  });

  it("includes the weekday prefix when expiry is on a different calendar day from now", () => {
    freezeNow(new Date("2026-04-29T22:00:00"));

    const expiresAt = new Date("2026-04-30T09:15:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        tierLabel="DAY"
        onClose={() => {}}
      />,
    );

    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const weekday = new Date(expiresAt).toLocaleDateString([], {
      weekday: "short",
    });
    expect(
      screen.getByText(`${weekday} ${expectedTime} · DAY`),
    ).toBeInTheDocument();
  });
});

describe("RoomShareSheet COPY LINK clipboard payload", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes only the URL when no expiry is set", async () => {
    const user = userEvent.setup();
    const writeText = setupClipboard();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("writes only the URL when expiresAtWallClock is null even if a tier is provided", async () => {
    const user = userEvent.setup();
    const writeText = setupClipboard();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={null}
        tierLabel="STANDARD"
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it("appends an Expires line with tier suffix when expiry and tier are set", async () => {
    const user = userEvent.setup();
    freezeNow(new Date("2026-04-29T10:00:00"));
    const writeText = setupClipboard();
    const expiresAt = new Date("2026-04-29T10:30:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        tierLabel="STANDARD"
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(
      `${URL}\nExpires ${expectedTime} (STANDARD tier)`,
    );
  });

  it("appends an Expires line without tier suffix when only expiry is set", async () => {
    const user = userEvent.setup();
    freezeNow(new Date("2026-04-29T10:00:00"));
    const writeText = setupClipboard();
    const expiresAt = new Date("2026-04-29T11:45:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(writeText).toHaveBeenCalledWith(
      `${URL}\nExpires ${expectedTime}`,
    );
  });

  it("renders as a labelled dialog, focuses the first control on mount, and traps Tab", () => {
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        onClose={() => {}}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "room-share-sheet-title");
    expect(document.getElementById("room-share-sheet-title")).toHaveTextContent(
      "SCAN TO JOIN",
    );

    // First focusable inside the dialog is the Close (✕) button.
    const closeBtn = screen.getByRole("button", { name: /close/i });
    expect(closeBtn).toHaveFocus();

    // Tab from the last focusable cycles back to the first.
    const copyBtn = screen.getByRole("button", { name: /copy link/i });
    copyBtn.focus();
    expect(copyBtn).toHaveFocus();
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(closeBtn).toHaveFocus();
  });

  it("renders the clipboard-caution caption beneath COPY LINK and wires it to the button for assistive tech", () => {
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        onClose={() => {}}
      />,
    );

    // Exact substring mirrored from the lobby caption in PreviewGate
    // (task #373). The in-room share sheet writes the room URL to the
    // clipboard the same way the lobby's COPY writes the phrase, so a
    // host who shares from inside the room must see the same caveat
    // about older Android / in-app browsers and the QR escape hatch
    // (task #375). Drift here breaks parity with the lobby and the
    // test must fail.
    const caption = screen.getByText(
      /On older Android and many in-app browsers, other apps can read the clipboard\. QR doesn’t touch it\./,
    );
    expect(caption).toBeInTheDocument();

    const copyBtn = screen.getByRole("button", { name: /copy link/i });
    expect(copyBtn).toHaveAttribute("aria-describedby", caption.id);
    expect(caption.id).toBeTruthy();
  });

  it("renders the permanent fragment-leak caption beneath the share affordances (task #399)", () => {
    render(<RoomShareSheet url={URL} phrase={PHRASE} onClose={() => {}} />);
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
    expect(caption).toHaveAttribute("id", "room-share-sheet-fragment-caution");
  });

  it("renders the link-mangling caution so the host is warned before sharing a plain link (task #729)", () => {
    render(<RoomShareSheet url={URL} phrase={PHRASE} onClose={() => {}} />);
    // Exact wording pinned in scripts/check-required-literals.mjs. The guard
    // only proves the literal is in the file; this proves it actually renders
    // and is visible to the user (not stranded in a dead branch, an unmounted
    // element, or hidden by CSS).
    const caution = screen.getByText(
      /Some messengers and proxies \(Slack, LinkedIn\) can mangle the link\. Share the QR or read the six words aloud instead\./,
    );
    expect(caution).toBeVisible();
    expect(caution).toHaveAttribute("id", "room-share-sheet-channel-caution");
  });

  it("renders the readable join URL alongside the QR for parity with PhraseShareModal", () => {
    render(<RoomShareSheet url={URL} phrase={PHRASE} onClose={() => {}} />);

    // The readable join URL is shown in its own LINK block, mirroring
    // the PhraseShareModal layout (task #513). A host who prefers the
    // main share sheet should be able to read or dictate the URL
    // without having to copy it to the clipboard first.
    const linkNode = document.getElementById("room-share-sheet-join-url");
    expect(linkNode).not.toBeNull();
    expect(linkNode).toHaveTextContent(URL);
    expect(screen.getByText("Link")).toBeInTheDocument();
  });

  it("encodes the join URL into the QR using the same encoding the phrase modal uses", () => {
    qrCodeSvgSpy.mockClear();
    render(<RoomShareSheet url={URL} phrase={PHRASE} onClose={() => {}} />);
    // Asserts the component passes the URL through to QRCodeSVG with
    // the same error-correction level the phrase modal uses ("M").
    // Drift here breaks parity between the two share surfaces.
    expect(qrCodeSvgSpy).toHaveBeenCalled();
    const props = qrCodeSvgSpy.mock.calls[0][0];
    expect(props.value).toBe(URL);
    expect(props.level).toBe("M");
  });

  it("invokes onClose on Escape via the focus trap", () => {
    const onClose = vi.fn();
    render(<RoomShareSheet url={URL} phrase={PHRASE} onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("includes the weekday prefix in the clipboard Expires line for cross-day expiry", async () => {
    const user = userEvent.setup();
    freezeNow(new Date("2026-04-29T22:00:00"));
    const writeText = setupClipboard();
    const expiresAt = new Date("2026-04-30T09:15:00").getTime();
    render(
      <RoomShareSheet
        url={URL}
        phrase={PHRASE}
        expiresAtWallClock={expiresAt}
        tierLabel="DAY"
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: /copy link/i }));

    const expectedTime = new Date(expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const weekday = new Date(expiresAt).toLocaleDateString([], {
      weekday: "short",
    });
    expect(writeText).toHaveBeenCalledWith(
      `${URL}\nExpires ${weekday} ${expectedTime} (DAY tier)`,
    );
  });
});
