#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-still-poster.mjs
 *
 * Regenerates the editorial hero JPEGs that ship with the landing page from
 * the live `/still/:variant` route in `src/pages/StillPoster.tsx`.
 *
 * Why this exists:
 *   The hero / social JPEGs render the actual `RoomPage` UI inside a fixed
 *   1600x900 (hero) and 1200x630 (social) frame. If `RoomPage` changes
 *   (header layout, video grid, control bar, expiry pill, etc.), the
 *   captured JPEGs silently drift out of sync with the running app and the
 *   landing page ends up showing a stale screenshot. Treating the JPEGs as
 *   a build artifact — not a hand-captured screenshot — fixes that.
 *
 * What it does:
 *   1. Spawns a dedicated `vite dev` process for `@workspace/void-client`
 *      on an isolated port so it does not collide with the main dev
 *      workflow.
 *   2. Waits for the dev server to come up.
 *   3. Launches headless Chromium via puppeteer-core, navigates to
 *      `/still/social` (1200x630), waits for the snapshot to render,
 *      and captures a JPEG of the canvas at the canonical pixel size.
 *   4. Overwrites:
 *        public/og/this-room-will-not-exist-social.jpg
 *
 *   The `hero` variant was retired in Task #588 when the landing-page
 *   hero swapped from the auto-regenerated room screenshot to a hand-
 *   chosen self-portrait. The social OG card is still a screenshot of
 *   the live RoomPage and is regenerated here.
 *
 * Run via:
 *   pnpm --filter @workspace/void-client run gen:still-poster
 *
 * Chromium discovery:
 *   The script honours `PUPPETEER_EXECUTABLE_PATH` first, then falls back to
 *   `which chromium` / `which chromium-browser` / `which google-chrome`,
 *   then searches Nix store paths for the playwright-browsers-chromium
 *   binary that Replit images ship with. This keeps the script working in
 *   the Replit container without bundling Chromium.
 */

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(__dir, "..");
const publicDir = resolve(clientRoot, "public");
const outDir = resolve(publicDir, "og");

// Both variants are described inline so this script is self-documenting and
// the canonical sizes do not have to be duplicated from `StillPoster.tsx`.
// They MUST stay in lockstep with the `dimensions` switch in
// `StillPoster.tsx` — the React page reads `useRoute("/still/:variant")` and
// renders the matching pixel size, and the screenshot must match that
// exactly so the captured JPEG has 1:1 device pixels.
const VARIANTS = [
  {
    name: "social",
    width: 1200,
    height: 630,
    out: "this-room-will-not-exist-social.jpg",
  },
];

// Pick a port that does not collide with the standard void-client dev
// workflow (24363) or the api-server (8080). 24463 is well outside the
// range either of those services touch and inside the unprivileged range.
const DEV_PORT = Number(process.env.STILL_POSTER_PORT || 24463);

