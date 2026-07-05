// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * fragments.config.mjs
 *
 * Single source of truth for every shared markdown fragment in
 * docs/_fragments/. Both sync-fragments.mjs (build-time splicer) and
 * check-fragments-sync.mjs (CI verifier) import this registry so that
 * adding a new shared fragment is a one-place edit.
 *
 * Each entry declares:
 *   - id:        short kebab-case name, matches the file basename.
 *   - fragment:  path (relative to repo root) of the canonical markdown.
 *   - overview:  path (relative to repo root) of the long-form doc that
 *                must carry the same bytes between sentinel HTML
 *                comments. The sentinels are:
 *                  <!-- BEGIN GENERATED: <id> (from <fragment>) -->
 *                  <!-- END GENERATED: <id> -->
 *   - pages:     list of page source files that must `import` the
 *                fragment via Vite's `?raw` so the user-facing surface
 *                renders the same bytes the overview ships. Each entry
 *                gives the file path and the regex that must match its
 *                import. The regex is intentionally permissive about
 *                the alias prefix because pages may use `@docs/...` or
 *                `@/docs/...`.
 */
export const FRAGMENTS = [
  {
    id: "server-observable",
    fragment: "docs/_fragments/server-observable.md",
    overview: "VOID_TECHNICAL_OVERVIEW.md",
    pages: [
      {
        // Task #550 relocated the long-form threat model prose
        // (including the server-observable fragment render) to
        // /docs/threat-model.
        file: "artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx",
        importRe:
          /import\s+serverObservableMd\s+from\s+["'][^"']*server-observable\.md\?raw["']/,
      },
      {
        file: "artifacts/void-client/src/pages/LawEnforcementPage.tsx",
        importRe:
          /import\s+serverObservableMd\s+from\s+["'][^"']*server-observable\.md\?raw["']/,
      },
    ],
  },
  {
    id: "disk-logs",
    fragment: "docs/_fragments/disk-logs.md",
    overview: "VOID_TECHNICAL_OVERVIEW.md",
    pages: [
      {
        file: "artifacts/void-client/src/pages/LawEnforcementPage.tsx",
        importRe:
          /import\s+diskLogsMd\s+from\s+["'][^"']*disk-logs\.md\?raw["']/,
      },
    ],
  },
  {
    id: "pricing-logic",
    fragment: "docs/_fragments/pricing-logic.md",
    overview: "VOID_TECHNICAL_OVERVIEW.md",
    pages: [
      {
        // Task #551 relocated the long-form pricing prose (including
        // the pricing-logic fragment render) from /pricing to
        // /docs/pricing. The short-form /pricing page was collapsed
        // and /pricing now aliases /docs/pricing (same component).
        file: "artifacts/void-client/src/pages/docs/DocsPricingPage.tsx",
        importRe:
          /import\s+pricingLogicMd\s+from\s+["'][^"']*pricing-logic\.md\?raw["']/,
      },
    ],
  },
];

export function beginSentinel(entry) {
  return `<!-- BEGIN GENERATED: ${entry.id} (from ${entry.fragment}) -->`;
}

export function endSentinel(entry) {
  return `<!-- END GENERATED: ${entry.id} -->`;
}
