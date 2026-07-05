#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Lint: enumerate every `<Route path="...">` declaration in
// artifacts/void-client/src/App.tsx and diff the resulting set of
// production-facing route paths against the route names listed in
// VOID_TECHNICAL_OVERVIEW.md §6.2 ("Page Structure").
//
// This is the routes-table sibling of the AsyncAPI signaling drift
// check at `lib/api-spec/scripts/check-asyncapi-drift.mjs`. It catches
// the case where a developer adds a new route to the void-client
// router (or hides one) without updating the technical-overview prose,
// and the symmetric case where the overview lists a route that no
// longer exists in code without an explicit "Hidden in vX" / footnoted
// gating note.
//
// DEV-gated routes (declared inside `{import.meta.env.DEV && (...)}`)
// are skipped — they are not part of the v0.5 public surface and the
// overview's §6.2 routes table deliberately omits them.
//
// Run via:
//
//     pnpm --filter @workspace/void-client run check:routes-overview
//
// Wired into CI as an additional step on `.github/workflows/asyncapi-spec-drift.yml`
// and into the local `marketing-voice` validation workflow in `.replit`.

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");
const APP_PATH = resolve(CLIENT_ROOT, "src/App.tsx");
const OVERVIEW_PATH = resolve(REPO_ROOT, "VOID_TECHNICAL_OVERVIEW.md");

// Pull every `<Route path="..."` (single, double, or backtick quoted) out of
// App.tsx, classifying each as production or DEV-gated. We deliberately do
// NOT inspect `<Route component={...}>` (catch-all) entries — those are not
// addressable paths and the §6.2 table covers them via the "(any unmatched)"
// row.
async function extractCodeRoutes() {
  const text = await readFile(APP_PATH, "utf8");
  const lines = text.split("\n");
  const routes = new Map(); // path -> { devOnly: boolean }
  const ROUTE_RE = /<Route\s+[^>]*?path=(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = ROUTE_RE.exec(text)) !== null) {
    const path = m[2];
    // Find the line index of the match so we can scan a small window of
    // preceding lines for a DEV-only conditional. The current pattern in
    // App.tsx is:
    //   {import.meta.env.DEV && (
    //     <Route path="/still/:variant" component={StillPoster} />
    //   )}
    // A 5-line lookback is wide enough for that block while staying narrow
    // enough not to false-positive on an unrelated DEV branch elsewhere in
    // the same render tree.
    const upTo = text.slice(0, m.index);
    const lineIdx = upTo.split("\n").length - 1;
    const window = lines
      .slice(Math.max(0, lineIdx - 5), lineIdx)
      .join("\n");
    const devOnly = /import\.meta\.env\.DEV\s*&&/.test(window);
    routes.set(path, { devOnly });
  }
  return routes;
}

