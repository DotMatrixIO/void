// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import express from "express";
import { digestPaymentHash } from "../lib/paymentHashDigest";

// ── paymentHash redaction in operator logs (Task #881) ───────────────────────
//
// Two warn-level paths in the paywall route used to record the RAW 64-hex
// paymentHash — the same identifier that appears in Lightning settlement
// records — to operator logs. Anyone with log access could correlate a VOID
// room/payment against Lightning-side data.
//
// These tests pin the fix from the OUTPUT side, not the field side: we spy on
// logger.warn, trigger each warn path with a known 64-hex hash, render the
// FULL logged payload (bindings object + message) to a string, and assert:
//   1. No /[0-9a-f]{64}/ run appears anywhere in the rendered line, so a
//      future contributor who adds a raw hash to a NEW warn message on these
//      paths is also caught — not just the one field we know about today.
//   2. The non-reversible triage digest IS present, so operators keep enough
//      to line up log lines about the same payment.
//
// We mock ONLY checkPayment so we can drive both branches deterministically:
//   - throw LightningBackendUnavailableError → the 503 "backend unavailable"
//     warn path.
//   - return true for a hash that has no in-memory invoice-state entry → the
//     "no in-memory tier mapping" warn path.

// A valid-shaped 64-hex paymentHash that passes the route's :paymentHash guard.
const HASH = "a".repeat(64);

/** Render a captured logger.warn(obj, msg) call the way it lands in the log:
 *  the structured bindings plus the message string, as one searchable line. */
function renderWarn(call: unknown[]): string {
  const [obj, msg] = call;
  return `${JSON.stringify(obj)} ${typeof msg === "string" ? msg : ""}`;
}

describe("paywall logs redact the raw paymentHash (Task #881)", () => {
  let httpServer: HttpServer;
  let baseUrl: string;
  let failCheck = false;
  let logger: typeof import("../lib/logger")["logger"];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    failCheck = false;
    vi.resetModules();
    vi.doMock("../services/lightning", async () => {
      const actual = await vi.importActual<typeof import("../services/lightning")>(
        "../services/lightning",
      );
      return {
        ...actual,
        checkPayment: vi.fn(async (paymentHash: string) => {
          if (failCheck) {
            throw new actual.LightningBackendUnavailableError(
              "Lightning backend did not respond within 8000ms",
            );
          }
          // For the missing-tier-mapping path we need a "paid" result for a
          // hash that was never registered via /invoice, so force true.
          return true;
        }),
      };
    });

    ({ logger } = await import("../lib/logger"));
    warnSpy = vi.spyOn(logger, "warn");
    const paywall = await import("../routes/paywall");
    paywall.__testing.overrideJitter(0);

    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.use("/api", paywall.default);
    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => resolve());
    });
    const addr = httpServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    await new Promise<void>((r) => httpServer.close(() => r()));
    vi.doUnmock("../services/lightning");
    vi.resetModules();
  });

  it("the Lightning-backend-unavailable (503) warn carries the digest, never the raw hash", async () => {
    failCheck = true;
    const res = await fetch(`${baseUrl}/api/paywall/status/${HASH}`);
    expect(res.status).toBe(503);

    const warnCall = warnSpy.mock.calls.find((c: unknown[]) =>
      String(c[1] ?? "").includes("Lightning backend unavailable"),
    );
    expect(warnCall).toBeDefined();

    const line = renderWarn(warnCall!);
    // No full 64-hex anywhere in the rendered line (catches a future raw hash
    // in any field or in the message, not just the field we know about).
    expect(line).not.toMatch(/[0-9a-f]{64}/i);
    // The triage digest is present and is the expected non-reversible value.
    expect((warnCall![0] as { paymentHashDigest?: string }).paymentHashDigest).toBe(
      digestPaymentHash(HASH),
    );
  });

  it("the missing-tier-mapping warn carries the digest, never the raw hash", async () => {
    // checkPayment returns true but no invoiceStates entry exists for HASH,
    // so the handler hits the "no in-memory tier mapping" warn path.
    const res = await fetch(`${baseUrl}/api/paywall/status/${HASH}`);
    expect(res.status).toBe(200);

    const warnCall = warnSpy.mock.calls.find((c: unknown[]) =>
      String(c[1] ?? "").includes("no in-memory tier mapping"),
    );
    expect(warnCall).toBeDefined();

    const line = renderWarn(warnCall!);
    expect(line).not.toMatch(/[0-9a-f]{64}/i);
    expect((warnCall![0] as { paymentHashDigest?: string }).paymentHashDigest).toBe(
      digestPaymentHash(HASH),
    );
  });
});

describe("digestPaymentHash (Task #881)", () => {
  it("is a 12-char lowercase hex prefix of sha256, deterministic, and non-identity", () => {
    const d = digestPaymentHash(HASH);
    expect(d).toMatch(/^[0-9a-f]{12}$/);
    // Deterministic.
    expect(digestPaymentHash(HASH)).toBe(d);
    // Never the raw input, and contains no 64-hex run.
    expect(d).not.toBe(HASH);
    expect(d).not.toMatch(/[0-9a-f]{64}/i);
    // Distinct inputs yield distinct digests.
    expect(digestPaymentHash("b".repeat(64))).not.toBe(d);
  });
});
