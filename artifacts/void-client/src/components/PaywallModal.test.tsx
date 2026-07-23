// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PaywallModal from "./PaywallModal";

const DAY_MS = 24 * 60 * 60 * 1000;
const STANDARD_MS = 65 * 60 * 1000;

function freezeNow(now: Date) {
  // Only fake Date — leave setTimeout/setInterval real so userEvent's internal
  // microtask waits and the modal's per-second preview tick both work without
  // requiring manual timer advancement in every test.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

function formatExpected(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

describe("PaywallModal accessibility", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders as a labelled dialog with aria-modal pointing at the header", () => {
    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "paywall-modal-title");
    expect(document.getElementById("paywall-modal-title")).toHaveTextContent(
      "⚡ HOST A ROOM",
    );
  });

  it("uses the overridden header label as the dialog name when supplied", () => {
    render(
      <PaywallModal
        onSuccess={() => {}}
        onClose={() => {}}
        headerLabel="EXTEND THIS ROOM"
      />,
    );
    expect(document.getElementById("paywall-modal-title")).toHaveTextContent(
      "EXTEND THIS ROOM",
    );
  });

  it("focuses the first control on mount and Tab cycles back to it from the last", () => {
    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    // First focusable inside the dialog is the first tier option button.
    const firstBtn = screen.getAllByRole("button")[0];
    expect(firstBtn).toHaveFocus();

    // Tab from the last focusable cycles back to the first.
    const continueBtn = screen.getByRole("button", { name: "CONTINUE" });
    continueBtn.focus();
    act(() => {
      fireEvent.keyDown(document, { key: "Tab" });
    });
    expect(firstBtn).toHaveFocus();
  });

  it("invokes onClose on Escape via the focus trap", () => {
    const onClose = vi.fn();
    render(<PaywallModal onSuccess={() => {}} onClose={onClose} />);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PaywallModal extend preview", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Task #269: when the page itself was loaded over a .onion address,
  // surface a hint at the choosing screen so the host knows that paying
  // from a clearnet wallet undoes most of the Tor work. On clearnet
  // (default jsdom hostname) the hint must NOT render — that's the 99%
  // case and we don't want the noise.
  describe("Tor-wallet onion hint (Task #269)", () => {
    const ORIGINAL_LOCATION = window.location;

    function setHostname(hostname: string) {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          ...ORIGINAL_LOCATION,
          hostname,
          protocol: "http:",
          href: `http://${hostname}/`,
        },
      });
    }

    afterEach(() => {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: ORIGINAL_LOCATION,
      });
    });

    it("renders the hint when the page was loaded over a .onion hostname", () => {
      setHostname(
        "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion",
      );
      render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
      const hint = screen.getByTestId("onion-tor-wallet-hint");
      expect(hint).toBeInTheDocument();
      expect(hint).toHaveTextContent(/Tor-routed wallet/i);
    });

    // Task #363: the hint must give the host a one-click path straight to
    // the vetted wallet shortlist (#tor-wallet-shortlist), not just the
    // parent #lightning-ip-leak context paragraph they'd have to scroll
    // past. The /threat-model short-form page client-redirects this anchor
    // to /docs/threat-model#tor-wallet-shortlist (see anchorRedirects.ts).
    it("links the hint directly to the Tor-wallet shortlist anchor", () => {
      setHostname(
        "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion",
      );
      render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
      const link = screen.getByTestId("onion-tor-wallet-shortlist-link");
      expect(link).toBeInTheDocument();
      expect(link.getAttribute("href")).toMatch(
        /threat-model#tor-wallet-shortlist$/,
      );
    });

    it("does NOT render the hint on a clearnet hostname", () => {
      setHostname("void.example.com");
      render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
      expect(
        screen.queryByTestId("onion-tor-wallet-hint"),
      ).not.toBeInTheDocument();
    });
  });

  it("does NOT render the preview when extendPreview prop is omitted", () => {
    render(
      <PaywallModal onSuccess={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByTestId("extend-preview")).not.toBeInTheDocument();
    expect(screen.getByText("CHOOSE A ROOM")).toBeInTheDocument();
  });

  // Task #262: the Tor-wallet prompt belongs on the room-creation form
  // (StartScreen), not next to the BOLT11 invoice. By the time the modal
  // is open, the host has already opened a wallet — a prompt at this
  // point is informational at best and contradicts the placement
  // decision recorded in Task #262.
  it("does not render a Tor-wallet prompt on the invoice screen (Task #262)", () => {
    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId("tor-wallet-prompt")).not.toBeInTheDocument();
    expect(screen.queryByText(/Tor-routed wallet/i)).not.toBeInTheDocument();
  });

  it("renders the projected new end time for the active tier when extending", () => {
    freezeNow(new Date("2026-04-29T10:00:00"));
    const currentExpiresAt = new Date("2026-04-29T10:30:00").getTime();
    render(
      <PaywallModal
        onSuccess={() => {}}
        onClose={() => {}}
        headerLabel="EXTEND"
        successLabel="EXTEND ROOM"
        extendPreview={{ currentExpiresAtMs: currentExpiresAt, ceilingMs: DAY_MS }}
      />,
    );

    expect(screen.getByText("TOP UP YOUR ROOM")).toBeInTheDocument();
    // Default tier is "standard" → adds 65 min → 11:35
    const expectedNewEnd = currentExpiresAt + STANDARD_MS;
    expect(screen.getByTestId("extend-preview-new-end")).toHaveTextContent(
      formatExpected(expectedNewEnd),
    );
    // No cap warning when there's plenty of headroom.
    expect(screen.queryByTestId("extend-preview-trimmed")).not.toBeInTheDocument();
  });

  it("warns when the extension would be trimmed by the 24h cap", async () => {
    freezeNow(new Date("2026-04-29T10:00:00"));
    // Room currently ends 23h from now → adding 65min would cross 24h ceiling.
    const currentExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
    render(
      <PaywallModal
        onSuccess={() => {}}
        onClose={() => {}}
        headerLabel="EXTEND"
        successLabel="EXTEND ROOM"
        extendPreview={{ currentExpiresAtMs: currentExpiresAt, ceilingMs: DAY_MS }}
      />,
    );

    // Standard tier preview shows the trimmed banner.
    expect(screen.getByTestId("extend-preview-trimmed")).toBeInTheDocument();
    // The new end is the ceiling itself (now + 24h), not currentExpiresAt + 65min.
    const ceilingAt = Date.now() + DAY_MS;
    expect(screen.getByTestId("extend-preview-new-end")).toHaveTextContent(
      formatExpected(ceilingAt),
    );

    // Switching to the day tier should still show "trimmed" because adding 24h
    // to a room ending in 23h would crash way past the ceiling.
    await userEvent.click(screen.getByText("24-HOUR"));
    expect(screen.getByTestId("extend-preview-trimmed")).toBeInTheDocument();
  });

  it("disables the CONTINUE button and shows an explanation when there is zero headroom", () => {
    freezeNow(new Date("2026-04-29T10:00:00"));
    // Room currently ends 24h from now → ceiling is also 24h from now → no headroom at all.
    const currentExpiresAt = Date.now() + DAY_MS;
    render(
      <PaywallModal
        onSuccess={() => {}}
        onClose={() => {}}
        headerLabel="EXTEND"
        successLabel="EXTEND ROOM"
        extendPreview={{ currentExpiresAtMs: currentExpiresAt, ceilingMs: DAY_MS }}
      />,
    );

    const cta = screen.getByRole("button", { name: "CONTINUE" });
    expect(cta).toBeDisabled();
    expect(
      screen.getByText(/ROOM IS ALREADY AT THE 24H LIMIT/i),
    ).toBeInTheDocument();
    // The projected-new-end line is hidden when there's no headroom — we'd
    // be lying to the user otherwise.
    expect(screen.queryByTestId("extend-preview-new-end")).not.toBeInTheDocument();
  });

  it("clicking the disabled CONTINUE button does not fire requestInvoice (no fetch)", async () => {
    freezeNow(new Date("2026-04-29T10:00:00"));
    const currentExpiresAt = Date.now() + DAY_MS;
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ invoice: "lnbc...", paymentHash: "hash", amountSats: 1000 }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <PaywallModal
        onSuccess={() => {}}
        onClose={() => {}}
        extendPreview={{ currentExpiresAtMs: currentExpiresAt, ceilingMs: DAY_MS }}
      />,
    );

    // userEvent respects the disabled attribute and won't fire a click; the
    // fact that no invoice fetch is issued is the contract we care about
    // here. We filter out the unrelated /paywall/tiers GET that the modal
    // fires on mount (Task #549 — server-authoritative tier pricing) so
    // this assertion stays scoped to the invoice-creation path.
    await userEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    const invoiceCalls = fetchSpy.mock.calls.filter((call) => {
      const url = String(call[0] ?? "");
      return url.includes("/paywall/invoice");
    });
    expect(invoiceCalls).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for the recovery-code describe blocks.
