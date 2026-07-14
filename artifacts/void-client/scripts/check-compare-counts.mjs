#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: keep the /compare capability table's advertised row counts in
// sync with the actual table data.
//
// The number of rows in the comparison table is hand-written as prose in
// several places: the /docs/compare intro ("Thirteen rows. Six tools. We
// win ten. We lose three."), the "THE TEN ROWS WE WIN" heading, the
// DocsIndexPage card description ("thirteen-row"), and the compare OG
// description/headline in og-routes.mjs. Adding or removing a table row
// (the way Task #1117 added two) requires a manual sweep of all of them —
// and the previous "eleven-row" copy had already gone stale once before.
//
// This check derives the ground truth from the exported `compareRows`
// array in `src/components/CompareTable.tsx`:
//
//   - total rows  = number of row objects in compareRows
//   - win rows    = rows where VOID's cell is exactly "YES"
//   - lose rows   = total - win
//   - tools       = number of entries in compareTools (the sentence
//                   literals embed "<N> tools", so it must be derived
//                   too or the check itself would go stale)
//
// …then asserts the number words in each prose surface match:
//
//   1. DocsComparePage.tsx intro:  "<Total> rows. We win <win>. We lose <lose>."
//   2. DocsComparePage.tsx heading: "THE <WIN> ROWS WE WIN"
//   3. DocsIndexPage.tsx card description: "<total>-row"
//   4. og-routes.mjs compare description: "<Total> rows. … We win <win> rows.
//      We lose <lose>." and headline: "We win <win> rows. We lose <lose>."
//
// Run via:
//
//     pnpm --filter @workspace/void-client run check:compare-counts
//
// Wired into the local `marketing-voice` validation workflow in `.replit`
// alongside the other check:* scripts.

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const TABLE_PATH = resolve(CLIENT_ROOT, "src/components/CompareTable.tsx");
const DOCS_COMPARE_PATH = resolve(CLIENT_ROOT, "src/pages/docs/DocsComparePage.tsx");
const DOCS_INDEX_PATH = resolve(CLIENT_ROOT, "src/pages/docs/DocsIndexPage.tsx");
const OG_ROUTES_PATH = resolve(CLIENT_ROOT, "scripts/og-routes.mjs");

const rel = (p) => relative(REPO_ROOT, p);

// Number → English word, enough headroom for any plausible table size.
const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function word(n) {
  const w = NUMBER_WORDS[n];
  if (!w) {
    throw new Error(
      `No English number word for ${n} — extend NUMBER_WORDS in ` +
        `${rel(fileURLToPath(import.meta.url))}.`,
    );
  }
  return w;
}

const cap = (w) => w[0].toUpperCase() + w.slice(1);

