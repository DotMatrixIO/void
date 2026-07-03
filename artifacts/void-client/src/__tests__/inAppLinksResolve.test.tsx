// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";

// Task #1092: the route-existence guard from #1087
// (docsAnchorLinksResolve.test.tsx) only covers <DocsAnchorLink> usages. But
// most in-app navigation goes through wouter's <Link> and the <ReadMoreButton>
// component (e.g. the "/", "/proof/server-state", "/docs/audit" links live on
// those, not DocsAnchorLink). A typo'd or removed route behind any of those
// would strand the reader on the NotFound page with no failing test — exactly
// the gap #1087 closed for docs links, but everywhere else.
//
// This guard closes that gap. It:
//   1. scans the source for every <Link href="/…"> and <ReadMoreButton
//      href="/…"> usage whose href is a literal internal path,
//   2. reduces each href to its route path (dropping any #hash), and
//   3. asserts that path is declared in App.tsx's <Route> table.
// Because the link list is derived from source (not hard-coded), it covers
// today's links and any future <Link>/<ReadMoreButton> without further edits.

// Raw source of every .tsx (strings only — cheap; used for static scanning).
const rawSources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const appSource = rawSources["../App.tsx"] ?? "";

// Every route path declared in App.tsx's <Route> table. `\s+` spans the
// newlines used by the DEV-gated multi-line <Route> entries, so both the
// single-line and wrapped forms are captured.
const declaredRoutePaths = new Set<string>();
for (const m of appSource.matchAll(
  /<Route\s+path="([^"]+)"\s+component=\{(\w+)\}\s*\/>/g,
)) {
  declaredRoutePaths.add(m[1]);
}

type RouteLink = { href: string; routePath: string; source: string };

// A href we should skip: anything not an internal route path. External
// (http/https/protocol-relative/mailto/tel), same-page/hash-only anchors, and
// anything that isn't rooted at "/". Dynamic hrefs (href={expr}) never reach
// here because the scanner only matches the string-literal href="…" form.
function isInternalRoutePath(href: string): boolean {
  if (href.startsWith("#")) return false; // same-page anchor, no route
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // has a URI scheme (http:, mailto:, tel:)
  if (href.startsWith("//")) return false; // protocol-relative external
  return href.startsWith("/");
}

// Every <Link href="/…"> and <ReadMoreButton href="/…"> with a literal
// internal href, deduped by route path. `[^>]*?` spans newlines (JS `[^>]`
// matches `\n`) so multi-line tags are covered; it stops at the first href="…"
// in the tag, which in this codebase always precedes any `=>` arrow (whose `>`
// would otherwise terminate the class). Dynamic href={…} forms don't match.
function collectRouteLinks(): RouteLink[] {
  const seen = new Map<string, RouteLink>();
  const linkRe = /<(?:Link|ReadMoreButton)\b[^>]*?\shref="([^"]+)"/g;
  for (const [key, source] of Object.entries(rawSources)) {
    if (key.endsWith(".test.tsx")) continue; // skip test fixtures
    for (const m of source.matchAll(linkRe)) {
      const href = m[1];
      if (!isInternalRoutePath(href)) continue;
      const hashIdx = href.indexOf("#");
      const routePath = hashIdx === -1 ? href : href.slice(0, hashIdx);
      if (!routePath) continue; // href was a bare "#anchor" — no route to check
      if (!seen.has(routePath)) {
        seen.set(routePath, { href, routePath, source: key });
      }
    }
  }
  return [...seen.values()];
}

const routeLinks = collectRouteLinks();

describe("every in-app <Link>/<ReadMoreButton> points at a real route (#1092)", () => {
  it("discovers in-app link route targets", () => {
    // Guards the scanner itself: if the regex or a rename ever makes this fall
    // to zero, the it.each below would vacuously pass. These shipped targets are
    // the floor — "/" and the threat-model page come from <Link>, and the docs
    // long-form pages come from <ReadMoreButton>.
    expect(routeLinks.length).toBeGreaterThanOrEqual(5);
    const paths = routeLinks.map((l) => l.routePath);
    expect(paths).toContain("/");
    expect(paths).toContain("/threat-model");
    expect(paths).toContain("/docs/audit"); // a ReadMoreButton target
  });

  it.each(routeLinks)(
    "$href — route path exists in App.tsx",
    ({ href, routePath }) => {
      expect(
        declaredRoutePaths.has(routePath),
        `No <Route path="${routePath}"> found in App.tsx for the in-app link ` +
          `href="${href}". The link points at a route that does not exist (a ` +
          `typo or a removed page), so it would strand the reader on the ` +
          `NotFound page. Add the route (or fix the href) so the link resolves.`,
      ).toBe(true);
    },
  );

  it("would fail an in-app link aimed at a non-existent route", () => {
    // Proves the route-existence check has teeth: a fabricated dead route is
    // absent from the declared table, so the it.each assertion above would fail
    // for any real link that named it. Also confirms a genuine route resolves.
    expect(declaredRoutePaths.has("/does-not-exist")).toBe(false);
    expect(declaredRoutePaths.has("/")).toBe(true);
  });
});
