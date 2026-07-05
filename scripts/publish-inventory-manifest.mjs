// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Publish-scope inventory manifest (Tier 1: top-level classification).
//
// Every TOP-LEVEL entry of the tracked tree (root files + top-level dirs) must
// be classified here as either SHIP or STRIP. This is the machine-enforced
// version of the manual "step 1b" gate in docs/pre-publish-scrub-2026-06.md.
//
// WHY THIS EXISTS: the pre-publish scrub is a denylist — `git archive HEAD`
// ships the whole tracked tree and the scrub then deletes named exceptions.
// That fails OPEN: anything nobody thought to name ships by default. The §2
// classification only ever surveyed a couple of subtrees (docs plus the agent
// memory dir), so the entire repo root went unclassified and `replit.md` plus
// the Replit platform files nearly shipped. check-publish-inventory.mjs reads
// this manifest and FAILS if any tracked top-level entry is missing from it —
// turning an unclassified entry into a hard stop instead of a silent default-ship.
//
// SCOPE: top-level only. Internal files INSIDE a SHIP dir (e.g. the private
// docs under docs/) are handled by the §3 strip list and §4 content scans, not
// here. Keep this list in sync with the §2 table and the §3 strip commands.
//
// Run via: pnpm --filter @workspace/scripts run check:publish-inventory

// Top-level entries that are part of the public release.
export const SHIP = [
  "artifacts",
  "assets",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "coturn",
  "deploy",
  ".docker-base-digest",
  "docker-compose.yml",
  "Dockerfile",
  ".dockerignore",
  "docs", // dir ships; internal sub-docs are pulled by the §3 strip list
  "eslint.config.mjs",
  ".gitattributes",
  ".github",
  ".gitignore",
  ".gitleaks-void.toml",
  "lib",
  "LICENSE",
  "manifest.yaml",
  ".npmrc",
  ".nvmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  "README-selfhost.md",
  "screenshots",
  "scripts",
  "security-contact.asc",
  "SECURITY.md",
  "tools",
  "tsconfig.base.json",
  "tsconfig.eslint.json",
  "tsconfig.json",
  "umbrel-app.yml",
  "VOID-Feature-Policy.md",
  "void-icon.png",
  "VOID_TECHNICAL_OVERVIEW.md",
];

// Top-level entries that must be stripped from the snapshot before publishing.
// Each must also appear in the §3 strip commands and the §4.2 absence checks.
export const STRIP = [
  ".agents", // agent memory — NEVER ships
  ".replit", // Replit platform/orchestration config (historically carried a secret)
  ".replitignore", // Replit deploy-image ignore — managed-platform cruft
  "replit.md", // internal dev/agent context incl. a "User preferences" section
  "replit.nix", // Replit Nix env — plants a "built on Replit" flag
];

// Tier 2: NESTED strips — internal material that lives INSIDE a SHIP dir and so
// cannot be expressed by the top-level SHIP/STRIP scheme above (artifacts/ and
// docs/ both ship, but specific files/dirs deep inside them must not). Each path
// is relative to the tree root. check-publish-inventory.mjs enforces these in
// snapshot mode (they must be ABSENT from the candidate tree) and guards them
// against rot in source mode (each must still exist in the tracked tree, or the
// list has gone stale). Keep in lockstep with the §3 nested `rm` commands in
// docs/pre-publish-scrub-2026-06.md.
//
// WHY: without this, ~354 MB of internal design-review PNGs under
// aesthetic-audit-shots/ (and the aesthetic-audit.md doc they belong to) ship by
// default — `git archive HEAD` carries the whole tracked tree — ballooning the
// public repo from ~29 MB to ~381 MB. They were stripped only by memory/ad-hoc
// commands and enforced by nothing.
export const NESTED_STRIP = [
  "artifacts/void-client/docs/aesthetic-audit-shots", // ~354 MB internal design-review PNGs
  "artifacts/void-client/docs/aesthetic-audit.md", // internal aesthetic-audit doc the shots belong to
];