// Both require fake timers to be active (configured in each describe's
// beforeEach); they rely only on module-level imports (vi, act, fireEvent,
// screen) so they are safe at the top level.
// ---------------------------------------------------------------------------

// Flush a generous batch of microtask turns so any chain of awaited
// promises (mocked fetch → res.json() → setState → effect) has room to
// settle before we assert.  Microtasks themselves are NOT faked here, so
// each `await Promise.resolve()` actually yields.
async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

async function reachPaidPhase() {
  fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
  // requestInvoice is async (fetch + json + setState); drain its microtask
  // chain so phase flips to "waiting" and the polling effect installs its
  // setInterval(poll, 3000).
  await flushMicrotasks();
  // Run the first poll tick.
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  // Drain poll's own fetch + json + setState chain.
  await flushMicrotasks();
}

// The recovery code now lives behind a "PAYMENT DETAILS (including
// one-time recovery code)" disclosure that starts collapsed. Expand it so
// the code value, COPY button, and keep-no-copy warning are mounted before
// asserting on them.
function expandRecoveryDetails() {
  fireEvent.click(
    screen.getByRole("button", {
      name: /PAYMENT DETAILS \(including one-time recovery code\)/i,
    }),
  );
}

// ---------------------------------------------------------------------------

describe("PaywallModal recovery-code COPY button", () => {
  // We need full fake timers here because the modal walks through
  // setInterval-driven payment polling and a 1.5s "COPIED ✓" reset timeout
  // — both have to be steerable from the test.
  let writeText: ReturnType<typeof vi.fn>;

  function setupClipboard(impl: (text: string) => Promise<void>) {
    writeText = vi.fn(impl);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  function setupFetch(recoveryCode: string | null) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: "lnbc1invoice",
              paymentHash: "hashAAA",
              amountSats: 1000,
            }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              paid: true,
              token: "tok-abc",
              recoveryCode,
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    // Fake only the timing primitives, not promise/microtask APIs, so the
    // mocked fetch chain can resolve naturally between timer ticks.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts as COPY TO CLIPBOARD, flips to COPIED ✓ on success, then reverts after 1.5s", async () => {
    const RECOVERY_CODE = "able above abandon ability about absent";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);

    await reachPaidPhase();
    expandRecoveryDetails();

    const copyBtn = screen.getByRole("button", { name: /copy recovery code/i });
    expect(copyBtn).toHaveTextContent("COPY TO CLIPBOARD");

    fireEvent.click(copyBtn);
    // Drain the writeText promise so setRecoveryCopied(true) takes effect
    // and React re-renders the button label.
    await flushMicrotasks();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(RECOVERY_CODE);
    expect(copyBtn).toHaveTextContent("COPIED ✓");

    // Just before the timeout the label should still read COPIED ✓ — proves
    // the revert is the timer firing, not something else racing it.
    await act(async () => {
      vi.advanceTimersByTime(1499);
    });
    expect(copyBtn).toHaveTextContent("COPIED ✓");

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(copyBtn).toHaveTextContent("COPY TO CLIPBOARD");
  });

  it("surfaces a manual-copy hint and keeps the recovery-code panel visible when clipboard is denied", async () => {
    const RECOVERY_CODE = "alpha bravo charlie delta echo foxtrot";
    setupClipboard(() => Promise.reject(new Error("clipboard denied")));
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={() => {}} />);

    await reachPaidPhase();
    expandRecoveryDetails();

    const copyBtn = screen.getByRole("button", { name: /copy recovery code/i });

    // The click handler must swallow the rejection — if it threw, the
    // unhandled rejection would surface here.
    fireEvent.click(copyBtn);
    await flushMicrotasks();

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(RECOVERY_CODE);

    // Label never flips to COPIED ✓ on a denial — the success state is
    // gated on writeText resolving.
    expect(copyBtn).toHaveTextContent("COPY TO CLIPBOARD");

    // The recovery code box, its header, and the explanatory copy are all
    // still on screen — denial must NOT auto-dismiss the modal or hide
    // the code (the user can still select it by hand).
    expect(screen.getByText(RECOVERY_CODE)).toBeInTheDocument();
    expect(
      screen.getByText(/PAYMENT DETAILS \(including one-time recovery code\)/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to/i),
    ).not.toBeInTheDocument();

    // Item 11: instead of failing silently, an inline manual-copy hint must
    // appear so the host knows to select the (pre-highlighted) code by hand.
    expect(
      screen.getByTestId("recovery-copy-manual-hint"),
    ).toBeInTheDocument();

    // And we must not have advanced past the recovery screen.
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("clicking OPEN ROOM calls onSuccess synchronously then removes the recovery code from the DOM", async () => {
    const RECOVERY_CODE = "canal donor early fabric ghost honor";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={() => {}} />);

    await reachPaidPhase();
    expandRecoveryDetails();

    // Recovery code must be visible before the user acts.
    expect(screen.getByText(RECOVERY_CODE)).toBeInTheDocument();

    // The single primary action carries no "I've written it down" claim and
    // requires no confirmation step.
    const openBtn = screen.getByRole("button", { name: "OPEN ROOM" });
    fireEvent.click(openBtn);

    // onSuccess must be called synchronously inside the same event-handler
    // tick — before React has had a chance to commit any state flush.
    // If onSuccess were deferred (e.g. moved into a useEffect or setTimeout),
    // it would not be present here and this assertion would catch the
    // regression.
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-abc");

    // Now let React flush the batched setState(null) calls.  After commit,
    // the recovery code must no longer be in the DOM — confirming that
    // setRecoveryCode(null) was scheduled (and thus called) before
    // onSuccess fired.
    await flushMicrotasks();
    expect(screen.queryByText(RECOVERY_CODE)).not.toBeInTheDocument();
  });

  it("does not present a separate SKIP control or an 'I've written it down' claim", async () => {
    const RECOVERY_CODE = "ivory jacket kite lemon mango noble";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);

    await reachPaidPhase();

    // The two old coupled controls are gone — only the calm primary remains.
    expect(
      screen.queryByRole("button", { name: /SKIP/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /I'VE WRITTEN IT DOWN/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OPEN ROOM" })).toBeInTheDocument();
  });

  it("intercepts OPEN ROOM with an unrecoverable-skip confirmation when the code was never opened (item 15)", async () => {
    const RECOVERY_CODE = "uniform victor whiskey xray yankee zulu";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={() => {}} />);

    await reachPaidPhase();

    // Host clicks the primary action WITHOUT ever opening the recovery
    // disclosure — they could be about to lose the only way back in.
    fireEvent.click(screen.getByRole("button", { name: "OPEN ROOM" }));

    // The confirmation interstitial appears; onSuccess must NOT have fired.
    expect(screen.getByTestId("recovery-skip-confirm")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();

    // "SHOW MY RECOVERY CODE" backs out of the confirmation and opens the
    // disclosure so the host can save the code.
    fireEvent.click(screen.getByRole("button", { name: "SHOW MY RECOVERY CODE" }));
    expect(screen.queryByTestId("recovery-skip-confirm")).not.toBeInTheDocument();
    expect(screen.getByText(RECOVERY_CODE)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();

    // Now that the disclosure is open, the primary action proceeds straight
    // through with no second confirmation.
    fireEvent.click(screen.getByRole("button", { name: "OPEN ROOM" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-abc");
  });

  it("OPEN ROOM ANYWAY proceeds from the unrecoverable-skip confirmation (item 15)", async () => {
    const RECOVERY_CODE = "able baker camp delta eagle frost";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={() => {}} />);

    await reachPaidPhase();

    fireEvent.click(screen.getByRole("button", { name: "OPEN ROOM" }));
    expect(screen.getByTestId("recovery-skip-confirm")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "OPEN ROOM ANYWAY" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-abc");
  });

  it("pressing ESC on the paid screen enters the room with the paid token (dismiss equals open)", async () => {
    const RECOVERY_CODE = "opal panel quiet river stone tulip";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={onClose} />);

    await reachPaidPhase();
    expandRecoveryDetails();

    expect(screen.getByText(RECOVERY_CODE)).toBeInTheDocument();

    // On the paid screen, dismissing must NOT abandon the already-paid room —
    // it proceeds through the same path as OPEN ROOM. onClose must never fire.
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-abc");

    await flushMicrotasks();
    expect(screen.queryByText(RECOVERY_CODE)).not.toBeInTheDocument();
  });

  it("clicking the backdrop on the paid screen enters the room (not close)", async () => {
    const RECOVERY_CODE = "anchor birch cedar dune ember frost";
    setupClipboard(() => Promise.resolve());
    setupFetch(RECOVERY_CODE);

    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={onClose} />);

    await reachPaidPhase();

    // The backdrop is the overlay element wrapping the dialog card; clicking
    // it directly (target === currentTarget) must run the same proceed path.
    const overlay = screen.getByRole("dialog").parentElement as HTMLElement;
    fireEvent.click(overlay);

    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-abc");
  });
});

describe("PaywallModal recovery-code fallback (no recoveryCode from server)", () => {
  function setupFetchNoRecovery() {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: "lnbc1invoice",
              paymentHash: "hashBBB",
              amountSats: 1000,
            }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ paid: true, token: "tok-xyz", recoveryCode: null }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the fallback CTA button, does not auto-advance, and calls onSuccess once when clicked", async () => {
    setupFetchNoRecovery();

    const onSuccess = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={() => {}} />);

    await reachPaidPhase();

    // The recovery-code panel must NOT be rendered (no code to show).
    expect(
      screen.queryByText(/PAYMENT DETAILS \(including one-time recovery code\)/i),
    ).not.toBeInTheDocument();

    // The fallback manual CTA must be present.
    const fallbackBtn = screen.getByRole("button", { name: "OPEN ROOM" });
    expect(fallbackBtn).toBeInTheDocument();

    // onSuccess must NOT have been called automatically — the user must click.
    expect(onSuccess).not.toHaveBeenCalled();

    fireEvent.click(fallbackBtn);
    await flushMicrotasks();

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-xyz");
  });

  it("dismiss-equals-open still applies in the no-recovery-code fallback (ESC enters the room)", async () => {
    setupFetchNoRecovery();

    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<PaywallModal onSuccess={onSuccess} onClose={onClose} />);

    await reachPaidPhase();

    // No recovery code, but the room is paid for — ESC must proceed, not close.
    expect(onSuccess).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith("tok-xyz");
  });
});

