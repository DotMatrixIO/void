// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentType } from "react";

// Task #1052: every in-app DocsAnchorLink deep link relies on its `#hash`
// matching an element `id` on the destination docs page. That contract used to
// be held only by hand-written per-link tests, so a copy edit that renamed or
// dropped a heading id would silently break the jump with no failing test.
//
// This guard closes that gap automatically. It:
//   1. scans the source for every <DocsAnchorLink href="…#hash"> usage,
//   2. maps the href's route path to the page component via App.tsx's own
//      <Route path=… component=…/> table + import statements, and
//   3. renders that page and asserts the `#hash` resolves to a real id.
// Because the link list is derived from source (not hard-coded), it covers the
// two existing anchors and any future DocsAnchorLink without further edits.

// Raw source of every .tsx (strings only — cheap; used for static scanning).
const rawSources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Lazy loaders for every page module (loaded only when a link targets it, so
// we never eval dev-only/heavy pages we don't need to render).
const pageLoaders = import.meta.glob("../pages/**/*.tsx") as Record<
  string,
  () => Promise<{ default: ComponentType }>
>;

// normalized page key ("pages/docs/DocsThreatModelPage") -> glob loader key
const pageKeyByNormalized = new Map<string, string>();
for (const key of Object.keys(pageLoaders)) {
  const normalized = key.replace(/^\.\.\//, "").replace(/\.tsx$/, "");
  pageKeyByNormalized.set(normalized, key);
}

const appSource = rawSources["../App.tsx"] ?? "";

// import name -> normalized module path ("pages/docs/DocsThreatModelPage")
const componentModule = new Map<string, string>();
for (const m of appSource.matchAll(
  /import\s+(\w+)\s+from\s+"(@\/pages\/[^"]+)"/g,
)) {
  componentModule.set(m[1], m[2].replace(/^@\//, ""));
}

// route path -> page loader key
const routeLoaderKey = new Map<string, string>();
// Every route path declared in App.tsx's <Route> table, regardless of whether
// its component is a lazily-loadable @/pages module (some routes, e.g. "/",
// bind to a component defined inline in App.tsx). Used to validate that a
// hash-less DocsAnchorLink points at a route that actually exists.
const declaredRoutePaths = new Set<string>();
for (const m of appSource.matchAll(
  /<Route\s+path="([^"]+)"\s+component=\{(\w+)\}\s*\/>/g,
)) {
  const [, routePath, componentName] = m;
  declaredRoutePaths.add(routePath);
  const normalized = componentModule.get(componentName);
  if (!normalized) continue;
  const loaderKey = pageKeyByNormalized.get(normalized);
  if (loaderKey) routeLoaderKey.set(routePath, loaderKey);
}

type DeepLink = { href: string; routePath: string; hash: string };

function collectDeepLinks(): DeepLink[] {
  const seen = new Map<string, DeepLink>();
  const anchorRe = /<DocsAnchorLink\b[^>]*?\shref="([^"]+)"/g;
  for (const [key, source] of Object.entries(rawSources)) {
    if (key.endsWith(".test.tsx")) continue; // skip test fixtures
    for (const m of source.matchAll(anchorRe)) {
      const href = m[1];
      const hashIdx = href.indexOf("#");
      if (hashIdx === -1) continue; // no anchor to verify
      const routePath = href.slice(0, hashIdx);
      const hash = href.slice(hashIdx + 1);
      if (!hash) continue;
      seen.set(href, { href, routePath, hash });
    }
  }
  return [...seen.values()];
}

const deepLinks = collectDeepLinks();

type RouteLink = { href: string; routePath: string };

