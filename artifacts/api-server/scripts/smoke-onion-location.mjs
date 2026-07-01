#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Smoke test: hit a clearnet deployment over https and assert that the
// Onion-Location response header is present and well-formed. Catches
// the "we shipped the middleware but forgot ONION_HOSTNAME in the
// production secrets" misconfiguration that the unit-test suite
// (artifacts/api-server/src/__tests__/onion-location.test.ts) cannot
// catch by construction — those tests pin behaviour against a
// synthetic hostname inside the api-server process, this script pins
// behaviour against whatever the deployed origin is actually serving.
//
// Usage:
//   node artifacts/api-server/scripts/smoke-onion-location.mjs \
//     --origin=https://void.example
//
//   SMOKE_ONION_ORIGIN=https://void.example \
//     pnpm --filter @workspace/api-server run smoke:onion-location
//
// Optional flags:
//   --path=/api/health      Path to probe (default: /api/health).
//                           Can be repeated to probe multiple paths.
//   --expect-hostname=...   If set, also assert the Onion-Location
//                           hostname matches this exact .onion. Useful
//                           in CI when you know the operator's
//                           hostname and want to catch silent
//                           rotations.
//   --timeout-ms=10000      Per-request timeout.
//
// Exit codes:
//   0 — all probed paths returned a well-formed Onion-Location header.
//   1 — header missing, malformed, or hostname/path mismatched.
//   2 — usage / network / unreachable origin.

const args = process.argv.slice(2);

function getFlag(name) {
  const prefix = `--${name}=`;
  return args.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length));
}

function log(msg) {
  console.log(`[smoke-onion-location] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke-onion-location] FAIL: ${msg}`);
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
    fail(`origin must be https:// (got ${u.protocol}). Tor Browser ignores Onion-Location on http responses, so smoke must run against the https surface.`);
    process.exit(2);
  }
  // Normalize: strip any path/query so we can join cleanly.
  origin = `${u.protocol}//${u.host}`;
} catch (err) {
  fail(`origin "${originArg}" is not a valid URL: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}

const paths = (() => {
  const flagPaths = getFlag("path");
  if (flagPaths.length > 0) return flagPaths;
  return ["/api/health"];
})();

for (const p of paths) {
  if (!p.startsWith("/")) {
    fail(`--path values must start with "/" (got "${p}")`);
    process.exit(2);
  }
}

const expectHostname = getFlag("expect-hostname")[0];
const timeoutMs = Number(getFlag("timeout-ms")[0] ?? 10000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  fail(`--timeout-ms must be a positive number (got ${timeoutMs})`);
  process.exit(2);
}

// Onion-Location middleware in app.ts pins this shape:
//   /^[a-z2-7]{16,}\.onion$/i
// Mirror it here so a deployed server slipping a non-.onion past the
// middleware (somehow) still fails the smoke.
const ONION_HOSTNAME_RE = /^[a-z2-7]{16,}\.onion$/i;

async function probe(p) {
  const url = `${origin}${p}`;
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
    return { ok: false, fatal: true, msg: `request to ${url} failed: ${err instanceof Error ? err.message : err}` };
  } finally {
    clearTimeout(t);
  }

  const header = res.headers.get("onion-location");
  if (!header) {
    return {
      ok: false,
      msg:
        `${url} -> ${res.status}: no Onion-Location response header. ` +
        `Most likely ONION_HOSTNAME is unset in the deployment's environment, ` +
        `or a reverse proxy is stripping the header.`,
    };
  }

  let parsed;
  try {
    parsed = new URL(header);
  } catch (err) {
    return { ok: false, msg: `${url}: Onion-Location header "${header}" is not a valid URL (${err instanceof Error ? err.message : err})` };
  }

  if (parsed.protocol !== "http:") {
    return {
      ok: false,
      msg:
        `${url}: Onion-Location scheme must be http:// (Tor's hidden service ` +
        `runs plain HTTP at the rendezvous point; the runbook's HiddenServicePort ` +
        `block forwards http→loopback). Got "${parsed.protocol}//".`,
    };
  }

  if (!ONION_HOSTNAME_RE.test(parsed.hostname)) {
    return {
      ok: false,
      msg:
        `${url}: Onion-Location hostname "${parsed.hostname}" does not match ` +
        `the <base32>.onion shape (/^[a-z2-7]{16,}\\.onion$/i). The middleware ` +
        `should refuse to emit non-.onion values; a mismatch here means the ` +
        `deployed code is older than the validator landed in Task #384, or a ` +
        `proxy is rewriting the header.`,
    };
  }

  if (expectHostname && parsed.hostname.toLowerCase() !== expectHostname.toLowerCase()) {
    return {
      ok: false,
      msg:
        `${url}: Onion-Location hostname "${parsed.hostname}" does not match ` +
        `expected "${expectHostname}". A silent rotation? Update the smoke ` +
        `flag or roll the deployment's ONION_HOSTNAME back.`,
    };
  }

  const headerPath = `${parsed.pathname}${parsed.search}`;
  if (headerPath !== p) {
    return {
      ok: false,
      msg:
        `${url}: Onion-Location path "${headerPath}" does not equal the ` +
        `request path "${p}". The middleware is supposed to mirror ` +
        `req.originalUrl so the Tor Browser prompt lands on the same page, ` +
        `not the homepage.`,
    };
  }

  return {
    ok: true,
    msg: `${url} -> ${res.status} Onion-Location: ${header}`,
  };
}

const results = [];
for (const p of paths) {
  // Serial to keep operator-side rate limits happy; this is a smoke
  // check, not a load test.
  // eslint-disable-next-line no-await-in-loop
  const r = await probe(p);
  results.push(r);
  if (r.ok) log(`OK ${r.msg}`);
  else fail(r.msg);
  if (!r.ok && r.fatal) process.exit(2);
}

const failed = results.filter((r) => !r.ok).length;
if (failed === 0) {
  log(`PASS (${results.length} path${results.length === 1 ? "" : "s"} on ${origin})`);
  process.exit(0);
}
log(`FAIL ${failed}/${results.length} probes failed against ${origin}`);
process.exit(1);
