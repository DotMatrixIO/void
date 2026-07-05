// SPDX-License-Identifier: AGPL-3.0-or-later
import axe from "axe-core";
import { expect } from "vitest";

// Component-scoped axe-core audit for the jsdom test environment.
//
// Why a custom helper instead of a matcher library:
//   - We render isolated components (dialogs, sheets, menus), not whole pages,
//     so page-level rules (landmarks, a single <main>, document title, lang on
//     <html>, a top-level <h1>) are not meaningful and are disabled here.
//   - jsdom has no layout engine, so axe's color-contrast rule cannot run
//     (contrast is already gated separately by scripts/check-contrast.mjs).
//
// What it still enforces: accessible names on controls, valid ARIA roles/attrs,
// role-required parent/child relationships, label associations, list/structure
// rules, duplicate ids, and tabindex misuse — the "axe-style" checks the a11y
// pass is meant to lock in.
const PAGE_LEVEL_RULES_OFF: Record<string, { enabled: boolean }> = {
  "color-contrast": { enabled: false },
  region: { enabled: false },
  "landmark-one-main": { enabled: false },
  "page-has-heading-one": { enabled: false },
  "document-title": { enabled: false },
  "html-has-lang": { enabled: false },
  "html-lang-valid": { enabled: false },
  "landmark-no-duplicate-banner": { enabled: false },
  bypass: { enabled: false },
};

export async function expectNoAxeViolations(
  container: HTMLElement,
  extraRules: Record<string, { enabled: boolean }> = {},
): Promise<void> {
  const results = await axe.run(container, {
    rules: { ...PAGE_LEVEL_RULES_OFF, ...extraRules },
  });

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => {
        const targets = v.nodes
          .map((n) => `      - ${n.target.join(" ")}\n        ${n.failureSummary ?? ""}`)
          .join("\n");
        return `  [${v.impact ?? "n/a"}] ${v.id}: ${v.help}\n    ${v.helpUrl}\n${targets}`;
      })
      .join("\n\n");
    expect.fail(
      `axe found ${results.violations.length} accessibility violation(s):\n\n${summary}`,
    );
  }
}
