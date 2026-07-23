// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useRef, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { isOnionOrigin } from "@/lib/origin";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";
import { useTierPricing, FALLBACK_TIER_PRICING } from "@/hooks/useTierPricing";

const BASE_URL = import.meta.env.BASE_URL ?? "/";

function apiUrl(path: string) {
  return BASE_URL.replace(/\/$/, "") + path;
}

export type Tier = "standard" | "day";

interface TierInfo {
  id: Tier;
  amountSats: number;
  label: string;
  duration: string;
  caption: string;
  /** Wall-clock duration this tier adds when used as a top-up extension.
   *  Mirrors the server's ROOM_TTLS table — kept in sync by the
   *  paywall-socket integration tests on the API side. */
  addsMs: number;
}

const STANDARD_MS = 65 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIERS: TierInfo[] = [
  { id: "standard", amountSats: 1000, label: "1 HOUR", duration: "65 MIN", caption: "One short call", addsMs: STANDARD_MS },
  { id: "day", amountSats: 5000, label: "24-HOUR", duration: "24 H", caption: "All-day", addsMs: DAY_MS },
];

export interface ExtendPreviewContext {
  /** Local-clock-adjusted current room expiry, in ms since epoch. */
  currentExpiresAtMs: number;
  /** Hard ceiling beyond `now` that the server will not let any extension
   *  cross. Used to compute the "capped at the 24h limit" warning. */
  ceilingMs: number;
}

interface Props {
  onSuccess: (token: string) => void;
  onClose: () => void;
  /** Header label — defaults to the create-room copy. Override for the
   *  in-room top-up flow ("EXTEND THIS ROOM"). */
  headerLabel?: string;
  /** Primary CTA on the post-paid screen — defaults to "OPEN ROOM". */
  successLabel?: string;
  /** When present, the modal is being used to top-up an existing room.
   *  We render a preview of the projected new end time under the tier
   *  picker and disable the CTA when the room is already at the
   *  ceiling, so hosts don't pay for an extension the server will
   *  reject with EXTENSION_CAPPED. */
  extendPreview?: ExtendPreviewContext;
  /** Task #1143: resume an interrupted paid flow. When set, the modal
   *  skips the tier picker and invoice entirely, opens straight onto a
   *  "checking your payment" state, and polls this hash. The server
   *  re-includes the recovery code on status responses until the client
   *  acks receipt, so a host who refreshed mid-flow still sees their
   *  code before entering the room. */
  resumePaymentHash?: string;
}

type Phase = "choosing" | "loading" | "waiting" | "paid" | "error";

// Cooldown between "TRY AGAIN" clicks on the LIGHTNING_BACKEND_UNAVAILABLE
// error screen. Long enough that a panicked host can't hammer a struggling
// Lightning backend, short enough that a real transient hiccup clears
// before the user gives up and walks away.
const RETRY_COOLDOWN_MS = 5000;

// After this many CONSECUTIVE failed status polls (a network error, or a
// non-OK response that isn't the typed 503 LIGHTNING_BACKEND_UNAVAILABLE)
// we surface a non-blocking "couldn't confirm payment yet" banner on the
// waiting screen. The invoice/QR stays exactly where it is and polling keeps
// running underneath — this is a banner, not a phase change — so a transient
// status-endpoint outage no longer leaves the host staring at a frozen QR
// with no signal that confirmation is broken. A single readable response
// (paid or not) clears it.
const STATUS_POLL_FAILURE_THRESHOLD = 3;

// Task #1144: resume-flow unverifiable threshold. In a resume flow (the modal
// opened with resumePaymentHash because the client stored a payment hash from
// a previous session), the client polls /paywall/status. If it gets consecutive
// {paid:false} responses without ever seeing {paid:true}, the server has lost
// the invoice state (restart wiped the in-memory maps) AND the backend cannot
// re-verify (e.g. mock backend, or the invoice TTL has passed). After this
// many consecutive {paid:false} responses in a resume flow, we stop polling
// and surface a clear dead-end — no silent infinite spinner.
const RESUME_UNVERIFIABLE_THRESHOLD = 10;

// Task #1150: decode a JWT and check whether its `exp` claim is in the past.
// Used on mount to decide whether a stored void_token can skip polling entirely.
// Treats malformed tokens and tokens with no `exp` claim as non-expired so we
// don't accidentally re-poll for tokens that legitimately omit an expiry.
function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    // base64url → standard base64, then restore padding.
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const decoded = JSON.parse(atob(b64)) as Record<string, unknown>;
    if (typeof decoded.exp !== "number") return false;
    return Date.now() / 1000 >= decoded.exp;
  } catch {
    return true;
  }
}

