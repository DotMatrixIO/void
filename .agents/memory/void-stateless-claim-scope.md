---
name: VOID "stateless" claim accuracy & guard scope
description: Why literal "stateless" is an overclaim, the accurate replacement, and which files the marketing-voice guards do NOT scan.
---

The accurate VOID claim is **"no accounts and no room content stored" / "ephemeral"**, NOT literal "stateless".

**Why:** the server keeps a minimal paid-room metadata snapshot (`data/rooms.json` via `roomsPersistence.ts` — host payment hashes, paid window, tier, room type, `relayOnly`/`locked` flags; never room content or peer identities) that **survives an operator restart** so a host who refreshes mid-window need not re-pay. This is documented in `VOID_TECHNICAL_OVERVIEW.md` §3.5 (and §1, §13.2). So "stateless" / "restart equals clean slate" / "wiped on restart" / "no persistent state" all overclaim.

**Preserve (legit technical uses):** the "Stateless Architecture" heading + `#stateless-architecture` anchor (pinned by `docsHowItWorksPage.test.tsx`), "stateless JWT authentication", "stateless signaling server", and the §11/§14 changelog history.

**Guard-scope gotcha:** the `check:room-not-session` / banned-phrase / claim guards scan client `src`, `og-routes.mjs`, `index.html`, and the operator manifests (`manifest.yaml`, `umbrel-app.yml`, `README-selfhost.md`) — but **NOT the root `README.md`**. Root-README marketing claims ship unguarded, so grep it by hand when doing a claims pass.

**How to apply:** on any marketing-copy accuracy pass, hand-check root `README.md` and the durability sub-claims in `umbrel-app.yml` / `README-selfhost.md` against §3.5; the CI marketing-voice suite will not catch them.
