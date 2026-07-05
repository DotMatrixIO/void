#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-landing-fonts.mjs
 *
 * The three closing beats on the landing page lean on specific self-hosted
 * fonts to carry their tone:
 *
 *   - "A room."           → Staatliches, all-caps (the shouting machine voice)
 *   - "Then a countdown." → Staatliches, all-caps (same machine voice)
 *   - "Then nothing."     → Gloria Hallelujah, lowercase (the one quiet,
 *                           hand-written aside that breaks the machine voice)
 *
 * If the "Then nothing." beat silently fell back to Staatliches, or either of
 * the first two beats stopped shouting in all-caps, the whole device — a
 * shouting countdown that ends in a hand-written whisper — would collapse and
 * nobody would notice until someone looked at the rendered page.
 *
 * Separately, every @font-face in src/index.css points at a self-hosted
 * .woff2 under public/fonts/ (no external font network at runtime — matches
 * the brand's privacy posture). A typo in a src url, or a deleted font file,
 * would ship a broken @font-face that silently falls back to a system font.
 *
 * This script fails (exit 1) when:
 *
 *   1. The "Then nothing." beat does NOT use a Gloria Hallelujah font stack,
 *      or is not rendered lowercase (textTransform: none).
 *   2. Either of the other two beats stops using Staatliches, or stops being
 *      uppercase (textTransform: uppercase).
 *   3. Any @font-face src url in index.css points at a font file that does
 *      not exist under public/fonts/ (orphaned reference / missing file).
 *   4. The --font-body token in index.css stops resolving to the Source
 *      Serif 4 family, or is reset to var(--font-mono). The long-form body
 *      face was deliberately locked to a book serif; a refactor that quietly
 *      reverted it to the mono stack would pass every @font-face check (the
 *      .woff2 paths stay valid) yet silently degrade the reading experience.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:landing-fonts
 *
 * Wired into CI as part of the `marketing-voice` validation workflow.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const PUBLIC_DIR = resolve(CLIENT_ROOT, "public");
// The three-beat closer ("A room." / "Then a countdown." / "Then nothing.")
// moved off the landing page onto the Media page (/media) when the refusal
// band was relocated there, so the beat font/casing contract is checked
// against MediaPage.tsx now. The @font-face audit still targets index.css.
const LANDING_PAGE = resolve(CLIENT_ROOT, "src", "pages", "MediaPage.tsx");
const INDEX_CSS = resolve(CLIENT_ROOT, "src", "index.css");

const violations = [];

/**
 * Extract the single beat object literal in LandingPage.tsx whose `text`
 * property equals `text`. The beat objects are flat (no nested braces), so
 * the enclosing object is the slice from the nearest preceding `{` to the
 * nearest following `}` around the `text:` declaration.
 */
function extractBeatObject(content, text) {
  const needle = `text: ${JSON.stringify(text)}`;
  const at = content.indexOf(needle);
  if (at === -1) return null;
  const open = content.lastIndexOf("{", at);
  const close = content.indexOf("}", at);
  if (open === -1 || close === -1) return null;
  return content.slice(open, close + 1);
}

/**
 * Pull the value of a string-valued style property (e.g. fontFamily,
 * textTransform) out of a beat object literal. Returns null when absent.
 */
function readProp(objectSource, prop) {
  const m = objectSource.match(
    new RegExp(`${prop}:\\s*("[^"]*"|'[^']*')`),
  );
  if (!m) return null;
  return m[1].slice(1, -1);
}

function checkBeat(content, { text, mustInclude, mustTransform, label }) {
  const obj = extractBeatObject(content, text);
  if (!obj) {
    violations.push({
      file: LANDING_PAGE,
      message: `Could not find the ${JSON.stringify(text)} beat. The three-beat closer was renamed or removed — update this guard in the same commit.`,
    });
    return;
  }

  const fontFamily = readProp(obj, "fontFamily");
  if (!fontFamily || !fontFamily.includes(mustInclude)) {
    violations.push({
      file: LANDING_PAGE,
      message: `The ${JSON.stringify(text)} beat (${label}) must use a ${JSON.stringify(mustInclude)} font stack, but its fontFamily is ${JSON.stringify(fontFamily)}.`,
    });
  }

  const textTransform = readProp(obj, "textTransform");
  if (textTransform !== mustTransform) {
    violations.push({
      file: LANDING_PAGE,
      message: `The ${JSON.stringify(text)} beat (${label}) must be rendered with textTransform: ${JSON.stringify(mustTransform)}, but it is ${JSON.stringify(textTransform)}.`,
    });
  }
}

// 1–3. The three-beat closer must keep its font + casing contract.
const landingSource = readFileSync(LANDING_PAGE, "utf8");

checkBeat(landingSource, {
  text: "A room.",
  mustInclude: "Staatliches",
  mustTransform: "uppercase",
  label: "machine voice",
});
checkBeat(landingSource, {
  text: "Then a countdown.",
  mustInclude: "Staatliches",
  mustTransform: "uppercase",
  label: "machine voice",
});
checkBeat(landingSource, {
  text: "Then nothing.",
  mustInclude: "Gloria Hallelujah",
  mustTransform: "none",
  label: "hand-written aside",
});

// 4. Every @font-face src url must resolve to an existing file under public/.
const cssSource = readFileSync(INDEX_CSS, "utf8");
const fontFaceBlocks = cssSource.match(/@font-face\s*\{[^}]*\}/g) ?? [];

