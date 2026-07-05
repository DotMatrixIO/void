#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-fragments-sync.mjs
 *
 * Registry-driven verifier. For every entry in fragments.config.mjs,
 * confirms that the canonical docs/_fragments/*.md is the single source
 * of truth for two surfaces:
 *
 *   1. The entry's overview file — the block between the two sentinel
 *      comments must equal the fragment byte-for-byte (modulo one
 *      surrounding newline). If it does not, sync-fragments.mjs has not
 *      been run since the fragment last changed.
 *
 *   2. Each page in `pages[]` — must `import` the fragment as `?raw` so
 *      the user-facing page renders from the same bytes the overview
 *      ships. If the import disappears we are back in paraphrase land.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:fragments-sync
 *
 * Wired into CI as part of the `marketing-voice` validation workflow.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FRAGMENTS, beginSentinel, endSentinel } from "./fragments.config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const errors = [];

for (const entry of FRAGMENTS) {
  const fragmentPath = resolve(REPO_ROOT, entry.fragment);
  const overviewPath = resolve(REPO_ROOT, entry.overview);
  const BEGIN = beginSentinel(entry);
  const END = endSentinel(entry);

  const fragment = readFileSync(fragmentPath, "utf8").replace(/\s+$/, "");
  const overview = readFileSync(overviewPath, "utf8");

  const beginIdx = overview.indexOf(BEGIN);
  const endIdx = overview.indexOf(END);

  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    errors.push(
      `[${entry.id}] Sentinels missing in ${relative(REPO_ROOT, overviewPath)}.\n` +
        `  Expected to find:\n    ${BEGIN}\n    ${END}\n` +
        `  around the canonical block for this fragment.`,
    );
  } else {
    const between = overview
      .slice(beginIdx + BEGIN.length, endIdx)
      .replace(/^\n/, "")
      .replace(/\n$/, "");
    if (between !== fragment) {
      errors.push(
        `[${entry.id}] ${relative(REPO_ROOT, overviewPath)} block has drifted from\n` +
          `  ${relative(REPO_ROOT, fragmentPath)}.\n` +
          `  Fix: run \`node artifacts/void-client/scripts/sync-fragments.mjs\`\n` +
          `       (also runs automatically as part of \`pnpm --filter @workspace/void-client run build\`).`,
      );
    }
  }

  for (const page of entry.pages) {
    const pagePath = resolve(REPO_ROOT, page.file);
    const source = readFileSync(pagePath, "utf8");
    if (!page.importRe.test(source)) {
      errors.push(
        `[${entry.id}] ${relative(REPO_ROOT, pagePath)} no longer imports the shared\n` +
          `  fragment via Vite's \`?raw\` import. Restore the import:\n` +
          `    expected pattern: ${page.importRe}\n` +
          `  so the user-facing page renders from the same bytes as the overview.`,
      );
    }
  }
}

if (errors.length === 0) {
  console.log(
    `Fragments sync check passed: ${FRAGMENTS.length} fragment(s) aligned across overview and pages.`,
  );
  process.exit(0);
}

console.error("Fragments sync check FAILED.\n");
for (const e of errors) {
  console.error(e);
  console.error("");
}
process.exit(1);
