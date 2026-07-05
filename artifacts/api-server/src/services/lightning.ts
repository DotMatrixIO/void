// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import { z } from "zod";
import { publishNtfy } from "../lib/ntfy";

// 8s covers normal LNbits/BTCPay response times (<1s) plus generous
// slack for slow Tor circuits. Beyond 8s, fail fast — the user is
// better served by a clear error than a hung spinner. Operators
// self-hosting on slow hardware (Raspberry Pi) or behind a slow Tor
// first-hop can raise this with the LIGHTNING_FETCH_TIMEOUT_MS env
// var, up to a hard ceiling that keeps a real outage from hiding
// behind a minutes-long spinner.
export const DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS = 8_000;
// Lower bound: a sub-second deadline would fire before a healthy
// backend can answer, turning every payment into a false outage.
export const MIN_LIGHTNING_FETCH_TIMEOUT_MS = 1_000;
// Upper bound: past 30s the spinner stops being a wait and becomes a
// hang. Capping here means a genuinely dead backend still surfaces a
// typed 503 in bounded time instead of being masked by a generous knob.
export const MAX_LIGHTNING_FETCH_TIMEOUT_MS = 30_000;

/** Resolve the Lightning backend fetch deadline (ms) from the
 *  `LIGHTNING_FETCH_TIMEOUT_MS` env var, falling back to
 *  `DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS`. The parsed value is clamped to
 *  `[MIN_LIGHTNING_FETCH_TIMEOUT_MS, MAX_LIGHTNING_FETCH_TIMEOUT_MS]`;
 *  anything non-numeric, non-finite, or non-positive falls back to the
 *  default. Out-of-range and invalid values emit a single operator-facing
 *  warning so a typo (e.g. `8` instead of `8000`) is visible rather than
 *  silently degrading payments. Evaluated once at module load. */
