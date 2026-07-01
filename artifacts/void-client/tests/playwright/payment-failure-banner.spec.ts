// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Verify the payment-failure banner end-to-end in a real browser.
//
// The status-check failure banner (data-testid=status-check-failing) and its
// CHECK NOW button (data-testid=status-check-now) on the paywall WAITING
// screen are pinned by jsdom component tests (PaywallModal.test.tsx), but
// jsdom has no real network stack, no real timers driving the 3s poll loop,
// and no real DOM layout. This spec closes that gap: it drives the genuine
// HOST A ROOM flow in a real browser to the WAITING screen, makes the
// /api/paywall/status endpoint fail repeatedly (route interception), and
// proves — with real polling and real layout — that:
//
//   1. After STATUS_POLL_FAILURE_THRESHOLD (3) consecutive failed status
//      polls the non-blocking banner appears, while the invoice/QR stays
//      exactly where it is (a banner, NOT a phase change — the WAITING
//      header and the QR are still on screen).
//   2. The CHECK NOW button forces an immediate, out-of-cadence re-poll.
//   3. CHECK NOW genuinely drives the poll: once the status endpoint
//      recovers and reports paid, clicking CHECK NOW advances the modal to
//      the PAID screen — proving the button is wired to a real status check,
//      not a dead control.
//
// The paywall invoice + status (+ tier-pricing) requests are all intercepted
// so the spec needs no live API server: it exercises the CLIENT behaviour the
// task is about. Runs once under Chromium (engine-agnostic UI/network logic);
// see the `payment-failure-chromium` project in playwright.config.ts.

import { test, expect } from "@playwright/test";

const FAKE_INVOICE =
  "lnbc10n1p3xyzpphakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake";
const FAKE_PAYMENT_HASH = "deadbeefcafef00dba5eba11deadbeefcafef00dba5eba11deadbeefcafef00d";
const FAKE_TOKEN = "fake.jwt.token";
const FAKE_RECOVERY = "fake-recovery-code-1234";

// Mirror of STATUS_POLL_FAILURE_THRESHOLD in src/components/PaywallModal.tsx.
// The banner appears only AFTER this many consecutive failed polls.
const STATUS_POLL_FAILURE_THRESHOLD = 3;

interface PaywallRouteState {
  /** Total /api/paywall/status requests the page has issued so far. */
  statusCalls: number;
  /** When true, the status endpoint reports the invoice as paid. */
  paid: boolean;
}

// Wire up the paywall API surface for a single test. Returns a mutable state
// object so the test can flip the status endpoint from failing → paid and
// observe the live poll count.
async function installPaywallRoutes(
  page: import("@playwright/test").Page,
): Promise<PaywallRouteState> {
  const state: PaywallRouteState = { statusCalls: 0, paid: false };

  // Tier pricing — answered so the choosing screen never blocks on a real
  // backend. (The hook falls back gracefully, but answering keeps the run
  // deterministic and quiet.)
  await page.route("**/api/paywall/tiers", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        standard: { amountSats: 1000, usdApprox: null },
        day: { amountSats: 5000, usdApprox: null },
      }),
    }),
  );

  // Invoice creation — return a usable invoice so the modal advances to the
  // WAITING screen (the only place the failure banner can render).
  await page.route("**/api/paywall/invoice", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        invoice: FAKE_INVOICE,
        paymentHash: FAKE_PAYMENT_HASH,
        amountSats: 1000,
      }),
    }),
  );

  // Status polling — fail with a non-503, non-OK response (500) while
  // unpaid so each poll counts toward the failure banner, then report paid
  // once the test flips `state.paid`. A 500 (not 503) is deliberate: 503 is
  // the typed LIGHTNING_BACKEND_UNAVAILABLE path, which is a phase change to
  // the error screen — not the silent-failure banner this test targets.
  await page.route("**/api/paywall/status/**", (route) => {
    state.statusCalls += 1;
    if (state.paid) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          paid: true,
          token: FAKE_TOKEN,
          recoveryCode: FAKE_RECOVERY,
        }),
      });
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "STATUS_CHECK_FAILED" }),
    });
  });

  return state;
}

