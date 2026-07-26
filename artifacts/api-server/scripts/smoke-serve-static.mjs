#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke test: build the production api-server bundle, start it with
// SERVE_STATIC=1 against a synthetic client dist, and verify that the
// SPA catch-all route returns index.html (status 200) for both `/` and
// a deep path. Guards against regressions like the Express 5 /
// path-to-regexp v8 rejection of bare `app.get("*", ...)` that would
// crash the production container at startup.
//
// Also exercises the fail-closed CORS allowlist (CodeQL #11) end-to-end
// in the self-host layout:
//  - Phase 1 (default install, no PUBLIC_ORIGIN): same-origin requests
//    (no Origin header) work; a foreign Origin gets no
//    Access-Control-Allow-Origin header (browser blocks it).
//  - Phase 2 (split-origin install, PUBLIC_ORIGIN set): the configured
//    origin is echoed back in Access-Control-Allow-Origin; a foreign
//    Origin is still rejected.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = path.join(artifactDir, "dist", "index.mjs");

// Mirrors the real client build: index.html carries an inline <script>
// (the SRI-failure diagnostic). The server must allow-list it in
// script-src by sha256 hash — computed at startup from the HTML on disk
// — or browsers block it. Asserted in runCspChecks below.
const INLINE_SCRIPT_BODY = 'console.log("SMOKE-INLINE");';
const INDEX_SENTINEL =
  "<!doctype html><title>SMOKE-SPA</title>" +
  `<script>${INLINE_SCRIPT_BODY}</script>` +
  "<div id=root>SMOKE-OK</div>";
const INLINE_SCRIPT_HASH = `'sha256-${createHash("sha256")
  .update(INLINE_SCRIPT_BODY, "utf8")
  .digest("base64")}'`;

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

async function fetchCors(port, p, origin) {
  const headers = origin ? { Origin: origin } : {};
  const res = await fetch(`http://127.0.0.1:${port}${p}`, { headers });
  await res.text();
  return {
    status: res.status,
    allowOrigin: res.headers.get("access-control-allow-origin"),
  };
}

const FOREIGN_ORIGIN = "https://evil.example";
const SPLIT_ORIGIN = "https://client.split-origin.example";

async function withServer(extraEnv, clientDist, fn) {
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
      // Task #1143 added a production-posture FATAL when NODE_ENV=production
      // and PAYWALL_SECRET is unset/empty. This smoke test intentionally
      // simulates a bare install with no secret, so use the documented
      // opt-out rather than weakening the guard.
      PAYWALL_ALLOW_EPHEMERAL_SECRET: "1",
      // Keep room-state persistence out of the repo tree: the server
      // defaults ROOM_STATE_FILE to data/rooms.json relative to its cwd,
      // which would leave a stray top-level data/ dir behind (and trip
      // the publish-inventory guard).
      ROOM_STATE_FILE: path.join(clientDist, "rooms.json"),
      // Simulate a bare self-host install: no Replit domains, no onion
      // mirror, no PUBLIC_ORIGIN unless a phase sets one explicitly. This
      // is what makes the fail-closed CORS assertions meaningful.
      REPLIT_DEV_DOMAIN: "",
      REPLIT_DOMAINS: "",
      PUBLIC_ORIGIN: "",
      ONION_HOSTNAME: "",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForListening(child, 15000);
    await fn(port);
  } finally {
    await killChild(child);
  }
}

async function runSpaChecks(port) {
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
}

