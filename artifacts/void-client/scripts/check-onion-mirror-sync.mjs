#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * check-onion-mirror-sync.mjs
 *
 * Fails (exit 1) if the .onion-mirror operator runbook has drifted out of
 * sync with the four files it cross-references (and that cross-reference
 * it back).
 *
 *   runbook: docs/onion-mirror-runbook.md
 *   peers:   README-selfhost.md
 *            manifest.yaml
 *            umbrel-app.yml
 *            artifacts/void-client/src/pages/ThreatModelPage.tsx
 *
 * Task #263 added the runbook and wired it into README §6c, the StartOS and
 * Umbrel manifests, and the ThreatModelPage Tor section. Today nothing
 * catches drift if §6c is renamed, the runbook file is moved, or the
 * ThreatModelPage Tor section heading is rewritten — the cross-reference
 * silently goes dangling. This check makes that visible at CI time.
 *
 * Note on the runbook filename. Task #267 was filed against the working
 * name `docs/operator-onion-mirror.md`, but the file that actually landed
 * in the tree (under #263) is `docs/onion-mirror-runbook.md`, and that is
 * the path every peer file already links to (see the inbound pins below).
 * This check uses the on-disk filename so the cross-reference graph it
 * verifies matches reality. If the file is ever renamed back to
 * `operator-onion-mirror.md` (or anything else), the inbound pins below
 * will fail loudly — the rename gets caught the same way any other path
 * change would.
 *
 * What the check covers:
 *
 *   1. Outbound from runbook → peers. Each pinned reference inside
 *      docs/onion-mirror-runbook.md must still resolve to a substring in
 *      the peer file (e.g. "§6c (Tor Hidden Service)" must still find
 *      "### 6c. Tor Hidden Service" in README-selfhost.md).
 *
 *   2. Inbound from peers → runbook. Every mention of
 *      docs/onion-mirror-runbook.md inside any of the four peer files
 *      must resolve to an existing file at that path.
 *
 *   3. The runbook file itself must exist.
 *
 * Each pin asserts (a) the source still contains the reference text we
 * pinned (otherwise the pin itself is stale and needs a human to update
 * this script) and (b) the target still contains the substring it points
 * at (otherwise the cross-reference is dangling and needs a human to fix
 * the doc, not the pin).
 *
 * Run via:
 *
 *     pnpm --filter @workspace/void-client run check:onion-mirror-sync
 *
 * Wired into CI as part of the `marketing-voice` validation workflow in
 * .replit.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(CLIENT_ROOT, "..", "..");

const RUNBOOK = "docs/onion-mirror-runbook.md";
const README = "README-selfhost.md";
const MANIFEST = "manifest.yaml";
const UMBREL = "umbrel-app.yml";
// Task #559: the "Network observers and IP visibility" and "Tor and the
// media path" sections, plus the outbound link to the runbook, live in
// the long-form docs page (route /docs/threat-model) after the
// ThreatModelPage short-form split. The short-form ThreatModelPage now
// just summarises and links out to the long-form page. Point the pins
// at the file where the headings and link actually live.
const THREAT_MODEL = "artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx";

const PEERS = [README, MANIFEST, UMBREL, THREAT_MODEL];

/**
 * Pinned cross-references. Each row is one assertion:
 *
 *   - sourceFile       : where the reference lives (relative to repo root)
 *   - sourceMustContain: the literal substring that anchors the pin in the
 *                        source. If this is gone, the pin itself is stale.
 *   - targetFile       : where the reference points (relative to repo root)
 *   - targetMustContain: literal substring that must still exist in the
 *                        target. Use null to assert file existence only.
 *   - note             : human-readable label printed on failure.
 */
const PINS = [
  // -- Outbound: runbook → README-selfhost.md --
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "§6c (Tor Hidden Service)",
    targetFile: README,
    targetMustContain: "### 6c. Tor Hidden Service",
    note: "runbook references README §6c heading",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "§6c is the per-host reference",
    targetFile: README,
    targetMustContain: "### 6c. Tor Hidden Service",
    note: "runbook table footnote references README §6c",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "§4c of `README-selfhost.md`",
    targetFile: README,
    targetMustContain: "### 4c. Reverse Proxy",
    note: "runbook references README §4c heading",
  },

  // -- Outbound: runbook → ThreatModelPage Tor section --
  {
    sourceFile: RUNBOOK,
    sourceMustContain: '"Network observers and IP visibility"',
    targetFile: THREAT_MODEL,
    targetMustContain: "NETWORK OBSERVERS AND IP VISIBILITY",
    note: "runbook references ThreatModelPage 'Network observers and IP visibility' section",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "ThreatModelPage Tor section",
    targetFile: THREAT_MODEL,
    targetMustContain: "TOR AND THE MEDIA PATH",
    note: "runbook references ThreatModelPage Tor section (TOR AND THE MEDIA PATH)",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "`artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx`",
    targetFile: THREAT_MODEL,
    targetMustContain: null,
    note: "runbook references ThreatModelPage source file path",
  },

  // -- Outbound: runbook → manifest.yaml (StartOS package) --
  // The runbook explicitly hands off the .onion-only deployment shape to
  // the StartOS / Umbrel manifest review, which is implemented in
  // manifest.yaml as the `tor-config:` block under interfaces.main and the
  // documented `TOR_ONLY` env contract. If those go away or get renamed,
  // the runbook's "different option owned by ..." sentence is dangling.
  //
  // NOTE on anchoring: these pins deliberately key on durable wording — the
  // "StartOS / Umbrel manifest review" phrase and the public security-audit
  // doc reference — rather than the internal "Task #253" tracker number that
  // used to live in the manifest owner-comments. That task number is
  // expected to be tidied out of the shipped manifests (e.g. when the public
  // repo is published), and a CI gate must not break the moment it is. The
  // manifest owner-comments previously pointed at a PRIVATE manifest-review
  // doc that is pulled before publish; the re-eval cross-reference now
  // resolves to its public equivalent, docs/security-audit-public-2026-04.md §11
  // (limitation 9), which ships and documents the same manifest-review posture.
  // The cross-reference itself (runbook names the review; the manifest comment
  // points at the public review doc) is what we are verifying, and it survives
  // the task-number cleanup.
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "Tor-only deployment switch landing",
    targetFile: MANIFEST,
    targetMustContain: "tor-config:",
    note: "runbook hands off Tor-only switch to manifest.yaml's tor-config: block",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "(Tor-only switch) | no | yes |",
    targetFile: MANIFEST,
    targetMustContain: "TOR_ONLY",
    note: "runbook table cites the StartOS manifest's TOR_ONLY env contract",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "StartOS / Umbrel manifest review",
    targetFile: MANIFEST,
    targetMustContain: "docs/security-audit-public-2026-04.md §11 (limitation 9)",
    note: "runbook names the StartOS / Umbrel manifest review; manifest.yaml owner-comment points at the public security-audit review doc",
  },

  // -- Outbound: runbook → umbrel-app.yml (Umbrel package) --
  // Same handoff, but for the Umbrel side of the "StartOS / Umbrel manifest
  // review". umbrel-app.yml has no `tor-config:` block (Umbrel's packaging
  // shape is different — see its release notes), so the pins here are the
  // documented TOR_ONLY env contract and the same public security-audit review
  // doc reference carried by its owner-comment.
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "StartOS / Umbrel manifest review",
    targetFile: UMBREL,
    targetMustContain: "TOR_ONLY",
    note: "runbook references Umbrel-side TOR_ONLY env contract",
  },
  {
    sourceFile: RUNBOOK,
    sourceMustContain: "StartOS / Umbrel manifest review",
    targetFile: UMBREL,
    targetMustContain: "docs/security-audit-public-2026-04.md §11 (limitation 9)",
    note: "runbook names the StartOS / Umbrel manifest review; umbrel-app.yml owner-comment points at the public security-audit review doc",
  },

  // -- Inbound: peers → runbook path (file existence) --
  {
    sourceFile: README,
    sourceMustContain: "docs/onion-mirror-runbook.md",
    targetFile: RUNBOOK,
    targetMustContain: null,
    note: "README §6c links to docs/onion-mirror-runbook.md",
  },
  {
    sourceFile: MANIFEST,
    sourceMustContain: "docs/onion-mirror-runbook.md",
    targetFile: RUNBOOK,
    targetMustContain: null,
    note: "manifest.yaml alerts.start references docs/onion-mirror-runbook.md",
  },
  {
    sourceFile: THREAT_MODEL,
    sourceMustContain: "docs/onion-mirror-runbook.md",
    targetFile: RUNBOOK,
    targetMustContain: null,
    note: "ThreatModelPage links to docs/onion-mirror-runbook.md",
  },
  // umbrel-app.yml does not link to the runbook by path today — its
  // outbound cross-references go to README-selfhost.md §6c and to the
  // ThreatModelPage "TOR AND THE MEDIA PATH" section instead. The two
  // outbound runbook → umbrel-app.yml pins above (TOR_ONLY contract and
  // the manifest-review doc reference in its owner comment) cover the
  // runbook → Umbrel direction.
  // If umbrel-app.yml ever starts linking to docs/onion-mirror-runbook.md
  // by path, add an inbound pin matching the README/manifest entries
  // above.
];

