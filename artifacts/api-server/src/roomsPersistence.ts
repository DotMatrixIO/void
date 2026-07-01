// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #310: persist room metadata across operator restarts.
//
// The signaling server holds room state (host paymentHash set, paid
// expiry, tier, relay-only, locked) in process memory. On a longer
// outage — full SIGTERM → restart cycle, or a crash beyond the 5s
// drain — that state is lost, so even though existing peers may still
// be talking P2P, no NEW joiner can reach the room until the host
// re-pays. This module persists the bare minimum metadata to a small
// JSON file so the server can rehydrate live rooms after a restart.
//
// What gets persisted is intentionally limited (see the comments on
// `getPersistableSnapshot` in `rooms.ts`): no socket ids, no peer ids,
// no pending knocks, no screen-share state. Just the durable contract
// of "this code corresponds to a paid room, valid until this instant,
// and these paymentHashes are allowed to reclaim host on rejoin".
//
// Storage shape: a single JSON file with `{ version, rooms: [...] }`.
// Atomic writes via tmp-file + rename so a kill in the middle of a
// flush can never leave a half-written file. Async debounced writes
// during normal operation; a synchronous flush is exposed for the
// shutdown drain so the latest state lands on disk before exit.
//
// Concurrency: a monotonic `writeGen` counter linearizes async and
// sync writers so a slow async write that started before the
// shutdown flush cannot race in afterwards and overwrite the file
// with stale content. Each writer:
//   1. Bumps `writeGen` and captures its own `myGen` BEFORE building
//      the snapshot body, so the body and the gen reflect the same
//      moment in the in-memory map.
//   2. Writes to a per-gen tmp filename (e.g. `rooms.json.tmp.42`)
//      so two writers never clobber each other's tmp file.
//   3. Before renaming into the final path, re-checks `myGen ===
//      writeGen`. If a newer writer has bumped the counter in the
//      meantime, the older writer drops its tmp and aborts the
//      rename. The newest write always wins.
// This pattern is sufficient because Node is single-threaded — the
// gen increment, snapshot capture, and the post-write gen check all
// run as atomic JS turns.

import { promises as fsp, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { logger } from "./lib/logger";
import {
  PERSISTED_ROOMS_VERSION,
  type PersistedRoomV1,
  getPersistableSnapshot,
  setOnRoomsChanged,
} from "./rooms";

// Default location is under `data/` in the api-server's working dir.
// Operators who want to point this at a persistent volume (docker
// bind-mount, NAS path, etc.) can set ROOM_STATE_FILE.
export const DEFAULT_ROOM_STATE_FILE = path.join("data", "rooms.json");

interface PersistedFileV1 {
  version: 1;
  savedAt: number;
  rooms: PersistedRoomV1[];
}

function resolveStatePath(override?: string): string {
  return override ?? process.env["ROOM_STATE_FILE"] ?? DEFAULT_ROOM_STATE_FILE;
}

// Sync read at startup. Returns [] on missing file, parse error, or
// version mismatch — none of which should prevent the server from
// starting. A corrupt or future-version file is logged and ignored;
// the next persist will overwrite it with a clean current-version file.
export function loadPersistedRoomsFromDisk(filePath?: string): PersistedRoomV1[] {
  const p = resolveStatePath(filePath);
  if (!existsSync(p)) return [];
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (err) {
    logger.warn({ err, path: p }, "Failed to read persisted room state; starting empty");
    return [];
  }
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.warn({ err, path: p }, "Persisted room state is not valid JSON; starting empty");
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const file = parsed as Partial<PersistedFileV1>;
  if (file.version !== PERSISTED_ROOMS_VERSION) {
    logger.warn(
      { path: p, version: file.version, expected: PERSISTED_ROOMS_VERSION },
      "Persisted room state version mismatch; ignoring",
    );
    return [];
  }
  return Array.isArray(file.rooms) ? file.rooms : [];
}

function ensureDirSync(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!dir || dir === "." || dir === path.sep) return;
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
}