// Task #277: when /api/paywall/invoice returns 503 LIGHTNING_BACKEND_UNAVAILABLE
// the modal must surface an in-place "TRY AGAIN" button (gated by a short
// cooldown) so the host can re-run requestInvoice without losing the tier
// they already picked.
describe("PaywallModal Lightning-503 retry button", () => {
  function flushMicrotasks() {
    return new Promise<void>((resolve) => {
      Promise.resolve().then(() => Promise.resolve().then(() => resolve()));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-05-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders TRY AGAIN on 503, gates it behind a cooldown, then re-requests with the same tier", async () => {
    let invoiceCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        invoiceCalls += 1;
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        // First call → 503, second call → success, so we can prove the retry
        // re-runs requestInvoice and preserves the chosen tier.
        if (invoiceCalls === 1) {
          return Promise.resolve({
            status: 503,
            ok: false,
            json: () => Promise.resolve({ error: "LIGHTNING_BACKEND_UNAVAILABLE" }),
          } as Response);
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: `inv-${body.tier}`,
              paymentHash: "hash-rerun",
              amountSats: body.tier === "day" ? 5000 : 1000,
            }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);

    // Pick the 24-HOUR tier so we can prove the retry preserves it.
    fireEvent.click(screen.getByRole("button", { name: /24-HOUR/ }));
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));

    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await flushMicrotasks(); });

    // Error screen with the slow-service line and the new retry button.
    expect(
      screen.getByText("PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT."),
    ).toBeInTheDocument();
    const retryBtn = screen.getByTestId("paywall-retry") as HTMLButtonElement;
    expect(retryBtn).toBeInTheDocument();

    // Cooldown is active immediately after the 503 — clicking must NOT
    // fire another invoice request.
    expect(retryBtn.disabled).toBe(true);
    expect(retryBtn).toHaveTextContent(/TRY AGAIN IN \d+S/);
    fireEvent.click(retryBtn);
    expect(invoiceCalls).toBe(1);

    // After the cooldown elapses the button enables and the retry actually
    // re-runs requestInvoice with the previously-chosen tier ("day").
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(retryBtn.disabled).toBe(false);
    expect(retryBtn).toHaveTextContent("TRY AGAIN");

    fireEvent.click(retryBtn);
    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await flushMicrotasks(); });

    expect(invoiceCalls).toBe(2);
    const secondCallBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(secondCallBody.tier).toBe("day");

    // Successful retry advances past the error screen.
    expect(
      screen.queryByText("PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT."),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("paywall-retry")).not.toBeInTheDocument();
  });

  it("clears the retry button when a subsequent retry attempt fails with a non-503 error", async () => {
    let invoiceCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        invoiceCalls += 1;
        if (invoiceCalls === 1) {
          // First: transient slowness → retry button appears.
          return Promise.resolve({
            status: 503,
            ok: false,
            json: () => Promise.resolve({}),
          } as Response);
        }
        // Second: hard failure → retry must NOT remain (otherwise the
        // already-elapsed cooldown lets the user hammer a broken backend).
        return Promise.resolve({
          status: 500,
          ok: false,
          json: () => Promise.resolve({}),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));

    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await flushMicrotasks(); });

    expect(screen.getByTestId("paywall-retry")).toBeInTheDocument();

    // Wait out the cooldown and click TRY AGAIN — the second response is 500.
    await act(async () => { vi.advanceTimersByTime(5000); });
    fireEvent.click(screen.getByTestId("paywall-retry"));
    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await flushMicrotasks(); });

    expect(invoiceCalls).toBe(2);
    // Generic failure copy is shown and the retry button is gone — only
    // the BACK control remains, which is the contract for non-retryable
    // errors.
    expect(screen.getByText(/Failed to generate invoice/i)).toBeInTheDocument();
    expect(screen.queryByTestId("paywall-retry")).not.toBeInTheDocument();
  });

  it("does NOT render the retry button for a non-503 generic failure", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          status: 500,
          ok: false,
          json: () => Promise.resolve({}),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));

    await act(async () => { await flushMicrotasks(); });
    await act(async () => { await flushMicrotasks(); });

    expect(screen.getByText(/Failed to generate invoice/i)).toBeInTheDocument();
    expect(screen.queryByTestId("paywall-retry")).not.toBeInTheDocument();
  });
});

