// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-og-pages.mjs
 *
 * Post-build step: takes the single dist/public/index.html that Vite emits
 * and stamps out one HTML file per marketing route with route-specific
 * Open Graph and Twitter card metadata.
 *
 * Run after `vite build`. Wired into the build script via package.json.
 *
 * Why this is necessary:
 *   This is a single-page app — wouter switches pages on the client. But
 *   social-media crawlers (Facebook, Twitter/X, Slack, iMessage, WhatsApp,
 *   LinkedIn) do not run JavaScript before reading <meta> tags. They fetch
 *   the URL, parse the raw HTML, and cache whatever <meta property="og:*">
 *   they see. If every route returns the same index.html, every link
 *   preview shows the landing card, which would make this whole exercise
 *   pointless.
 *
 *   So at build time we duplicate index.html into one file per marketing
 *   route, mutating only the head: <title>, <meta name="description">, and
 *   the og:* / twitter:* tags. The body and the script tags are untouched,
 *   so the SPA still hydrates and behaves identically once JavaScript runs.
 *
 * Strict mode (production / CI):
 *   When `NODE_ENV=production` or `OG_STRICT=1` is set, the script REFUSES
 *   to emit relative og:image / og:url values and exits non-zero if neither
 *   `PUBLIC_ORIGIN` nor `REPLIT_DOMAINS` is set. Facebook, X/Twitter, Slack,
 *   and iMessage all require absolute URLs in og:image and og:url —
 *   shipping relative URLs silently breaks every social card on every
 *   marketing route. Strict mode turns that silent failure into a loud
 *   build break. Production deploys via `.replit-artifact/artifact.toml`
 *   set `OG_STRICT=1` explicitly so this guard fires even if the deploy
 *   environment happens not to forward `NODE_ENV` to the build step.
 *   Local dev builds (no strict flag) keep the legacy behaviour: warn
 *   loudly, then proceed with relative URLs so contributors without
 *   `PUBLIC_ORIGIN` set can still produce a working SPA bundle.
 *
 * Output mapping:
 *   /                       -> dist/public/index.html       (in place)
 *   /compare                -> dist/public/compare.html
 *   /threat-model           -> dist/public/threat-model.html
 *   /pricing                -> dist/public/pricing.html
 *   /biometric-masking      -> dist/public/biometric-masking.html
 *   /limits                 -> dist/public/limits.html
 *
 * The static-serve layer (Replit's CDN in production, express.static in
 * self-host) needs route -> file rewrites that match this mapping. See
 * `.replit-artifact/artifact.toml` for the production config and
 * `artifacts/api-server/src/app.ts` for the self-host config.
 */

import { readFile, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OG_ROUTES, getRouteBySlug } from "./og-routes.mjs";
import { originProblem } from "./originRules.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dir, "..", "dist", "public");
const indexHtmlPath = resolve(distDir, "index.html");

if (!existsSync(indexHtmlPath)) {
  // Fail loudly. The user prefers loud failure over silent fallbacks, and
  // this script is meaningless without a fresh build to operate on.
  console.error(
    `[gen-og-pages] No index.html found at ${indexHtmlPath}. Did you run \`vite build\` first?`,
  );
  process.exit(1);
}

/**
 * Strict mode is on whenever this script is invoked in a production or CI
 * build context. It's signalled by either `NODE_ENV=production` or the
 * dedicated `OG_STRICT=1` flag. In strict mode `resolveOrigin` will exit
 * the process rather than fall back to relative URLs, because every
 * relative og:image / og:url shipped to production is a silently broken
 * social card.
 */
const STRICT =
  process.env.NODE_ENV === "production" || process.env.OG_STRICT === "1";

