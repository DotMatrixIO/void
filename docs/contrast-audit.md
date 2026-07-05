# WCAG contrast audit — Gold Voyager palette

This document records the measured WCAG 2.1 contrast ratios for every
`(foreground, background)` token pair currently used by the Gold Voyager
palette in `artifacts/void-client`. The audit is enforced automatically by
`artifacts/void-client/scripts/check-contrast.mjs`, which is wired into the
`marketing-voice` workflow. **Re-run the script and update this document
whenever a color token is changed.**

```bash
pnpm --filter @workspace/void-client run check:contrast
```

## Thresholds

| WCAG criterion | Threshold | Applies to |
|---|---|---|
| 1.4.3 Contrast (AA) — normal text | ≥ 4.5 : 1 | Body text, button labels, link text, slot labels, footer micro-copy that communicates product/security/privacy/legal meaning |
| 1.4.3 Contrast (AA) — large text  | ≥ 3 : 1   | Text ≥ 18pt or ≥ 14pt bold (only the wordmark qualifies here) |
| 1.4.11 Non-text contrast / 2.4.7 Focus visible | ≥ 3 : 1 | Borders, outlines, focus rings, control boundaries |

The privacy promise of this tool is empty if users with astigmatism, older
monitors, or sunlight glare bounce off unreadable text. The default
position is **AA-or-marked-exception**; "decorative" is not a free pass for
anything that communicates meaning.

## Audited pairs (enforced)

| Pair | FG | BG | Ratio | Threshold | Status |
|---|---|---|---|---|---|
| `--fg` on `--bg` (body) | `#1E1A14` | `#BEB3A2` | **8.37** | 4.5 | PASS |
| `--fg` on `--surface` (slot bg) | `#1E1A14` | `#A89E90` | **6.56** | 4.5 | PASS |
| `--fg-dim` on `--bg` (muted body) | `#352D20` | `#BEB3A2` | **6.56** | 4.5 | PASS (was `#5C5040` = 3.80, FAIL) |
| `--fg-dim` on `--surface` (muted on slot) | `#352D20` | `#A89E90` | **5.14** | 4.5 | PASS (was `#5C5040` = 2.97, FAIL) |
| `#FFFFFF` on `--red` (`.void-btn--red` active) | `#FFFFFF` | `#CC2200` | **5.53** | 4.5 | PASS (was `--bg` = 2.68, FAIL) |
| `--fg` on `--teal` (`.void-btn--teal` active) | `#1E1A14` | `#0D9D8B` | **5.12** | 4.5 | PASS (was `--bg` = 1.64, FAIL) |
| `--fg` on `--gold` (`.void-btn--gold` active) | `#1E1A14` | `#E8A200` | **7.91** | 4.5 | PASS |
| `#14110D` on `--gold` (`.void-header .void-btn--gold` active) | `#14110D` | `#E8A200` | **8.60** | 4.5 | PASS |
| `--gold` on `#14110D` (wordmark, header) | `#E8A200` | `#14110D` | **8.60** | 4.5 | PASS |
| `#A89E90` on `#14110D` (header button text) | `#A89E90` | `#14110D` | **7.13** | 4.5 | PASS |
| `--fg` border on `--bg` (default 3px button border) | `#1E1A14` | `#BEB3A2` | **8.37** | 3.0 | PASS |
| `--fg-dim` border on `--bg` (control-bar button border) | `#352D20` | `#BEB3A2` | **6.56** | 3.0 | PASS |
| `--gold` focus ring on `#14110D` (`.void-sas-chip:focus-visible`) | `#E8A200` | `#14110D` | **8.60** | 3.0 | PASS |
| `--teal` outline on slot bg (`.void-video-slot--local`) | `#0D9D8B` | `#14110D` | **5.57** | 3.0 | PASS |
| `--gold` outline on slot bg (`.void-video-slot--remote`) | `#E8A200` | `#14110D` | **8.60** | 3.0 | PASS |
| `#14110D` outline on `--bg` (header bottom border) | `#14110D` | `#BEB3A2` | **9.11** | 3.0 | PASS |
| `--fg-on-dark` error text on `--surface-dark` (StartScreen/PreviewGate error lines) | `#F2EEE6` | `#14110D` | **16.27** | 4.5 | PASS (was `--red` = 3.40, FAIL) |
| `--red` pill border on `--surface-dark` (error-line border signal) | `#CC2200` | `#14110D` | **3.40** | 3.0 | PASS |

