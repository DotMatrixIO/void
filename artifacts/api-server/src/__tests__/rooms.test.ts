// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  roomExists,
  isRoomExpired,
  destroyRoom,
  burnRoom,
  extendRoomExpiry,
  getRoomExpiresAt,
  getRoomTier,
  isRoomHost,
  claimHost,
  addHostReclaimToken,
  setOnRoomExpired,
  ROOM_TTLS,
  GC_INTERVAL_MS,
  __forceExpireRoomForTest,
  __clearRoomExpiryTimerForTest,
  __triggerGcSweepForTest,
  getGcSweepCounters,
  __resetGcSweepCountersForTest,
} from "../rooms";

function freshCode(): string {
  return Array.from({ length: 32 }, () =>
    "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
}

describe("rooms — paid TTL outlives empty stretches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("STANDARD room: created, joined, then sole peer leaves — still present after >3 minutes", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard);

    const join = joinRoom(code, "host-socket", "peer-aaaaaa");
    expect(join.success).toBe(true);

    const { remainingUsers } = leaveRoom(code, "host-socket");
    expect(remainingUsers).toEqual([]);

    // Pre-#116 behavior: room would be deleted at the 3-min mark.
    vi.advanceTimersByTime(4 * 60 * 1000);

    expect(roomExists(code)).toBe(true);
    expect(isRoomExpired(code)).toBe(false);

    // Cleanup: advance past TTL so the expiry timer auto-deletes the room.
    // (We can't destroyRoom() here because leaveRoom() cleared hostSocketId
    // when the room emptied, so no socket holds host privileges.)
    vi.advanceTimersByTime(ROOM_TTLS.standard);
    expect(roomExists(code)).toBe(false);
  });

  it("STANDARD room: hard expiry still fires at 65 min", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard);
    joinRoom(code, "host-socket", "peer-aaaaaa");
    leaveRoom(code, "host-socket");

    vi.advanceTimersByTime(ROOM_TTLS.standard + 1000);

    expect(roomExists(code)).toBe(false);
  });

  it("DAY room: empty after leave — exists at 4 min, exists at 23h, gone past 24h", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.day);
    joinRoom(code, "host-socket", "peer-aaaaaa");
    leaveRoom(code, "host-socket");

    // Past the old 3-min prune window
    vi.advanceTimersByTime(4 * 60 * 1000);
    expect(roomExists(code)).toBe(true);
    expect(isRoomExpired(code)).toBe(false);

    // Well into the day, host can still come back
    vi.advanceTimersByTime(23 * 60 * 60 * 1000 - 4 * 60 * 1000);
    expect(roomExists(code)).toBe(true);
    expect(isRoomExpired(code)).toBe(false);

    // Past 24h — expiry timer must have fired
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    expect(roomExists(code)).toBe(false);
  });

  it("extendRoomExpiry: host bumps STANDARD expiry by another standard window", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    const before = getRoomExpiresAt(code)!;
    expect(typeof before).toBe("number");

    // 30 minutes pass — host pays for another standard window mid-call.
    vi.advanceTimersByTime(30 * 60 * 1000);

    const result = extendRoomExpiry(code, ROOM_TTLS.standard, "host-socket");
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.expiresAt).toBe(before + ROOM_TTLS.standard);

    // The room must outlast the original expiry — no rejoin needed.
    vi.advanceTimersByTime(40 * 60 * 1000); // crosses the original 65m mark
    expect(roomExists(code)).toBe(true);
    expect(isRoomExpired(code)).toBe(false);

    // …and still expires on the new (extended) timer.
    vi.advanceTimersByTime(ROOM_TTLS.standard);
    expect(roomExists(code)).toBe(false);
  });

  it("extendRoomExpiry: refuses non-host", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");
    joinRoom(code, "guest-socket", "peer-bbbbbb");

    const result = extendRoomExpiry(code, ROOM_TTLS.standard, "guest-socket");
    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_HOST");
    expect(result.expiresAt).toBeUndefined();

    destroyRoom(code, "host-socket");
  });

  it("extendRoomExpiry: refuses extension once the room has already expired", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    // Sit past the room's natural expiry. The expiry timer fires and deletes
    // the room, so extension targets a now-gone room.
    vi.advanceTimersByTime(ROOM_TTLS.standard + 1000);

    const result = extendRoomExpiry(code, ROOM_TTLS.standard, "host-socket");
    expect(result.success).toBe(false);
    // Deleted by the expiry timer → ROOM_NOT_FOUND.
    expect(result.error).toBe("ROOM_NOT_FOUND");
  });

  it("extendRoomExpiry: caps total at the 24h ceiling", () => {
    const code = freshCode();
    // Day room created — already at the 24h ceiling.
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.day, "day");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    // Try to add another 24h window immediately — there is no headroom
    // because the room already lives the full ceiling.
    const result = extendRoomExpiry(code, ROOM_TTLS.day, "host-socket");
    expect(result.success).toBe(false);
    expect(result.error).toBe("EXTENSION_CAPPED");

    // After we burn 2h of the window, paying for the standard tier fits
    // partly under the ceiling (now+24h), so success — but capped.
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    const before = getRoomExpiresAt(code)!;
    const beforeNow = Date.now();
    const r2 = extendRoomExpiry(code, ROOM_TTLS.day, "host-socket");
    expect(r2.success).toBe(true);
    // New expiresAt should be exactly the ceiling (now + 24h), not
    // before + 24h (which would put us past the ceiling).
    expect(r2.expiresAt).toBe(beforeNow + ROOM_TTLS.day);
    expect(r2.expiresAt!).toBeGreaterThan(before);
    expect(r2.expiresAt!).toBeLessThan(before + ROOM_TTLS.day);

    destroyRoom(code, "host-socket");
  });

  it("extendRoomExpiry: updates the stored tier when newTier is supplied (last-paid wins)", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    // Pay "day" to extend — room state should reflect the new tier so a
    // late-joining peer (or a host reconnect) sees consistent expiry info.
    const result = extendRoomExpiry(code, ROOM_TTLS.day, "host-socket", "day");
    expect(result.success).toBe(true);
    expect(getRoomTier(code)).toBe("day");

    // Omitting newTier on a subsequent extension should leave tier alone.
    vi.advanceTimersByTime(60 * 1000);
    const r2 = extendRoomExpiry(code, ROOM_TTLS.standard, "host-socket");
    expect(r2.success).toBe(true);
    expect(getRoomTier(code)).toBe("day");

    destroyRoom(code, "host-socket");
  });

  it("extendRoomExpiry: rejects ROOM_NOT_FOUND for unknown code", () => {
    const result = extendRoomExpiry(freshCode(), ROOM_TTLS.standard, "host-socket");
    expect(result.success).toBe(false);
    expect(result.error).toBe("ROOM_NOT_FOUND");
  });

  it("extendRoomExpiry: rejects non-finite or non-positive additionalMs", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    expect(extendRoomExpiry(code, 0, "host-socket").error).toBe("INVALID_EXTENSION");
    expect(extendRoomExpiry(code, -1000, "host-socket").error).toBe("INVALID_EXTENSION");
    expect(extendRoomExpiry(code, NaN, "host-socket").error).toBe("INVALID_EXTENSION");
    expect(extendRoomExpiry(code, Infinity, "host-socket").error).toBe("INVALID_EXTENSION");

    destroyRoom(code, "host-socket");
  });

  it("DAY room: host can rejoin via phrase URL after stepping away (presents creation paymentHash)", () => {
    const code = freshCode();
    const hostHash = "hostpayhash-aaaa";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.day, "day", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    // Host walks away for ten minutes, then returns with a fresh socket.
    vi.advanceTimersByTime(10 * 60 * 1000);

    const rejoin = joinRoom(code, "host-socket-2", "peer-bbbbbb");
    expect(rejoin.success).toBe(true);
    expect(rejoin.error).toBeUndefined();

    // Task #171: rejoin alone does NOT confer host. The returning socket
    // must claim host using the original creation paymentHash.
    expect(isRoomHost(code, "host-socket-2")).toBe(false);
    const claim = claimHost(code, "host-socket-2", hostHash);
    expect(claim.success).toBe(true);
    expect(isRoomHost(code, "host-socket-2")).toBe(true);

    const cleanup = destroyRoom(code, "host-socket-2");
    expect(cleanup.success).toBe(true);
  });
});

