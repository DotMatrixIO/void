// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { deriveRoomPhase, type RoomStateMachineInput } from "../RoomStateMachine";

function base(overrides: Partial<RoomStateMachineInput> = {}): RoomStateMachineInput {
  return {
    burned: false,
    sessionEnded: false,
    confirmed: true,
    mediaError: null,
    error: null,
    knockPending: false,
    joined: false,
    ...overrides,
  };
}

describe("RoomStateMachine", () => {
  it("burned wins over everything", () => {
    expect(
      deriveRoomPhase(
        base({ burned: true, sessionEnded: true, mediaError: "X", error: "Y", joined: true }),
      ),
    ).toBe("burned");
  });

  it("sessionEnded wins over the rest", () => {
    expect(
      deriveRoomPhase(base({ sessionEnded: true, mediaError: "X", error: "Y", joined: true })),
    ).toBe("sessionEnded");
  });

  it("unconfirmed (fromUrl) shows confirm overlay", () => {
    expect(deriveRoomPhase(base({ confirmed: false }))).toBe("confirm");
  });

  it("mediaError shows the media-error screen", () => {
    expect(deriveRoomPhase(base({ mediaError: "PERMISSION DENIED" }))).toBe("mediaError");
  });

  it("error shows the room error screen", () => {
    expect(deriveRoomPhase(base({ error: "ROOM FULL" }))).toBe("error");
  });

  it("KNOCK_QUEUE_FULL error is surfaced as an error phase (Task #467)", () => {
    expect(
      deriveRoomPhase(base({ error: "TOO MANY PEOPLE KNOCKING — TRY AGAIN" })),
    ).toBe("error");
  });

  it("knockPending shows the waiting screen", () => {
    expect(deriveRoomPhase(base({ knockPending: true }))).toBe("knockPending");
  });

  it("joined=false yet no error/knock = connecting", () => {
    expect(deriveRoomPhase(base())).toBe("connecting");
  });

  it("joined=true = connected", () => {
    expect(deriveRoomPhase(base({ joined: true }))).toBe("connected");
  });

  it("error beats knockPending (error is terminal in UX)", () => {
    expect(
      deriveRoomPhase(base({ error: "ROOM EXPIRED", knockPending: true })),
    ).toBe("error");
  });

  it("mediaError beats error", () => {
    expect(
      deriveRoomPhase(base({ mediaError: "NOT SUPPORTED", error: "ROOM FULL" })),
    ).toBe("mediaError");
  });
});
