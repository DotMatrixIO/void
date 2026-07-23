// SPDX-License-Identifier: AGPL-3.0-or-later
//
// End-to-end Playwright test for the paywall resume flow (pay → refresh → reopen).
//
// Requires the real API server running in mock-Lightning / jitter-disabled /
// development mode — see playwright.resume.config.ts. The API server provides:
//   - POST /api/paywall/invoice  (real invoice creation against the mock backend)
//   - POST /api/paywall/dev-pay/:hash  (test-only settle endpoint, dev mode only)
//   - GET  /api/paywall/status/:hash   (real status polling, mock backend)
//   - POST /api/paywall/ack-recovery   (real ack; intercepted here to count calls)
//
// Motivation: the resume flow was covered only by jsdom unit tests with fetch
// mocks (PaywallModal.test.tsx + StartScreen.test.tsx). Those tests cannot verify:
//   - that sessionStorage actually survives a real page.reload()
//   - that apiUrl() builds the correct BASE_URL-prefixed URL against the real
//     browser fetch stack (a base-path misconfiguration would fail here but pass
//     in jsdom)
//   - that the real mock-Lightning backend records and re-reports the payment
//     correctly across two distinct browser sessions (pre-reload and post-reload)
//   - that the full StartScreen → PaywallModal resumePaymentHash prop chain works
//     end-to-end with no mocking
//
// The full round trip exercised:
//   1. HOST A ROOM → CONTINUE → real invoice created → modal in WAITING phase.
//   2. Click [DEV] SIMULATE PAYMENT → real dev-pay endpoint settles the invoice
//      → real status poll detects payment → modal advances to PAID screen.
//      Both void_token and void_payment_hash are written to sessionStorage.
//   3. page.reload() — the host closed the tab / refreshed before clicking
//      OPEN ROOM. This is the interrupted-flow scenario the resume feature
//      exists to handle.
//   4. HOST A ROOM → StartScreen reads void_payment_hash from sessionStorage →
//      opens the paywall modal in resume mode (WAITING phase, no invoice/QR UI).
//   5. The live 3s poll loop re-polls the real status endpoint → the mock backend
//      still reports the invoice as paid (same server process) → modal advances
//      to PAID with a recovery code (server has not received an ack yet).
//   6. Host opens the recovery-code disclosure, clicks OPEN ROOM → real
//      POST /api/paywall/ack-recovery fires exactly once → void_payment_hash is
//      cleared from sessionStorage.
//
// Run with:
//   pnpm --filter @workspace/void-client run test:playwright:resume

import { test, expect } from "@playwright/test";