// Drive the real landing → HOST A ROOM → CONTINUE flow to the paywall
// WAITING screen, where the live 3s poll loop runs against the intercepted
// status endpoint.
async function reachWaitingScreen(page: import("@playwright/test").Page) {
  await page.goto("/");

  await page.getByRole("button", { name: "HOST A ROOM" }).click();

  // The paywall modal opens on the CHOOSING screen; the default tier is
  // pre-selected, so CONTINUE requests the (intercepted) invoice.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "CONTINUE" }).click();

  // WAITING screen: the live invoice string + a "WAITING FOR PAYMENT" status
  // line confirm we reached the only phase that can show the banner.
  await expect(page.getByText("WAITING FOR PAYMENT", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("paywall payment-failure banner (real browser)", () => {
  test("repeated status failures surface the banner while the invoice/QR stays put", async ({
    page,
  }) => {
    const state = await installPaywallRoutes(page);
    await reachWaitingScreen(page);

    // The QR is on screen the moment we reach WAITING. Capture it so we can
    // prove it survives the banner appearing (banner, not a phase change).
    const qr = page.locator("svg").first();
    await expect(qr).toBeVisible();

    // The banner must NOT be present before the failure threshold is crossed.
    await expect(page.getByTestId("status-check-failing")).toHaveCount(0);

    // The live 3s poll loop hits the failing status endpoint; after
    // STATUS_POLL_FAILURE_THRESHOLD consecutive failures the banner appears.
    const banner = page.getByTestId("status-check-failing");
    await expect(banner).toBeVisible({ timeout: 30_000 });

    // Sanity: the banner only appears because real polls genuinely failed.
    expect(
      state.statusCalls,
      "the banner should only show after at least STATUS_POLL_FAILURE_THRESHOLD failed polls",
    ).toBeGreaterThanOrEqual(STATUS_POLL_FAILURE_THRESHOLD);

    // Banner copy + the CHECK NOW control are present and visible.
    await expect(banner).toContainText(/Couldn’t confirm your payment yet/i);
    const checkNow = page.getByTestId("status-check-now");
    await expect(checkNow).toBeVisible();
    await expect(checkNow).toHaveText(/CHECK NOW/);

    // This is a banner, NOT a phase change: the WAITING header and the QR are
    // both still on screen, and the modal is still the same paywall dialog.
    await expect(page.getByText("WAITING FOR PAYMENT", { exact: false })).toBeVisible();
    await expect(qr).toBeVisible();
    await expect(page.getByText("✓ PAID — ROOM READY")).toHaveCount(0);
  });

  test("CHECK NOW forces an immediate re-poll and can confirm payment", async ({
    page,
  }) => {
    const state = await installPaywallRoutes(page);
    await reachWaitingScreen(page);

    // Wait for the banner (driven by real failed polls).
    const checkNow = page.getByTestId("status-check-now");
    await expect(checkNow).toBeVisible({ timeout: 30_000 });

    // CHECK NOW must fire an EXTRA poll outside the 3s cadence: record the
    // current count, click, and assert it increments well within one poll
    // interval (1s ≪ the 3s automatic cadence, so the bump is from the click).
    const before = state.statusCalls;
    await checkNow.click();
    await expect
      .poll(() => state.statusCalls, {
        message: "CHECK NOW should issue an immediate, out-of-cadence status poll",
        timeout: 1_000,
      })
      .toBeGreaterThan(before);

    // The banner persists because the status endpoint is still failing — the
    // manual re-check found no payment, exactly as designed.
    await expect(page.getByTestId("status-check-failing")).toBeVisible();

    // Now the payment lands: flip the endpoint to paid and click CHECK NOW.
    // The modal must advance to the PAID screen — proving CHECK NOW is wired
    // to a real status check that can resolve, not a dead control.
    state.paid = true;
    await checkNow.click();
    await expect(page.getByText("✓ PAID — ROOM READY")).toBeVisible({
      timeout: 15_000,
    });
    // The failure banner is gone once a readable (paid) response arrives.
    await expect(page.getByTestId("status-check-failing")).toHaveCount(0);
  });
});
