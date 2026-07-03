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
for (const m of appSource.matchAll(
  /<Route\s+path="([^"]+)"\s+component=\{(\w+)\}\s*\/>/g,
)) {
  const [, routePath, componentName] = m;
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