// Task #747: provider-down mid-payment. A 503 LIGHTNING_BACKEND_UNAVAILABLE on
// the /paywall/status POLL (not the invoice request) used to be silently
// swallowed, stranding the host on a dead "WAITING FOR PAYMENT" spinner. The
// poll must now surface the same retryable error screen — but its retry must
// RESUME polling the existing invoice (which may have settled during the
// outage) rather than re-requesting a fresh invoice and charging again.
describe("PaywallModal status-poll Lightning-503 recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-05-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("surfaces a retryable error on a status-poll 503, then resumes polling (no new invoice) and settles", async () => {
    let invoiceCalls = 0;
    let statusCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        invoiceCalls += 1;
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: "lnbc1midpay",
              paymentHash: "hash-midpay",
              amountSats: 1000,
            }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        statusCalls += 1;
        // First poll → backend down (503). Subsequent polls → paid.
        if (statusCalls === 1) {
          return Promise.resolve({
            status: 503,
            ok: false,
            json: () => Promise.resolve({ error: "LIGHTNING_BACKEND_UNAVAILABLE" }),
          } as Response);
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              paid: true,
              token: "tok-midpay",
              recoveryCode: "able above abandon ability",
            }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);

    // CONTINUE → invoice created → waiting screen.
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    await flushMicrotasks();
    expect(invoiceCalls).toBe(1);
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();

    // First poll tick hits the 503.
    await act(async () => { vi.advanceTimersByTime(3000); });
    await flushMicrotasks();

    // The dead-spinner gap is closed: the error screen with the slow-service
    // line + retry button replaces the waiting spinner.
    expect(
      screen.getByText("PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/WAITING FOR PAYMENT/i)).not.toBeInTheDocument();
    const retryBtn = screen.getByTestId("paywall-retry") as HTMLButtonElement;

    // Cooldown is active right after the 503.
    expect(retryBtn.disabled).toBe(true);
    fireEvent.click(retryBtn);
    // Crucially, the retry must NOT mint a new invoice.
    expect(invoiceCalls).toBe(1);

    // After the cooldown, retry resumes polling the SAME invoice.
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(retryBtn.disabled).toBe(false);
    fireEvent.click(retryBtn);
    await flushMicrotasks();

    // Back on the waiting screen — still the same invoice, no new request.
    expect(invoiceCalls).toBe(1);
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();

    // Next poll tick now observes the settled payment.
    await act(async () => { vi.advanceTimersByTime(3000); });
    await flushMicrotasks();

    // Paid: the recovery-code disclosure is available and no new invoice was
    // ever requested across the whole outage→recovery sequence.
    expect(invoiceCalls).toBe(1);
    expect(
      screen.getByRole("button", {
        name: /PAYMENT DETAILS \(including one-time recovery code\)/i,
      }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Launch gate 0.2 / first-60-seconds friction item 2: the [DEV] SIMULATE
// PAYMENT shortcut is a payment-bypass button. It is gated on
// import.meta.env.DEV so it stays available in `vite dev` (where the team
// relies on it) but is stripped from production-like builds. These tests pin
// both halves of that contract — present in dev, absent in prod — so the
// gate can never silently regress and ship a paywall bypass to real hosts.
// ---------------------------------------------------------------------------
describe("PaywallModal [DEV] SIMULATE PAYMENT gate (item 2 / launch gate 0.2)", () => {
  const DEV_BUTTON = /\[DEV\] SIMULATE PAYMENT/i;

  // Mock fetch so CONTINUE reaches the "waiting" screen (where the dev
  // button lives) and the status poll never flips to "paid".
  function setupWaitingFetch() {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: "lnbc1devgate",
              paymentHash: "hashDEVGATE",
              amountSats: 1000,
            }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ paid: false }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // Click CONTINUE and drain the invoice fetch chain so phase flips to
  // "waiting" with an invoice. We deliberately do NOT advance timers, so the
  // 3s status poll never runs and the screen stays on "waiting".
  async function reachWaitingPhase() {
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    await flushMicrotasks();
  }

  it("renders the button on the waiting screen in a dev build (import.meta.env.DEV === true)", async () => {
    vi.stubEnv("DEV", true);
    // Guard against a future vitest env-stub regression silently no-op'ing:
    // if this is false, the test below would pass for the wrong reason.
    expect(import.meta.env.DEV).toBe(true);
    setupWaitingFetch();

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaitingPhase();

    // Sanity-check we're actually on the waiting screen the button belongs to.
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: DEV_BUTTON })).toBeInTheDocument();
  });

  it("does NOT render the button in a production build (import.meta.env.DEV === false)", async () => {
    vi.stubEnv("DEV", false);
    // If the stub silently no-op'd, DEV would still be true and the absence
    // assertion below would be meaningless — pin it so that regresses loudly.
    expect(import.meta.env.DEV).toBe(false);
    setupWaitingFetch();

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaitingPhase();

    // Same waiting screen is reached — proving the absence below is the
    // env gate firing, not the test failing to reach the right phase.
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: DEV_BUTTON }),
    ).not.toBeInTheDocument();
  });
});

