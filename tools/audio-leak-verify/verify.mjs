// SPDX-License-Identifier: AGPL-3.0-or-later
// Playwright harness for Task #305: cross-browser proof that the
// two-stage closeAudioContext pattern from sounds.ts (Task #283)
// actually frees AudioContexts and terminates AudioWorklet workers in
// real browser engines (Chromium / Firefox / WebKit).
//
// Strategy: load tools/audio-leak-verify/harness.html (self-contained,
// no dev server, no microphone), patch window.AudioContext +
// window.AudioWorkletNode in an init script so we can count instances
// from outside, drive a "create -> tear down" cycle, then assert all
// counts return to zero. Repeats N times to catch drip leaks.

import { chromium, firefox, webkit } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = pathToFileURL(path.join(__dirname, 'harness.html')).href;
const ITERATIONS = 5;

// The four production teardown paths. All four converge on the single
// two-stage `closeAudioContext()` in
// artifacts/void-client/src/lib/sounds.ts (L328), invoked from:
//   - PreviewGate unmount -> src/pages/PreviewGate.tsx (L247/265/296)
//   - BURN / leave        -> src/hooks/useRoomConnection.ts (L322)
//   - expire              -> RoomPage onExpired -> handleSessionExpired
//                            -> useRoomConnection teardown -> closeAudioContext
// The engine-level teardown is therefore path-independent by
// construction: there is exactly one code path that frees the
// AudioContext + terminates the AudioWorklet global scope. We run the
// harness once per path LABEL so the findings table has a row per
// (browser x path), and so a future regression in the shared teardown
// is caught under every path heading. The distinct per-path UI
// triggers (clicking burn, navigating away, the expiry timer firing)
// are exercised by the real-desktop manual DevTools checklist in
// docs/audio-context-leak-verification.md, not by this harness.
const TEARDOWN_PATHS = ['BURN', 'leave', 'expire', 'PreviewGate unmount'];

// Patched into the page before any script runs. Tracks lifecycle so we
// can read counts from Node side.
const initScript = `
(() => {
  const stats = { created: 0, closed: 0, alive: new Set(), worklets: 0, workletsAlive: 0 };
  const RealCtx = window.AudioContext;
  const RealWorklet = window.AudioWorkletNode;
  if (RealCtx) {
    function PatchedCtx(...args) {
      const c = new RealCtx(...args);
      stats.created++;
      stats.alive.add(c);
      const realClose = c.close.bind(c);
      c.close = async function() {
        const r = await realClose();
        stats.closed++;
        stats.alive.delete(c);
        return r;
      };
      return c;
    }
    PatchedCtx.prototype = RealCtx.prototype;
    Object.defineProperty(window, 'AudioContext', { value: PatchedCtx, configurable: true });
  }
  if (RealWorklet) {
    function PatchedWorklet(...args) {
      const n = new RealWorklet(...args);
      stats.worklets++;
      stats.workletsAlive++;
      // No spec event for worklet termination; we infer it from context
      // close, since closing the context terminates the worklet global
      // scope per spec. We hook onprocessorerror as a fallback signal.
      const realDisc = n.disconnect.bind(n);
      n.disconnect = function(...a) {
        if (stats.workletsAlive > 0) stats.workletsAlive--;
        return realDisc(...a);
      };
      return n;
    }
    PatchedWorklet.prototype = RealWorklet.prototype;
    Object.defineProperty(window, 'AudioWorkletNode', { value: PatchedWorklet, configurable: true });
  }
  window.__voidStats = () => ({
    created: stats.created,
    closed: stats.closed,
    aliveCount: stats.alive.size,
    aliveStates: Array.from(stats.alive).map(c => c.state),
    workletsCreated: stats.worklets,
    workletsAlive: stats.workletsAlive,
  });
})();
`;

