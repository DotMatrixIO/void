#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-og-rewrites.mjs
 *
 * Regenerates the [[services.production.rewrites]] blocks in
 * .replit-artifact/artifact.toml directly from the OG_ROUTES list in
 * og-routes.mjs.
 *
 * Called automatically as part of the void-client build script so the TOML
 * stays in sync whenever og-routes.mjs changes.  Adding a new route to
 * og-routes.mjs and running `pnpm build` is the only step required — the
 * TOML is updated automatically, ready to be committed and deployed.
 *
 * The script does a targeted in-place replacement: it finds the generated
 * rewrites section (delimited by sentinel comments) and replaces only that
 * block, leaving the rest of artifact.toml untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OG_ROUTES } from "./og-routes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOML_PATH = resolve(__dirname, "..", ".replit-artifact", "artifact.toml");

const src = readFileSync(TOML_PATH, "utf8");

const BEGIN_SENTINEL = "# BEGIN GENERATED OG REWRITES";
const END_SENTINEL = "# END GENERATED OG REWRITES";

const nonLanding = OG_ROUTES.filter((r) => r.path !== "/");

const rewrites = [];
for (const route of nonLanding) {
  const to = `/${route.slug}.html`;
  rewrites.push(
    `[[services.production.rewrites]]`,
    `from = "${route.path}"`,
    `to = "${to}"`,
    ``,
    `[[services.production.rewrites]]`,
    `from = "${route.path}/"`,
    `to = "${to}"`,
    ``,
  );
}

rewrites.push(
  `[[services.production.rewrites]]`,
  `from = "/*"`,
  `to = "/index.html"`,
);

const newBlock =
  [
    BEGIN_SENTINEL,
    `# Per-route Open Graph HTML files — must come BEFORE the SPA catch-all so`,
    `# crawlers (Facebook, Twitter/X, Slack, iMessage, WhatsApp) get the`,
    `# route-specific og:* metadata for each marketing page rather than the`,
    `# landing card. Real users get the same files; the SPA hydrates and behaves`,
    `# identically because the body and script tags are byte-identical across`,
    `# every HTML file. Both bare and trailing-slash forms are mapped so a`,
    `# shared link like /compare/ doesn't accidentally fall through to the`,
    `# SPA catch-all and serve the landing card. See`,
    `# artifacts/void-client/scripts/gen-og-pages.mjs.`,
    `# Edit og-routes.mjs and rebuild instead of touching this block by hand.`,
    ...rewrites,
    END_SENTINEL,
  ].join("\n") + "\n";

let updated;

const beginIdx = src.indexOf(BEGIN_SENTINEL);
const endIdx = src.indexOf(END_SENTINEL);

if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
  updated =
    src.slice(0, beginIdx) +
    newBlock +
    src.slice(endIdx + END_SENTINEL.length).replace(/^\n/, "\n");
} else {
  console.error(
    `[gen-og-rewrites] Could not find ${BEGIN_SENTINEL} / ${END_SENTINEL} ` +
      `sentinels in artifact.toml. Run the migration once: add the sentinels ` +
      `around the existing rewrites section, then re-run this script.`,
  );
  process.exit(1);
}

if (updated === src) {
  console.log("[gen-og-rewrites] artifact.toml rewrites already up-to-date.");
  process.exit(0);
}

writeFileSync(TOML_PATH, updated, "utf8");
console.log(
  `[gen-og-rewrites] Regenerated ${nonLanding.length} OG route rewrite pair(s) in artifact.toml.`,
);
