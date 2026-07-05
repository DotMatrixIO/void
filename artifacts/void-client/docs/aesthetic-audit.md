# VOID Client — Aesthetic / Design Audit

**Status:** Review-only. No code, CSS, copy, or token was changed by this audit.
**Date:** 2026-06-03
**System under review:** the "Gold Voyager" brutalist design system in
`artifacts/void-client`.

## Method & coverage

- **Live capture.** The dev server was driven with headless Chromium
  (`reducedMotion: reduce` to bypass the first-visit splash) and every
  user-facing route was screenshotted full-page at **1440px**, **768px**, and
  **375px**. All shots live in `docs/aesthetic-audit-shots/`
  (`<route>__<width>.png`, 66 files).
- **Routes captured:** `/`, `/why`, `/how-it-works`, `/compare`,
  `/threat-model`, `/audit`, `/biometric-masking`, `/law-enforcement`,
  `/agent-mode`, `/pricing`, `/limits`, `/docs` + all eight docs sub-pages,
  `/proof/server-state`, `/proof/runtime`.
- **In-app surfaces (overlays/modals).** These ship behind a live call /
  Lightning-payment / WebRTC-peer state that this pass could not drive
  headlessly, so their findings are **read from source and need maintainer
  visual confirmation** — they are collected in their own section and marked
  as such. Dev/internal routes (`/still/:variant`, `/__smoke/room`,
  `/__test/joined-call`, OG poster routes) were excluded per scope.

## Priority rubric

- **HIGH** — a first-time visitor would notice and react negatively.
- **MEDIUM** — a returning user/operator notices on a careful read.
- **LOW** — only visible on side-by-side comparison or careful audit.

---

## Remediation status

The audit above is the original review-only capture. The findings have since
been worked through; this section records the disposition of each. The detailed
findings below are left verbatim for traceability.

