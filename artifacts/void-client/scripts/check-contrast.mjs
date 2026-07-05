#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * check-contrast.mjs — WCAG contrast audit guard for the Gold Voyager palette.
 *
 * Reads the design tokens straight out of artifacts/void-client/src/index.css
 * (single source of truth — no manifest to drift), recomputes the WCAG 2.1
 * relative-luminance contrast ratio for every (foreground, background) pair
 * that appears in real UI, and exits non-zero if any non-exception pair
 * falls below its required threshold.
 *
 * Wired into the `marketing-voice` workflow so the audit cannot rot the next
 * time someone tweaks a token "just a little bit". When this script fails,
 * fix the token (and update docs/contrast-audit.md), do not lower the
 * threshold or quietly add an exception — exceptions are reserved for the
 * cases enumerated in docs/contrast-audit.md (disabled-control labels and
 * purely decorative typographic texture).
 *
 * No deps. Standard relative-luminance formula. Run:
 *   pnpm --filter @workspace/void-client run check:contrast
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, '../src/index.css');

// ── color math ────────────────────────────────────────────────────────────
function srgbToLin(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── parse tokens out of index.css ────────────────────────────────────────
const css = readFileSync(CSS_PATH, 'utf8');
function extract(name) {
  const re = new RegExp(`--${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`);
  const m = css.match(re);
  if (!m) throw new Error(`could not find --${name} in ${CSS_PATH}`);
  return m[1];
}
const T = {
  bg: extract('bg'),
  surface: extract('surface'),
  surfaceDark: extract('surface-dark'),
  fg: extract('fg'),
  fgDim: extract('fg-dim'),
  fgOnDark: extract('fg-on-dark'),
  red: extract('red'),
  teal: extract('teal'),
  gold: extract('gold'),
  burnt: extract('burnt'),
};
// The dark header/card surface is now the --surface-dark token (was a
// hand-written #14110D literal here and in 70+ call sites). The header-button
// text reuses --surface (#A89E90).
const HEADER_BG = T.surfaceDark;   // .void-header background (--surface-dark)
const HEADER_BTN = T.surface;      // .void-header .void-btn text (same as --surface)

// ── audited pairs ────────────────────────────────────────────────────────
// kind: 'body' (≥4.5), 'large' (≥3 — large text / non-text UI / focus ring).
// exception: short reason permitted by docs/contrast-audit.md, OR undefined.
const pairs = [
  // Core body text
  { id: 'fg/bg',                 fg: T.fg,      bg: T.bg,        kind: 'body' },
  { id: 'fg/surface',            fg: T.fg,      bg: T.surface,   kind: 'body' },
  { id: 'fgDim/bg',              fg: T.fgDim,   bg: T.bg,        kind: 'body' },
  { id: 'fgDim/surface',         fg: T.fgDim,   bg: T.surface,   kind: 'body' },

  // Button-active text-on-fill (red/teal/gold)
  { id: 'white/red (btn active)',     fg: '#FFFFFF', bg: T.red,  kind: 'body' },
  { id: 'fg/teal (btn active)',       fg: T.fg,      bg: T.teal, kind: 'body' },
  { id: 'fg/gold (btn active)',       fg: T.fg,      bg: T.gold, kind: 'body' },
  { id: 'headerBg/gold (header btn)', fg: HEADER_BG, bg: T.gold, kind: 'body' },

  // Header surface
  { id: 'gold/headerBg (wordmark)',     fg: T.gold,     bg: HEADER_BG, kind: 'body' },
  { id: 'headerBtn/headerBg',           fg: HEADER_BTN, bg: HEADER_BG, kind: 'body' },

  // Borders and focus indicators (WCAG 1.4.11 / 2.4.7) — 3:1 threshold
  { id: 'fg border on bg',              fg: T.fg,    bg: T.bg,       kind: 'large' },
  { id: 'fgDim border on bg',           fg: T.fgDim, bg: T.bg,       kind: 'large' },
  { id: 'gold focus on headerBg',       fg: T.gold,  bg: HEADER_BG,  kind: 'large' },
  { id: 'teal outline on slot bg',      fg: T.teal,  bg: HEADER_BG,  kind: 'large' },
  { id: 'gold outline on slot bg',      fg: T.gold,  bg: HEADER_BG,  kind: 'large' },
  { id: 'headerBg outline on bg',       fg: HEADER_BG, bg: T.bg,     kind: 'large' },

  // Accent text on dark header bg. The cam-off badge is the only
  // body-text-sized accent on the header background that still falls
  // below AA; it carries a per-instance contrast-exception annotation
  // in src/index.css (`.void-badge--cam`).
  { id: 'red badge on headerBg',        fg: T.red,   bg: HEADER_BG,  kind: 'body',
    exception: 'media-state cam-off badge: 12px bold mono glyph paired with a same-state cam-off overlay icon and text; the badge color is a redundant flag, not the primary communicator. Annotated at use site in index.css (.void-badge--cam).' },

  // ── In-call / lobby error lines (task #421) ──────────────────────────
  // The page-level error lines in StartScreen (BIP39-not-found + submission
  // errors) and PreviewGate (preview-failure) are the SOLE indicator of
  // what went wrong — no redundant red border/wavy underline like the
  // phrase grid's inline hint. As --red glyphs on the dark card they were
  // only 3.40:1 (FAIL body AA). They are now --fg-on-dark text inside a
  // red-bordered pill: the glyph clears AA, the red signal lives on the
  // border (non-text 3:1). Both pairs are enumerated here as PASS so the
  // fix can't silently regress back to red-on-dark text.
  { id: 'fgOnDark error text on surfaceDark', fg: T.fgOnDark, bg: T.surfaceDark, kind: 'body' },
  { id: 'red pill border on surfaceDark',     fg: T.red,      bg: T.surfaceDark, kind: 'large' },

  // BurnedOverlay reason line — fixed in this task (color: var(--bg) on
  // the overlay's #0A0908 background). Enforced going forward so that
  // anyone re-darkening the reason text fails CI.
  { id: 'bg text on burnedOverlay',     fg: T.bg,    bg: '#0A0908',  kind: 'body' },

  // The architecture spec line is now the bottom row of the shared
  // PageFooter (the loud white-on-orange band was removed). It inherits the
  // footer's text token: --fg-dim on tan --bg (fgDim/bg above) or #A89E90 on
  // the landing's #14110D pavement (headerBtn/headerBg below), so it is
  // already covered and needs no dedicated row here.

  // Thesis line under the V[]ID wordmark (LandingPage brand card). The
  // whispered premise moved up onto the dark asphalt header card (#14110D)
  // as white body text directly beneath the wordmark. Registered so the
  // line can't be recolored into something that fails AA on the dark card.
  { id: 'white/headerBg (thesis)',      fg: '#FFFFFF', bg: HEADER_BG, kind: 'body' },

  // Light body foreground (--fg-on-dark, a warm near-white) for all body
  // copy sitting on the dark surfaces: the long-form concrete cards
  // (longFormStyles), the proof pages, the docs/compare prose and table
  // cells, the dark menu links, and the short-form bullet body. Replaced a
  // beige #BEB3A2 literal users found hard to read on dark.
  { id: 'fgOnDark/surfaceDark (body)',  fg: T.fgOnDark, bg: T.surfaceDark, kind: 'body' },

  // ── Accent text on light --bg (task #414) ────────────────────────────
  // All four brand accents fail body-text AA when rendered directly on
  // --bg (#BEB3A2). They are enumerated here (rather than left out of the
  // table as a free-floating comment) so that any new accent-on-bg usage
  // shows up in the audit output and is forced to either be wrapped on a
  // dark surface, recolored to --fg with the accent as border/underline,
  // or annotated with a per-instance `/* contrast-exception: <reason> */`
  // comment at the use site. The palette-level exception below covers the
  // existing in-tree usages, which are exhaustively documented in
  // docs/contrast-audit.md ("Accent text on light --bg") and consist of:
  //   - ThreatModelPage <code> spans and inline accent emphasis — every
  //     occurrence renders inside the page's #14110D `sectionStyle` card,
  //     not on --bg directly (see top-of-file note in ThreatModelPage.tsx).
  //   - OnionMirrorLink URL/copy-button/fallback — recolored to --fg with
  //     a --teal border or underline as the affordance.
  //   - BurnedOverlay reason line — recolored to --bg on the overlay's
  //     #0A0908 background; the red SESSION BURNED headline is large text
  //     (28px bold, AA-large) and exempt per a per-instance comment.
  //   - Bip39PhraseGrid spelling hint — rendered inside the dark card that
  //     wraps the grid; carries a per-instance contrast-exception comment
  //     and is redundant with the slot's red border / wavy underline /
  //     aria-invalid semantics.
  //   - Large-text headings on long-form pages (≥18px or ≥14px bold —
  //     AA-large 3:1) such as landing-page hero headlines and
  //     threat-model section titles.
  // A new small-text body usage of an accent on --bg without one of the
  // above mitigations should fail CI: remove the palette-level exception
  // (turning these into FAIL rows) or document the new use site here.
  { id: 'gold on bg (accent text)',  fg: T.gold,  bg: T.bg, kind: 'body',
    exception: 'palette-level: see docs/contrast-audit.md "Accent text on light --bg". All in-tree uses are either inside a #14110D card (ThreatModelPage sections), recolored to --fg with a --gold border/underline (buttons, OnionMirrorLink), or are AA-large headings.' },
  { id: 'teal on bg (accent text)',  fg: T.teal,  bg: T.bg, kind: 'body',
    exception: 'palette-level: see docs/contrast-audit.md "Accent text on light --bg". All in-tree uses are either inside a #14110D card (ThreatModelPage sections), recolored to --fg with a --teal border/underline (OnionMirrorLink), or are AA-large hero headings.' },
  { id: 'red on bg (accent text)',   fg: T.red,   bg: T.bg, kind: 'body',
    exception: 'palette-level: see docs/contrast-audit.md "Accent text on light --bg". All in-tree uses are either inside a #14110D card (ThreatModelPage, Bip39PhraseGrid inline spelling hint), or are AA-large hero headings; each carries a per-instance /* contrast-exception */ comment at the use site. The StartScreen/PreviewGate page-level error lines no longer use --red as text — they are --fg-on-dark glyphs in a red-bordered pill (audited above).' },
  { id: 'burnt on bg (accent text)', fg: T.burnt, bg: T.bg, kind: 'body',
    exception: 'palette-level: see docs/contrast-audit.md "Accent text on light --bg". All in-tree uses are inside a #14110D card (ThreatModelPage subheadings + bullet arrows) where --burnt clears AA-large at 4.41:1; the only --burnt-on-bg occurrences elsewhere are AA-large hero headings.' },
];

// ── run audit ─────────────────────────────────────────────────────────────
let failed = 0;
const rows = [];
for (const p of pairs) {
  const r = ratio(p.fg, p.bg);
  const thr = p.kind === 'body' ? 4.5 : 3.0;
  const pass = r >= thr;
  let status;
  if (pass) status = 'PASS';
  else if (p.exception) status = 'EXEMPT';
  else { status = 'FAIL'; failed += 1; }
  rows.push({ id: p.id, fg: p.fg, bg: p.bg, ratio: r.toFixed(2), thr, status, exception: p.exception });
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\nWCAG contrast audit — Gold Voyager palette\n');
console.log(`${pad('PAIR', 36)} ${pad('FG', 8)} ${pad('BG', 8)} ${pad('RATIO', 7)} ${pad('THR', 5)} STATUS`);
console.log('-'.repeat(76));
for (const r of rows) {
  console.log(`${pad(r.id, 36)} ${pad(r.fg, 8)} ${pad(r.bg, 8)} ${pad(r.ratio, 7)} ${pad(r.thr, 5)} ${r.status}${r.exception ? '  (exception)' : ''}`);
}

if (failed > 0) {
  console.error(`\n✗ contrast audit failed: ${failed} pair(s) below threshold.`);
  console.error('  Fix the offending token in src/index.css and update docs/contrast-audit.md.');
  process.exit(1);
}
console.log('\n✓ contrast audit passed.');
