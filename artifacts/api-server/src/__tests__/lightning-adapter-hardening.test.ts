// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Lightning adapter contract:
//  - per-invoice 16-char random hex memo on every adapter, no brand prefix.
//  - Zod-parsed adapter responses; shape drift fails closed with a typed
//    LightningBackendShapeError instead of producing undefined invoices.

describe("generateInvoiceMemo", () => {
  it("returns 16-char hex with no VOID prefix", async () => {
    const { generateInvoiceMemo, INVOICE_MEMO_LENGTH } = await import(
      "../services/lightning"
    );
    expect(INVOICE_MEMO_LENGTH).toBe(16);
    for (let i = 0; i < 50; i++) {
      const memo = generateInvoiceMemo();
      expect(memo).toHaveLength(16);
      expect(memo).toMatch(/^[0-9a-f]{16}$/);
      expect(memo.toLowerCase()).not.toContain("void");
    }
  });

  it("produces unique memos across many invocations", async () => {
    const { generateInvoiceMemo } = await import("../services/lightning");
    const N = 1000;
    const seen = new Set<string>();
    for (let i = 0; i < N; i++) seen.add(generateInvoiceMemo());
    expect(seen.size).toBe(N);
  });
});

describe("LNbits adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LIGHTNING_BACKEND = "lnbits";
    process.env.LNBITS_URL = "http://lnbits.test";
    process.env.LNBITS_API_KEY = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIGHTNING_BACKEND;
    delete process.env.LNBITS_URL;
    delete process.env.LNBITS_API_KEY;
  });

  function stubFetchOnce(body: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(body), { status: ok ? 200 : 500 }),
      ),
    );
  }

  it("rejects empty object", async () => {
    stubFetchOnce({});
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects payment_hash without an invoice string", async () => {
    stubFetchOnce({ payment_hash: "abc123" });
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects wrong-typed payment_hash", async () => {
    stubFetchOnce({ payment_hash: 12345, payment_request: "lnbc..." });
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("accepts payment_request branch", async () => {
    stubFetchOnce({ payment_hash: "hash-1", payment_request: "lnbc-invoice-1" });
    const { createInvoice } = await import("../services/lightning");
    const inv = await createInvoice(100);
    expect(inv.paymentHash).toBe("hash-1");
    expect(inv.invoice).toBe("lnbc-invoice-1");
  });

  it("accepts bolt11 branch", async () => {
    stubFetchOnce({ payment_hash: "hash-2", bolt11: "lnbc-invoice-2" });
    const { createInvoice } = await import("../services/lightning");
    const inv = await createInvoice(100);
    expect(inv.paymentHash).toBe("hash-2");
    expect(inv.invoice).toBe("lnbc-invoice-2");
  });

  it("sends a random hex memo on the outbound request (no VOID string)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ payment_hash: "h", payment_request: "lnbc-x" }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createInvoice } = await import("../services/lightning");
    await createInvoice(100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.memo).toMatch(/^[0-9a-f]{16}$/);
    expect(body.memo).not.toContain("VOID");
  });
});

describe("BTCPay adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LIGHTNING_BACKEND = "btcpay";
    process.env.BTCPAY_URL = "http://btcpay.test";
    process.env.BTCPAY_API_KEY = "test-key";
    process.env.BTCPAY_STORE_ID = "store-1";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIGHTNING_BACKEND;
    delete process.env.BTCPAY_URL;
    delete process.env.BTCPAY_API_KEY;
    delete process.env.BTCPAY_STORE_ID;
  });

  function stubFetchSeq(responses: Array<{ body: unknown; ok?: boolean }>) {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const r = responses[n++];
        if (!r) throw new Error("unexpected fetch call");
        return new Response(JSON.stringify(r.body), { status: r.ok === false ? 500 : 200 });
      }),
    );
  }

  it("rejects invoice response missing id", async () => {
    stubFetchSeq([{ body: {} }]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects payment-methods response that is not an array", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: { not: "an array" } },
    ]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects Lightning method missing destination", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: [{ paymentMethodId: "BTC-LightningNetwork", amount: "100" }] },
    ]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects Lightning method missing amount", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: [{ paymentMethodId: "BTC-LightningNetwork", destination: "lnbc-x" }] },
    ]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects when paymentMethodId is present but no Lightning entry exists", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: [{ paymentMethodId: "BTC-OnChain", destination: "bc1...", amount: "100" }] },
    ]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("rejects an empty paymentMethods array", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: [] },
    ]);
    const { createInvoice, LightningBackendShapeError } = await import(
      "../services/lightning"
    );
    await expect(createInvoice(100)).rejects.toBeInstanceOf(LightningBackendShapeError);
  });

  it("accepts a well-formed BTCPay response", async () => {
    stubFetchSeq([
      { body: { id: "inv-1" } },
      { body: [{ paymentMethodId: "BTC-LightningNetwork", destination: "lnbc-good", amount: "100" }] },
    ]);
    const { createInvoice } = await import("../services/lightning");
    const inv = await createInvoice(100);
    expect(inv.paymentHash).toBe("inv-1");
    expect(inv.invoice).toBe("lnbc-good");
  });

  it("sends a random hex itemDesc on the outbound BTCPay invoice request (no VOID)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: "inv-1" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createInvoice } = await import("../services/lightning");
    // Only the first (POST invoices) call is observed before the second
    // (GET payment-methods) call throws — that is sufficient to assert the
    // outbound memo. Allow the awaited promise to reject; we then inspect
    // the recorded fetch calls.
    await expect(createInvoice(100)).rejects.toBeDefined();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.metadata?.itemDesc).toMatch(/^[0-9a-f]{16}$/);
    expect(body.metadata?.itemDesc).not.toContain("VOID");
  });
});

describe("mock adapter", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LIGHTNING_BACKEND;
  });

  it("returns an invoice with a 64-hex paymentHash that round-trips through the schema", async () => {
    const { createInvoice } = await import("../services/lightning");
    const inv = await createInvoice(100);
    expect(inv.paymentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inv.invoice.length).toBeGreaterThan(0);
  });
});