## Marked exceptions

These pairs do not meet the body-text threshold and are recorded as
deliberate exceptions. Each is small, decorative-with-redundant-affordance,
or paired with a higher-contrast neighbor that carries the meaning. They
are tagged with `/* contrast-exception: <reason> */` in `index.css` where
applicable, or in `check-contrast.mjs` for inline-style cases.

| Pair | Ratio | Reason |
|---|---|---|
| `--red` on `#14110D` (media-state cam-off badge) | 3.40 | 12 px bold mono glyph used as a redundant signal alongside the cam-off overlay icon and text; the badge color is a flag, not the primary communicator. |
| `--burnt` on `#14110D` (caption ornament inside dark cards) | 4.41 | Section-header ornament inside dark info cards on `ThreatModelPage`; every adjacent informational sentence in those cards uses `--gold` (8.60) or `--teal` (5.57), which carries the meaning. |
| Disabled-button label (`--fg-dim` @ 0.4 opacity) | < 2 | WCAG 1.4.3 explicitly exempts disabled controls; the low effective ratio is what tells the user the control is inactive. |

## Accent text on light `--bg`

The four brand accents (`--red`, `--teal`, `--gold`, `--burnt`) all fail
body-text AA when used as text directly on `--bg` (`#BEB3A2`):

| Accent | Ratio on `--bg` |
|---|---|
| `--gold`  on `--bg` | **1.06 : 1** |
| `--teal`  on `--bg` | **1.64 : 1** |
| `--red`   on `--bg` | **2.68 : 1** |
| `--burnt` on `--bg` | **2.07 : 1** |

Rather than granting a blanket palette-level exemption, every actionable
/ body usage of these accents on `--bg` has been moved to `--fg`
(8.37 : 1) with the accent retained as the **border / underline /
background** that carries the affordance:

| Location | Before | After | Rationale |
|---|---|---|---|
| `.void-btn--red` default label | `color: var(--red)` (2.68 : 1) | `color: var(--fg)`; 3 px `--red` border keeps the destructive signal | Actionable body text |
| `.void-btn--teal` default label | `color: var(--teal)` (1.64 : 1) | `color: var(--fg)`; 3 px `--teal` border keeps the safe-action signal | Actionable body text |
| `.void-btn--red` hover/active | `color: var(--bg)` (2.68 : 1) | `color: #FFFFFF` on `--red` (5.53 : 1) | Actionable body text |
| `.void-btn--teal` hover/active | `color: var(--bg)` (1.64 : 1) | `color: var(--fg)` on `--teal` (5.12 : 1) | Actionable body text |
| `OnionMirrorLink` URL text | `color: var(--teal)` (1.64 : 1) | `color: var(--fg)` with `--teal` underline | Informational footer link |
| `OnionMirrorLink` Copy button | `color: var(--teal)` (1.64 : 1) | `color: var(--fg)`; 1 px `--teal` border | Actionable body text |
| `OnionMirrorLink` fallback input | `color: var(--teal)` (1.64 : 1) | `color: var(--fg)`; 1 px `--teal` border | Informational body text |
| `BurnedOverlay` reason line (11 px) | `color: var(--red)` on `#0A0908` (3.60 : 1) | `color: var(--bg)` on `#0A0908` (~9 : 1) | Informational body text — the 28 px bold pulsing "SESSION BURNED" headline above remains the red alarm signal |

