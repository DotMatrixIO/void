<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Pre-publish history scrub & clean-publish procedure — 2026-06

**Date:** June 12, 2026
**Scope:** The criteria, the method decision, the docs-that-ship review, the
operator-runnable clean-publish procedure, and the post-snapshot verification
checklist for VOID's first public release at
`https://github.com/DotMatrixIO/void`.

This document is the human-judgment half of publication. The mechanical
half — the destructive history rewrite and the push to the public remote — is
**operator-executed**, by design: destructive git is hard-blocked for the build
agent, and a first publication of a privacy tool demands a human read that no
automated pass can stand in for. Everything below is written so the operator
can run it directly.

**Ordering.** Run this procedure **last**, after the pre-publish hygiene, the
onion-bake, and the go-live-runbook changes have landed, so the snapshot
captures the final tree. If any of those land after the snapshot is taken,
re-take the snapshot — the published commit must be the final tree, not an
intermediate one.

---

## 0. Method decision — fresh-history snapshot (not `git filter-repo`)

**The chosen method is a fresh-history snapshot: publish the final working
tree as a single clean initial commit, and retain the full pre-release history
in a private remote.** This is not left open; do not relitigate it at publish
time.

Rationale:

- **`filter-repo` makes you prove a negative across years of history.** Every
  commit message, every author/committer field, every blob in every historical
  revision would have to be individually cleared. A single miss ships forever,
  and for a privacy tool a single miss is the whole reputational stake.
- **A snapshot publishes exactly one tree you can fully read.** The thing the
  public sees is a single commit whose entire contents are reviewable in one
  pass. There is no historical revision hiding a secret, a legal name in an
  author field, or a candid internal commit message.
- **Cached host indexes keep "rewritten" values reachable.** Even a perfect
  in-place `filter-repo` rewrite can leave the old objects reachable through a
  forge's cached commit views and pull-request refs for a long time. A
  pre-launch full-history secret scan already found a real credential committed
  to a Replit-platform config file in VOID's development history (this is the
  fact the public `README.md` "Public history starts at the v0.x baseline"
  section discloses). Publishing from a clean baseline that *never contained
  that object* is categorically safer than rewriting history that did.
- **The history is not lost.** It moves to a private remote the maintainer
  keeps. Nothing of engineering value is destroyed; it is simply not made
  public. Every load-bearing public claim VOID makes (the threat model, the
  reproducible build, the signaling-envelope audit) is checkable against the
  published tree, which is the point — the value is in the auditable present
  state, not the development scratch.

---

## 1. Scrub criteria — what to look for and how to recognize it

Each category below is a thing to find and remove (or repoint) **before** the
snapshot is taken. The snapshot then captures a tree that already satisfies
every category; §4 verifies it did.

### 1.1 Secrets and credentials

Anything that authenticates or authorizes: API keys, tokens, Lightning backend
credentials (`LNBITS_API_KEY`, `BTCPAY_API_KEY`), a real coturn
`static-auth-secret`, a real `PAYWALL_SECRET`, a filled-in `.env`, private
keys, session cookies, connection strings with embedded credentials, signed
URLs.

How to recognize:

- A file that should be an `.example`: `coturn/turnserver.conf` (real) vs
  `coturn/turnserver.conf.example` (placeholder). The real form is gitignored
  and the API server refuses to boot on the placeholder; confirm the real form
  is **not** in the candidate tree.
- Any tracked `.env*` (all are gitignored — confirm none slipped in).
- High-entropy strings in config, fixtures, or docs that are not obviously
  RFC-2606 placeholders (`void.example`) or documented test vectors.
- The automated secret scanner in §4 is the backstop here, not the primary
  control — the primary control is that secrets never enter the tree (the
  `.gitignore` secrets block and the no-secrets CI gate in `CONTRIBUTING.md`).

### 1.2 Git authorship and committer identity — must read DotMatrixIO

