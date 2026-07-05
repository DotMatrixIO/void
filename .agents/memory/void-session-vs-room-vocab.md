---
name: VOID SESSION vs ROOM vocabulary
description: The settled product-language model for void-client UI — when to say ROOM, call, or session.
---

# VOID product-language model (settled)

Three terms, each doing distinct work in user-facing void-client UI:

- **ROOM** — the paid space you host / join / recover / extend / burn. The
  product's concrete brand noun. Runtime chrome uses it: `ROOM BURNED`,
  `ROOM ENDED`, `ROOM EXPIRED — TIME ENDED`, `JOIN THIS ROOM?`,
  `Incoming Room`; paywall `HOST A ROOM` / `OPEN ROOM` / `EXTEND THIS ROOM`;
  landing `HOST A ROOM` / `JOIN A ROOM` + hero metaphor "the room burns down".
- **call** — the live conversation happening inside a room ("BURN ends the
  call for everyone", "ahead of the call"). Use for the ephemeral live
  activity, not the space.
- **session** — RESERVED for cryptographic term of art only (session key,
  forward-secret session, "SESSION KEY" in KeyDerivationDiagram). It names the
  encrypted connection, never the product space. Also fine: "browser session"
  on the runtime-proof page (a different established meaning). Do NOT use
  "session" as a generic SaaS noun for the room/usage in UI copy.

**Why:** the earlier deliberate session-vs-room split (documented WON'T FIX in
`aesthetic-audit.md` V1) went stale once both the landing CTAs and the paywall
moved to ROOM, leaving the product half-migrated. The migration was completed
and this model fixed so future copy stays consistent.

**How to apply:** new runtime/in-app UI copy referring to the paid space says
ROOM; the live conversation says call; only crypto code/diagrams say session.
Internal identifiers (`sessionEnded`, `handleBurnSession`, `data-testid`/`id`
like `session-ended-overlay`, `SESSION_STORAGE_KEY`) were intentionally left
unchanged — they are not user-facing. A dedicated guard now enforces this:
`scripts/check-room-not-session.mjs` (npm `check:room-not-session`, in the
`marketing-voice` workflow) fails when the all-caps token `SESSION` appears
in user-facing client `.ts(x)` source AND in the out-of-app surfaces that
check-banned-phrases.mjs scans — `scripts/og-routes.mjs` (link-preview OG
metadata), `index.html` head meta, and the operator manifests
`manifest.yaml` / `umbrel-app.yml` / `README-selfhost.md` (its `EXTRA_FILES`
list, added so a "SESSION"-in-an-OG-title regression also fails CI). It
matches case-sensitive `\bSESSION\b`
only — so camelCase identifiers, `SESSION_STORAGE_KEY` (the `_` breaks the
word boundary), hyphenated `data-testid`/`id`, and lowercase comment prose are
excluded for free; the crypto "SESSION KEY" (KeyDerivationDiagram) and the
runtime-proof "BROWSER SESSION"/"HASH THIS SESSION" are allow-listed by exact
phrase, plus an inline `room-not-session-allow:` escape hatch. A SECOND,
narrower pass in the same script also flags softer title-case `\bSession\b`
("Session ended"/"Session expired") but ONLY inside the in-app runtime
surfaces (RoomPage, BurnedOverlay, PaywallModal, useRoomTeardown, and all of
`pages/room/`) — NOT repo-wide, because docs ("Session encryption/persistence")
and PeerTileGrid's crypto "Session keys" use title-case legitimately. Only
PeerTileGrid's "Session key" is allow-listed within the runtime set. Note BurnedOverlay
test + the playwright a11y-tree-audit spec also assert the overlay's accessible
name, so renaming the overlay headline means updating those specs in lockstep.
