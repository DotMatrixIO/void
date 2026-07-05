#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: assert that the HTTP-surface scope described in
// VOID_TECHNICAL_OVERVIEW.md §2 ("Spec Discovery Endpoints") matches the
// paths actually defined in `lib/api-spec/openapi.yaml`, and that the doc
// never regresses to describing the spec as "minimal — only /healthz"
// (the contradiction Task #865 fixed by hand).
//
// This is the OpenAPI sibling of the AsyncAPI signaling drift check at
// `lib/api-spec/scripts/check-asyncapi-drift.mjs` and the routes-table
// drift check at
// `artifacts/void-client/scripts/check-routes-overview-drift.mjs`. It
// catches the case where a developer adds (or removes) an HTTP route in
// openapi.yaml without updating the overview's enumerated surface, and the
// symmetric case where the overview lists an endpoint the spec no longer
// defines.
//
// The §2 table abbreviates the surface (e.g. it collapses the four
// `/paywall/*` routes into a single `/paywall/*` token), so coverage is
// matched with wildcard support rather than by exact set equality. Alias
// operations (operationId ending in "Alias", e.g. `/health` aliasing
// `/healthz`) are excluded from the required set — the doc is free to list
// only the canonical path.
//
// Run via:
//
//     pnpm --filter @workspace/api-spec run check-overview-http
//
// Wired into CI on `.github/workflows/api-spec-drift.yml` and into the local
// `marketing-voice` validation workflow in `.replit`.

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "..", "openapi.yaml");
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const OVERVIEW_PATH = resolve(REPO_ROOT, "VOID_TECHNICAL_OVERVIEW.md");

// Phrasing the overview must never use to describe the OpenAPI scope. Task
// #865 fixed a "minimal — only /healthz" description that contradicted the
// "full public HTTP surface" framing elsewhere in the same doc. Any of these
// re-appearing is an immediate fail regardless of the structural check below.
const BANNED_PHRASE_PATTERNS = [
  {
    re: /\bonly\s+`?\/health/i,
    label: '"only /healthz" (or "only `/healthz`")',
  },
  {
    re: /\bminimal\b[^.\n]*\/health/i,
    label: '"minimal … /healthz"',
  },
];

// The overview's §2 openapi.yaml row must keep this positive framing, so the
// scope statement can't be silently dropped to nothing.
const REQUIRED_SCOPE_PHRASE = "full public HTTP surface";

// Pull the top-level path keys out of openapi.yaml, dropping pure alias
// operations. A path is treated as an alias (and therefore not required to
// appear in the doc's enumerated surface) when every operation defined on it
// has an `operationId` ending in "Alias" — e.g. `/health` → `healthCheckAlias`,
// which the spec documents as "Identical to /healthz".
async function extractSpecPaths() {
  const text = await readFile(SPEC_PATH, "utf8");
  const doc = parseYaml(text);
  const paths = doc?.paths;
  if (!paths || typeof paths !== "object") {
    throw new Error(
      `No \`paths:\` map found in ${relative(REPO_ROOT, SPEC_PATH)}.`,
    );
  }

  const HTTP_METHODS = new Set([
    "get",
    "put",
    "post",
    "delete",
    "patch",
    "options",
    "head",
    "trace",
  ]);

  const required = new Set();
  const aliases = new Set();
  for (const [pathKey, item] of Object.entries(paths)) {
    const ops = Object.entries(item ?? {}).filter(([m]) =>
      HTTP_METHODS.has(m.toLowerCase()),
    );
    const isAlias =
      ops.length > 0 &&
      ops.every(([, op]) => /Alias$/.test(op?.operationId ?? ""));
    if (isAlias) {
      aliases.add(pathKey);
    } else {
      required.add(pathKey);
    }
  }
  return { required, aliases };
}