// Extract the compareRows array literal from CompareTable.tsx and count
// (a) row objects and (b) rows where VOID's cell is exactly "YES". We
// deliberately parse the source text rather than importing the module —
// the file is TSX and imports React components, so a text scan keyed on
// the row-object shape (`label:` + `VOID:`) is the robust option.
async function deriveCounts() {
  const text = await readFile(TABLE_PATH, "utf8");

  const toolsMatch = text.match(/export const compareTools\s*=\s*\[([\s\S]*?)\]/);
  if (!toolsMatch) {
    throw new Error(
      `Could not find \`export const compareTools = [...]\` in ` +
        `${rel(TABLE_PATH)}. If the array was renamed or moved, update ` +
        `${rel(fileURLToPath(import.meta.url))}.`,
    );
  }
  const tools = [...toolsMatch[1].matchAll(/["'`][^"'`]+["'`]/g)].length;
  if (tools === 0) {
    throw new Error(`Parsed compareTools in ${rel(TABLE_PATH)} but found 0 entries.`);
  }

  const startMatch = text.match(/export const compareRows[^=]*=\s*\[/);
  if (!startMatch) {
    throw new Error(
      `Could not find \`export const compareRows ... = [\` in ` +
        `${rel(TABLE_PATH)}. If the array was renamed or moved, update ` +
        `${rel(fileURLToPath(import.meta.url))}.`,
    );
  }
  const start = startMatch.index + startMatch[0].length;

  // Walk to the matching closing bracket of the array literal.
  let depth = 1;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Unbalanced brackets scanning compareRows in ${rel(TABLE_PATH)}.`);
  }
  const block = text.slice(start, end);

  const labels = [...block.matchAll(/label:\s*["'`]/g)];
  const voidCells = [...block.matchAll(/VOID:\s*(['"`])((?:(?!\1).)*)\1/g)];

  if (labels.length === 0 || voidCells.length === 0) {
    throw new Error(
      `Parsed compareRows in ${rel(TABLE_PATH)} but found ` +
        `${labels.length} label(s) and ${voidCells.length} VOID cell(s) — ` +
        `the row-object shape may have changed; update the scan in ` +
        `${rel(fileURLToPath(import.meta.url))}.`,
    );
  }
  if (labels.length !== voidCells.length) {
    throw new Error(
      `compareRows in ${rel(TABLE_PATH)} has ${labels.length} label(s) but ` +
        `${voidCells.length} VOID cell(s) — every row must have both.`,
    );
  }

  const total = labels.length;
  const win = voidCells.filter((m) => m[2] === "YES").length;
  return { total, win, lose: total - win, tools };
}

async function main() {
  const { total, win, lose, tools } = await deriveCounts();

  const totalWord = word(total);
  const winWord = word(win);
  const loseWord = word(lose);
  const toolsWord = word(tools);

  const [docsCompare, docsIndex, ogRoutes] = await Promise.all([
    readFile(DOCS_COMPARE_PATH, "utf8"),
    readFile(DOCS_INDEX_PATH, "utf8"),
    readFile(OG_ROUTES_PATH, "utf8"),
  ]);

  const errors = [];
  const expect = (haystack, needle, file, label) => {
    if (!haystack.includes(needle)) {
      errors.push(`${rel(file)} — ${label} must contain the literal:\n      "${needle}"`);
    }
  };

  // 1. /docs/compare intro sentence.
  expect(
    docsCompare,
    `${cap(totalWord)} rows. ${cap(toolsWord)} tools. We win ${winWord}. We lose ${loseWord}.`,
    DOCS_COMPARE_PATH,
    "intro paragraph",
  );

  // 2. /docs/compare "rows we win" section heading.
  expect(
    docsCompare,
    `THE ${winWord.toUpperCase()} ROWS WE WIN`,
    DOCS_COMPARE_PATH,
    '"rows we win" heading',
  );

  // 3. /docs index card description.
  expect(docsIndex, `${totalWord}-row`, DOCS_INDEX_PATH, "compare card description");

  // 4. og-routes.mjs compare entry (description + headline). Scope the
  //    scan to the compare entry so an unrelated route can't satisfy it.
  const compareEntry = ogRoutes.match(/slug:\s*["']compare["'][\s\S]*?\n\s*\},/);
  if (!compareEntry) {
    errors.push(`${rel(OG_ROUTES_PATH)} — could not locate the slug: "compare" entry.`);
  } else {
    expect(
      compareEntry[0],
      `${cap(totalWord)} rows. ${cap(toolsWord)} tools. We win ${winWord} rows. We lose ${loseWord}.`,
      OG_ROUTES_PATH,
      "compare OG description",
    );
    expect(
      compareEntry[0],
      `We win ${winWord} rows. We lose ${loseWord}.`,
      OG_ROUTES_PATH,
      "compare OG headline",
    );
  }

  if (errors.length > 0) {
    console.error("[check-compare-counts] FAIL");
    console.error(
      `  Ground truth from ${rel(TABLE_PATH)}: ${total} rows, ` +
        `${win} VOID wins, ${lose} VOID losses.`,
    );
    for (const e of errors) console.error("  - " + e);
    console.error(
      "  Update the prose to match the table (or fix the table). If you " +
        "changed og-routes.mjs, re-run `pnpm --filter @workspace/void-client " +
        "run gen:og` so the rendered cards match.",
    );
    process.exit(1);
  }

  console.log(
    `[check-compare-counts] OK — table has ${total} rows (${win} wins / ` +
      `${lose} losses); all 4 prose surfaces agree ` +
      `("${totalWord}", "${winWord}", "${loseWord}").`,
  );
}

main().catch((err) => {
  console.error(`[check-compare-counts] failed: ${err.stack ?? err}`);
  process.exit(1);
});