function formatWallClock(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

interface ExtendPreviewResult {
  /** Wall-clock ms of where the room would end after this extension. */
  newExpiresAtMs: number;
  /** True when the proposed extension would cross the 24h ceiling and
   *  get trimmed by the server. */
  trimmed: boolean;
  /** True when the room is already at (or past) the ceiling and no
   *  extension would buy any extra time at all. */
  noHeadroom: boolean;
  /** Wall-clock ms of the absolute ceiling, for messaging. */
  ceilingAtMs: number;
}

function computeExtendPreview(
  ctx: ExtendPreviewContext,
  addsMs: number,
  nowMs: number,
): ExtendPreviewResult {
  const ceilingAtMs = nowMs + ctx.ceilingMs;
  const proposed = ctx.currentExpiresAtMs + addsMs;
  const newExpiresAtMs = Math.min(proposed, ceilingAtMs);
  return {
    newExpiresAtMs,
    trimmed: proposed > ceilingAtMs,
    noHeadroom: newExpiresAtMs <= ctx.currentExpiresAtMs,
    ceilingAtMs,
  };
}

export default function PaywallModal({ onSuccess, onClose, headerLabel, successLabel, extendPreview, resumePaymentHash }: Props) {
  const ctaCopy = successLabel ?? "OPEN ROOM";
  // Task #1150: if the host refreshes mid-session and both void_token and
  // void_payment_hash are already in sessionStorage, skip polling entirely and
  // open directly onto the paid screen. Only fall through to the "waiting"
  // poll path when the stored token is missing or already expired.
  const [phase, setPhase] = useState<Phase>(() => {
    if (!resumePaymentHash) return "choosing";
    const stored = sessionStorage.getItem("void_token");
    if (stored && !isJwtExpired(stored)) return "paid";
    return "waiting";
  });
  const headerCopy =
    phase === "paid" ? "✓ PAID — ROOM READY" : headerLabel ?? "⚡ HOST A ROOM";
  const [tier, setTier] = useState<Tier>("standard");
  const [invoice, setInvoice] = useState("");
  const [paymentHash, setPaymentHash] = useState(resumePaymentHash ?? "");
  const [amountSats, setAmountSats] = useState<number>(1000);
  const [errorMsg, setErrorMsg] = useState("");
  // True when the last error was the typed 503 LIGHTNING_BACKEND_UNAVAILABLE
  // signal — i.e. a transient slowness we want to invite the user to retry,
  // not a hard failure. Only this case shows the in-place "TRY AGAIN" button.
  const [errorRetryable, setErrorRetryable] = useState(false);
  // Wall-clock ms when the retry button becomes clickable again. We compare
  // against Date.now() in render so the cooldown gates the click even if a
  // re-render is delayed; the per-second tick below just refreshes the label.
  const [retryReadyAtMs, setRetryReadyAtMs] = useState(0);
  // What the "TRY AGAIN" button does. A 503 on /paywall/invoice means no
  // invoice exists yet, so retry must re-request one ("invoice"). A 503 on
  // /paywall/status means the invoice was already created (and may still
  // settle once the backend recovers), so retry must resume polling rather
  // than abandon the in-flight invoice and charge the host again ("resume-poll").
  const [retryMode, setRetryMode] = useState<"invoice" | "resume-poll">("invoice");
  const [nowForCooldown, setNowForCooldown] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  // Recovery code — shown ONCE on the PAID screen, never persisted client-side.
  // The user explicitly dismisses it before we proceed; we never auto-onSuccess
  // from the paid phase, because that would let the code scroll away unread.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  // The recovery code starts collapsed behind a "PAYMENT RECOVERY CODE
  // (details)" disclosure — the host expands it deliberately to reveal,
  // copy, and read the keep-no-copy warning.
  const [recoveryDetailsOpen, setRecoveryDetailsOpen] = useState(false);
  // Item 11: set true when clipboard.writeText is rejected (Safari loses the
  // user-gesture context, insecure origins deny it). Surfaces an inline
  // "select the code manually" affordance instead of failing silently.
  const [recoveryCopyFailed, setRecoveryCopyFailed] = useState(false);
  // Item 15: when a host clicks the primary OPEN ROOM action without ever
  // opening the recovery-code disclosure, show a one-screen "this is
  // unrecoverable" confirmation before proceeding. Dismiss paths (X / ESC /
  // backdrop) deliberately bypass this — they are the calm escape hatch.
  const [confirmSkip, setConfirmSkip] = useState(false);
  // Item 10: after ~15s waiting for payment with no wallet having auto-opened,
  // surface an inline "open your wallet manually and paste this invoice" hint.
  const [showWalletHint, setShowWalletHint] = useState(false);
  // Task #1150: pre-populate from sessionStorage on the skip-to-paid path so
  // proceedFromPaid has a token to hand to onSuccess without a prior poll.
  const [paidToken, setPaidToken] = useState<string | null>(() => {
    if (!resumePaymentHash) return null;
    const stored = sessionStorage.getItem("void_token");
    if (stored && !isJwtExpired(stored)) return stored;
    return null;
  });
  // Consecutive failed status polls (network error or non-503 non-OK
  // response). Reset to 0 by any readable status response. Once it crosses
  // STATUS_POLL_FAILURE_THRESHOLD the waiting screen shows a non-blocking
  // "couldn't confirm payment yet" banner with a manual CHECK NOW button.
  const [pollFailures, setPollFailures] = useState(0);
  // True while a manual CHECK NOW poll is in flight, so the button can show a
  // "CHECKING…" state and reject double-clicks.
  const [manualChecking, setManualChecking] = useState(false);
  // Task #1144: resume-flow unverifiable state. Set true when the client is in
  // a resume flow (resumePaymentHash was set) and has polled
  // RESUME_UNVERIFIABLE_THRESHOLD times without ever seeing {paid:true}. This
  // means the server has lost the invoice state (restart-wiped) and can no
  // longer verify the payment — we surface a clear dead-end instead of an
  // endless CHECKING YOUR PAYMENT screen.
  const [paymentUnverifiable, setPaymentUnverifiable] = useState(false);
  // Task #1148: second-level recovery path for the paymentUnverifiable dead-end.
  // The host can paste their 4-word recovery code here and click REDEEM to hit
  // /api/paywall/recover and get a fresh JWT without re-paying.
  const [recoverInput, setRecoverInput] = useState("");
  const [recoverError, setRecoverError] = useState("");
  const [recoverInFlight, setRecoverInFlight] = useState(false);
  // Item 19: ref to the rendered recovery-code span so we can select-all on
  // reveal (and on tap) for hosts whose clipboard write rejected silently.
  const recoveryCodeRef = useRef<HTMLSpanElement | null>(null);
  const recoveryCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Whether this modal instance is a resume flow (set once at mount, never
  // changes). Used by pollStatus to apply the unverifiable-threshold logic
  // only when the client is re-checking a hash from a previous session.
  const isResumeFlowRef = useRef(!!resumePaymentHash);
  // Running count of consecutive {paid:false} responses in a resume flow.
  // A ref (not state) to avoid triggering re-renders on every poll tick.
  const resumePollCountRef = useRef(0);
  // Drives a per-second re-render of the extend preview so the projected
  // wall-clock time and "no headroom" check stay accurate as time passes
  // while the host is staring at the modal.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!extendPreview || phase !== "choosing") return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [extendPreview, phase]);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      if (recoveryCopiedTimerRef.current !== null) {
        clearTimeout(recoveryCopiedTimerRef.current);
        recoveryCopiedTimerRef.current = null;
      }
    };
  }, [stopPolling]);

  // Item 19: select the whole recovery-code value so the host can copy it by
  // hand the instant the panel reveals (and on tap). Best-effort — selection
  // APIs are missing in some embedded webviews, so never let it throw.
  function selectRecoveryCode() {
    const node = recoveryCodeRef.current;
    if (!node || typeof window.getSelection !== "function") return;
    try {
      const selection = window.getSelection();
      if (!selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // Selection unsupported here — userSelect:all still lets the user drag.
    }
  }

  async function handleCopyRecovery() {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      setRecoveryCopied(true);
      setRecoveryCopyFailed(false);
      if (recoveryCopiedTimerRef.current !== null) {
        clearTimeout(recoveryCopiedTimerRef.current);
      }
      recoveryCopiedTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setRecoveryCopied(false);
        recoveryCopiedTimerRef.current = null;
      }, 1500);
    } catch {
      // Item 11: clipboard can be denied (Safari gesture timeout, insecure
      // contexts, permissions). Don't fail silently — pre-select the code and
      // surface an inline "select and copy manually" affordance. The code box
      // itself stays selectable either way.
      setRecoveryCopied(false);
      setRecoveryCopyFailed(true);
      selectRecoveryCode();
    }
  }

  const requestInvoice = useCallback(async (chosen: Tier) => {
    setTier(chosen);
    setPhase("loading");
    setErrorMsg("");
    // Always start clean — only the 503 branch below opts back into
    // retryable state. This prevents a stale errorRetryable=true from a
    // previous 503 leaking into a later non-503 failure (which would
    // wrongly show TRY AGAIN with an already-elapsed cooldown).
    setErrorRetryable(false);
    setRetryReadyAtMs(0);
    // A brand-new invoice starts a fresh polling run — drop any stale
    // status-check failure banner from a previous attempt.
    setPollFailures(0);
    try {
      const res = await fetch(apiUrl("/api/paywall/invoice"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: chosen }),
      });
      // 503 = LIGHTNING_BACKEND_UNAVAILABLE — typed signal from the API
      // server that the Lightning backend timed out (see
      // LIGHTNING_FETCH_TIMEOUT_MS in services/lightning.ts). Surface a
      // user-visible "service slow to respond" line rather than the
      // generic "Server error" so the host knows to retry instead of
      // assuming a hard failure.
      if (res.status === 503) {
        if (!mountedRef.current) return;
        setErrorMsg("PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT.");
        setErrorRetryable(true);
        // No invoice exists yet — retry must re-request one.
        setRetryMode("invoice");
        setRetryReadyAtMs(Date.now() + RETRY_COOLDOWN_MS);
        setNowForCooldown(Date.now());
        setPhase("error");
        return;
      }
      if (!res.ok) throw new Error("Server error");
      const data = await res.json();
      if (!mountedRef.current) return;
      setInvoice(data.invoice);
      setPaymentHash(data.paymentHash);
      setAmountSats(typeof data.amountSats === "number" ? data.amountSats : 1000);
      setPhase("waiting");
    } catch {
      if (!mountedRef.current) return;
      setErrorMsg("Failed to generate invoice. Try again.");
      setPhase("error");
    }
  }, []);

  // A single status poll. Shared by the 3s interval and the manual "CHECK
  // NOW" button on the failure banner, so a host who suspects their payment
  // landed can force an immediate re-check without abandoning the invoice.
  const pollStatus = useCallback(async () => {
    if (!paymentHash) return;
    try {
      const res = await fetch(apiUrl(`/api/paywall/status/${paymentHash}`));
      // 503 = LIGHTNING_BACKEND_UNAVAILABLE on the status path. The invoice
      // already exists and may still settle once the backend recovers, so we
      // surface the same "service slow to respond" + retry treatment as the
      // invoice path — but in "resume-poll" mode so retry drops back to the
      // waiting screen against the SAME invoice rather than minting a new one.
      if (res.status === 503) {
        if (!mountedRef.current) return;
        stopPolling();
        setErrorMsg("PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT.");
        setErrorRetryable(true);
        setRetryMode("resume-poll");
        setRetryReadyAtMs(Date.now() + RETRY_COOLDOWN_MS);
        setNowForCooldown(Date.now());
        setPhase("error");
        return;
      }
      if (!res.ok) {
        // A non-503, non-OK response (404/500/…) means the status check is
        // genuinely failing. Count it toward the failure banner but keep the
        // invoice/QR and keep polling — the payment may still be in flight.
        if (!mountedRef.current) return;
        setPollFailures((n) => n + 1);
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      // We got a readable answer (paid or not) — the status check is healthy,
      // so clear any standing failure banner.
      setPollFailures(0);
      if (data.paid && data.token) {
        stopPolling();
        setPhase("paid");
        sessionStorage.setItem("void_token", data.token);
        // Task #1143: remember which payment this token came from so a
        // refresh (or dismiss) before the room opens can resume this exact
        // paid flow — and re-fetch the recovery code, which the server keeps
        // including on status responses until we ack receipt in
        // proceedFromPaid. Cleared alongside the ack.
        sessionStorage.setItem("void_payment_hash", paymentHash);
        setPaidToken(data.token);
        // The recovery code is the host's only way to resume this paid
        // window without re-paying. Hold the modal open until they
        // dismiss the code themselves — no auto-advance, by design.
        setRecoveryCode(typeof data.recoveryCode === "string" ? data.recoveryCode : null);
      } else if (isResumeFlowRef.current) {
        // Task #1144: resume flow + {paid:false}. The server cannot confirm
        // the invoice. This is expected when the server restarted and the
        // mock backend lost the invoice state (real backends re-verify and
        // would have returned paid:true instead). Track consecutive
        // non-confirmation responses — after RESUME_UNVERIFIABLE_THRESHOLD
        // we stop polling and surface a clear dead-end so the host knows to
        // use their recovery code or contact the operator, rather than
        // staring at an endless CHECKING YOUR PAYMENT screen.
        const newCount = resumePollCountRef.current + 1;
        resumePollCountRef.current = newCount;
        if (newCount >= RESUME_UNVERIFIABLE_THRESHOLD) {
          stopPolling();
          setPaymentUnverifiable(true);
          setPhase("error");
        }
      }
    } catch {
      // Network error / endpoint unreachable. Previously swallowed silently,
      // which left the host on a frozen QR with no signal. Count it so a
      // sustained outage surfaces the banner — but keep polling.
      if (!mountedRef.current) return;
      setPollFailures((n) => n + 1);
    }
  }, [paymentHash, stopPolling]);

  // Task #1148: second-level recovery — host pastes their 4-word code into the
  // paymentUnverifiable dead-end screen and clicks REDEEM. Hits
  // /api/paywall/recover and, on success, advances to the "paid" phase with
  // the fresh JWT. A failed redeem (invalid/expired/rate-limited code) shows
  // an inline error and leaves the form intact so the host can retry.
  const handleRecoverRedeem = useCallback(async () => {
    if (recoverInFlight) return;
    setRecoverError("");
    setRecoverInFlight(true);
    try {
      const res = await fetch(apiUrl("/api/paywall/recover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: recoverInput }),
      });
      if (!mountedRef.current) return;
      if (res.status === 429) {
        setRecoverError("TOO MANY ATTEMPTS. WAIT A MOMENT AND TRY AGAIN.");
        return;
      }
      if (res.status === 400) {
        setRecoverError("INVALID FORMAT — ENTER YOUR 4-WORD CODE EXACTLY AS GIVEN.");
        return;
      }
      if (!res.ok) {
        // 404 = unknown/already-used/expired; 500 = transient JWT signing failure (retryable).
        setRecoverError("INVALID OR EXPIRED CODE.");
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      const token: string = data.token;
      sessionStorage.setItem("void_token", data.token);
      // Recovery is single-shot — the endpoint never issues a second recovery
      // code, so we leave recoveryCode null and let the host proceed without
      // the disclosure. The paid window was already purchased; no new code needed.
      setPaidToken(token);
      setPaymentUnverifiable(false);
      setPhase("paid");
    } catch {
      if (!mountedRef.current) return;
      setRecoverError("NETWORK ERROR. CHECK YOUR CONNECTION AND TRY AGAIN.");
    } finally {
      if (mountedRef.current) setRecoverInFlight(false);
    }
  }, [recoverInput, recoverInFlight]);

  // Manual "CHECK NOW" handler from the failure banner — fires an immediate
  // poll outside the 3s cadence without touching the invoice or QR.
  const handleManualCheck = useCallback(async () => {
    if (manualChecking) return;
    setManualChecking(true);
    try {
      await pollStatus();
    } finally {
      if (mountedRef.current) setManualChecking(false);
    }
  }, [manualChecking, pollStatus]);

  useEffect(() => {
    if (phase !== "waiting" || !paymentHash) return;
    pollRef.current = setInterval(pollStatus, 3000);
    return stopPolling;
  }, [phase, paymentHash, pollStatus, stopPolling]);

  // Item 10: once the host has been on the WAITING FOR PAYMENT screen for ~15s
  // without their wallet auto-opening, reveal a manual-payment hint. Reset on
  // any phase change so a fresh invoice starts the clock over.
  useEffect(() => {
    if (phase !== "waiting") {
      setShowWalletHint(false);
      return;
    }
    const id = setTimeout(() => {
      if (mountedRef.current) setShowWalletHint(true);
    }, 15000);
    return () => clearTimeout(id);
  }, [phase]);

  // Item 19: auto-highlight the recovery code the instant its disclosure
  // panel reveals, so a host can copy it by hand even when the clipboard
  // button is unavailable. Runs after the panel has mounted the code span.
  useEffect(() => {
    if (phase !== "paid" || !recoveryDetailsOpen || !recoveryCode) return;
    selectRecoveryCode();
    // selectRecoveryCode is stable for this purpose; deps cover the reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, recoveryDetailsOpen, recoveryCode]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(invoice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function handleDevPay() {
    if (!paymentHash) return;
    try {
      await fetch(apiUrl(`/api/paywall/dev-pay/${paymentHash}`), { method: "POST" });
    } catch {
      // silent
    }
  }

  function handleChangeTier() {
    stopPolling();
    setInvoice("");
    setPaymentHash("");
    setErrorRetryable(false);
    setRetryReadyAtMs(0);
    setRetryMode("invoice");
    setPollFailures(0);
    // Task #1144: reset the unverifiable dead-end state so navigating back
    // from the error screen starts a clean flow.
    setPaymentUnverifiable(false);
    resumePollCountRef.current = 0;
    setPhase("choosing");
  }

  // Tick `nowForCooldown` every 250ms while the retry cooldown is active so
  // the countdown label and disabled state visibly resolve, then stop the
  // interval as soon as we're past the ready time.
  useEffect(() => {
    if (phase !== "error" || !errorRetryable) return;
    if (retryReadyAtMs <= Date.now()) return;
    const id = setInterval(() => {
      const now = Date.now();
      setNowForCooldown(now);
      if (now >= retryReadyAtMs) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [phase, errorRetryable, retryReadyAtMs]);

  const cooldownRemainingMs = Math.max(0, retryReadyAtMs - nowForCooldown);
  const retryDisabled = cooldownRemainingMs > 0;

  const activeTierInfo = TIERS.find((t) => t.id === tier) ?? TIERS[0];

  // Single shared path out of the PAID screen. Both the OPEN ROOM button and
  // the dismiss affordances (X / ESC / backdrop) funnel through here so there
  // is never a separate "abandon the room I already paid for" path. Drops the
  // recovery code and token from in-memory state before proceeding so they do
  // not survive the modal longer than the user's eyes need them.
  const proceedFromPaid = useCallback(() => {
    const t = paidToken;
    // Task #1143: the host is leaving the PAID screen — the recovery code
    // has been on screen (or they explicitly skipped it). Ack receipt so
    // the server deletes its delivery copy and no later status poll can
    // re-obtain the code. Fire-and-forget: if the ack is lost, the only
    // consequence is that a future resume shows the code again — safe,
    // and still bounded by the paid window.
    if (paymentHash) {
      fetch(apiUrl("/api/paywall/ack-recovery"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentHash }),
      }).catch(() => {});
    }
    sessionStorage.removeItem("void_payment_hash");
    setRecoveryCode(null);
    setRecoveryDetailsOpen(false);
    setConfirmSkip(false);
    setRecoveryCopyFailed(false);
    setPaidToken(null);
    if (t && mountedRef.current) onSuccess(t);
  }, [paidToken, paymentHash, onSuccess]);

  // X / ESC / backdrop behavior is phase-aware: on the PAID screen dismissing
  // enters the room (the host already paid — closing would abandon it), through
  // the exact same handler as OPEN ROOM. On every earlier phase it closes.
  const handleDismiss = useCallback(() => {
    if (phase === "paid") {
      proceedFromPaid();
    } else {
      onClose();
    }
  }, [phase, proceedFromPaid, onClose]);

  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onEscape: handleDismiss });

  // Task #549 — server-authoritative tier pricing. The hook returns the
  // last cached value immediately (or FALLBACK_TIER_PRICING on first
  // render) and updates once the fetch resolves. `usdApprox` is null
  // when the server has no BTC rate cached or the fetch failed — in
  // both cases the call sites below hide the USD line.
  const { pricing: serverPricing } = useTierPricing();
  const usdByTier: Record<Tier, string | null> = {
    standard: serverPricing.standard.usdApprox,
    day: serverPricing.day.usdApprox,
  };
  // Display sat amounts come from the server too — the static TIERS
  // table now only carries the labels, durations, captions, and the
  // top-up addsMs wall-clock budget.
  const satsByTier: Record<Tier, number> = {
    standard: serverPricing.standard.amountSats,
    day: serverPricing.day.amountSats,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(211,202,186,0.95)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "var(--font-mono)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paywall-modal-title"
        style={{
          background: "var(--bg)",
          border: "3px solid var(--fg)",
          width: "100%",
          maxWidth: "420px",
          maxHeight: "92vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: "3px solid var(--fg)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span id="paywall-modal-title" style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg)", fontWeight: 700 }}>
            {headerCopy}
          </span>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "24px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "20px",
          }}
        >
          {phase === "choosing" && (() => {
            const ep = extendPreview;
            const activeTier = TIERS.find((t) => t.id === tier) ?? TIERS[0];
            const preview = ep ? computeExtendPreview(ep, activeTier.addsMs, nowTick) : null;
            const ctaDisabled = preview?.noHeadroom ?? false;
            return (
              <>
                <div style={{ fontSize: "12px", letterSpacing: "2px", color: "var(--fg-dim)", textAlign: "center" }}>
                  {extendPreview ? "TOP UP YOUR ROOM" : "CHOOSE A ROOM"}
                </div>
                {/* Task #269: when the page itself was loaded over a .onion
                    address, the host has already opted into hiding their
                    network identity at the signaling layer. Paying the
                    Lightning invoice from a wallet that phones home over
                    clearnet undoes most of that effort, so surface a
                    pointed reminder at the moment of decision. Hidden on
                    clearnet to avoid noise for the 99% case. */}
                {isOnionOrigin() && (
                  <div
                    role="note"
                    data-testid="onion-tor-wallet-hint"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "var(--surface-dark)",
                      border: "1px solid var(--gold)",
                      padding: "12px 14px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      letterSpacing: "1px",
                      /* Task #1114: was var(--fg) on var(--surface-dark)
                         (1.09:1, invisible). --fg-on-dark is the token for
                         text on dark surfaces (16.27:1). */
                      color: "var(--fg-on-dark)",
                      lineHeight: 1.55,
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div>
                      Before you pay: a Tor-routed wallet keeps your IP address
                      hidden from whoever runs this room’s payment server. A
                      normal wallet reveals it. No Tor wallet? You can still pay
                      — your payment just won’t be anonymous.{" "}
                      <a
                        href={
                          import.meta.env.BASE_URL +
                          "threat-model#tor-wallet-shortlist"
                        }
                        data-testid="onion-tor-wallet-shortlist-link"
                        style={{
                          color: "var(--gold)",
                          textDecoration: "underline",
                          textUnderlineOffset: "3px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        See wallet options
                      </a>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "100%" }}>
                  {TIERS.map((t) => {
                    const active = t.id === tier;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTier(t.id)}
                        style={{
                          background: active ? "var(--surface-dark)" : "var(--surface)",
                          border: `3px solid ${active ? "var(--gold)" : "var(--fg-dim)"}`,
                          color: active ? "var(--gold)" : "var(--fg)",
                          fontFamily: "var(--font-mono)",
                          padding: "12px 14px",
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          letterSpacing: "1px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "2px" }}>{t.label}</span>
                          <span style={{ fontSize: "12px", color: active ? "var(--gold)" : "var(--fg-dim)" }}>
                            {satsByTier[t.id].toLocaleString()} SATS{usdByTier[t.id] ? ` · ≈ $${usdByTier[t.id]}` : ""}
                          </span>
                        </div>
                        <div style={{ marginTop: "2px" }}>
                          <span style={{ fontSize: "12px", color: active ? "#A89E90" : "var(--fg-dim)", letterSpacing: "1px" }}>
                            {t.caption}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {ep && preview && (
                  <div
                    data-testid="extend-preview"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      border: `2px solid ${preview.noHeadroom ? "var(--red)" : "var(--fg-dim)"}`,
                      padding: "10px 12px",
                      background: "var(--surface)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <div style={{ fontSize: "12px", letterSpacing: "2px", color: "var(--fg-dim)" }}>
                      CURRENT END · {formatWallClock(ep.currentExpiresAtMs)}
                    </div>
                    {preview.noHeadroom ? (
                      <div style={{ fontSize: "12px", letterSpacing: "1.5px", color: "var(--red)", lineHeight: 1.5 }}>
                        ROOM IS ALREADY AT THE 24H LIMIT — NO MORE TIME TO BUY.
                        WRAP UP THIS ROOM OR START A NEW ONE AFTER IT ENDS.
                      </div>
                    ) : (
                      <>
                        {/* contrast-exception: this line sits on the extend-preview
                            panel (background var(--surface), 6.56:1 with --fg); the
                            scanner pairs it with the nested gold chip's
                            var(--surface-dark) background, which only the chip's own
                            gold text renders on. */}
                        <div style={{ fontSize: "12px", letterSpacing: "1.5px", color: "var(--fg)", lineHeight: 1.4 }}>
                          EXTENDING WILL MOVE YOUR END TIME TO{" "}
                          <span data-testid="extend-preview-new-end" style={{ color: "var(--gold)", fontWeight: 700, background: "var(--surface-dark)", padding: "1px 6px" }}>
                            {formatWallClock(preview.newExpiresAtMs)}
                          </span>
                          .
                        </div>
                        {preview.trimmed && (
                          <div
                            data-testid="extend-preview-trimmed"
                            style={{
                              display: "inline-block",
                              fontSize: "12px",
                              letterSpacing: "1.5px",
                              color: "var(--gold)",
                              lineHeight: 1.5,
                              background: "var(--surface-dark)",
                              border: "1px solid var(--gold)",
                              padding: "6px 10px",
                            }}
                          >
                            CAPPED AT THE 24H LIMIT — YOU’LL GET LESS THAN THE FULL{" "}
                            {activeTier.duration}.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                <button
                  onClick={() => requestInvoice(tier)}
                  disabled={ctaDisabled}
                  aria-disabled={ctaDisabled}
                  style={{
                    background: ctaDisabled ? "var(--surface)" : "var(--gold)",
                    color: ctaDisabled ? "var(--fg-dim)" : "var(--surface-dark)",
                    border: `3px solid ${ctaDisabled ? "var(--fg-dim)" : "var(--gold)"}`,
                    fontFamily: "var(--font-mono)",
                    fontSize: "16px",
                    letterSpacing: "3px",
                    padding: "12px 16px",
                    cursor: ctaDisabled ? "not-allowed" : "pointer",
                    width: "100%",
                    fontWeight: 700,
                  }}
                >
                  CONTINUE
                </button>
              </>
            );
          })()}

          {phase === "loading" && (
            /* contrast-exception: renders on the modal's var(--bg) panel
               (--fg-dim = 6.56:1); the scanner pairs it with the sibling
               "CAPPED" chip's var(--surface-dark) background above. */
            <div style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg-dim)", padding: "40px 0" }}>
              GENERATING INVOICE...
            </div>
          )}

          {phase === "error" && (
            <>
              {paymentUnverifiable ? (
                // Task #1144: resume flow dead-end. The server restarted and
                // can no longer find or verify this invoice. No TRY AGAIN —
                // this is not a transient failure. Task #1148: add a recovery
                // code input so the host can redeem their code without re-paying.
                <>
                  <div
                    data-testid="payment-unverifiable-heading"
                    style={{ fontSize: "13px", color: "var(--red)", letterSpacing: "2px", textAlign: "center", padding: "20px 0 8px" }}
                  >
                    PAYMENT COULD NOT BE VERIFIED
                  </div>
                  <div
                    data-testid="payment-unverifiable-detail"
                    style={{
                      fontSize: "11px",
                      letterSpacing: "1px",
                      color: "var(--fg-dim)",
                      lineHeight: 1.6,
                      textAlign: "center",
                      paddingBottom: "8px",
                    }}
                  >
                    The server may have restarted and can no longer find your
                    invoice. If you saved your recovery code, paste it below to
                    restore access. Otherwise contact the operator — your
                    payment is still on the Lightning node.
                  </div>
                  {/* Task #1148: recovery-code input — lets the host bypass
                      the Lightning check entirely using their 4-word code. */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label
                      htmlFor="paywall-recover-input"
                      style={{ fontSize: "11px", letterSpacing: "2px", color: "var(--fg-dim)" }}
                    >
                      RECOVERY CODE
                    </label>
                    <input
                      id="paywall-recover-input"
                      data-testid="paywall-recover-input"
                      type="text"
                      value={recoverInput}
                      onChange={(e) => {
                        setRecoverInput(e.target.value);
                        setRecoverError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !recoverInFlight) handleRecoverRedeem();
                      }}
                      placeholder="word word word word"
                      autoComplete="off"
                      spellCheck={false}
                      disabled={recoverInFlight}
                      style={{
                        background: "var(--surface)",
                        border: `2px solid ${recoverError ? "var(--red)" : "var(--fg-dim)"}`,
                        color: "var(--fg)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                        letterSpacing: "1px",
                        padding: "10px 12px",
                        width: "100%",
                        boxSizing: "border-box",
                        outline: "none",
                      }}
                    />
                    {recoverError && (
                      <div
                        role="alert"
                        data-testid="paywall-recover-error"
                        style={{ fontSize: "11px", letterSpacing: "1px", color: "var(--red)" /* contrast-exception: renders on modal's --bg (3.41:1, exempted accent); scanner sees --surface from sibling input */, lineHeight: 1.5 }}
                      >
                        {recoverError}
                      </div>
                    )}
                    <button
                      data-testid="paywall-recover-redeem"
                      onClick={handleRecoverRedeem}
                      disabled={recoverInFlight || recoverInput.trim() === ""}
                      aria-disabled={recoverInFlight || recoverInput.trim() === ""}
                      style={{
                        background: recoverInFlight || recoverInput.trim() === "" ? "var(--surface)" : "var(--gold)",
                        color: recoverInFlight || recoverInput.trim() === "" ? "var(--fg-dim)" : "var(--surface-dark)",
                        border: `3px solid ${recoverInFlight || recoverInput.trim() === "" ? "var(--fg-dim)" : "var(--gold)"}`,
                        fontFamily: "var(--font-mono)",
                        fontSize: "16px",
                        padding: "10px 16px",
                        cursor: recoverInFlight || recoverInput.trim() === "" ? "not-allowed" : "pointer",
                        letterSpacing: "3px",
                        fontWeight: 700,
                        width: "100%",
                      }}
                    >
                      {recoverInFlight ? "REDEEMING…" : "REDEEM"}
                    </button>
                  </div>
                  <button
                    onClick={handleChangeTier}
                    style={{
                      background: "none",
                      border: "3px solid var(--fg-dim)",
                      color: "var(--fg-dim)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      padding: "8px 14px",
                      cursor: "pointer",
                      letterSpacing: "2px",
                    }}
                  >
                    BACK
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "13px", color: "var(--red)", letterSpacing: "2px", textAlign: "center", padding: "20px 0" }}>
                    {errorMsg}
                  </div>
                  {errorRetryable && (
                    <button
                      data-testid="paywall-retry"
                      onClick={() => {
                        if (retryDisabled) return;
                        if (retryMode === "resume-poll") {
                          // The invoice already exists and may have settled during
                          // the outage. Clear the error state and drop back to the
                          // waiting screen — the poll effect re-installs itself
                          // because invoice + paymentHash are still in state.
                          setErrorRetryable(false);
                          setRetryReadyAtMs(0);
                          setErrorMsg("");
                          setPhase("waiting");
                          return;
                        }
                        requestInvoice(tier);
                      }}
                      disabled={retryDisabled}
                      aria-disabled={retryDisabled}
                      style={{
                        background: retryDisabled ? "var(--surface)" : "var(--gold)",
                        color: retryDisabled ? "var(--fg-dim)" : "var(--surface-dark)",
                        border: `3px solid ${retryDisabled ? "var(--fg-dim)" : "var(--gold)"}`,
                        fontFamily: "var(--font-mono)",
                        fontSize: "16px",
                        padding: "10px 16px",
                        cursor: retryDisabled ? "not-allowed" : "pointer",
                        letterSpacing: "3px",
                        fontWeight: 700,
                        width: "100%",
                      }}
                    >
                      {retryDisabled
                        ? `TRY AGAIN IN ${Math.ceil(cooldownRemainingMs / 1000)}S`
                        : "TRY AGAIN"}
                    </button>
                  )}
                  <button
                    onClick={handleChangeTier}
                    style={{
                      background: "none",
                      border: "3px solid var(--fg-dim)",
                      color: "var(--fg-dim)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      padding: "8px 14px",
                      cursor: "pointer",
                      letterSpacing: "2px",
                    }}
                  >
                    BACK
                  </button>
                </>
              )}
            </>
          )}

          {/* Task #1143: resume path — a refresh (or dismissed paid modal)
              left a paid-but-not-opened payment behind. There is no invoice
              to show; we simply poll the stored hash until the server hands
              the token (and the still-unacked recovery code) back. */}
          {phase === "waiting" && !invoice && (
            <>
              <div
                data-testid="resume-checking"
                style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg-dim)", textAlign: "center", padding: "20px 0" }}
              >
                CHECKING YOUR PAYMENT ·{" "}
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    background: "var(--teal)",
                    borderRadius: 0,
                    animation: "void-blink 1s step-start infinite",
                    verticalAlign: "middle",
                  }}
                />
              </div>
              <div
                data-testid="privacy-delay-note"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  letterSpacing: "1px",
                  color: "var(--fg-dim)",
                  lineHeight: 1.6,
                  textAlign: "center",
                }}
              >
                After you pay, confirmation can take up to a minute. That pause
                is deliberate — a random delay that keeps the exact moment of
                your payment private.
              </div>
              {pollFailures >= STATUS_POLL_FAILURE_THRESHOLD && (
                <div
                  data-testid="status-check-failing"
                  role="status"
                  aria-live="polite"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    letterSpacing: "1px",
                    color: "var(--fg-on-dark)",
                    lineHeight: 1.6,
                    textAlign: "center",
                    border: "2px solid var(--gold)",
                    background: "var(--surface-dark)",
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div>
                    Couldn’t confirm your payment yet — we’re having trouble
                    reaching the payment server. If you’ve already paid, keep
                    this open and we’ll keep checking, or check now.
                  </div>
                  <button
                    data-testid="status-check-now"
                    onClick={handleManualCheck}
                    disabled={manualChecking}
                    aria-disabled={manualChecking}
                    style={{
                      background: manualChecking ? "var(--surface)" : "var(--gold)",
                      color: manualChecking ? "var(--fg-dim)" : "var(--surface-dark)",
                      border: "3px solid var(--gold)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "14px",
                      letterSpacing: "2px",
                      padding: "10px 14px",
                      cursor: manualChecking ? "wait" : "pointer",
                      fontWeight: 700,
                      width: "100%",
                    }}
                  >
                    {manualChecking ? "CHECKING…" : "CHECK NOW"}
                  </button>
                </div>
              )}
            </>
          )}

          {phase === "waiting" && invoice && (
            <>
              {/* Pricing tag — heavy gold box, appropriate while the host is
                  still deciding to pay. The PAID screen calms this right down. */}
              <div
                style={{
                  border: "3px solid var(--gold)",
                  padding: "12px 24px",
                  textAlign: "center",
                  background: "var(--surface-dark)",
                  width: "100%",
                  boxSizing: "border-box",
                }}
              >
                <div style={{ fontSize: "22px", fontWeight: 700, color: "var(--gold)", letterSpacing: "2px" }}>
                  {amountSats.toLocaleString()} SATS
                </div>
                <div style={{ fontSize: "12px", color: "#A89E90", letterSpacing: "2px", marginTop: "4px" }}>
                  {usdByTier[activeTierInfo.id]
                    ? `≈ $${usdByTier[activeTierInfo.id]} AT CURRENT PRICES`
                    : "AT CURRENT BITCOIN PRICES"}
                </div>
                <div style={{ fontSize: "12px", color: "#A89E90", letterSpacing: "3px", marginTop: "4px" }}>
                  {activeTierInfo.label}
                </div>
              </div>

              {/* QR code */}
              <div
                style={{
                  background: "var(--bg)",
                  padding: "12px",
                  border: "3px solid var(--fg-dim)",
                }}
              >
                <QRCodeSVG
                  value={invoice}
                  size={200}
                  bgColor="#D3CABA"
                  fgColor="#1E1A14"
                  level="M"
                />
              </div>

              {/* Invoice string */}
              <button
                onClick={handleCopy}
                title="Click to copy invoice"
                style={{
                  background: "var(--surface)",
                  border: "3px solid var(--fg-dim)",
                  color: copied ? "var(--teal)" : "var(--fg-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  padding: "8px 12px",
                  cursor: "pointer",
                  letterSpacing: "1px",
                  width: "100%",
                  textAlign: "left",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {copied ? "COPIED ✓" : invoice.slice(0, 50) + "..."}
              </button>

              {/* Status */}
              <div style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "2px", textAlign: "center" }}>
                WAITING FOR PAYMENT ·{" "}
                <span
                  style={{
                    display: "inline-block",
                    width: "6px",
                    height: "6px",
                    background: "var(--teal)",
                    borderRadius: 0,
                    animation: "void-blink 1s step-start infinite",
                    verticalAlign: "middle",
                  }}
                />
              </div>

              {/* Task #1143: static privacy-delay note. Rendered from the
                  moment the invoice appears and NEVER changed, added, or
                  removed at settlement time — its presence and timing must
                  carry zero information about whether the payment has
                  settled (the delay itself is the M-04 anti-correlation
                  mitigation this copy explains). */}
              <div
                data-testid="privacy-delay-note"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  letterSpacing: "1px",
                  color: "var(--fg-dim)",
                  lineHeight: 1.6,
                  textAlign: "center",
                }}
              >
                After you pay, confirmation can take up to a minute. That pause
                is deliberate — a random delay that keeps the exact moment of
                your payment private.
              </div>

              {/* Status-check failure banner. Surfaces once the polling loop
                  has failed STATUS_POLL_FAILURE_THRESHOLD times in a row (the
                  status endpoint is down/unreachable) so the host knows the
                  silence is a broken check, not an unpaid invoice. Non-blocking
                  — the invoice/QR stays put, polling continues, and CHECK NOW
                  forces an immediate re-poll. A readable response clears it. */}
              {pollFailures >= STATUS_POLL_FAILURE_THRESHOLD && (
                <div
                  data-testid="status-check-failing"
                  role="status"
                  aria-live="polite"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    letterSpacing: "1px",
                    /* Task #1114: was var(--fg) on var(--surface-dark)
                       (1.09:1, invisible). --fg-on-dark is the token for
                       text on dark surfaces (16.27:1). */
                    color: "var(--fg-on-dark)",
                    lineHeight: 1.6,
                    textAlign: "center",
                    border: "2px solid var(--gold)",
                    background: "var(--surface-dark)",
                    padding: "10px 12px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  <div>
                    Couldn’t confirm your payment yet — we’re having trouble
                    reaching the payment server. If you’ve already paid, keep
                    this open and we’ll keep checking, or check now.
                  </div>
                  <button
                    data-testid="status-check-now"
                    onClick={handleManualCheck}
                    disabled={manualChecking}
                    aria-disabled={manualChecking}
                    style={{
                      background: manualChecking ? "var(--surface)" : "var(--gold)",
                      color: manualChecking ? "var(--fg-dim)" : "var(--surface-dark)",
                      border: "3px solid var(--gold)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "14px",
                      letterSpacing: "2px",
                      padding: "10px 14px",
                      cursor: manualChecking ? "wait" : "pointer",
                      fontWeight: 700,
                      width: "100%",
                    }}
                  >
                    {manualChecking ? "CHECKING…" : "CHECK NOW"}
                  </button>
                </div>
              )}

              {/* Item 10: manual-payment fallback. Appears after ~15s for
                  hosts whose wallet did not auto-open, pointing them at the
                  copy-invoice button above. */}
              {showWalletHint && (
                <div
                  data-testid="wallet-manual-hint"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    letterSpacing: "1px",
                    color: "var(--fg-dim)",
                    lineHeight: 1.6,
                    textAlign: "center",
                    border: "2px solid var(--fg-dim)",
                    padding: "10px 12px",
                  }}
                >
                  Wallet didn’t open? Open your Lightning wallet manually, copy
                  the invoice above, and paste it to pay.
                </div>
              )}

              {/* Change tier */}
              <button
                onClick={handleChangeTier}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--fg-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  cursor: "pointer",
                  letterSpacing: "2px",
                  textDecoration: "underline",
                }}
              >
                ← CHANGE TIER
              </button>

              {/* Dev helper — item 2: gated on import.meta.env.DEV so the
                  production bundle (build sets DEV=false) tree-shakes it out
                  entirely. It must never reach a real host. */}
              {import.meta.env.DEV && (
                <button
                  onClick={handleDevPay}
                  style={{
                    background: "none",
                    border: "3px solid var(--surface)",
                    color: "var(--fg-dim)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    padding: "6px 12px",
                    cursor: "pointer",
                    letterSpacing: "1px",
                    opacity: 0.5,
                  }}
                >
                  [DEV] SIMULATE PAYMENT
                </button>
              )}
            </>
          )}

          {phase === "paid" && (
            <>
              {/* Reference group: the price and the recovery code sit together
                  as calm reference material — clearly lighter than the OPEN
                  ROOM action below — so the screen reads "you've paid, here's
                  your room" rather than re-selling the price. */}
              <div
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                {/* Recovery code — shown ONCE, never persisted client-side.
                    De-emphasized chrome (no gold border, no tinted/dashed box)
                    but the code VALUE stays high-contrast and selectable so the
                    user can copy it by eye or by hand. */}
                {recoveryCode && (
                  <div
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setRecoveryDetailsOpen((v) => !v)}
                      aria-expanded={recoveryDetailsOpen}
                      aria-controls="paywall-recovery-details"
                      style={{
                        width: "100%",
                        boxSizing: "border-box",
                        background: "var(--surface)",
                        border: "2px solid var(--fg-dim)",
                        padding: "12px 14px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "16px",
                        letterSpacing: "1.5px",
                        color: "var(--fg)",
                        fontWeight: 400,
                        textAlign: "left",
                      }}
                    >
                      <span aria-hidden="true" style={{ fontSize: "15px", fontWeight: 700, lineHeight: 1 }}>
                        +
                      </span>
                      PAYMENT DETAILS (including one-time recovery code)
                    </button>
                    {recoveryDetailsOpen && (
                      <div
                        id="paywall-recovery-details"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          paddingLeft: "24px",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            letterSpacing: "2px",
                            color: "var(--fg)",
                            fontWeight: 700,
                          }}
                        >
                          <span style={{ color: "var(--fg-dim)", fontWeight: 400 }}>
                            Recovery Code:{" "}
                          </span>
                          {/* Item 19: tap-to-select-all so a host on a browser
                              that rejected the clipboard write can still grab
                              the whole code in one gesture. */}
                          <span
                            ref={recoveryCodeRef}
                            onClick={selectRecoveryCode}
                            style={{
                              wordSpacing: "8px",
                              textTransform: "lowercase",
                              userSelect: "all",
                              cursor: "text",
                            }}
                          >
                            {recoveryCode}
                          </span>
                        </div>
                        <button
                          onClick={handleCopyRecovery}
                          aria-label="copy recovery code"
                          style={{
                            background: recoveryCopied ? "var(--teal)" : "var(--surface)",
                            border: `2px solid ${recoveryCopied ? "var(--teal)" : "var(--fg-dim)"}`,
                            color: recoveryCopied ? "var(--surface-dark)" : "var(--fg-dim)",
                            fontFamily: "var(--font-mono)",
                            fontSize: "16px",
                            padding: "8px 12px",
                            cursor: "pointer",
                            letterSpacing: "2px",
                            alignSelf: "flex-start",
                            transition: "background 120ms ease, color 120ms ease, border-color 120ms ease",
                          }}
                        >
                          {recoveryCopied ? "COPIED ✓" : "COPY TO CLIPBOARD"}
                        </button>
                        {/* Item 11: clipboard write was rejected — don't fail
                            silently. The code is already pre-selected above;
                            tell the host to copy it by hand. */}
                        {recoveryCopyFailed && (
                          <div
                            data-testid="recovery-copy-manual-hint"
                            style={{
                              fontSize: "11px",
                              letterSpacing: "1.5px",
                              color: "var(--fg)",
                              lineHeight: 1.6,
                            }}
                          >
                            Couldn’t reach your clipboard. The code above is
                            highlighted — select it and copy it manually.
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: "11px",
                            letterSpacing: "1.5px",
                            color: "var(--fg-dim)",
                            lineHeight: 1.6,
                          }}
                        >
                          Only you can save this — we keep no copy. Without it, you
                          can’t get back in if you close the tab. Copy it or write it
                          on paper.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Item 15: unrecoverable-skip guard. If a host clicks the
                  primary action while a recovery code exists but they never
                  opened the disclosure to save it, intercept with a single
                  "this is unrecoverable" confirmation. Once they've opened the
                  panel (seen/copied the code) the primary action proceeds
                  straight through. X / ESC / backdrop deliberately bypass this
                  (handleDismiss → proceedFromPaid) as the calm escape hatch. */}
              {confirmSkip ? (
                <div
                  data-testid="recovery-skip-confirm"
                  role="alertdialog"
                  aria-label="recovery code not saved"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    border: "3px solid var(--gold)",
                    background: "var(--surface-dark)",
                    padding: "16px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      letterSpacing: "1px",
                      /* Task #1114: was var(--fg) on the var(--surface-dark)
                         card (1.09:1, invisible). --fg-on-dark is the token
                         for text on dark surfaces (16.27:1). */
                      color: "var(--fg-on-dark)",
                      lineHeight: 1.6,
                    }}
                  >
                    You haven’t opened your recovery code. Without it you can’t
                    get back into this paid room if you close the tab. This can’t
                    be undone.
                  </div>
                  <button
                    onClick={() => {
                      setConfirmSkip(false);
                      setRecoveryDetailsOpen(true);
                    }}
                    style={{
                      background: "var(--gold)",
                      color: "var(--surface-dark)",
                      border: "3px solid var(--gold)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      letterSpacing: "2px",
                      padding: "14px",
                      cursor: "pointer",
                      width: "100%",
                      fontWeight: 700,
                    }}
                  >
                    SHOW MY RECOVERY CODE
                  </button>
                  <button
                    onClick={proceedFromPaid}
                    style={{
                      background: "none",
                      border: "3px solid var(--fg-dim)",
                      color: "var(--fg-dim)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      letterSpacing: "2px",
                      padding: "10px 14px",
                      cursor: "pointer",
                      width: "100%",
                    }}
                  >
                    OPEN ROOM ANYWAY
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (recoveryCode && !recoveryDetailsOpen) {
                      setConfirmSkip(true);
                      return;
                    }
                    proceedFromPaid();
                  }}
                  style={{
                    background: "var(--gold)",
                    color: "var(--surface-dark)",
                    border: "3px solid var(--gold)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "16px",
                    letterSpacing: "2px",
                    padding: "16px",
                    cursor: "pointer",
                    width: "100%",
                    fontWeight: 700,
                  }}
                >
                  {ctaCopy}
                </button>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  );
}
