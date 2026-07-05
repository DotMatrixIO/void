#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * gen-demo-posters.mjs
 *
 * Regenerates the click-to-play POSTER images for the landing-page demo
 * videos from the live video apps. These posters are the still frames shown
 * in `DemoVideoEmbed` before a viewer clicks play (and the `<video>` poster
 * attribute on the MP4 fallback). The interactive playback itself is the
 * sandboxed iframe pointing at the live video app — so capturing the poster
 * straight from that same live app keeps the thumbnail in lockstep with what
 * actually plays.
 *
 * Why a script (not a hand-captured screenshot):
 *   The demo videos are React/Framer-Motion/WebGL animations that get edited
 *   from time to time (scene timing, copy, shaders). A hand-captured PNG
 *   silently drifts out of date the moment a scene changes. Treating the
 *   poster as a build artifact — re-runnable on demand — fixes that. When the
 *   videos change, re-run this script and commit the refreshed PNGs.
 *
 * What it does, per video:
 *   1. Spawns a dedicated `vite dev` for that video artifact on an isolated
 *      port (BASE_PATH=/ so the app mounts at the root), so it never collides
 *      with the standing dev workflows.
 *   2. Waits for the dev server to come up.
 *   3. Launches headless Chromium via puppeteer-core at a 1280x720 viewport
 *      (exactly 16:9 — the video stage fills it with no letterbox bars),
 *      navigates to `/`, lets the scene player run to the chosen
 *      `captureAtMs` moment, and screenshots the viewport as a PNG.
 *   4. Overwrites `public/<name>-demo-poster.png`.
 *
 * Scope:
 *   This regenerates POSTERS only. It does NOT re-export the MP4 fallbacks
 *   (`public/biometric-demo.mp4`) or the FFmpeg drift reference
 *   (`public/biometric-demo-poster-ref.png`) — those belong to the separate
 *   MP4 re-export flow (see check-biometric-poster-drift.mjs).
 *
 * Run via:
 *   pnpm --filter @workspace/void-client run gen:demo-posters
 *
 * Capture one video only:
 *   POSTER_ONLY=biometric pnpm --filter @workspace/void-client run gen:demo-posters
 *
 * Override a capture timestamp (ms into the looping video):
 *   BIOMETRIC_AT_MS=12300 \
 *     pnpm --filter @workspace/void-client run gen:demo-posters
 *
 * Chromium discovery mirrors gen-still-poster.mjs: PUPPETEER_EXECUTABLE_PATH,
 * then `which`, then the Nix-store playwright-browsers-chromium binary.
 */

import { spawn, execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dir = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dir, "..");
const ARTIFACTS_ROOT = resolve(CLIENT_ROOT, "..");
const PUBLIC_DIR = resolve(CLIENT_ROOT, "public");

// Each demo video gets one representative poster frame. `captureAtMs` is the
// elapsed time into the looping video at which the still is grabbed — chosen
// to land on a settled, legible moment well inside a scene (not on a
// scene-transition boundary). Bump these if a scene re-edit shifts the beat.
const VIDEOS = [
  {
    name: "biometric",
    pkg: "biometric-demo-video",
    port: Number(process.env.BIOMETRIC_PORT || 24471),
    // ~1.3s into the "caption1" thesis card, with scan remnants still visible.
    captureAtMs: Number(process.env.BIOMETRIC_AT_MS || 12300),
    out: "biometric-demo-poster.png",
  },
];

const VIEWPORT = { width: 1280, height: 720 }; // 16:9 — fills the locked stage

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
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      return candidates[0];
    }
  }

  throw new Error(
    "Could not locate a Chromium executable. Set PUPPETEER_EXECUTABLE_PATH " +
      "to the absolute path of a Chromium / Chrome binary and re-run.",
  );
}

