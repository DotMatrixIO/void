// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expectNoAxeViolations } from "@/test/axe";
import { ONION_BACKGROUND_REPROBE_THRESHOLD_MS } from "@/lib/onionReachability";

vi.mock("@/lib/socket", () => ({
  getSocket: vi.fn(() => ({
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/sounds", () => ({
  playClick: vi.fn(),
  resumeAudio: vi.fn(),
}));

vi.mock("@/components/HamburgerMenu", () => ({
  default: () => null,
}));

vi.mock("@/components/PaywallModal", () => ({
  default: () => null,
}));

import StartScreen from "./StartScreen";

function getSlot(idx: number): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: `word ${idx + 1}`,
  }) as HTMLInputElement;
}

describe("StartScreen join flow", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("calls onJoinRoom with the derived credentials when a valid 6-word phrase is submitted", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();
    render(<StartScreen onJoinRoom={onJoinRoom} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    const phrase = "ability about above absent absorb abstract";
    await user.click(getSlot(0));
    await user.paste(phrase);

    expect(getSlot(0).value).toBe("ability");
    expect(getSlot(5).value).toBe("abstract");

    await user.click(screen.getByRole("button", { name: /^JOIN$/i }));

    await vi.waitFor(() => {
      expect(onJoinRoom).toHaveBeenCalledTimes(1);
    });

    const args = onJoinRoom.mock.calls[0];
    expect(typeof args[0]).toBe("string");
    expect(args[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(args[1]).toBeInstanceOf(CryptoKey);
    expect(args[2]).toBe(phrase);
    expect(args[3]).toBe(false);
  });

  it("shows the unknown-word marker but keeps the JOIN button enabled", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();
    render(<StartScreen onJoinRoom={onJoinRoom} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    await user.click(getSlot(0));
    await user.keyboard("zzzzz");
    await user.tab();

    expect(getSlot(0)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/NOT IN BIP39 LIST/i)).toBeInTheDocument();

    const joinBtn = screen.getByRole("button", { name: /^JOIN$/i }) as HTMLButtonElement;
    expect(joinBtn.disabled).toBe(false);
  });

  it("shows an inline error and does not call onJoinRoom when the phrase is invalid", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();
    render(<StartScreen onJoinRoom={onJoinRoom} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(screen.getByRole("button", { name: /^JOIN$/i }));

    expect(
      await screen.findByText(/INVALID PHRASE — NEED 6 BIP39 WORDS/i),
    ).toBeInTheDocument();
    expect(onJoinRoom).not.toHaveBeenCalled();
  });
});

function getRecoverySlot(idx: number): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: `recovery word ${idx + 1}`,
  }) as HTMLInputElement;
}

