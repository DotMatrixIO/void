// SPDX-License-Identifier: AGPL-3.0-or-later
// RoomPage's integration tests do not emit room-expiry, so the
// countdown there is null; this isolated harness drives RoomHeaderBar
// directly with an `expiryDisplay` prop to cover the header chrome.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { createRef } from "react";
import RoomHeaderBar from "./RoomHeaderBar";

afterEach(cleanup);

function renderHeader(overrides: Partial<Parameters<typeof RoomHeaderBar>[0]> = {}) {
  const peerTag = createRef<string>() as { current: string };
  peerTag.current = "PEER-AAA";
  const props: Parameters<typeof RoomHeaderBar>[0] = {
    voidPhrase: "alpha bravo charlie delta echo foxtrot",
    expiryDisplay: "ENDS 12:00",
    expiresAtWallClock: Date.now() + 8 * 60_000,
    tierLabel: "FREE",
    countdownColor: "var(--fg)",
    countdownUrgent: false,
    count: 1,
    maxUsers: 4,
    isHost: true,
    hostPresent: true,
    hostPeerId: null,
    peerTag,
    verifiedCount: 0,
    aggregateTotal: 0,
    knockMode: false,
    roomLocked: false,
    copied: false,
    shareMethod: "copied",
    handleToggleKnock: () => {},
    handleToggleLock: () => {},
    handleShareLink: () => {},
    handleShowQR: () => {},
    selfViewVisible: true,
    onToggleSelfView: () => {},
    ...overrides,
  };
  return render(<RoomHeaderBar {...props} />);
}

describe("RoomHeaderBar phrase tap-to-mask (#597)", () => {
  it("shows the full phrase verbatim by default", () => {
    renderHeader();
    const row = screen.getByTestId("room-phrase-row");
    expect(row).toBeInTheDocument();
    // The full 6-word phrase is rendered verbatim (never truncated).
    expect(row.textContent).toContain("alpha bravo charlie delta echo foxtrot");
    expect(row.getAttribute("data-masked")).toBe("0");
    // The legacy reveal/dismiss affordances are gone.
    expect(screen.queryByTestId("room-phrase-show")).toBeNull();
    expect(screen.queryByTestId("room-phrase-dismiss")).toBeNull();
  });

  it("tapping the row masks the phrase behind asterisk blocks and toggles back", () => {
    renderHeader();
    const toggle = screen.getByTestId("room-phrase-toggle");
    const row = screen.getByTestId("room-phrase-row");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(toggle);
    expect(row.getAttribute("data-masked")).toBe("1");
    expect(row.textContent).not.toContain("alpha bravo charlie");
    expect(row.textContent).toContain("****");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(toggle);
    expect(row.getAttribute("data-masked")).toBe("0");
    expect(row.textContent).toContain("alpha bravo charlie delta echo foxtrot");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
});
