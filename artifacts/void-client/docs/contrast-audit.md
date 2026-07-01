# Contrast Audit — Gold Voyager palette

Source of truth: `scripts/check-contrast.mjs` (run with
`pnpm --filter @workspace/void-client run check:contrast`). The script reads
the design tokens out of `src/index.css` and recomputes the WCAG 2.1
relative-luminance contrast ratio for every (foreground, background) pair
that appears in real UI. CI fails if any non-exception pair drops below its
threshold (body text ≥ 4.5:1, large text / non-text UI / focus ring ≥ 3:1).

## Tokens

| Token        | Hex      |
| ------------ | -------- |
| `--bg`       | `#BEB3A2` |
| `--surface`  | `#A89E90` |
| `--fg`       | `#1E1A14` |
| `--fg-dim`   | `#352D20` |
| `--gold`     | `#E8A200` |
| `--teal`     | `#0D9D8B` |
| `--red`      | `#CC2200` |
| `--burnt`    | `#C85A00` |
| header bg    | `#14110D` |

## Current audit output (passing)

All audited pairs PASS or are EXEMPT for a documented reason. Latest run:

```
fg/bg                                #1E1A14  #BEB3A2  8.37    4.5   PASS
fg/surface                           #1E1A14  #A89E90  6.56    4.5   PASS
fgDim/bg                             #352D20  #BEB3A2  6.56    4.5   PASS
fgDim/surface                        #352D20  #A89E90  5.14    4.5   PASS
white/red (btn active)               #FFFFFF  #CC2200  5.53    4.5   PASS
white/headerBg (thesis)              #FFFFFF  #14110D  18.82   4.5   PASS
fg/teal (btn active)                 #1E1A14  #0D9D8B  5.12    4.5   PASS
fg/gold (btn active)                 #1E1A14  #E8A200  7.91    4.5   PASS
headerBg/gold (header btn)           #14110D  #E8A200  8.60    4.5   PASS
gold/headerBg (wordmark)             #E8A200  #14110D  8.60    4.5   PASS
headerBtn/headerBg                   #A89E90  #14110D  7.13    4.5   PASS
fg border on bg                      #1E1A14  #BEB3A2  8.37    3     PASS
fgDim border on bg                   #352D20  #BEB3A2  6.56    3     PASS
gold focus on headerBg               #E8A200  #14110D  8.60    3     PASS
teal outline on slot bg              #0D9D8B  #14110D  5.57    3     PASS
gold outline on slot bg              #E8A200  #14110D  8.60    3     PASS
headerBg outline on bg               #14110D  #BEB3A2  9.11    3     PASS
red badge on headerBg                #CC2200  #14110D  3.40    4.5   EXEMPT
bg text on burnedOverlay             #BEB3A2  #0A0908  9.63    4.5   PASS
gold on bg (accent text)             #E8A200  #BEB3A2  1.06    4.5   EXEMPT
teal on bg (accent text)             #0D9D8B  #BEB3A2  1.64    4.5   EXEMPT
red on bg (accent text)              #CC2200  #BEB3A2  2.68    4.5   EXEMPT
burnt on bg (accent text)            #C85A00  #BEB3A2  2.07    4.5   EXEMPT
```

## Exceptions

### Accent text on light `--bg`