test.describe("paywall resume flow (real API server, real reload)", () => {
  test("pay → reload → HOST A ROOM resumes → OPEN ROOM acks and clears sessionStorage", async ({
    page,
  }) => {
    // Track real ack calls. We intercept and CONTINUE (not fulfill) so the
    // real endpoint also runs — we're only counting, not replacing the response.
    let ackCalls = 0;
    await page.route("**/api/paywall/ack-recovery", async (route) => {
      ackCalls += 1;
      await route.continue();
    });

    // ── Phase 1: initial payment flow ────────────────────────────────────

    await page.goto("/");

    // Open the paywall modal.
    await page.getByRole("button", { name: "HOST A ROOM" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // The default tier is pre-selected; CONTINUE calls the real invoice
    // endpoint which creates an invoice on the mock Lightning backend.
    await dialog.getByRole("button", { name: "CONTINUE" }).click();

    // WAITING screen: "WAITING FOR PAYMENT" confirms the real backend
    // responded with an invoice and the modal advanced to the waiting phase.
    await expect(page.getByText("WAITING FOR PAYMENT", { exact: false })).toBeVisible({
      timeout: 30_000,
    });

    // The [DEV] SIMULATE PAYMENT button is rendered in DEV mode when an invoice
    // is present (PaywallModal.tsx: `{import.meta.env.DEV && (...)}`). Clicking
    // it calls POST /api/paywall/dev-pay/:paymentHash on the real server,
    // which marks the invoice as paid in the mock backend's in-memory state so
    // the next status poll returns paid: true.
    const devPayBtn = page.getByRole("button", { name: /SIMULATE PAYMENT/i });
    await expect(devPayBtn).toBeVisible({ timeout: 10_000 });
    await devPayBtn.click();

    // The live 3s poll loop detects payment from the real status endpoint and
    // advances the modal to the PAID screen. Give it extra time: the first poll
    // after dev-pay may need up to 3s to fire, and the real server processes it.
    await expect(page.getByText("✓ PAID — ROOM READY")).toBeVisible({ timeout: 30_000 });

    // Both sessionStorage keys must be present before the reload.
    const hashBeforeReload = await page.evaluate(() =>
      sessionStorage.getItem("void_payment_hash"),
    );
    const tokenBeforeReload = await page.evaluate(() =>
      sessionStorage.getItem("void_token"),
    );
    expect(hashBeforeReload).toBeTruthy();
    expect(tokenBeforeReload).toBeTruthy();

    // No ack yet — we're about to reload before the host clicks OPEN ROOM.
    expect(ackCalls).toBe(0);

    // ── Phase 2: reload (the interrupt this feature handles) ─────────────

    await page.reload();

    // After reload the landing page renders. sessionStorage must still carry
    // both keys — this is the core integration the feature depends on.
    const hashAfterReload = await page.evaluate(() =>
      sessionStorage.getItem("void_payment_hash"),
    );
    const tokenAfterReload = await page.evaluate(() =>
      sessionStorage.getItem("void_token"),
    );
    expect(hashAfterReload).toBeTruthy();
    expect(tokenAfterReload).toBeTruthy();
    // The hash must be the same value written before reload.
    expect(hashAfterReload).toBe(hashBeforeReload);

    // ── Phase 3: resume flow ──────────────────────────────────────────────

    // HOST A ROOM: StartScreen finds void_token (valid, non-expired) +
    // void_payment_hash → opens the paywall modal in resume mode, skipping the
    // tier picker and invoice creation, opening straight on the WAITING screen.
    await expect(page.getByRole("button", { name: "HOST A ROOM" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "HOST A ROOM" }).click();

    const resumeDialog = page.getByRole("dialog");
    await expect(resumeDialog).toBeVisible({ timeout: 15_000 });

    // In resume mode the modal opens directly in the WAITING phase with no
    // invoice string (invoice state is ""). The real 3s poll loop fires
    // immediately and re-polls the real status endpoint. The mock backend still
    // reports the invoice as paid (same server process, in-memory state
    // survives the reload), so the modal advances to PAID quickly.
    await expect(page.getByText("✓ PAID — ROOM READY")).toBeVisible({ timeout: 30_000 });

    // ── Phase 4: open recovery disclosure before OPEN ROOM ───────────────

    // The recovery-code toggle button is visible because the server re-includes
    // the code (no ack received yet for this payment hash).
    // PaywallModal's confirmSkip guard fires if OPEN ROOM is clicked while
    // recoveryDetailsOpen is false — opening the disclosure first bypasses it
    // and lets us assert ack + sessionStorage cleanup cleanly.
    const recoveryToggle = resumeDialog.getByRole("button", {
      name: /PAYMENT DETAILS/i,
    });
    await expect(recoveryToggle).toBeVisible({ timeout: 10_000 });
    await recoveryToggle.click();

    // The `#paywall-recovery-details` panel must now be visible and contain the
    // recovery code (a span with wordSpacing applied to space out the BIP-39
    // words). Asserting panel visibility confirms the server supplied a code.
    const recoveryPanel = resumeDialog.locator("#paywall-recovery-details");
    await expect(recoveryPanel).toBeVisible({ timeout: 5_000 });
    // The recovery code text is inside a span that wraps the BIP-39 words.
    const codeSpan = recoveryPanel.locator("span").filter({ hasText: /\w+\s+\w+/ });
    await expect(codeSpan.first()).toBeVisible({ timeout: 5_000 });

    // ── Phase 5: OPEN ROOM → ack fires, sessionStorage cleared ───────────

    expect(ackCalls).toBe(0);

    await resumeDialog.getByRole("button", { name: "OPEN ROOM" }).click();

    // The ack endpoint must be hit exactly once. It is fire-and-forget (the
    // component does not await it before calling onSuccess), so we poll briefly.
    await expect
      .poll(() => ackCalls, {
        message:
          "real POST /api/paywall/ack-recovery should be called exactly once after OPEN ROOM",
        timeout: 5_000,
      })
      .toBe(1);

    // void_payment_hash must be removed from sessionStorage by onSuccess.
    const hashAfterOpen = await page.evaluate(() =>
      sessionStorage.getItem("void_payment_hash"),
    );
    expect(hashAfterOpen).toBeNull();
  });
});