export function resolveLightningFetchTimeoutMs(): number {
  const raw = process.env["LIGHTNING_FETCH_TIMEOUT_MS"];
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[lightning] ignoring invalid LIGHTNING_FETCH_TIMEOUT_MS="${raw}"; ` +
        `using default ${DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS}ms`,
    );
    return DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS;
  }
  const rounded = Math.round(parsed);
  if (rounded < MIN_LIGHTNING_FETCH_TIMEOUT_MS) {
    console.warn(
      `[lightning] LIGHTNING_FETCH_TIMEOUT_MS=${raw} below minimum; ` +
        `clamping to ${MIN_LIGHTNING_FETCH_TIMEOUT_MS}ms`,
    );
    return MIN_LIGHTNING_FETCH_TIMEOUT_MS;
  }
  if (rounded > MAX_LIGHTNING_FETCH_TIMEOUT_MS) {
    console.warn(
      `[lightning] LIGHTNING_FETCH_TIMEOUT_MS=${raw} above maximum; ` +
        `clamping to ${MAX_LIGHTNING_FETCH_TIMEOUT_MS}ms`,
    );
    return MAX_LIGHTNING_FETCH_TIMEOUT_MS;
  }
  return rounded;
}

const LIGHTNING_FETCH_TIMEOUT_MS = resolveLightningFetchTimeoutMs();

/** Build the one-line startup-banner string reporting the *effective*
 *  Lightning fetch timeout, given the already-resolved value and the raw
 *  env input. Kept pure (no re-resolution, no env read) so it can be unit
 *  tested and so the operator-facing warnings in `resolveLightningFetchTimeoutMs`
 *  are not emitted a second time at banner time.
 *
 *  When the operator set `LIGHTNING_FETCH_TIMEOUT_MS`, the suffix confirms
 *  whether the value was taken as-is, clamped into range, or rejected as
 *  invalid and replaced by the default — so a self-hoster can verify from
 *  the logs that their override actually took effect. */
export function describeLightningFetchTimeout(
  effectiveMs: number,
  rawEnv: string | undefined,
): string {
  const base = `Lightning: fetch timeout ${effectiveMs}ms`;
  if (rawEnv === undefined || rawEnv.trim() === "") {
    return `${base} (default; LIGHTNING_FETCH_TIMEOUT_MS unset)`;
  }
  const parsed = Number(rawEnv);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return (
      `${base} (default; ignored invalid ` +
      `LIGHTNING_FETCH_TIMEOUT_MS="${rawEnv}")`
    );
  }
  const requested = Math.round(parsed);
  if (requested !== effectiveMs) {
    return (
      `${base} (clamped from requested ${requested}ms set via ` +
      `LIGHTNING_FETCH_TIMEOUT_MS)`
    );
  }
  return `${base} (set via LIGHTNING_FETCH_TIMEOUT_MS)`;
}

/** The startup-banner line for the effective Lightning fetch timeout, built
 *  from the value resolved once at module load. index.ts logs this at INFO
 *  alongside the ICE/TURN posture lines. */
export function lightningFetchTimeoutStartupLine(): string {
  return describeLightningFetchTimeout(
    LIGHTNING_FETCH_TIMEOUT_MS,
    process.env["LIGHTNING_FETCH_TIMEOUT_MS"],
  );
}

/** The configured Lightning backend name, normalized to lower case and
 *  defaulting to `mock` when `LIGHTNING_BACKEND` is unset — the same
 *  resolution `resolveAdapter` applies, exposed for the effective-config
 *  startup summary without building (or validating the creds of) an adapter. */
export function configuredLightningBackend(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (env["LIGHTNING_BACKEND"] ?? "mock").toLowerCase();
}

/** One-line Lightning posture for the consolidated effective-config startup
 *  summary: the configured backend plus the effective fetch timeout (reusing
 *  the already-resolved module value, so no re-resolution and no second
 *  emission of the clamp/invalid warnings). */
export function lightningConfigSummary(): string {
  const timeout = describeLightningFetchTimeout(
    LIGHTNING_FETCH_TIMEOUT_MS,
    process.env["LIGHTNING_FETCH_TIMEOUT_MS"],
  ).replace(/^Lightning:\s*/, "");
  return `backend=${configuredLightningBackend()}, ${timeout}`;
}

/** Typed failure surfaced from `lightningFetch` when the backend does not
 *  respond within `LIGHTNING_FETCH_TIMEOUT_MS`. The paywall route maps this
 *  to HTTP 503 `{ error: "LIGHTNING_BACKEND_UNAVAILABLE" }` so the
 *  PaywallModal can show a typed "service slow to respond" message rather
 *  than spinning indefinitely. */
export class LightningBackendUnavailableError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "LightningBackendUnavailableError";
    if (cause !== undefined) this.cause = cause;
  }
}

/** Wrap a fetch with an AbortController that fires at
 *  `LIGHTNING_FETCH_TIMEOUT_MS`. AbortError is re-thrown as a typed
 *  `LightningBackendUnavailableError` so the caller (and the paywall route
 *  one level up) can map it to a 503 without sniffing error.name strings. */
async function lightningFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIGHTNING_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new LightningBackendUnavailableError(
        `Lightning backend did not respond within ${LIGHTNING_FETCH_TIMEOUT_MS}ms`,
        err,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface Invoice {
  invoice: string;
  paymentHash: string;
}

interface PendingInvoice {
  invoice: string;
  amountSats: number;
  createdAt: number;
  paid: boolean;
  /** Sats actually received for this invoice, if a settlement amount was
   *  injected via `simulatePayment(hash, receivedSats)`. Only the mock
   *  backend consults this — real BOLT11 invoices are amount-bound by the
   *  Lightning protocol, so the field stays `undefined` on those paths and
   *  settlement is amount-agnostic. Lets tests exercise the under/overpayment
   *  matrix without touching production adapters. */
  paidAmountSats?: number;
}

const INVOICE_TTL_MS = 15 * 60 * 1000;

const pending = new Map<string, PendingInvoice>();

// 60s sweep cadence for the in-memory pending-invoice map (Task #265).
// Worst-case overshoot is one full sweep past INVOICE_TTL_MS, which is
// well inside the JWT clamp window minted by /paywall/status. A faster
// cadence would burn CPU for no benefit; a slower one starts letting
// recovery codes outlive their paid window before GC. The map is the
// only retention surface — there is no DB.
setInterval(() => {
  const now = Date.now();
  for (const [hash, inv] of pending) {
    if (now - inv.createdAt > INVOICE_TTL_MS) {
      pending.delete(hash);
    }
  }
}, 60_000);

function randomHex(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}

/** Failure surfaced when a Lightning backend's JSON response does not match
 *  the adapter's Zod schema. Distinct from `LightningBackendUnavailableError`
 *  (timeout/network) so callers can react differently to shape drift. */
export class LightningBackendShapeError extends Error {
  readonly issues: z.ZodIssue[];
  readonly backend: string;
  constructor(backend: string, issues: z.ZodIssue[]) {
    super(`Lightning backend "${backend}" returned an unexpected response shape`);
    this.name = "LightningBackendShapeError";
    this.backend = backend;
    this.issues = issues;
  }
}

/** 16-char random hex memo for every outbound invoice on every adapter.
 *  Carries no brand string so the memo is not a fingerprint for traffic
 *  observers; operators link invoices back to sessions via `paymentHash`. */
export const INVOICE_MEMO_LENGTH = 16;
export function generateInvoiceMemo(): string {
  return crypto.randomBytes(INVOICE_MEMO_LENGTH / 2).toString("hex");
}

// LNbits: at least one of payment_request / bolt11 must be present.
const lnbitsInvoiceSchema = z
  .object({
    payment_hash: z.string().min(1),
    payment_request: z.string().min(1).optional(),
    bolt11: z.string().min(1).optional(),
  })
  .refine((d) => d.payment_request !== undefined || d.bolt11 !== undefined, {
    message: "LNbits response missing payment_request and bolt11",
  });

const lnbitsStatusSchema = z.object({
  paid: z.boolean().optional(),
});

const btcpayInvoiceSchema = z.object({
  id: z.string().min(1),
});

// BTCPay: destination and amount are required non-empty strings.
// paymentMethodId is a hint we use to locate the Lightning row.
const btcpayPaymentMethodSchema = z.object({
  paymentMethodId: z.string().optional(),
  destination: z.string().min(1),
  amount: z.string().min(1),
});

type BtcpayPaymentMethod = z.infer<typeof btcpayPaymentMethodSchema>;

function isLightningMethod(m: BtcpayPaymentMethod): boolean {
  return (
    m.paymentMethodId?.includes("LightningNetwork") === true ||
    m.paymentMethodId?.includes("BTC-LN") === true
  );
}

// Parses to a non-empty tuple [BtcpayPaymentMethod, ...BtcpayPaymentMethod[]]
// so consumers can pull a Lightning row without a separate emptiness guard.
// If any row carries a paymentMethodId, at least one must be Lightning;
// older BTCPay responses that omit paymentMethodId fall through to the
// first row as the Lightning method by convention.
const btcpayPaymentMethodsSchema = z
  .array(btcpayPaymentMethodSchema)
  .nonempty({ message: "BTCPay returned an empty paymentMethods array" })
  .superRefine((methods, ctx) => {
    const hasIds = methods.some((m) => m.paymentMethodId !== undefined);
    if (hasIds && !methods.some(isLightningMethod)) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentMethods"],
        message: "BTCPay returned no Lightning paymentMethod",
      });
    }
  });

const btcpayStatusSchema = z.object({
  status: z.string().optional(),
});

function parseOrThrow<T>(backend: string, schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Single operator-facing log line; no payload echo (avoids leaking
    // invoice strings / operator-side identifiers from the backend).
    console.error(
      `[lightning] adapter response shape mismatch backend=${backend} issues=${result.error.issues.length}`,
    );
    // Page the operator (Task #274). Deduped per backend + the specific set of
    // failing field paths, so a backend stuck returning one bad shape pages
    // once, but a genuinely DIFFERENT drift (a new field path) pages again.
    // The issue PATHS (not values) are safe to include — they are schema field
    // names, never invoice strings or backend-side identifiers.
    const paths = result.error.issues
      .map((i) => i.path.join("."))
      .sort()
      .join(", ");
    void publishNtfy({
      title: "VOID: Lightning response shape drift",
      message:
        `Lightning backend "${backend}" returned an unexpected response shape. ` +
        `Invoice creation / status checks will fail until it is fixed. ` +
        `Mismatched fields: ${paths || "(unknown)"}.`,
      priority: "high",
      tags: ["zap", "warning"],
      dedupeKey: `lightning-shape:${backend}:${paths}`,
    });
    throw new LightningBackendShapeError(backend, result.error.issues);
  }
  return result.data;
}

interface LightningAdapter {
  createInvoice(amountSats: number): Promise<Invoice>;
  checkPayment(paymentHash: string): Promise<boolean>;
}

function buildMockAdapter(): LightningAdapter {
  return {
    async createInvoice(amountSats: number): Promise<Invoice> {
      const paymentHash = randomHex(32);
      const mockBolt11 =
        `lnbc${amountSats}n1p0mock${paymentHash.slice(0, 20)}` +
        `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`;

      // Mock routes through the LNbits schema so test paths stay symmetric.
      const parsed = parseOrThrow("mock", lnbitsInvoiceSchema, {
        payment_hash: paymentHash,
        payment_request: mockBolt11,
      });
      const invoice = parsed.payment_request ?? parsed.bolt11 ?? "";

      pending.set(paymentHash, {
        invoice,
        amountSats,
        createdAt: Date.now(),
        paid: false,
      });

      return { invoice, paymentHash };
    },

    async checkPayment(paymentHash: string): Promise<boolean> {
      const entry = pending.get(paymentHash);
      if (!entry) return false;
      if (Date.now() - entry.createdAt > INVOICE_TTL_MS) {
        pending.delete(paymentHash);
        return false;
      }
      if (!entry.paid) return false;

      // Amount-aware settlement (mock backend only). When a test injects a
      // received amount via simulatePayment(hash, receivedSats), enforce the
      // same outcomes a real Lightning backend would produce:
      if (entry.paidAmountSats !== undefined) {
        if (entry.paidAmountSats < entry.amountSats) {
          // Underpayment: a partial payment never settles a BOLT11 invoice,
          // so the host stays unpaid and no room token is ever minted.
          return false;
        }
        if (entry.paidAmountSats > entry.amountSats) {
          // Overpayment: accept-and-log. The host paid more than the tier
          // price; we honor the room rather than stranding their funds, and
          // emit a single operator-facing line so the discrepancy is visible.
          console.warn(
            `[lightning] overpayment accepted backend=mock expected=${entry.amountSats} received=${entry.paidAmountSats}`,
          );
        }
      }

      return true;
    },
  };
}

function buildLNbitsAdapter(): LightningAdapter {
  const url = process.env["LNBITS_URL"]!.replace(/\/$/, "");
  const apiKey = process.env["LNBITS_API_KEY"]!;

  return {
    async createInvoice(amountSats: number): Promise<Invoice> {
      const res = await lightningFetch(`${url}/api/v1/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({
          out: false,
          amount: amountSats,
          memo: generateInvoiceMemo(),
          unit: "sat",
        }),
      });

      if (!res.ok) {
        throw new Error(`LNbits createInvoice failed: ${res.status} ${res.statusText}`);
      }

      const data = parseOrThrow("lnbits", lnbitsInvoiceSchema, await res.json());
      const paymentHash: string = data.payment_hash;
      const invoice: string = data.payment_request ?? data.bolt11 ?? "";

      pending.set(paymentHash, {
        invoice,
        amountSats,
        createdAt: Date.now(),
        paid: false,
      });

      return { invoice, paymentHash };
    },

    async checkPayment(paymentHash: string): Promise<boolean> {
      const entry = pending.get(paymentHash);
      if (!entry) return false;
      if (Date.now() - entry.createdAt > INVOICE_TTL_MS) {
        pending.delete(paymentHash);
        return false;
      }
      if (entry.paid) return true;

      const res = await lightningFetch(`${url}/api/v1/payments/${paymentHash}`, {
        headers: { "X-Api-Key": apiKey },
      });

      if (!res.ok) return false;

      const data = parseOrThrow("lnbits", lnbitsStatusSchema, await res.json());
      if (data.paid === true) {
        entry.paid = true;
        return true;
      }
      return false;
    },
  };
}

