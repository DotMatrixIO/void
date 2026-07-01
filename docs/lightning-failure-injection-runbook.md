# Operator Runbook: Lightning Failure-Mode Injection for the A.13 Rehearsal

This runbook is the setup the A.13 gate in `LAUNCH-CHECKLIST-2.md`
depends on. A.13 ("Lightning failure-mode rehearsal") cannot be run
honestly unless there is a documented, reversible way to make the
**production** Lightning backend fail or misbehave mid-payment on
demand. The gate-codification task deliberately left this tooling
unbuilt and flagged it under "Before the window — rehearsal prep for
A.13 / A.14". This document builds it.

It is **doc-only**. No VOID code, manifest, or env changes are
required — every lever here acts on the operator's own LNbits / BTCPay
backend, not on VOID. The four sub-cases below map one-to-one onto the
four behaviours the A.13 DoD names.

> **Scope note.** This is the *injection* setup — how to create the
> failure conditions and how to back out. The pass/fail observations it
> produces are recorded against the A.13 gate (see "Recording the
> result"). A.5 / v1 #6 already rehearses the happy-ish flows (pay →
> room, expiry mid-pay, tab-close recovery); A.13 is specifically the
> backend-*misbehaviour* cases A.5 does not cover.

## What A.13 needs, in one table

| Sub-case | Lever (operator-side) | Expected VOID behaviour | DoD line it satisfies |
|---|---|---|---|
| 1. Backend fails mid-pay | Pause LNbits / pause BTCPay (or revoke its Greenfield key) | `503 LIGHTNING_BACKEND_UNAVAILABLE` within ~8 s, no infinite spinner; on recovery the paid invoice mints a token + recovery code | "recover-or-retry path within ~10 seconds; no infinite spinner; no double-charge; paid sats honored or recovery code handed over" |
| 2. Under-payment | Pay strictly less than the invoice amount (BTCPay store with partial-payment tolerance, or confirm bolt11 rejects it) | No room granted; invoice never reports settled | "no room granted on short-pay" |
| 3. Over-payment | Pay more than the invoice amount (BTCPay over-payment) | Exactly one room granted; the excess is recorded by the backend, not silently consumed by VOID | "an over-pay is not silently pocketed" |
| 4. Duplicate / concurrent invoice for the same intent | Poll one settled `paymentHash` concurrently and attempt create-room twice | One token, one recovery-code reveal, one room; the second create-room is refused | "a duplicate / concurrent invoice for the same intent does not create two rooms or double-debit" |

Where the amount check actually lives matters for sub-cases 2 and 3:
**VOID does not compare the paid amount against the invoice amount.**
`checkPayment` in `artifacts/api-server/src/services/lightning.ts`
treats the invoice as paid purely on the backend's own flag — LNbits
`paid === true`, BTCPay `status === "Settled" | "Processing"`. The
short-pay / over-pay correctness therefore lives in the Lightning
backend's settlement semantics, and the rehearsal verifies that VOID
inherits them correctly rather than re-implementing them.

## Before you trigger anything — rollback plan and prerequisites

Run this whole section **before** the first injection. Do not trigger a
failure you have not already rehearsed reversing.

1. **Pick the window deliberately.** Pausing the production LNbits /
   BTCPay backend takes the paywall down for *every* in-flight payer,
   not just your test invoice. A.13 is a Phase A gate that runs after
   the deploy lands but **before** the launch announce, so in practice
   there are no real users yet — keep it that way by running this before
   announcing, or stand up a parallel test store (below) if the deploy
   is already public.
2. **Have the reverse lever staged in a second terminal.** For each
   sub-case the recovery command is a single action; have it typed and
   ready before you trigger, so a fumbled outage is seconds, not
   minutes:
   - LNbits paused with `docker pause` → `docker unpause` ready.
   - BTCPay paused with `docker pause` → `docker unpause` ready.
   - BTCPay key revoked → the replacement key already minted and the
     `BTCPAY_API_KEY` env edit + API-server restart staged.
3. **Know the two timers you are racing.**
   - `LIGHTNING_FETCH_TIMEOUT_MS` = 8 s. A paused backend surfaces as a
     `503` after ~8 s, which is what keeps the client off an infinite
     spinner and inside the A.13 ~10 s budget.
   - Pending-invoice TTL = 30 min (`PENDING_INVOICE_TTL_MS` /
     `INVOICE_TTL_MS`). An invoice paid but never observed-paid before
     this elapses GCs its tier mapping; restore the backend well inside
     it.
4. **Fund a real test wallet** with a few thousand sats (enough for a
   `standard` 1000-sat and a `day` 5000-sat invoice, plus the over-pay
   margin for sub-case 3).
5. **Record identifiers up front** for each test invoice: backend
   (`lnbits` / `btcpay`), wallet, `paymentHash`, tier, amount. The A.13
   log requires the backend + wallet to be named.
