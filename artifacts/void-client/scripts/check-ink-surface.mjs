#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/*
 * check-ink-surface.mjs — invisible-ink static scan (dark-on-dark AND
 * light-on-light).
 *
 * Task #1112 found ~15 spots where dim ink (var(--fg-dim) 1.39:1, #5C5040
 * 2.40:1, even var(--fg) 1.09:1) sat on the dark concrete surface
 * (--surface-dark #14110D) and was effectively invisible. The pair-based
 * audit in check-contrast.mjs only checks a hand-maintained list, so none
 * of those regressions were caught. This scan closes the gap generically:
 * instead of keyword lists per direction, it resolves every `color:`
 * declaration it can understand (var(--token) or #hex) against the nearest
 * background it can attribute to that ink, computes the real WCAG 2.1
 * contrast ratio, and fails CI below the 3.0:1 invisibility floor (see
 * "Threshold" below — check-contrast.mjs owns the 4.5:1 AA gate).
 * Dark-on-dark and light-on-light both fall out of the same math.
 *
 * Detection passes, per file:
 *   1. CSS rule blocks (src/index.css): a block that declares both a
 *      resolvable `color:` and `background(-color):` is checked directly.
 *   2. TSX/TS style objects: for each `color:` line, the enclosing
 *      brace-balanced object is scanned for a `background`/`backgroundColor`.
 *   3. Nearest-surface heuristic: when the object has no background of its
 *      own, walk up to WINDOW lines above for the nearest surface marker —
 *      a `background:` declaration or a className carrying a known dark
 *      surface class (.void-header, .void-video-slot) — and check against
 *      that. This is a heuristic: ancestors legitimately sit above, but a
 *      sibling's background can also appear above. False positives are
 *      handled by the exemption mechanisms below, never by weakening the
 *      pass itself.
 *
 * Threshold: 3.0:1 (the WCAG AA-large / non-text floor). This scan is an
 * INVISIBILITY guard, not the AA audit — check-contrast.mjs owns the 4.5:1
 * AA gate for the curated token pairs. Everything the Task #1112 manual
 * audit found sat between 1.09:1 and 2.40:1; shipped, deliberately-styled
 * accents (e.g. --burnt on --surface-dark at 4.41:1) stay out of scope.
 *
 * Exemptions (for legitimate cases such as dark text on a light chip that
 * itself sits inside a dark panel):
 *   - a `contrast-exception:` comment inside the enclosing object or within
 *     EXEMPT_LOOKBACK lines above the `color:` line (same convention the
 *     token audit uses; reason required by docs/contrast-audit.md), or
 *   - an entry in WHITELIST below (file + ink + surface + reason) for spots
 *     where an inline comment cannot live, or
 *   - the checked-in baseline (ink-surface-baseline.json): pre-existing
 *     findings are grandfathered by (file | ink | surface) count — line
 *     numbers are deliberately NOT part of the key so ordinary edits do
 *     not churn it. The scan fails only when a file gains a NEW pairing
 *     (count above baseline). Shrinking a count prints a ratchet reminder
 *     to regenerate. Regenerate with:
 *       node scripts/check-ink-surface.mjs --update-baseline
 *     Never regenerate to absorb a new finding — fix the ink instead.
 *
 * When this fails on new code: fix the ink (use --fg-on-dark on dark
 * surfaces, --fg/--fg-dim on light ones). Only add an exemption if the ink
 * genuinely does not render on the flagged surface — say why.
 *
 * No deps. Run: pnpm --filter @workspace/void-client run check:ink-surface
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'src');
const CSS_PATH = resolve(SRC, 'index.css');

const WINDOW = 40;          // lines to walk up for a surface marker
const EXEMPT_LOOKBACK = 6;  // lines above color: where an exception comment counts
const FLOOR = 3.0;          // invisibility floor (WCAG AA-large / non-text)
const BASELINE_PATH = resolve(__dirname, 'ink-surface-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

// Known dark-surface CSS classes (background set in index.css).
const DARK_CLASSES = ['void-header', 'void-video-slot'];

// file (relative to artifacts/void-client) + line-substring the color sits on.
// Each entry documents WHY the pairing is a false positive.
const WHITELIST = [
  // { file: 'src/pages/Example.tsx', match: 'color: "var(--fg)"', reason: '...' },
];

// ── color math (same formulas as check-contrast.mjs) ─────────────────────
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function luminance(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return 0.2126 * lin(parseInt(f.slice(0, 2), 16)) + 0.7152 * lin(parseInt(f.slice(2, 4), 16)) + 0.0722 * lin(parseInt(f.slice(4, 6), 16));
}
function ratio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ── token map from index.css (single source of truth) ────────────────────
const css = readFileSync(CSS_PATH, 'utf8');
const TOKENS = {};
for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,6})\b/g)) {
  TOKENS[m[1]] = m[2];
}

