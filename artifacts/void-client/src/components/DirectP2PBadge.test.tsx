// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DirectP2PBadge, { shouldShowDirectP2PBadge } from "./DirectP2PBadge";

describe("shouldShowDirectP2PBadge", () => {
  it("returns true when at least one peer is connected and relayOnly is false", () => {
    expect(shouldShowDirectP2PBadge({ p1: "connected" }, false)).toBe(true);
    expect(
      shouldShowDirectP2PBadge({ p1: "connecting", p2: "connected" }, false),
    ).toBe(true);
  });

  it("returns false when relayOnly is true", () => {
    expect(shouldShowDirectP2PBadge({ p1: "connected" }, true)).toBe(false);
  });

  it("returns false for non-connected peer states", () => {
    expect(shouldShowDirectP2PBadge({ p1: "connecting" }, false)).toBe(false);
    expect(shouldShowDirectP2PBadge({ p1: "new" }, false)).toBe(false);
    expect(shouldShowDirectP2PBadge({ p1: "failed" }, false)).toBe(false);
    expect(shouldShowDirectP2PBadge({ p1: "disconnected" }, false)).toBe(false);
    expect(shouldShowDirectP2PBadge({ p1: "closed" }, false)).toBe(false);
  });

  it("returns false when there are no peers", () => {
    expect(shouldShowDirectP2PBadge({}, false)).toBe(false);
  });
});

describe("DirectP2PBadge", () => {
  it("renders DIRECT P2P when the predicate is true", () => {
    render(
      <DirectP2PBadge
        peerConnectionStates={{ p1: "connected" }}
        relayOnly={false}
        onOpenWalkthrough={() => {}}
      />,
    );
    expect(screen.getByTestId("direct-p2p-badge")).toHaveTextContent(
      "DIRECT P2P",
    );
  });

  it("renders nothing when relayOnly is true", () => {
    render(
      <DirectP2PBadge
        peerConnectionStates={{ p1: "connected" }}
        relayOnly={true}
        onOpenWalkthrough={() => {}}
      />,
    );
    expect(screen.queryByTestId("direct-p2p-badge")).not.toBeInTheDocument();
  });

  it("renders nothing when no peer is connected", () => {
    render(
      <DirectP2PBadge
        peerConnectionStates={{ p1: "connecting", p2: "new" }}
        relayOnly={false}
        onOpenWalkthrough={() => {}}
      />,
    );
    expect(screen.queryByTestId("direct-p2p-badge")).not.toBeInTheDocument();
  });

  it("calls onOpenWalkthrough when clicked", async () => {
    const onOpenWalkthrough = vi.fn();
    const user = userEvent.setup();
    render(
      <DirectP2PBadge
        peerConnectionStates={{ p1: "connected" }}
        relayOnly={false}
        onOpenWalkthrough={onOpenWalkthrough}
      />,
    );
    await user.click(screen.getByTestId("direct-p2p-badge"));
    expect(onOpenWalkthrough).toHaveBeenCalledTimes(1);
  });
});
