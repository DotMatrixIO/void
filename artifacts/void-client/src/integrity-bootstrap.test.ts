// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Regression test for the SRI-failure diagnostic bootstrap that lives
 * inline in `index.html` (task #249, follow-up to task #243).
 *
 * The bootstrap is plain inline JavaScript — there is no module to import
 * — so this test reads `index.html` from disk, extracts the FIRST inline
 * <script> block in <body> (the one whose comment marker mentions the SRI
 * diagnostic), evaluates it in jsdom against a fresh DOM, and then
 * dispatches an `error` event from a synthetic <script integrity="…">
 * element. The bootstrap should react to that event by replacing the
 * contents of `#root` with the integrity-failure overlay.
 *
 * The point is not to re-test browser SRI semantics — those are a browser
 * contract. The point is to catch a regression in the inline bootstrap
 * itself: a typo in the listener registration, a missing capture-phase
 * argument, an over-broad filter that flashes the overlay on unrelated
 * 404s, or a copy change that quietly drops the user-visible message.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = resolve(__dirname, "..", "index.html");

function extractDiagnosticBootstrap(): string {
  const html = readFileSync(INDEX_HTML_PATH, "utf8");
  // The bootstrap is the first inline <script> (no src) in <body>. We
  // anchor on the IIFE marker rather than on a comment substring so a
  // future comment edit doesn't quietly break this test.
  const match = html.match(
    /<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);?)\s*<\/script>/,
  );
  if (!match) {
    throw new Error(
      "Could not locate the SRI-diagnostic inline bootstrap in index.html. " +
        "If the script was intentionally moved or restructured, update this test.",
    );
  }
  return match[1];
}

function installBootstrap(): void {
  // jsdom provides window/document; Function() runs the source string
  // against the global scope, which is the window jsdom set up.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(extractDiagnosticBootstrap())();
}

function fireResourceError(el: Element): void {
  const ev = new Event("error", { bubbles: false, cancelable: false });
  Object.defineProperty(ev, "target", { value: el, configurable: true });
  window.dispatchEvent(ev);
}

describe("index.html SRI failure diagnostic", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("renders the integrity-failure overlay when an SRI'd <script> errors", () => {
    installBootstrap();

    const script = document.createElement("script");
    script.setAttribute("src", "/assets/index-abc.js");
    script.setAttribute("integrity", "sha384-deadbeef");
    document.body.appendChild(script);
    fireResourceError(script);

    const root = document.getElementById("root");
    expect(root?.textContent ?? "").toMatch(/integrity check/i);
    expect(root?.textContent ?? "").toMatch(/nothing on this page is safe to use/i);
  });

  it("renders the overlay for an SRI'd <link rel=stylesheet> failure too", () => {
    installBootstrap();

    const link = document.createElement("link");
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", "/assets/index-abc.css");
    link.setAttribute("integrity", "sha384-deadbeef");
    document.head.appendChild(link);
    fireResourceError(link);

    const root = document.getElementById("root");
    expect(root?.textContent ?? "").toMatch(/integrity check/i);
  });

  it("does NOT render the overlay when a non-SRI'd asset fails (e.g. an OG image 404)", () => {
    installBootstrap();

    const img = document.createElement("img");
    img.setAttribute("src", "/og/missing.png");
    document.body.appendChild(img);
    fireResourceError(img);

    const script = document.createElement("script");
    script.setAttribute("src", "/some-non-sri.js");
    document.body.appendChild(script);
    fireResourceError(script);

    const root = document.getElementById("root");
    expect(root?.innerHTML ?? "").toBe("");
  });

  it("only renders the overlay once even if multiple SRI'd assets fail", () => {
    installBootstrap();

    for (let i = 0; i < 3; i += 1) {
      const s = document.createElement("script");
      s.setAttribute("src", `/assets/chunk-${i}.js`);
      s.setAttribute("integrity", "sha384-deadbeef");
      document.body.appendChild(s);
      fireResourceError(s);
    }

    const root = document.getElementById("root");
    const overlays = root?.querySelectorAll('[role="alert"]') ?? [];
    expect(overlays.length).toBe(1);
  });

  it("falls back to appending an overlay div when #root is missing", () => {
    document.body.innerHTML = "";
    installBootstrap();

    const script = document.createElement("script");
    script.setAttribute("src", "/assets/index-abc.js");
    script.setAttribute("integrity", "sha384-deadbeef");
    document.body.appendChild(script);
    fireResourceError(script);

    expect(document.body.textContent ?? "").toMatch(/integrity check/i);
  });
});
