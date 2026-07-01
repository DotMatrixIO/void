#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// SRI canary — out-of-band post-deploy integrity check (task #498).
//
// Fetches the live deployed origin from a clean runner, re-derives the
// SHA-384 SRI hashes of every linked asset under /index.html, and
// cross-checks them against `/sw-known-hashes.json` and
// `/api/provenance.json` served by the same origin. Exits non-zero with
// an actionable diff on any mismatch.
//
// Why this exists
// ---------------
// The user-facing "Something is wrong with this page" overlay in
// `artifacts/void-client/index.html` only fires when a real user happens
// to load a broken bundle, and a compromised page cannot be trusted to
// phone home about itself. The threat model, marketing copy, and grant
// narrative all lean on "no telemetry, no logs" — so this is the
// out-of-band counterpart: detection that does not require a user
// session and does not add a server ingest endpoint.
//
// Usage
// -----
//   node artifacts/void-client/scripts/sri-canary.mjs \
//     --origin=https://void.example
//
// Optional flags:
//   --timeout-ms=10000   Per-request timeout (default 15000).
//
// Exit codes:
//   0 — every linked asset's hash matches its declared integrity
//       attribute AND agrees with sw-known-hashes.json AND agrees with
//       /api/provenance.json on every shared key.
//   1 — at least one mismatch found.
//   2 — usage / network / unreachable origin.
//
// Critical constraint: this script must not depend on any private
// credential. It uses only the public origin, public
// `/api/provenance.json`, and public asset URLs. If a future change
// tries to add an auth header or signed token, that is a sign the
// wrong surface is being checked.

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);

function getFlag(name) {
  const prefix = `--${name}=`;
  return args
    .filter((a) => a.startsWith(prefix))
    .map((a) => a.slice(prefix.length));
}

function log(msg) {
  console.log(`[sri-canary] ${msg}`);
}

function fail(msg) {
  console.error(`[sri-canary] FAIL: ${msg}`);
}

const originArg = getFlag("origin")[0] ?? process.env["CANARY_TARGET_ORIGIN"];
if (!originArg) {
  fail(
    "no origin specified. Pass --origin=https://your-deploy.example " +
      "or set CANARY_TARGET_ORIGIN.",
  );
  process.exit(2);
}

let origin;
try {
  const u = new URL(originArg);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    fail(`origin must be http:// or https:// (got ${u.protocol})`);
    process.exit(2);
  }
  origin = `${u.protocol}//${u.host}`;
} catch (err) {
  fail(
    `origin "${originArg}" is not a valid URL: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(2);
}

const timeoutMs = Number(getFlag("timeout-ms")[0] ?? 15000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  fail(`--timeout-ms must be a positive number (got ${timeoutMs})`);
  process.exit(2);
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { accept: "*/*", ...(init.headers || {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(path) {
  const url = `${origin}${path}`;
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return {
      ok: false,
      fatal: true,
      msg: `request to ${url} failed: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      fatal: path === "/index.html" || path === "/",
      msg: `${url} -> HTTP ${res.status}`,
    };
  }
  return { ok: true, text: await res.text(), res };
}

