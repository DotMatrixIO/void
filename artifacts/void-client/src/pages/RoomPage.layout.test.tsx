// SPDX-License-Identifier: AGPL-3.0-or-later
// Static CSS + element-count invariants that approximate a phone-width
// layout gate for the in-call control bar. This is NOT a real-viewport
// measurement — jsdom does not run layout, and stubbed `offsetTop` /
// `getBoundingClientRect` would be theater. The equal-size assertion
// here verifies CSS *intent*, not rendered layout; rendered equal-size
// is checked in the Playwright companion (task #587). For real-viewport
// coverage at 360px and 414px, see task #587.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import {
  roomTestState,
  resetRoomTestState,
  MockWebRTCManager,
  makeMediaPipelineMock,
  joinRoom,
} from "./RoomPage.testHelpers";

/**
 * Single source of truth for the in-call control-bar button budget.
 * Imported by the Playwright companion (task #587) so the budget
 * number lives in exactly one place across both gates.
 *
 * After task #594 the bar is exactly 5 same-size buttons:
 *   MIC, CAM, SHARE SCREEN, MASKS, BURN. (The two footer cyclers
 *   VIDEO: / VOICE: were consolidated into the single MASKS button,
 *   which opens the MasksSheet.)
 *
 * Raising this number is a deliberate decision that requires an
 * issue + argument first — see the budget failure-message copy below.
 */
export const CONTROL_BAR_BUTTON_BUDGET = 5;

vi.mock("@/lib/socket", () => ({
  getSocket: () => roomTestState.mockSocket,
  disconnectSocket: vi.fn(),
}));

vi.mock("@/lib/hostTokenStorage", () => ({
  loadHostToken: vi.fn(async () => undefined),
  persistHostToken: vi.fn(async () => {}),
  clearHostToken: vi.fn(async () => {}),
}));

vi.mock("@/lib/sounds", () => ({
  playBleep: vi.fn(),
  playBloop: vi.fn(),
  playClick: vi.fn(),
  playSelectClick: vi.fn(),
  playSlide: vi.fn(),
  resumeAudio: vi.fn(),
  getAudioContext: vi.fn(() => ({})),
  closeAudioContext: vi.fn(async () => {}),
}));

vi.mock("@/lib/webrtc", () => ({
  WebRTCManager: MockWebRTCManager,
}));

vi.mock("@/lib/mediaPipeline", async () => {
  const { makeMediaPipelineMock } = await import("./RoomPage.testHelpers");
  return makeMediaPipelineMock();
});

vi.mock("@/components/RecordingDisclosureBanner", () => ({
  default: () => null,
}));

vi.mock("@/components/RoomShareSheet", () => ({
  default: () => null,
}));

vi.mock("@/components/PaywallModal", () => ({
  default: () => null,
}));

function describeChild(child: Element, index: number): string {
  const testid = child.getAttribute("data-testid");
  if (testid) return `[${index}] testid="${testid}"`;
  const text = (child.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
  if (text) return `[${index}] "${text}"`;
  return `[${index}] <${child.tagName.toLowerCase()}>`;
}

describe("RoomPage in-call control bar — narrow-viewport layout gate (#585)", () => {
  beforeEach(() => {
    resetRoomTestState();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("mock-no-network"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays within the 6-control budget and ships nowrap + equal-size CSS intent (host, Full mode)", async () => {
    await joinRoom({ isHost: true });

    const root = await screen.findByTestId("room-control-bar");
    const children = Array.from(root.children);

    // 1. Button-count budget — the floor the rest of this gate locks in.
    const actual = children.length;
    const budget = CONTROL_BAR_BUTTON_BUDGET;
    expect(
      actual,
      `Control bar exceeds budget of ${budget} controls (found ${actual}). The fix is to drop or consolidate a control, not to raise the budget. If you genuinely need an additional control, open an issue first and argue for the budget change.`,
    ).toBeLessThanOrEqual(budget);

    // 2. CSS wrap intent — controls must stay on one row at any width.
    const rootStyle = getComputedStyle(root);
    expect(
      rootStyle.flexWrap,
      `Control bar root must declare flex-wrap: nowrap (got "${rootStyle.flexWrap}").`,
    ).toBe("nowrap");

    // 3. No hidden direct children — every counted control is real.
    const hidden = children
      .map((child, i) => ({ child, i, display: getComputedStyle(child).display }))
      .filter(({ display }) => display === "none");
    expect(
      hidden,
      `Control bar has direct children with display:none: ${hidden
        .map(({ child, i }) => describeChild(child, i))
        .join(", ")}.`,
    ).toEqual([]);

    // 4. CSS equal-size intent — every direct child shares the same
    //    `flex` shorthand. Rendered equal widths are #587's job.
    const flexValues = children.map((child) => getComputedStyle(child).flex);
    const reference = flexValues[0];
    const offenders = children
      .map((child, i) => ({ child, i, flex: flexValues[i] }))
      .filter(({ flex }) => flex !== reference);
    expect(
      offenders,
      `Control bar children must share the same computed flex shorthand (expected all "${reference}"). Offenders: ${offenders
        .map(({ child, i, flex }) => `${describeChild(child, i)} → flex="${flex}"`)
        .join(", ")}.`,
    ).toEqual([]);
  });
});
