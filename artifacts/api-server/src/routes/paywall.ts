// SPDX-License-Identifier: AGPL-3.0-or-later
import crypto from "node:crypto";
import { Router } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { createInvoice, checkPayment, simulatePayment, LightningBackendUnavailableError } from "../services/lightning";
import { logger } from "../lib/logger";
import { publishNtfy } from "../lib/ntfy";
import { digestPaymentHash } from "../lib/paymentHashDigest";
import { BIP39_WORDLIST } from "../lib/bip39";
import { markSecret, unwrapSecret, type Secret } from "@workspace/wire-core";
import { brandPaywallSecret } from "../lib/paywallSecret";
import { resolveTierPricing } from "../services/pricing";

export type Tier = "standard" | "day";

interface TierSpec {
  amountSats: number;
  jwtExpiresIn: SignOptions["expiresIn"];
  /** Same window as jwtExpiresIn, in seconds. Used to compute the wall-clock
   *  expiry of the recovery code so it dies in lockstep with the JWT it
   *  represents — recovery never extends a paid window past its original end. */
  windowSeconds: number;
}

const TIERS: Record<Tier, TierSpec> = {
  standard: { amountSats: 1000, jwtExpiresIn: "1h", windowSeconds: 60 * 60 },
  day: { amountSats: 5000, jwtExpiresIn: "24h", windowSeconds: 24 * 60 * 60 },
};

export function isValidTier(value: unknown): value is Tier {
  return value === "standard" || value === "day";
}

// ── Invoice state machine ───────────────────────────────────────────────────
//
// An invoice we created lives in `invoiceStates` until either:
//   (a) it was never paid and its 30-minute creation TTL has elapsed, or
//   (b) it was paid and its paid-window expiry has elapsed.
//
// On the FIRST poll that observes payment we mint the JWT, mint the recovery
// code, and stamp `settled = { token, expiresAt, recoveryRevealed: true }`
// onto the same entry. Subsequent polls of the same hash return the EXACT
// same token + expiresAt and OMIT the recovery code. This is the invariant
// that prevents a host from extending their paid window — or downgrading
// tier from day → standard — by re-polling /paywall/status.
//
// A poll that observes payment but has no `invoiceStates` entry (e.g. server
// restart wiped the in-memory state) loud-WARNs and falls through to a
// fresh standard-tier mint. We accept this restart-window edge case because
// the JWT secret is also regenerated on restart, so any prior token is
// already invalid; refusing service entirely would lose the host their
// payment.

interface InvoiceState {
  tier: Tier;
  /** Wall-clock ms when an UNPAID invoice should be GC'd. Unused once settled. */
  invoiceExpiresAt: number;
  settled?: {
    token: string;
    /** Wall-clock ms when the paid window (and thus the JWT) becomes invalid. */
    expiresAt: number;
    /** True once we've returned the recovery code to a client. We never reveal
     *  it twice — re-polls of /paywall/status must not leak a fresh code. */
    recoveryRevealed: boolean;
  };
}

const PENDING_INVOICE_TTL_MS = 30 * 60 * 1000;
const invoiceStates = new Map<string, InvoiceState>();

function gcInvoiceStates(): void {
  const now = Date.now();
  for (const [hash, entry] of invoiceStates) {
    const cutoff = entry.settled ? entry.settled.expiresAt : entry.invoiceExpiresAt;
    if (now >= cutoff) invoiceStates.delete(hash);
  }
}

// ── Recovery codes ──────────────────────────────────────────────────────────
//
// At successful payment we mint a one-time, human-typeable recovery code (4
// BIP-39 words ≈ 44 bits of entropy) bound to the SAME wall-clock expiry as
// the JWT it represents. The user is shown the code once with explicit "this
// is your only chance" framing — they choose whether to write it down. We
// never persist it to disk on the client. Redeem is single-shot.
//
// Threat model in two lines:
//  • A leaked code is exploitable until the original paid window ends.
//  • Brute-force is cost-prohibitive on a single map probe per request, but
//    we still validate format strictly to keep the matchable surface narrow.

