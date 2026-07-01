// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #359: incoming knock banners must be announceable to screen-reader
// users. Task #309 deliberately left these passive mid-call banners
// un-trapped (trapping focus on a notification is hostile to the host), so the
// audible cue is delivered through a labelled region plus a polite live region
// rather than a focus trap. This harness drives HostModerationRow directly and
// asserts that adding a pending knock produces a live-region announcement node
// and that the ADMIT/DENY controls keep accessible names.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
import HostModerationRow from "./HostModerationRow";

afterEach(cleanup);

function renderRow(
  overrides: Partial<Parameters<typeof HostModerationRow>[0]> = {},
) {
  const props: Parameters<typeof HostModerationRow>[0] = {
    pendingKnocks: [],
    handleApproveKnock: () => {},
    handleDenyKnock: () => {},
    isHost: true,
    pendingRelayRequests: [],
    handleRespondRelayRequest: () => {},
    ...overrides,
  };
  return render(<HostModerationRow {...props} />);
}

describe("HostModerationRow knock accessibility (task #359)", () => {
  it("renders no knock region when there are no pending knocks", () => {
    const { queryByTestId } = renderRow({ pendingKnocks: [] });
    expect(queryByTestId("knock-region")).toBeNull();
    expect(queryByTestId("knock-announcement")).toBeNull();
  });

  it("wraps the knock banner in a labelled region", () => {
    const { getByRole } = renderRow({ pendingKnocks: ["peer-abc123"] });
    const region = getByRole("region", { name: /incoming knock requests/i });
    expect(region).toBeTruthy();
  });

  it("produces a polite live-region announcement for a pending knock", () => {
    const { getByTestId } = renderRow({ pendingKnocks: ["peer-abc123"] });
    const announcement = getByTestId("knock-announcement");
    expect(announcement.getAttribute("role")).toBe("status");
    expect(announcement.getAttribute("aria-live")).toBe("polite");
    // The audible cue is natural language and names the guest (the last six
    // characters of the peer id, upper-cased) the same way the visible banner
    // does — not a spelled-out / mono letter-spaced string.
    expect(announcement.textContent).toMatch(
      /Guest ABC123 is knocking and waiting to be let in\./i,
    );
  });

  it("announces each newly added knock when the pending list grows", () => {
    const { getByTestId, rerender } = render(
      <HostModerationRow
        pendingKnocks={["peer-abc123"]}
        handleApproveKnock={() => {}}
        handleDenyKnock={() => {}}
        isHost={true}
        pendingRelayRequests={[]}
        handleRespondRelayRequest={() => {}}
      />,
    );
    expect(getByTestId("knock-announcement").textContent).toMatch(/ABC123/);

    rerender(
      <HostModerationRow
        pendingKnocks={["peer-abc123", "peer-xyz789"]}
        handleApproveKnock={() => {}}
        handleDenyKnock={() => {}}
        isHost={true}
        pendingRelayRequests={[]}
        handleRespondRelayRequest={() => {}}
      />,
    );
    const announcement = getByTestId("knock-announcement");
    // The same live node now carries the second guest, so a polite SR reads
    // out the newly arrived knock without the banner stealing focus.
    expect(announcement.textContent).toMatch(/ABC123/);
    expect(announcement.textContent).toMatch(/XYZ789/);
  });

  it("keeps accessible names on the ADMIT and DENY controls", () => {
    const { getByRole } = renderRow({ pendingKnocks: ["peer-abc123"] });
    const admit = getByRole("button", { name: /admit guest abc123/i });
    const deny = getByRole("button", { name: /deny guest abc123/i });
    // The visible text labels survive alongside the per-guest accessible name.
    expect(admit.textContent).toMatch(/ADMIT/);
    expect(deny.textContent).toMatch(/DENY/);
  });

  it("scopes one announcement and one button pair per pending knock", () => {
    const { getByTestId } = renderRow({
      pendingKnocks: ["peer-abc123", "peer-xyz789"],
    });
    const announcement = getByTestId("knock-announcement");
    const lines = within(announcement).getAllByText(/is knocking/i);
    expect(lines.length).toBe(2);
  });
});
