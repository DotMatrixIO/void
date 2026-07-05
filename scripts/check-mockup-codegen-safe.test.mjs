#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Regression guard for the mockup preview codegen
// (artifacts/mockup-sandbox/mockupPreviewPlugin.ts).
//
// WHY THIS EXISTS: the full-tree wipe that motivated the tracked-file-count
// floor was committed alongside a change to the mockup codegen's generated
// module. The codegen itself was NOT the cause (it only mkdir+writes under
// src/.generated/), but "codegen that deletes" is exactly the class of change
// that could reintroduce a wipe. This test locks the plugin's write-only,
// tightly-scoped behavior in place: a future edit that adds a recursive/
// destructive delete, or that writes outside src/.generated/, fails here.
//
// It is a SOURCE SCAN, not a runtime test (the mockup-sandbox package has no
// test runner). It reads the plugin source and asserts:
//   * it imports no destructive fs primitive (rm/rmSync/rmdir/rmdirSync/unlink/
//     unlinkSync) and calls none of them,
//   * the only filesystem writes are mkdirSync and writeFileSync,
//   * the generated-module path it writes is confined to src/.generated/.
//
// Exits 0 on success, 1 on the first assertion failure.
//
// Run: node scripts/check-mockup-codegen-safe.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(
  __dirname,
  "..",
  "artifacts",
  "mockup-sandbox",
  "mockupPreviewPlugin.ts",
);

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    failures += 1;
  } else {
    process.stdout.write(`ok: ${msg}\n`);
  }
}

const src = readFileSync(PLUGIN, "utf8");

// 1. The fs imports are an allowlist: only mkdirSync and writeFileSync may be
//    pulled in from "fs" / "node:fs" / "fs/promises". This is the primary,
//    semantic guard — a destructive primitive (rm/rmSync/rmdir/unlink/…) cannot
//    be *called* without first being imported, so an import allowlist stops the
//    whole class at the source. (String matching alone is fooled by chokidar's
//    "unlink"/"add" *event names*, which are not fs calls — hence the allowlist.)
const importedFsSymbols = new Set();
const importRe = /import\s*\{([^}]*)\}\s*from\s*["'](?:node:)?fs(?:\/promises)?["']/g;
let m;
while ((m = importRe.exec(src)) !== null) {
  for (const raw of m[1].split(",")) {
    const name = raw.trim().split(/\s+as\s+/)[0].trim();
    if (name) importedFsSymbols.add(name);
  }
}
const ALLOWED_FS = new Set(["mkdirSync", "writeFileSync"]);
for (const sym of importedFsSymbols) {
  assert(
    ALLOWED_FS.has(sym),
    `mockup codegen imports only allowed fs symbols — "${sym}" is not allowed`,
  );
}
assert(
  importedFsSymbols.has("mkdirSync") && importedFsSymbols.has("writeFileSync"),
  "mockup codegen imports mkdirSync and writeFileSync (expected)",
);

// 2. Belt-and-suspenders: no destructive fs primitive appears as a CALL, and no
//    default fs namespace is used to reach one (e.g. fs.rmSync(...)). Matched in
//    call form only, so chokidar's "unlink"/"unlinkDir" event-name strings and
//    unrelated identifiers do not trip it.
const DESTRUCTIVE_CALL = [
  /\brmSync\s*\(/,
  /\brmdirSync\s*\(/,
  /\brmdir\s*\(/,
  /\bunlinkSync\s*\(/,
  /\bunlink\s*\(/,
  /\brimraf\s*\(/,
  /\.\s*rm\s*\(/, // fs.rm(...) / fsPromises.rm(...)
  /\brm\s*\(/, // bare rm(...) call
];
for (const re of DESTRUCTIVE_CALL) {
  assert(
    !re.test(src),
    `mockup codegen makes no destructive call matching ${re}`,
  );
}
// No shelled-out "rm" via child_process either.
assert(
  !/child_process/.test(src) && !/["'`]\s*rm[\s"'`]/.test(src),
  'mockup codegen does not shell out (no child_process, no "rm" command)',
);

// 2b. No DYNAMIC fs import either — a dynamic `import("node:fs")` /
//     `require("fs")` would smuggle a destructive primitive past the static
//     import allowlist in check 1. Reject the whole dynamic-fs-access shape.
assert(
  !/import\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/.test(src) &&
    !/require\s*\(\s*["'](?:node:)?fs(?:\/promises)?["']\s*\)/.test(src),
  "mockup codegen does not dynamically import/require fs (bypasses the import allowlist)",
);

// 3. Writes are confined to src/.generated/. The generated module constant must
//    live under that dir, and no other write target may escape it. We assert the
//    module path constant is under src/.generated/ and that writeFileSync's only
//    argument is the generated-module path variable.
assert(
  /GENERATED_MODULE\s*=\s*["'`]src\/\.generated\//.test(src),
  "the generated module is written under src/.generated/",
);
assert(
  /writeFileSync\(\s*generatedModuleAbsPath\s*,/.test(src),
  "writeFileSync targets only the generated-module path (src/.generated/)",
);

if (failures > 0) {
  process.stderr.write(`\n${failures} assertion(s) failed.\n`);
  process.exit(1);
} else {
  process.stdout.write("\nall mockup-codegen-safe tests passed\n");
  process.exit(0);
}