if (fontFaceBlocks.length === 0) {
  violations.push({
    file: INDEX_CSS,
    message:
      "No @font-face declarations found. The self-hosted font block was removed — update this guard in the same commit.",
  });
}

let resolvedSrcCount = 0;
for (const block of fontFaceBlocks) {
  const family = (block.match(/font-family:\s*('[^']*'|"[^"]*")/)?.[1] ?? "?")
    .slice(1, -1);
  const srcMatches = [...block.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)];
  if (srcMatches.length === 0) {
    violations.push({
      file: INDEX_CSS,
      message: `@font-face for ${JSON.stringify(family)} has no src url().`,
    });
    continue;
  }
  for (const m of srcMatches) {
    const url = m[1].trim();
    // Public assets are served from public/ at the site root, so a url like
    // "/fonts/foo.woff2" maps to public/fonts/foo.woff2.
    const rel = url.replace(/^\//, "");
    const filePath = resolve(PUBLIC_DIR, rel);
    resolvedSrcCount += 1;
    if (!existsSync(filePath)) {
      violations.push({
        file: INDEX_CSS,
        message: `@font-face for ${JSON.stringify(family)} references ${JSON.stringify(url)}, but ${relative(REPO_ROOT, filePath)} does not exist.`,
      });
    }
  }
}

// 5. The --font-body token must stay locked to the Source Serif 4 book serif
//    and must never be reset to var(--font-mono). This catches a refactor that
//    quietly reverts long-form body copy to the mono font — a regression that
//    every @font-face check above would happily ignore.
const fontBodyMatch = cssSource.match(/--font-body:\s*([^;]+);/);
if (!fontBodyMatch) {
  violations.push({
    file: INDEX_CSS,
    message:
      "Could not find the --font-body custom property. The long-form body face token was removed or renamed — update this guard in the same commit.",
  });
} else {
  const fontBodyValue = fontBodyMatch[1].trim();
  if (/var\(\s*--font-mono\s*\)/.test(fontBodyValue)) {
    violations.push({
      file: INDEX_CSS,
      message: `--font-body has been reset to the mono font (${JSON.stringify(fontBodyValue)}). Long-form body copy must use the Source Serif 4 book serif, not var(--font-mono).`,
    });
  } else if (!/['"]Source Serif 4['"]/.test(fontBodyValue)) {
    violations.push({
      file: INDEX_CSS,
      message: `--font-body must resolve to the 'Source Serif 4' family, but it is ${JSON.stringify(fontBodyValue)}.`,
    });
  }
}

if (violations.length > 0) {
  console.error(
    `Landing-font check failed in ${violations.length} location(s):\n`,
  );
  for (const v of violations) {
    console.error(`  ${relative(REPO_ROOT, v.file)}`);
    console.error(`    ${v.message}`);
    console.error("");
  }
  console.error(
    "The three-beat closer's font + casing contract and the self-hosted",
  );
  console.error(
    "@font-face src paths are load-bearing. If you changed one on purpose,",
  );
  console.error("update this script in the same commit.");
  process.exit(1);
}

console.log(
  `Landing-font check passed: 3 beat font/casing assertions verified and ${resolvedSrcCount} @font-face src path(s) across ${fontFaceBlocks.length} declaration(s) resolve to existing files.`,
);