function findChromium() {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;

  for (const cmd of ["chromium", "chromium-browser", "google-chrome", "chrome"]) {
    try {
      const path = execFileSync("which", [cmd], { encoding: "utf8" }).trim();
      if (path && existsSync(path)) return path;
    } catch {
      /* not found, try next */
    }
  }

  // Replit's Nix images ship a playwright-browsers-chromium derivation that
  // contains a usable headless Chrome binary. The store path is content-
  // addressed so we cannot hardcode it; scan for the newest match instead.
  const nixStore = "/nix/store";
  if (existsSync(nixStore)) {
    const candidates = readdirSync(nixStore)
      .filter((d) => d.endsWith("-playwright-browsers-chromium"))
      .map((d) => resolve(nixStore, d))
      .flatMap((dir) => {
        try {
          return readdirSync(dir)
            .filter((sub) => sub.startsWith("chromium-"))
            .map((sub) => resolve(dir, sub, "chrome-linux", "chrome"));
        } catch {
          return [];
        }
      })
      .filter((p) => existsSync(p));
    if (candidates.length > 0) {
      // Pick the newest by mtime so updated playwright derivations win.
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      return candidates[0];
    }
  }

  throw new Error(
    "Could not locate a Chromium executable. Set PUPPETEER_EXECUTABLE_PATH " +
      "to the absolute path of a Chromium / Chrome binary and re-run.",
  );
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 304) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Dev server at ${url} did not become ready within ${timeoutMs}ms` +
      (lastErr ? `: ${lastErr.message}` : ""),
  );
}

async function spawnViteDev() {
  // Spawn vite directly (not via pnpm) so we can SIGTERM it cleanly without
  // leaving an orphan child. We pin BASE_PATH=/ to match the production
  // artifact mount and PORT to our isolated dev port.
  const env = {
    ...process.env,
    PORT: String(DEV_PORT),
    BASE_PATH: "/",
    NODE_ENV: "development",
  };
  // Suppress the cartographer plugin even when REPL_ID is set — it pokes
  // sibling repos under `..` and just slows down a one-shot capture.
  // `vite.config.ts` gates cartographer on `REPL_ID !== undefined`, so we
  // must DELETE the var rather than blanking it; an empty string still
  // counts as defined and would re-enable the plugin.
  delete env.REPL_ID;

  const viteBin = resolve(clientRoot, "node_modules", ".bin", "vite");
  const args = ["--config", "vite.config.ts", "--host", "127.0.0.1", "--port", String(DEV_PORT)];

  const child = spawn(viteBin, args, {
    cwd: clientRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));

  return child;
}

async function captureVariant(browser, variant) {
  const page = await browser.newPage();
  // deviceScaleFactor: 1 keeps the captured JPEG's pixel dimensions identical
  // to the variant's nominal canvas size — Facebook / Twitter / Slack all
  // expect literal 1200x630 for the social card and the landing hero is
  // sized to 1600x900 in CSS.
  await page.setViewport({
    width: variant.width,
    height: variant.height,
    deviceScaleFactor: 1,
  });

  const url = `http://127.0.0.1:${DEV_PORT}/still/${variant.name}`;
  console.log(`→ capturing ${variant.name} @ ${variant.width}x${variant.height}: ${url}`);

  await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });

  // Wait until the React tree has actually painted the StillPoster canvas.
  // The component renders a `data-poster-canvas` wrapper around the room
  // frame + caption panel.
  await page.waitForSelector("[data-poster-canvas]", { timeout: 15_000 });

  // Give RoomPage a beat to mount its <video> tracks (captureStream from the
  // synthetic peer canvases) and for any first-frame paint to land. The
  // peer streams are static — they draw once then captureStream — so a
  // short, fixed delay is enough; we don't need to poll for video readiness.
  await new Promise((r) => setTimeout(r, 1500));

  const outPath = resolve(outDir, variant.out);
  // Clip to the poster canvas itself rather than the whole viewport so
  // any scrollbar / dev banner pixels never leak into the JPEG.
  const handle = await page.$("[data-poster-canvas]");
  if (!handle) {
    throw new Error("Poster canvas element not found after page load.");
  }
  await handle.screenshot({
    path: outPath,
    type: "jpeg",
    quality: 90,
    captureBeyondViewport: false,
    omitBackground: false,
  });
  await page.close();
  console.log(`✓ wrote ${outPath}`);
}

async function main() {
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }

  const chromium = findChromium();
  console.log(`✓ chromium: ${chromium}`);

  const vite = await spawnViteDev();
  let browser;
  let exitCode = 0;
  try {
    await waitForServer(`http://127.0.0.1:${DEV_PORT}/`);
    console.log(`✓ vite dev ready on :${DEV_PORT}`);

    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      // --no-sandbox is required inside the Replit container because the
      // Nix-packaged Chromium does not have a setuid sandbox helper next to
      // the playwright-browsers-chromium binary. Headless capture of a
      // localhost dev page is a low-risk context for this flag.
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--hide-scrollbars",
      ],
    });

    for (const variant of VARIANTS) {
      await captureVariant(browser, variant);
    }
  } catch (err) {
    console.error("✗ still-poster generation failed:", err);
    exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* noop */
      }
    }
    vite.kill("SIGTERM");
    // Give vite a moment to shut down cleanly; SIGKILL if it lingers.
    await new Promise((r) => setTimeout(r, 500));
    if (vite.exitCode === null) {
      vite.kill("SIGKILL");
    }
  }
  process.exit(exitCode);
}

main();