const errors = [];
const fileCache = new Map();

function readOrRecord(path) {
  if (fileCache.has(path)) return fileCache.get(path);
  const abs = resolve(REPO_ROOT, path);
  if (!existsSync(abs)) {
    fileCache.set(path, null);
    return null;
  }
  const contents = readFileSync(abs, "utf8");
  fileCache.set(path, contents);
  return contents;
}

for (const pin of PINS) {
  const sourceRel = relative(REPO_ROOT, resolve(REPO_ROOT, pin.sourceFile));
  const targetRel = relative(REPO_ROOT, resolve(REPO_ROOT, pin.targetFile));

  const sourceText = readOrRecord(pin.sourceFile);
  if (sourceText === null) {
    errors.push(
      `Pin source file is missing: ${sourceRel}\n` +
        `  pin: ${pin.note}\n` +
        `  fix: restore the file or update check-onion-mirror-sync.mjs to drop the pin.`,
    );
    continue;
  }

  if (!sourceText.includes(pin.sourceMustContain)) {
    errors.push(
      `Pin is stale in ${sourceRel}: source no longer contains ${JSON.stringify(pin.sourceMustContain)}\n` +
        `  pin: ${pin.note}\n` +
        `  fix: either restore the reference text in ${sourceRel}, or update the\n` +
        `       'sourceMustContain' value in artifacts/void-client/scripts/check-onion-mirror-sync.mjs\n` +
        `       to match the new wording (and re-pin its target).`,
    );
    continue;
  }

  const targetText = readOrRecord(pin.targetFile);
  if (targetText === null) {
    errors.push(
      `Cross-reference is dangling: ${sourceRel} points at missing file ${targetRel}\n` +
        `  pin: ${pin.note}\n` +
        `  source text: ${JSON.stringify(pin.sourceMustContain)}\n` +
        `  fix: restore ${targetRel}, or update ${sourceRel} (and the matching pin in\n` +
        `       artifacts/void-client/scripts/check-onion-mirror-sync.mjs) to point at the new path.`,
    );
    continue;
  }

  if (pin.targetMustContain !== null && !targetText.includes(pin.targetMustContain)) {
    errors.push(
      `Cross-reference is dangling: ${sourceRel} expects ${JSON.stringify(pin.targetMustContain)} in ${targetRel} but it is gone\n` +
        `  pin: ${pin.note}\n` +
        `  source text: ${JSON.stringify(pin.sourceMustContain)}\n` +
        `  fix: either restore the heading/section in ${targetRel}, or rename it everywhere\n` +
        `       (update ${sourceRel} and the pin in artifacts/void-client/scripts/check-onion-mirror-sync.mjs).`,
    );
  }
}

