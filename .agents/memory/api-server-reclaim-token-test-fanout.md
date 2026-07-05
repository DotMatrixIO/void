---
name: api-server reclaim-token test helper fan-out
description: Host reclaim is gated on a JWT-embedded reclaim token; every test that mints its own creation/extension JWT must include it or host-reclaim assertions silently fail.
---

Host reclaim in api-server no longer keys off the Lightning `paymentHash`. The room
persists a keyed HMAC of a per-room **reclaim token** that is minted into the
host-authorization JWT. Reclaim succeeds only when the rejoining JWT presents the
same embedded reclaim token.

**The gotcha:** several `__tests__` files mint their OWN JWTs via a local helper
(not just `helpers/test-server.ts`) — e.g. `socket-host-presence.test.ts`'s
`tokenWithHash`, `socket-host-binding.test.ts`'s `tokenWithHash`. If a helper omits
`reclaimToken`, the JWT verifies fine but the room stores no reclaim hash, so any
"original payer rejoins and reclaims host" assertion fails with `isHost: false` —
NOT a verification error. To present the same reclaim token across create + rejoin,
reuse the SAME token STRING; to test distinct hosts, give each a fresh
`crypto.randomBytes(32).toString("hex")`.

**Why it's easy to miss:** typecheck passes (reclaimToken is optional on the
verified-token types for graceful legacy handling), and most tests don't exercise
reclaim, so only the host-presence/reclaim tests surface the omission.

**How to apply:** when changing the host-claim secret, grep `__tests__` for every
`jwt.sign(` / local token helper, not just the shared `test-server.ts` factory.
