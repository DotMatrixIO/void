// SPDX-License-Identifier: AGPL-3.0-or-later
// Barrel re-export for the rooms module (Task #447 decomposition).
//
// The implementation that used to live in this single 1.2k-line file is
// now split across `rooms/*` sub-modules. This file is kept as a stable
// import surface so every existing `import { ... } from "./rooms"` /
// `from "../rooms"` site (16 importers across the api-server, including
// test fixtures) continues to compile without churn:
//
//   - rooms/types.ts        — public types + constants (MAX_USERS,
//                              ROOM_TTLS, GC_INTERVAL_MS, etc.)
//   - rooms/registry.ts     — module-level `rooms` Map, capacity caps,
//                              GC sweep + counters, simple getters,
//                              host helpers, test-only escape hatches,
//                              identity-free getRoomState (timing-
//                              equalized).
//   - rooms/screenShare.ts  — request/confirm/stop/clear screen-share,
//                              reservation TTL bookkeeping.
//   - rooms/membership.ts   — joinRoom, leaveRoom, leaveAllRooms,
//                              lock/unlock, knock-mode + approve/deny,
//                              enableRelayOnly.
//   - rooms/lifecycle.ts    — createRoom, destroyRoom, extendRoomExpiry,
//                              clearAllExpiryTimers (shutdown helper).
//   - rooms/persistence.ts  — PERSISTED_ROOMS_VERSION, PersistedRoomV1,
//                              getPersistableSnapshot, rehydratePersistedRooms.
//
// All previous exports are preserved verbatim; the `capturedCreatedAt`
// stale-timer guards (Task #127) and every test-only helper are intact.

export * from "./rooms/types";
export * from "./rooms/registry";
export * from "./rooms/screenShare";
export * from "./rooms/membership";
export * from "./rooms/lifecycle";
export * from "./rooms/persistence";