interface RecoveryCode {
  /** Server-minted random replay-guard id carried in the JWT payload. Held
   *  here so /paywall/recover re-mints a JWT carrying the SAME `jti`, which
   *  keeps the original and recovered JWTs sharing one create-room slot
   *  (one settled invoice → one room). Decoupled from the Lightning
   *  `paymentHash` so nothing payment-derived reaches the client. */
  jti: string;
  /** Per-room random host-reclaim token, decoupled from `jti` (Task #886).
   *  Held here so /paywall/recover re-mints a JWT carrying the SAME token,
   *  letting a recovered host reclaim host on the original room. */
  reclaimToken: string;
  tier: Tier;
  /** Wall-clock ms when the code (and the JWT it can mint) becomes invalid. */
  expiresAt: number;
}

const RECOVERY_CODE_WORDS = 4;
const recoveryCodes = new Map<string, RecoveryCode>();

function gcRecoveryCodes(): void {
  const now = Date.now();
  for (const [code, entry] of recoveryCodes) {
    if (now >= entry.expiresAt) recoveryCodes.delete(code);
  }
}

/** Generate a 4-word BIP-39 recovery code using crypto.randomInt for unbiased
 *  selection. Re-rolls in the (vanishingly rare) event of a collision rather
 *  than overwriting an existing code. */
function generateRecoveryCode(): Secret<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const words: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_WORDS; i++) {
      words.push(BIP39_WORDLIST[crypto.randomInt(0, BIP39_WORDLIST.length)]);
    }
    const code = words.join(" ");
    // Brand at the declaration site of the freshly-minted recovery code.
    // The string is a credential — its holder can mint a fresh JWT for
    // the paid window via /paywall/recover.
    if (!recoveryCodes.has(code)) return markSecret(code);
  }
  // Statistically unreachable (2048^4 ≈ 1.76e13 codespace) — surface loudly
  // rather than silently overwriting an existing user's code.
  throw new Error("Failed to generate unique recovery code after 8 attempts");
}

/** Normalize user input: lowercase, collapse whitespace, then verify each
 *  word is in the BIP-39 list. We do NOT split on hyphens — codes are
 *  presented space-separated and that's the canonical form.
 *
 *  Validating BIP-39 membership (instead of just `[a-z]+`) lets a legit
 *  user fail fast on a transcription typo ("abandonn" → 400) instead of
 *  silently 404-ing at lookup time. There is no meaningful info leak to
 *  an attacker: any rational guess against a 2048-word codespace would
 *  already only contain BIP-39 words. */
const BIP39_SET = new Set(BIP39_WORDLIST);
function normalizeRecoveryCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (parts.length !== RECOVERY_CODE_WORDS) return null;
  for (const w of parts) {
    if (!/^[a-z]+$/.test(w)) return null;
    if (!BIP39_SET.has(w)) return null;
  }
  return parts.join(" ");
}

// ── Recover-endpoint rate limiting ──────────────────────────────────────────
//
// /paywall/recover accepts a 4-word BIP-39 code (~44 bits of entropy). That
// is a lot of guesses on paper, but at high RPS even a single-tier ($0.40
// "standard" room) makes brute-force economically interesting if the route
// is unrestricted. The general signaling rate limiter does not cover REST
// routes, so we apply a dedicated per-IP bucket here mirroring the shape
// already in use by /ice-servers.
//
// We also keep a coarse global counter that emits a WARN once per window
// when total attempts cross a threshold. This is observability — it does
// NOT block traffic — so a single attacker rotating through a botnet still
// surfaces in the logs even when no individual IP exceeds its bucket.
//
// State is module-level (not per-router) so a single attacker cannot reset
// their bucket by hitting the route through different router instances in
// the same process. Tests reset via __testing.resetRecoverRateLimit.

const RECOVER_RATE_WINDOW_MS = 60_000;
const RECOVER_RATE_MAX_PER_IP = 10;
const RECOVER_GLOBAL_WARN_THRESHOLD = 100;
// Audit L-01 (Task #461): above this global per-minute rate the endpoint
// short-circuits with 429 instead of merely logging. Per-IP cap stays at
// 10/min so legitimate single-user traffic is unaffected; this only fires
// during a botnet-shaped spike (the per-IP cap times tens of thousands of
// IPs). Threshold matches the audit recommendation.
const RECOVER_GLOBAL_BLOCK_THRESHOLD = 1000;