**Every author and committer field in the published commit must read as the
pseudonymous operator identity `DotMatrixIO`, never the maintainer's legal
name.** This is the single most important identity rule and the one a tree-copy
does *not* fix on its own: a snapshot copies file contents, but the new initial
commit's author/committer come from whatever git identity the operator has
configured when they run `git commit`. Set it explicitly (§3) and verify it
explicitly (§4).

The pseudonymous identity used elsewhere in the tree is `DotMatrixIO` with the
contact `dot_matrix_apps@proton.me` (see `SECURITY.md`). Author name, author
email, committer name, and committer email of the published initial commit must
all match that identity — no legal name, no personal email, no employer email.

**This environment actively injects two wrong identities — neither is a passive
default, so `git config` alone is not enough to be safe:**

- **The maintainer's real name**, from a Replit-managed *per-user* git config at
  `/run/replit/user/<id>/.config/git/config` (`user.name` plus a
  `…@users.noreply.replit.com` email). A freshly `git init`'d `$PUB` has no
  local `user.*`, so a plain `git commit` there inherits this and publishes the
  legal name — the §1.2 leak in its most direct form.
- **`Replit Agent <agent@replit.com>`**, stamped whenever the commit is made
  through Replit's mediated git path (the Git pane or a checkpoint), which
  overrides `user.*` regardless of config.

