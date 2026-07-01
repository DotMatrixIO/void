// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";

// This test pins the canonical "WHAT VOID WON'T FIX IN v0.5" section on
// ThreatModelPage. It does two things, both load-bearing:
//
//   1. Asserts the section heading is present verbatim.
//   2. Asserts the "screen recording by participants" item is present
//      verbatim — this is the item most likely to be softened by a
//      future copy edit ("we cannot prevent screen recording" sounds
//      negative; somebody will eventually try to make it more
//      "marketing-friendly"). Pin it.
//
// The failure mode is what matters most. A future contributor who sees
// a red line on a stock snapshot diff and deletes the assertion is the
// failure mode. The custom error message below is intentionally loud so
// they have to read it before they can remove the test.

const SECTION_HEADING = "WHAT VOID WON’T FIX IN v0.5";

const SCREEN_RECORDING_PARAGRAPH =
  "A participant in your call can press their OS screen recorder, " +
  "point a second device at the screen, or run any number of local " +
  "capture tools. There is no DRM model that solves this for " +
  "browser-based video, and we will not pretend otherwise \u2014 the " +
  "people who claim to solve it are shipping security theater. The " +
  "honest version is on the biometric page under WHAT THIS DOES NOT " +
  "DO: local masking reduces what a recording captures of you, but " +
  "it does not stop the recording. If you do not trust the person on " +
  "the other end of the call to behave, no software will fix that.";

const FAILURE_MESSAGE =
  "\n\n" +
  "================================================================\n" +
  "ThreatModelPage \"WHAT VOID WON'T FIX IN v0.5\" assertion failed.\n" +
  "================================================================\n" +
  "\n" +
  "This section is the canonical published list of things VOID\n" +
  "deliberately does not fix in v0.5. Edits require updating BOTH\n" +
  "the internal launch checklist (#316) AND\n" +
  "`docs/marketing-claims-audit.md`. If you are confident, update\n" +
  "all three sites and re-run.\n" +
  "\n" +
  "Do not delete this assertion. The whole point of pinning this\n" +
  "section is that future contributors who see a failing test\n" +
  "usually delete the assertion. If the section heading or the\n" +
  "\"screen recording by participants\" line genuinely changed,\n" +
  "update the constants in this test file in the same commit that\n" +
  "changed the page.\n" +
  "================================================================\n";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("DocsThreatModelPage \u2014 WHAT VOID WON'T FIX IN v0.5", () => {
  it("renders the section heading and screen-recording paragraph verbatim", () => {
    render(<DocsThreatModelPage />);

    const heading = screen.queryByTestId("wont-fix-heading");
    if (heading === null || !normalize(heading.textContent ?? "").includes(SECTION_HEADING)) {
      throw new Error(
        `Expected DocsThreatModelPage to contain the section heading "${SECTION_HEADING}". ` +
          `Got: ${heading === null ? "(no element with data-testid=\"wont-fix-heading\")" : JSON.stringify(normalize(heading.textContent ?? ""))}.` +
          FAILURE_MESSAGE,
      );
    }

    const screenRecHeading = screen.queryByTestId("wont-fix-screen-recording-heading");
    if (
      screenRecHeading === null ||
      normalize(screenRecHeading.textContent ?? "") !== "SCREEN RECORDING BY PARTICIPANTS"
    ) {
      throw new Error(
        `Expected the "SCREEN RECORDING BY PARTICIPANTS" sub-heading to be present verbatim.` +
          FAILURE_MESSAGE,
      );
    }

    const paragraph = screen.queryByTestId("wont-fix-screen-recording");
    const actual = normalize(paragraph?.textContent ?? "");
    if (actual !== SCREEN_RECORDING_PARAGRAPH) {
      throw new Error(
        `The "screen recording by participants" paragraph drifted from the pinned text.\n` +
          `Expected: ${JSON.stringify(SCREEN_RECORDING_PARAGRAPH)}\n` +
          `Actual:   ${JSON.stringify(actual)}` +
          FAILURE_MESSAGE,
      );
    }
  });
});