6. **Confirm a clean baseline.** A fresh invoice round-trips end to end
   (`/api/health` is `200`; create invoice → pay → room) *before* you
   inject anything, so any failure you see afterward is the one you
   caused.

### Optional: a parallel test store instead of the live backend

If the deploy is already public and you cannot take the live paywall
down, point a second API-server process (or a short-lived staging
deploy) at a **separate** LNbits wallet or BTCPay store and run the
injections there. The settlement semantics are identical; only the
blast radius changes. Sub-cases 2 and 3 in particular are easiest on a
**regtest or signet** BTCPay store, where you can construct exact
partial / over payments without spending real mainnet sats — see each
sub-case for why.

## Sub-case 1 — Backend fails mid-pay

This is the headline case: the user has paid, but the backend goes away
before VOID's status poll observes settlement.

### LNbits — pause the node

```bash
# Trigger: freeze the LNbits container. In-flight /paywall/status polls
# block on the network and abort at LIGHTNING_FETCH_TIMEOUT_MS (8 s),
# which the route maps to 503 LIGHTNING_BACKEND_UNAVAILABLE.
docker pause <lnbits-container>

# ... pay the test invoice from your wallet while LNbits is paused, or
# pause immediately after paying. Watch the client: it must show the
# typed "service slow to respond" state, NOT an endless spinner.

# Recovery: unfreeze. The next poll observes paid and mints the token +
# the one-time recovery code on that first paid-observing poll.
docker unpause <lnbits-container>
```

### BTCPay — pause the server, or fail request signing

```bash
# Option A — pause (same typed-503 path as LNbits):
docker pause <btcpay-container>
docker unpause <btcpay-container>

# Option B — "fail request signing": revoke the Greenfield API key in
# the BTCPay UI (Account → Manage Account → API Keys → delete), or set
# BTCPAY_API_KEY to a disabled key and restart the API server.
```

Note the behavioural difference between the two BTCPay options, because
A.13 cares about it:

- **Pause** makes the backend *unreachable* → request aborts at 8 s →
  `503 LIGHTNING_BACKEND_UNAVAILABLE` → the client renders the typed
  error and the user can retry. This is the path that satisfies the "no
  infinite spinner, recover-or-retry within ~10 s" DoD line.
- **Key revoke** makes the backend *reachable but refusing* → the
  status request returns a non-OK (`401`), which `checkPayment` maps to
  "not yet paid" → the client keeps polling as if the invoice were
  still pending. This is a *degraded* mode worth exercising once: it is
  the closest VOID gets to the "stuck with no recovery path" risk the
  gate guards against. Verify the user is not wedged forever — once the
  key is restored, the next poll observes paid and mints the token +
  recovery code, and the pending-invoice TTL bounds the worst case.

### What "pass" looks like for sub-case 1

- The client shows a typed slow/unavailable state within ~10 s of the
  backend going away — never an unbounded spinner.
- No double-charge: the wallet debits exactly once. (VOID never asks the
  wallet to pay again; recovery re-polls the *same* `paymentHash`.)
- On recovery, the paid sats are honored: the first paid-observing poll
  returns the JWT and reveals the recovery code exactly once.
- If the user closed the tab during the outage, reopening the phrase URL
  (or re-polling the same `paymentHash`) after recovery mints the token
  and reveals the recovery code on that first successful paid poll. The
  user can also redeem the recovery code at `POST /api/paywall/recover`
  for a fresh JWT clamped to the remaining paid window.

> **Honest edge case.** The recovery code is only minted on the *first*
> poll that observes payment. If the outage spans the entire pending
> window *and* the user never re-polls the same `paymentHash` (closed
> tab, GC'd mapping, or a server restart that also rotates
> `PAYWALL_SECRET`), the documented fallback is the restart-window
> standard-tier mint described in the `InvoiceState` block comment in
> `paywall.ts`. Reproduce it deliberately if you want the full picture,
> but it is outside the ~10 s recover-or-retry budget and is recorded
> as a known limitation, not a pass.

## Sub-case 2 — Under-payment

Goal: confirm a short payment grants **no** room.

- **LNbits.** A bolt11 invoice is fixed-amount; the network rejects a
  payment that does not settle the full amount, so the invoice simply
  never flips to `paid`. The rehearsal is to attempt a smaller payment
  from a wallet that lets you set a custom amount (most refuse for a
  fixed-amount bolt11), confirm the payment fails or the invoice stays
  unpaid, and confirm VOID never grants a room. Mark `pass` on "no room
  on short-pay".
- **BTCPay.** Easiest on a **regtest/signet** store, where you can send
  an exact partial amount. BTCPay records the partial payment and leaves
  the invoice status at `New` with a partial-payment exception — it does
  **not** become `Settled` / `Processing`. VOID's `checkPayment`
  therefore returns `false` and grants no room. Confirm both halves: the
  BTCPay invoice detail shows the partial (so the operator can refund
  per their policy), and VOID granted no room and minted no recovery
  code.

