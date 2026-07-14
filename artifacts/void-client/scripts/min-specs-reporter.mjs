// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Task #1134 — zero-specs-executed floor.
//
// The bridge (scripts/bridge-playwright-browsers.mjs) fails loudly when
// a required browser cannot be bridged, but that only covers SETUP
// breakage. The failure mode named in the task title — the suite
// "passing" because it silently executed nothing — can also happen at
// the Playwright layer: a testMatch/testIgnore drift that routes every
// spec away from every project, a renamed spec file, or a filter that
// matches nothing all produce a green exit with 0 tests run. A browser
// suite that passes because it ran nothing is worse than one that
// fails, because it is falsely reassuring.
//
// This reporter counts tests that actually EXECUTED (any terminal
// status except "skipped") and flips the run to failed when the count
// is zero. Deliberately empty runs (e.g. a scoped --grep during local
// debugging) can opt out with PLAYWRIGHT_ALLOW_ZERO_TESTS=1 — the CI
// workflow never sets it, so the floor always holds there.
export default class MinSpecsReporter {
  constructor() {
    this.executed = 0;
  }

  onTestEnd(_test, result) {
    if (result.status !== "skipped") this.executed++;
  }

  onEnd(result) {
    if (this.executed > 0) return;
    // `playwright test --list` executes nothing by design — not a
    // silent-skip failure, so the floor does not apply there.
    if (process.argv.includes("--list")) return;
    if (process.env.PLAYWRIGHT_ALLOW_ZERO_TESTS === "1") {
      console.warn(
        "[min-specs-reporter] 0 tests executed — allowed because PLAYWRIGHT_ALLOW_ZERO_TESTS=1.",
      );
      return;
    }
    console.error(
      "[min-specs-reporter] FAIL: 0 tests executed. A run that executes " +
        "nothing must not pass — check testMatch/testIgnore routing, spec " +
        "filenames, and any --grep/--project filters. For a deliberately " +
        "empty local run, set PLAYWRIGHT_ALLOW_ZERO_TESTS=1.",
    );
    return { status: result.status === "passed" ? "failed" : result.status };
  }
}