// Pull the enumerated endpoint tokens out of the overview's §2 "Spec
// Discovery Endpoints" table — specifically the row whose first cell names
// `GET /api/openapi.yaml`. Returns `{ tokens, rowText }` where `tokens` is
// the list of backtick-wrapped paths that start with "/" (the
// `(/healthz, /paywall/*, …)` enumeration), dropping the `GET /api/...`
// cell which starts with "GET ".
async function extractOverviewTokens() {
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
    (l) =>
      l.startsWith("|") &&
      /\/api\/openapi\.yaml/.test(l) &&
      !/\/api\/asyncapi\.yaml/.test(l),
  );
  if (!rowText) {
    throw new Error(
      `Found "Spec Discovery Endpoints" but no \`GET /api/openapi.yaml\` ` +
        `table row inside it. The OpenAPI surface enumeration must live in ` +
        `that row.`,
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

// True when doc token `token` (exact path or `<prefix>/*` wildcard) covers
// the concrete spec path `specPath`.
function tokenCoversPath(token, specPath) {
  if (token === specPath) return true;
  if (token.endsWith("/*")) {
    const prefix = token.slice(0, -1); // keep the trailing slash: "/paywall/"
    return specPath.startsWith(prefix);
  }
  return false;
}

async function main() {
  const [{ required, aliases }, { tokens, rowText }] = await Promise.all([
    extractSpecPaths(),
    extractOverviewTokens(),
  ]);

  const errors = [];

  // 1. Banned-phrase regression guard (whole doc).
  const wholeDoc = await readFile(OVERVIEW_PATH, "utf8");
  for (const { re, label } of BANNED_PHRASE_PATTERNS) {
    if (re.test(wholeDoc)) {
      errors.push(
        `VOID_TECHNICAL_OVERVIEW.md contains banned scope phrasing ${label}. ` +
          `The OpenAPI spec covers the full public HTTP surface, not just ` +
          `/healthz — describe it accordingly (this is the Task #865 ` +
          `contradiction).`,
      );
    }
  }

  // 2. The §2 openapi.yaml row must keep the positive scope framing.
  if (!rowText.includes(REQUIRED_SCOPE_PHRASE)) {
    errors.push(
      `The §2 "Spec Discovery Endpoints" \`GET /api/openapi.yaml\` row no ` +
        `longer states it describes the "${REQUIRED_SCOPE_PHRASE}". Keep ` +
        `that framing so the spec's scope stays unambiguous.`,
    );
  }

  // 3. Every required spec path must be covered by some doc token.
  for (const specPath of required) {
    const covered = tokens.some((t) => tokenCoversPath(t, specPath));
    if (!covered) {
      errors.push(
        `openapi.yaml defines path "${specPath}" but it is not listed in ` +
          `the VOID_TECHNICAL_OVERVIEW.md §2 spec-discovery enumeration. ` +
          `Add it (or a covering "<prefix>/*" token) to the ` +
          `\`GET /api/openapi.yaml\` row.`,
      );
    }
  }

  // 4. Every doc token must cover at least one required spec path — no stale
  //    entries advertising endpoints the spec no longer defines.
  for (const token of tokens) {
    const matchesRequired = [...required].some((p) =>
      tokenCoversPath(token, p),
    );
    if (matchesRequired) continue;
    // A token may legitimately point at an alias path (e.g. if someone lists
    // `/health` explicitly). Only flag it when it matches nothing at all.
    const matchesAlias = [...aliases].some((p) => tokenCoversPath(token, p));
    if (matchesAlias) continue;
    errors.push(
      `VOID_TECHNICAL_OVERVIEW.md §2 lists endpoint "${token}" but no ` +
        `matching path is defined in lib/api-spec/openapi.yaml. Remove the ` +
        `stale token from the \`GET /api/openapi.yaml\` row, or add the ` +
        `path to the spec.`,
    );
  }

  if (errors.length > 0) {
    console.error("[check-overview-http-drift] FAIL");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  const aliasNote =
    aliases.size > 0
      ? ` (${aliases.size} alias path(s) skipped: ${[...aliases].sort().join(", ")})`
      : "";
  console.log(
    `[check-overview-http-drift] OK — ${required.size} HTTP path(s) in ` +
      `openapi.yaml, ${tokens.length} endpoint token(s) in ` +
      `VOID_TECHNICAL_OVERVIEW.md §2 spec-discovery enumeration${aliasNote}.`,
  );
}

main().catch((err) => {
  console.error(`[check-overview-http-drift] failed: ${err.stack ?? err}`);
  process.exit(1);
});
