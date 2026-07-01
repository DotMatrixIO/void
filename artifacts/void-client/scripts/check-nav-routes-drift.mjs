#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: keep the global navigation surfaces — the hamburger menu
// (`src/components/HamburgerMenu.tsx`) and the page footer
// (`src/components/PageFooter.tsx`) — in sync with the production route
// set declared in `src/App.tsx`.
//
// This is the sibling of `check-routes-overview-drift.mjs`. That check
// catches router <-> VOID_TECHNICAL_OVERVIEW.md §6.2 drift; it does NOT
// catch the related case where the hamburger nav or footer point at a
// route that no longer exists (a silent 404, the way `/agents` was hidden
// in v0.5 / Task #321), or where a new public route ships without a
// hamburger / footer entry.
//
// It enforces two invariants:
//
//   1. Every internal link in the hamburger menu and footer must resolve
//      to a production-facing <Route path="..."> in App.tsx. A link to a
//      route that does not exist is a 404 waiting to happen.
//
//   2. Every production-facing route in App.tsx must either be linked from
//      the hamburger menu / footer, OR be on the explicit "intentionally
//      unlinked" allowlist below. A new public page that nobody can reach
//      from the global nav is almost always an oversight.
//
// "Internal link" means a string-literal href that starts with `/`. We
// match both the `{ href: "/x" }` object form used by HamburgerMenu's
// NAV_LINKS array and the `<Link href="/x">` / `href="/x"` JSX-attribute
// form used elsewhere. Expression hrefs (`href={REPO_URL}`) and external
// `https://` / `.onion` links are deliberately ignored — they are not
// router routes.
//
// DEV-gated routes (declared inside `{import.meta.env.DEV && (...)}`) are
// skipped — they are not part of the public surface and must not appear in
// the global nav.
//
// ── Intentionally-unlinked allowlist ───────────────────────────────────
// These production routes are reachable by design WITHOUT a hamburger /
// footer entry, so they are exempt from invariant #2:
//
//   /                    Home / root — the logo and the default route reach
//                        it; it is never a menu item.
//   /proof/server-state  Linked contextually from the audit / proof pages,
//                        not from the global nav.
//   /proof/runtime       Linked from the BuildProvenanceBadge embedded in
//                        the footer (a child component, not part of the
//                        footer's own link list).
//   /host                Host-onboarding deep link, reached from LandingPage
//                        and InvitedPage in-body copy.
//   /tor                 Tor / .onion deep link, reached from InvitedPage
//                        and HostPage in-body copy.
//   /agents              Hidden in v0.5 (Task #321). Listed here so that if
//                        the route is ever restored it does not trip this
//                        check before its nav entry is added back.
//   /docs/*              Every docs subpage is reached through the /docs
//                        index hub (which IS footer-linked); the subpages
//                        are intentionally not duplicated in the global nav.
//
// Run via:
//
//     pnpm --filter @workspace/void-client run check:nav-routes
//
// Wired into CI as an additional step on
// `.github/workflows/asyncapi-spec-drift.yml` and into the local
// `marketing-voice` validation workflow in `.replit`.

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");
const APP_PATH = resolve(CLIENT_ROOT, "src/App.tsx");
const HAMBURGER_PATH = resolve(CLIENT_ROOT, "src/components/HamburgerMenu.tsx");
const FOOTER_PATH = resolve(CLIENT_ROOT, "src/components/PageFooter.tsx");

// Production routes that intentionally have no hamburger / footer entry.
// See the header block above for the rationale behind each one.
const UNLINKED_ALLOWLIST = new Set([
  "/",
  "/proof/server-state",
  "/proof/runtime",
  "/host",
  "/tor",
  "/agents",
]);

function isAllowlisted(path) {
  if (UNLINKED_ALLOWLIST.has(path)) return true;
  // Docs subpages hang off the /docs index hub, which is itself linked.
  if (path.startsWith("/docs/")) return true;
  return false;
}