async function waitForServer(url, child, timeoutMs = 30_000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    // vite.config pins strictPort, so a port clash (or any crash) makes the
    // child exit. Bail loudly instead of silently capturing from whatever
    // stale server happens to hold the port — that is exactly how a blank
    // poster gets written.
    if (child && child.__exited) {
      throw new Error(
        `vite for ${url} exited before becoming ready (code ${child.exitCode}). ` +
          "The port is likely already in use by another process.",
      );
    }
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

function spawnViteDev(video) {
  const artifactDir = resolve(ARTIFACTS_ROOT, video.pkg);
  const viteBin = resolve(artifactDir, "node_modules", ".bin", "vite");
  if (!existsSync(viteBin)) {
    throw new Error(`vite binary not found for ${video.pkg}: ${viteBin}`);
  }

  const env = {
    ...process.env,
    PORT: String(video.port),
    BASE_PATH: "/",
    NODE_ENV: "development",
  };
  // Cartographer/dev-banner are gated on REPL_ID being defined; delete it so
  // a one-shot capture does not pull in those plugins (an empty string still
  // counts as defined).
  delete env.REPL_ID;

  const args = [
    "--config",
    "vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(video.port),
  ];

  const child = spawn(viteBin, args, {
    cwd: artifactDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.__exited = false;
  child.on("exit", () => {
    child.__exited = true;
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${video.name} vite] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${video.name} vite] ${d}`));
  return child;
}

async function killVite(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function capture(browser, video) {
  const page = await browser.newPage();
  // deviceScaleFactor: 1 keeps the PNG's pixel dimensions exactly 1280x720.
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });

  const url = `http://127.0.0.1:${video.port}/`;
  console.log(
    `→ ${video.name}: ${url} — capturing at t=${video.captureAtMs}ms`,
  );
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });

  // Confirm React actually mounted before we start the capture clock. Without
  // this, a still-booting (or reloading) page would let the timer run against
  // a blank document and write an empty poster.
  await page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      return !!root && root.children.length > 0;
    },
    { timeout: 20_000 },
  );

  // Let the scene player advance to the chosen moment. The player auto-hides
  // its controls after a couple seconds, so by 12s+ the frame is clean chrome.
  await new Promise((r) => setTimeout(r, video.captureAtMs));

  const outPath = resolve(PUBLIC_DIR, video.out);
  await page.screenshot({
    path: outPath,
    type: "png",
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    captureBeyondViewport: false,
  });
  await page.close();
  console.log(`✓ wrote ${outPath}`);
}

async function main() {
  const only = process.env.POSTER_ONLY;
  const targets = only
    ? VIDEOS.filter((v) => v.name === only)
    : VIDEOS;
  if (only && targets.length === 0) {
    throw new Error(
      `POSTER_ONLY="${only}" matched no video (expected: ${VIDEOS.map((v) => v.name).join(", ")}).`,
    );
  }

  const chromium = findChromium();
  console.log(`✓ chromium: ${chromium}`);

  const browser = await puppeteer.launch({
    executablePath: chromium,
    headless: true,
    // --no-sandbox is required for the Nix-packaged Chromium in the Replit
    // container. autoplay-policy lets the muted scene videos start without a
    // gesture. swiftshader gives the WebGL GoldCanvas a software GL backend.
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--autoplay-policy=no-user-gesture-required",
      "--enable-unsafe-swiftshader",
    ],
  });

  let exitCode = 0;
  try {
    for (const video of targets) {
      const vite = spawnViteDev(video);
      try {
        await waitForServer(`http://127.0.0.1:${video.port}/`, vite);
        console.log(`✓ ${video.name} vite ready on :${video.port}`);
        await capture(browser, video);
      } finally {
        await killVite(vite);
      }
    }
  } catch (err) {
    console.error("✗ demo-poster generation failed:", err);
    exitCode = 1;
  } finally {
    try {
      await browser.close();
    } catch {
      /* noop */
    }
  }
  process.exit(exitCode);
}

main();
