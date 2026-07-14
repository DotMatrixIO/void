// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge the Nix-store-provided Playwright browsers into the revision
// paths the installed Playwright version expects under
// ~/.cache/ms-playwright. On Replit's NixOS container, `playwright
// install` downloads browsers that cannot run (they miss ~20 system
// shared libraries not on the loader path), so every spec fails
// instantly with "Executable doesn't exist". The Nix store, however,
// ships patched browser builds — at a slightly older revision than the
// installed Playwright client wants. Minor revision skew is fine for
// layout/DOM specs, so we symlink the Nix builds into the expected
// revision directories.
//
// Runs as Playwright globalSetup (see playwright.config.ts) so the
// bridge is re-applied automatically on every suite invocation and
// survives environment restarts. Idempotent: existing valid bridges
// are left untouched; dangling ones are rebuilt.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function log(msg) {
  console.log(`[bridge-playwright-browsers] ${msg}`);
}

// A missing REQUIRED browser must abort the run (globalSetup throwing
// makes `playwright test` exit non-zero) instead of letting every spec
// die with "Executable doesn't exist" — or worse, letting a filtered
// run pass having executed nothing. Optional pieces (ffmpeg, headed
// chromium) stay warnings.
class BridgeError extends Error {
  constructor(missing, hint) {
    super(
      `[bridge-playwright-browsers] REQUIRED browser cannot be bridged: ${missing}.\n` +
        `${hint}\n` +
        `The Playwright suite cannot run without it — failing loudly instead of ` +
        `letting every spec die with "Executable doesn't exist".`,
    );
    this.name = "BridgeError";
  }
}

// Derive the set of required browser engines from the Playwright config
// actually in force (globalSetup receives it), so the required list can
// never drift behind the projects: if a future project starts using
// firefox, firefox automatically becomes required.
function requiredEnginesFromConfig(config) {
  const engines = new Set();
  for (const p of config?.projects ?? []) {
    engines.add(p.use?.browserName ?? p.use?.defaultBrowserType ?? "chromium");
  }
  // No config (direct CLI invocation) — assume the canonical pair.
  if (engines.size === 0) {
    engines.add("chromium");
    engines.add("webkit");
  }
  return engines;
}

function findNixBrowsersDir() {
  // Prefer an explicit override, then scan the Nix store for the
  // multi-browser playwright-browsers derivation (the one that contains
  // a chromium_headless_shell-* and a webkit-* directory).
  const override = process.env.PLAYWRIGHT_NIX_BROWSERS_DIR;
  const candidates = override
    ? [override]
    : fs
        .readdirSync("/nix/store")
        .filter((n) => n.endsWith("-playwright-browsers"))
        .map((n) => path.join("/nix/store", n));
  for (const dir of candidates) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    const hasShell = entries.some((e) => e.startsWith("chromium_headless_shell-"));
    const hasWebkit = entries.some((e) => e.startsWith("webkit-"));
    if (hasShell && hasWebkit) return dir;
  }
  return null;
}

function expectedRevisions() {
  // Resolve browsers.json from the playwright-core actually installed
  // for this package, so the bridge tracks Playwright upgrades.
  // playwright-core is a transitive dep (@playwright/test -> playwright
  // -> playwright-core) not hoisted next to this package, so walk the
  // dependency chain with nested createRequire.
  // browsers.json is not in playwright-core's "exports" map, so read it
  // from disk next to the resolved entrypoint instead of require()ing it.
  const requireFromTest = createRequire(require.resolve("@playwright/test"));
  const requireFromPw = createRequire(requireFromTest.resolve("playwright"));
  const coreEntry = requireFromPw.resolve("playwright-core");
  const browsersJsonPath = path.join(path.dirname(coreEntry), "browsers.json");
  const browsersJson = JSON.parse(fs.readFileSync(browsersJsonPath, "utf8"));
  const rev = {};
  for (const b of browsersJson.browsers) rev[b.name] = b.revision;
  return rev;
}

function newestRevisionDir(nixDir, prefix) {
  const matches = fs
    .readdirSync(nixDir)
    .filter((e) => e.startsWith(prefix + "-"))
    .sort((a, b) => Number(a.split("-").pop()) - Number(b.split("-").pop()));
  return matches.length ? path.join(nixDir, matches[matches.length - 1]) : null;
}

function ensureSymlink(target, linkPath) {
  try {
    const existing = fs.readlinkSync(linkPath);
    if (existing === target && fs.existsSync(linkPath)) return false;
    fs.rmSync(linkPath, { recursive: true, force: true });
  } catch {
    // linkPath absent or not a symlink
    if (fs.existsSync(linkPath)) return false; // real dir already present — leave it
  }
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath);
  return true;
}