async function fetchBytes(path) {
  const url = `${origin}${path}`;
  let res;
  try {
    res = await fetchWithTimeout(url);
  } catch (err) {
    return {
      ok: false,
      msg: `request to ${url} failed: ${err instanceof Error ? err.message : err}`,
    };
  }
  if (!res.ok) {
    return { ok: false, msg: `${url} -> HTTP ${res.status}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, bytes: buf };
}

function sha384Base64(bytes) {
  return "sha384-" + createHash("sha384").update(bytes).digest("base64");
}

// Mirror the parsing shape of sri.test.ts's iterTaggedRefs without
// pulling that test file as a dependency — this script must run on a
// bare runner without `pnpm install`.
function* iterIntegrityRefs(html) {
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(html))) {
    const attrs = m[1];
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    const integrity = attrs.match(/\bintegrity="([^"]+)"/)?.[1];
    if (!src || !integrity) continue;
    yield { tag: "script", url: src, integrity };
  }
  const linkRe = /<link\b([^>]*)>/gi;
  while ((m = linkRe.exec(html))) {
    const attrs = m[1];
    const rel = attrs.match(/\brel="([^"]+)"/)?.[1]?.toLowerCase();
    if (rel !== "stylesheet" && rel !== "modulepreload") continue;
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    const integrity = attrs.match(/\bintegrity="([^"]+)"/)?.[1];
    if (!href || !integrity) continue;
    yield { tag: "link", rel, url: href, integrity };
  }
}

const failures = [];
const mismatchRows = [];

function recordFailure(msg, row) {
  failures.push(msg);
  if (row) mismatchRows.push(row);
  fail(msg);
}

log(`Probing origin ${origin}`);

// 1. Fetch index.html and parse the integrity-bearing tags.
const indexRes = await fetchText("/index.html");
if (!indexRes.ok) {
  fail(indexRes.msg);
  process.exit(indexRes.fatal ? 2 : 1);
}
const html = indexRes.text;
const refs = [...iterIntegrityRefs(html)];
if (refs.length === 0) {
  fail(
    `${origin}/index.html had no <script integrity> or <link rel=stylesheet|modulepreload integrity> tags. ` +
      `Either the deployed bundle was built without the SRI post-build steps ` +
      `(add-sri.mjs / add-modulepreload-sri.mjs), or a proxy stripped the attributes.`,
  );
  process.exit(1);
}
log(`Parsed ${refs.length} integrity-bearing asset reference(s) from /index.html`);

// 2. Re-fetch each asset and verify the declared integrity matches.
const observedHashesByPath = new Map();
for (const ref of refs) {
  let assetPath;
  try {
    // Asset URLs in the served HTML can be root-relative or absolute.
    const u = new URL(ref.url, origin);
    assetPath = `${u.pathname}${u.search}`;
  } catch {
    recordFailure(`could not parse asset URL ${ref.url} (from <${ref.tag}>)`);
    continue;
  }
  // eslint-disable-next-line no-await-in-loop
  const got = await fetchBytes(assetPath);
  if (!got.ok) {
    recordFailure(`<${ref.tag}> ${assetPath}: ${got.msg}`, {
      source: "fetch",
      path: assetPath,
      expected: ref.integrity,
      actual: `(fetch failed: ${got.msg})`,
    });
    continue;
  }
  const actual = sha384Base64(got.bytes);
  observedHashesByPath.set(assetPath, actual);
  if (actual !== ref.integrity) {
    recordFailure(
      `<${ref.tag}> ${assetPath} integrity mismatch: declared ${ref.integrity}, actual ${actual}`,
      {
        source: `index.html <${ref.tag} integrity>`,
        path: assetPath,
        expected: ref.integrity,
        actual,
      },
    );
  } else {
    log(`OK <${ref.tag}> ${assetPath} matches declared integrity`);
  }
}

// 3. Cross-check sw-known-hashes.json: every asset we just hashed must
//    appear in the SW baseline with the same value.
const swRes = await fetchText("/sw-known-hashes.json");
let swTable = null;
if (!swRes.ok) {
  recordFailure(
    `could not fetch /sw-known-hashes.json: ${swRes.msg} — ` +
      `the service worker would silently downgrade to pre-task-489 stale-while-revalidate.`,
  );
} else {
  try {
    swTable = JSON.parse(swRes.text);
  } catch (err) {
    recordFailure(
      `/sw-known-hashes.json is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
}

if (swTable && typeof swTable === "object") {
  for (const [assetPath, actual] of observedHashesByPath) {
    const recorded = swTable[assetPath];
    if (typeof recorded !== "string") {
      recordFailure(
        `sw-known-hashes.json has no entry for ${assetPath} (live bundle references it). ` +
          `gen-sw-known-hashes.mjs may have run before the asset was emitted, or the build base path drifted.`,
        {
          source: "sw-known-hashes.json",
          path: assetPath,
          expected: "(missing entry)",
          actual,
        },
      );
      continue;
    }
    if (recorded !== actual) {
      recordFailure(
        `sw-known-hashes.json mismatch for ${assetPath}: table=${recorded}, actual=${actual}`,
        {
          source: "sw-known-hashes.json",
          path: assetPath,
          expected: recorded,
          actual,
        },
      );
    }
  }
}

// 4. Cross-check /api/provenance.json: for every shared key, the
//    SHA-384 must match what we just hashed off the wire. The
//    provenance.json sriDigests map is keyed the same way as the SW
//    table (BASE_PATH + relative path under dist/public), but in case
//    a deployment uses a different shape we tolerate exact-key matches
//    only — a missing key here is informational, a present-but-
//    mismatched key is a hard failure.
const provRes = await fetchText("/api/provenance.json");
let prov = null;
if (!provRes.ok) {
  recordFailure(
    `could not fetch /api/provenance.json: ${provRes.msg} — ` +
      `cannot cross-check sriDigests against served bundle.`,
  );
} else {
  try {
    prov = JSON.parse(provRes.text);
  } catch (err) {
    recordFailure(
      `/api/provenance.json is not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
}

if (prov && typeof prov === "object") {
  const sriDigests =
    prov.sriDigests && typeof prov.sriDigests === "object"
      ? prov.sriDigests
      : null;
  if (!sriDigests || Object.keys(sriDigests).length === 0) {
    log(
      `::notice::/api/provenance.json has no sriDigests — likely a dev build (commit=${prov.commit ?? "?"}). Skipping provenance cross-check.`,
    );
  } else {
    let sharedKeys = 0;
    for (const [assetPath, actual] of observedHashesByPath) {
      const recorded = sriDigests[assetPath];
      if (typeof recorded !== "string") continue;
      sharedKeys++;
      if (recorded !== actual) {
        recordFailure(
          `/api/provenance.json mismatch for ${assetPath}: sriDigests=${recorded}, actual=${actual}`,
          {
            source: "/api/provenance.json",
            path: assetPath,
            expected: recorded,
            actual,
          },
        );
      }
    }
    log(
      `Provenance cross-check: ${sharedKeys}/${observedHashesByPath.size} keys shared with /api/provenance.json (commit=${prov.commit ?? "?"})`,
    );
    if (sharedKeys === 0) {
      recordFailure(
        `/api/provenance.json sriDigests share zero keys with the served bundle. ` +
          `The provenance file is for a different build or uses an incompatible key shape.`,
        {
          source: "/api/provenance.json",
          path: "(any)",
          expected: "(shared key)",
          actual: "(zero shared keys)",
        },
      );
    }
  }
}

// 5. Emit a machine-readable mismatch report so the GHA workflow can
//    surface the asset path / expected / actual tuples directly in the
//    deduplicated `sri-canary` GitHub issue. Without this the issue
//    body would only be able to link to the run logs — task #498
//    explicitly requires the diff travel with the issue itself.
const reportPath = process.env.SRI_CANARY_REPORT_PATH;
if (reportPath) {
  try {
    const report = {
      origin,
      observedCount: observedHashesByPath.size,
      failureCount: failures.length,
      mismatches: mismatchRows,
      messages: failures,
      // task #499: emit the full path -> hash map so a sibling canary
      // run from a second network path can cross-check observation
      // agreement. Without this, a targeted edge attacker that serves
      // clean bytes to one egress IP range and tampered bytes to
      // another would not be caught — each path would pass its own
      // self-consistent check (HTML, SW table and provenance all
      // agreeing on the *tampered* bytes from that path's view).
      observed: Object.fromEntries(observedHashesByPath),
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    log(`Wrote machine-readable report to ${reportPath}`);
  } catch (err) {
    fail(
      `could not write report to ${reportPath}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

// 6. Final report.
if (failures.length === 0) {
  log(
    `PASS — ${observedHashesByPath.size} asset(s) verified against declared integrity, ` +
      `sw-known-hashes.json, and /api/provenance.json on ${origin}`,
  );
  process.exit(0);
}
fail(`${failures.length} mismatch(es) on ${origin}`);
process.exit(1);
