#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * smoke-room-header-layout.mjs — Task #519 layout smoke pass.
 *
 * Drives the running `@workspace/void-client` dev server with a
 * headless Chromium and exercises the real `RoomPage` (mounted via the
 * dev-only `/__smoke/room` route in `App.tsx`, which uses snapshot
 * mode to force a 4-up grid with every tile in the
 * secure-channel-failure state and the single-line wait-hint already
 * visible) at the five viewports called out in task #519:
 *
 *   360x640   (small phone, portrait)
 *   414x896   (mid phone, portrait)
 *   768x1024  (tablet, portrait)
 *   1280x800  (laptop, landscape)
 *   740x360   (phone, landscape)
 *
 * For each viewport it asserts the invariants from the task's "Done
 * looks like":
 *
 *   1. The phrase row never truncates (no horizontal clipping; full
 *      text content is rendered).
 *   2. Every header control is reachable without horizontal scroll —
 *      the document scrollWidth equals its clientWidth.
 *   3. The compact DROP bar sits above the control bar without overlap.
 *   4. The single-line wait-hint never overlaps the control bar.
 *   5. The RETRY SECURE CHANNEL button in every tile of the 4-up grid
 *      is fully visible inside its tile and inside the viewport.
 *
 * Reuses `gen-still-poster.mjs`'s chromium-discovery so it works
 * inside the Replit Nix image without bundling a browser. The dev
 * server URL is taken from `SMOKE_BASE_URL` (default
 * `http://localhost:24363`).
 *
 * Exit codes:
 *   0 — every viewport passed every invariant.
 *   1 — one or more invariants regressed; details on stdout. File the
 *       regressions as separate tickets per the task's done-criteria.
 *   2 — infrastructure failure (chromium not found, dev server
 *       unreachable, page error).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import puppeteer from "puppeteer-core";

function findChromium() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;
  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "chrome"]) {
    try {
      const p = execFileSync("which", [cmd], { encoding: "utf8" }).trim();
      if (p && existsSync(p)) return p;
    } catch { /* not found */ }
  }
  const nixStore = "/nix/store";
  if (existsSync(nixStore)) {
    const candidates = readdirSync(nixStore)
      .filter((d) => d.endsWith("-playwright-browsers-chromium"))
      .map((d) => `${nixStore}/${d}`)
      .flatMap((dir) => {
        try {
          return readdirSync(dir)
            .filter((sub) => sub.startsWith("chromium-"))
            .map((sub) => `${dir}/${sub}/chrome-linux/chrome`);
        } catch { return []; }
      })
      .filter((p) => existsSync(p));
    if (candidates.length > 0) {
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      return candidates[0];
    }
  }
  throw new Error(
    "Could not locate Chromium. Set PUPPETEER_EXECUTABLE_PATH to a Chrome/Chromium binary.",
  );
}

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:24363";
const SMOKE_URL = `${BASE_URL.replace(/\/$/, "")}/__smoke/room`;