/**
 * Validate that a resolved origin string is a well-formed absolute URL with
 * an http(s) scheme and no path component (pathname must be exactly "/").
 *
 * Examples of values that FAIL:
 *   - "void.example.com"           — missing scheme
 *   - "ftp://void.example.com"     — non-http(s) scheme
 *   - "https://void.example.com/app" — non-root path
 *
 * In strict mode a bad value exits the process non-zero. In dev mode it warns
 * and returns false so resolveOrigin() can fall back to relative URLs (same
 * behaviour as having no origin set at all).
 *
 * @param {string} candidate  - The already-trailing-slash-stripped candidate.
 * @param {string} sourceLabel - Human-readable label for the error message.
 * @returns {boolean} true if the candidate is valid.
 */
function validateOrigin(candidate, sourceLabel) {
  // The acceptance rule (absolute http(s) URL, no path) lives in the shared
  // originRules module so the CI preflight and this build-time guard can never
  // disagree about which origins are valid.
  const problem = originProblem(candidate);
  if (problem === null) return true;
  const msg = `[gen-og-pages] Invalid ${sourceLabel} ${problem}`;
  if (STRICT) {
    console.error(`[gen-og-pages] FATAL: ${msg} — refusing to emit malformed og:image/og:url.`);
    process.exit(1);
  }
  console.warn(`${msg} — falling back to relative URLs.`);
  return false;
}

/**
 * Resolve the canonical absolute origin for og:url. Crawlers (Facebook in
 * particular) require og:image to be an absolute URL, and they treat
 * relative og:url values inconsistently. We try, in order:
 *
 *   1. PUBLIC_ORIGIN — explicit override for self-host or staging.
 *   2. https://${REPLIT_DOMAINS} — production domain on Replit deploy.
 *   3. undefined, in which case:
 *        - strict mode: exit non-zero (production must not ship relative URLs)
 *        - dev mode:    warn loudly and emit relative URLs
 *
 * In all cases the resolved value is validated by validateOrigin() — a
 * syntactically correct but malformed value (no scheme, non-root path, etc.)
 * is treated the same as a missing value: strict mode exits, dev mode warns
 * and falls back to relative URLs.
 *
 * The basePath (Vite's `base`) is appended so og:image and og:url include
 * any artifact-prefix routing.
 */
function resolveOrigin() {
  const explicit = process.env.PUBLIC_ORIGIN;
  if (explicit) {
    const stripped = explicit.replace(/\/$/, "");
    // validateOrigin exits the process in strict mode if the value is bad, so
    // if we reach the false branch here we are in dev mode — fall through to
    // the REPLIT_DOMAINS source rather than short-circuiting to null.
    if (validateOrigin(stripped, "PUBLIC_ORIGIN")) return stripped;
  }
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0].trim();
    if (first) {
      const candidate = `https://${first}`;
      // Same fall-through contract as above: strict mode already exited inside
      // validateOrigin; false here means dev mode, continue to relative fallback.
      if (validateOrigin(candidate, "REPLIT_DOMAINS")) return candidate;
    }
  }
  if (STRICT) {
    console.error(
      "[gen-og-pages] FATAL: strict mode is on (NODE_ENV=production or OG_STRICT=1) but neither PUBLIC_ORIGIN nor REPLIT_DOMAINS is set. Refusing to emit relative og:image/og:url — Facebook, X/Twitter, Slack, and iMessage will all reject them, silently breaking every social card. Set PUBLIC_ORIGIN (e.g. https://void.example.com) and re-run the build.",
    );
    process.exit(1);
  }
  console.warn(
    "[gen-og-pages] No PUBLIC_ORIGIN or REPLIT_DOMAINS set. og:image and og:url will be emitted as root-relative paths, which Facebook will reject. Set PUBLIC_ORIGIN before shipping a production build. (Set NODE_ENV=production or OG_STRICT=1 to fail the build instead of warning.)",
  );
  return null;
}

const origin = resolveOrigin();
const basePath = (process.env.BASE_PATH || process.env.BASE_URL || "/").replace(
  /\/$/,
  "",
); // strip trailing slash so path joins are predictable

/** Build an absolute URL for an asset path like "/og/landing.png". */
function absUrl(pathFromRoot) {
  const joined = `${basePath}${pathFromRoot}`;
  if (!origin) return joined;
  return `${origin}${joined}`;
}

