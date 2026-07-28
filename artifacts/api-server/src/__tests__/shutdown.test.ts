// SPDX-License-Identifier: AGPL-3.0-or-later
// SIGTERM drain path.
//
// We exercise the public contract of the shutdown helpers without
// spinning up the real `index.ts` (which calls `process.exit`). The
// behaviours under test are:
//
//   1. `clearAllExpiryTimers()` clears per-room TTL timers so the Node
//      event loop can exit instead of being held alive by a multi-hour
//      day-tier `setTimeout`.
//   2. A SIGTERM-triggered `io.emit("server-shutdown", ...)` reaches
//      every connected client inside the drain window, and clients can
//      observe it BEFORE the underlying TCP connection is torn down by
//      `httpServer.close()`. This is the primary user-visible
//      guarantee — without it, the client banner would never render.
//   3. The drain delays the close: clients still see the
//      `server-shutdown` event when emitted strictly before close().
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Server as HttpServer } from "node:http";
import type { Server as SocketIOServer } from "socket.io";
import type { Socket as ClientSocket } from "socket.io-client";
import {
  startServer,
  connectClient,
  emitCreateRoom,
  validToken,
  validRoomId,
} from "./helpers/test-server";
import {
  clearAllExpiryTimers,
  getRoomExpiresAt,
  getPersistableSnapshot,
  rehydratePersistedRooms,
  createRoom,
  joinRoom,
  claimHost,
  isRoomHost,
  __clearAllRoomsForTest,
  __forceExpireRoomForTest,
  roomExists,
  setOnRoomsChanged,
} from "../rooms";
import {
  hmacReclaimToken,
  __setHostHashHmacKeyForTest,
} from "../lib/hostHashHmac";
import type { PersistedRoomV1 } from "../rooms";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadPersistedRoomsFromDisk,
  installRoomsPersistence,
  flushRoomStateSync,
  cleanupPersistedRoomStateSync,
} from "../roomsPersistence";