export default function bridgePlaywrightBrowsers(config) {
  const required = requiredEnginesFromConfig(config);
  // Mirror Playwright's own registry-directory resolution: explicit
  // PLAYWRIGHT_BROWSERS_PATH wins, then XDG_CACHE_HOME (set to
  // <workspace>/.cache on Replit), then ~/.cache.
  const cacheDir =
    process.env.PLAYWRIGHT_BROWSERS_PATH &&
    process.env.PLAYWRIGHT_BROWSERS_PATH !== "0"
      ? process.env.PLAYWRIGHT_BROWSERS_PATH
      : path.join(
          process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
          "ms-playwright",
        );

  const rev = expectedRevisions();
  const nixDir = findNixBrowsersDir();
  if (!nixDir) {
    // Without the derivation nothing REQUIRED can be bridged. If the
    // executables already exist in the cache (e.g. bridged in a prior
    // session and the store path was since GC'd but symlinks resolve),
    // the verification below still passes; otherwise it throws.
    log("WARNING: no playwright-browsers derivation found in /nix/store — cannot bridge.");
    verifyRequiredExecutables(required, rev, cacheDir);
    return;
  }
  log(`Nix browsers: ${nixDir}`);
  fs.mkdirSync(cacheDir, { recursive: true });

  // ── chromium-headless-shell ─────────────────────────────────────────
  // Layout differs across revisions: the Nix build (e.g. 1169) uses
  // chrome-linux/headless_shell, while newer revisions (e.g. 1223)
  // expect chrome-headless-shell-linux64/chrome-headless-shell. Build a
  // real directory, symlink every file in, and alias the binary.
  {
    const want = rev["chromium-headless-shell"];
    const dest = path.join(cacheDir, `chromium_headless_shell-${want}`);
    const src = newestRevisionDir(nixDir, "chromium_headless_shell");
    if (!src) {
      if (required.has("chromium")) {
        throw new BridgeError(
          `chromium-headless-shell (revision ${want})`,
          `No chromium_headless_shell-* directory in ${nixDir}. ` +
            `Check the playwright-browsers Nix derivation, or set ` +
            `PLAYWRIGHT_NIX_BROWSERS_DIR to a store path that contains one.`,
        );
      }
      log("WARNING: no chromium_headless_shell in Nix derivation.");
    } else {
      const srcBinDir = path.join(src, "chrome-linux");
      const destBinDir = path.join(dest, "chrome-headless-shell-linux64");
      const destBin = path.join(destBinDir, "chrome-headless-shell");
      if (!fs.existsSync(destBin)) {
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(destBinDir, { recursive: true });
        for (const f of fs.readdirSync(srcBinDir)) {
          fs.symlinkSync(path.join(srcBinDir, f), path.join(destBinDir, f));
        }
        fs.symlinkSync(path.join(srcBinDir, "headless_shell"), destBin);
        log(`Bridged chromium_headless_shell-${want} <- ${src}`);
      }
    }
  }

  // ── chromium (headed layout; some launches resolve it) ─────────────
  {
    const want = rev["chromium"];
    const src = newestRevisionDir(nixDir, "chromium");
    // newestRevisionDir("chromium") could match chromium_headless_shell;
    // filter to exact "chromium-<n>" dirs.
    const exact = fs
      .readdirSync(nixDir)
      .filter((e) => /^chromium-\d+$/.test(e))
      .sort((a, b) => Number(a.split("-")[1]) - Number(b.split("-")[1]))
      .pop();
    if (exact) {
      const changed = ensureSymlink(path.join(nixDir, exact), path.join(cacheDir, `chromium-${want}`));
      if (changed) log(`Bridged chromium-${want} <- ${exact}`);
    } else if (!src) {
      log("WARNING: no chromium in Nix derivation.");
    }
  }

  // ── webkit ──────────────────────────────────────────────────────────
  // Layout matches across revisions (pw_run.sh entrypoint) — direct link.
  {
    const want = rev["webkit"];
    const src = newestRevisionDir(nixDir, "webkit");
    if (!src) {
      if (required.has("webkit")) {
        throw new BridgeError(
          `webkit (revision ${want})`,
          `No webkit-* directory in ${nixDir}. ` +
            `Check the playwright-browsers Nix derivation, or set ` +
            `PLAYWRIGHT_NIX_BROWSERS_DIR to a store path that contains one.`,
        );
      }
      log("WARNING: no webkit in Nix derivation.");
    } else {
      const changed = ensureSymlink(src, path.join(cacheDir, `webkit-${want}`));
      if (changed) log(`Bridged webkit-${want} <- ${src}`);
      setWebkitGstEnv(src);
    }
  }

  // ── ffmpeg ──────────────────────────────────────────────────────────
  {
    const want = rev["ffmpeg"];
    const src = newestRevisionDir(nixDir, "ffmpeg");
    if (src) {
      const changed = ensureSymlink(src, path.join(cacheDir, `ffmpeg-${want}`));
      if (changed) log(`Bridged ffmpeg-${want} <- ${src}`);
    }
  }

  // Final gate: the bridge may have "succeeded" while producing dangling
  // symlinks (Nix store path GC'd) or a layout the installed Playwright
  // no longer expects. Resolve each REQUIRED engine's executable and
  // throw if it does not actually exist on disk.
  verifyRequiredExecutables(required, rev, cacheDir);
}

