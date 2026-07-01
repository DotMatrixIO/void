#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-threat-model-drift.mjs
 *
 * Three surfaces carry VOID's threat-model story:
 *
 *   1. `docs/threat-model.md` — server-side / shared properties, written for
 *      security researchers and a future external audit firm.
 *   2. `docs/client-threat-model.md` — parallel enumeration of attacker
 *      positions that materialise at the client (browser tab).
 *   3. `artifacts/void-client/src/pages/ThreatModelPage.tsx` — the
 *      plainspoken user-facing mirror.
 *
 * The drift policy in `docs/threat-model.md` §7 and `docs/client-threat-model.md`
 * §9 says all three must stay in sync on substantive claims. Today that is
 * enforced by reviewer attention only — Task #480 had to manually re-verify
 * that all three link to the other two. This script is the CI version of
 * that attention, in the same family as `check:server-observable-sync` and
 * `check:routes-overview`.
 *
 * It asserts:
 *
 *   A. All three surfaces link to the other two (path-literal cross-links).
 *   B. The set of enumerated attacker-position headings on
 *      `docs/client-threat-model.md` (`## 1. …` through `## 8. …`) matches
 *      the §9 "all eight enumerated here" promise, and §0.5 still names
 *      exactly three explicitly-excluded positions.
 *   C. The journalist-grade caveat literal appears on all three surfaces:
 *      each must mention "journalist-grade", a "not vetted" qualifier, and
 *      the unmet precondition (an external/human audit by an outside firm).
 *   D. The operator-correlation *root residual* and its two-manifestation
 *      structure are pinned in `docs/threat-model.md`. §0.1 must still state
 *      the single root sentence ("minimizes but does not eliminate
 *      operator-side correlation", "the trust boundary is the operator",
 *      "not an anonymizing system") and frame the two residuals as one root
 *      assumption with two concrete manifestations; and §1.1 / §1.2 must each
 *      stay tagged as an "instance of the §0.1 root residual". This stops a
 *      future edit from quietly softening or dropping the root sentence on
 *      one surface, or un-tagging a manifestation, while still passing CI.
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:threat-model-drift
 *
 * Wired into CI as an additional step on `.github/workflows/asyncapi-spec-drift.yml`
 * (same file the routes-overview drift gate rides on), and into the local
 * `marketing-voice` validation workflow in `.replit` alongside the existing
 * drift checks.
 */

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const SERVER_DOC = resolve(REPO_ROOT, "docs/threat-model.md");
const CLIENT_DOC = resolve(REPO_ROOT, "docs/client-threat-model.md");
const PAGE = resolve(CLIENT_ROOT, "src/pages/ThreatModelPage.tsx");

const SERVER_DOC_REL = "docs/threat-model.md";
const CLIENT_DOC_REL = "docs/client-threat-model.md";
const PAGE_REL = "artifacts/void-client/src/pages/ThreatModelPage.tsx";
const PAGE_BASENAME = "ThreatModelPage.tsx";