function buildBTCPayAdapter(): LightningAdapter {
  const url = process.env["BTCPAY_URL"]!.replace(/\/$/, "");
  const apiKey = process.env["BTCPAY_API_KEY"]!;
  const storeId = process.env["BTCPAY_STORE_ID"]!;

  return {
    async createInvoice(amountSats: number): Promise<Invoice> {
      const res = await lightningFetch(
        `${url}/api/v1/stores/${storeId}/invoices`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `token ${apiKey}`,
          },
          body: JSON.stringify({
            amount: String(amountSats),
            currency: "SATS",
            // BTCPay uses metadata.itemDesc as the human-readable invoice
            // description that flows through to the bolt11 description hash;
            // randomize it for the same unlinkability reason as LNbits.
            metadata: { itemDesc: generateInvoiceMemo() },
            checkout: {
              paymentMethods: ["BTC-LightningNetwork"],
              expirationMinutes: 15,
            },
          }),
        },
      );

      if (!res.ok) {
        throw new Error(`BTCPay createInvoice failed: ${res.status} ${res.statusText}`);
      }

      const data = parseOrThrow("btcpay", btcpayInvoiceSchema, await res.json());
      const invoiceId: string = data.id;

      const pmRes = await lightningFetch(
        `${url}/api/v1/stores/${storeId}/invoices/${invoiceId}/payment-methods`,
        {
          headers: { Authorization: `token ${apiKey}` },
        },
      );

      if (!pmRes.ok) {
        throw new Error(`BTCPay payment-methods failed: ${pmRes.status}`);
      }

      const methods = parseOrThrow("btcpay", btcpayPaymentMethodsSchema, await pmRes.json());
      // `methods` is a non-empty tuple by schema, so `methods[0]` is typed
      // as a defined element — no separate emptiness guard required.
      const lnMethod = methods.find(isLightningMethod) ?? methods[0];
      const bolt11: string = lnMethod.destination;

      pending.set(invoiceId, {
        invoice: bolt11,
        amountSats,
        createdAt: Date.now(),
        paid: false,
      });

      return { invoice: bolt11, paymentHash: invoiceId };
    },

    async checkPayment(paymentHash: string): Promise<boolean> {
      const entry = pending.get(paymentHash);
      if (!entry) return false;
      if (Date.now() - entry.createdAt > INVOICE_TTL_MS) {
        pending.delete(paymentHash);
        return false;
      }
      if (entry.paid) return true;

      const res = await lightningFetch(
        `${url}/api/v1/stores/${storeId}/invoices/${paymentHash}`,
        {
          headers: { Authorization: `token ${apiKey}` },
        },
      );

      if (!res.ok) return false;

      const data = parseOrThrow("btcpay", btcpayStatusSchema, await res.json());
      if (data.status === "Settled" || data.status === "Processing") {
        entry.paid = true;
        return true;
      }
      return false;
    },
  };
}

