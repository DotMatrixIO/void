#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-og-routes-parity.mjs
 *
 * Fails (exit 1) if any route declared in og-routes.mjs resolves to an
 * og:image asset that does not actually exist on disk under
 * artifacts/void-client/public/.
 *
 * Resolution rule (mirrors gen-og-pages.mjs / gen-og-images.mjs):
 *   route.image  -> use as-is, must be a path relative to public/
 *   (otherwise) -> default to "/og/<slug>.png", which gen-og-images.mjs
 *                  is expected to have produced.
 *
 * In addition, the landing route ("/") is asserted to point at the
 * editorial hero (`/og/this-room-will-not-exist-social.jpg`). Task #160
 * wired this override deliberately so the most-shared marketing link
 * uses the hand-crafted social card; this guard prevents a future
 * refactor from silently dropping the override and reverting the
 * landing card to the templated PNG.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:og-routes
 *
 * Wired into CI as part of the `marketing-voice` validation workflow
 * in .replit (alongside check:phrases, check:literals, and
 * check:feature-policy-sync).
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OG_ROUTES } from "./og-routes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const PUBLIC_DIR = resolve(CLIENT_ROOT, "public");

const LANDING_PATH = "/";
const EXPECTED_LANDING_IMAGE = "/og/this-room-will-not-exist-social.jpg";

const errors = [];

for (const route of OG_ROUTES) {
  const imagePath = route.image ?? `/og/${route.slug}.png`;

  if (!imagePath.startsWith("/")) {
    errors.push(
      `Route "${route.path}" (slug "${route.slug}") has og:image "${imagePath}" ` +
        `that is not a public-rooted absolute path (must start with "/").`,
    );
    continue;
  }

  const onDisk = resolve(PUBLIC_DIR, imagePath.replace(/^\//, ""));
  if (!existsSync(onDisk)) {
    errors.push(
      `Route "${route.path}" (slug "${route.slug}") resolves og:image to ` +
        `"${imagePath}" but no such file exists at ${onDisk}. ` +
        `Either add the asset to public/ or fix og-routes.mjs.`,
    );
  }
}

const landing = OG_ROUTES.find((r) => r.path === LANDING_PATH);
if (!landing) {
  errors.push(
    `No route with path "${LANDING_PATH}" found in og-routes.mjs. ` +
      `The landing route is required so index.html gets the editorial ` +
      `hero as its social card.`,
  );
} else if (landing.image !== EXPECTED_LANDING_IMAGE) {
  errors.push(
    `Landing route "/" must declare image: "${EXPECTED_LANDING_IMAGE}" ` +
      `(the editorial hero) so the most-shared marketing link does not ` +
      `silently revert to the templated card. Found image: ` +
      `${landing.image === undefined ? "<unset>" : `"${landing.image}"`}.`,
  );
}

if (errors.length > 0) {
  console.error("[check-og-routes-parity] FAIL");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

console.log(
  `[check-og-routes-parity] OK — ${OG_ROUTES.length} route(s) checked, all og:image assets present.`,
);