describe("burnRoom — member-authorized BURN (Task #696)", () => {
  it("a non-host member CAN burn the room (unlike destroyRoom)", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard", "pay-h");
    joinRoom(code, "host-socket", "peer-aaaaaa");
    joinRoom(code, "guest-socket", "peer-bbbbbb");

    // Sanity: the guest is NOT host, so destroyRoom would reject them.
    expect(isRoomHost(code, "guest-socket")).toBe(false);
    expect(destroyRoom(code, "guest-socket").error).toBe("NOT_HOST");

    // But burnRoom authorizes by membership, so the guest can burn it.
    const result = burnRoom(code, "guest-socket");
    expect(result.success).toBe(true);
    expect(roomExists(code)).toBe(false);
  });

  it("the host can also burn the room", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard", "pay-h");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    expect(burnRoom(code, "host-socket").success).toBe(true);
    expect(roomExists(code)).toBe(false);
  });

  it("a socket that never joined the room cannot burn it", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard, "standard", "pay-h");
    joinRoom(code, "host-socket", "peer-aaaaaa");

    expect(burnRoom(code, "outsider-socket").error).toBe("NOT_IN_ROOM");
    expect(roomExists(code)).toBe(true);
  });

  it("burning a nonexistent room returns ROOM_NOT_FOUND", () => {
    expect(burnRoom(freshCode(), "any-socket").error).toBe("ROOM_NOT_FOUND");
  });
});

