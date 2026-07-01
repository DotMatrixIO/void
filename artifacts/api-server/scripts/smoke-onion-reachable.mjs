#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke test: read the Onion-Location header the clearnet deployment is
// advertising, then actually connect to that .onion over a local Tor
// SOCKS proxy and assert /api/health returns 200 with the same body the
// clearnet surface returns.
//
// This is the companion to smoke-onion-location.mjs. That script proves
// the clearnet origin is *advertising* an .onion address; it cannot
// prove the advertised address is actually reachable. An operator can
// leave a stale ONION_HOSTNAME pointing at a hidden service that was
// rotated or taken down, and the location smoke would still pass. This
// script closes that gap by dialling the advertised mirror end to end.
//
// .onion names cannot be resolved by the local stub resolver — they only
// exist inside the Tor network — so we hand the hostname to the proxy
// and let it resolve and connect (SOCKS5h). That is why this talks raw
// SOCKS5 instead of using Node's fetch with a proxy: fetch has no SOCKS
// support, and we specifically need *remote* name resolution.
//
// Usage:
//   node artifacts/api-server/scripts/smoke-onion-reachable.mjs \
//     --origin=https://void.example
//
//   SMOKE_ONION_ORIGIN=https://void.example \
//     pnpm --filter @workspace/api-server run smoke:onion-reachable
//
// Optional flags:
//   --path=/api/health        Path to probe (default: /api/health). Both
//                             the clearnet origin and the .onion are hit
//                             at this path; their bodies must match.
//   --socks=127.0.0.1:9050    host:port of the local Tor SOCKS proxy
//                             (default: 127.0.0.1:9050; env
//                             SMOKE_ONION_SOCKS). When this port is not
//                             reachable the script SKIPS (exit 0) so CI
//                             without Tor does not false-fail.
//   --expect-hostname=...     If set, assert the advertised Onion-Location
//                             hostname matches this exact .onion before
//                             dialling it (catches silent rotations).
//   --timeout-ms=30000        Per-step timeout. Tor is slow on a cold
//                             circuit; the default is generous.
//
// Exit codes:
//   0 — reachable and body matched, OR skipped because no Tor SOCKS port
//       was reachable (logged clearly).
//   1 — advertised .onion was not reachable, returned non-200, or the
//       body did not match the clearnet body.
//   2 — usage / clearnet unreachable / malformed Onion-Location header.

import net from "node:net";

const args = process.argv.slice(2);

function getFlag(name) {
  const prefix = `--${name}=`;
  return args.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

function log(msg) {
  console.log(`[smoke-onion-reachable] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke-onion-reachable] FAIL: ${msg}`);
}

const originArg = getFlag("origin")[0] ?? process.env["SMOKE_ONION_ORIGIN"];
if (!originArg) {
  fail(
    "no origin specified. Pass --origin=https://your-deploy.example " +
      "or set SMOKE_ONION_ORIGIN.",
  );
  process.exit(2);
}

let origin;
try {
  const u = new URL(originArg);
  if (u.protocol !== "https:") {
    fail(`origin must be https:// (got ${u.protocol}). The Onion-Location header is only emitted on the https surface.`);
    process.exit(2);
  }
  origin = `${u.protocol}//${u.host}`;
} catch (err) {
  fail(`origin "${originArg}" is not a valid URL: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}

const path = getFlag("path")[0] ?? "/api/health";
if (!path.startsWith("/")) {
  fail(`--path must start with "/" (got "${path}")`);
  process.exit(2);
}

const socksArg = getFlag("socks")[0] ?? process.env["SMOKE_ONION_SOCKS"] ?? "127.0.0.1:9050";
let socksHost;
let socksPort;
{
  // Accept "host:port"; tolerate a bracketed IPv6 literal "[::1]:9050".
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(socksArg);
  if (!m) {
    fail(`--socks must be host:port (got "${socksArg}")`);
    process.exit(2);
  }
  socksHost = m[1].startsWith("[") ? m[1].slice(1, -1) : m[1];
  socksPort = Number(m[2]);
  if (!Number.isInteger(socksPort) || socksPort <= 0 || socksPort > 65535) {
    fail(`--socks port out of range: ${m[2]}`);
    process.exit(2);
  }
}

const expectHostname = getFlag("expect-hostname")[0];
const timeoutMs = Number(getFlag("timeout-ms")[0] ?? 30000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  fail(`--timeout-ms must be a positive number (got ${timeoutMs})`);
  process.exit(2);
}

// Mirror the <base32>.onion shape the app.ts middleware pins.
const ONION_HOSTNAME_RE = /^[a-z2-7]{16,}\.onion$/i;

// ---------------------------------------------------------------------------
// Step 0: is there a Tor SOCKS port to even try? If not, SKIP cleanly so a
// CI runner with no Tor does not turn into a red build.
// ---------------------------------------------------------------------------
function probeSocksPort() {
  return new Promise((resolve) => {
    const s = net.connect({ host: socksHost, port: socksPort });
    let done = false;
    const finish = (reachable, reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      resolve({ reachable, reason });
    };
    // A short timeout: the SOCKS port is local, so it either accepts
    // immediately or it is not there.
    const timer = setTimeout(() => finish(false, `connect timed out after 3000ms`), 3000);
    s.once("connect", () => finish(true));
    s.once("error", (err) => finish(false, err && err.code ? err.code : String(err)));
  });
}

// ---------------------------------------------------------------------------
// Step 1: read the advertised Onion-Location from the clearnet origin, and
// capture the clearnet body so we can compare it against the mirror's.
// ---------------------------------------------------------------------------
async function readClearnet() {
  const url = `${origin}${path}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "*/*" },
    });
  } catch (err) {
    return { ok: false, code: 2, msg: `clearnet request to ${url} failed: ${err instanceof Error ? err.message : err}` };
  } finally {
    clearTimeout(t);
  }

  const header = res.headers.get("onion-location");
  if (!header) {
    return {
      ok: false,
      code: 2,
      msg:
        `${url} -> ${res.status}: no Onion-Location header to follow. ` +
        `Run smoke:onion-location first — this script only checks reachability ` +
        `of an address that is actually being advertised.`,
    };
  }

  let parsed;
  try {
    parsed = new URL(header);
  } catch (err) {
    return { ok: false, code: 2, msg: `Onion-Location header "${header}" is not a valid URL (${err instanceof Error ? err.message : err})` };
  }
  if (parsed.protocol !== "http:") {
    return { ok: false, code: 2, msg: `Onion-Location scheme must be http:// (got "${parsed.protocol}//")` };
  }
  if (!ONION_HOSTNAME_RE.test(parsed.hostname)) {
    return { ok: false, code: 2, msg: `Onion-Location hostname "${parsed.hostname}" does not match the <base32>.onion shape` };
  }
  if (expectHostname && parsed.hostname.toLowerCase() !== expectHostname.toLowerCase()) {
    return {
      ok: false,
      code: 1,
      msg: `advertised .onion "${parsed.hostname}" does not match expected "${expectHostname}" (silent rotation?)`,
    };
  }

  const body = await res.text();
  return {
    ok: true,
    onionHost: parsed.hostname,
    onionPath: `${parsed.pathname}${parsed.search}` || "/",
    clearnetStatus: res.status,
    clearnetBody: body,
  };
}