// Pull route entries out of `VOID_TECHNICAL_OVERVIEW.md` §6.2 ("Page
// Structure"). Returns a Map keyed by the literal route path (e.g. `/why`,
// `/proof/server-state`) with `{ hidden, raw }` metadata. `hidden` is true
// when the row is struck-through (`~~`/.../`~~`) OR the purpose cell carries
// a "Hidden in v…" / "deferred" gating note — both signals mean the
// overview is asserting "this row is intentionally not in the production
// router right now".
async function extractOverviewRoutes() {
  const text = await readFile(OVERVIEW_PATH, "utf8");
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => /^###\s+6\.2(\s|$)/.test(l));
  if (startIdx === -1) {
    throw new Error(
      `Could not find the "### 6.2" section header in ` +
        `${relative(REPO_ROOT, OVERVIEW_PATH)}. Did the overview's ` +
        `section numbering change?`,
    );
  }
  const endRel = lines
    .slice(startIdx + 1)
    .findIndex((l) => /^###\s+6\.\d+/.test(l));
  const endIdx = endRel === -1 ? lines.length : startIdx + 1 + endRel;
  const section = lines.slice(startIdx, endIdx);

  const routes = new Map();
  for (const line of section) {
    if (!line.startsWith("|")) continue;
    // Skip the header row and the markdown alignment separator
    // (`|---|---|---|`).
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    if (/^\|\s*Route\s*\|/i.test(line)) continue;

    // Split into table cells. Leading and trailing pipes produce empty
    // segments at both ends, so trim them off.
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;

    const routeCell = cells[0];
    const purposeCell = cells[2] ?? "";

    // The catch-all NotFound row reads "(any unmatched)" — no addressable
    // path, no drift signal.
    if (/^\(/.test(routeCell)) continue;

    const hidden =
      routeCell.includes("~~") ||
      /\bhidden in v/i.test(purposeCell) ||
      /\bdeferred\b/i.test(purposeCell);

    // Pull the literal route out of backticks. Strip strikethrough wrappers
    // first so e.g. `~~`/agents`~~` still yields `/agents`.
    const cleaned = routeCell.replace(/~~/g, "");
    const codeMatch = cleaned.match(/`([^`]+)`/);
    if (!codeMatch) continue;
    routes.set(codeMatch[1], { hidden, raw: routeCell });
  }
  return routes;
}

async function main() {
  const [codeRoutes, overviewRoutes] = await Promise.all([
    extractCodeRoutes(),
    extractOverviewRoutes(),
  ]);

  // Production-facing routes only (DEV-gated dropped).
  const codeProd = new Set(
    [...codeRoutes.entries()]
      .filter(([, v]) => !v.devOnly)
      .map(([k]) => k),
  );
  const codeDev = [...codeRoutes.entries()]
    .filter(([, v]) => v.devOnly)
    .map(([k]) => k);

  const errors = [];

  // 1. Code → overview drift. Every production-facing <Route path="X"> in
  //    App.tsx must have a matching row in §6.2, and that row must NOT be
  //    marked hidden (struck-through / "Hidden in vX") — otherwise the
  //    overview is asserting "this is gated out" while the router still
  //    serves it.
  for (const path of codeProd) {
    const overview = overviewRoutes.get(path);
    if (!overview) {
      errors.push(
        `Route "${path}" is registered in artifacts/void-client/src/App.tsx ` +
          `but has no row in VOID_TECHNICAL_OVERVIEW.md §6.2. ` +
          `Add a row to the §6.2 routes table, or remove the <Route> from ` +
          `App.tsx.`,
      );
    } else if (overview.hidden) {
      errors.push(
        `Route "${path}" is registered (and not DEV-gated) in App.tsx but ` +
          `the §6.2 row is struck-through / marked "Hidden in vX". ` +
          `Either un-strike the row in the overview, or remove the route ` +
          `from the router so it actually matches the documented surface.`,
      );
    }
  }

  // 2. Overview → code drift. Every row in §6.2 must either correspond to a
  //    production route in App.tsx, OR be explicitly marked hidden /
  //    deferred. A bare row with no matching <Route> means the overview is
  //    advertising a page that no longer exists.
  for (const [path, meta] of overviewRoutes) {
    if (codeProd.has(path)) continue;
    if (meta.hidden) continue;
    errors.push(
      `Route "${path}" is listed in VOID_TECHNICAL_OVERVIEW.md §6.2 but no ` +
        `matching <Route path="${path}"> exists in artifacts/void-client/src/App.tsx. ` +
        `Either remove the row from §6.2, mark it as hidden ` +
        `(strike-through with a "Hidden in vX" note in the purpose cell), ` +
        `or add the route back to the router.`,
    );
  }

  if (errors.length > 0) {
    console.error("[check-routes-overview-drift] FAIL");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }

  const visible = [...overviewRoutes.values()].filter((v) => !v.hidden).length;
  const hidden = overviewRoutes.size - visible;
  console.log(
    `[check-routes-overview-drift] OK — ${codeProd.size} production route(s) ` +
      `in App.tsx, ${visible} visible row(s) and ${hidden} hidden row(s) in ` +
      `VOID_TECHNICAL_OVERVIEW.md §6.2` +
      (codeDev.length > 0
        ? ` (${codeDev.length} DEV-gated route(s) skipped: ${codeDev.join(", ")}).`
        : "."),
  );
}

main().catch((err) => {
  console.error(`[check-routes-overview-drift] failed: ${err.stack ?? err}`);
  process.exit(1);
});