function buildFileBody(): { body: string; count: number } {
  const snapshot = getPersistableSnapshot();
  const body: PersistedFileV1 = {
    version: PERSISTED_ROOMS_VERSION,
    savedAt: Date.now(),
    rooms: snapshot,
  };
  return { body: JSON.stringify(body), count: snapshot.length };
}

// Number of rooms in the last snapshot we successfully wrote to (or
// removed from) disk this process. `null` until the first write/delete.
// The periodic compaction (see `installRoomsPersistence`) compares this
// against the live `getPersistableSnapshot()` count to detect when the
// on-disk file has drifted larger than the live set — rooms that fell
// out of the snapshot via expiry with no intervening mutation to trigger
// a rewrite. It only rewrites when there's a real shrink, so a quiet
// server with a stable room set never churns the disk on every tick.
let lastWrittenCount: number | null = null;

// Module-scoped generation counter. Both the async and sync write
// paths bump and check it. Sharing one counter across the standalone
// `flushRoomStateSync` and the `installRoomsPersistence` writer is
// intentional: in production both run against the same file, and we
// need the linearization to span them.
let writeGen = 0;

// Synchronous flush — used by the shutdown drain so the latest state
// lands on disk before the process exits, even if the debounce timer
// hasn't fired. By bumping `writeGen` first, any in-flight async
// write that hasn't yet renamed will see a stale gen and abandon
// its rename, so this sync write is guaranteed to win. Safe to call
// repeatedly.
export function flushRoomStateSync(filePath?: string): void {
  const p = resolveStatePath(filePath);
  const myGen = ++writeGen;
  let tmp = "";
  try {
    ensureDirSync(p);
    const { body, count } = buildFileBody();
    tmp = `${p}.tmp.${myGen}`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, p);
    lastWrittenCount = count;
  } catch (err) {
    logger.warn({ err, path: p }, "Failed to flush persisted room state");
    if (tmp) {
      try { unlinkSync(tmp); } catch { /* tmp may not exist */ }
    }
  }
}

// Task #339: startup-side cleanup write. `rehydratePersistedRooms`
// correctly drops expired records when rebuilding the in-memory map,
// but it never rewrites the file — so after an outage longer than the
// longest TTL (24h day-tier), every record in the on-disk snapshot is
// already expired, none get rehydrated, and the stale (and possibly
// megabytes-large) file just sits there until the next live mutation
// rewrites it. This rewrites the file at startup to reflect ONLY the
// rooms actually rehydrated into memory, or deletes it entirely if none
// remain, keeping the snapshot honest and small. Synchronous because it
// runs once at startup, after rehydrate and before the debounced async
// writer is installed. Reuses the gen-linearized `flushRoomStateSync`
// for the non-empty path so it stays consistent with every other writer.
export function cleanupPersistedRoomStateSync(filePath?: string): void {
  const p = resolveStatePath(filePath);
  if (getPersistableSnapshot().length === 0) {
    // Nothing survived rehydrate: remove the file rather than leaving a
    // stale (or empty-but-present) snapshot on disk. Bump the gen so a
    // later writer can't be fooled into thinking this never happened.
    void ++writeGen;
    lastWrittenCount = 0;
    try {
      if (existsSync(p)) {
        unlinkSync(p);
        logger.warn({ path: p }, "Removed stale persisted room state (no rooms rehydrated)");
      }
    } catch (err) {
      logger.warn({ err, path: p }, "Failed to remove stale persisted room state");
    }
    return;
  }
  flushRoomStateSync(p);
}

// Asynchronous, debounced flush. The default 200ms window collapses
// bursts (e.g. create-room + addHostReclaimToken on the same JWT) into
// a single disk write while keeping the on-disk state within ~half a
// second of memory under normal load. The `unref` on the timer means
// pending flushes never block process exit on their own — the
// shutdown drain calls `flushRoomStateSync` for the final write.
export interface PersistenceHandle {
  flush(): Promise<void>;
  flushSync(): void;
  stop(): void;
}

const DEBOUNCE_MS = 200;