// Every DocsAnchorLink href, hash-bearing or not, reduced to its route path.
// The route-existence check below applies to ALL of them: the hash-bearing
// deep links get the extra id-resolution assertion above, but a link WITHOUT a
// `#hash` was previously skipped entirely — so a hash-less link at a typo'd or
// removed route (e.g. /docs/limitz) would strand the reader on NotFound with
// no failing test. We only require the route to exist in App.tsx's <Route>
// table (not to be a renderable @/pages module), because some routes bind to a
// component defined inline in App.tsx (e.g. "/").
function collectRouteLinks(): RouteLink[] {
  const seen = new Map<string, RouteLink>();
  const anchorRe = /<DocsAnchorLink\b[^>]*?\shref="([^"]+)"/g;
  for (const [key, source] of Object.entries(rawSources)) {
    if (key.endsWith(".test.tsx")) continue; // skip test fixtures
    for (const m of source.matchAll(anchorRe)) {
      const href = m[1];
      const hashIdx = href.indexOf("#");
      const routePath = hashIdx === -1 ? href : href.slice(0, hashIdx);
      if (!routePath) continue; // bare "#same-page" anchor — no route to check
      if (!seen.has(routePath)) seen.set(routePath, { href, routePath });
    }
  }
  return [...seen.values()];
}

const routeLinks = collectRouteLinks();

describe("DocsAnchorLink deep links resolve to a docs anchor (#1052)", () => {
  it("discovers the known in-app docs deep links", () => {
    // Guards the scanner itself: if the regex or a rename ever makes this fall
    // to zero, the it.each below would vacuously pass. The two shipped anchors
    // (posture verify + onion-path explainer) are the floor.
    expect(deepLinks.length).toBeGreaterThanOrEqual(2);
    const hashes = deepLinks.map((l) => `${l.routePath}#${l.hash}`);
    expect(hashes).toContain("/docs/threat-model#verify-the-posture");
    expect(hashes).toContain(
      "/docs/threat-model#how-void-surfaces-the-onion-path",
    );
  });

  it.each(deepLinks)(
    "$href — target id #$hash exists on its docs page",
    async ({ routePath, hash }) => {
      const loaderKey = routeLoaderKey.get(routePath);
      expect(
        loaderKey,
        `No <Route path="${routePath}"> found in App.tsx for this DocsAnchorLink. ` +
          `Add the route (or fix the href) so the deep link resolves.`,
      ).toBeTruthy();
      const mod = await pageLoaders[loaderKey!]();
      const Page = mod.default;
      const { container } = render(<Page />);
      expect(
        container.querySelector(`[id="${hash}"]`),
        `The docs page for "${routePath}" has no element with id="${hash}". ` +
          `A DocsAnchorLink points at "${routePath}#${hash}" but the target ` +
          `anchor is missing — restore the id or update the link.`,
      ).not.toBeNull();
    },
  );
});

describe("every DocsAnchorLink href points at a real route (#1087)", () => {
  it("discovers DocsAnchorLink route targets", () => {
    // Guards the scanner: if the regex ever falls to zero the it.each below
    // would vacuously pass. The shipped deep links all target /docs/threat-model
    // (deduped by route path here), so that one route is the floor; this check
    // ALSO covers any hash-less DocsAnchorLink, which the #1052 guard above
    // skips because it has no anchor to resolve.
    expect(routeLinks.length).toBeGreaterThanOrEqual(1);
    expect(routeLinks.map((l) => l.routePath)).toContain("/docs/threat-model");
  });

  it.each(routeLinks)(
    "$href — route path exists in App.tsx",
    ({ routePath }) => {
      expect(
        declaredRoutePaths.has(routePath),
        `No <Route path="${routePath}"> found in App.tsx for this DocsAnchorLink. ` +
          `The link points at a route that does not exist (a typo or a removed ` +
          `page), so it would strand the reader on the NotFound page. ` +
          `Add the route (or fix the href) so the link resolves.`,
      ).toBe(true);
    },
  );

  it("would fail a DocsAnchorLink aimed at a non-existent /docs route", () => {
    // Proves the route-existence check has teeth: a fabricated dead route is
    // absent from the declared table, so the it.each assertion above would fail
    // for any real link that named it. Also confirms a genuine route resolves.
    expect(declaredRoutePaths.has("/docs/does-not-exist")).toBe(false);
    expect(declaredRoutePaths.has("/docs/threat-model")).toBe(true);
  });
});
