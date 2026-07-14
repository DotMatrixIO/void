#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: assert that the signaling-spec scope described in
// VOID_TECHNICAL_OVERVIEW.md §2 ("Spec Discovery Endpoints") matches the
// realtime surface actually defined in `lib/api-spec/asyncapi.yaml` —
// specifically the AsyncAPI document version and the Socket.io mount path
// (`pathname:` on the `servers:` block).
//
// This is the AsyncAPI sibling of the OpenAPI HTTP-surface drift check at
// `lib/api-spec/scripts/check-overview-http-drift.mjs`. Where that script
// guards the §2 `GET /api/openapi.yaml` row, this one guards the §2
// `GET /api/asyncapi.yaml` row, whose prose ("AsyncAPI 3.0 YAML — describes
// the bidirectional Socket.io signaling channel at `/api/socket.io`") could
// otherwise drift from the spec without anything failing.
//
// The existing `check-asyncapi-drift.mjs` diffs channel *addresses* against
// the api-server / void-client source; it never reads the overview. So a
// developer who bumps the AsyncAPI version, or remounts Socket.io at a new
// path in asyncapi.yaml, leaves the overview's §2 row silently stale. This
// check closes that gap.
//
// Run via:
//
//     pnpm --filter @workspace/api-spec run check-overview-asyncapi
//
// Wired into CI on `.github/workflows/api-spec-drift.yml` and into the local
// `overview-http-drift` validation workflow in `.replit`.

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "..", "asyncapi.yaml");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OVERVIEW_PATH = resolve(REPO_ROOT, "VOID_TECHNICAL_OVERVIEW.md");

// The §2 asyncapi.yaml row must keep this positive framing, so the scope
// statement can't be silently dropped to nothing.
const REQUIRED_SCOPE_PHRASE = "signaling channel";

// Pull the structural facts the §2 row asserts out of asyncapi.yaml:
//   - `versionMinor`: the AsyncAPI document version reduced to `major.minor`
//     (e.g. "3.0" from "3.0.0"), which the doc quotes as "AsyncAPI 3.0 YAML".
//   - `pathnames`: the distinct Socket.io mount path(s) declared under
//     `servers[*].pathname` (e.g. `/api/socket.io`), which the doc quotes as
//     the channel mount point.
async function extractSpecMeta() {
  const text = await readFile(SPEC_PATH, "utf8");
  const doc = parseYaml(text);

  const rawVersion = doc?.asyncapi;
  if (typeof rawVersion !== "string") {
    throw new Error(
      `No top-level \`asyncapi:\` version string found in ` +
        `${relative(REPO_ROOT, SPEC_PATH)}.`,
    );
  }
  const vMatch = /^(\d+)\.(\d+)/.exec(rawVersion);
  if (!vMatch) {
    throw new Error(
      `Could not parse a \`major.minor\` version from \`asyncapi: ` +
        `${rawVersion}\` in ${relative(REPO_ROOT, SPEC_PATH)}.`,
    );
  }
  const versionMinor = `${vMatch[1]}.${vMatch[2]}`;

  const servers = doc?.servers;
  if (!servers || typeof servers !== "object") {
    throw new Error(
      `No \`servers:\` map found in ${relative(REPO_ROOT, SPEC_PATH)}; ` +
        `cannot determine the Socket.io mount path.`,
    );
  }
  const pathnames = new Set();
  for (const srv of Object.values(servers)) {
    const p = srv?.pathname;
    if (typeof p === "string" && p.startsWith("/")) pathnames.add(p);
  }
  if (pathnames.size === 0) {
    throw new Error(
      `No \`servers[*].pathname\` mount path found in ` +
        `${relative(REPO_ROOT, SPEC_PATH)}.`,
    );
  }
  return { versionMinor, pathnames };
}