const recoverRateBuckets = new Map<string, { count: number; resetAt: number }>();
let recoverGlobalCount = 0;
let recoverGlobalResetAt = 0;
let recoverGlobalWarned = false;

function getClientIp(req: import("express").Request): string {
  // Use req.ip, which reflects the Express `trust proxy` setting (configured
  // in app.ts). With the default 1 hop, req.ip returns the rightmost entry
  // in `X-Forwarded-For` — the one the trusted reverse proxy itself appended,
  // i.e. the actual client. We deliberately do NOT use the leftmost XFF
  // token: that value is whatever the upstream client sent and is trivially
  // spoofable by any attacker, which would let them mint unlimited per-IP
  // rate-limit buckets and defeat the brute-force defense entirely.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function checkRecoverIpRate(ip: string): boolean {
  const now = Date.now();
  let bucket = recoverRateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RECOVER_RATE_WINDOW_MS };
    recoverRateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RECOVER_RATE_MAX_PER_IP;
}

function isRecoverGloballyBlocked(): boolean {
  // Read-only: callers check this AFTER tickRecoverGlobal has incremented
  // the counter for the current attempt, so the comparison correctly
  // reflects "this attempt would put us over the threshold".
  return recoverGlobalCount > RECOVER_GLOBAL_BLOCK_THRESHOLD;
}

function tickRecoverGlobal(): void {
  const now = Date.now();
  if (now > recoverGlobalResetAt) {
    recoverGlobalCount = 0;
    recoverGlobalResetAt = now + RECOVER_RATE_WINDOW_MS;
    recoverGlobalWarned = false;
  }
  recoverGlobalCount++;
  if (recoverGlobalCount > RECOVER_GLOBAL_WARN_THRESHOLD && !recoverGlobalWarned) {
    logger.warn(
      {
        attempts: recoverGlobalCount,
        windowMs: RECOVER_RATE_WINDOW_MS,
        threshold: RECOVER_GLOBAL_WARN_THRESHOLD,
      },
      "Global /paywall/recover attempt rate exceeded threshold — possible brute-force in progress",
    );
    recoverGlobalWarned = true;
  }
}

function resetRecoverRateLimit(): void {
  recoverRateBuckets.clear();
  recoverGlobalCount = 0;
  recoverGlobalResetAt = 0;
  recoverGlobalWarned = false;
}

// ── Payment-service slowness alerting (Task #274) ───────────────────────────
//
// A single 503 LIGHTNING_BACKEND_UNAVAILABLE is noise — a slow Tor first-hop,
// one congested channel. A *sustained* rate of them means new-room creation is
// effectively down and the operator needs to know without watching the logs.
// We aggregate 503s across BOTH /paywall/invoice and /paywall/status over a
// rolling window and page the operator (once per window) when the count
// crosses a threshold. publishNtfy is a no-op when ntfy is unconfigured.
const LIGHTNING_503_WINDOW_MS = 60_000;
const LIGHTNING_503_ALERT_THRESHOLD = 5;

let lightning503Count = 0;
let lightning503ResetAt = 0;
let lightning503Alerted = false;

function recordLightningUnavailable(): void {
  const now = Date.now();
  if (now > lightning503ResetAt) {
    lightning503Count = 0;
    lightning503ResetAt = now + LIGHTNING_503_WINDOW_MS;
    lightning503Alerted = false;
  }
  lightning503Count++;
  if (lightning503Count >= LIGHTNING_503_ALERT_THRESHOLD && !lightning503Alerted) {
    lightning503Alerted = true;
    const count = lightning503Count;
    void publishNtfy({
      title: "VOID: Lightning backend slow / unavailable",
      message:
        `${count} payment requests failed with 503 LIGHTNING_BACKEND_UNAVAILABLE in the last ` +
        `${LIGHTNING_503_WINDOW_MS / 1000}s. New rooms cannot be created until the Lightning backend ` +
        `responds. Existing calls are unaffected. See docs/incident-response.md §1.`,
      priority: "urgent",
      tags: ["zap", "rotating_light"],
      dedupeKey: "lightning-backend-unavailable",
      dedupeWindowMs: LIGHTNING_503_WINDOW_MS,
    });
  }
}

function resetLightning503Alert(): void {
  lightning503Count = 0;
  lightning503ResetAt = 0;
  lightning503Alerted = false;
}

