#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the shared release preflight (scripts/preflight-build-vars.mjs)
// and the validators it consolidates. The preflight is invoked by BOTH
// release pipelines (.github/workflows/release.yml and
// .github/workflows/void-client-sri.yml) precisely so the onion/origin
// validation lives in ONE place and can never drift back into an inline
// copy inside a workflow. This file locks that down two ways:
//
//   1. UNIT — pin what the validators the preflight reuses accept/reject:
//        * originProblem()   (artifacts/void-client/scripts/originRules.mjs)
//        * onionBakeProblem() (artifacts/void-client/src/lib/onionHost.ts)
//      so a future edit that loosens either rule fails here.
//
//   2. GUARD — assert both workflows still call the shared script and carry
//      NO inline onion/origin validation regex, so a reintroduced copy (the
//      exact drift this consolidation removed) fails CI.
//
// onionHost.ts is TypeScript; this file is run with Node's type-stripping so
// it can import it directly (plain `import`). Invoke with
// `node --experimental-strip-types` on Node < 23.6 (e.g. release.yml's
// pinned 22.12); newer runtimes strip types by default and accept the flag
// as a no-op. See scripts/package.json `test:preflight-build-vars`.
//
// Exits 0 on success, 1 on the first assertion failure.
//
// Run: node --experimental-strip-types scripts/preflight-build-vars.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { originProblem } from "../artifacts/void-client/scripts/originRules.mjs";
import { onionBakeProblem } from "../artifacts/void-client/src/lib/onionHost.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    failures += 1;
  } else {
    process.stdout.write(`ok: ${msg}\n`);
  }
}

// A syntactically valid Tor v3 host: a 56-char base32 [a-z2-7] label before
// ".onion". (56 lowercase letters satisfies ^[a-z2-7]{56}$.)
const VALID_ONION = `${"a".repeat(56)}.onion`;

// --- originProblem() ------------------------------------------------------
// Valid = absolute http(s) URL whose pathname is exactly "/". Trailing
// slashes are tolerated by the URL parser; any other path is rejected.
{
  assert(
    originProblem("https://void.example.com") === null,
    "origin: absolute root https URL is accepted",
  );
  assert(
    originProblem("http://void.example.com") === null,
    "origin: http scheme is accepted (not only https)",
  );
  assert(
    originProblem("https://void.example.com/") === null,
    "origin: a trailing slash is tolerated (pathname stays '/')",
  );
  assert(
    originProblem(`https://${VALID_ONION}`) === null,
    "origin: an absolute .onion root URL is accepted",
  );

  assert(
    originProblem(undefined) !== null,
    "origin: unset (undefined) is rejected",
  );
  assert(originProblem("") !== null, "origin: empty string is rejected");
  assert(
    originProblem("void.example.com") !== null,
    "origin: a bare host with no scheme is rejected",
  );
  assert(
    originProblem("ftp://void.example.com") !== null,
    "origin: a non-http(s) scheme (ftp) is rejected",
  );
  assert(
    originProblem("https://void.example.com/app") !== null,
    "origin: an absolute URL with a non-root path is rejected",
  );
}

// --- onionBakeProblem() (the onion cases the preflight relies on) ---------
{
  assert(
    onionBakeProblem(VALID_ONION) === null,
    "onion: a valid 56-char base32 .onion host is accepted",
  );
  assert(
    onionBakeProblem(`https://${VALID_ONION}/`) === null,
    "onion: a scheme + trailing slash around a valid host is tolerated",
  );

  assert(onionBakeProblem(undefined) !== null, "onion: unset is rejected");
  assert(onionBakeProblem("") !== null, "onion: empty string is rejected");
  assert(
    onionBakeProblem("foo.onion") !== null,
    "onion: a too-short (non-v3) label is rejected",
  );
  assert(
    onionBakeProblem(`${"a".repeat(55)}.onion`) !== null,
    "onion: a 55-char label (one short of v3) is rejected",
  );
  assert(
    onionBakeProblem(`${"a".repeat(55)}1.onion`) !== null,
    "onion: a 56-char label with a non-base32 char (1) is rejected",
  );
}

// --- workflow drift guard -------------------------------------------------
// Both release pipelines must invoke the ONE shared preflight script, and
// neither may carry an inline copy of the onion/origin validation logic.
// We match on unmistakable *code* signatures (a regex char class / length
// quantifier / URL-parsing calls) — never prose — so mentions of ".onion"
// or "base32" in comments do not trip the guard.
const WORKFLOWS = [
  ".github/workflows/release.yml",
  ".github/workflows/void-client-sri.yml",
];

// Each entry: [human label, RegExp that only an inline validator copy hits].
const INLINE_VALIDATOR_SIGNATURES = [
  ["onion base32 char class [a-z2-7]", /\[a-z2-7\]/],
  ["onion v3 length quantifier {56}", /\{56\}/],
  ["inline URL parsing (new URL(...))", /new URL\(/],
  ["inline URL .protocol check", /\.protocol\b/],
  ["inline URL .pathname check", /\.pathname\b/],
];

for (const wf of WORKFLOWS) {
  const text = readFileSync(join(REPO_ROOT, wf), "utf8");

  assert(
    text.includes("scripts/preflight-build-vars.mjs"),
    `${wf}: still invokes the shared scripts/preflight-build-vars.mjs`,
  );

  for (const [label, re] of INLINE_VALIDATOR_SIGNATURES) {
    assert(
      !re.test(text),
      `${wf}: carries NO inline onion/origin validation (${label})`,
    );
  }
}

if (failures > 0) {
  process.stderr.write(`\n${failures} assertion(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("\nall preflight-build-vars tests passed\n");
  process.exit(0);
}
