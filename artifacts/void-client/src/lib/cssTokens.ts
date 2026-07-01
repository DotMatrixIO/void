// SPDX-License-Identifier: AGPL-3.0-or-later
// Read a CSS custom property off :root at runtime.
//
// Some contexts (HTMLCanvasElement 2D `fillStyle`) cannot consume a CSS
// `var(--token)` reference — they need a concrete color string. Rather than
// re-hardcoding the hex (which is exactly the duplication the design tokens
// exist to remove), read the single source of truth out of the cascade.
//
// Browser-only: callers run inside mounted React pages where the stylesheet
// from index.css is already parsed, so the property always resolves.
export function readCssToken(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