async function main() {
  const [server, client, page] = await Promise.all([
    readFile(SERVER_DOC, "utf8"),
    readFile(CLIENT_DOC, "utf8"),
    readFile(PAGE, "utf8"),
  ]);

  const errors = [];

  // -- A. Cross-link check ---------------------------------------------------
  // Each surface must reference the other two by their canonical path
  // literal. The page uses the basename (`ThreatModelPage.tsx`) when it
  // refers to itself from the docs, so we accept either the full path or
  // the basename on the docs side.
  const linkRules = [
    {
      name: SERVER_DOC_REL,
      text: server,
      requires: [
        { label: CLIENT_DOC_REL, accept: [CLIENT_DOC_REL] },
        { label: PAGE_REL, accept: [PAGE_REL, PAGE_BASENAME] },
      ],
    },
    {
      name: CLIENT_DOC_REL,
      text: client,
      requires: [
        { label: SERVER_DOC_REL, accept: [SERVER_DOC_REL] },
        { label: PAGE_REL, accept: [PAGE_REL, PAGE_BASENAME] },
      ],
    },
    {
      name: PAGE_REL,
      text: page,
      requires: [
        { label: SERVER_DOC_REL, accept: [SERVER_DOC_REL] },
        { label: CLIENT_DOC_REL, accept: [CLIENT_DOC_REL] },
      ],
    },
  ];
  for (const { name, text, requires } of linkRules) {
    for (const { label, accept } of requires) {
      if (!accept.some((needle) => text.includes(needle))) {
        errors.push(
          `${name} is missing a reference to ${label}. All three ` +
            `threat-model surfaces must cross-link to the other two ` +
            `(see ${SERVER_DOC_REL} §7 / ${CLIENT_DOC_REL} §9 drift policy).`,
        );
      }
    }
  }

  // -- B. Attacker-position enumeration --------------------------------------
  // §9 says: "the rule applies to all eight enumerated here". Pull every
  // `## N. Title` heading where N is 1..8 from the client doc and confirm
  // we still have exactly that set.
  const positions = [];
  for (const line of client.split("\n")) {
    const m = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 1 && n <= 8) {
      positions.push({ n, title: m[2].trim() });
    }
  }
  const nums = positions.map((p) => p.n).sort((a, b) => a - b);
  const expected = [1, 2, 3, 4, 5, 6, 7, 8];
  const matchesExpected =
    nums.length === expected.length &&
    nums.every((v, i) => v === expected[i]);
  if (!matchesExpected) {
    errors.push(
      `${CLIENT_DOC_REL} enumerates attacker positions [${nums.join(", ")}]; ` +
        `§9 drift policy promises "all eight enumerated here". Either ` +
        `restore the dropped section(s) under "## N. ..." headings, or ` +
        `update both §9 and this drift check in the same commit.`,
    );
  }

  // §9 must still literally say "all eight" — the count is the load-bearing
  // claim a reviewer looks for.
  if (!/\ball eight\b/i.test(client)) {
    errors.push(
      `${CLIENT_DOC_REL} §9 no longer contains the literal phrase ` +
        `"all eight". If the attacker-position count changed, update §9's ` +
        `prose and this drift check together; otherwise restore the ` +
        `literal so reviewers can find the promise.`,
    );
  }

  // §0.5 enumerates exactly three explicitly-excluded positions. The
  // section ends at the next `---` rule.
  const covMatch = client.match(/###\s+0\.5[\s\S]*?(?=\n---\s*$)/m);
  if (!covMatch) {
    errors.push(
      `${CLIENT_DOC_REL} is missing §0.5 ("Coverage notes — explicitly ` +
        `excluded from this version"). The drift check relies on this ` +
        `section being present so reviewers can tell silence from ` +
        `intentional exclusion.`,
    );
  } else {
    const exclItems = (covMatch[0].match(/^\d+\.\s+\*\*/gm) || []).length;
    if (exclItems !== 3) {
      errors.push(
        `${CLIENT_DOC_REL} §0.5 enumerates ${exclItems} explicitly-` +
          `excluded position(s); the section documents exactly three. ` +
          `Either add the missing item(s) or update §0.5's framing.`,
      );
    }
  }

  // -- C. Journalist-grade caveat literal ------------------------------------
  // Each surface phrases this differently — the docs say "not vetted,
  // today, as a journalist-grade tool"; the page says "not 'vetted for
  // life-safety use'". Rather than pin one wording, require the three
  // load-bearing tokens to co-occur on every surface.
  const caveatChecks = [
    { name: SERVER_DOC_REL, text: server },
    { name: CLIENT_DOC_REL, text: client },
    { name: PAGE_REL, text: page },
  ];
  for (const { name, text } of caveatChecks) {
    if (!/journalist-grade/i.test(text)) {
      errors.push(
        `${name} no longer contains the phrase "journalist-grade". The ` +
          `drift policy requires all three surfaces to carry the ` +
          `journalist-grade caveat.`,
      );
      continue;
    }
    if (!/\bvetted\b/i.test(text)) {
      errors.push(
        `${name} mentions "journalist-grade" but no "vetted" qualifier. ` +
          `The caveat must state that VOID is not vetted today as a ` +
          `journalist-grade tool.`,
      );
    }
    if (
      !/(external|outside)\s+(?:\w+\s+){0,2}(audit|firm)/i.test(text) &&
      !/human\s+audit/i.test(text)
    ) {
      errors.push(
        `${name} mentions "journalist-grade" but does not name the unmet ` +
          `precondition (an external / human audit by an outside firm). ` +
          `The caveat must state that the journalist-grade claim requires ` +
          `both audit fixes shipping AND an external human audit.`,
      );
    }
  }

  // -- D. Operator-correlation root residual & two-manifestation structure ---
  // The whole point of §0.1 is that there is ONE root residual (the operator
  // sits in a correlation position the code can narrow but not close), and the
  // two operator-correlation disclosures (§1.1 in-memory IP↔room, §1.2
  // TOR_ONLY relay traffic-correlation) are *instances* of it, not three
  // separate surprises. A future edit could soften the root sentence, drop the
  // "not an anonymizing system" line, or un-tag a manifestation on this surface
  // and still pass the rest of this script. Pin the load-bearing literals.

  // Extract the §0.1 block: from its heading to the next `---` rule (or, as a
  // fallback, the next `### ` / `## ` heading).
  const rootSection = (() => {
    const start = server.search(/^###\s+0\.1\b.*$/m);
    if (start < 0) return null;
    // Begin scanning for the terminator *after* the heading line so the
    // heading's own `###` doesn't match the heading fallback below.
    const afterHeading = server.indexOf("\n", start);
    if (afterHeading < 0) return server.slice(start);
    const rest = server.slice(afterHeading + 1);
    const endRel = rest.search(/^(?:---\s*$|##+\s)/m);
    const body = endRel < 0 ? rest : rest.slice(0, endRel);
    return server.slice(start, afterHeading + 1) + body;
  })();

  if (!rootSection) {
    errors.push(
      `${SERVER_DOC_REL} is missing §0.1 ("The operator-correlation root ` +
        `residual"). This is the single root sentence the two operator-` +
        `correlation residuals (§1.1, §1.2) are tagged as instances of; the ` +
        `drift check relies on it being present so the root assumption can't ` +
        `quietly disappear from one surface.`,
    );
  } else {
    // The three load-bearing clauses of the root sentence.
    const rootLiterals = [
      {
        re: /minimizes but does not eliminate operator-side correlation/i,
        what:
          `the "minimizes but does not eliminate operator-side correlation" ` +
          `root clause`,
      },
      {
        re: /trust boundary is the operator/i,
        what: `the "the trust boundary is the operator" clause`,
      },
      {
        re: /not an anonymizing system/i,
        what: `the "VOID is not an anonymizing system" clause`,
      },
    ];
    for (const { re, what } of rootLiterals) {
      if (!re.test(rootSection)) {
        errors.push(
          `${SERVER_DOC_REL} §0.1 no longer states ${what}. The operator-` +
            `correlation root residual must keep all three clauses so it can't ` +
            `be softened on one surface while passing CI. Restore the wording, ` +
            `or update §0.1, §1.1, §1.2 and this drift check in the same commit.`,
        );
      }
    }

    // The two-manifestation framing: one root assumption, two concrete
    // manifestations that point at §1.1 and §1.2.
    if (!/single root assumption/i.test(rootSection)) {
      errors.push(
        `${SERVER_DOC_REL} §0.1 no longer frames the residual as the ` +
          `"single root assumption" beneath the two operator-correlation ` +
          `residuals. Keep the framing so §1.1/§1.2 read as instances, not ` +
          `standalone surprises.`,
      );
    }
    if (!/two concrete manifestations/i.test(rootSection)) {
      errors.push(
        `${SERVER_DOC_REL} §0.1 no longer describes §1.1 and §1.2 as ` +
          `"two concrete manifestations" of one underlying residual. Restore ` +
          `the two-manifestation structure or update §0.1 and this check ` +
          `together.`,
      );
    }
    for (const ref of ["§1.1", "§1.2"]) {
      if (!rootSection.includes(ref)) {
        errors.push(
          `${SERVER_DOC_REL} §0.1 no longer points at ${ref} as one of the ` +
            `two manifestations of the root residual. §0.1 must name both ` +
            `§1.1 and §1.2 so the root-to-instance link stays explicit.`,
        );
      }
    }
  }

  // §1.1 and §1.2 headings must each stay tagged as an instance of §0.1.
  const TAG = "instance of the §0.1 root residual";
  for (const sec of ["1.1", "1.2"]) {
    const headingRe = new RegExp(`^###\\s+${sec.replace(".", "\\.")}\\b.*$`, "m");
    const m = server.match(headingRe);
    if (!m) {
      errors.push(
        `${SERVER_DOC_REL} is missing the §${sec} heading. It must exist and ` +
          `be tagged "${TAG}" so the operator-correlation manifestation can't ` +
          `silently drop its link to the §0.1 root residual.`,
      );
      continue;
    }
    if (!m[0].includes(TAG)) {
      errors.push(
        `${SERVER_DOC_REL} §${sec} heading is no longer tagged ` +
          `"${TAG}". Each operator-correlation manifestation must read as an ` +
          `instance of the §0.1 root residual, not a standalone item. Restore ` +
          `the tag, or update §0.1, §${sec} and this drift check together.`,
      );
    }
  }

  // -- Report ----------------------------------------------------------------
  if (errors.length > 0) {
    console.error("[check-threat-model-drift] FAIL");
    for (const e of errors) console.error("  - " + e);
    console.error("");
    console.error(
      "If you intentionally changed one of the three surfaces, update the",
    );
    console.error(
      "other two (and this script, if the structural promise changed) in",
    );
    console.error("the same commit so the surfaces stay in sync.");
    process.exit(1);
  }

  const titles = positions
    .map((p) => `§${p.n} "${p.title}"`)
    .join(", ");
  console.log(
    `[check-threat-model-drift] OK — ${positions.length} attacker ` +
      `position(s) enumerated in ${CLIENT_DOC_REL} (${titles}); ` +
      `cross-links intact between all three surfaces; journalist-grade ` +
      `caveat present on each.`,
  );
}

main().catch((err) => {
  console.error(
    `[check-threat-model-drift] failed: ${err.stack ?? err}`,
  );
  process.exit(1);
});