// ── Settlement-to-delivery jitter (M-04 mitigation) ─────────────────────────
//
// A passive observer who can see both the Lightning settlement event and HTTPS
// traffic to this server can correlate "payment settled at T" with "new room
// appeared at T+ε" and link a payer identity to a hosted room (audit finding
// M-04). Adding a uniformly-random delay between settlement detection and token
// delivery widens the correlation window to [JITTER_MIN_MS, JITTER_MAX_MS],
// making timing correlation impractical over a single observation.
//
// The delay is applied ONLY on the first-paid branch of /paywall/status — not
// on re-polls (which return a cached token) and not on /paywall/recover (which
// is already delinked from settlement time by definition).
//
// Importantly, `expiresAt` and the JWT are computed BEFORE sleeping, so the
// paid window the host purchased starts at settlement time, not at delivery
// time. A 60-second jitter does not cost the host 60 seconds of their room.
//
// Self-hosters who do not need this protection can set PAYWALL_JITTER_DISABLE=1
// to skip the delay entirely. The window bounds are tunable via
// PAYWALL_JITTER_MIN_MS (default 10 000) and PAYWALL_JITTER_MAX_MS (default
// 60 000). If MIN >= MAX the jitter is effectively zero; the code treats that
// as opt-out and logs a warning.

const JITTER_MIN_MS = parseInt(process.env["PAYWALL_JITTER_MIN_MS"] ?? "10000", 10);
const JITTER_MAX_MS = parseInt(process.env["PAYWALL_JITTER_MAX_MS"] ?? "60000", 10);
const JITTER_DISABLED = process.env["PAYWALL_JITTER_DISABLE"] === "1";

if (!JITTER_DISABLED && JITTER_MIN_MS >= JITTER_MAX_MS) {
  logger.warn(
    { JITTER_MIN_MS, JITTER_MAX_MS },
    "PAYWALL_JITTER_MIN_MS >= PAYWALL_JITTER_MAX_MS — settlement jitter is effectively disabled. Set PAYWALL_JITTER_DISABLE=1 to suppress this warning.",
  );
}

/** Overridden by __testing.overrideJitter() in test suites to avoid sleeping. */
let _jitterOverride: number | null = null;

function settlementJitterMs(): number {
  if (_jitterOverride !== null) return _jitterOverride;
  if (JITTER_DISABLED || JITTER_MIN_MS >= JITTER_MAX_MS) return 0;
  return crypto.randomInt(JITTER_MIN_MS, JITTER_MAX_MS + 1);
}

// `PAYWALL_SECRET` is the HMAC key for the host-authorization JWT. It is
// branded with `Secret` at the declaration site (`brandPaywallSecret`)
// so the type survives through `jwt.sign` (here) and `jwt.verify`
// (`socketHandlers.ts`). The custom ESLint rule
// `no-secret-equality` follows the brand and flags `===` / `==` /
// `Buffer.equals` against any value statically inferred to carry it.
let PAYWALL_SECRET: Secret<string>;
if (process.env["PAYWALL_SECRET"]) {
  PAYWALL_SECRET = brandPaywallSecret(process.env["PAYWALL_SECRET"]);
} else {
  PAYWALL_SECRET = brandPaywallSecret(crypto.randomBytes(32).toString("hex"));
  logger.warn("PAYWALL_SECRET not set — generated ephemeral secret. All JWTs will be invalidated on restart (by design for single-instance deployments).");
}

export interface CreatePaywallRouterOptions {
  /** Override the JWT signing secret. When omitted, falls back to the
   *  module-level PAYWALL_SECRET (env or ephemeral). Tests pass an explicit
   *  value here to wire the paywall router and the socket handler up with
   *  the SAME secret end-to-end, so the JWT minted by /paywall/status can
   *  be verified verbatim by create-room. The branded `Secret<string>`
   *  type is preferred; tests passing a raw `string` are accepted via
   *  the union and immediately re-branded at the call site. */
  secret?: Secret<string> | string;
}

/** Build a paywall router instance. The default exported router (below)
 *  calls this with no options and is what production uses. Tests can call
 *  the factory with their own secret to exercise the full pay → status →
 *  create-room flow against a known signing key. The in-memory invoice and
 *  recovery-code state remains module-level (and is exposed via __testing
 *  for the existing per-route tests). */