// Pull the §2 "Spec Discovery Endpoints" table row whose first cell names
// `GET /api/asyncapi.yaml`. Returns `{ tokens, rowText }` where `tokens` is
// the list of backtick-wrapped paths that start with "/" (the
// `/api/socket.io` mount-path reference), dropping the leading
// `GET /api/asyncapi.yaml` cell which starts with "GET ".
async function extractOverviewRow() {
  const text = await readFile(OVERVIEW_PATH, "utf8");
  const lines = text.split("\n");

  const startIdx = lines.findIndex((l) =>
    /^#+\s+Spec Discovery Endpoints\s*$/i.test(l),
  );
  if (startIdx === -1) {
    throw new Error(
      `Could not find the "Spec Discovery Endpoints" section header in ` +
        `${relative(REPO_ROOT, OVERVIEW_PATH)}. Did the overview's §2 ` +
        `structure change?`,
    );
  }
  // The section ends at the next markdown header of any level.
  const endRel = lines.slice(startIdx + 1).findIndex((l) => /^#+\s/.test(l));
  const endIdx = endRel === -1 ? lines.length : startIdx + 1 + endRel;
  const section = lines.slice(startIdx, endIdx);

  const rowText = section.find(
    (l) => l.startsWith("|") && /\/api\/asyncapi\.yaml/.test(l),
  );
  if (!rowText) {
    throw new Error(
      `Found "Spec Discovery Endpoints" but no \`GET /api/asyncapi.yaml\` ` +
        `table row inside it. The signaling-spec scope description must live ` +
        `in that row.`,
    );
  }

  const tokens = [];
  const tokenRe = /`([^`]+)`/g;
  let m;
  while ((m = tokenRe.exec(rowText)) !== null) {
    const t = m[1].trim();
    if (t.startsWith("/")) tokens.push(t);
  }
  return { tokens, rowText };
}

async function main() {
  const [{ versionMinor, pathnames }, { tokens, rowText }] = await Promise.all([
    extractSpecMeta(),
    extractOverviewRow(),
  ]);

  const errors = [];

  // 1. The §2 asyncapi.yaml row must keep the positive scope framing.
  if (!rowText.includes(REQUIRED_SCOPE_PHRASE)) {
    errors.push(
      `The §2 "Spec Discovery Endpoints" \`GET /api/asyncapi.yaml\` row no ` +
        `longer describes the "${REQUIRED_SCOPE_PHRASE}". Keep that framing ` +
        `so the realtime surface's scope stays unambiguous.`,
    );
  }

  // 2. The row must quote the AsyncAPI document version from asyncapi.yaml.
  const versionRe = new RegExp(
    // Escape backslashes before dots so no injected backslash survives
    // unescaped (CodeQL: incomplete string escaping). versionMinor comes
    // from asyncapi.yaml's `asyncapi:` field, e.g. "3.0".
    `AsyncAPI\\s+${versionMinor.replace(/\\/g, "\\\\").replace(/\./g, "\\.")}\\b`,
    "i",
  );
  if (!versionRe.test(rowText)) {
    errors.push(
      `The §2 \`GET /api/asyncapi.yaml\` row does not describe the spec as ` +
        `"AsyncAPI ${versionMinor}", but asyncapi.yaml declares ` +
        `\`asyncapi: ${versionMinor}.x\`. Update the row's version to match.`,
    );
  }

  // 3. Every Socket.io mount path declared in asyncapi.yaml must be quoted in
  //    the row — catches a remount (e.g. /api/socket.io → /api/ws) that the
  //    doc fails to track.
  for (const p of pathnames) {
    if (!tokens.includes(p)) {
      errors.push(
        `asyncapi.yaml mounts the Socket.io channel at "${p}" ` +
          `(servers[*].pathname) but the §2 \`GET /api/asyncapi.yaml\` row ` +
          `does not reference it. Update the row's mount path to match.`,
      );
    }
  }

  // 4. Every "/"-prefixed mount-path token in the row must correspond to a
  //    real asyncapi.yaml mount path — no stale path the spec no longer uses.
  for (const token of tokens) {
    if (!pathnames.has(token)) {
      errors.push(
        `The §2 \`GET /api/asyncapi.yaml\` row references mount path ` +
          `"${token}" but asyncapi.yaml declares no such ` +
          `\`servers[*].pathname\`. Remove the stale path from the row, or ` +
          `add it to the spec's servers block.`,
      );
    }
  }

  if (errors.length > 0) {
    console.error("[check-overview-asyncapi-drift] FAIL");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  console.log(
    `[check-overview-asyncapi-drift] OK — asyncapi.yaml is AsyncAPI ` +
      `${versionMinor} mounted at ${[...pathnames].sort().join(", ")}, ` +
      `matching the VOID_TECHNICAL_OVERVIEW.md §2 ` +
      `\`GET /api/asyncapi.yaml\` row.`,
  );
}

main().catch((err) => {
  console.error(
    `[check-overview-asyncapi-drift] failed: ${err.stack ?? err}`,
  );
  process.exit(1);
});
