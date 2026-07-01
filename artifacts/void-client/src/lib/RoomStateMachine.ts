// SPDX-License-Identifier: AGPL-3.0-or-later
// RoomStateMachine — pure derivation of the top-level RoomPage render
// phase from the flags RoomPage already tracks (Task #467). Keeps the
// branching condition in one named place so future contributors can
// reason about precedence without re-reading the ~2,000-line render
// block.
//
// Precedence (highest → lowest, mirroring RoomPage's early returns):
//   1. burned          → terminal BURNED screen
//   2. sessionEnded    → terminal ROOM ENDED screen
//   3. !confirmed      → confirmation overlay (fromUrl flow)
//   4. mediaError      → media-permission error screen
//   5. error           → socket/room error screen (incl. dead-room overlay)
//   6. knockPending    → knock-pending waiting screen
//   7. !joined         → in-flight connecting (still rendering call shell;
//                        callers can use this to gate certain controls)
//   8. joined          → connected, render the call shell

export type RoomRenderPhase =
  | "burned"
  | "sessionEnded"
  | "confirm"
  | "mediaError"
  | "error"
  | "knockPending"
  | "connecting"
  | "connected";

export interface RoomStateMachineInput {
  burned: boolean;
  sessionEnded: boolean;
  confirmed: boolean;
  mediaError: string | null;
  error: string | null;
  knockPending: boolean;
  joined: boolean;
}

export function deriveRoomPhase({
  burned,
  sessionEnded,
  confirmed,
  mediaError,
  error,
  knockPending,
  joined,
}: RoomStateMachineInput): RoomRenderPhase {
  if (burned) return "burned";
  if (sessionEnded) return "sessionEnded";
  if (!confirmed) return "confirm";
  if (mediaError !== null) return "mediaError";
  if (error !== null) return "error";
  if (knockPending) return "knockPending";
  if (!joined) return "connecting";
  return "connected";
}