export function createPaywallRouter(options: CreatePaywallRouterOptions = {}) {
  const router = Router();
  // Re-brand at the boundary: the raw `string` test-input branch is
  // explicitly cast to `Secret<string>` here so every downstream handler
  // receives the branded type.
  const secret: Secret<string> =
    options.secret !== undefined ? markSecret(options.secret) : PAYWALL_SECRET;

  router.post("/paywall/invoice", invoiceHandler);
  router.get("/paywall/status/:paymentHash", (req, res) => statusHandler(req, res, secret));
  router.post("/paywall/recover", (req, res) => recoverHandler(req, res, secret));
  router.get("/paywall/tiers", (_req, res) => {
    // Server-authoritative tier pricing — single source of truth for both
    // sat amounts and USD approximations. See services/pricing.ts for the
    // resolution rules (CPI peg, BTC spot, fallback chain, clamps,
    // TOR_ONLY short-circuit). The client trusts whatever it gets here
    // and never recomputes the USD figure on its own.
    res.json(resolveTierPricing());
  });

  if (process.env["NODE_ENV"] !== "production") {
    router.post("/paywall/dev-pay/:paymentHash", (req, res) => {
      const { paymentHash } = req.params;
      const ok = simulatePayment(paymentHash);
      res.json({ ok });
    });
  }

  return router;
}

const invoiceHandler = async (req: import("express").Request, res: import("express").Response) => {
  const requestedTier = req.body?.tier;
  // If the client supplied a tier, it must be a known one. We refuse to
  // silently downgrade an unknown tier (e.g. a stale "week" request from a
  // cached client bundle) because that would charge for one room lifetime
  // and deliver another. An omitted tier defaults to "standard".
  if (requestedTier !== undefined && !isValidTier(requestedTier)) {
    res.status(400).json({ error: "Unknown tier", tier: requestedTier });
    return;
  }
  const tier: Tier = isValidTier(requestedTier) ? requestedTier : "standard";
  // Resolve the sat amount through the pricing module (CPI-pegged, BTC
  // spot, clamped, with a defaults fallback). The static TIERS table
  // still provides the JWT lifetime and the room time-window — those
  // are policy, not price.
  const resolved = resolveTierPricing()[tier];
  const amountSats = resolved.amountSats;

  try {
    const { invoice, paymentHash } = await createInvoice(amountSats);
    gcInvoiceStates();
    invoiceStates.set(paymentHash, {
      tier,
      invoiceExpiresAt: Date.now() + PENDING_INVOICE_TTL_MS,
    });
    res.json({ invoice, paymentHash, amountSats, tier });
  } catch (err) {
    if (err instanceof LightningBackendUnavailableError) {
      // Surface a typed 503 so the PaywallModal can render a "service slow
      // to respond" message instead of spinning indefinitely. See the
      // LIGHTNING_FETCH_TIMEOUT_MS comment in services/lightning.ts.
      logger.warn({ err }, "Lightning backend unavailable on /paywall/invoice");
      recordLightningUnavailable();
      res.status(503).json({ error: "LIGHTNING_BACKEND_UNAVAILABLE" });
      return;
    }
    logger.error({ err }, "Failed to create invoice");
    res.status(500).json({ error: "Failed to create invoice" });
  }
};