// Task #836: how often the background compaction checks whether the
// on-disk snapshot has drifted larger than the live room set. The
// debounced async writer keeps the file in sync with every persistable
// MUTATION, and per-room expiry timers already notify on expiry — but
// this interval is the belt-and-suspenders guarantee that a quiet
// server (rooms aging out with no other mutation, or an expiry-time
// write that was abandoned by the gen-race check) still converges the
// file down to the live count. 5 minutes is well below any meaningful
// "oversized file sitting around" window while costing nothing on a
// stable server (the tick is a no-op unless a real shrink is detected).
const COMPACTION_MS = 5 * 60_000;

export function installRoomsPersistence(
  opts: { filePath?: string; debounceMs?: number; compactionMs?: number } = {},
): PersistenceHandle {
  const filePath = resolveStatePath(opts.filePath);
  const debounce = typeof opts.debounceMs === "number" ? Math.max(0, opts.debounceMs) : DEBOUNCE_MS;
  const compaction =
    typeof opts.compactionMs === "number" ? Math.max(0, opts.compactionMs) : COMPACTION_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;
  let compactTimer: ReturnType<typeof setInterval> | null = null;

  // Single async write attempt. Captures its own generation BEFORE
  // building the body, then rechecks the generation between the temp
  // write and the rename. If a newer writer (sync or async) has
  // bumped the counter in the meantime, this writer abandons its
  // rename and unlinks its tmp — preserving the newer file.
  const writeNow = async (): Promise<void> => {
    const myGen = ++writeGen;
    let tmp = "";
    try {
      ensureDirSync(filePath);
      const { body, count } = buildFileBody();
      tmp = `${filePath}.tmp.${myGen}`;
      await fsp.writeFile(tmp, body, "utf8");
      if (myGen !== writeGen) {
        // A sync flush or a newer async write has superseded us
        // between buildFileBody() and now. Drop our tmp; the newer
        // writer's content (or its own tmp) is what should win.
        try { await fsp.unlink(tmp); } catch { /* may have been cleaned up */ }
        return;
      }
      await fsp.rename(tmp, filePath);
      lastWrittenCount = count;
    } catch (err) {
      logger.warn({ err, path: filePath }, "Failed to persist room state");
      if (tmp) {
        try { await fsp.unlink(tmp); } catch { /* tmp may not exist */ }
      }
    }
  };

  const schedule = (): void => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      pending = writeNow().finally(() => {
        pending = null;
      });
    }, debounce);
    if (timer.unref) timer.unref();
  };

  setOnRoomsChanged(schedule);

  // Task #836: periodic compaction. On each tick, compare the live
  // persistable count against what we last wrote to disk. If the live
  // set is smaller, the on-disk file is carrying rooms that have since
  // expired out of the snapshot with no mutation to rewrite it — so we
  // schedule a debounced write to converge it down. When nothing has
  // shrunk (a stable or growing room set, already kept current by the
  // mutation-driven writer), the tick is a cheap no-op and never
  // touches the disk. `unref` keeps this interval from holding the
  // event loop open or blocking shutdown.
  if (compaction > 0) {
    compactTimer = setInterval(() => {
      if (lastWrittenCount !== null && getPersistableSnapshot().length < lastWrittenCount) {
        schedule();
      }
    }, compaction);
    if (compactTimer.unref) compactTimer.unref();
  }

  return {
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Run our own write, then ensure any older in-flight async
      // write has settled so callers can rely on the file being
      // quiescent on resolve. The gen-check inside `writeNow`
      // guarantees the older write cannot clobber us regardless of
      // the await order.
      const inflight = pending;
      await writeNow();
      if (inflight) await inflight;
    },
    flushSync() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Bumps `writeGen` and writes synchronously. Any async write
      // already past `buildFileBody()` will discover its gen is
      // stale on the post-writeFile check and abandon its rename,
      // so the file we just wrote is guaranteed to be the final
      // on-disk content (until the next mutation, of course).
      flushRoomStateSync(filePath);
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (compactTimer) {
        clearInterval(compactTimer);
        compactTimer = null;
      }
      setOnRoomsChanged(null);
    },
  };
}
