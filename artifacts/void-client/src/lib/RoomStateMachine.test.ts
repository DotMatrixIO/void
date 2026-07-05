// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  deriveRoomPhase,
  type RoomStateMachineInput,
} from "./RoomStateMachine";

function input(overrides: Partial<RoomStateMachineInput> = {}): RoomStateMachineInput {
  return {
    burned: false,
    sessionEnded: false,
    confirmed: true,
    mediaError: null,
    error: null,
    knockPending: false,
    joined: true,
    ...overrides,
  };
}

describe("deriveRoomPhase", () => {
  it("returns 'connected' when joined with no overriding state", () => {
    expect(deriveRoomPhase(input())).toBe("connected");
  });

  it("returns 'connecting' when not yet joined", () => {
    expect(deriveRoomPhase(input({ joined: false }))).toBe("connecting");
  });

  it("returns 'knockPending' when knockPending and not joined", () => {
    expect(
      deriveRoomPhase(input({ knockPending: true, joined: false })),
    ).toBe("knockPending");
  });

  it("returns 'error' when error is set", () => {
    expect(deriveRoomPhase(input({ error: "ROOM FULL" }))).toBe("error");
  });

  it("returns 'mediaError' when mediaError is set", () => {
    expect(deriveRoomPhase(input({ mediaError: "PERMISSION DENIED" }))).toBe(
      "mediaError",
    );
  });

  it("returns 'confirm' when not confirmed", () => {
    expect(deriveRoomPhase(input({ confirmed: false }))).toBe("confirm");
  });

  it("returns 'sessionEnded' when sessionEnded", () => {
    expect(deriveRoomPhase(input({ sessionEnded: true }))).toBe("sessionEnded");
  });

  it("returns 'burned' when burned", () => {
    expect(deriveRoomPhase(input({ burned: true }))).toBe("burned");
  });

  describe("precedence", () => {
    it("burned outranks every other flag", () => {
      expect(
        deriveRoomPhase(
          input({
            burned: true,
            sessionEnded: true,
            confirmed: false,
            mediaError: "X",
            error: "Y",
            knockPending: true,
            joined: false,
          }),
        ),
      ).toBe("burned");
    });

    it("sessionEnded outranks confirm/error/knock/connecting", () => {
      expect(
        deriveRoomPhase(
          input({
            sessionEnded: true,
            confirmed: false,
            mediaError: "X",
            error: "Y",
            knockPending: true,
            joined: false,
          }),
        ),
      ).toBe("sessionEnded");
    });

    it("confirm outranks mediaError/error/knock/connecting", () => {
      expect(
        deriveRoomPhase(
          input({
            confirmed: false,
            mediaError: "X",
            error: "Y",
            knockPending: true,
            joined: false,
          }),
        ),
      ).toBe("confirm");
    });

    it("mediaError outranks error/knock/connecting", () => {
      expect(
        deriveRoomPhase(
          input({
            mediaError: "X",
            error: "Y",
            knockPending: true,
            joined: false,
          }),
        ),
      ).toBe("mediaError");
    });

    it("error outranks knock/connecting", () => {
      expect(
        deriveRoomPhase(input({ error: "Y", knockPending: true, joined: false })),
      ).toBe("error");
    });

    it("knockPending outranks connecting", () => {
      expect(
        deriveRoomPhase(input({ knockPending: true, joined: false })),
      ).toBe("knockPending");
    });
  });

  it("RoomPage never sets knockPending+joined together; FSM treats knock as having precedence", () => {
    // Document the FSM's actual rule: knockPending is checked before
    // joined, so if both are true the knock screen wins. RoomPage's
    // knock-approved handler always flips knockPending → false in the
    // same tick it flips joined → true, so this combination is
    // unreachable at the call site.
    expect(
      deriveRoomPhase(input({ knockPending: true, joined: true })),
    ).toBe("knockPending");
  });
});