function resolveColor(value) {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  const varM = v.match(/^var\(--([a-z0-9-]+)\)$/);
  if (varM) return TOKENS[varM[1]] ?? null;
  const hexM = v.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (hexM) return v;
  if (v === 'white') return '#ffffff';
  if (v === 'black') return '#000000';
  return null; // rgba/gradients/inherit/transparent — out of scope
}

// Extract the value of a css-in-js or css declaration on a line.
function declValue(line, prop) {
  const re = new RegExp(`(?:^|[\\s{;"'])${prop}\\s*:\\s*["']?([^"',;}]+)`);
  const m = line.match(re);
  return m ? m[1].trim() : null;
}
const colorOf = (line) => {
  // avoid matching borderColor / backgroundColor / outlineColor etc.
  if (!/(?:^|[\s{;"'])color\s*:/.test(line)) return null;
  return declValue(line, 'color');
};
const backgroundOf = (line) =>
  declValue(line, 'backgroundColor') ?? declValue(line, 'background-color') ?? declValue(line, 'background');

// ── file walk ─────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'test' || name === 'node_modules') continue;
      walk(p, out);
    } else if (/\.(tsx|ts|css)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
const exempted = [];

function isWhitelisted(file, line) {
  const rel = relative(ROOT, file);
  return WHITELIST.some((w) => w.file === rel && line.includes(w.match));
}
function hasExceptionNear(lines, idx) {
  for (let i = Math.max(0, idx - EXEMPT_LOOKBACK); i <= Math.min(lines.length - 1, idx + 1); i++) {
    if (lines[i].includes('contrast-exception')) return true;
  }
  return false;
}

function report(file, lineNo, ink, surface, r, how, exempt) {
  const entry = { file: relative(ROOT, file), lineNo, ink, surface, r: r.toFixed(2), how };
  (exempt ? exempted : violations).push(entry);
}

function checkPair(file, lines, colorIdx, inkHex, surfaceHex, how) {
  const r = ratio(inkHex, surfaceHex);
  if (r >= FLOOR) return;
  const exempt = hasExceptionNear(lines, colorIdx) || isWhitelisted(file, lines[colorIdx]);
  report(file, colorIdx + 1, inkHex, surfaceHex, r, how, exempt);
}

// Find the span of the brace-balanced object enclosing line idx.
function enclosingObject(lines, idx) {
  let depth = 0, start = idx, end = idx;
  for (let i = idx; i >= Math.max(0, idx - WINDOW); i--) {
    const l = lines[i];
    // count braces right-to-left above the color line
    const opens = (l.match(/{/g) || []).length;
    const closes = (l.match(/}/g) || []).length;
    if (i !== idx) depth += opens - closes;
    if (depth > 0) { start = i; break; }
  }
  depth = 0;
  for (let i = idx; i <= Math.min(lines.length - 1, idx + WINDOW); i++) {
    const l = lines[i];
    const opens = (l.match(/{/g) || []).length;
    const closes = (l.match(/}/g) || []).length;
    if (i !== idx) depth += closes - opens;
    if (depth > 0) { end = i; break; }
  }
  return [start, end];
}

function scanTsx(file, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawInk = colorOf(lines[i]);
    if (!rawInk) continue;
    const ink = resolveColor(rawInk);
    if (!ink) continue;

    // pass 1: background inside the same object
    const [start, end] = enclosingObject(lines, i);
    let surface = null;
    for (let j = start; j <= end; j++) {
      const bg = resolveColor(backgroundOf(lines[j]));
      if (bg) { surface = bg; break; }
    }
    if (surface) {
      checkPair(file, lines, i, ink, surface, 'same-object background');
      continue;
    }

    // pass 2: nearest surface marker above (heuristic)
    for (let j = i - 1; j >= Math.max(0, i - WINDOW); j--) {
      const bg = resolveColor(backgroundOf(lines[j]));
      if (bg) { checkPair(file, lines, i, ink, bg, `nearest background above (line ${j + 1})`); break; }
      const cls = lines[j].match(/className\s*=\s*{?["'`]([^"'`]+)/);
      if (cls && DARK_CLASSES.some((d) => cls[1].split(/\s+/).includes(d))) {
        checkPair(file, lines, i, ink, TOKENS['surface-dark'], `dark class "${cls[1]}" above (line ${j + 1})`);
        break;
      }
    }
  }
}

function scanCss(file, text) {
  const lines = text.split('\n');
  // group declarations per rule block
  let blockStart = -1;
  let colorLine = -1, colorVal = null, bgVal = null, hasException = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('{') && blockStart === -1) {
      blockStart = i; colorLine = -1; colorVal = null; bgVal = null; hasException = false;
    }
    if (blockStart !== -1) {
      if (l.includes('contrast-exception')) hasException = true;
      const c = colorOf(l);
      if (c) { const r0 = resolveColor(c); if (r0) { colorVal = r0; colorLine = i; } }
      const b = resolveColor(backgroundOf(l));
      if (b) bgVal = b;
      if (l.includes('}')) {
        if (colorVal && bgVal) {
          const r = ratio(colorVal, bgVal);
          if (r < FLOOR) {
            const exempt = hasException || hasExceptionNear(lines, colorLine) || isWhitelisted(file, lines[colorLine]);
            report(file, colorLine + 1, colorVal, bgVal, r, 'css rule block', exempt);
          }
        }
        blockStart = -1;
      }
    }
  }
}

for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) scanCss(file, text);
  else scanTsx(file, text);
}

// ── baseline ratchet ─────────────────────────────────────────────────────
// Key: file|ink|surface (no line numbers → ordinary edits don't churn it).
const keyOf = (e) => `${e.file}|${e.ink.toLowerCase()}|${e.surface.toLowerCase()}`;
const actual = {};
for (const e of violations) actual[keyOf(e)] = (actual[keyOf(e)] ?? 0) + 1;

if (UPDATE_BASELINE) {
  const sorted = Object.fromEntries(Object.entries(actual).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`baseline written: ${relative(ROOT, BASELINE_PATH)} (${violations.length} grandfathered pairing(s), ${Object.keys(sorted).length} key(s))`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

console.log('\nink-surface scan — invisible dark-on-dark / light-on-light guard\n');
for (const e of exempted) {
  console.log(`  EXEMPT ${e.file}:${e.lineNo}  ${e.ink} on ${e.surface}  ${e.r}:1  (${e.how})`);
}

const fresh = [];
const seen = {};
for (const e of violations) {
  const k = keyOf(e);
  seen[k] = (seen[k] ?? 0) + 1;
  if (seen[k] > (baseline[k] ?? 0)) fresh.push(e);
}
let ratchet = 0;
for (const [k, n] of Object.entries(baseline)) {
  if ((actual[k] ?? 0) < n) {
    ratchet += 1;
    console.log(`  RATCHET ${k}: baseline ${n} → now ${actual[k] ?? 0}. Run --update-baseline to lock in the improvement.`);
  }
}

if (fresh.length) {
  console.error(`\n✗ ${fresh.length} NEW low-contrast ink/surface pairing(s) below ${FLOOR}:1 (not in baseline):\n`);
  for (const e of fresh) {
    console.error(`  FAIL ${e.file}:${e.lineNo}  ${e.ink} on ${e.surface}  ${e.r}:1  (${e.how})`);
  }
  console.error('\n  Fix the ink (use --fg-on-dark on dark surfaces, --fg/--fg-dim on light ones).');
  console.error('  If the ink genuinely does not render on this surface (e.g. dark text on a');
  console.error('  light chip inside a dark panel), add a /* contrast-exception: <reason> */');
  console.error('  comment at the use site. Do NOT regenerate the baseline to absorb new code.');
  process.exit(1);
}
console.log(`✓ ink-surface scan passed (${violations.length} baselined, ${exempted.length} comment-exempted${ratchet ? `, ${ratchet} ratchet reminder(s)` : ''}).`);