`--gold`, `--teal`, `--red`, and `--burnt` all fail body-text AA when
rendered directly on `--bg` (#BEB3A2). The palette-level exception covers
in-tree usages, which are restricted to one of these documented mitigations:

- **Inside a dark `#14110D` `sectionStyle` card.** Long-form pages
  (`ThreatModelPage`, `PricingPage`, `LawEnforcementPage`, `ComparePage`,
  `LimitsPage`, `BiometricPage`) wrap their body content in dark cards. Gold
  `<code>` spans, `▌` markers, and inline accent emphasis all render on
  `#14110D`, where `--gold` clears AA at 8.60:1.
- **Recolored to `--fg` with the accent as border/underline.** Buttons and
  the `OnionMirrorLink` URL/copy-button/fallback follow this pattern.
- **AA-large heading text (≥18px or ≥14px bold, threshold 3:1).** Hero
  headlines on landing-style pages and threat-model section titles.
- **Per-instance `/* contrast-exception: <reason> */` comment.** Reserved
  for disabled-control labels, decorative typographic texture, and badges
  where the color is a redundant flag (e.g. the `--red` cam-off badge on
  the header).

### Task #514 — gold-on-grey sweep

Audit follow-up to the `BrowserBlockedScreen` headline fix. The same dark
`#14110D` chip / border-only treatment was applied to every other gold
accent that was sitting directly on `--bg` or `--surface`:

- `InAppBrowserScreen` headline (now wrapped in a `#14110D` chip with a
  `--gold` border, mirroring `BrowserBlockedScreen`). The `OPEN IN CHROME`
  anchor also got the `#14110D` chip so the gold label and gold border
  both pass on a dark fill.
- `RoomPage` `KNOCKING…` knock-pending dialog title (was gold on
  `var(--surface)` inside the dialog card — wrapped in the dark chip).
- `RoomPage` `shareNotice` and `extendNotice` banners (were gold on
  `var(--surface)` — banner background flipped to `#14110D`, keeping the
  gold border-bottom).
- `RoomPage` connection-wait hint (heading wrapped in the dark chip; the
  trailing `×` dismiss button recolored to `var(--fg)`).
- `RoomPage` "STOP" button inside the active-share banner (was gold on
  `var(--bg)` — flipped to `#14110D`).
- `DropSlot` `DROP — SHARED SLOT` heading and the
  `[DISABLED DURING SCREEN SHARE]` placeholder (both gold text inside a
  semi-transparent dark panel — given solid `#14110D` chips so they pass
  regardless of what shows through the panel).
- `DevToolsP2PModal` inline `chrome://webrtc-internals` / `about:webrtc`
  code spans (panel background is `var(--bg)` — spans got an inline
  `#14110D` chip).
- `PaywallModal` extend-preview new-end timestamp and the
  `CAPPED AT THE 24H LIMIT` line (both inside an extend-preview block
  whose background is `var(--surface)` — gold text wrapped in a `#14110D`
  chip with a gold border).
- `LandingPage` install prompt (was gold/teal/burnt body text on a
  `rgba(255,252,245,0.20)` tint over `--bg` — container background
  flipped to `#14110D` and the inner muted lines recolored from
  `var(--fg-dim)` to `#A89E90` so they pass on the dark fill).

The palette-level `gold on bg (accent text)` exception is still in the
audit table because legitimate AA-large headings and dark-card uses
continue to rely on it. The fixes above just remove these specific
small-text instances from that exception.

### Task #438 — small-text accent fixes

The following accent-text-on-light-bg occurrences were re-wrapped onto the
dark `#14110D` chip so they clear AA at 8.60:1 instead of riding the
palette-level exception:

- `StartScreen` session notice toast (was gold text on a
  `rgba(232,162,0,0.15)` tint over `--bg`).
- `StartScreen` `UiSoundsToggle` button (was gold text on transparent body,
  i.e. directly on `--bg`).
- `RecordingDisclosureBanner` (was gold text on `--surface`).
- `PreviewGate` onion-join warning (was gold text on a
  `rgba(232,162,0,0.08)` tint over `--bg`).
- `SasVerificationDialog` peer-voice-mode alert (was gold text on a
  `rgba(212,167,76,0.08)` tint inside a dialog whose own background is
  `--bg`).

### Decorative left-edge bar

The 14px-wide vertical `#F0B800` bar on the start surface
(`LandingPage` and `StartScreen`) was bumped from `opacity: 0.65` to
`opacity: 0.975` per task #438. It is purely decorative (`pointerEvents:
none`, no text), so it is not part of the audit table — bumping opacity
only makes the brand mark more legible against the beige background.

### `red badge on headerBg`

The cam-off badge (12px bold mono glyph) sits on the dark header bg at
3.40:1, which is below the 4.5:1 body threshold but is paired with a
same-state cam-off overlay icon and text. The red color is a redundant
flag, not the primary communicator. Annotated in `src/index.css`
(`.void-badge--cam`).

## Verifying

Run `pnpm --filter @workspace/void-client run check:contrast`. If a row
flips to `FAIL`, do not lower the threshold or quietly extend an exception
— either fix the token in `src/index.css`, or refactor the use site to one
of the documented mitigations above and update this doc.
