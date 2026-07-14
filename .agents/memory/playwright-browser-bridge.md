---
name: Playwright browser bridge from Nix store
description: What to do when Playwright tests fail with "Executable doesn't exist" in an isolated task environment.
---

# Playwright browser bridge from Nix store

Isolated task environments may lack the Playwright browser cache entirely
(`~workspace/.cache/ms-playwright` empty), so EVERY playwright test fails
instantly with `browserType.launch: Executable doesn't exist`. That mass
failure is environmental, not a diff regression.

**Why `playwright install` alone doesn't fix it:** the downloaded browsers
can't run — they miss ~20 system shared libs (libglib, libnss3, libX11, …)
that aren't on the loader path. Also `playwright install` needs
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` or host validation aborts it.
Scavenging libs from `/nix/store` by glob times out — the store is too big.

**How to apply:** bridge the patched Nix-store browsers into the cache paths
the installed playwright version expects. E.g. for playwright 1.60 (wants
chromium_headless_shell-1223 / webkit-2287) with Nix derivation
`/nix/store/*-playwright-browsers` holding 1169/2158:

- `ln -s <nix>/webkit-2158 $CACHE/webkit-2287` (layout matches, pw_run.sh works)
- headless shell layouts differ: 1169 uses `chrome-linux/headless_shell`,
  1223 expects `chrome-headless-shell-linux64/chrome-headless-shell` — make a
  real dir, symlink each file in, and symlink the binary under the new name.

Minor revision skew (1169 driving a 1.60 client) worked fine for layout/DOM
specs. Run individual specs with
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 PORT=5173 BASE_PATH=/` and
`--project=<one>` to fit the 120s bash timeout; full spec files across all
projects exceed it.

**Durable fix (scripted):** `artifacts/void-client/scripts/bridge-playwright-browsers.mjs`
runs as Playwright `globalSetup` — re-applies the bridge on every suite
invocation, resolving expected revisions from the installed playwright-core's
browsers.json. Cache dir resolution must honor `XDG_CACHE_HOME` (Replit sets
it to `<workspace>/.cache`), not just `~/.cache`.

**WebKit "Page crashed" on media routes:** the Nix WebKit resolves shared
libs via RPATH but GStreamer discovers plugins via
`GST_PLUGIN_SYSTEM_PATH_1_0`, which nothing sets — WPEWebProcess exits the
moment a page attaches a MediaStream to a video/audio element (autoaudiosink
missing). Fix: ldd the WebKit ELF, collect its gstreamer/gst-plugins-base/bad
store dirs, add the matching-version gst-plugins-good from /nix/store, export
the plugin path (+ `GST_REGISTRY_FORK=no`) in globalSetup — workers inherit
the env. Do NOT try running a freshly downloaded newer webkit against the Nix
libs: it dies with "stack smashing detected" (ABI mismatch).
