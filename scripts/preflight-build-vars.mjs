// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * preflight-build-vars.mjs
 *
 * Shared CI preflight: assert that the required production build VARIABLES are
 * set and well-formed BEFORE any build step runs. Both VITE_VOID_ONION_HOST
 * and PUBLIC_ORIGIN are baked into the production void-client bundle bytes, and
 * a NODE_ENV=production build correctly fails closed without them — but that
 * failure otherwise surfaces deep inside the onion-bake guard (onionHost.ts,
 * wired into vite.config.ts) or gen-og-pages.mjs with a cryptic exit. This
 * turns "you forgot to set PUBLIC_ORIGIN" into a fast, self-explanatory
 * failure with an actionable remediation message.
 *
 * This one script is invoked by BOTH release pipelines so the validation logic
 * lives in exactly one place and cannot drift:
 *   - .github/workflows/release.yml         (the `preflight` job)
 *   - .github/workflows/void-client-sri.yml (the preflight step)
 *
 * It reuses the single-source-of-truth validators the actual build relies on:
 *   - onionBakeProblem() from artifacts/void-client/src/lib/onionHost.ts
 *   - originProblem()     from artifacts/void-client/scripts/originRules.mjs
 *
 * Requires Node's TypeScript type-stripping to import onionHost.ts; callers
 * run it with `node --experimental-strip-types` so it works on Node 22.12
 * (release.yml, .nvmrc) as well as newer runtimes where it is the default.
 *
 * Emits GitHub Actions `::error::` annotations and exits non-zero on failure.
 */

import { onionBakeProblem } from "../artifacts/void-client/src/lib/onionHost.ts";
import { originProblem } from "../artifacts/void-client/scripts/originRules.mjs";

const WHERE =
  "GitHub -> Settings -> Secrets and variables -> Actions -> Variables tab";

let failed = false;

/** Emit a GitHub Actions error annotation and mark the run as failed. */
function fail(message) {
  console.error(`::error::${message}`);
  failed = true;
}

// --- VITE_VOID_ONION_HOST -------------------------------------------------
// The canonical Tor v3 .onion mirror host baked into the bundle. Must be a
// 56-char base32 [a-z2-7] label before ".onion" (onionHost.ts). A scheme,
// path, or trailing slash on the raw value is tolerated by the validator.
const onion = process.env.VITE_VOID_ONION_HOST;
const onionErr = onionBakeProblem(onion);
if (onionErr !== null) {
  if (!onion) {
    fail(
      "Required repository variable VITE_VOID_ONION_HOST is not set. It is the " +
        "canonical Tor v3 .onion mirror host baked into the production " +
        `void-client bundle. Set it in ${WHERE} to your deployment's ` +
        "<56-char-base32>.onion host, then re-run. (See README-selfhost.md §6e.)",
    );
  } else {
    fail(
      `Repository variable VITE_VOID_ONION_HOST='${onion}' is not a ` +
        "syntactically valid Tor v3 .onion host (expected a 56-character " +
        'base32 [a-z2-7] label immediately before ".onion"). Fix it in ' +
        `${WHERE}, then re-run.`,
    );
  }
}

// --- PUBLIC_ORIGIN --------------------------------------------------------
// The absolute origin baked into the social-card OG pages by gen-og-pages.mjs.
// Must be an absolute http(s) root URL with no path (originRules.mjs).
const origin = process.env.PUBLIC_ORIGIN;
const originErr = originProblem(origin);
if (originErr !== null) {
  if (!origin) {
    fail(
      "Required repository variable PUBLIC_ORIGIN is not set. It is the " +
        "absolute origin baked into the social-card OG pages by " +
        `gen-og-pages.mjs. Set it in ${WHERE} to an absolute root URL (e.g. ` +
        "https://void.example.com or https://<56-char-base32>.onion), then " +
        "re-run.",
    );
  } else {
    fail(
      `Repository variable PUBLIC_ORIGIN='${origin}' is not an absolute root ` +
        "URL. Expected an http(s) scheme and a bare host with no path, e.g. " +
        `https://void.example.com. Fix it in ${WHERE}, then re-run.`,
    );
  }
}

if (failed) {
  console.error(
    "::error::Preflight failed: one or more required build variables are " +
      "missing or malformed (see errors above). No build steps ran. These " +
      "variables are baked into the released bundle bytes, and the " +
      "NODE_ENV=production build fails closed without them by design.",
  );
  process.exit(1);
}

console.log(
  "Preflight OK: VITE_VOID_ONION_HOST and PUBLIC_ORIGIN are set and well-formed.",
);