describe("StartScreen paste-the-whole-phrase shortcut (Task #413)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("distributes a pasted 6-word phrase across the grid and clears the shortcut field", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    const bulk = screen.getByRole("textbox", {
      name: /paste the whole phrase/i,
    }) as HTMLInputElement;
    await user.click(bulk);
    await user.paste("ability about above absent absorb abstract");

    expect(getSlot(0).value).toBe("ability");
    expect(getSlot(1).value).toBe("about");
    expect(getSlot(2).value).toBe("above");
    expect(getSlot(3).value).toBe("absent");
    expect(getSlot(4).value).toBe("absorb");
    expect(getSlot(5).value).toBe("abstract");
    expect(bulk.value).toBe("");
    // Exactly six words is not an overflow — no hint should appear.
    expect(
      screen.queryByText(/only the first 6 words were used/i),
    ).not.toBeInTheDocument();
  });

  it("splits on the same separator class as the grid (mixed whitespace, dashes, em/en dashes, underscores)", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    const bulk = screen.getByRole("textbox", {
      name: /paste the whole phrase/i,
    }) as HTMLInputElement;
    await user.click(bulk);
    await user.paste("Ability-about_above\u2014absent\u2013absorb abstract");

    expect(getSlot(0).value).toBe("ability");
    expect(getSlot(5).value).toBe("abstract");
    expect(bulk.value).toBe("");
  });

  it("drops tokens beyond the 6th and surfaces a friendly hint", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    const bulk = screen.getByRole("textbox", {
      name: /paste the whole phrase/i,
    }) as HTMLInputElement;
    // Dispatch the paste directly on `bulk` instead of `user.click(bulk)` +
    // `user.paste(...)`: entering join mode arms a 50ms autofocus timer for
    // the first grid slot, and `user.paste` targets `document.activeElement`.
    // Under full-suite parallel load that macrotask can fire between the
    // click and the paste, stealing focus to the grid slot so the paste lands
    // there — the overflow path never runs and the hint never appears.
    // Targeting `bulk` makes the paste focus-independent and deterministic,
    // mirroring the sibling test below.
    fireEvent.paste(bulk, {
      clipboardData: {
        getData: () =>
          "ability about above absent absorb abstract extra surplus",
      },
    });

    // findByText waits for React to flush the paste-driven state update
    // instead of racing it under parallel load.
    expect(
      await screen.findByText(/only the first 6 words were used/i),
    ).toBeInTheDocument();
    expect(getSlot(0).value).toBe("ability");
    expect(getSlot(5).value).toBe("abstract");
    expect(bulk.value).toBe("");
  });

  it("keeps the overflow hint after the paste itself, then clears it once the user edits the field", async () => {
    // Regression: the paste handler sets the hint while also clearing the
    // field. The hint must survive that programmatic clear (it must not be
    // wiped by a stray onChange) and only disappear on a genuine user edit.
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    const bulk = screen.getByRole("textbox", {
      name: /paste the whole phrase/i,
    }) as HTMLInputElement;
    // Dispatch the paste directly on `bulk` rather than `user.click(bulk)` +
    // `user.paste(...)`: entering join mode arms a 50ms autofocus timer for the
    // first grid slot, and `user.paste` targets `document.activeElement`. Under
    // full-suite parallel load that macrotask can fire between the click and the
    // paste, stealing focus to the grid slot so the paste lands there instead of
    // the bulk field — the bulk-overflow path never runs and the hint never
    // appears. Targeting `bulk` makes the paste focus-independent and
    // deterministic, mirroring the focus-independent edit assertion below.
    fireEvent.paste(bulk, {
      clipboardData: {
        getData: () =>
          "ability about above absent absorb abstract extra surplus",
      },
    });

    // Survives the paste-driven distribution. Use findByText so the
    // assertion waits for React to flush the paste-driven state update
    // instead of racing it (under parallel load the synchronous getBy
    // could run before the re-render settled).
    const hint = await screen.findByText(/only the first 6 words were used/i);
    expect(hint).toBeInTheDocument();

    // A genuine edit to the bulk field clears the hint. Dispatch the
    // change directly on `bulk` rather than `click` + `keyboard`:
    // entering join mode arms a 50ms autofocus timer for the first grid
    // slot, and under full-suite parallel load that macrotask can fire
    // late — in between the click and the keystroke — stealing focus so
    // the "z" lands in a grid slot instead. The bulk onChange would then
    // never run, the hint never clears, and the assertion flakes.
    // Targeting `bulk` makes the edit focus-independent and deterministic.
    // The change flushes synchronously, but waitFor stays tolerant of any
    // async flush (and of the hint already being gone).
    fireEvent.change(bulk, { target: { value: "z" } });
    await vi.waitFor(() => {
      expect(
        screen.queryByText(/only the first 6 words were used/i),
      ).not.toBeInTheDocument();
    });
  });
});