// Belt-and-braces: catch any future inbound mention of the runbook in the
// four peer files that isn't yet pinned above. If a peer file mentions the
// runbook path but the runbook is missing, fail with a clear message.
for (const peer of PEERS) {
  const text = readOrRecord(peer);
  if (text === null) {
    errors.push(
      `Peer file is missing: ${peer}\n` +
        `  fix: restore the file, or update check-onion-mirror-sync.mjs's PEERS list.`,
    );
    continue;
  }
  if (text.includes(RUNBOOK) && readOrRecord(RUNBOOK) === null) {
    errors.push(
      `Inbound reference is dangling: ${peer} mentions ${RUNBOOK} but the runbook file does not exist.\n` +
        `  fix: restore ${RUNBOOK}, or remove the mention from ${peer}.`,
    );
  }
}

if (errors.length === 0) {
  console.log(
    `Onion-mirror runbook sync check passed: ${PINS.length} pin(s) verified across ` +
      `${RUNBOOK} and ${PEERS.length} peer file(s).`,
  );
  process.exit(0);
}

console.error("Onion-mirror runbook sync check FAILED.\n");
for (const err of errors) {
  console.error(err);
  console.error("");
}
console.error(
  `${errors.length} drift issue(s) detected. See ${RUNBOOK} and the peer files above,\n` +
    `or update artifacts/void-client/scripts/check-onion-mirror-sync.mjs if the rename is intentional.`,
);
process.exit(1);
