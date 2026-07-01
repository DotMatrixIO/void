# AudioContext / AudioWorklet leak verification (Task #305)

Companion to Task #283 (two-stage `closeAudioContext` teardown). Unit
tests in `artifacts/void-client/src/lib/sounds.test.ts` and
`artifacts/void-client/src/pages/PreviewGate.test.tsx` cover the call
graph. This document covers the **spec-vs-browser** half: confirming
in real browser engines that no `AudioContext`, audio output stream,
or `AudioWorklet` global-scope worker survives the same two-stage
teardown shape we ship.

The Web Audio spec says closing an `AudioContext` releases its system
resources and terminates any associated `AudioWorklet` global scope.
We trust the spec for unit tests, but production users are on
Chromium, Gecko, and WebKit builds that have historically diverged
here, so this verification is the source of truth for "did the engine
actually go away."

## What we are checking

After teardown, in each browser engine, the page should have:

1. Zero live `AudioContext` instances (`alive.size === 0`).
2. `created === closed` for the lifetime of the page (no leaked
   constructors that never reached `close()`).
3. Zero live `AudioWorkletNode` instances; closing the context
   terminates the worklet global scope per spec.

## Automated harness (Playwright)

`tools/audio-leak-verify/` ships a Playwright harness that loads a
self-contained HTML page mirroring the two-stage teardown pattern from
`artifacts/void-client/src/lib/sounds.ts`:

- Patches `window.AudioContext` and `window.AudioWorkletNode` via
  `addInitScript` so it can count create/close events from the Node
  side without changing real client code.