const VIEWPORTS = [
  { name: "360x640 (small phone portrait)", width: 360, height: 640 },
  { name: "414x896 (mid phone portrait)", width: 414, height: 896 },
  { name: "768x1024 (tablet portrait)", width: 768, height: 1024 },
  { name: "1280x800 (laptop landscape)", width: 1280, height: 800 },
  { name: "740x360 (phone landscape)", width: 740, height: 360 },
];

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return;
    } catch (err) { lastErr = err; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Dev server at ${url} did not become ready within ${timeoutMs}ms` +
      (lastErr ? `: ${lastErr.message}` : ""),
  );
}

async function runViewport(browser, vp) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.goto(SMOKE_URL, { waitUntil: "networkidle0", timeout: 30_000 });

  // The smoke harness mounts RoomPage inside an effect; wait for the
  // real header and a 4-up grid full of RETRY buttons to appear.
  await page.waitForSelector('[data-testid="room-phrase-row"]', { timeout: 15_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="secure-channel-retry-"]').length >= 3,
    { timeout: 15_000 },
  );
  // Let layout settle (DropSlot mounts, fonts swap in).
  await new Promise((r) => setTimeout(r, 300));

  const result = await page.evaluate((vpW, vpH) => {
    const docEl = document.documentElement;
    const phrase = document.querySelector('[data-testid="room-phrase-row"]');
    const drop = document.querySelector('[data-testid="drop-slot"]');
    const controlBar = document.querySelector('.void-control-bar');
    const waitHint = document.querySelector('[role="status"][aria-live="polite"]')
      // The wait-hint is the role=status node whose text starts with
      // either "STILL WAITING" or "COULDN'T CONNECT". Other role=status
      // nodes exist (drop-slot-value); pick by text content.
      ? Array.from(document.querySelectorAll('[role="status"]'))
          .find((el) => /STILL WAITING|COULDN'T CONNECT/i.test(el.textContent || ""))
      : null;
    const retryBtns = Array.from(
      document.querySelectorAll('[data-testid^="secure-channel-retry-"]'),
    );

    const r = (el) => el ? el.getBoundingClientRect().toJSON() : null;

    // Phrase truncation: the CSS keeps it on its own row and wraps via
    // word-break:break-word, so any scrollWidth>clientWidth is a real
    // regression. Also assert the rendered text exactly matches the
    // expected six-word phrase so a CSS rule that hides overflow can't
    // silently pass.
    const phraseClipped = phrase ? (phrase.scrollWidth > phrase.clientWidth + 0.5) : true;
    const phraseTextRendered = phrase ? phrase.textContent.trim() : "";

    const horizontalScroll = docEl.scrollWidth > docEl.clientWidth + 0.5;

    const dropRect = r(drop);
    const controlRect = r(controlBar);
    const waitHintRect = r(waitHint);

    const dropAboveControl = (dropRect && controlRect)
      ? dropRect.bottom <= controlRect.top + 0.5
      : false;

    const waitHintAboveControl = (waitHintRect && controlRect)
      ? waitHintRect.bottom <= controlRect.top + 0.5
      : false;

    const retryReports = retryBtns.map((btn) => {
      const br = btn.getBoundingClientRect();
      const tile = btn.closest('.void-video-slot');
      const tr = tile ? tile.getBoundingClientRect() : null;
      const visibleInTile = tr
        ? br.top >= tr.top - 0.5 && br.bottom <= tr.bottom + 0.5 &&
          br.left >= tr.left - 0.5 && br.right <= tr.right + 0.5
        : false;
      const visibleInViewport =
        br.top >= 0 && br.left >= 0 &&
        br.bottom <= vpH + 0.5 && br.right <= vpW + 0.5 &&
        br.width > 0 && br.height > 0;
      return {
        id: btn.getAttribute('data-testid'),
        rect: br.toJSON(),
        tileRect: tr ? tr.toJSON() : null,
        visibleInTile,
        visibleInViewport,
      };
    });

    return {
      phraseClipped, phraseTextRendered,
      horizontalScroll,
      docScrollWidth: docEl.scrollWidth,
      docClientWidth: docEl.clientWidth,
      dropRect, controlRect, waitHintRect,
      dropAboveControl, waitHintAboveControl,
      retryReports,
      retryCount: retryBtns.length,
    };
  }, vp.width, vp.height);

  await page.close();

  const EXPECTED_PHRASE = "midnight cobalt fern lantern quartz harbour";
  const failures = [];
  if (result.phraseClipped) failures.push(`phrase row is clipped (scrollWidth>clientWidth)`);
  if (result.phraseTextRendered !== EXPECTED_PHRASE) {
    failures.push(`phrase text differs: "${result.phraseTextRendered}"`);
  }
  if (result.horizontalScroll) {
    failures.push(`horizontal scroll present (docScrollWidth=${result.docScrollWidth} > clientWidth=${result.docClientWidth})`);
  }
  if (!result.dropRect) failures.push(`DROP compact bar missing`);
  if (!result.controlRect) failures.push(`control bar missing`);
  if (!result.waitHintRect) failures.push(`wait-hint missing (route didn't force it visible)`);
  if (result.dropRect && result.controlRect && !result.dropAboveControl) {
    failures.push(`DROP compact bar overlaps control bar: drop.bottom=${result.dropRect.bottom} control.top=${result.controlRect.top}`);
  }
  if (result.waitHintRect && result.controlRect && !result.waitHintAboveControl) {
    failures.push(`wait-hint overlaps control bar: hint.bottom=${result.waitHintRect.bottom} control.top=${result.controlRect.top}`);
  }
  if (result.retryCount < 3) {
    failures.push(`expected 3+ RETRY buttons in 4-up grid, found ${result.retryCount}`);
  }
  for (const rep of result.retryReports) {
    if (!rep.visibleInTile) failures.push(`${rep.id} escapes its tile`);
    if (!rep.visibleInViewport) failures.push(`${rep.id} not fully inside viewport (rect=${JSON.stringify(rep.rect)})`);
  }
  return { vp, result, failures };
}

async function main() {
  await waitForServer(SMOKE_URL).catch((err) => {
    console.error(`[smoke-room-header-layout] dev server not reachable: ${err.message}`);
    console.error(`[smoke-room-header-layout] set SMOKE_BASE_URL or start the void-client web workflow first.`);
    process.exit(2);
  });

  const executablePath = findChromium();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  let anyFailed = false;
  try {
    for (const vp of VIEWPORTS) {
      const { failures } = await runViewport(browser, vp);
      if (failures.length === 0) {
        console.log(`PASS  ${vp.name}`);
      } else {
        anyFailed = true;
        console.log(`FAIL  ${vp.name}`);
        for (const f of failures) console.log(`        - ${f}`);
      }
    }
  } finally {
    await browser.close();
  }

  if (anyFailed) {
    console.log("\nOne or more viewports regressed. File each regression as a separate ticket per task #519.");
    process.exit(1);
  }
  console.log("\nAll viewports passed every layout invariant from task #519.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
