#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke test: build the production api-server bundle, start it with
// SERVE_STATIC=1 against a synthetic client dist, and verify that the
// SPA catch-all route returns index.html (status 200) for both `/` and
// a deep path. Guards against regressions like the Express 5 /
// path-to-regexp v8 rejection of bare `app.get("*", ...)` that would
// crash the production container at startup.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = path.join(artifactDir, "dist", "index.mjs");

const INDEX_SENTINEL = "<!doctype html><title>SMOKE-SPA</title><div id=root>SMOKE-OK</div>";

function log(msg) {
  console.log(`[smoke-serve-static] ${msg}`);
}

async function pickPort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForListening(child, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout (${timeoutMs}ms) waiting for "Server listening"`)),
      timeoutMs,
    );
    const onData = (buf) => {
      const text = buf.toString();
      process.stdout.write(`[server] ${text}`);
      if (text.includes("Server listening")) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before listening (code=${code} signal=${signal})`));
    });
  });
}

async function fetchPath(port, p) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`);
  const body = await res.text();
  return { status: res.status, body, contentType: res.headers.get("content-type") };
}

async function killChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  const clientDist = mkdtempSync(path.join(tmpdir(), "smoke-client-dist-"));
  writeFileSync(path.join(clientDist, "index.html"), INDEX_SENTINEL);
  mkdirSync(path.join(clientDist, "assets"));
  writeFileSync(path.join(clientDist, "assets", "app.js"), "/* asset */");

  const port = await pickPort();

  log(`spawning ${distEntry} on PORT=${port} CLIENT_DIST=${clientDist}`);
  const child = spawn(process.execPath, ["--enable-source-maps", distEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      SERVE_STATIC: "1",
      CLIENT_DIST: clientDist,
      NODE_ENV: "production",
      // Ensure the TURN/PAYWALL placeholder guards don't trip. The
      // assertions only fire on KNOWN placeholder values; supplying real
      // random hex (or leaving unset) keeps startup green.
      TURN_SECRET: "",
      PAYWALL_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let failed = false;
  try {
    await waitForListening(child, 15000);

    const checks = [
      { path: "/", name: "root" },
      { path: "/compare", name: "spa-deep-path" },
      { path: "/some/nested/route", name: "spa-nested" },
    ];
    for (const c of checks) {
      const r = await fetchPath(port, c.path);
      if (r.status !== 200) {
        throw new Error(`${c.name} (${c.path}): expected status 200, got ${r.status}`);
      }
      if (!r.body.includes("SMOKE-OK")) {
        throw new Error(
          `${c.name} (${c.path}): expected body to include SPA index sentinel "SMOKE-OK", got: ${r.body.slice(0, 200)}`,
        );
      }
      if (!r.contentType || !r.contentType.includes("text/html")) {
        throw new Error(`${c.name} (${c.path}): expected text/html content-type, got ${r.contentType}`);
      }
      log(`OK ${c.name} ${c.path} -> 200 text/html`);
    }

    const apiHealth = await fetchPath(port, "/api/healthz").catch(() => null);
    if (apiHealth && apiHealth.body.includes("SMOKE-OK")) {
      throw new Error("/api/* path was incorrectly served by the SPA catch-all");
    }

    log("PASS");
  } catch (err) {
    failed = true;
    console.error(`[smoke-serve-static] FAIL: ${err instanceof Error ? err.message : err}`);
  } finally {
    await killChild(child);
    rmSync(clientDist, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
