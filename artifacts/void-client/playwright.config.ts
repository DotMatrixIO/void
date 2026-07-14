// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from "@playwright/test";

/**
 * Task #587 — Playwright config for the in-call control-bar
 * real-viewport layout gate.
 *
 * Task #664 — Cross-browser / Tor coverage. The layout gate
 * (control-bar-layout, landscape-video, reminder-safe-zone) keeps its
 * original Chromium + WebKit viewport projects below. On top of that we
 * add a *flow* gate that exercises the core path (landing → preview gate
 * → joined-call UI → WebRTC peer-connection establishment) under THREE
 * engines — Chromium, Firefox, and WebKit — to catch engine-specific
 * regressions in the surfaces a real user touches before masked output
 * begins. Masked-output verification stays manual (see
 * `docs/cross-browser-tor-runbook.md`); it is out of headless reach.
 *
 * The two gates are kept apart with `testMatch` / `testIgnore` so the
 * layout specs never run under Firefox (their pixel thresholds were
 * tuned on Chromium/WebKit) and the flow spec runs once per engine.
 *
 * The dev server is launched on a fixed PORT so the specs can navigate
 * to `http://localhost:${PORT}/__test/joined-call` (a DEV-only route
 * registered in `src/App.tsx`, also added in #587) and to a deep-link
 * phrase hash that renders the preview gate.
 *
 * WebKit on Replit's NixOS container ships without the GTK4 system
 * libraries Playwright's host-validator checks for, but the browser
 * itself launches and renders correctly once those packages are
 * present in `replit.nix`. We set `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`
 * in the workflow command so the over-eager validator does not abort
 * the launch — the actual page renders verified by running the specs.
 * Firefox is OPT-IN. It is not on the base image and, even after
 * `playwright install firefox` provides the binary, the engine crashes
 * navigating the joined-call route on this NixOS container
 * (`page.goto: Page crashed`). So the `flow-firefox` project — and the
 * post-merge `playwright install firefox` step — only activate when the
 * environment variable `PLAYWRIGHT_FIREFOX=1` is set. The canonical run
 * (Chromium + WebKit) stays green; export `PLAYWRIGHT_FIREFOX=1` before
 * invoking the suite to exercise the Firefox engine where it works.
 */

const PORT = Number(process.env.PORT ?? 5173);
const BASE_PATH = process.env.BASE_PATH ?? "/";

// Task #1042 — the clearnet-path-indicator gate needs a dev server with a
// real `.onion` mirror baked into VITE_VOID_ONION_HOST, so the home-screen
// header renders the CLEARNET PATH badge + one-click .onion switch. The
// other projects' shared dev server deliberately leaves that env UNSET (so
// the onion affordance is inert everywhere else), so this gate runs against
// its OWN dev server on a separate port with the env present. Kept isolated
// rather than setting the env globally, which would make the footer onion
// link + other onion affordances appear in every other spec's pages.
const ONION_PORT = PORT + 100;
// A syntactically valid Tor v3 host (56 base32 [a-z2-7] chars before
// `.onion`) — the same shape src/lib/onionHost.ts validates and the value
// used by the vitest `test` script. Chromium maps this host to 127.0.0.1
// via --host-resolver-rules so the `.onion`-origin case can be exercised
// against the local dev server (window.location.hostname becomes the onion
// host, so isOnionOrigin() returns true).
const ONION_HOST =
  "voidexampleabcd234567abcd234567abcd234567abcd234567abcde.onion";

// Firefox flow project is opt-in (see header): the engine crashes on this
// container even once installed, so it only runs when explicitly enabled
// via PLAYWRIGHT_FIREFOX=1.
const RUN_FIREFOX = process.env.PLAYWRIGHT_FIREFOX === "1";

// The flow spec is the only cross-engine (incl. Firefox) suite. Layout
// specs are pinned to Chromium/WebKit, so we route by filename.
const FLOW_SPEC = /cross-engine-flow\.spec\.ts/;

// The device-cloud Safari WebRTC spec runs under its OWN config
// (playwright.devicecloud.config.ts) against a remote grid — it must never
// be picked up by the local layout projects (which only `testIgnore` the
// flow spec). Excluded from every local project here. See Task #667.
const DEVICE_CLOUD_SPEC = /safari-webrtc-devicecloud\.spec\.ts/;