/**
 * Mutate the head of an HTML string to carry the metadata for one route.
 *
 * We deliberately do this with regex replacements rather than parsing the
 * whole document. Vite's emitted index.html is small and predictable, the
 * meta tags we need are all present in the source template, and pulling in
 * a real HTML parser for six find-and-replace operations is overkill.
 *
 * If a tag is missing in the source, we throw — silently skipping a
 * replacement would mean shipping the wrong tag, which is worse than
 * failing the build.
 */
function rewriteHtml(html, route) {
  // Routes can pin a specific asset via `image` (see og-routes.mjs) — the
  // editorial hero, for example, is a hand-crafted JPG rather than the
  // templated PNG card. Fall back to the default `/og/<slug>.png` when no
  // override is set.
  const ogImageUrl = absUrl(route.image ?? `/og/${route.slug}.png`);
  const ogPageUrl = absUrl(route.path === "/" ? "/" : route.path);
  const escapedTitle = escapeAttr(route.title);
  const escapedDesc = escapeAttr(route.description);
  const escapedImage = escapeAttr(ogImageUrl);
  const escapedUrl = escapeAttr(ogPageUrl);

  // Each replacement pair is (regex, replacement). A regex match count of 0
  // means the source template drifted and this script is now writing the
  // wrong file. Throw rather than continue.
  const ops = [
    [
      /<title>[^<]*<\/title>/i,
      `<title>${escapeText(route.title)}</title>`,
      "<title>",
    ],
    [
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${escapedDesc}" />`,
      'name="description"',
    ],
    [
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:url" content="${escapedUrl}" />`,
      'property="og:url"',
    ],
    [
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${escapedTitle}" />`,
      'property="og:title"',
    ],
    [
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${escapedDesc}" />`,
      'property="og:description"',
    ],
    [
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${escapedImage}" />`,
      'property="og:image"',
    ],
    [
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${escapedTitle}" />`,
      'name="twitter:title"',
    ],
    [
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${escapedDesc}" />`,
      'name="twitter:description"',
    ],
    [
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${escapedImage}" />`,
      'name="twitter:image"',
    ],
  ];

  let out = html;
  for (const [pattern, replacement, label] of ops) {
    if (!pattern.test(out)) {
      throw new Error(
        `[gen-og-pages] Source index.html is missing the ${label} meta tag. Update src/index.html or this script.`,
      );
    }
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** HTML-attribute-safe escape (for content="…" values). */
function escapeAttr(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** HTML-text escape (for <title> contents). */
function escapeText(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const sourceHtml = await readFile(indexHtmlPath, "utf8");

// 1. Rewrite index.html in-place with the landing card metadata. The
//    existing template uses placeholder/old values; this normalises them.
const landing = getRouteBySlug("landing");
const landingHtml = rewriteHtml(sourceHtml, landing);
await writeFile(indexHtmlPath, landingHtml, "utf8");
console.log(`✓ rewrote dist/public/index.html (landing)`);

// 2. For every non-landing route, write a sibling <slug>.html that the
//    static-serve layer can route to via an explicit rewrite.
for (const route of OG_ROUTES) {
  if (route.slug === "landing") continue;
  const routeHtml = rewriteHtml(sourceHtml, route);
  const out = resolve(distDir, `${route.slug}.html`);
  await writeFile(out, routeHtml, "utf8");
  console.log(`✓ wrote dist/public/${route.slug}.html`);
}

// Write a JSON manifest of { "<path>": "<slug>.html" } for every non-landing
// route so the self-host API server (app.ts) can load it at startup without
// any hardcoded map. This means adding a route to og-routes.mjs and
// rebuilding is the only step required — no code changes needed in app.ts.
const manifest = {};
for (const route of OG_ROUTES) {
  if (route.slug === "landing") continue;
  manifest[route.path] = `${route.slug}.html`;
}
const manifestPath = resolve(distDir, "og-routes.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`✓ wrote dist/public/og-routes.json`);

console.log(
  `Done — ${OG_ROUTES.length} per-route HTML files generated. Resolved origin: ${origin ?? "(relative)"}`,
);