The defence in §3 beats both: set a **local** `git config user.*` inside `$PUB`
*and* pass the `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env vars inline on the commit
(env vars are highest-precedence), and create the commit from a **plain shell —
never the Replit Git pane**. Verified in this environment: with the local config
set, both `git var GIT_AUTHOR_IDENT` and `git var GIT_COMMITTER_IDENT` resolve
to `DotMatrixIO`, and no hook or wrapper forces the committer.

### 1.3 Candid internal commit messages

The pre-release history contains development-scratch commit messages written
for an internal audience (task numbers, blunt "this was broken" notes,
half-finished reasoning). None of this is something to clean *message by
message* — that is precisely the `filter-repo` trap §0 rejects. The snapshot
method disposes of all of it at once: the single published commit carries one
clean, deliberate message and no historical messages at all.

The clean initial-commit message is operator-authored (a short, plain
description of what VOID is and that history starts from a squashed baseline);
do not paste internal task notes into it.

### 1.4 Pre-decision identity references (operator identity locked late)

The operator-identity decision (publish as `DotMatrixIO`) was made after much
of the tree was written. References that pre-date it are scrub-worthy:

- The maintainer's legal name anywhere in the tree (files, comments, fixtures,
  doc author lines). Grep for it in §4 — the operator substitutes the actual
  name locally; it is deliberately **not** written into this document, because
  writing it here would itself be the leak this step exists to prevent.
- Any personal-email or employer-email address.

### 1.5 Residual `Void-PWA` references

`Void-PWA` is the **old** organization slug. The canonical identity is
`DotMatrixIO/void`. The live, load-bearing references (README, SECURITY,
`README-selfhost.md`, both manifests, `artifacts/void-client/src/lib/repo.ts`,
`artifacts/api-server/src/routes/proof-build.ts`, and their tests) were already
migrated to `DotMatrixIO` in the identity-rename pass. What remains are
references inside **dated `docs/` review files** that, by the in-tree
convention, are not retro-edited (`docs/manifest-review-2026-05.md` §0). As of
this writing the residual `Void-PWA` strings are confined to:

- `docs/manifest-review-2026-06.md` (canonical-URL table and prose),
- `docs/security-audit-internal-2026-04.md` (one §11 limitation note),
- `docs/security-audit-public-2026-04.md` (one §11 limitation note).

Decision: the first two are **private** docs that do not ship (see §2), so
their `Void-PWA` strings never reach the public tree — removing the doc removes
the reference. The third (`security-audit-public-2026-04.md`) **does** ship, so
its single `Void-PWA` string is a real publish hazard and must be corrected to
`DotMatrixIO` (or the sentence struck) before the snapshot. The §4 grep for
`Void-PWA` over the *candidate publish tree* is the backstop that catches any
that survive.

### 1.6 Internal `.agents/` material — named, explicit exclusion

**The entire `.agents/` directory must NOT ship.** This covers the candid
internal engineering memory under `.agents/memory/` (`MEMORY.md` and every topic
file) AND the internal agent-product revival doc at
`.agents/archive/agent-product-revival-2026-06.md`. It is called out as its own
category because it is exactly the kind of file a tree-copy silently carries
along: it lives inside the repo, it is not gitignored, and a naive `git archive`
or `cp -r` of the working tree would include it.

`.agents/` is internal-only material — undocumented quirks, abandoned
approaches, blunt assessments, conversation-derived lessons, and the recovery
spec for the (now-removed) agent product. It is written for a future build
agent, not for the public, and publishing it would expose internal reasoning the
project has deliberately kept out of its shipping docs. The clean-publish
procedure (§3) deletes `.agents/` from the candidate tree explicitly, and §4
verifies it is gone.

(The sibling `.local/` directory is already gitignored and never tracked, so it
drops out naturally; `.agents/` is the one that needs an explicit hand.)

---

## 2. Docs-that-ship review

The snapshot publishes whatever non-ignored files are in the candidate tree.
So "which docs ship" is decided by which docs are **left in the tree** when the
snapshot is taken. The table records the call for every doc whose status is not
self-evident. "PRIVATE" means: remove from the candidate tree before the
snapshot (move to the maintainer's private history / `docs/_private/`, which is
gitignored).

| Doc | Ship? | Why |
| --- | ----- | --- |
| `docs/security-audit-public-2026-04.md` | **SHIP** | This is the published copy, redacted-by-design. Fix its one `Void-PWA` string (§1.5) and see the cross-link caveat below. |
| `docs/security-audit-internal-2026-04.md` | **PRIVATE** | The internal copy: candid, references `.local/tasks/`, references the nonexistent internal `launch-decisions` doc, and carries the same findings as the public copy without redaction. The public copy is its shipping form. **Cross-link hazard — see below.** |
| `docs/security-audit-extracts.md` | **SHIP** | Companion to the public audit (named in its header); verbatim source extracts for High findings, no internal-only material. Confirm it contains no legal name / secret on the read. |
| `docs/security-audit-cve-appendix.md` | **SHIP** | Generated CVE appendix; public-facing. |
| `docs/manifest-review-2026-05.md` | **PRIVATE** | Internal store-submission planning; references `.local/tasks/`. **But it is linked from `README-selfhost.md` (§ around line 925) — repoint or drop that link first (content edit, other task).** |
| `docs/manifest-review-2026-06.md` | **PRIVATE** | Internal build-readiness planning; references the nonexistent internal `launch-decisions` doc and `publish-opsec-prep` doc; contains residual `Void-PWA`. Not user- or operator-facing. |
| `docs/marketing-claims-audit.md` | **SHIP** | Promoted PRIVATE → SHIP. The claims-tracking ledger is candid in exactly the transparency register VOID already publishes (it mirrors the public threat model, the public audit, and the won't-fix list). Its lone `.local/tasks/` reference was scrubbed and an internal codename genericized before promotion, so it now passes the publish-doc-hygiene guard like any other shipping doc. The inbound references from `VOID_TECHNICAL_OVERVIEW.md` (ships) and the client tests resolve in place. Its own outbound citations to the internal audit / manifest-review docs are now inventoried in the cross-links ALLOWLIST (see the cross-link hazard note below). |
| `docs/threat-model.md`, `docs/client-threat-model.md` | **SHIP** | Public threat models; linked from `SECURITY.md` and the in-app threat-model page. |
| `docs/incident-response.md`, `docs/onion-mirror-runbook.md`, `docs/lightning-failure-injection-runbook.md`, `docs/tor-circuit-degradation-runbook.md`, `docs/sri-canary-runbook.md` | **SHIP** | Operator runbooks; linked from `README-selfhost.md` / `VOID_TECHNICAL_OVERVIEW.md`. Operator-facing by design. |
| `docs/signaling-envelope-audit.md`, `docs/onion-fail-open-audit.md`, `docs/contrast-audit.md`, `docs/code-quirks-index.md`, `docs/browser-compatibility.md`, `docs/privacy-non-goals.md`, `docs/log-correlation-audit.md`, `docs/provenance-transparency-log-scoping.md`, `docs/frontend-resource-cleanup-audit.md`, `docs/audio-context-leak-verification.md`, `docs/roompage-wire-error-code-triage.md`, `docs/tor-reconnect-notes.md` | **SHIP** | Engineering references linked from shipping docs / source comments; no internal-only material. Confirm clean on the read. |
| `docs/_fragments/*`, `docs/research/*`, `docs/security/*` | **READ INDIVIDUALLY** | Sub-trees not surveyed file-by-file here; include in the §4 grep and give each a human read before the snapshot. |
| **This document** (`docs/pre-publish-scrub-2026-06.md`) | **SHIP** | Contains no secret and no legal name (the legal-name grep uses a placeholder the operator fills locally). Publishing it is consistent with VOID's transparency posture and with the public `README` already disclosing the squashed-baseline rationale. |
| `.agents/**` (incl. `.agents/archive/agent-product-revival-2026-06.md`) | **NEVER** | See §1.6 — candid internal agent memory and the internal agent-product revival doc; explicit delete in §3. |
| `replit.md` | **NEVER** | Root-level internal dev/agent context: project overview, a "User preferences" section, and dozens of internal `Task #NNN` references. Not curated public documentation; same class as `.agents/`. Explicit delete in §3. (Leaked through the old docs-only survey — see the §3 step 1b gate.) |
| `.replitignore`, `replit.nix` | **NEVER** | Replit managed-platform files. Shipping them plants a "built on Replit" flag on a product whose whole pitch is operator sovereignty (the shipped packaging is Docker/Umbrel/StartOS). Explicit delete in §3. |

> **Cross-link hazard (read this before deleting any PRIVATE doc).** Two
> "PRIVATE" docs are referenced from things that *do* ship:
> `security-audit-internal-2026-04.md` is linked from
> `VOID_TECHNICAL_OVERVIEW.md` and asserted by `App.pushstate.test.ts`;
> `manifest-review-2026-05.md` is linked from `README-selfhost.md`.
> **Deleting the target without repointing the reference leaves a dangling
> link in a shipping doc and may break a test.**
> The reference repointing is a *content edit* owned by the hygiene tasks, not
> this one. The order is therefore: (a) those tasks repoint
> internal-audit/manifest-review links to their public equivalents (or remove
> them); (b) only then are the PRIVATE docs pulled; (c) then the snapshot. If
> (a) has not happened by snapshot time, the affected doc ships rather than
> shipping a broken tree — record that in the final read and open a follow-up.
>
> **Inverse hazard from promoting `marketing-claims-audit.md` to SHIP.** That
> ledger now ships, and it itself cites `security-audit-internal-2026-04.md`
> and `manifest-review-2026-05.md` — i.e. it is a shipping file pointing at
> never-ship docs. Those outbound citations are inventoried in the
> `check-publish-cross-links.mjs` ALLOWLIST and are owned by the same
> audit-hygiene / manifest-hygiene tasks named above (repoint to the public
> copy or remove the §-reference before the targets are pulled).

(No grant-application drafts exist anywhere in the tree — confirmed. Their
filenames are nonetheless in the §4 grep as a backstop in case any are added
between now and the snapshot.)

> **Nested strips (material INSIDE a SHIP dir).** The table above is top-level
> only. Two internal items live under the SHIP `artifacts/` dir and must NOT
> reach the public snapshot — they cannot be expressed by the top-level scheme,
> so they get their own machine-enforced list (`NESTED_STRIP` in
> `scripts/publish-inventory-manifest.mjs`), the §3 nested `rm` lines, and the
> §4.2 snapshot absence check, all in lockstep:
>
> - `artifacts/void-client/docs/aesthetic-audit-shots/` — ~354 MB of internal
>   design-review PNGs. Shipping them balloons the public repo from ~29 MB to
>   ~381 MB (`git archive HEAD` carries the whole tracked tree).
> - `artifacts/void-client/docs/aesthetic-audit.md` — the internal
>   aesthetic-audit doc those shots belong to.
>
> Relatedly, the tree's only `.gitattributes` rule is a Git LFS pointer for a
> file inside that stripped dir. The public snapshot must ship an **LFS-free**
> `.gitattributes` (the baseline shipped it emptied); §3 empties it and §4.2
> fails on any surviving `filter=lfs` rule.

---

## 3. Clean-publish procedure (operator-runnable)

Run these on a clean checkout of the final tree, after the hygiene / onion-bake
/ go-live-runbook changes have landed. Commands assume a POSIX shell.

```sh
# 0. Pre-flight: confirm you are on the final intended tree and it is clean.
git status                      # working tree should be clean
git log --oneline -5            # note the final source commit for your records

# 1. Materialize a candidate publish tree OUTSIDE the repo (no .git carried over).
#    git archive is preferred over cp -r: it emits exactly the tracked tree and
#    silently omits gitignored files (.local/, .env*, attached_assets/,
#    coturn/turnserver.conf, docs/_private/). It does NOT omit .agents/ — that
#    is tracked — so it is deleted explicitly below.
PUB=../void-publish
rm -rf "$PUB" && mkdir -p "$PUB"
git archive --format=tar HEAD | tar -x -C "$PUB"

# 1b. CLASSIFICATION-COMPLETENESS GATE (the durable fix for fail-open).
#    The recurring defect is NOT "we forgot file X". It is that classification
#    (§2) only ever surveyed docs/** and .agents/**, so anything at the repo
#    root or in any other top-level directory was never classified at all and
#    shipped by default. replit.md and the Replit platform files leaked through
#    exactly this gap. This gate requires EVERY top-level entry of the tracked
#    tree to be explicitly SHIP or STRIP; an unclassified entry is a STOP, not
#    a default-ship.
#
#    MACHINE-ENFORCED: the classification lives in
#    scripts/publish-inventory-manifest.mjs and is checked by
#    check-publish-inventory.mjs (registered validation: "publish-inventory").
#    It fails on (a) any tracked top-level entry missing from the manifest
#    [the fail-open], (b) a stale manifest entry no longer in the tree, and
#    (c) anything classified as both SHIP and STRIP. Run it and do not proceed
#    past a failure:
pnpm --filter @workspace/scripts run check:publish-inventory
#
#    SCOPE: top-level only. A newly-added internal file INSIDE a SHIP dir
#    (e.g. a new private doc under docs/) is NOT caught here — it is the job of
#    the §3 strip list plus the §4 content scans (gitleaks / hygiene /
#    cross-link grep). Eyeball `ls -A "$PUB"` against the manifest as a
#    secondary human check, then keep the manifest, the §2 table, and the §3
#    strip list in lockstep whenever a top-level entry is added or removed.

# 2. Remove the explicitly-excluded internal material (§1.6, §2).
rm -rf "$PUB/.agents"                       # agent memory — NEVER ships
rm -f  "$PUB/.replit"                       # Replit platform/orchestration config — not needed in the public repo, and it historically carried a secret in [userenv.shared] (§1.1). The literal secret has since been removed from the tracked file, but drop the whole file from the snapshot as belt-and-suspenders.
rm -f  "$PUB/replit.md"                     # internal dev/agent context (project overview + "User preferences" section + internal Task #NNN references); not curated public documentation. Same NEVER class as .agents/. See §1.6.
rm -f  "$PUB/.replitignore"                 # Replit deploy-image ignore — managed-platform cruft on a product whose entire pitch is operator sovereignty (Docker/Umbrel/StartOS). Strip it.
rm -f  "$PUB/replit.nix"                    # Replit Nix env definition — plants a "built on Replit" flag on a self-hostable privacy product. The shipped packaging is Docker/Umbrel/StartOS, not Nix-on-Replit. Strip it.
#    Pull the PRIVATE docs from §2 ONLY after their shipping-surface references
#    have been repointed by the hygiene tasks (see the cross-link hazard note):
rm -f  "$PUB/docs/security-audit-internal-2026-04.md"
rm -f  "$PUB/docs/manifest-review-2026-05.md"
rm -f  "$PUB/docs/manifest-review-2026-06.md"
#    docs/marketing-claims-audit.md is NOT pulled — it was promoted to SHIP (§2).
#
#    NESTED strips — internal material that lives INSIDE a SHIP dir (artifacts/
#    ships, but this design-review material must not). These cannot be expressed
#    by the top-level §2 SHIP/STRIP scheme, so they are enforced by the
#    NESTED_STRIP list in scripts/publish-inventory-manifest.mjs and asserted
#    absent by the snapshot check in §4.2. Keep these rm lines in lockstep with
#    that list:
rm -rf "$PUB/artifacts/void-client/docs/aesthetic-audit-shots"  # ~354 MB internal design-review PNGs — shipping them balloons the public repo from ~29 MB to ~381 MB
rm -f  "$PUB/artifacts/void-client/docs/aesthetic-audit.md"     # internal aesthetic-audit doc the shots belong to
#
#    LFS-free .gitattributes. The tree's only .gitattributes rule is a Git LFS
#    pointer for a file inside the stripped aesthetic-audit-shots dir. The public
#    snapshot must carry NO LFS configuration (the baseline shipped an emptied
#    .gitattributes; an LFS pointer references blobs the fresh-history snapshot
#    does not contain). Empty it — the §4.2 snapshot check fails on any surviving
#    `filter=lfs` rule:
: > "$PUB/.gitattributes"

# 3. RUN §4 VERIFICATION NOW, against "$PUB", before creating any commit.
#    Do not proceed past a failure. (See §4.)

# 4. Initialize the public repo from the candidate tree as a single commit.
cd "$PUB"
git init
git checkout -b main

#    Set the pseudonymous identity for THIS commit explicitly (§1.2).
#    Do NOT rely on git config alone: a fresh "$PUB" inherits the maintainer's
#    real name from Replit's per-user config (/run/replit/user/<id>/.config/
#    git/config), and committing via the Replit Git pane stamps
#    "Replit Agent <agent@replit.com>". The inline env vars below are the
#    authoritative override (highest precedence). Run this from a PLAIN SHELL,
#    never the Replit Git pane.
git config user.name  "DotMatrixIO"
git config user.email "dot_matrix_apps@proton.me"
git add -A
GIT_AUTHOR_NAME="DotMatrixIO"  GIT_AUTHOR_EMAIL="dot_matrix_apps@proton.me" \
GIT_COMMITTER_NAME="DotMatrixIO" GIT_COMMITTER_EMAIL="dot_matrix_apps@proton.me" \
  git commit -m "VOID v0.x public baseline

Stateless, ephemeral, privacy-first peer-to-peer video conferencing.
Public history starts from a single squashed baseline; see README.md
(\"Public history starts at the v0.x baseline\") for why."

# 5. Re-run the author/committer check on the actual commit (§4.3).
git log --format='author=%an <%ae>%ncommitter=%cn <%ce>' -1

# 6. Push to the public remote (operator does this once verification is green).
git remote add origin git@github.com:DotMatrixIO/void.git
git push -u origin main

# 7. Retain full history privately. From the ORIGINAL repo (not "$PUB"),
#    push the real history to a PRIVATE remote the maintainer controls.
#    (Operator-run; the build agent is hard-blocked from this.)
#    e.g.  git push --mirror git@github.com:<private-owner>/void-history.git
```

Notes:

- **`git archive` vs `cp -r`.** `cp -r` of the working tree would carry `.git`
  (the entire history — the whole point of the snapshot is to drop it) and any
  untracked local cruft. `git archive HEAD | tar -x` emits exactly the tracked
  tree at HEAD, no `.git`, no gitignored files. It still emits `.agents/`
  because that is tracked — hence the explicit `rm -rf` in step 2.
- **Why set identity at commit time, not assume it.** A snapshot fixes file
  contents but the new commit's author/committer come from git config at
  `commit` time. Setting them inline (env vars + `git config`) is the only way
  to guarantee the legal name cannot leak through the authorship fields.

---

## 4. Verification checklist (run against the candidate tree, before push)

Run all of these against `"$PUB"` after step 2 and before step 4. A failure
stops the publish.

### 4.1 Automated secret scanner (backstop to the human read)

Run a real scanner over the candidate tree — this is a backstop, not a
substitute for the read. Either tool is acceptable:

```sh
# gitleaks (filesystem mode — scans files, not history, which is correct here:
# the candidate tree has no history yet).
gitleaks detect --no-git --source "$PUB" -c "$PUB/.gitleaks-void.toml" --redact -v
#   The -c is REQUIRED, not optional: the repo ships .gitleaks-void.toml whose
#   allowlist covers the canonical BIP39 test phrase and the documented
#   placeholder secrets. Without -c, gitleaks uses its default ruleset, those
#   test vectors fire as false-positive "leaks", and a scary-but-bogus result
#   at the publish gate is exactly the kind of thing that stalls a launch.

# or trufflehog filesystem mode:
trufflehog filesystem "$PUB" --only-verified
```

Triage every hit. Expected non-findings: RFC-2606 `void.example` placeholders,
the documented argon2id/ECDHE test vectors, and the `YOUR_SECRET_HERE`
placeholder in `coturn/turnserver.conf.example`. Anything else is a stop.

### 4.2 Single grep pass for the named hazards

One pass over the candidate tree for the three hazard classes. The legal-name
term is supplied by the operator at run time (it is intentionally not written
into this doc):

```sh
LEGAL_NAME="<MAINTAINER_LEGAL_NAME>"   # operator fills this in locally

grep -rIniE \
  "${LEGAL_NAME}|Void-PWA|\b(opensats|nlnet|geyser|hrf)\b" \
  "$PUB" \
  --exclude-dir=node_modules --exclude-dir=.git
```

`-i` keeps the scan case-insensitive (so `OpenSats`, `NLnet`, `HRF` are still
caught), `-I` skips binary files, and `\b…\b` bounds the short grant tokens
(notably `hrf`), so media files and incidental substrings — e.g. a
`pnpm-lock.yaml` integrity hash that happens to contain `hRF` — no longer
create noise.

This grep runs over the **shipped** candidate tree, which now includes the
publish guards themselves and this runbook — all of which name these terms *by
design*. So the pass does **not** return nothing; it returns a KNOWN, FIXED set
of residuals, and the triage rule is "only these, nothing else":

- **Legal name** → must return nothing. Any hit is a stop (see §1.2 / §1.4).
- **`Void-PWA`** and the **grant tokens** (`opensats`, `nlnet`, `geyser`,
  `hrf`) → the ONLY legitimate hits are the shipped guard scripts that define
  these as detection patterns —
  `artifacts/void-client/scripts/check-publish-doc-hygiene.mjs`,
  `artifacts/void-client/scripts/check-publish-cross-links.mjs`,
  `artifacts/void-client/scripts/banned-phrases.mjs` — and this scrub doc
  itself (`docs/pre-publish-scrub-2026-06.md`). A hit in ANY OTHER file is a
  stop. In particular, `Void-PWA` must not survive in
  `security-audit-public-2026-04.md` (confirm §1.5).

Also confirm the snapshot matches the inventory manifest — every STRIP entry
gone, every SHIP entry present, nothing unclassified. This is MANIFEST-DRIVEN:
it reads the same SHIP/STRIP lists as the step 1b source check, so the strip
verification can no longer drift from the manifest the way a hand-maintained
`test ! -e` list would. Run it from the repo root after step 2:

```sh
node scripts/check-publish-inventory.mjs --snapshot "$PUB"
# OK (snapshot)  -> all SHIP present, all STRIP absent, nothing unclassified,
#                   all NESTED_STRIP absent, .gitattributes carries no LFS rule.
# NOT-STRIPPED   -> a STRIP entry survived (a §3 rm line was missed/drifted).
# MISSING-SHIP   -> a SHIP entry was over-stripped or never archived.
# UNCLASSIFIED-IN-SNAPSHOT -> an unknown top-level entry reached the snapshot.
# NESTED-NOT-STRIPPED -> a NESTED_STRIP entry (aesthetic-audit-shots/ or
#                   aesthetic-audit.md) survived inside a SHIP dir — a §3 nested
#                   rm line was missed/drifted.
# LFS-RULE-PRESENT -> the shipped .gitattributes still carries a `filter=lfs`
#                   rule; empty it (the `: > "$PUB/.gitattributes"` step in §3).
# Any non-OK line is a STOP.
```

This supersedes the old per-file `test ! -e` block: the five STRIP entries
(`.agents`, `.replit`, `.replitignore`, `replit.md`, `replit.nix`) are now
asserted absent by the manifest, not by a separate hand-synced list. The same
check now also asserts the nested tier — the `aesthetic-audit-shots/` dir and
`aesthetic-audit.md` doc (the `NESTED_STRIP` list) are absent, and the shipped
`.gitattributes` carries no Git LFS rule — so the §3 nested `rm` lines and the
`.gitattributes` emptying can no longer silently drift from enforcement.

### 4.3 Git author / committer fields read DotMatrixIO only

After the initial commit exists (step 4), confirm both identities on the actual
published commit:

```sh
git -C "$PUB" log --format='A=%an <%ae> | C=%cn <%ce>' -1
# Must print exactly:
# A=DotMatrixIO <dot_matrix_apps@proton.me> | C=DotMatrixIO <dot_matrix_apps@proton.me>
```

Any other name or email is a stop — fix the git identity (§3 step 4) and
re-commit before pushing. The two failures this environment produces in
practice are `Replit Agent <agent@replit.com>` (the commit was made through the
Replit Git pane or a checkpoint instead of the §3 shell block) and the
maintainer's real name with a `…@users.noreply.replit.com` email (a fresh
`$PUB` inherited Replit's per-user config). Recover the existing commit with:

```sh
cd "$PUB"
git config user.name  "DotMatrixIO"
git config user.email "dot_matrix_apps@proton.me"
GIT_AUTHOR_NAME="DotMatrixIO"  GIT_AUTHOR_EMAIL="dot_matrix_apps@proton.me" \
GIT_COMMITTER_NAME="DotMatrixIO" GIT_COMMITTER_EMAIL="dot_matrix_apps@proton.me" \
  git commit --amend --reset-author --no-edit
```

then re-run the check above. If the bad commit was already pushed, force-push
the corrected baseline (acceptable for a one-way squashed baseline).

### 4.4 Final human read

The scanners and greps are backstops. Before the push, a human reads: the
candidate `docs/` tree end to end, the README/SECURITY/self-host docs, and any
file the greps flagged. The human read is the control; the tooling only catches
what the human might miss.

---

## 5. After publication

- Record the published initial-commit SHA and the date here (sibling note or an
  appendix), per the dated-doc convention (`docs/manifest-review-2026-05.md`
  §0).
- Confirm the public repo's default branch is `main` and that GitHub private
  vulnerability reporting is enabled (the `SECURITY.md` launch gate).
- Keep the private-history remote access-restricted to the maintainer.