Remaining accent-on-`--bg` text in the codebase is exclusively (a)
large-text headings (≥18 px / ≥14 px bold — AA-large 3 : 1; e.g. the
landing-page hero and threat-model section titles), or (b) decorative
inline emphasis wrapped in `--fg` sentences (`<code>` spans on
long-form pages) where the surrounding `--fg` copy carries the meaning.

### Per-instance contrast exceptions (task #414)

A subsequent sweep (task #414) added an explicit row in
`scripts/check-contrast.mjs` for each of the four accent-on-`--bg`
pairs so they appear in every audit run as `EXEMPT (exception)` rather
than being silently omitted from the table. The palette-level
exception is keyed to the in-tree usages documented in the script's
block comment, all of which are one of:

- **Inside a `#14110D` card.** `ThreatModelPage.tsx` wraps every body
  paragraph in `sectionStyle` (a dark concrete-textured card). The
  `<code>` spans and accent emphasis on that page therefore land on
  `#14110D`, not on `--bg` — `--gold` (8.60 : 1) and `--teal`
  (5.57 : 1) pass body AA on that surface, `--burnt` (4.41 : 1) and
  `--red` (3.40 : 1) carry the existing dark-card exemptions above.
  A top-of-file note in `ThreatModelPage.tsx` records the surface
  contract, and the inline-style `<code>` helper in `renderInlineMarkdown`
  carries a per-instance `/* contrast-exception: <reason> */` comment.
- **Recolored to `--fg` with the accent as a border or underline.**
  See `OnionMirrorLink.tsx` (URL text, Copy button, fallback input)
  and the `.void-btn--red` / `.void-btn--teal` rules in `index.css`.
- **Inside a dark overlay or card with a per-instance comment.**
  `BurnedOverlay.tsx` (red SESSION BURNED headline on `#0A0908`,
  AA-large 28 px bold) and `Bip39PhraseGrid.tsx` (red spelling-hint
  line on `#14110D`, redundant with the slot's red border and wavy
  underline) both carry `/* contrast-exception: <reason> */` comments
  at the use site.
- **Large-text headings (≥18 px or ≥14 px bold).** Landing-page hero
  and section titles satisfy AA-large at 3 : 1.

**Any new small-text body usage of an accent on `--bg` must carry a
per-instance `/* contrast-exception: <reason> */` comment at the use
site** _and_ be added to the use-site list in
`scripts/check-contrast.mjs`. If the palette-level exception is
removed (turning these four rows into `FAIL`), every offending use
site will be flagged by the audit.

## Focus indicators

Keyboard focus is delivered by 3 px solid borders/outlines in `--fg`
(8.37 : 1 on `--bg`) for the default `.void-btn`, and by 2 px `--gold`
outlines (8.60 : 1 on `#14110D`) for the SAS verification chip
(`.void-sas-chip:focus-visible`). The phrase-grid slots inherit their
button focus from the underlying `.void-btn` border. All focus
indicators audited here exceed the 3 : 1 non-text contrast requirement
of WCAG 2.4.7 / 2.4.11.

## What changed in this audit

1. `--fg-dim` darkened from `#5C5040` (3.80 / 2.97) to `#352D20`
   (6.56 / 5.14). This was the highest-impact single change because
   `var(--fg-dim)` is used in roughly 25 places across `index.css` and
   inline component styles (footer micro-copy, slot labels, modal
   captions, no-signal text, threat-model body, hamburger menu, share
   sheets, etc.).
2. `.void-btn--red` active-state text changed from `--bg` (2.68) to
   `#FFFFFF` (5.53).
3. `.void-btn--teal` active-state text changed from `--bg` (1.64) to
   `--fg` (5.12).
4. Token-level comment + `/* contrast-exception: ... */` annotations
   added in `src/index.css` so future edits cannot quietly regress.
5. `scripts/check-contrast.mjs` added and wired into the
   `marketing-voice` workflow + `check:contrast` package script.

## Out of scope (per task)

- Alternate themes / light-dark toggle.
- Typeface, font-weight, or layout changes.
- Shader-output text (SILHOUETTE / ASCII) — intentional visual effect on
  video, not UI text.