const statusHandler = async (
  req: import("express").Request,
  res: import("express").Response,
  secret: Secret<string>,
) => {
  // The path declares :paymentHash as a single segment, but the broad
  // Request type widens params to string | string[]; coerce to the only
  // shape Express will actually deliver here.
  const paymentHash = String(req.params["paymentHash"] ?? "");

  if (!paymentHash || !/^[0-9a-f]{64}$/i.test(paymentHash)) {
    // BTCPay identifies invoices by an opaque store-generated ID rather
    // than a 64-hex payment hash. Those IDs are alphanumeric (base58-ish),
    // so enforce a strict safe-charset pattern instead of the old
    // "any string ≥ 10 chars" fallback — this closes the SSRF route
    // boundary (CodeQL #12): the value is interpolated into the backend
    // URL path in services/lightning.ts, and this charset cannot contain
    // `/`, `.`, `%`, or any other path-altering character.
    const isBTCPay = (process.env["LIGHTNING_BACKEND"] ?? "").toLowerCase() === "btcpay";
    if (!isBTCPay || !/^[A-Za-z0-9_-]{10,64}$/.test(paymentHash)) {
      res.status(400).json({ error: "Invalid payment hash" });
      return;
    }
  }

  let paid: boolean;
  try {
    paid = await checkPayment(paymentHash);
  } catch (err) {
    if (err instanceof LightningBackendUnavailableError) {
      // Mirrors invoiceHandler: surface a typed 503 instead of leaving the
      // client poll loop wondering whether `paid` is just still pending.
      // Log only a non-reversible triage digest, never the raw 64-hex
      // paymentHash — see digestPaymentHash: this is a PLAIN sha256 prefix
      // (triage/non-reversibility), deliberately NOT the keyed HMAC used for
      // the on-disk hostReclaimTokenHashes snapshot (file-holder
      // non-correlatability).
      logger.warn({ err, paymentHashDigest: digestPaymentHash(paymentHash) }, "Lightning backend unavailable on /paywall/status");
      recordLightningUnavailable();
      res.status(503).json({ error: "LIGHTNING_BACKEND_UNAVAILABLE" });
      return;
    }
    logger.error({ err }, "Failed to check payment status");
    res.status(500).json({ error: "Failed to check payment status" });
    return;
  }

  try {
    if (!paid) {
      res.json({ paid: false });
      return;
    }

    const state = invoiceStates.get(paymentHash);

    // Re-poll path: this hash has already been observed paid in this server
    // lifecycle. Return the SAME token + expiresAt that we issued the first
    // time; never extend the window, never downgrade the tier, and never
    // re-reveal the recovery code (it was shown to whoever first saw it).
    if (state?.settled) {
      res.json({
        paid: true,
        token: state.settled.token,
        tier: state.tier,
        expiresAt: state.settled.expiresAt,
      });
      return;
    }

    // First-paid path. We need a tier mapping; if `invoiceStates` was wiped
    // (server restart, GC after a very late settlement) we fall back to
    // standard — see the block comment above `InvoiceState` for why.
    if (!state) {
      // Same redaction rule as the 503 path above: emit only the non-reversible
      // triage digest, never the raw paymentHash. PLAIN sha256 prefix here
      // (triage), deliberately NOT the keyed HMAC of the hostReclaimTokenHashes
      // snapshot — see digestPaymentHash for why the two must stay distinct.
      logger.warn({ paymentHashDigest: digestPaymentHash(paymentHash) }, "Paid invoice has no in-memory tier mapping — defaulting to standard. Mapping may have been GC'd or the server restarted between invoice creation and settlement.");
    }
    const tier: Tier = state?.tier ?? "standard";
    const spec = TIERS[tier];
    const expiresAt = Date.now() + spec.windowSeconds * 1000;

    // `jti` is a fresh server-minted random id bound into the JWT so the
    // socket layer can enforce single-use at create-room: one settled invoice
    // → one room. Without this claim, a host could replay the same JWT for the
    // entire tier window, creating up to ~600 standard rooms or ~14,400 day
    // rooms per paid invoice (per-socket rate limit × window). See also the
    // `consumedRoomCreationTokens` map in accessController.ts. The `jti`
    // replaced the Lightning `paymentHash` here so nothing payment-derived
    // reaches the client (the JWT lives in browser `sessionStorage`); the
    // create-room replay behavior is unchanged.
    //
    // `reclaimToken` (Task #886) is a separate fresh per-paid-window random
    // value, decoupled from `jti`. It — NOT the `jti` — is what the room
    // persists (as a keyed HMAC) to authorize host reclaim on rejoin. The two
    // have independent lifecycles: `jti` gates create-room single-use,
    // `reclaimToken` gates host reclaim. Both are generated once here and
    // reused by /paywall/recover (below) so a recovered JWT shares the original
    // create-room slot and can still reclaim host on the original room.
    // `secret` is `Secret<string>` and `jwt.sign`'s third parameter is
    // typed as `string | Buffer | …`. Strip the brand only at this
    // boundary, where the value crosses into a third-party library, and
    // re-brand the resulting token immediately.
    const reclaimToken = crypto.randomBytes(32).toString("hex");
    const jti = crypto.randomBytes(16).toString("hex");
    const token: Secret<string> = markSecret(jwt.sign(
      { authorized: true, tier, jti, reclaimToken },
      unwrapSecret(secret),
      { expiresIn: spec.jwtExpiresIn },
    ));

    // Mint the recovery code in the same atomic step as the JWT. The
    // returned string is a credential — a holder can mint a fresh JWT
    // from it during the paid window — so it carries the `Secret` brand.
    gcRecoveryCodes();
    const recoveryCode: Secret<string> = generateRecoveryCode();
    recoveryCodes.set(recoveryCode, { jti, reclaimToken, tier, expiresAt });

    // Stamp the settled state so subsequent polls take the re-poll branch
    // above. If we had no prior state (restart edge case), synthesize one.
    if (state) {
      state.settled = { token, expiresAt, recoveryRevealed: true };
    } else {
      invoiceStates.set(paymentHash, {
        tier,
        invoiceExpiresAt: expiresAt, // unused once settled, but keep type happy
        settled: { token, expiresAt, recoveryRevealed: true },
      });
    }

    // M-04 mitigation: insert a random delay before delivering the token so a
    // passive observer cannot correlate "Lightning payment settled at T" with
    // "new room appeared at T+ε". The token and expiresAt were already computed
    // and stamped above — the delay does NOT shrink the paid window; it only
    // delays visibility. Re-polls (which took the branch above) bypass this
    // delay entirely because the correlation window has already passed.
    const jitter = settlementJitterMs();
    if (jitter > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, jitter));
    }

    res.json({ paid: true, token, tier, recoveryCode, expiresAt });
  } catch (err) {
    logger.error({ err }, "Failed to check payment status");
    res.status(500).json({ error: "Failed to check payment status" });
  }
};