## Sub-case 3 — Over-payment

Goal: confirm an over-payment grants exactly one room and the excess is
not silently consumed by VOID.

- A fixed-amount bolt11 cannot normally be over-paid in a single
  payment, so this case is exercised on **BTCPay with over-payment
  allowed** (again easiest on regtest/signet). Pay more than the invoice
  amount: BTCPay settles the invoice (`status: Settled`) and flags the
  surplus (`PaidOver`).
- VOID sees `Settled` → grants exactly one room. Confirm:
  - exactly one room is created, one token, one recovery code;
  - the surplus is visible in the BTCPay invoice record (`PaidOver` /
    overpaid amount), i.e. it is held by the backend for the operator's
    refund policy — VOID does not pocket it, because VOID never reads the
    amount at all.

Record both the VOID outcome (one room) and the backend surplus record.

## Sub-case 4 — Duplicate / concurrent invoice for the same intent

Goal: confirm the same paid intent cannot yield two rooms or a double
debit. "Same intent" means the **same `paymentHash`** — two *separate*
`/paywall/invoice` calls are two separate paid intents and two rooms is
the correct outcome, so do not test that.

```bash
# 1. Create one invoice and pay it once.
# 2. Poll the SAME paymentHash concurrently from two clients:
HASH=<paymentHash>
ORIGIN=https://void.example
printf '%s\n%s\n' "$HASH" "$HASH" | \
  xargs -P2 -I{} curl -s "$ORIGIN/api/paywall/status/{}"
```

Expected, and what to confirm:

- **One token, one recovery reveal.** Both concurrent polls return the
  same `token` and `expiresAt`; only one response carries the
  `recoveryCode` field (the settled-state invariant reveals it once).
- **One room.** The JWT binds `paymentHash`; the socket layer's
  single-use `consumedRoomCreationTokens` map means a second create-room
  with the same token is refused. Drive create-room twice with the
  recovered token and confirm exactly one room is created and the second
  attempt is rejected. Capture the server-log line for the refused
  attempt.
- **No double-debit.** The wallet paid once; re-polling and recovery act
  on the same `paymentHash` and never request a second payment.

## Recovery and rollback — consolidated

| Lever you pulled | How to back it out | Verify after |
|---|---|---|
| `docker pause` LNbits / BTCPay | `docker unpause <container>` | Fresh invoice round-trips; the in-flight test invoice mints its token + recovery code on the next poll |
| Revoked BTCPay Greenfield key | Restore `BTCPAY_API_KEY` to a live key, restart the API server | `GET /api/paywall/status/<hash>` returns paid; `/api/health` is `200` |
| Partial / over payment (regtest) | None needed on VOID; settle or refund the BTCPay invoice per store policy | BTCPay invoice reaches its terminal state; VOID room count matches expectation |

After **every** sub-case, before moving on: confirm `/api/health` is
`200` and a brand-new invoice can be created, paid, and turned into a
room. That clean baseline is what proves the injection was fully backed
out and the next sub-case starts from a known-good state.

## Recording the result

A.13's DoD requires a **dated log naming the backend + wallet, with each
sub-case marked `pass`** (any `fail` blocks launch until it passes).
Record it as a dated entry in the launch-window rehearsal log
(`docs/launch-rehearsal-YYYY-MM-DD.md`, the same file A.11 uses) and
fill the A.13 **Check-date** line in `LAUNCH-CHECKLIST-2.md`. A minimal
shape:

```text
## A.13 Lightning failure-mode rehearsal — <date>

Backend: <lnbits|btcpay>   Wallet: <identifier>   Build: <commit>

1. Backend fails mid-pay .................. pass/fail   <notes: 503 at N s, recovery code minted>
2. Under-payment (no room) ............... pass/fail   <notes>
3. Over-payment (one room, surplus held) . pass/fail   <notes>
4. Duplicate / concurrent same intent .... pass/fail   <notes: one token, one room, 2nd create-room refused>
```

## Cross-references

- `LAUNCH-CHECKLIST-2.md` — A.13 gate and the "Before the window —
  rehearsal prep for A.13 / A.14" note this runbook satisfies.
- `README-selfhost.md` §6 (Lightning Backend Setup) — the per-host LNbits
  / BTCPay configuration this runbook assumes is already in place.
- `artifacts/api-server/src/services/lightning.ts` — `lightningFetch`
  timeout, the typed `LightningBackendUnavailableError`, and the
  per-backend settlement flags that sub-cases 1–3 depend on.
- `artifacts/api-server/src/routes/paywall.ts` — the `/paywall/invoice`,
  `/paywall/status`, and `/paywall/recover` handlers, the settled-state
  re-poll invariant, and the recovery-code lifecycle exercised by
  sub-cases 1 and 4.
