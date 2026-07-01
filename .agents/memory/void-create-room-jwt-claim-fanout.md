---
name: VOID create-room JWT claim change fan-out
description: Changing the host-authorization JWT's create-room replay-guard claim breaks many inline-minted test tokens; migrate them all or create-room rejects.
---

# VOID create-room JWT replay-guard claim

The host-authorization JWT (minted in `paywall.ts` statusHandler/recoverHandler)
carries the single-use **create-room replay-guard key** as a top-level claim. It
is a fresh server-minted random `jti` (`crypto.randomBytes(16).toString("hex")`),
**not** `paymentHash`. `accessController.ts` reads that claim and rejects a token
that lacks/duplicates it.

**Why:** paymentHash must stay server-side only (invoiceStates keys,
`/paywall/invoice`, `/status` route param, log digests). Leaking it to the
browser via the JWT was the bug. jti and `reclaimToken` (host-reclaim HMAC) have
**separate lifecycles** — do not key one off the other.

**How to apply:** When you change the create-room replay-guard claim shape,
every test that mints its OWN token inline must be migrated in lockstep, or
create-room loud-fails with `PAYMENT_REQUIRED` (accessController rejects the
old-shape token). Inline token minters live across many `__tests__` files
(socket-handlers, socket-host-presence, create-room-edge-cases, forged-peer-e2e,
cooperative-relay-only-e2e, paywall-socket-integration, test-server helper).
`paywall-routes.test.ts` used to read `paymentHash` back off
`__testing.recoveryCodes.get(code)` — when the claim left the recovery map, the
fix was to have the `payAndIssue` helper return the paymentHash it already had
from the invoice, not the recovery entry.