// The accessibility-tree audit (executable half of the screen-reader
// hand-test runbook) drives the in-call UI and asserts AX-tree roles /
// names / focus. It is engine-agnostic structural verification, so it
// runs once under Chromium — kept off the layout projects (whose pixel
// thresholds are unrelated) and off the flow gate.
const A11Y_SPEC = /a11y-tree-audit\.spec\.ts/;

// The share-warnings visibility gate (Task #738) mounts the real
// PhraseShareModal / RoomShareSheet via the DEV-only
// `/__test/share-warnings` route and proves, with genuine browser
// layout, that the link-mangling and fragment-leak cautions are
// on-screen (not hidden by CSS or painted behind another element — gaps
// the jsdom component tests cannot see). It is engine-agnostic, so it
// runs once under Chromium and is kept off the layout projects (whose
// pixel thresholds are unrelated) and off the flow / a11y gates.
const SHARE_WARNINGS_SPEC = /share-warnings-visible\.spec\.ts/;

// The media-page content gate (media-page-content.spec.ts) navigates to
// the /media route and asserts, with genuine browser routing/layout, that
// the NO-claims refusal band and both demo embeds render — coverage the
// jsdom MediaPage component test cannot provide. It runs under its own
// chromium + webkit projects (Firefox is not installed on Replit), so it
// is kept off the layout projects (whose pixel thresholds are unrelated)
// and off the flow / a11y / share-warnings gates.
const MEDIA_SPEC = /media-page-content\.spec\.ts/;

// The payment-failure-banner gate drives the real HOST A ROOM → paywall
// WAITING flow and, with intercepted /api/paywall/* responses, proves the
// status-check failure banner + CHECK NOW button behave under real polling
// and real layout (coverage the jsdom component tests cannot give). It is
// engine-agnostic UI/network logic, so it runs once under Chromium and is
// kept off the layout / flow / a11y / share-warnings / media gates.
const PAYMENT_FAILURE_SPEC = /payment-failure-banner\.spec\.ts/;

// Task #1042 — the clearnet-path-indicator gate loads the home-screen header
// (StartScreen full-frame, via the DEV-only /__test/start-screen route) and
// proves the CLEARNET PATH badge + one-click .onion switch render together on
// clearnet, and are suppressed (positive Tor badge instead) on the .onion
// origin. It needs the onion-mirror dev server + Chromium host-resolver-rules,
// so it runs under its OWN chromium project against the ONION_PORT server and
// is kept off the layout / flow / a11y / share-warnings / media / payment
// gates (which use the env-free shared server).
const CLEARNET_PATH_SPEC = /clearnet-path-indicator\.spec\.ts/;

// Chromium needs explicit flags to feed a synthetic camera/mic and to
// auto-accept the permission prompt; otherwise getUserMedia() in the
// preview gate hangs on a prompt no human can click in headless CI.
const CHROMIUM_FAKE_MEDIA_ARGS = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
];

// Firefox feeds a synthetic camera/mic via prefs and pre-grants the
// camera/microphone permissions so the preview gate's getUserMedia()
// resolves without a prompt.
const FIREFOX_FAKE_MEDIA_PREFS = {
  "media.navigator.streams.fake": true,
  "media.navigator.permission.disabled": true,
  "permissions.default.camera": 1,
  "permissions.default.microphone": 1,
} as const;