// Task #352: the /paywall/status poll used to swallow fetch errors silently
// ("// silent — keep polling"). If the status endpoint is genuinely
// down/unreachable the host saw the QR forever with no signal the check was
// broken — assuming their payment hadn't landed and risking a double-pay.
// After STATUS_POLL_FAILURE_THRESHOLD consecutive failures a non-blocking
// banner with a manual CHECK NOW button appears; a readable response clears it.
describe("PaywallModal status-poll failure banner", () => {
  const BANNER = /Couldn’t confirm your payment yet/i;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // Resolves the invoice POST, then defers each status GET to the supplied
  // responder so individual tests can sequence failures and recovery.
  function setupFetch(statusResponder: () => Promise<Response>) {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({
              invoice: "lnbc1banner",
              paymentHash: "hash-banner",
              amountSats: 1000,
            }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return statusResponder();
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  async function reachWaiting() {
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    await flushMicrotasks();
  }

  async function tickPoll() {
    await act(async () => { vi.advanceTimersByTime(3000); });
    await flushMicrotasks();
  }

  it("shows the banner only after the threshold of consecutive failures, keeping the QR", async () => {
    const networkError = () => Promise.reject(new Error("network down"));
    setupFetch(networkError);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaiting();
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();

    // Two failures is below threshold (3) — no banner yet.
    await tickPoll();
    await tickPoll();
    expect(screen.queryByTestId("status-check-failing")).not.toBeInTheDocument();

    // Third consecutive failure crosses the threshold.
    await tickPoll();
    expect(screen.getByTestId("status-check-failing")).toBeInTheDocument();
    expect(screen.getByText(BANNER)).toBeInTheDocument();

    // The invoice/QR is still on screen — this is a banner, not a phase change.
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();
  });

  it("CHECK NOW fires an immediate poll without re-requesting the invoice", async () => {
    let statusCalls = 0;
    let invoiceCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        invoiceCalls += 1;
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({ invoice: "lnbc1chk", paymentHash: "hash-chk", amountSats: 1000 }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        statusCalls += 1;
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaiting();
    expect(invoiceCalls).toBe(1);

    await tickPoll();
    await tickPoll();
    await tickPoll();
    const callsAtBanner = statusCalls;
    expect(screen.getByTestId("status-check-failing")).toBeInTheDocument();

    // CHECK NOW issues an immediate status poll outside the 3s cadence.
    await act(async () => {
      fireEvent.click(screen.getByTestId("status-check-now"));
    });
    await flushMicrotasks();
    expect(statusCalls).toBe(callsAtBanner + 1);
    // And it never re-requests the invoice (no double-charge).
    expect(invoiceCalls).toBe(1);
  });

  it("clears the banner and settles when a poll finally succeeds", async () => {
    let statusCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({ invoice: "lnbc1heal", paymentHash: "hash-heal", amountSats: 1000 }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        statusCalls += 1;
        // First three polls fail; the fourth returns a settled payment.
        if (statusCalls <= 3) return Promise.reject(new Error("network down"));
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () =>
            Promise.resolve({ paid: true, token: "tok-heal", recoveryCode: "able above abandon ability" }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaiting();

    await tickPoll();
    await tickPoll();
    await tickPoll();
    expect(screen.getByTestId("status-check-failing")).toBeInTheDocument();

    // The settled poll clears the banner and advances to the paid screen.
    await tickPoll();
    expect(screen.queryByTestId("status-check-failing")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /PAYMENT DETAILS \(including one-time recovery code\)/i,
      }),
    ).toBeInTheDocument();
  });

  it("a non-503 non-OK status response also counts toward the banner", async () => {
    const serverError = () =>
      Promise.resolve({
        status: 500,
        ok: false,
        json: () => Promise.resolve({ error: "boom" }),
      } as Response);
    setupFetch(serverError);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    await reachWaiting();

    await tickPoll();
    await tickPoll();
    expect(screen.queryByTestId("status-check-failing")).not.toBeInTheDocument();
    await tickPoll();
    expect(screen.getByTestId("status-check-failing")).toBeInTheDocument();
    // A 500 is not the typed 503, so we stay on the waiting screen (banner),
    // never the hard error/TRY AGAIN screen.
    expect(screen.queryByTestId("paywall-retry")).not.toBeInTheDocument();
    expect(screen.getByText(/WAITING FOR PAYMENT/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Task #1143: interrupted-flow resume + ack-based recovery-code delivery +
// static privacy-delay copy.
// ---------------------------------------------------------------------------
describe("PaywallModal resume + ack (Task #1143)", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  function setupResumeFetch(opts: { recoveryCode?: string | null } = {}) {
    const ackCalls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/ack-recovery")) {
        ackCalls.push(String(init?.body ?? ""));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              paid: true,
              token: "tok-resume",
              recoveryCode: opts.recoveryCode ?? "able above abandon ability",
            }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    return { fetchMock, ackCalls };
  }

  it("opens straight onto the resume screen — no tier picker, no invoice request", async () => {
    const { fetchMock } = setupResumeFetch();
    render(
      <PaywallModal onSuccess={() => {}} onClose={() => {}} resumePaymentHash="hash-resume" />,
    );
    expect(screen.getByTestId("resume-checking")).toBeInTheDocument();
    expect(screen.getByTestId("privacy-delay-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CONTINUE" })).not.toBeInTheDocument();
    const invoiceCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0] ?? "").includes("/paywall/invoice"),
    );
    expect(invoiceCalls).toHaveLength(0);
  });

  it("polls the resume hash to the paid screen, then acks + clears the stored hash on proceed", async () => {
    const onSuccess = vi.fn();
    const { fetchMock, ackCalls } = setupResumeFetch();
    render(
      <PaywallModal onSuccess={onSuccess} onClose={() => {}} resumePaymentHash="hash-resume" />,
    );

    // First poll tick settles the payment.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flushMicrotasks();

    // Paid screen with the still-unacked recovery code re-fetched from the server.
    expect(
      screen.getByRole("button", {
        name: /PAYMENT DETAILS \(including one-time recovery code\)/i,
      }),
    ).toBeInTheDocument();
    const statusCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0] ?? "").includes("/paywall/status/hash-resume"),
    );
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(sessionStorage.getItem("void_token")).toBe("tok-resume");
    expect(sessionStorage.getItem("void_payment_hash")).toBe("hash-resume");

    // Open the details (so OPEN ROOM doesn't route through the never-saw-it
    // confirmation), then proceed: exactly one ack carrying the hash.
    expandRecoveryDetails();
    fireEvent.click(screen.getByRole("button", { name: "OPEN ROOM" }));
    await flushMicrotasks();
    expect(ackCalls).toHaveLength(1);
    expect(ackCalls[0]).toContain("hash-resume");
    expect(sessionStorage.getItem("void_payment_hash")).toBeNull();
    expect(onSuccess).toHaveBeenCalledWith("tok-resume");
  });

  it("shows the identical static privacy-delay note on the normal invoice waiting screen", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/paywall/invoice")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ invoice: "lnbc1x", paymentHash: "hash-x", amountSats: 1000 }),
        } as Response);
      }
      if (url.includes("/api/paywall/status/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ paid: false }),
        } as Response);
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PaywallModal onSuccess={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    await flushMicrotasks();

    const note = screen.getByTestId("privacy-delay-note");
    expect(note).toHaveTextContent(/random delay/i);
    // Static copy: still present, verbatim, after unpaid polls — its
    // presence must never signal settlement state.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await flushMicrotasks();
    expect(screen.getByTestId("privacy-delay-note")).toHaveTextContent(/random delay/i);
  });
});