- Creates an `AudioContext`, registers a real `AudioWorklet`
  processor, schedules an oscillator (so the
  "stop-scheduled-sources-before-close" stage actually has work to do
  — Task #283 regression bait), then runs the same two-stage teardown
  the production code uses.
- Repeats `ITERATIONS = 5` create/teardown cycles for **each of the
  four teardown paths** (BURN, leave, expire, PreviewGate unmount) on
  every browser, to catch drip leaks (1 alive context after 5
  teardowns is still a leak). Counts are cumulative across the four
  paths within one browser launch, so `created === closed` is asserted
  for the whole page lifetime, not just one path.
- Asserts `aliveCount === 0`, `workletsAlive === 0`, and
  `created === closed` after a 500 ms post-teardown settle, per path.

Run it:

```bash
cd tools/audio-leak-verify
pnpm install --ignore-workspace
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 npx playwright install chromium firefox webkit
PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node verify.mjs
# Linux/Replit host: WebKit cannot run (see caveat). Skip it with:
SKIP_WEBKIT=1 PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 node verify.mjs
```

Results are written to `tools/audio-leak-verify/results.json` as one
record per `(browser × teardown path)`. Exit code is non-zero only if
a `(browser × path)` that *did* run shows a leak; browsers that fail
to launch on a given host (see WebKit caveat below) record a blocked
row per path and do not fail the run, so the four WebKit/Safari rows
must be filled from a real macOS Safari pass.

## Findings

### Browser × teardown-path matrix

This is the per-path baseline future maintainers diff against: one row
per **browser × teardown path** (3 engines × 4 paths = 12 rows). Each
filled row is a real harness execution of `ITERATIONS = 5`
create/teardown cycles.

**Important — why the engine-level numbers are path-independent:** all
four production teardown paths (BURN, leave, expire, PreviewGate
unmount) converge on the single two-stage `closeAudioContext()` in
`artifacts/void-client/src/lib/sounds.ts` (L328). It is reached from
exactly two call sites — `PreviewGate.tsx` (unmount) and
`useRoomConnection.ts` (BURN / leave / expire all flow through the
hook's teardown). There is one code path that frees the `AudioContext`
and terminates the `AudioWorklet` global scope, so the automated
harness exercises that shared teardown once **per path label** (the
`Created`/`Closed` counters below are cumulative across the four paths
within a single browser launch — they stay equal throughout, which is
the drip-leak check). The distinct *UI triggers* per path — clicking
burn, navigating away, the expiry timer firing, dismissing the preview
— are not driven by the headless harness (they require user gestures
and feature toggles that produce no AudioContext in a headless run);
those are covered by the real-desktop manual DevTools checklist below
and tracked for a real Chrome/Firefox/Safari operator pass.

| Date (UTC) | Browser + version | OS | Teardown path | Cycles | Created==Closed | Alive contexts | Alive worklets | Verdict |
|------------|-------------------|----|---------------|--------|-----------------|----------------|----------------|---------|
| 2026-06-11 | Chromium 141.0.7390.37 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | BURN               | 5 | ✓ (5/5)   | 0 | 0 | PASS |
| 2026-06-11 | Chromium 141.0.7390.37 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | leave              | 5 | ✓ (10/10) | 0 | 0 | PASS |
| 2026-06-11 | Chromium 141.0.7390.37 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | expire             | 5 | ✓ (15/15) | 0 | 0 | PASS |
| 2026-06-11 | Chromium 141.0.7390.37 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | PreviewGate unmount| 5 | ✓ (20/20) | 0 | 0 | PASS |
| 2026-06-11 | Firefox 142.0.1 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | BURN               | 5 | ✓ (5/5)   | 0 | 0 | PASS |
| 2026-06-11 | Firefox 142.0.1 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | leave              | 5 | ✓ (10/10) | 0 | 0 | PASS |
| 2026-06-11 | Firefox 142.0.1 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | expire             | 5 | ✓ (15/15) | 0 | 0 | PASS |
| 2026-06-11 | Firefox 142.0.1 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | PreviewGate unmount| 5 | ✓ (20/20) | 0 | 0 | PASS |
| TBD | WebKit (Playwright) / Safari — **needs macOS** | macOS TBD | BURN               | 5 | TBD | TBD | TBD | BLOCKED |
| TBD | WebKit (Playwright) / Safari — **needs macOS** | macOS TBD | leave              | 5 | TBD | TBD | TBD | BLOCKED |
| TBD | WebKit (Playwright) / Safari — **needs macOS** | macOS TBD | expire             | 5 | TBD | TBD | TBD | BLOCKED |
| TBD | WebKit (Playwright) / Safari — **needs macOS** | macOS TBD | PreviewGate unmount| 5 | TBD | TBD | TBD | BLOCKED |

The four WebKit/Safari rows are **BLOCKED in this environment** (not a
leak, not a failure): the Playwright-bundled WebKit cannot run as real
Safari on the Replit NixOS host (see "WebKit / Safari host caveat"
below), so they must be filled from a real macOS Safari pass — run
`tools/audio-leak-verify` on macOS (where the harness fills all four
WebKit rows automatically) or walk the Safari manual checklist on a
real desktop. Raw JSON for the filled rows lives in
`tools/audio-leak-verify/results.json`.

### Run history (full-run, supplemental)

Kept for trend diffing — one row per full Playwright run (5
create/teardown cycles), independent of the per-path matrix above.

| Date (UTC) | Browser + version | OS | Iterations | Created | Closed | Alive contexts | Alive worklets | Verdict | Notes |
|------------|-------------------|------|------------|---------|--------|----------------|----------------|---------|-------|
| 2026-05-03 | Chromium 130.0.6723.31 (Playwright bundled) | linux 6.14.11 (Replit NixOS, headless) | 5 | 5 | 5 | 0 | 0 | PASS | Headless Chromium refuses to load AudioWorklet modules from `blob:` URLs (aborts with "The user aborted a request"); harness uses a `data:` URL instead, see `tools/audio-leak-verify/harness.html`. |
| 2026-05-03 | Firefox 131.0 (Playwright bundled) | linux 6.14.11 (Replit NixOS, headless) | 5 | 5 | 5 | 0 | 0 | PASS | Clean run, no warnings. |
| 2026-06-11 | Chromium 141.0.7390.37 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | 20 | 20 | 20 | 0 | 0 | PASS | Re-verification on a newer engine + kernel (per-path matrix run, 4×5 cycles). `data:`-URL AudioWorklet load still required (same headless `blob:` abort as 2026-05-03). No leaked contexts/worklets at any checkpoint. |
| 2026-06-11 | Firefox 142.0.1 (Playwright bundled) | linux 6.18.34 (Replit NixOS, headless) | 20 | 20 | 20 | 0 | 0 | PASS | Re-verification on a newer engine + kernel (per-path matrix run, 4×5 cycles). Clean run, no warnings. |

## Per-browser manual fallback (devtools)

When the automated harness is not available (e.g. no Safari on the
host) or when investigating a real failure, drive each teardown path
in `RoomPage` / `PreviewGate` and check the following.

Teardown paths to exercise (each is a separate run):

- **BURN** — host clicks the burn button in `RoomPage`.
- **Leave** — guest navigates away / closes the tab mid-call.
- **Expire** — leave the room idle until the expiry timer fires.
- **PreviewGate unmount** — open `/preview`, dismiss without joining.

### Chrome / Chromium / Edge

- **chrome://media-internals → Players** tab: filter by the void-client
  tab. After teardown the row for the tab's audio output stream must
  be gone (or marked `kStopped` with no successor).
- **chrome://media-internals → Audio** tab: the tab's
  `AudioOutputController` entry should disappear. A lingering entry
  with `playing=true` is a regression.
- **DevTools → Memory → Heap snapshot**: take one before joining and
  one ~5 s after teardown. Diff for `AudioContext`,
  `AudioWorkletNode`, `AudioBuffer`. Delta should be 0; if non-zero,
  expand the retainer chain to confirm it is not held by
  `sounds.ts`, `music.ts`, `mediaPipeline.ts`, `RoomPage.tsx`, or
  `PreviewGate.tsx`.

### Firefox

- **about:webrtc**: mic / output tracks for the room must be ended.
- **about:processes**: the tab's "Media" / "Audio Decoder" utility
  process row should drop to 0% CPU and idle out. A persistently
  busy audio utility process after teardown is a regression.
- **DevTools → Memory → Take snapshot** before and after; group by
  type and confirm `AudioContext` / `AudioWorkletGlobalScope` counts
  return to baseline.

### Safari (Technology Preview if available)

- **Develop → Web Inspector → Audio** (Safari TP exposes a Web Audio
  timeline): the context's lifeline must terminate at `close()`.
- **Develop → Web Inspector → Memory → Heap Snapshot**: same
  before/after diff as Chrome.
- **Activity Monitor → coreaudiod**: should drop back to idle within
  a couple of seconds of teardown. Sustained CPU on `coreaudiod`
  attributable to the tab indicates a leaked output stream.

## WebKit / Safari host caveat

WebKit was attempted again in the 2026-06-11 per-path run and remains
unrunnable on the Replit host (all four WebKit rows recorded BLOCKED).
Two distinct host blockers have been seen: (1) on 2026-05-03 the
Playwright-bundled MiniBrowser would not launch on the NixOS host —
`libgstwayland-1.0.so.0` is built against a newer libwayland symbol
(`wl_display_create_queue_with_name`) than the one in this host's
nixpkgs channel, so the process aborts in `realloc()` during GStreamer
plugin scan; (2) the bundled WebKit binary is not even present on a
default Replit container (`playwright install` only fetched chromium +
firefox; WebKit download/run is not viable here). Either way this is a
host-environment issue, not a void issue, and the Playwright Linux
WebKit is the WPE/GTK port, not Safari. To close the four WebKit rows:

- Run the harness on macOS (where Playwright uses the system WebKit
  and this symbol mismatch does not occur), **or**
- Walk the Safari manual checklist above in real desktop Safari and
  paste the result into the table.

A clean WebKit/Safari run is the same shape as the other engines:
0 alive contexts, 0 alive worklets, `created === closed`.

## If a check fails

1. Note which teardown path and which browser.
2. From the heap snapshot, capture the retainer chain for the
   surviving object — that points directly at the module still
   holding it.
3. Cross-check `closeAudioContext` ran (it logs nothing by design;
   add a temporary `console.debug` at the top of the function and at
   the `await c.close()` line to confirm both stages executed).
4. File a follow-up referencing Task #283 and this document; do not
   "fix" by skipping the two-stage order — see the comment at
   `sounds.ts` L318–L326 for why.
