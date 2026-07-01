// SPDX-License-Identifier: AGPL-3.0-or-later
import { logger } from "./lib/logger";
import { stopConsumedTokenSweep } from "./socketHandlers";
import { clearAllExpiryTimers } from "./rooms";

export function parseDrainMs(raw: string | undefined, fallback = 5000): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Minimal structural interfaces for the only methods performShutdown
// touches. Keeping these local (rather than Pick<>'ing the full
// socket.io / node:http types) means tests can pass plain mocks
// without satisfying the much stricter return-type contracts of the
// upstream `close()` signatures.
export interface ShutdownIO {
  emit(event: string, ...args: unknown[]): unknown;
  close(): unknown;
}
export interface ShutdownHttpServer {
  close(callback?: () => void): unknown;
}

export interface ShutdownDeps {
  io: ShutdownIO;
  httpServer: ShutdownHttpServer;
  drainMs: number;
  signal: string;
  exit?: (code: number) => void;
  log?: Pick<typeof logger, "warn">;
  setTimeoutFn?: typeof setTimeout;
  // Task #310: callback that runs synchronously before the per-room
  // expiry timers are cleared, so the on-disk room-state file gets a
  // final flush while the in-memory map is still intact. Optional so
  // existing tests (which build their own ShutdownDeps without
  // persistence) continue to work unchanged.
  onBeforeClearTimers?: () => void;
}

/**
 * Graceful shutdown.
 *
 * Order of operations is the user-visible contract:
 *   1. Broadcast `server-shutdown` so every connected client can flip
 *      its banner BEFORE the underlying TCP connection drops. Without
 *      this ordering, the banner never renders.
 *   2. Cancel the consumed-token sweep + every per-room expiry timer
 *      so they stop holding the event loop alive after sockets close.
 *   3. Drain for `drainMs` so the broadcast flushes over the wire to
 *      every peer (websocket frames are async; closing immediately
 *      would race the send).
 *   4. Close socket.io (which disconnects sockets and the engine), then
 *      close the HTTP server, then exit. Closing socket.io BEFORE
 *      `httpServer.close()` is required: otherwise lingering websocket
 *      sessions keep the HTTP server's idle-keepalive count > 0 and
 *      `close()` never invokes its callback, forcing the safety
 *      hard-exit and racing docker-compose's stop_grace_period.
 *   5. A safety hard-exit fires at 2 × drainMs in case any of the
 *      above hangs (e.g. a third-party socket trapping disconnect).
 */
export function performShutdown(deps: ShutdownDeps): Promise<void> {
  const {
    io,
    httpServer,
    drainMs,
    signal,
    exit = (code: number) => process.exit(code),
    log = logger,
    setTimeoutFn = setTimeout,
  } = deps;

  log.warn({ signal, drainMs }, "Received shutdown signal");

  try {
    io.emit("server-shutdown", { reason: signal, drainMs });
  } catch (err) {
    log.warn({ err }, "Failed to broadcast server-shutdown");
  }

  // Task #310: flush the on-disk room-state snapshot BEFORE clearing
  // per-room expiry timers — `clearAllExpiryTimers` only touches
  // timer handles, but a flush at this point captures the room map
  // exactly as it stood at the moment of SIGTERM, including any paid
  // extensions issued in the last debounce window.
  if (deps.onBeforeClearTimers) {
    try {
      deps.onBeforeClearTimers();
    } catch (err) {
      log.warn({ err }, "onBeforeClearTimers threw during shutdown");
    }
  }

  stopConsumedTokenSweep();
  clearAllExpiryTimers();

  return new Promise<void>((resolve) => {
    const hardExit = setTimeoutFn(() => {
      log.warn("Shutdown drain exceeded; forcing exit");
      exit(0);
      resolve();
    }, drainMs * 2);
    if (typeof (hardExit as { unref?: () => void }).unref === "function") {
      (hardExit as { unref: () => void }).unref();
    }

    setTimeoutFn(() => {
      // Close socket.io FIRST so its websocket sessions release the
      // HTTP server's connection refs; otherwise httpServer.close()'s
      // callback never fires and we always hit the hard-exit branch.
      try {
        io.close();
      } catch (err) {
        log.warn({ err }, "io.close() threw during shutdown");
      }

      httpServer.close(() => {
        clearTimeout(hardExit);
        exit(0);
        resolve();
      });
    }, drainMs);
  });
}