const recoverHandler = (
  req: import("express").Request,
  res: import("express").Response,
  secret: Secret<string>,
) => {
  // Single-shot redeem: caller hands us a recovery code, we hand back a fresh
  // JWT with its expiresIn clamped to the REMAINING wall-clock seconds of the
  // original paid window. Recovery never extends the window the host paid for.
  //
  // Unknown, already-redeemed, and expired codes all return an IDENTICAL
  // 404 (status + body + headers) and traverse the SAME code path below.
  // Returning 410 for the expired case used to leak that a guessed code
  // was *once valid* — a probing attacker could tell "never existed" apart
  // from "was real, now expired". We collapse the three cases here.
  //
  // We still do NOT gc-sweep at the top of this handler — not to preserve a
  // distinguishable expired path (that distinction is the leak we are
  // closing), but because a top-of-handler sweep does per-call work
  // proportional to the map size and could itself become a timing signal.
  // Stale entries are cleaned up opportunistically when the next code is
  // minted in /paywall/status; consume-on-access below removes the probed
  // entry regardless of which of the three not-usable cases it falls into.

  // Rate limit FIRST, before any normalization or lookup. Counting only
  // valid-format requests would let an attacker probe with malformed input
  // for free, and counting only successful lookups would let them probe
  // with arbitrary 4-word phrases for free — both defeat the limiter.
  // Tick the global counter on every attempt for the same reason.
  tickRecoverGlobal();
  // Audit L-01 (Task #461): soft global block — when total /paywall/recover
  // traffic exceeds RECOVER_GLOBAL_BLOCK_THRESHOLD per minute, refuse to
  // serve any further attempts for the remainder of the window. This caps
  // an attempted botnet brute-force at the threshold rate regardless of how
  // many source IPs they rotate through, without affecting legitimate
  // single-user traffic (which sits orders of magnitude below the cap).
  if (isRecoverGloballyBlocked()) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }
  const ip = getClientIp(req);
  if (!checkRecoverIpRate(ip)) {
    res.status(429).json({ error: "RATE_LIMITED" });
    return;
  }

  const code = normalizeRecoveryCode(req.body?.code);
  if (!code) {
    res.status(400).json({ error: "Invalid recovery code format" });
    return;
  }

  const entry = recoveryCodes.get(code);
  const now = Date.now();
  // Consume-on-access UNCONDITIONALLY. `delete` on an absent key is a
  // harmless no-op, so unknown, already-redeemed, and expired codes all do
  // the same Map work — no "lookup-then-delete-because-expired" vs
  // "lookup-found-nothing" branch for an attacker to time. This also
  // preserves single-shot: a usable code is consumed before we mint a JWT,
  // so a duplicate request races to the 404 below, not a second token.
  recoveryCodes.delete(code);

  // A code is usable only if it exists AND has ≥1 whole second of paid
  // window left. The single `remainingSeconds > 0` test folds the old
  // `now >= expiresAt` and `remainingSeconds <= 0` checks together.
  const remainingSeconds = entry
    ? Math.floor((entry.expiresAt - now) / 1000)
    : 0;
  const usable = entry !== undefined && remainingSeconds > 0;
  if (!usable) {
    // Unknown, already-redeemed, AND expired converge here with one
    // identical 404 — status, body, and headers — so a leaked-code holder
    // cannot distinguish "wrong" from "already used" from "was once valid,
    // now expired".
    res.status(404).json({ error: "Unknown or already-used recovery code" });
    return;
  }

  // Audit M-1 (task #464): if `jwt.sign` throws AFTER the delete above
  // (process under memory pressure, key buffer mutated by an unrelated
  // bug, etc.) the recovery code is permanently lost — the paying user
  // gets a 500 and has no way to recover their paid window because the
  // code has been consumed but no token was returned. We capture `entry`
  // by value, attempt the sign, and on any throw re-insert the original
  // entry (same `expiresAt`, so the paid window doesn't reset and an
  // attacker can't extend the recovery window by triggering throws).
  // The 500 then becomes retryable from the user's perspective: they
  // hit /paywall/recover again with the same code and get a fresh token.
  const entrySnapshot = entry;
  let token: Secret<string>;
  try {
    // Mirror /paywall/status: re-bind the SAME `jti` into the recovered JWT so
    // the socket layer's `consumedRoomCreationTokens` map enforces single-use
    // at create-room across recovery. Re-binding (rather than minting a fresh
    // random `jti`) is what preserves one-payment-one-room: the original and
    // recovered JWTs share one create-room slot, so whichever creates a room
    // first consumes the `jti` and the other is rejected as TOKEN_ALREADY_USED.
    // Re-bind the SAME `reclaimToken` minted alongside the original window
    // (Task #886) so a recovered host can still reclaim host on the original
    // room — the room persisted that token's keyed HMAC, not anything
    // payment-derived. Strip the brand only at the third-party `jwt.sign`
    // boundary; the resulting token is itself a credential and is re-branded.
    token = markSecret(jwt.sign(
      {
        authorized: true,
        tier: entrySnapshot.tier,
        jti: entrySnapshot.jti,
        reclaimToken: entrySnapshot.reclaimToken,
      },
      unwrapSecret(secret),
      { expiresIn: remainingSeconds },
    ));
  } catch (err) {
    // Restore the entry with its ORIGINAL expiresAt — never refresh the
    // window from `now`, which would otherwise be a tiny lever an attacker
    // could pull to keep a recovery code alive past its paid window.
    recoveryCodes.set(code, entrySnapshot);
    logger.error(
      { err, event: "paywall-recover-jwt-sign-failed" },
      "paywall",
    );
    res.status(500).json({ error: "Token signing failed; please retry" });
    return;
  }

  res.json({ token, tier: entrySnapshot.tier, expiresAt: entrySnapshot.expiresAt });
};

// Test-only escape hatches. Never invoked in production paths.
export const __testing = {
  recoveryCodes,
  invoiceStates,
  gcRecoveryCodes,
  gcInvoiceStates,
  resetRecoverRateLimit,
  resetLightning503Alert,
  LIGHTNING_503_ALERT_THRESHOLD,
  RECOVER_RATE_MAX_PER_IP,
  RECOVER_GLOBAL_WARN_THRESHOLD,
  // Jitter override for tests: replace the module-level function reference so
  // tests that exercise the first-paid path can skip the 10–60 s sleep without
  // having to mock timers. Usage: __testing.overrideJitter(0) to disable.
  overrideJitter(ms: number) {
    _jitterOverride = ms;
  },
  clearJitterOverride() {
    _jitterOverride = null;
  },
};

export { PAYWALL_SECRET, TIERS };

// Default router used by production code. Built once at import time with the
// module-level PAYWALL_SECRET. Tests that need a custom secret should call
// `createPaywallRouter({ secret })` directly.
const router = createPaywallRouter();
export default router;