async function runCspChecks(port) {
  const res = await fetch(`http://127.0.0.1:${port}/`);
  await res.text();
  const csp = res.headers.get("content-security-policy") ?? "";
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "));
  if (!scriptSrc) {
    throw new Error(`csp: no script-src directive in Content-Security-Policy: "${csp}"`);
  }
  // Room-key derivation runs argon2id compiled to WebAssembly; without
  // 'wasm-unsafe-eval' every hosted install fails with DERIVATION_FAILED.
  if (!scriptSrc.includes("'wasm-unsafe-eval'")) {
    throw new Error(`csp: script-src missing 'wasm-unsafe-eval': "${scriptSrc}"`);
  }
  log("OK csp-wasm script-src carries 'wasm-unsafe-eval'");
  // The inline SRI-diagnostic script must be allow-listed by its sha256.
  if (!scriptSrc.includes(INLINE_SCRIPT_HASH)) {
    throw new Error(
      `csp: script-src missing inline-script hash ${INLINE_SCRIPT_HASH}: "${scriptSrc}"`,
    );
  }
  log(`OK csp-inline-hash script-src carries ${INLINE_SCRIPT_HASH}`);
}

async function runDefaultCorsChecks(port) {
  // Same-origin: browsers send no Origin header, request must succeed.
  const sameOrigin = await fetchCors(port, "/api/healthz");
  if (sameOrigin.status !== 200) {
    throw new Error(`cors-same-origin: expected 200 from /api/healthz, got ${sameOrigin.status}`);
  }
  log("OK cors-same-origin (no Origin header) -> 200");

  // Foreign origin: server must NOT vouch for it (no ACAO header).
  const foreign = await fetchCors(port, "/api/healthz", FOREIGN_ORIGIN);
  if (foreign.allowOrigin) {
    throw new Error(
      `cors-foreign-default: expected no Access-Control-Allow-Origin for ${FOREIGN_ORIGIN}, got "${foreign.allowOrigin}"`,
    );
  }
  log(`OK cors-foreign-default ${FOREIGN_ORIGIN} -> no Access-Control-Allow-Origin`);
}

async function runPublicOriginCorsChecks(port) {
  // The configured PUBLIC_ORIGIN must be allowlisted.
  const allowed = await fetchCors(port, "/api/healthz", SPLIT_ORIGIN);
  if (allowed.allowOrigin !== SPLIT_ORIGIN) {
    throw new Error(
      `cors-public-origin: expected Access-Control-Allow-Origin "${SPLIT_ORIGIN}", got "${allowed.allowOrigin}"`,
    );
  }
  log(`OK cors-public-origin ${SPLIT_ORIGIN} -> Access-Control-Allow-Origin echoed`);

  // A foreign origin must still be rejected even with PUBLIC_ORIGIN set.
  const foreign = await fetchCors(port, "/api/healthz", FOREIGN_ORIGIN);
  if (foreign.allowOrigin) {
    throw new Error(
      `cors-foreign-with-public-origin: expected no Access-Control-Allow-Origin for ${FOREIGN_ORIGIN}, got "${foreign.allowOrigin}"`,
    );
  }
  log(`OK cors-foreign-with-public-origin ${FOREIGN_ORIGIN} -> no Access-Control-Allow-Origin`);
}

async function main() {
  const clientDist = mkdtempSync(path.join(tmpdir(), "smoke-client-dist-"));
  writeFileSync(path.join(clientDist, "index.html"), INDEX_SENTINEL);
  mkdirSync(path.join(clientDist, "assets"));
  writeFileSync(path.join(clientDist, "assets", "app.js"), "/* asset */");

  let failed = false;
  try {
    log("phase 1: default self-host install (no PUBLIC_ORIGIN)");
    await withServer({}, clientDist, async (port) => {
      await runSpaChecks(port);
      await runCspChecks(port);
      await runDefaultCorsChecks(port);
    });

    log(`phase 2: split-origin self-host install (PUBLIC_ORIGIN=${SPLIT_ORIGIN})`);
    await withServer({ PUBLIC_ORIGIN: SPLIT_ORIGIN }, clientDist, async (port) => {
      await runPublicOriginCorsChecks(port);
    });

    log("PASS");
  } catch (err) {
    failed = true;
    console.error(`[smoke-serve-static] FAIL: ${err instanceof Error ? err.message : err}`);
  } finally {
    rmSync(clientDist, { recursive: true, force: true });
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