describe("rooms — host binding to paymentHash (Task #171, M-02)", () => {
  it("isRoomHost no longer auto-promotes the first joiner of an empty room", () => {
    const code = freshCode();
    const hostHash = "pay-hostonly";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    // A different phrase-holder shows up first. Pre-fix, this socket would
    // have been silently promoted to host (the M-02 bug). Post-fix, it
    // remains a non-host participant.
    const joined = joinRoom(code, "guest-socket", "peer-bbbbbb");
    expect(joined.success).toBe(true);
    expect(isRoomHost(code, "guest-socket")).toBe(false);

    // Without a valid paymentHash, the guest cannot moderate either.
    expect(destroyRoom(code, "guest-socket").error).toBe("NOT_HOST");

    // Clean up: the original payer rejoins and reclaims host.
    joinRoom(code, "host-socket-2", "peer-cccccc");
    claimHost(code, "host-socket-2", hostHash);
    destroyRoom(code, "host-socket-2");
  });

  it("happy path: original payer reclaims host with creation paymentHash", () => {
    const code = freshCode();
    const hostHash = "pay-original";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    // Original payer rejoins on a fresh socket.
    const rejoin = joinRoom(code, "host-socket-2", "peer-bbbbbb");
    expect(rejoin.success).toBe(true);

    const claim = claimHost(code, "host-socket-2", hostHash);
    expect(claim.success).toBe(true);
    expect(claim.error).toBeUndefined();
    expect(isRoomHost(code, "host-socket-2")).toBe(true);

    // The reclaimed host can now destroy the room.
    expect(destroyRoom(code, "host-socket-2").success).toBe(true);
  });

  it("negative path: a different paymentHash cannot claim host", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", "pay-original");
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    const rejoin = joinRoom(code, "attacker-socket", "peer-bbbbbb");
    expect(rejoin.success).toBe(true);

    const claim = claimHost(code, "attacker-socket", "pay-different");
    expect(claim.success).toBe(false);
    expect(claim.error).toBe("PAYMENT_HASH_MISMATCH");
    expect(isRoomHost(code, "attacker-socket")).toBe(false);

    // The attacker therefore cannot destroy / lock / kick.
    expect(destroyRoom(code, "attacker-socket").error).toBe("NOT_HOST");
  });

  it("once a host claims, a second socket presenting the same hash is refused", () => {
    const code = freshCode();
    const hostHash = "pay-shared";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    joinRoom(code, "host-socket-2", "peer-bbbbbb");
    expect(claimHost(code, "host-socket-2", hostHash).success).toBe(true);

    joinRoom(code, "host-socket-3", "peer-cccccc");
    const second = claimHost(code, "host-socket-3", hostHash);
    expect(second.success).toBe(false);
    expect(second.error).toBe("HOST_PRESENT");

    destroyRoom(code, "host-socket-2");
  });

  it("addHostReclaimToken lets a paid extension JWT also claim host", () => {
    const code = freshCode();
    const creationToken = "reclaim-creation";
    const extensionToken = "reclaim-extension";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", creationToken);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");

    // Host pays for an extension (different invoice → different reclaim token).
    addHostReclaimToken(code, extensionToken);

    leaveRoom(code, "host-socket-1");

    // Rejoin with ONLY the extension token succeeds.
    joinRoom(code, "host-socket-2", "peer-bbbbbb");
    const claim = claimHost(code, "host-socket-2", extensionToken);
    expect(claim.success).toBe(true);
    expect(isRoomHost(code, "host-socket-2")).toBe(true);

    destroyRoom(code, "host-socket-2");
  });

  it("claimHost is idempotent for the existing host", () => {
    const code = freshCode();
    const hostHash = "pay-idem";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");

    expect(isRoomHost(code, "host-socket-1")).toBe(true);
    const claim = claimHost(code, "host-socket-1", hostHash);
    expect(claim.success).toBe(true);
    expect(isRoomHost(code, "host-socket-1")).toBe(true);

    destroyRoom(code, "host-socket-1");
  });

  it("claimHost requires the caller to already be in the room", () => {
    const code = freshCode();
    const hostHash = "pay-notin";
    createRoom(code, false, "host-socket-1", "human", ROOM_TTLS.standard, "standard", hostHash);
    joinRoom(code, "host-socket-1", "peer-aaaaaa");
    leaveRoom(code, "host-socket-1");

    // Skipping joinRoom — try to claim host directly.
    const claim = claimHost(code, "host-socket-2", hostHash);
    expect(claim.success).toBe(false);
    expect(claim.error).toBe("NOT_IN_ROOM");
  });
});