describe("StartScreen first-paste clipboard warning (Task #250)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("shows the clipboard warning toast the first time a user pastes a phrase", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();

    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    const toast = await screen.findByTestId("clipboard-warning");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent(/clipboardRead/);
    expect(toast).toHaveTextContent(/system clipboard/i);
    expect(toast).toHaveTextContent(/clean browser profile/i);
    // The "shown" flag is persisted synchronously on first display so
    // even an immediate refresh cannot cause a second auto-display.
    expect(localStorage.getItem("void:clipboard-warning-shown")).toBe("1");
  });

  it("does not show the toast for a single-word paste", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability");

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();
    expect(localStorage.getItem("void:clipboard-warning-shown")).toBeNull();
  });

  it("does not auto-show the toast a second time on the same mount after DISMISS", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    const toast = await screen.findByTestId("clipboard-warning");
    await user.click(within(toast).getByRole("button", { name: /^DISMISS$/i }));

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();

    // A subsequent paste must NOT re-open the toast — the warning is
    // strictly one-time per browser.
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");
    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();
  });

  it("does not auto-show the toast again after remount when the shown flag is already set", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    expect(await screen.findByTestId("clipboard-warning")).toBeInTheDocument();
    expect(localStorage.getItem("void:clipboard-warning-shown")).toBe("1");

    // Unmount + remount + paste again → still suppressed because the
    // per-browser localStorage flag persists across mounts.
    unmount();
    render(<StartScreen onJoinRoom={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();
  });

  it("does not auto-show the toast on first paste if the shown flag is already set in localStorage", async () => {
    // Simulates a user who has seen the warning once previously on this
    // browser (localStorage flag set), then visits the join screen again.
    localStorage.setItem("void:clipboard-warning-shown", "1");

    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();
  });

  it("does not show the toast on the recovery-code grid (out of scope for Task #250)", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: /RECOVER A PAID ROOM/i }),
    );
    await user.click(getRecoverySlot(0));
    await user.paste("abandon ability able about");

    expect(screen.queryByTestId("clipboard-warning")).not.toBeInTheDocument();
  });

  it("the READ MORE link points at the threat-model browser-level-surfaces anchor", async () => {
    const user = userEvent.setup();
    render(<StartScreen onJoinRoom={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    await user.click(getSlot(0));
    await user.paste("ability about above absent absorb abstract");

    const toast = await screen.findByTestId("clipboard-warning");
    const link = within(toast).getByRole("link", { name: /READ MORE/i });
    expect(link.getAttribute("href")).toMatch(
      /threat-model#browser-level-surfaces$/,
    );
  });
});

// (Tor-wallet prompt was removed from StartScreen in the LandingPage merge.
// The same warning now lives inside PaywallModal; its coverage moved to
// PaywallModal.test.tsx — which already asserts the prompt renders and
// deep-links to the threat-model lightning-ip-leak anchor.)