describe("graceful SIGTERM drain", () => {
  let httpServer: HttpServer;
  let io: SocketIOServer;
  let port: number;
  let client: ClientSocket;

  beforeEach(async () => {
    const srv = await startServer();
    httpServer = srv.httpServer;
    io = srv.io;
    port = srv.port;
  });

  afterEach(async () => {
    client?.disconnect();
    io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("clearAllExpiryTimers runs idempotently across every live room", async () => {
    // Create several rooms so the helper has to walk a non-trivial map.
    // We can't peek at the timer handles directly (they are private to
    // rooms.ts), but we CAN assert that (a) each room still resolves
    // through the public state surface after clear — i.e. clearing
    // timers doesn't mutate room data — and (b) the helper is safe to
    // call repeatedly, which is what the SIGTERM path does in practice
    // when SIGINT fires immediately after SIGTERM.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = connectClient(port);
      await new Promise<void>((resolve) => c.on("connect", resolve));
      const roomId = validRoomId();
      const result = await emitCreateRoom(c, { roomId, token: validToken() });
      expect(result["success"]).toBe(true);
      ids.push(roomId);
      c.disconnect();
    }

    for (const id of ids) {
      expect(getRoomExpiresAt(id)).toBeTypeOf("number");
    }

    expect(() => clearAllExpiryTimers()).not.toThrow();
    expect(() => clearAllExpiryTimers()).not.toThrow();

    for (const id of ids) {
      // Room state survives — only the timer handles were cleared.
      expect(getRoomExpiresAt(id)).toBeTypeOf("number");
    }
  });

  it("broadcasts `server-shutdown` to every connected client", async () => {
    client = connectClient(port);
    await new Promise<void>((resolve) => client.on("connect", resolve));

    const received = new Promise<{ reason: string; drainMs: number }>((resolve) => {
      client.on("server-shutdown", (payload: { reason: string; drainMs: number }) => {
        resolve(payload);
      });
    });

    io.emit("server-shutdown", { reason: "SIGTERM", drainMs: 5000 });

    const payload = await received;
    expect(payload.reason).toBe("SIGTERM");
    expect(payload.drainMs).toBe(5000);
  });

  it("delivers the shutdown notice BEFORE the connection is torn down", async () => {
    // The whole point of the drain window is that the broadcast has
    // time to reach the client over the wire before the server closes
    // the socket. We simulate that ordering: emit, wait a tick, then
    // close. The client must observe the shutdown event, then the
    // disconnect — never the other way around.
    client = connectClient(port);
    await new Promise<void>((resolve) => client.on("connect", resolve));

    const order: string[] = [];
    client.on("server-shutdown", () => order.push("shutdown"));
    client.on("disconnect", () => order.push("disconnect"));

    io.emit("server-shutdown", { reason: "SIGTERM", drainMs: 5000 });
    // Mimic the production drain: wait briefly, then close. Even a
    // very short delay is enough — the assertion is about ordering,
    // not about absolute wall-clock time.
    await new Promise((resolve) => setTimeout(resolve, 50));
    io.close();

    await new Promise<void>((resolve) => {
      const check = () => {
        if (order.includes("disconnect")) resolve();
        else setTimeout(check, 10);
      };
      check();
    });

    expect(order[0]).toBe("shutdown");
    expect(order).toContain("disconnect");
  });
});

// Task #310 — room state survives a SIGTERM → restart cycle.
describe("room state persistence across restarts", () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "void-rooms-"));
    statePath = path.join(tmpDir, "rooms.json");
  });

  afterEach(() => {
    setOnRoomsChanged(null);
    __clearAllRoomsForTest();
    __setHostHashHmacKeyForTest(null);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Task #886 — the on-disk snapshot stores the KEYED HMAC of each host
  // RECLAIM TOKEN (a per-room random value decoupled from the Lightning
  // paymentHash), never the raw token and never anything payment-derived, so a
  // seized snapshot file cannot be correlated against Lightning settlement
  // records even with PAYWALL_SECRET in hand.
  it("persists the keyed HMAC of host reclaim tokens, never the raw token", () => {
    const code = "cccccccccccccccccccccccccccccccc";
    const reclaimToken = "reclaim-token-do-not-leak-1234";
    createRoom(code, false, "host-1", "human", 3_600_000, "standard", reclaimToken);

    const rec = getPersistableSnapshot().find((r) => r.code === code);
    expect(rec).toBeDefined();
    expect(rec!.hostReclaimTokenHashes).toHaveLength(1);
    const stored = rec!.hostReclaimTokenHashes[0];
    // The stored value is the HMAC, NOT the raw token, and is fixed 64-hex.
    expect(stored).not.toBe(reclaimToken);
    expect(stored).toBe(hmacReclaimToken(reclaimToken));
    expect(stored).toMatch(/^[0-9a-f]{64}$/);

    // And the raw token must not appear anywhere in the on-disk file.
    flushRoomStateSync(statePath);
    const fileText = readFileSync(statePath, "utf8");
    expect(fileText).not.toContain(reclaimToken);
    expect(fileText).toContain(stored);
  });

  // Task #886 — a settled invoice's paymentHash must NEVER reach disk. Mint a
  // room with a known paymentHash AND a known reclaim token (modeling the JWT
  // the paywall issues), then assert the snapshot file contains neither the
  // paymentHash nor the raw reclaim token — only the keyed HMAC of the token.
  it("never writes the paymentHash to disk (snapshot+secret can't correlate to an invoice)", () => {
    __setHostHashHmacKeyForTest("pinned-secret-for-disk-audit");
    const code = "0123456789abcdef0123456789abcdef";
    const paymentHash = "a".repeat(64);
    const reclaimToken = "b".repeat(64);
    // createRoom persists ONLY the reclaim token (the paymentHash is never
    // passed to the room layer — it stays in the JWT for the in-memory replay
    // guard only).
    createRoom(code, false, "host-1", "human", 3_600_000, "standard", reclaimToken);

    flushRoomStateSync(statePath);
    const fileText = readFileSync(statePath, "utf8");
    expect(fileText).not.toContain(paymentHash);
    expect(fileText).not.toContain(reclaimToken);
    expect(fileText).toContain(hmacReclaimToken(reclaimToken));
  });

  // Task #886 — reclaim-on-rejoin still works across a restart when the HMAC
  // key (PAYWALL_SECRET) is stable: the rehydrated HMAC matches the HMAC of
  // the reclaim token the returning host presents.
  it("host reclaims across a restart when the HMAC key is stable", () => {
    __setHostHashHmacKeyForTest("stable-secret-for-reclaim");
    const code = "dddddddddddddddddddddddddddddddd";
    const reclaimToken = "creation-reclaim-token-stable";
    createRoom(code, false, "host-old", "human", 3_600_000, "standard", reclaimToken);

    flushRoomStateSync(statePath);
    __clearAllRoomsForTest();
    expect(roomExists(code)).toBe(false);

    // Restart with the SAME key: rehydrate, host rejoins on a fresh socket.
    const persisted = loadPersistedRoomsFromDisk(statePath);
    expect(rehydratePersistedRooms(persisted)).toBe(1);
    joinRoom(code, "host-new", "peer-aaaaaa");
    const claim = claimHost(code, "host-new", reclaimToken);
    expect(claim.success).toBe(true);
    expect(isRoomHost(code, "host-new")).toBe(true);
  });

  // Task #886 — rotated-secret negative path. If the operator changes
  // PAYWALL_SECRET between the snapshot write and the restart, the stored
  // HMAC no longer matches and reclaim is rejected (the host re-pays once).
  it("rejects reclaim after the HMAC key is rotated", () => {
    __setHostHashHmacKeyForTest("secret-before-rotation");
    const code = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const reclaimToken = "creation-reclaim-token-rotated";
    createRoom(code, false, "host-old", "human", 3_600_000, "standard", reclaimToken);

    flushRoomStateSync(statePath);
    __clearAllRoomsForTest();

    // Restart under a DIFFERENT key.
    __setHostHashHmacKeyForTest("secret-after-rotation");
    const persisted = loadPersistedRoomsFromDisk(statePath);
    expect(rehydratePersistedRooms(persisted)).toBe(1);
    joinRoom(code, "host-new", "peer-bbbbbb");
    const claim = claimHost(code, "host-new", reclaimToken);
    expect(claim.success).toBe(false);
    expect(claim.error).toBe("PAYMENT_HASH_MISMATCH");
    expect(isRoomHost(code, "host-new")).toBe(false);
  });

  // Task #886 — legacy-migration semantics. A snapshot written by an older
  // build holds its host-claim set under the OLD `hostPaymentHashes` key (and
  // a payment-derived value). The rehydrate path reads only the new
  // `hostReclaimTokenHashes` key, so that legacy field is ignored: the room
  // still rehydrates but with an EMPTY reclaim set, and reclaim fails. The
  // host re-pays once. This locks in the documented "fail and re-pay"
  // migration.
  it("rejects reclaim against a legacy hostPaymentHashes snapshot (one-time re-pay migration)", () => {
    __setHostHashHmacKeyForTest("any-stable-secret");
    const code = "ffffffffffffffffffffffffffffffff";
    const reclaimToken = "any-reclaim-token-the-host-holds";
    // Model the on-disk record an old build would have written: the host-claim
    // set lives under the OLD key, which the current rehydrate path ignores.
    const legacy = [
      {
        code,
        createdAt: Date.now() - 10_000,
        expiresAt: Date.now() + 3_600_000,
        tier: "standard" as const,
        roomType: "human" as const,
        relayOnly: false,
        locked: false,
        hostPaymentHashes: ["legacy-payment-derived-value"],
      },
    ] as unknown as PersistedRoomV1[];
    expect(rehydratePersistedRooms(legacy)).toBe(1);
    joinRoom(code, "host-new", "peer-cccccc");
    const claim = claimHost(code, "host-new", reclaimToken);
    expect(claim.success).toBe(false);
    expect(claim.error).toBe("PAYMENT_HASH_MISMATCH");
    expect(isRoomHost(code, "host-new")).toBe(false);
  });

  it("snapshots persist host reclaim tokens, expiry, tier, relay, and locked flags", async () => {
    let httpServer: HttpServer | null = null;
    let io: SocketIOServer | null = null;
    try {
      const srv = await startServer();
      httpServer = srv.httpServer;
      io = srv.io;
      const port = srv.port;

      const client = connectClient(port);
      await new Promise<void>((resolve) => client.on("connect", resolve));
      const roomId = validRoomId();
      const result = await emitCreateRoom(client, { roomId, token: validToken() });
      expect(result["success"]).toBe(true);
      client.disconnect();

      const snapshot = getPersistableSnapshot();
      const rec = snapshot.find((r) => r.code === roomId);
      expect(rec).toBeDefined();
      expect(rec!.tier).toBe("standard");
      expect(rec!.roomType).toBe("human");
      expect(Array.isArray(rec!.hostReclaimTokenHashes)).toBe(true);
      expect(rec!.hostReclaimTokenHashes.length).toBe(1);
      expect(rec!.expiresAt).toBeGreaterThan(Date.now());

      flushRoomStateSync(statePath);
      expect(existsSync(statePath)).toBe(true);
      const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
      expect(onDisk.version).toBe(1);
      expect(onDisk.rooms.some((r: { code: string }) => r.code === roomId)).toBe(true);
    } finally {
      io?.close();
      if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()));
    }
  });

  it("late joiner can reach an existing room after a server restart", async () => {
    // Stage 1: host creates a room on the "old" server, snapshot is
    // flushed to disk, server is torn down (simulating a SIGTERM →
    // restart cycle). The room map is then cleared, mimicking a fresh
    // process with no in-memory state.
    let srv1 = await startServer();
    const hostClient = connectClient(srv1.port);
    await new Promise<void>((resolve) => hostClient.on("connect", resolve));
    const roomId = validRoomId();
    const createRes = await emitCreateRoom(hostClient, { roomId, token: validToken() });
    expect(createRes["success"]).toBe(true);
    hostClient.disconnect();

    flushRoomStateSync(statePath);

    srv1.io.close();
    await new Promise<void>((r) => srv1.httpServer.close(() => r()));
    __clearAllRoomsForTest();
    expect(roomExists(roomId)).toBe(false);

    // Stage 2: rehydrate from the on-disk snapshot, start a fresh
    // server, and have a brand-new client (no JWT — pure late joiner)
    // try to reach the room. Pre-Task #310 this would fail with
    // ROOM_NOT_FOUND because the room map died with the old process.
    const persisted = loadPersistedRoomsFromDisk(statePath);
    const rehydrated = rehydratePersistedRooms(persisted);
    expect(rehydrated).toBe(1);
    expect(roomExists(roomId)).toBe(true);

    const srv2 = await startServer();
    try {
      const lateJoiner = connectClient(srv2.port);
      await new Promise<void>((resolve) => lateJoiner.on("connect", resolve));
      const joinRes = await new Promise<Record<string, unknown>>((resolve) => {
        lateJoiner.emit(
          "join-room",
          { code: roomId, peerId: "peer-abc123" },
          (r: Record<string, unknown>) => resolve(r),
        );
      });
      expect(joinRes["success"]).toBe(true);
      lateJoiner.disconnect();
    } finally {
      srv2.io.close();
      await new Promise<void>((r) => srv2.httpServer.close(() => r()));
    }
  });

  it("expired records are dropped on rehydrate", () => {
    const expired = [
      {
        code: "deadbeefdeadbeefdeadbeefdeadbeef",
        createdAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1,
        tier: "standard" as const,
        roomType: "human" as const,
        relayOnly: false,
        locked: false,
        hostReclaimTokenHashes: ["abc"],
      },
    ];
    expect(rehydratePersistedRooms(expired)).toBe(0);
    expect(roomExists("deadbeefdeadbeefdeadbeefdeadbeef")).toBe(false);
  });

  // Task #339 — startup cleanup keeps the on-disk file honest after an
  // outage longer than the longest TTL: rehydrate drops every expired
  // record, so the cleanup write must DELETE the now-stale file rather
  // than leave it sitting on disk until the next live mutation.
  it("deletes the stale snapshot when no rooms survive rehydrate", () => {
    const expired = [
      {
        code: "deadbeefdeadbeefdeadbeefdeadbeef",
        createdAt: Date.now() - 86_400_000,
        expiresAt: Date.now() - 1,
        tier: "day" as const,
        roomType: "human" as const,
        relayOnly: false,
        locked: false,
        hostReclaimTokenHashes: ["abc"],
      },
    ];
    // Simulate the file the old (pre-outage) process left behind.
    flushRoomStateSync(statePath);
    // Above wrote an empty snapshot (no live rooms in this test), so
    // seed a non-empty file directly to model a large stale snapshot.
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, savedAt: Date.now() - 86_400_000, rooms: expired }),
      "utf8",
    );
    expect(existsSync(statePath)).toBe(true);

    expect(rehydratePersistedRooms(expired)).toBe(0);
    cleanupPersistedRoomStateSync(statePath);

    expect(existsSync(statePath)).toBe(false);
  });

  // Task #339 — when SOME rooms survive rehydrate, the cleanup write
  // rewrites the file to contain only those, dropping the expired ones
  // the snapshot was written with.
  it("rewrites the snapshot to only the rooms that survive rehydrate", () => {
    const liveCode = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const deadCode = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const mixed = [
      {
        code: liveCode,
        createdAt: Date.now() - 10_000,
        expiresAt: Date.now() + 3_600_000,
        tier: "standard" as const,
        roomType: "human" as const,
        relayOnly: false,
        locked: false,
        hostReclaimTokenHashes: ["live"],
      },
      {
        code: deadCode,
        createdAt: Date.now() - 86_400_000,
        expiresAt: Date.now() - 1,
        tier: "day" as const,
        roomType: "human" as const,
        relayOnly: false,
        locked: false,
        hostReclaimTokenHashes: ["dead"],
      },
    ];
    writeFileSync(
      statePath,
      JSON.stringify({ version: 1, savedAt: Date.now() - 86_400_000, rooms: mixed }),
      "utf8",
    );

    expect(rehydratePersistedRooms(mixed)).toBe(1);
    cleanupPersistedRoomStateSync(statePath);

    expect(existsSync(statePath)).toBe(true);
    const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
    const codes = onDisk.rooms.map((r: { code: string }) => r.code);
    expect(codes).toEqual([liveCode]);
  });

  // Task #836 — a long-running, quiet server: rooms age out of the
  // persistable snapshot but no mutation triggers a rewrite. The
  // periodic compaction must notice the live set has shrunk below what
  // was last written and converge the on-disk file back down.
  it("periodic compaction rewrites the file when rooms expire with no mutation", async () => {
    const srv = await startServer();
    try {
      // Short compaction interval so the test doesn't wait minutes.
      const handle = installRoomsPersistence({
        filePath: statePath,
        debounceMs: 0,
        compactionMs: 20,
      });
      try {
        // Create two rooms and land them on disk via flushSync. This
        // also primes `lastWrittenCount` to 2.
        const codes: string[] = [];
        for (let i = 0; i < 2; i++) {
          const c = connectClient(srv.port);
          await new Promise<void>((resolve) => c.on("connect", resolve));
          const roomId = validRoomId();
          await emitCreateRoom(c, { roomId, token: validToken() });
          codes.push(roomId);
          c.disconnect();
        }
        handle.flushSync();
        expect(JSON.parse(readFileSync(statePath, "utf8")).rooms.length).toBe(2);

        // Force one room to expire out of the snapshot WITHOUT going
        // through any persistable mutation: clear its expiry timer so
        // the auto-prune never fires, then clear the change hook the
        // handle installed so even a stray notify can't trigger a write.
        // The only thing that can rewrite the file now is the compaction.
        clearAllExpiryTimers();
        __forceExpireRoomForTest(codes[0]!);
        setOnRoomsChanged(null);
        expect(getPersistableSnapshot().length).toBe(1);

        // Poll until a compaction tick + the 0ms debounced write have
        // landed the shrunken snapshot on disk. Under full-suite load
        // timers and IO can be delayed well past the nominal 20ms
        // interval, so we use a generous deadline instead of a fixed
        // sleep; the loop exits as soon as the write lands.
        const readCodes = () =>
          (JSON.parse(readFileSync(statePath, "utf8")).rooms as { code: string }[]).map(
            (r) => r.code,
          );
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
          if (JSON.stringify(readCodes()) === JSON.stringify([codes[1]])) break;
          await new Promise((r) => setTimeout(r, 25));
        }
        expect(readCodes()).toEqual([codes[1]]);
      } finally {
        handle.stop();
      }
    } finally {
      srv.io.close();
      await new Promise<void>((r) => srv.httpServer.close(() => r()));
    }
  });

  // Task #836 — the compaction tick must be a no-op when the on-disk
  // file already matches the live set, so a stable server never churns
  // the disk. We assert the file's mtime is untouched across several
  // ticks when no room has expired.
  it("periodic compaction does not rewrite when nothing has shrunk", async () => {
    const srv = await startServer();
    try {
      const handle = installRoomsPersistence({
        filePath: statePath,
        debounceMs: 0,
        compactionMs: 15,
      });
      try {
        const c = connectClient(srv.port);
        await new Promise<void>((resolve) => c.on("connect", resolve));
        await emitCreateRoom(c, { roomId: validRoomId(), token: validToken() });
        c.disconnect();
        handle.flushSync();
        // Drop the change hook so only the compaction could touch the
        // file from here on.
        setOnRoomsChanged(null);
        const mtimeBefore = statSync(statePath).mtimeMs;

        // Let several compaction ticks pass; none should rewrite.
        await new Promise((r) => setTimeout(r, 90));

        expect(statSync(statePath).mtimeMs).toBe(mtimeBefore);
      } finally {
        handle.stop();
      }
    } finally {
      srv.io.close();
      await new Promise<void>((r) => srv.httpServer.close(() => r()));
    }
  });

  it("flushSync wins the race against an in-flight async write", async () => {
    // Regression: previously, a slow async writeFile that started
    // before SIGTERM could finish its rename AFTER `flushSync`,
    // overwriting the on-disk file with a stale snapshot. We now
    // linearize via a monotonic generation counter so the older
    // async write abandons its rename when it discovers its gen is
    // stale. This test reproduces the race by interleaving an async
    // write (forced via a 0ms debounce) with an immediate flushSync.
    const srv = await startServer();
    try {
      const handle = installRoomsPersistence({ filePath: statePath, debounceMs: 0 });
      try {
        // Stage 1: create a room and let the async writer start.
        const c1 = connectClient(srv.port);
        await new Promise<void>((resolve) => c1.on("connect", resolve));
        const roomId1 = validRoomId();
        await emitCreateRoom(c1, { roomId: roomId1, token: validToken() });
        c1.disconnect();

        // Stage 2: create a SECOND room synchronously, then call
        // flushSync immediately. The async write from stage 1 may
        // still be mid-flight (writeFile pending). flushSync must
        // capture both rooms and the older async write must NOT
        // come back later and erase the second room.
        const c2 = connectClient(srv.port);
        await new Promise<void>((resolve) => c2.on("connect", resolve));
        const roomId2 = validRoomId();
        await emitCreateRoom(c2, { roomId: roomId2, token: validToken() });
        c2.disconnect();

        handle.flushSync();

        // flushSync is synchronous, so the file must contain both
        // rooms immediately.
        const readCodes = () =>
          (JSON.parse(readFileSync(statePath, "utf8")).rooms as { code: string }[]).map(
            (r) => r.code,
          );
        expect(readCodes()).toContain(roomId1);
        expect(readCodes()).toContain(roomId2);

        // Now OBSERVE for a settle window: if the gen/rename
        // linearization ever regressed, the stale in-flight async
        // write from stage 1 would rename in late and erase roomId2.
        // We re-read repeatedly rather than sleeping a fixed 100ms
        // and asserting once — the condition must hold at EVERY
        // read, so slowness can only lengthen the observation, never
        // fail the test spuriously.
        const settleUntil = Date.now() + 500;
        while (Date.now() < settleUntil) {
          const codes = readCodes();
          expect(codes).toContain(roomId1);
          expect(codes).toContain(roomId2);
          await new Promise((r) => setTimeout(r, 25));
        }
      } finally {
        handle.stop();
      }
    } finally {
      srv.io.close();
      await new Promise<void>((r) => srv.httpServer.close(() => r()));
    }
  });

  it("debounced async writer flushes on shutdown via flushSync", async () => {
    const srv = await startServer();
    try {
      const handle = installRoomsPersistence({ filePath: statePath, debounceMs: 5_000 });
      try {
        const client = connectClient(srv.port);
        await new Promise<void>((resolve) => client.on("connect", resolve));
        const roomId = validRoomId();
        await emitCreateRoom(client, { roomId, token: validToken() });
        client.disconnect();

        // The debounce window is long; the async write hasn't fired
        // yet. flushSync is what the shutdown drain calls and must
        // land the snapshot on disk regardless.
        expect(existsSync(statePath)).toBe(false);
        handle.flushSync();
        expect(existsSync(statePath)).toBe(true);
        const onDisk = JSON.parse(readFileSync(statePath, "utf8"));
        expect(onDisk.rooms.some((r: { code: string }) => r.code === roomId)).toBe(true);
      } finally {
        handle.stop();
      }
    } finally {
      srv.io.close();
      await new Promise<void>((r) => srv.httpServer.close(() => r()));
    }
  });
});