// ---------------------------------------------------------------------------
// Step 2: a minimal SOCKS5 client. We use ATYP=domain (0x03) so the proxy
// resolves the .onion for us (SOCKS5h) — the whole point of the exercise.
// ---------------------------------------------------------------------------
function socksReplyText(rep) {
  return (
    {
      0x01: "general SOCKS server failure",
      0x02: "connection not allowed by ruleset",
      0x03: "network unreachable",
      0x04: "host unreachable (descriptor not published / .onion down?)",
      0x05: "connection refused",
      0x06: "TTL expired",
      0x07: "command not supported",
      0x08: "address type not supported",
    }[rep] ?? `unknown reply code 0x${rep.toString(16)}`
  );
}

function socks5Connect(destHost, destPort) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: socksHost, port: socksPort });
    let buf = Buffer.alloc(0);
    let stage = "greeting";
    let settled = false;

    const timer = setTimeout(() => rejectOnce(new Error(`SOCKS handshake timed out after ${timeoutMs}ms`)), timeoutMs);
    function rejectOnce(err) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    }

    socket.on("error", (err) => rejectOnce(err));
    socket.on("close", () => rejectOnce(new Error("SOCKS proxy closed the connection during the handshake")));
    socket.on("connect", () => {
      // VER=5, NMETHODS=1, METHOD=0x00 (no auth)
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      if (stage === "greeting") {
        if (buf.length < 2) return;
        const ver = buf[0];
        const method = buf[1];
        if (ver !== 0x05) {
          return rejectOnce(new Error(`SOCKS: bad version ${ver} in method selection — is ${socksHost}:${socksPort} really a SOCKS5 proxy?`));
        }
        if (method === 0xff) return rejectOnce(new Error("SOCKS: proxy rejected the no-auth method (0xFF)"));
        if (method !== 0x00) return rejectOnce(new Error(`SOCKS: proxy chose unsupported auth method 0x${method.toString(16)}`));
        buf = buf.subarray(2);
        stage = "reply";
        const host = Buffer.from(destHost, "ascii");
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, host.length]),
          host,
          Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
        ]);
        socket.write(req);
        // Fall through in case the reply is already buffered.
      }

      if (stage === "reply") {
        if (buf.length < 4) return;
        const ver = buf[0];
        const rep = buf[1];
        const atyp = buf[3];
        if (ver !== 0x05) return rejectOnce(new Error(`SOCKS: bad version ${ver} in connect reply`));
        if (rep !== 0x00) return rejectOnce(new Error(`SOCKS: connect rejected (0x${rep.toString(16)}: ${socksReplyText(rep)})`));
        let addrLen;
        if (atyp === 0x01) addrLen = 4;
        else if (atyp === 0x04) addrLen = 16;
        else if (atyp === 0x03) {
          if (buf.length < 5) return;
          addrLen = 1 + buf[4];
        } else {
          return rejectOnce(new Error(`SOCKS: unexpected ATYP 0x${atyp.toString(16)} in reply`));
        }
        const total = 4 + addrLen + 2;
        if (buf.length < total) return;
        const leftover = buf.subarray(total);
        settled = true;
        clearTimeout(timer);
        socket.removeAllListeners("data");
        socket.removeAllListeners("error");
        socket.removeAllListeners("close");
        resolve({ socket, leftover });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Step 3: a minimal HTTP/1.1 GET over the established tunnel. We send
// Connection: close and read until the socket closes, so we do not have to
// trust Content-Length; chunked bodies are decoded if present.
// ---------------------------------------------------------------------------
function dechunk(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const eol = buf.indexOf("\r\n", i);
    if (eol === -1) break;
    const size = parseInt(buf.subarray(i, eol).toString("latin1").trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = eol + 2;
    out.push(buf.subarray(start, start + size));
    i = start + size + 2;
  }
  return Buffer.concat(out);
}

function parseHttpResponse(buf) {
  const sep = buf.indexOf("\r\n\r\n");
  if (sep === -1) throw new Error("malformed HTTP response from mirror (no header terminator)");
  const headerText = buf.subarray(0, sep).toString("latin1");
  let body = buf.subarray(sep + 4);
  const lines = headerText.split("\r\n");
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(lines[0]);
  if (!m) throw new Error(`malformed HTTP status line from mirror: "${lines[0]}"`);
  const status = Number(m[1]);
  const headers = {};
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  if ((headers["transfer-encoding"] ?? "").toLowerCase().includes("chunked")) {
    body = dechunk(body);
  }
  return { status, headers, body: body.toString("utf8") };
}

function httpGetOverSocket(socket, leftover, host, reqPath) {
  return new Promise((resolve, reject) => {
    let buf = leftover && leftover.length ? Buffer.from(leftover) : Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`HTTP read over Tor timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
    });
    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    socket.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        resolve(parseHttpResponse(buf));
      } catch (err) {
        reject(err);
      }
    });

    socket.write(
      `GET ${reqPath} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: smoke-onion-reachable\r\n` +
        `Accept: */*\r\n` +
        `Connection: close\r\n` +
        `\r\n`,
    );
  });
}

// ---------------------------------------------------------------------------
// Drive it.
// ---------------------------------------------------------------------------
async function main() {
  const socksStatus = await probeSocksPort();
  if (!socksStatus.reachable) {
    log(
      `SKIP: no Tor SOCKS proxy reachable at ${socksHost}:${socksPort} (${socksStatus.reason}). ` +
        `Start Tor (or pass --socks=host:port) to actually dial the mirror. ` +
        `Exiting 0 so a runner without Tor does not false-fail.`,
    );
    process.exit(0);
  }
  log(`Tor SOCKS proxy reachable at ${socksHost}:${socksPort}`);

  const clearnet = await readClearnet();
  if (!clearnet.ok) {
    fail(clearnet.msg);
    process.exit(clearnet.code);
  }
  log(`clearnet ${origin}${path} -> ${clearnet.clearnetStatus}, advertises ${clearnet.onionHost}`);

  let conn;
  try {
    conn = await socks5Connect(clearnet.onionHost, 80);
  } catch (err) {
    fail(`could not reach ${clearnet.onionHost} over Tor: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  let resp;
  try {
    resp = await httpGetOverSocket(conn.socket, conn.leftover, clearnet.onionHost, clearnet.onionPath);
  } catch (err) {
    fail(`HTTP request to ${clearnet.onionHost}${clearnet.onionPath} over Tor failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (resp.status !== 200) {
    fail(`${clearnet.onionHost}${clearnet.onionPath} over Tor returned ${resp.status}, expected 200`);
    process.exit(1);
  }

  if (resp.body.trim() !== clearnet.clearnetBody.trim()) {
    fail(
      `${clearnet.onionHost}${clearnet.onionPath} over Tor returned a 200 but the body did not match the clearnet body.\n` +
        `  clearnet: ${JSON.stringify(clearnet.clearnetBody)}\n` +
        `  mirror:   ${JSON.stringify(resp.body)}\n` +
        `A mismatch means the .onion is reachable but is fronting a different backend than the clearnet origin.`,
    );
    process.exit(1);
  }

  log(`OK ${clearnet.onionHost}${clearnet.onionPath} -> 200 over Tor, body matches clearnet`);
  log(`PASS (mirror reachable at ${clearnet.onionHost})`);
  process.exit(0);
}

main().catch((err) => {
  fail(`unexpected error: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(2);
});