describe("StartScreen onion-copy offer (Task #292)", () => {
  const ONION = "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it("does not render the offer when VITE_VOID_ONION_HOST is unset", () => {
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("onion-copy-offer")).not.toBeInTheDocument();
  });

  it("renders the offer when the env var is set on a clearnet origin", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    render(<StartScreen onJoinRoom={vi.fn()} />);
    const btn = screen.getByTestId("onion-copy-offer");
    expect(btn).toHaveTextContent(/copy our \.onion/i);
    expect(btn.getAttribute("title")).toContain(`http://${ONION}/`);
  });

  // Task #1027: name the current path explicitly on the home screen too,
  // alongside the one-click .onion switch.
  it("names the clearnet path explicitly when the mirror is published on a clearnet origin", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    render(<StartScreen onJoinRoom={vi.fn()} />);
    const badge = screen.getByTestId("clearnet-path-indicator");
    expect(badge).toHaveTextContent(/clearnet path/i);
    // The one-click switch sits alongside it.
    expect(screen.getByTestId("onion-copy-offer")).toBeInTheDocument();
  });

  it("does not name the clearnet path when no .onion mirror is configured", () => {
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("clearnet-path-indicator")).not.toBeInTheDocument();
  });

  // Task #1043: surface the footer's "requires Tor Browser" hint on the
  // home-screen header. The reachability verdict is read from the shared
  // session cache (`void.onionReachability.v1`); only the definite
  // "unreachable" verdict renders the hint.
  it("shows the 'requires Tor Browser' hint when the mirror is detected unreachable", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    sessionStorage.setItem("void.onionReachability.v1", "unreachable");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    const hint = screen.getByTestId("onion-copy-hint");
    expect(hint).toHaveTextContent(/requires tor browser/i);
  });

  it("does not show the hint when the mirror is reachable", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    sessionStorage.setItem("void.onionReachability.v1", "reachable");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("onion-copy-hint")).not.toBeInTheDocument();
  });

  it("degrades silently (no hint) when the reachability probe is inconclusive", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    sessionStorage.setItem("void.onionReachability.v1", "unknown");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("onion-copy-hint")).not.toBeInTheDocument();
  });

  it("does not show the hint when no .onion mirror is configured", () => {
    sessionStorage.setItem("void.onionReachability.v1", "unreachable");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("onion-copy-hint")).not.toBeInTheDocument();
  });

  it("does not name the clearnet path when the page was loaded over .onion", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, hostname: ONION },
    });
    try {
      render(<StartScreen onJoinRoom={vi.fn()} />);
      expect(screen.queryByTestId("clearnet-path-indicator")).not.toBeInTheDocument();
      expect(screen.getByTestId("tor-onion-indicator")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("ignores values whose hostname is not a .onion", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", "example.com");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.queryByTestId("onion-copy-offer")).not.toBeInTheDocument();
  });

  it("accepts values with an http:// scheme and trailing slashes", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", `http://${ONION}/`);
    render(<StartScreen onJoinRoom={vi.fn()} />);
    const btn = screen.getByTestId("onion-copy-offer");
    expect(btn.getAttribute("title")).toContain(`http://${ONION}/`);
  });

  it("suppresses the offer when the page itself was loaded over .onion", () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, hostname: ONION },
    });
    try {
      render(<StartScreen onJoinRoom={vi.fn()} />);
      expect(screen.queryByTestId("onion-copy-offer")).not.toBeInTheDocument();
      // The existing teal indicator covers the case.
      expect(screen.getByTestId("tor-onion-indicator")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: original,
      });
    }
  });

  it("writes the .onion URL to the clipboard and flips the label on click", async () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    // userEvent.setup() installs its own navigator.clipboard implementation,
    // so spy on the live writeText after setup rather than replacing the
    // whole property — replacing it before setup is overwritten, and after
    // setup is non-configurable in some jsdom builds.
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);

    render(<StartScreen onJoinRoom={vi.fn()} />);

    const btn = screen.getByTestId("onion-copy-offer");
    await user.click(btn);

    expect(writeText).toHaveBeenCalledWith(`http://${ONION}/`);
    expect(await screen.findByText(/copied \.onion/i)).toBeInTheDocument();
    writeText.mockRestore();
  });

  it("falls back to a selectable input with the URL when clipboard write rejects", async () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValue(new Error("permission-denied"));

    render(<StartScreen onJoinRoom={vi.fn()} />);
    await user.click(screen.getByTestId("onion-copy-offer"));

    const fallback = await screen.findByTestId("onion-copy-fallback") as HTMLInputElement;
    expect(fallback.value).toBe(`http://${ONION}/`);
    expect(fallback.readOnly).toBe(true);
    writeText.mockRestore();
  });

  // Task #1041 (merged into the single hint by Task #1057): the lone
  // "requires Tor Browser" hint must also react to the live reachability
  // probe, not just a pre-seeded session cache.
  it("shows the 'requires Tor Browser' hint when the .onion probe reports unreachable", async () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("net"));

    render(<StartScreen onJoinRoom={vi.fn()} />);

    const hint = await screen.findByTestId("onion-copy-hint");
    expect(hint).toHaveTextContent(/requires tor browser/i);
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("omits the hint when the probe resolves (network can reach .onion)", async () => {
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<StartScreen onJoinRoom={vi.fn()} />);

    await vi.waitFor(() => {
      expect(
        sessionStorage.getItem("void.onionReachability.v1"),
      ).toBe("reachable");
    });
    expect(
      screen.queryByTestId("onion-copy-hint"),
    ).not.toBeInTheDocument();
    // The copy affordance still renders — degrades to current behaviour.
    expect(screen.getByTestId("onion-copy-offer")).toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("does not probe (or render the hint) when no .onion mirror is configured", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(
      screen.queryByTestId("onion-copy-hint"),
    ).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// Task #1046: the header hint must stay fresh when connectivity changes,
// mirroring the footer OnionMirrorLink re-probe suite (Task #426). The
// mount probe runs once and then reads the shared session cache, so a
// visitor who starts Tor Browser / Orbot after the first probe would
// otherwise stay stuck with the stale "unreachable" hint for the life of
// the tab — even after the footer has already re-probed.
describe("StartScreen onion hint re-probe on connectivity recovery (Task #1046)", () => {
  const ONION = "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";
  const CACHE_KEY = "void.onionReachability.v1";

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_VOID_ONION_HOST", ONION);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears the cache and re-probes when the browser fires 'online'", async () => {
    sessionStorage.setItem(CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    render(<StartScreen onJoinRoom={vi.fn()} />);
    // Stale cached "unreachable" → hint visible on first render.
    expect(screen.getByTestId("onion-copy-hint")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });

    await vi.waitFor(() => {
      expect(sessionStorage.getItem(CACHE_KEY)).toBe("reachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onion-copy-hint")).not.toBeInTheDocument();
  });

  it("re-probes when the tab returns to foreground after a long background period", async () => {
    sessionStorage.setItem(CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    let t = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.getByTestId("onion-copy-hint")).toBeInTheDocument();

    // Tab goes hidden.
    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // ...returns later, well past the threshold.
    t += ONION_BACKGROUND_REPROBE_THRESHOLD_MS + 1;
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await vi.waitFor(() => {
      expect(sessionStorage.getItem(CACHE_KEY)).toBe("reachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("onion-copy-hint")).not.toBeInTheDocument();
  });

  it("does NOT re-probe on a quick alt-tab (under the background threshold)", async () => {
    sessionStorage.setItem(CACHE_KEY, "unreachable");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let t = 2_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => t);

    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });

    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(screen.getByTestId("onion-copy-hint")).toBeInTheDocument();

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    // Comes back almost immediately.
    t += 500;
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Cache untouched, no re-probe, hint still showing.
    expect(sessionStorage.getItem(CACHE_KEY)).toBe("unreachable");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("onion-copy-hint")).toBeInTheDocument();
  });

  it("re-probes at most once per online transition (no probe storm)", async () => {
    sessionStorage.setItem(CACHE_KEY, "unreachable");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("net"));

    render(<StartScreen onJoinRoom={vi.fn()} />);
    expect(fetchSpy).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() => {
      expect(sessionStorage.getItem(CACHE_KEY)).toBe("unreachable");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // A second 'online' re-invalidates and re-probes exactly once more —
    // not a storm of N events → N probes per render.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});

describe("StartScreen recovery flow", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("renders 4 BIP-39 slots with autocomplete and underlines unknown words", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();
    render(<StartScreen onJoinRoom={onJoinRoom} />);

    await user.click(screen.getByRole("button", { name: /RECOVER A PAID ROOM/i }));

    // 4 separate slots, not a single text field.
    for (let i = 0; i < 4; i++) {
      expect(getRecoverySlot(i)).toBeInTheDocument();
    }

    // Unknown word marker — the grid renders BIP-39-invalid words with
    // aria-invalid=true and surfaces a banner the user can read.
    await user.click(getRecoverySlot(0));
    await user.keyboard("zzzzz");
    await user.tab();
    expect(getRecoverySlot(0)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/NOT IN BIP39 LIST/i)).toBeInTheDocument();
  });

  it("distributes a pasted 4-word recovery code across the slots", async () => {
    const user = userEvent.setup();
    const onJoinRoom = vi.fn();
    render(<StartScreen onJoinRoom={onJoinRoom} />);

    await user.click(screen.getByRole("button", { name: /RECOVER A PAID ROOM/i }));

    await user.click(getRecoverySlot(0));
    await user.paste("abandon ability able about");

    expect(getRecoverySlot(0).value).toBe("abandon");
    expect(getRecoverySlot(1).value).toBe("ability");
    expect(getRecoverySlot(2).value).toBe("able");
    expect(getRecoverySlot(3).value).toBe("about");
  });
});

// Task #418: PreviewGate got the shared SOUNDS toggle in #417, but
// StartScreen — the very first screen — was left out. UI clicks fire
// on this screen too (entering join mode, opening the QR scanner,
// copying the .onion mirror), so the toggle is now rendered above the
// title. These tests mirror the PreviewGate coverage so the on-screen
// Task #420: the SOUNDS toggle was moved out of StartScreen and into
// the HamburgerMenu's PREFERENCES section. The persist-before-uiClick
// ordering is still pinned by RoomPage.test.tsx via the same shared
// <UiSoundsToggle> component, so no presence test lives here anymore.

describe("StartScreen accessibility audit (axe)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("has no axe violations in the initial host/join/recover chooser", async () => {
    const { container } = render(<StartScreen onJoinRoom={vi.fn()} />);
    await expectNoAxeViolations(container);
  });

  it("has no axe violations in the join phrase-grid flow", async () => {
    const user = userEvent.setup();
    const { container } = render(<StartScreen onJoinRoom={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /JOIN A ROOM/i }));
    expect(getSlot(0)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("has no axe violations in the recovery-code flow", async () => {
    const user = userEvent.setup();
    const { container } = render(<StartScreen onJoinRoom={vi.fn()} />);
    await user.click(
      screen.getByRole("button", { name: /RECOVER A PAID ROOM/i }),
    );
    expect(getRecoverySlot(0)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