| ID | Disposition | Note |
|----|-------------|------|
| C1 | **RESOLVED** | `/agent-mode` was removed with the agent product: `AgentModePage.tsx` no longer exists and no route or in-app link reaches it. `App.routes-removed.test.tsx` pins that the route stays absent (Task #321). |
| C2 | **RESOLVED** | One secondary-heading treatment now lives in `longFormStyles.sectionHeadingStyle` (burnt mono + `▌`); the teal-Staatliches lead is `leadStyle`. Pages consume these instead of re-declaring. |
| C3 | **RESOLVED** | Docs/long-form body copy is standardized at 14px in `longFormStyles.sectionStyle`. |
| C4 | **FIXED** | Added a single `--scrim` token (`rgba(10,9,8,0.85)`) in `index.css`; every blocking modal/sheet backdrop (ConfirmDialog, MasksSheet, PhraseShareModal, RoomShareSheet, ScreenShareModals, DevToolsP2PModal, AllowUnmaskedToggleControl) now consumes it. The two `0.78` outliers were folded in. |
| C5 | **WON'T FIX** | PaywallModal is a deliberately *inverted* surface — light scrim (C4 exception) + light `--bg` card + dark `--fg` frames throughout (outer border **and** header rule). The `--fg` frame is internally consistent with that inversion, not off-family drift; unifying only the outer border to gold would fight the modal's own header rule. Documented as the one intentional exception. |
| C6 | **WON'T FIX** | Dismissal is intentionally role-based: confirm/action dialogs (ConfirmDialog, Paywall) are dismissed by their labelled buttons / CTA + ESC + backdrop, while content/share modals (PhraseShareModal, RoomShareSheet) carry a visible `✕`. Adding an `✕` to a two-button confirm dialog would duplicate its Cancel affordance. |
| C7 | **RESOLVED** | `ServerStateProofPage`'s BACK link is relabeled **"← THREAT MODEL"**, so its non-home target is intentional and legible. |
| C8 | **RESOLVED** | Shared chrome extracted into `PageShell.tsx`; the type scale + card recipe live once in `longFormStyles.ts`. |
| S1 | **FIXED** | `/proof/runtime` BUILD INFO box now seeds a "loading…" placeholder (`build-info-loading`) until the fetch resolves, so it never renders as a blank rectangle. |
| S2 | **WON'T FIX** | Landing decorative density — the audit itself rates this "taste, not defect"; the composition is called out under "what works well" and is left intact. |
| R1 | **RESOLVED** | `/compare` table is wrapped in `ScrollableTable` (horizontal-scroll container + edge cue), so the VOID column is reachable at 375px. |
| R2 | **RESOLVED** | `/docs/compare` table is wrapped in the same `ScrollableTable`. |
| R3 | **WON'T FIX** | Accent-colored runs on `/threat-model` and `/law-enforcement` are the deliberate brutalist register flagged under "what works well"; flattening them to body color would weaken a load-bearing voice decision. Taste-level, LOW. |
| V1 | **RESOLVED** | The earlier WON'T-FIX rationale (a deliberate *session*-vs-*room* split, with the runtime UI on "SESSION" throughout) went stale once the landing CTAs **and** the paywall both moved to "ROOM" — leaving the product half-migrated. The migration is now completed and a final three-term model is fixed: **ROOM** is the paid space you host/join/recover/extend/burn (runtime now reads `ROOM BURNED`, `ROOM ENDED`, `ROOM EXPIRED — TIME ENDED`, `JOIN THIS ROOM?`, `Incoming Room`, paywall `HOST A ROOM`/`OPEN ROOM`/`EXTEND THIS ROOM`), matching the landing CTAs and the hero metaphor "the room burns down"; **call** is the live conversation inside it (already the established term — "BURN ends the call for everyone", "ahead of the call"); and **session** survives only as a cryptographic term of art (session key, forward-secret session) that names the encrypted connection, never the product space. The "SESSION" runtime literals the old note relied on no longer exist. |
| V2 | **TRACKED ELSEWHERE** | Footer placeholder link is covered by existing tasks ("Replace placeholder source-code link…" / "Swap placeholder URLs…"). Not a new finding. |
| V3 | **WON'T FIX** | `/pricing` feature-list cadence — the audit rates this a "tone-watch, not a defect"; copy stays concrete and banned-phrase-clean. |
| token#1 (`#14110D`) | **RESOLVED** | The dark surface is now the `--surface-dark` token in `src/index.css`. All CSS-consumable call-sites route through `var(--surface-dark)`; the few canvas `fillStyle` cases read it at runtime via `readCssToken('--surface-dark')` (`src/lib/cssTokens.ts`), and `check-contrast.mjs` extracts it from the CSS instead of hard-coding the literal. Rendering is byte-identical (pure dedup); drift-gated posters were regenerated. |
| token (LOW) | **WON'T FIX** | `#BEB3A2`-as-text, the one-off literals, the 0.82/0.85/0.88 texture-tint variance, and the proof-page `RUN HASH CHECK` not using `.void-btn` are all LOW, near-invisible, and not worth the regression surface of touching in-room/poster code in this pass. Accepted; fold into the token#1 follow-up if pursued. |

---

## What already works well (load-bearing decisions)

These are the decisions the brand rests on. They should be protected when the
findings below are remediated.

1. **One disciplined palette, audited.** The Gold Voyager tokens
   (`--bg`/`--surface`/`--fg`/`--fg-dim`/`--gold`/`--teal`/`--red`/`--burnt`)
   are used consistently and are backed by a wired contrast script
   (`check:contrast`) + `docs/contrast-audit.md`. Color is doing real
   semantic work (teal = safe/VOID-wins, red = destructive, gold = brand
   accent), not decoration.
2. **Consistent global chrome.** Every page carries the same `HamburgerMenu`,
   the pixelated `void-icon.png` home link top-left, and the shared
   `PageFooter`. The product feels like one object.
3. **A genuinely consistent display heading.** The `Staatliches` gold H1 at
   `clamp(28px, 6vw, 42px)` / `letter-spacing: 4px` is identical across
   marketing and docs pages — the strongest consistency anchor in the system.
   See `aesthetic-audit-shots/threat-model__1440.png`,
   `docs__1440.png`, `compare__1440.png`.
4. **The landing page composition holds at all three widths.** The alternating
   dark-asphalt → orange creed strip → light-concrete "refusal" rhythm is
   cinematic and survives the reflow to 768 and 375 without breaking. See
   `landing__375.png`, `landing__768.png`.
5. **Readable measure.** Long-form pages cap content at `maxWidth: 680px`, so
   body line-length stays in the comfortable range on wide monitors.
6. **A distinctive, concrete brand voice.** The brutalist register
   ("A man named Howard bought a lock for his door.") on `/threat-model` and
   `/law-enforcement` is specific and confident, and the banned-phrase guard
   keeps the worst SaaS-speak out.

---

## Findings by dimension

### Consistency

**C1 — `/agent-mode` renders the generic 404. — HIGH**
`AgentModePage.tsx` exists and is fully styled, but no `<Route path="/agent-mode">`
is registered in `App.tsx`, so the URL falls through to `NotFound`. A visitor
who follows an inbound or social link to `/agent-mode` sees a bare "404 / NOT
FOUND / HOME" screen — a jarring first impression for a page that otherwise
exists. *(This straddles routing and aesthetics; the visible outcome is an
aesthetic failure.)* **Fix:** register the route (mirroring the other page
routes) — or, if the page is intentionally retired, delete it and any links so
it can't be reached. Evidence: `aesthetic-audit-shots/agent-mode__1440.png`.

**C2 — Secondary-heading treatment forks into two systems. — MEDIUM**
Most pages render a teal lead/subhead in `Staatliches` with a
`borderLeft: 4px solid var(--teal)` (e.g. Compare's "FAIR QUESTION." —
`compare__1440.png`). But `LawEnforcementPage` and `AgentModePage` use
`var(--burnt)` **mono** subheads plus heavy `3px` gold dividers, and
`ThreatModelPage` uses burnt mono section headers (`▌ WHAT VOID PROTECTS YOU
FROM`). The two systems sit side-by-side in the same nav tree.
Evidence: `law-enforcement__1440.png`, `threat-model__1440.png` vs
`compare__1440.png`. **Fix:** pick one secondary-heading style (teal Staatliches
lead *or* burnt mono section header) and apply it across all long-form pages.

**C3 — Docs body font size drifts 12 / 13 / 14px. — MEDIUM**
`DocsPricingPage`, `DocsLimitsPage`, `DocsBiometricPage`, `DocsAuditPage`,
`DocsHowItWorksPage` set body copy at **14px**; `DocsIndexPage`, `DocsFaqPage`,
`DocsComparePage`, `DocsThreatModelPage` set it at **12–13px**. There is no
functional reason for the split — it's drift from each page re-declaring its own
type. **Fix:** standardize one docs body size (14px reads best on the dark
cards). Evidence: compare `docs-pricing__1440.png` (14px) with
`docs-faq__1440.png` (12px).

**C4 — Modal backdrop opacity is inconsistent. — MEDIUM** *(source-read; needs visual confirmation)*
Overlay scrims range across `rgba(10,9,8,0.6)` (SAS dialog),
`rgba(20,17,13,0.78)` (PhraseShare / RoomShare), `rgba(10,9,8,0.85)`
(ConfirmDialog / MasksSheet / ScreenShareModals), and `rgba(190,179,162,0.95)`
(PaywallModal — a *light* scrim, unlike all the others). The result is that
"how dark does the world go when a modal opens" changes per modal. **Fix:**
define one or two backdrop tokens (e.g. a standard dark scrim ~0.85) and have
every overlay consume it; keep Paywall's light scrim only if it is a deliberate
exception and document it.

**C5 — Modal card border color forks. — MEDIUM** *(source-read; needs visual confirmation)*
Most cards are framed `3px solid var(--gold)` (ConfirmDialog, MasksSheet,
PhraseShareModal, RoomShareSheet), but `PaywallModal` uses `3px solid var(--fg)`
and `DeadRoomOverlay` uses `3px solid var(--red)`. The red dead-room frame is
defensible as a state signal; the Paywall's `--fg` frame just reads as
off-family against the gold-framed set. **Fix:** bring Paywall onto the gold
frame (or document why the paid-gate is deliberately framed differently).

**C6 — Modal dismissal affordance is inconsistent. — LOW** *(source-read; needs visual confirmation)*
`PhraseShareModal` and `RoomShareSheet` expose a visible `✕` close button
(`3px solid var(--fg-dim)`); `PaywallModal` and `ConfirmDialog` have no visible
close and rely on ESC / backdrop / CTA. Users learn one dismissal pattern and
then can't find it elsewhere. **Fix:** standardize whether overlays carry a
visible close control.

**C7 — `ServerStateProofPage` "← BACK" points to `/threat-model`. — LOW**
Every other page's BACK link returns home; this one returns to threat-model.
Minor nav inconsistency. **Fix:** align the target (or relabel it
"← BACK TO THREAT MODEL" so the difference is intentional and legible).

**C8 — No shared docs/page layout component (root cause of C2/C3). — LOW**
The icon+BACK header and the `concrete.jpeg`-over-`#14110D` card recipe are
copy-pasted into every page file rather than living in one
`DocsLayout`/`PageShell`. This duplication is *why* the body-size and subhead
drift exists. **Fix (remediation task):** extract a shared shell so the type
scale and chrome are defined once.

### Simplicity

**S1 — `/proof/runtime` shows an empty beige panel on load. — MEDIUM**
The "BUILD INFO" box renders as a blank light rectangle until "RUN HASH CHECK"
is pressed, so the page's most prominent element initially reads as a broken /
unstyled container. **Fix:** seed the box with a placeholder line (e.g. the
expected gitSha / "press RUN HASH CHECK to populate") so it never looks empty.
Evidence: `aesthetic-audit-shots/proof-runtime__1440.png`.

**S2 — Landing decorative geometry is near its clutter ceiling. — LOW**
The landing root stacks 10+ absolutely-positioned decoratives (amber slabs,
brown box, teal band, red rule, two small teal/red dots, thin grey right-edge
slab). The composition currently *works* (see "what works well"), but the two
small dots and the thin right-edge grey slab carry little semantic weight and
nudge the page toward busy. **Fix:** consider trimming 1–2 of the smallest
decoratives; treat as taste, not defect. Evidence: `landing__1440` region (see
`landing__768.png`).

### Readability

**R1 — The comparison table clips off-screen at 375px. — HIGH**
On `/compare` at mobile width the capability table overflows horizontally: the
header truncates to "…FAC" and the **VOID** column — the entire point of the
table — is pushed off the right edge with no scroll affordance. The desktop
version is excellent (teal-highlighted VOID column), which makes the mobile
clipping worse by contrast. **Fix:** give the table a horizontal-scroll
container with an edge cue, or switch to a stacked per-competitor layout below
~600px. Evidence: `compare__375.png` (clipped) vs `compare__1440.png` (clean).

**R2 — `/docs/compare` table is at the legibility floor at 375px. — MEDIUM**
The docs version keeps all columns on-screen but only by shrinking them to a
very dense, tiny grid. Legible, but barely. **Fix:** same treatment as R1
(scroll container or stacked layout). Evidence: `docs-compare__375.png`.

**R3 — Long runs of accent-colored body text reduce scannability. — LOW**
On `/law-enforcement` and `/threat-model`, multi-line passages are set in
`--burnt`/`--gold` mono on the dark card rather than the white/tan body color,
so emphasis loses meaning when many lines are colored at once. **Fix:** reserve
accent color for the *lead clause* of a point, not whole paragraphs. Evidence:
`law-enforcement__1440.png`, `threat-model__1440.png`.

### Voice / register

**V1 — "SESSION" vs "ROOM" terminology split. — MEDIUM**
The landing CTAs read **HOST A SESSION** / **JOIN A SESSION**, but the recover
CTA, the entire Feature Policy, and the docs consistently use **ROOM**
("VOID is a room", "RECOVER A PAID ROOM"). "Session" is the softer,
more-generic SaaS word; "room" is the brand's concrete-over-abstract term.
**Fix:** standardize the primary CTAs on "ROOM" (e.g. HOST A ROOM / JOIN A
ROOM) to match the brand's own vocabulary. Evidence: `landing__375.png`,
`landing__768.png`.

**V2 — Footer source link is a visible placeholder. — observation (already tracked)**
Every page's footer shows `SOURCE / SELF-HOST: [[TO BE ADDED]]`. This is
already covered by the existing tasks "Replace placeholder source-code link in
the page footer" and "Swap placeholder URLs in both manifests" — **noted here
only so the audit is complete; not a new finding.** Visible in every
screenshot's footer.

**V3 — Register is otherwise strong; watch the feature-list cadence on `/pricing`.** **— LOW**
The "WHAT YOU GET" bulleted list on `/pricing` is the one place the copy edges
toward a generic feature-list cadence. The wording itself stays concrete (no
banned words), so this is a tone-watch, not a defect. Evidence:
`pricing__375.png`.

---

## Token-drift assessment (against the five criteria)

1. **Non-token colors in use — YES (LOW–MEDIUM).** Several hardcoded hexes
   recur outside the token set:
   - `#14110D` — the de-facto "dark surface" behind every card/header/menu.
     **RESOLVED:** now the `--surface-dark` token (`src/index.css`); every
     call-site routes through it (`var(--surface-dark)`, or `readCssToken` for
     canvas), removing the single most-pasted literal in the codebase.
   - `#BEB3A2` — equals `--bg` but is hardcoded as a *text* color on dark cards
     in several pages instead of referencing the token. **LOW.**
   - One-off literals: `#642D00`, `#5C3A1E` (landing), `#9C8E7A`, `#5C5040`
     (footer/menu dim text), `#B85000` (creed strip), `#0A0908`
     (ServerState/Burned), `#C8351A` (ScreenShare), and the SplashScreen's own
     brighter set (`#F5F1E8`/`#FFC542`/`#FF8A3D`). The Splash set is a
     *documented* intentional exception (theme vars vanish on its near-black
     backdrop); the others are drift. **LOW.**
     - Note: `#5C5040` is the exact value `--fg-dim` was *darkened away from*
       for failing AA (per `index.css`). It still appears as a literal in
       `HamburgerMenu` labels and footer dates. On the dark menu background it
       is fine, but it should be re-derived from a token so it can't silently
       regress. **LOW.**
2. **Typography scale consistent? — Partly.** H1 is consistent (good); body
   size (C3) and secondary-heading style (C2) drift.
3. **Button styles consistent? — Mostly YES.** The `.void-btn` family (3px
   borders, uppercase mono, teal/red/gold variants) is applied consistently.
   Minor exception: the proof pages use a raw gold-filled `RUN HASH CHECK`
   button rather than a `.void-btn` variant. **LOW.**
4. **Concrete texture tint opacity consistent? — Mostly.** The dark overlay is
   `0.82` on the header/cards but `0.85` on video slots and `0.88` on the body
   background. The variance is small and mostly invisible, but it's three
   values for "the same" texture. **LOW.** Standardize on one.
5. **Decorative geometry used consistently? — YES, with intent.** Rich
   geometry is confined to the landing hero (intentional); interior pages use
   the restrained `3px` gold divider + `▌` marker. This is a deliberate,
   defensible split, not drift.

---

## In-app surfaces / overlays (source-read — needs maintainer visual confirmation)

These could not be driven into their live states in this pass. Source review
surfaced the consistency issues already filed as **C4** (backdrop opacity),
**C5** (card border), and **C6** (dismissal affordance). Additional notes:

- **SplashScreen** intentionally uses its own brighter palette on a near-black
  backdrop — confirmed as a documented exception, not drift.
- **PaywallModal** is the biggest single overlay divergence (light scrim +
  `--fg` frame) and is the highest-value surface to confirm visually, since the
  paywall is the one screen a paying user *must* pass through.
- **Bip39PhraseGrid / DropSlot / PeerTileGrid** rely on teal/gold/red `2–3px`
  outlines that match the room's slot-outline language; they read as
  consistent in code.

**Recommendation:** the maintainer should capture the PaywallModal, SAS dialog,
PhraseShareModal, DeadRoomOverlay, and BurnedOverlay in their live states and
confirm C4/C5/C6 before scheduling remediation.

---

## Top findings (summary)

| ID | Priority | Surface | Issue |
|----|----------|---------|-------|
| C1 | RESOLVED | `/agent-mode` | Page & route removed with the agent product |
| R1 | HIGH | `/compare` @375 | Comparison table clips; VOID column off-screen |
| C2 | MEDIUM | law-enforcement / agent-mode / threat-model | Subheading style forks (burnt mono vs teal Staatliches) |
| C3 | MEDIUM | docs pages | Body font size drifts 12/13/14px |
| C4 | MEDIUM | modals | Backdrop opacity inconsistent (0.6–0.95) |
| C5 | MEDIUM | PaywallModal | `--fg` card frame off-family vs gold-framed set |
| S1 | MEDIUM | `/proof/runtime` | Empty beige BUILD INFO panel reads as broken |
| R2 | MEDIUM | `/docs/compare` @375 | Table at legibility floor |
| V1 | RESOLVED | runtime UI | Runtime chrome unified to "ROOM"; "call" = live conversation, "session" = crypto term only. Enforced by `scripts/check-room-not-session.mjs` (`check:room-not-session`, in the `marketing-voice` workflow). |
| token#1 | RESOLVED | system-wide | `#14110D` dark surface now the `--surface-dark` token |

LOW findings: C6, C7, C8, S2, R3, V3, and the remaining token-drift items.

---

## Screenshot index

All screenshots: `docs/aesthetic-audit-shots/<route>__<width>.png`
(`width` ∈ {1440, 768, 375}). 22 routes × 3 widths = 66 files.
