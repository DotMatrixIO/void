// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Agent-surface regression guard (formerly the publish-boundary check).
//
// VOID was made a single, fully agent-free product: the agent-to-agent
// protocol, the headless SDK, the research spike, the coordination demo, the
// `/agents` page, and the dormant `ENABLE_AGENT_ROOMS` / `void-secret:` room
// plumbing were all removed. This guard makes that removal a one-way door — it
// fails the build if any agent surface is reintroduced, whether as a restored
// package, a source-level import of a deleted agent package, or a resurrected
// agent feature flag / invite grammar in the protected human/shared surface.
//
// It fails if any of the following is true:
//   (a) any deleted agent tree exists again on disk — lib/agent-protocol,
//       lib/void-agent-sdk, lib/agent-spike, or
//       artifacts/coordination-demo-video;
//   (b) any source file under artifacts/ or lib/ imports a deleted agent
//       package — @workspace/agent-protocol, @workspace/void-agent-sdk, or
//       @workspace/agent-spike;
//   (c) the literal "ENABLE_AGENT_ROOMS" or "void-secret:" reappears in the
//       protected source — artifacts/void-client/src, artifacts/api-server/src,
//       or lib/wire-core/src.
//
// Run via: pnpm --filter @workspace/scripts run check:publish-boundary

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// (a) Agent trees that must stay deleted. Paths are relative to the repo root.
const FORBIDDEN_PATHS = [
  "lib/agent-protocol",
  "lib/void-agent-sdk",
  "lib/agent-spike",
  "artifacts/coordination-demo-video",
];

// (b) Deleted agent packages that no source file may import.
const FORBIDDEN_PACKAGES = [
  "@workspace/agent-protocol",
  "@workspace/void-agent-sdk",
  "@workspace/agent-spike",
];

// Roots scanned for forbidden agent-package imports.
const IMPORT_SCAN_ROOTS = ["artifacts", "lib"];

// (c) Agent feature-flag / invite grammar literals that must not reappear in
// the protected human/shared surface.
const FORBIDDEN_LITERALS = ["ENABLE_AGENT_ROOMS", "void-secret:"];
const PROTECTED_LITERAL_ROOTS = [
  "artifacts/void-client/src",
  "artifacts/api-server/src",
  "lib/wire-core/src",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const violations = [];

function* walkSource(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".vite") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkSource(full);
    } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
      yield full;
    }
  }
}

// Match only real module specifiers — `from "x"`, `import "x"`, `import("x")`,
// `require("x")`, with an optional subpath — so prose / doc comments that merely
// name the package are not false positives. `\s*` spans newlines, so multiline
// `import(\n "x"\n)` / `require(\n "x"\n)` forms cannot evade the scan.
function importSpecifierRe(pkg) {
  const escaped = pkg.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
  return new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*["']${escaped}(?:/[^"']*)?["']`,
    "g",
  );
}

const IMPORT_RES = FORBIDDEN_PACKAGES.map((pkg) => ({ pkg, re: importSpecifierRe(pkg) }));

// (a) No deleted agent tree may exist again.
for (const p of FORBIDDEN_PATHS) {
  if (existsSync(join(REPO_ROOT, p))) {
    violations.push(`agent tree "${p}" exists — it was deleted and must not be reintroduced.`);
  }
}

// (b) No source file may import a deleted agent package.
for (const root of IMPORT_SCAN_ROOTS) {
  for (const file of walkSource(join(REPO_ROOT, root))) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { pkg, re } of IMPORT_RES) {
      if (!text.includes(pkg)) continue;
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(text)) !== null) {
        const lineNo = text.slice(0, match.index).split("\n").length;
        const rel = file.slice(REPO_ROOT.length + 1);
        violations.push(`${rel}:${lineNo} imports "${pkg}" — ${match[0].replace(/\s+/g, " ").trim()}`);
      }
    }
  }
}

// (c) No agent feature-flag / invite-grammar literal may reappear in the
// protected source.
for (const root of PROTECTED_LITERAL_ROOTS) {
  for (const file of walkSource(join(REPO_ROOT, root))) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const literal of FORBIDDEN_LITERALS) {
      let idx = text.indexOf(literal);
      while (idx !== -1) {
        const lineNo = text.slice(0, idx).split("\n").length;
        const rel = file.slice(REPO_ROOT.length + 1);
        violations.push(`${rel}:${lineNo} contains the agent literal "${literal}".`);
        idx = text.indexOf(literal, idx + literal.length);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `agent-surface guard FAILED: ${violations.length} agent-surface ` +
      `regression(s) found.\n`,
  );
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\nVOID is a single, fully agent-free product. The agent packages, the ` +
      `coordination demo, the ENABLE_AGENT_ROOMS flag, and the "void-secret:" ` +
      `invite grammar were removed on purpose. If you genuinely need to revive ` +
      `the agent product, restore it from the archive ref documented in the ` +
      `internal revival doc rather than re-adding it piecemeal here.`,
  );
  process.exit(1);
}

console.log(
  `agent-surface guard passed: no deleted agent tree exists, no source under ` +
    `${IMPORT_SCAN_ROOTS.join(", ")} imports a removed agent package, and the ` +
    `protected surface (${PROTECTED_LITERAL_ROOTS.join(", ")}) carries no ` +
    `agent feature-flag or invite-grammar literal.`,
);