function resolveAdapter(): LightningAdapter {
  const backend = (process.env["LIGHTNING_BACKEND"] ?? "mock").toLowerCase();

  if (backend === "lnbits") {
    const url = process.env["LNBITS_URL"];
    const key = process.env["LNBITS_API_KEY"];
    if (!url || !key) {
      throw new Error("LIGHTNING_BACKEND=lnbits requires LNBITS_URL and LNBITS_API_KEY environment variables");
    }
    return buildLNbitsAdapter();
  }

  if (backend === "btcpay") {
    const url = process.env["BTCPAY_URL"];
    const key = process.env["BTCPAY_API_KEY"];
    const store = process.env["BTCPAY_STORE_ID"];
    if (!url || !key || !store) {
      throw new Error("LIGHTNING_BACKEND=btcpay requires BTCPAY_URL, BTCPAY_API_KEY, and BTCPAY_STORE_ID environment variables");
    }
    return buildBTCPayAdapter();
  }

  if (backend !== "mock") {
    throw new Error(`Unknown LIGHTNING_BACKEND: "${backend}". Valid options: mock, lnbits, btcpay`);
  }

  return buildMockAdapter();
}

const adapter = resolveAdapter();

export async function createInvoice(amountSats: number): Promise<Invoice> {
  return adapter.createInvoice(amountSats);
}

export async function checkPayment(paymentHash: string): Promise<boolean> {
  return adapter.checkPayment(paymentHash);
}

/** Mark a pending invoice as paid (dev/mock backend only).
 *
 *  `receivedSats` records the amount the host supposedly paid. When omitted,
 *  settlement is amount-agnostic (the historical behavior — exact payment).
 *  When supplied, the mock adapter's `checkPayment` compares it against the
 *  invoice amount to model under/overpayment. This is the seam the abnormal-
 *  payment test matrix drives; production backends never call this. */
export function simulatePayment(paymentHash: string, receivedSats?: number): boolean {
  const entry = pending.get(paymentHash);
  if (!entry) return false;
  entry.paid = true;
  if (receivedSats !== undefined) entry.paidAmountSats = receivedSats;
  return true;
}