export default defineConfig({
  // Bridge Nix-store browsers into ~/.cache/ms-playwright before any
  // browser launch — Replit's container cannot run `playwright install`
  // downloads (missing system libs), so the suite relies on symlinked
  // Nix builds. Running it as globalSetup makes the bridge durable
  // across environment restarts (re-applied on every invocation).
  globalSetup: "./scripts/bridge-playwright-browsers.mjs",
  testDir: "./tests/playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Task #602: retries dropped to 0 now that the root cause of the
  // WebKit transient overlap is fixed at the source. The banner now
  // defers its initial show by one requestAnimationFrame, so the
  // position:fixed overlay never appears before the browser has
  // committed its first layout pass and the SAS chips are in their
  // final positions. A genuine layout regression will correctly fail
  // on the first attempt rather than being absorbed by retries.
  retries: 0,
  // Cold browser launches under that same parallel load can blow past
  // Playwright's default 30s per-test timeout (observed webkit ~30.2s, even
  // chromium ~36s spikes). A generous timeout keeps the specs from flaking on
  // environmental slowness without changing any assertion or reducing coverage.
  timeout: 90_000,
  // min-specs-reporter (Task #1134): fails the run if ZERO tests actually
  // executed — a suite that passes having run nothing (testMatch drift,
  // renamed spec, over-broad filter) is falsely reassuring. Escape hatch
  // for deliberate empty runs: PLAYWRIGHT_ALLOW_ZERO_TESTS=1.
  reporter: [["list"], ["./scripts/min-specs-reporter.mjs"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE_PATH.replace(/\/$/, "")}`,
    trace: "off",
    // Reduced-motion skips the splash screen (see shouldShowSplash in
    // src/components/SplashScreen.tsx) so every spec lands directly on
    // the page under test without racing a 2s animation.
    reducedMotion: "reduce",
  },
  projects: [
    // ── Layout gate: Chromium + WebKit, two phone viewports. Pinned
    // away from the flow spec; their thresholds are engine-tuned.
    {
      name: "chromium-360",
      testIgnore: [FLOW_SPEC, DEVICE_CLOUD_SPEC, A11Y_SPEC, SHARE_WARNINGS_SPEC, MEDIA_SPEC, PAYMENT_FAILURE_SPEC, CLEARNET_PATH_SPEC],
      use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 } },
    },
    {
      name: "chromium-414",
      testIgnore: [FLOW_SPEC, DEVICE_CLOUD_SPEC, A11Y_SPEC, SHARE_WARNINGS_SPEC, MEDIA_SPEC, PAYMENT_FAILURE_SPEC, CLEARNET_PATH_SPEC],
      use: { ...devices["Desktop Chrome"], viewport: { width: 414, height: 896 } },
    },
    {
      name: "webkit-360",
      testIgnore: [FLOW_SPEC, DEVICE_CLOUD_SPEC, A11Y_SPEC, SHARE_WARNINGS_SPEC, MEDIA_SPEC, PAYMENT_FAILURE_SPEC, CLEARNET_PATH_SPEC],
      use: { ...devices["Desktop Safari"], viewport: { width: 360, height: 780 } },
    },
    {
      name: "webkit-414",
      testIgnore: [FLOW_SPEC, DEVICE_CLOUD_SPEC, A11Y_SPEC, SHARE_WARNINGS_SPEC, MEDIA_SPEC, PAYMENT_FAILURE_SPEC, CLEARNET_PATH_SPEC],
      use: { ...devices["Desktop Safari"], viewport: { width: 414, height: 896 } },
    },
    // ── Flow gate: core path under three engines.
    {
      name: "flow-chromium",
      testMatch: FLOW_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        permissions: ["camera", "microphone"],
        launchOptions: { args: CHROMIUM_FAKE_MEDIA_ARGS },
      },
    },
    // Firefox flow gate — opt-in via PLAYWRIGHT_FIREFOX=1 (see header).
    ...(RUN_FIREFOX
      ? [
          {
            name: "flow-firefox",
            testMatch: FLOW_SPEC,
            use: {
              ...devices["Desktop Firefox"],
              launchOptions: { firefoxUserPrefs: FIREFOX_FAKE_MEDIA_PREFS },
            },
          },
        ]
      : []),
    {
      // WebKit cannot fake a camera in headless Playwright, so this
      // project asserts the engine-reachable surfaces (landing,
      // preview-gate render, synthetic joined-call UI). The loopback
      // RTCPeerConnection probe SKIPS here because headless Linux WebKit
      // does not gather ICE candidates; genuine Safari WebRTC is automated
      // on a real device cloud (playwright.devicecloud.config.ts /
      // tests/playwright/safari-webrtc-devicecloud.spec.ts). Live
      // getUserMedia / masked-output judgement under WebKit stays in the
      // manual runbook (iOS Safari).
      name: "flow-webkit",
      testMatch: FLOW_SPEC,
      use: { ...devices["Desktop Safari"] },
    },
    // ── Accessibility-tree audit: structural SR-tree checks, once on
    // Chromium. No fake media needed — the /__test/joined-call route
    // mounts the in-call UI with mocked tracks.
    {
      name: "a11y-chromium",
      testMatch: A11Y_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    // ── Share-warnings visibility gate: real-browser proof that the
    // link-mangling and fragment-leak cautions are genuinely on-screen.
    // Engine-agnostic, so it runs once on Chromium. No fake media needed —
    // the DEV-only /__test/share-warnings route mounts the share modals
    // directly with static props.
    {
      name: "share-warnings-chromium",
      testMatch: SHARE_WARNINGS_SPEC,
      // A tall phone viewport: these share sheets are mobile surfaces,
      // and the taller RoomShareSheet (QR + link + phrase + expiry +
      // copy + two cautions + footer) must fully fit so the spec can
      // prove every caution lands in the viewport, the way it does on a
      // real phone.
      use: { ...devices["Desktop Chrome"], viewport: { width: 414, height: 1000 } },
    },
    // ── Media-page content gate: real-browser proof that the /media
    // route renders the refusal band and both demo embeds. Run under
    // Chromium and WebKit (Firefox is not installed on Replit). No fake
    // media needed — the demo embeds render in their poster state on load.
    {
      name: "media-chromium",
      testMatch: MEDIA_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "media-webkit",
      testMatch: MEDIA_SPEC,
      use: { ...devices["Desktop Safari"] },
    },
    // ── Payment-failure-banner gate: real-browser proof that repeated
    // /api/paywall/status failures surface the non-blocking banner with a
    // working CHECK NOW button while the invoice/QR stays put. Engine-agnostic
    // UI/network logic, so it runs once under Chromium. The /api/paywall/*
    // responses are intercepted in-spec, so no live API server is needed.
    {
      name: "payment-failure-chromium",
      testMatch: PAYMENT_FAILURE_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    // ── Clearnet-path-indicator gate (Task #1042, extended in Task #1054):
    // real-browser proof that the home-screen header renders the CLEARNET
    // PATH badge + one-click .onion switch together on clearnet, and
    // suppresses the badge (showing the positive "Connected via Tor onion"
    // badge instead) on the .onion origin. Runs under BOTH Chromium and
    // WebKit (Safari is VOID's most security-sensitive target) against the
    // ONION_PORT dev server (which has VITE_VOID_ONION_HOST baked in).
    //
    // The `.onion`-origin case no longer relies on Chromium's
    // `--host-resolver-rules` flag (WebKit has no equivalent): the spec
    // intercepts every request to the onion origin with a Playwright route
    // handler and re-fetches it from 127.0.0.1, which works identically in
    // both engines (see routeOnionOriginToLocalhost in the spec). baseURL
    // points at the onion-mirror server so the clearnet case's relative
    // `goto` lands there.
    //
    // Chromium additionally verifies the copy-.onion switch writes the
    // mirror URL to the clipboard (it has Playwright clipboard permissions);
    // WebKit/Playwright does not support those permissions, so the WebKit
    // run asserts the badge+switch render coverage and the clipboard
    // round-trip is gated to Chromium inside the spec.
    {
      name: "clearnet-path-chromium",
      testMatch: CLEARNET_PATH_SPEC,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${ONION_PORT}${BASE_PATH.replace(/\/$/, "")}`,
        permissions: ["clipboard-read", "clipboard-write"],
      },
    },
    {
      name: "clearnet-path-webkit",
      testMatch: CLEARNET_PATH_SPEC,
      use: {
        ...devices["Desktop Safari"],
        baseURL: `http://127.0.0.1:${ONION_PORT}${BASE_PATH.replace(/\/$/, "")}`,
      },
    },
  ],
  webServer: [
    {
      command: `PORT=${PORT} BASE_PATH=${BASE_PATH} pnpm run dev`,
      url: `http://127.0.0.1:${PORT}${BASE_PATH}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    // Onion-mirror dev server for the clearnet-path-indicator gate. A real
    // v3 `.onion` host in VITE_VOID_ONION_HOST makes the StartScreen header
    // render the CLEARNET PATH badge + .onion switch (the value is left
    // UNSET on the shared server above so the onion affordance stays inert
    // for every other spec).
    {
      command: `PORT=${ONION_PORT} BASE_PATH=${BASE_PATH} VITE_VOID_ONION_HOST=${ONION_HOST} pnpm run dev`,
      url: `http://127.0.0.1:${ONION_PORT}${BASE_PATH}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