// Pull every production-facing `<Route path="...">` out of App.tsx. Mirrors
// the extraction in check-routes-overview-drift.mjs: classify each route as
// production or DEV-gated by scanning a small window of preceding lines for
// an `import.meta.env.DEV &&` conditional, and drop the catch-all NotFound
// `<Route component={...}>` (no addressable path).
async function extractProductionRoutes() {
  const text = await readFile(APP_PATH, "utf8");
  const lines = text.split("\n");
  const prod = new Set();
  const ROUTE_RE = /<Route\s+[^>]*?path=(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    const path = m[2];
    const upTo = text.slice(0, m.index);
    const lineIdx = upTo.split("\n").length - 1;
    const window = lines.slice(Math.max(0, lineIdx - 5), lineIdx).join("\n");
    const devOnly = /import\.meta\.env\.DEV\s*&&/.test(window);
    if (!devOnly) prod.add(path);
  }
  return prod;
}

// Pull every internal string-literal href out of a nav component. Matches
// both `href: "/x"` (object form, e.g. HamburgerMenu's NAV_LINKS) and
// `href="/x"` / `<Link href="/x">` (JSX-attribute form). Only hrefs whose
// value begins with `/` are returned, so `href={REPO_URL}` expressions and
// external `https://` links are skipped.
async function extractNavLinks(filePath) {
  const text = await readFile(filePath, "utf8");
  const links = new Set();
  const HREF_RE = /href\s*[:=]\s*(['"`])(\/[^'"`]*)\1/g;
  let m;
  while ((m = HREF_RE.exec(text)) !== null) {
    links.add(m[2]);
  }
  return links;
}

async function main() {
  const [prodRoutes, hamburgerLinks, footerLinks] = await Promise.all([
    extractProductionRoutes(),
    extractNavLinks(HAMBURGER_PATH),
    extractNavLinks(FOOTER_PATH),
  ]);

  const navLinks = new Map(); // href -> source label(s)
  const note = (href, src) => {
    navLinks.set(href, navLinks.has(href) ? `${navLinks.get(href)} + ${src}` : src);
  };
  for (const href of hamburgerLinks) note(href, "hamburger menu");
  for (const href of footerLinks) note(href, "footer");

  const errors = [];

  // 1. Broken links: a hamburger / footer link must resolve to a real
  //    production route.
  for (const [href, src] of navLinks) {
    if (!prodRoutes.has(href)) {
      errors.push(
        `The ${src} links to "${href}" but no production <Route path="${href}"> ` +
          `exists in artifacts/void-client/src/App.tsx. Either fix/remove the ` +
          `link, or add the route back to the router.`,
      );
    }
  }

  // 2. Orphan routes: a production route must be linked from the nav OR be
  //    on the intentionally-unlinked allowlist.
  for (const path of prodRoutes) {
    if (navLinks.has(path)) continue;
    if (isAllowlisted(path)) continue;
    errors.push(
      `Route "${path}" is registered in artifacts/void-client/src/App.tsx but ` +
        `is not linked from the hamburger menu (NAV_LINKS in ` +
        `src/components/HamburgerMenu.tsx) or the footer ` +
        `(src/components/PageFooter.tsx). Add a nav entry, or add "${path}" to ` +
        `the UNLINKED_ALLOWLIST in ` +
        `${relative(REPO_ROOT, fileURLToPath(import.meta.url))} with a reason.`,
    );
  }

  if (errors.length > 0) {
    console.error("[check-nav-routes-drift] FAIL");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  const linkedCount = [...prodRoutes].filter((p) => navLinks.has(p)).length;
  const allowlistedCount = prodRoutes.size - linkedCount;
  console.log(
    `[check-nav-routes-drift] OK — ${prodRoutes.size} production route(s); ` +
      `${navLinks.size} nav link(s) (${hamburgerLinks.size} hamburger, ` +
      `${footerLinks.size} footer) all resolve; ${linkedCount} route(s) linked, ` +
      `${allowlistedCount} intentionally unlinked.`,
  );
}

main().catch((err) => {
  console.error(`[check-nav-routes-drift] failed: ${err.stack ?? err}`);
  process.exit(1);
});