// Task #201: regression tests for the GC safety-net sweep.
//
// The per-room `expiryTimer` is the primary cleanup mechanism; the periodic
// GC sweep is the safety net. These tests specifically disable the per-room
// timer so that the GC sweep is the only path to cleanup, ensuring the sweep
// can never silently become dead code via future refactors.
//
// NOTE: The production `setInterval` for the GC sweep is created at module
// load time with real timers, so `vi.advanceTimersByTime` cannot drive it
// from test setup. Instead, tests call `__triggerGcSweepForTest()` which
// directly invokes the same sweep logic.
describe("rooms — GC safety-net sweep (Task #201)", () => {
  beforeEach(() => {
    // Reset the onRoomExpired callback before each test so one test's spy
    // does not leak into another.
    setOnRoomExpired(() => {});
  });

  afterEach(() => {
    setOnRoomExpired(() => {});
  });

  it("GC_INTERVAL_MS is in the seconds range (< 60 000 ms), not minutes", () => {
    // If someone bumps this back to 5 minutes this assertion will fail,
    // making the regression visible instead of silent.
    expect(GC_INTERVAL_MS).toBeGreaterThan(0);
    expect(GC_INTERVAL_MS).toBeLessThan(60 * 1000);
  });

  it("GC sweep removes an expired room and fires onRoomExpired when users are present", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard);
    joinRoom(code, "host-socket", "peer-aaaaaa");

    // Force the room past its expiry and null out the per-room timer so
    // only the GC sweep can clean up — this is the safety-net scenario.
    expect(__forceExpireRoomForTest(code)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(code)).toBe(true);

    // Room is expired but still in the map — per-room timer is gone.
    expect(roomExists(code)).toBe(true);
    expect(isRoomExpired(code)).toBe(true);

    const expired = vi.fn();
    setOnRoomExpired(expired);

    // Directly trigger one GC sweep cycle (mirrors a single interval tick).
    __triggerGcSweepForTest();

    expect(roomExists(code)).toBe(false);
    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith(code);
  });

  it("GC sweep removes an expired room but does NOT fire onRoomExpired when no users are present", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard);
    // Do NOT join anyone — room has zero users at sweep time.

    expect(__forceExpireRoomForTest(code)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(code)).toBe(true);

    expect(roomExists(code)).toBe(true);

    const expired = vi.fn();
    setOnRoomExpired(expired);

    __triggerGcSweepForTest();

    expect(roomExists(code)).toBe(false);
    expect(expired).not.toHaveBeenCalled();
  });

  it("GC sweep telemetry counts evictions per sweep, total, and max (Task #302)", () => {
    __resetGcSweepCountersForTest();
    setOnRoomExpired(() => {});

    // Empty sweep on an empty registry: counters tick the sweep but no
    // evictions, and `lastSweepAt` advances so an operator can confirm
    // the timer is alive.
    __triggerGcSweepForTest();
    let counters = getGcSweepCounters();
    expect(counters.totalSweeps).toBe(1);
    expect(counters.totalEvicted).toBe(0);
    expect(counters.lastSweepEvicted).toBe(0);
    expect(counters.maxSweepEvicted).toBe(0);
    expect(counters.lastSweepAt).toBeGreaterThan(0);

    // Two expired rooms in one sweep — both count toward `lastSweepEvicted`
    // and bump `maxSweepEvicted` from 0 to 2.
    const codeA = freshCode();
    const codeB = freshCode();
    createRoom(codeA, false, "host-a", "human", ROOM_TTLS.standard);
    createRoom(codeB, false, "host-b", "human", ROOM_TTLS.standard);
    expect(__forceExpireRoomForTest(codeA)).toBe(true);
    expect(__forceExpireRoomForTest(codeB)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(codeA)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(codeB)).toBe(true);

    __triggerGcSweepForTest();
    counters = getGcSweepCounters();
    expect(counters.totalSweeps).toBe(2);
    expect(counters.totalEvicted).toBe(2);
    expect(counters.lastSweepEvicted).toBe(2);
    expect(counters.maxSweepEvicted).toBe(2);

    // A subsequent zero-eviction sweep resets `lastSweepEvicted` to 0
    // but leaves `maxSweepEvicted` at its high-water mark.
    __triggerGcSweepForTest();
    counters = getGcSweepCounters();
    expect(counters.totalSweeps).toBe(3);
    expect(counters.totalEvicted).toBe(2);
    expect(counters.lastSweepEvicted).toBe(0);
    expect(counters.maxSweepEvicted).toBe(2);

    // A single-eviction sweep does not lower the previously-observed max.
    const codeC = freshCode();
    createRoom(codeC, false, "host-c", "human", ROOM_TTLS.standard);
    expect(__forceExpireRoomForTest(codeC)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(codeC)).toBe(true);
    __triggerGcSweepForTest();
    counters = getGcSweepCounters();
    expect(counters.totalEvicted).toBe(3);
    expect(counters.lastSweepEvicted).toBe(1);
    expect(counters.maxSweepEvicted).toBe(2);
  });

  it("GC sweep invokes onRoomExpired exactly once even if the sweep runs multiple times", () => {
    const code = freshCode();
    createRoom(code, false, "host-socket", "human", ROOM_TTLS.standard);
    joinRoom(code, "host-socket", "peer-aaaaaa");

    expect(__forceExpireRoomForTest(code)).toBe(true);
    expect(__clearRoomExpiryTimerForTest(code)).toBe(true);

    const expired = vi.fn();
    setOnRoomExpired(expired);

    // Run the sweep three times — the room is deleted on the first pass,
    // so subsequent passes must not re-fire the callback.
    __triggerGcSweepForTest();
    __triggerGcSweepForTest();
    __triggerGcSweepForTest();

    expect(expired).toHaveBeenCalledOnce();
    expect(expired).toHaveBeenCalledWith(code);
  });
});
