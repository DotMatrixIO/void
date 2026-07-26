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
  ".replit", // Replit platform/orchestration config (historically carried a secret)
  ".replitignore", // Replit deploy-image ignore — managed-platform cruft
  "replit.md", // internal dev/agent context incl. a "User preferences" section
  "replit.nix", // Replit Nix env definition — managed-platform cruft; already deleted by the §3 strip commands
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

// Tier 3: generic large-file BACKSTOP. NESTED_STRIP names the *known* internal
// bloat by hand; this closes the same fail-open class one level down for the
// UNKNOWN case — a future oversized file dropped into any SHIP dir that nobody
// thinks to name would otherwise ship by default (`git archive HEAD` carries
// the whole tracked tree). Snapshot mode walks the candidate tree and FAILS on
// any file larger than LARGE_FILE_THRESHOLD_BYTES that is not on the reviewed
// LARGE_FILE_ALLOWLIST below, naming the offending file and its size.
//
// WHY A THRESHOLD + ALLOWLIST (not just NESTED_STRIP): NESTED_STRIP only stops
// files someone already noticed and named. The whole point of this gate is the
// file nobody named. A size ceiling turns "did anyone remember to strip this?"
// into "any big new file must be justified on the allowlist, or it stops the
// publish" — fail-closed instead of fail-open.
export const LARGE_FILE_THRESHOLD_BYTES = 512 * 1024; // 512 KiB

// Reviewed allowlist of the legitimately-large assets that DO ship and exceed
// the threshold. Derived from an audit of the real tracked tree (largest first;
// see docs/pre-publish-scrub-2026-06.md §4.2). Paths are relative to the
// snapshot / tree root. Adding an entry here is a deliberate, reviewed act —
// that friction is the feature: a new oversized file must be explained, not
// shipped silently. Assets under the threshold (e.g. the screenshots/ editorial
// hero JPEGs, the PWA splash/icon PNGs) need no entry; they pass on size alone.
export const LARGE_FILE_ALLOWLIST = [
  "artifacts/mockup-sandbox/public/concrete.jpeg", // design-sandbox backdrop
  "artifacts/biometric-demo-video/public/images/webcam-talking.webm", // demo-video source clip
  "artifacts/void-client/public/biometric-demo.mp4", // landing biometric demo
  "artifacts/void-client/public/silver-facets.png", // landing hero texture
  "artifacts/void-client/public/biometric-demo-poster-ref.png", // demo poster reference frame
  "artifacts/biometric-demo-video/public/images/webcam-portrait.png", // demo-video source still
  "artifacts/void-client/public/biometric-demo-poster.png", // demo poster
  "artifacts/biometric-demo-video/public/audio/music.mp3", // demo-video score
  "artifacts/void-client/public/coordination-demo.mp4", // landing coordination demo
  "void-icon.png", // top-level project icon
  "artifacts/void-client/public/coordination-demo-poster.png", // coordination demo poster
  "artifacts/void-client/public/portraits/self-portrait-gold-ascii.png", // landing portrait asset
  "artifacts/mockup-sandbox/public/portraits/self-portrait02_1779993532975.png", // design-sandbox portrait
];

// Tier 4: TRACKED-FILE-COUNT FLOOR — the wipe backstop. The tiers above all
// guard the *shape* of the tree (which entries ship, how big they are); none of
// them notices the tree getting *emptied*. A catastrophic deletion — the exact
// failure that happened here, when an unconditional `git add -A` auto-commit
// captured an already-emptied working tree (~970 tracked files → a handful) —
// passes every check above except by luck (the STALE checks only fire for
// entries the wipe happened to leave named in the manifest). This floor makes a
// wipe a LOUD, DETERMINISTIC failure: source mode fails if the total tracked
// file count drops below MIN_TRACKED_FILES.
//
// WHY A FLOOR (not a live baseline/delta): a running "expected count" would have
// to be bumped on every add/remove and would drift constantly — fragile, noisy,
// and it would train reviewers to rubber-stamp the bump (defeating the guard). A
// fixed floor set well below the real count needs no maintenance and only ever
// moves for a genuine, reviewed reason. It is deliberately blunt: it catches the
// catastrophic case (tree collapses toward zero), not small legitimate churn.
//
// The value is set far below the current tracked count (~970) but far above any
// plausible legitimate floor for this repo, leaving generous headroom for normal
// deletions while still tripping instantly on a wipe. LOWERING THIS IS A
// DELIBERATE, REVIEWED ACT — same friction philosophy as LARGE_FILE_ALLOWLIST:
// if a legitimate change really drops the tree below the floor, the reviewer
// lowers the number on purpose, in the same change, with a reason. It must never
// be lowered reflexively just to make a red check go green.
export const MIN_TRACKED_FILES = 800;