// Executable locations per engine, matching Playwright's registry layout.
// fs.existsSync follows symlinks, so a dangling bridge fails here too.
function verifyRequiredExecutables(required, rev, cacheDir) {
  const checks = {
    chromium: {
      exe: path.join(
        cacheDir,
        `chromium_headless_shell-${rev["chromium-headless-shell"]}`,
        "chrome-headless-shell-linux64",
        "chrome-headless-shell",
      ),
      hint:
        "The chromium headless shell bridge is missing or dangling. " +
        "Re-run `node scripts/bridge-playwright-browsers.mjs` after checking the " +
        "playwright-browsers Nix derivation (PLAYWRIGHT_NIX_BROWSERS_DIR overrides the scan).",
    },
    webkit: {
      exe: path.join(cacheDir, `webkit-${rev["webkit"]}`, "pw_run.sh"),
      hint:
        "The webkit bridge is missing or dangling. " +
        "Re-run `node scripts/bridge-playwright-browsers.mjs` after checking the " +
        "playwright-browsers Nix derivation (PLAYWRIGHT_NIX_BROWSERS_DIR overrides the scan).",
    },
    // Firefox is never bridged from Nix (the derivation does not ship it);
    // it only becomes required when a firefox project is enabled
    // (PLAYWRIGHT_FIREFOX=1), and is provided by `playwright install firefox`.
    firefox: {
      exe: path.join(cacheDir, `firefox-${rev["firefox"]}`, "firefox", "firefox"),
      hint: "Run `pnpm --filter @workspace/void-client exec playwright install firefox`.",
    },
  };
  for (const engine of required) {
    const check = checks[engine];
    if (!check) continue;
    if (!fs.existsSync(check.exe)) {
      throw new BridgeError(`${engine} (expected executable: ${check.exe})`, check.hint);
    }
    log(`Verified ${engine}: ${check.exe}`);
  }
}

// The Nix WebKit build resolves its shared libraries via RPATH, but
// GStreamer discovers PLUGINS at runtime via GST_PLUGIN_SYSTEM_PATH_1_0 —
// which nothing sets in this container. Without it, WPEWebProcess cannot
// create any media element (autoaudiosink etc.) and the whole web process
// exits the moment a page attaches a MediaStream to a <video>/<audio>
// element — every spec touching the in-call UI dies with "Page crashed".
// Derive the correct plugin dirs from the WebKit binary's own dependency
// closure (ldd) so the plugin versions always match the linked
// libgstreamer, and export them into process.env here in globalSetup —
// Playwright's worker/browser processes inherit the runner's env.
function setWebkitGstEnv(nixWebkitDir) {
  if (process.env.GST_PLUGIN_SYSTEM_PATH_1_0) return; // respect explicit env
  try {
    const { execFileSync } = require("node:child_process");
    // pw_run.sh execs minibrowser-wpe/bin/MiniBrowser (a Nix wrapper) —
    // resolve the real ELF next to it.
    const binDir = path.join(fs.realpathSync(nixWebkitDir), "minibrowser-wpe", "bin");
    const elf = fs
      .readdirSync(binDir)
      .map((f) => path.join(binDir, f))
      .find((f) => /WPEWebProcess$|\.MiniBrowser-wrapped$/.test(f));
    if (!elf) return;
    const ldd = execFileSync("ldd", [elf], { encoding: "utf8" });
    const storeDirs = new Set(
      [...ldd.matchAll(/=> (\/nix\/store\/[^/]+)\//g)].map((m) => m[1]),
    );
    const gstPkgs = [...storeDirs].filter((d) =>
      /-(gstreamer|gst-plugins-base|gst-plugins-bad)-[\d.]+$/.test(d),
    );
    if (gstPkgs.length === 0) return;
    // gst-plugins-good is not linked by WebKit (it is pure plugins) but
    // provides autoaudiosink/pulse — find the store copy matching the
    // linked gstreamer version.
    const gstVer = (gstPkgs
      .find((d) => /-gstreamer-[\d.]+$/.test(d)) ?? "")
      .match(/-gstreamer-([\d.]+)$/)?.[1];
    if (gstVer) {
      const good = fs
        .readdirSync("/nix/store")
        .find(
          (n) =>
            n.endsWith(`-gst-plugins-good-${gstVer}`) &&
            fs.existsSync(path.join("/nix/store", n, "lib", "gstreamer-1.0")),
        );
      if (good) gstPkgs.push(path.join("/nix/store", good));
    }
    const pluginDirs = gstPkgs
      .map((d) => path.join(d, "lib", "gstreamer-1.0"))
      .filter((d) => fs.existsSync(d));
    if (pluginDirs.length === 0) return;
    process.env.GST_PLUGIN_SYSTEM_PATH_1_0 = pluginDirs.join(":");
    // The registry-scanner fork can die silently in this sandbox; scan
    // in-process instead.
    process.env.GST_REGISTRY_FORK = process.env.GST_REGISTRY_FORK ?? "no";
    log(`WebKit GStreamer plugins: ${pluginDirs.length} dirs (gst ${gstVer ?? "?"})`);
  } catch (err) {
    log(`WARNING: could not derive GStreamer plugin path: ${err.message}`);
  }
}

// Allow running directly: `node scripts/bridge-playwright-browsers.mjs`
if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  bridgePlaywrightBrowsers();
}