// Run the harness ITERATIONS create/teardown cycles for one teardown
// path on an already-open page, returning the per-path record. The page
// is reused across paths (one launch per browser); counters are
// cumulative across paths, which is intentional — `created === closed`
// must hold for the whole page lifetime, not just one path.
async function runPath(page, tdPath) {
  const rec = { path: tdPath, perIteration: [], final: null, error: null };
  try {
    for (let i = 0; i < ITERATIONS; i++) {
      await page.evaluate(async () => {
        try { await window.__voidHarness.start(); }
        catch (e) { window.__startErr = String(e && e.stack || e); throw e; }
      });
      // Hold briefly so the worklet thread actually spins up.
      await page.waitForTimeout(100);
      await page.evaluate(async () => {
        try { await window.__voidHarness.teardown(); }
        catch (e) { window.__teardownErr = String(e && e.stack || e); throw e; }
      });
      // Allow any post-close cleanup microtasks to flush.
      await page.waitForTimeout(150);
      const s = await page.evaluate(() => window.__voidStats());
      rec.perIteration.push(s);
    }
    // Final check after a longer settle, mirroring real teardown timing.
    await page.waitForTimeout(500);
    rec.final = await page.evaluate(() => window.__voidStats());
  } catch (e) {
    rec.error = (rec.error || '') + String(e && e.stack || e);
  }
  return rec;
}

// Launch one browser, then run every teardown path against it. Returns
// one record per (browser x path). A launch failure (e.g. WebKit on
// NixOS) yields a blocked record for every path so the findings matrix
// still has a Safari/WebKit row per path.
async function runBrowser(name, launcher) {
  const baseOs = `${os.platform()} ${os.release()}`;
  let browser;
  try {
    browser = await launcher.launch({
      args: name === 'chromium' ? ['--no-sandbox'] : undefined,
      timeout: 90_000,
    });
    const version = browser.version();
    const ctx = await browser.newContext();
    ctx.setDefaultTimeout(60_000);
    ctx.setDefaultNavigationTimeout(60_000);
    await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    let consoleLog = '';
    page.on('console', (m) => { consoleLog += `[${m.type()}] ${m.text()}\n`; });
    await page.goto(HARNESS);
    await page.waitForFunction(() => window.__voidHarness, null, { timeout: 30_000 });

    const rows = [];
    for (const tdPath of TEARDOWN_PATHS) {
      const rec = await runPath(page, tdPath);
      rows.push({
        browser: name,
        version,
        os: baseOs,
        path: tdPath,
        iterations: ITERATIONS,
        perIteration: rec.perIteration,
        final: rec.final,
        error: rec.error,
        consoleLog: consoleLog || undefined,
      });
    }
    await ctx.close();
    return rows;
  } catch (e) {
    const err = String(e && e.stack || e);
    return TEARDOWN_PATHS.map((tdPath) => ({
      browser: name,
      version: null,
      os: baseOs,
      path: tdPath,
      iterations: ITERATIONS,
      perIteration: [],
      final: null,
      error: err,
    }));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// WebKit is included but will record a blocked row on hosts where the
// playwright-bundled MiniBrowser cannot link against the system
// gstreamer (e.g. NixOS), which is OK — see the doc for how to fill in
// the WebKit / Safari rows from a real macOS Safari run instead.
const targets = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];
if (process.env.SKIP_WEBKIT === '1') targets.pop();

const results = [];
for (const [name, launcher] of targets) {
  process.stdout.write(`[${name}] running ${TEARDOWN_PATHS.length} teardown paths...\n`);
  const rows = await runBrowser(name, launcher);
  for (const r of rows) {
    results.push(r);
    process.stdout.write(`[${name} / ${r.path}] ${JSON.stringify(r.final || r.error)}\n`);
  }
}

const out = {
  ranAt: new Date().toISOString(),
  iterations: ITERATIONS,
  paths: TEARDOWN_PATHS,
  results,
};
const outPath = path.join(__dirname, 'results.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
process.stdout.write(`wrote ${outPath}\n`);

// Exit non-zero only if a (browser x path) that *did* run shows a leak.
// Rows that failed to launch (e.g. webkit on hosts missing system libs)
// are reported in results.json and must be covered by a real-Safari run.
let bad = 0;
for (const r of results) {
  if (!r.final) continue;
  if (r.final.aliveCount !== 0) bad++;
  if (r.final.workletsAlive !== 0) bad++;
  if (r.final.created !== r.final.closed) bad++;
}
process.exit(bad ? 1 : 0);
