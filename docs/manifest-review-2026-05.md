# StartOS / Umbrel manifest review — 2026-05

**Date:** May 2, 2026
**Reviewer:** in-tree, same hand as `docs/security-audit-internal-2026-04.md`.
**Scope:** Static, read-only review of `manifest.yaml` (StartOS) and
`umbrel-app.yml` (Umbrel) at the May 2026 commit. No `.s9pk` was built;
no live store submission was attempted. This document is the
field-by-field reproducible baseline that the April audit's §11
limitation 9 named as "not exhaustively reviewed". The audit doc is
updated to point here.

**Policy versions reviewed against:**

- StartOS package manifest: the format documented at
  `https://docs.start9.com/0.3.5.x/developer-docs/packaging` as of
  May 2026 (manifest spec v1, `s9pk` toolchain). Fields that exist in
  the live spec but are not used by VOID are listed at the bottom of
  the table with the rationale for omission.
- Umbrel app manifest: `manifestVersion: 1`, schema documented at
  `https://github.com/getumbrel/umbrel-apps#manifest`. Same convention
  for omitted fields.

The platform-store policies themselves are moving targets. The
in-tree convention is that this document records the decisions taken
against the version named above; a future review pass against a
newer policy version writes a sibling `manifest-review-2026-XX.md`
and supersedes this one in the audit-doc cross-reference rather than
editing this file in place.

---

## 0. Outcome summary

- Every field of both manifests is enumerated below with the policy
  clause it satisfies and any deviation noted.
- The `tor-config` / `lan-config` audit (the load-bearing addition to
  this review per the May 2026 Tor-posture conversation) is recorded
  in §3. Both blocks correctly target the API server's port 3000;
  neither overlaps with an endpoint the other should not expose.
- The Tor-only deployment switch is documented in §4. The
  manifest-level mechanism is removal of the `lan-config` block;
  `TOR_ONLY=1` is added as a runtime hint that future code may key
  on (none does today — see §4 for the rationale).
- Persistent-state declaration (§5), host-network-mode justification
  for Coturn (§6), upgrade behavior (§7), and the Coturn config
  workflow reference (§8) are each declared in the manifest text
  itself, not just in this document.
- §11 limitation 9 in both audit docs is updated to point at this
  review pass.

No platform-store policy violation was identified. No deviation
required by the policies was unresolved. The placeholder `repo` /
`website` / `support` URLs (the long-standing `void.example` set)
remain placeholders pending the public-repository publication and
are called out in §10.

---

## 1. StartOS `manifest.yaml` — field-by-field

Order matches the file. "Policy clause" refers to the StartOS
package manifest spec section that defines the field. "Deviation"
is empty when the field is set to a value the policy contemplates;
otherwise the rationale is recorded.

| # | Field | Value (summarised) | Policy clause | Deviation / rationale |
|---|---|---|---|---|
| 1 | `id` | `void` | manifest-spec §1 (id, kebab-case) | None. |
| 2 | `title` | `VOID` | manifest-spec §1 (display title) | None. |
| 3 | `version` | `1.2.0` | manifest-spec §1 (semver) | None. Bumped from `1.1.0` in Task #259. |
| 4 | `release-notes` | block string covering H-01, H-05, M-01–M-06, R-9 hardening, env-var surface | manifest-spec §1 (operator-facing changelog) | None. Deliberately enumerates audit-tracked changes so a packager can read them at the manifest layer. |
| 5 | `license` | `MIT` | manifest-spec §1 | None. Matches `LICENSE`. |
| 6 | `wrapper-repo` | `https://void.example/repo` | manifest-spec §1 (packaging-repo URL) | **Placeholder.** Reserved-domain RFC 2606 value. Swap before submission — see §10. |
| 7 | `upstream-repo` | `https://void.example/repo` | manifest-spec §1 (upstream URL) | **Placeholder.** Same as above. |
| 8 | `support-site` | `https://void.example/support` | manifest-spec §1 | **Placeholder.** Same. |
| 9 | `marketing-site` | `https://void.example/` | manifest-spec §1 | **Placeholder.** Same. |
| 10 | `description.short` | one-sentence pitch | manifest-spec §1 (≤80 char) | None — currently 60 chars. |
| 11 | `description.long` | block paragraph covering the product, room TTL, agent-room exclusion, crypto primitives | manifest-spec §1 | None. |
| 12 | `assets.license` | `LICENSE` | manifest-spec §2 | None. File present at repo root. |
| 13 | `assets.icon` | `void-icon.png` | manifest-spec §2 | None. File present at repo root. |
| 14 | `main.type` | `docker` | manifest-spec §3 | None. |
| 15 | `main.image` | `main` | manifest-spec §3 (image tag inside the s9pk) | None. Built from the repo-root `Dockerfile`, which in turn runs as the non-root `node` user (audit M-06 fix). |
| 16 | `main.entrypoint` | `["node", "--enable-source-maps", "./dist/index.mjs"]` | manifest-spec §3 | None. Matches the `Dockerfile` `CMD`. Source maps enable readable production stack traces; see audit §3.6 for the privacy implication (no PII in stack frames). |
| 17 | `main.args` | `[]` | manifest-spec §3 | None. |
| 18 | `main.mounts` | `{}` | manifest-spec §3 (host volume mounts) | **Empty by design** (see §5). The package is stateless; no host volume is requested. |
| 19 | `main.io-format` | `yaml` | manifest-spec §3 | None. |
| 20 | `health-checks.web-ui` | wgets `http://localhost:3000/api/health` | manifest-spec §4 | None. Targets the dedicated `/api/health` JSON endpoint added in Task #259, not the root `/` route — avoids loading the full client bundle on every health tick. |
| 21 | `interfaces.main.tor-config` | maps onion port `80` → container `3000` | manifest-spec §5 | See §3. |
| 22 | `interfaces.main.lan-config` | maps `443:ssl=true,internal=3000` | manifest-spec §5 | See §3. Removable for Tor-only deployments — see §4. |
| 23 | `interfaces.main.ui` | `true` | manifest-spec §5 | None. The interface renders a UI in the StartOS dashboard. |
| 24 | `interfaces.main.protocols` | `[tcp, http]` | manifest-spec §5 | None. WebSocket upgrades ride on top of HTTP and do not need a separate protocol entry; see audit §2.1 for the signaling-channel discussion. |
| 25 | `dependencies.coturn` | `>=4.6.0`, opt-out via `TURN_URL`/`TURN_SECRET` | manifest-spec §6 | None. Coturn is opt-out (not required); operators who use an external TURN provider leave the bundled service unconfigured and set the env vars to point elsewhere. The dependency description names the credential model (HMAC-SHA1) and the placeholder-secret startup guard (audit M-05 fix). |
| 26 | `volumes` | `{}` | manifest-spec §7 | **Empty by design.** No persistent volume is required; see §5. |
| 27 | `alerts.start` | block string enumerating required env vars, the Lightning-backend matrix, the placeholder-secret guards, and the M-04 jitter knobs | manifest-spec §8 | None. The alert is the operator's first-startup instruction surface; the env-var enumeration matches the actual code path in `artifacts/api-server/src/index.ts` and `routes/paywall.ts`. |

**Fields in the live spec that are intentionally omitted:**

- `actions` — VOID exposes no operator-triggered actions (the
  product surface is paywall + room state, both end-user driven).
  Omitted is the correct value for "no actions".
- `backups` — VOID has no persistent state to back up (see §5);
  omitting the block matches the policy intent ("declare no backups
  if there is nothing to back up").
- `migrations` — there is no schema to migrate; see §5 and §7.
  StartOS will treat absent migrations as "no-op upgrade", which is
  what the package wants on N → N+1.
- `eos-version` — left to the StartOS toolchain to derive from the
  build environment. A future submission may pin a floor (e.g.
  `0.3.5.1`) once the public-repository publication is in flight.

---

## 2. Umbrel `umbrel-app.yml` — field-by-field

| # | Field | Value (summarised) | Policy clause | Deviation / rationale |
|---|---|---|---|---|
| 1 | `manifestVersion` | `1` | umbrel-apps schema | None. |
| 2 | `id` | `void` | umbrel-apps schema (kebab-case, app-store unique) | None. |
| 3 | `name` | `VOID` | umbrel-apps schema | None. |
| 4 | `tagline` | one-sentence pitch | umbrel-apps schema (≤100 char) | None — currently 60 chars. |
| 5 | `icon` | `https://void.example/void-icon.png` | umbrel-apps schema (icon URL or repo-root file) | **Placeholder.** The repo-root `void-icon.png` is canonical; the URL form is what the Umbrel store consumes. Swap before submission — see §10. |
| 6 | `category` | `communication` | umbrel-apps schema (one of the published category strings) | None. `communication` is the closest match for a P2P video-conf product; alternatives `social` and `productivity` are weaker fits. |
| 7 | `version` | `1.2.0` | umbrel-apps schema | None. Bumped from `1.1.0` in Task #259. |
| 8 | `port` | `3000` | umbrel-apps schema (single host-bound port) | None. Matches the API server's `PORT` and the `docker-compose.yml` mapping. Umbrel does not have a parallel of StartOS's `tor-config`/`lan-config` split; the operator publishes the app over Umbrel's own Tor option using this single port. |
| 9 | `description` | block string identical in substance to the StartOS `description.long` | umbrel-apps schema (long description) | None. |
| 10 | `developer` | `VOID` | umbrel-apps schema | None. |
| 11 | `website` | `https://void.example/` | umbrel-apps schema | **Placeholder.** See §10. |
| 12 | `submitter` | `VOID` | umbrel-apps schema | None. |
| 13 | `submission` | `https://void.example/` | umbrel-apps schema (link to the PR/submission record) | **Placeholder.** Updated at submission time. |
| 14 | `repo` | `https://void.example/repo` | umbrel-apps schema | **Placeholder.** See §10. |
| 15 | `support` | `https://void.example/support` | umbrel-apps schema | **Placeholder.** See §10. |
| 16 | `gallery` | `[]` | umbrel-apps schema (gallery image URLs) | **Empty by design.** Adding marketing screenshots is a packaging-cosmetic decision deferred until submission; the empty list satisfies the schema (the field is required, not the contents). |
| 17 | `releaseNotes` | block string matching the StartOS `release-notes` text | umbrel-apps schema | None. |
| 18 | `dependencies` | `[]` | umbrel-apps schema (declared Umbrel-app deps) | **Empty by design.** Coturn is not packaged as a separate Umbrel app dependency — see the in-file comment block, repeated in `README-selfhost.md` §6a, on why home-Umbrel boxes are typically not a good place to run TURN. |
| 19 | `path` | `""` | umbrel-apps schema (subpath under the proxy) | None. The app serves at the root of its assigned port. |
| 20 | `defaultUsername` / `defaultPassword` | `""` / `""` | umbrel-apps schema (initial credentials, if any) | **Empty by design.** VOID has no accounts (see audit §1 and §10.2); there is no credential to seed. |

**Fields in the live schema that are intentionally omitted:**

- `permissions` — Umbrel's manifest schema does not request
  per-capability permissions in the StartOS sense; the only
  mechanism is the host-network/UDP-port surface described under
  the dependency comment for Coturn and §6 below. The empty
  `dependencies: []` plus the absence of any `permissions:`-shaped
  block is the correct way to express "no extra capabilities
  needed beyond the bound port".
- `optimizedForUmbrelHome` / similar marketing fields — not part
  of `manifestVersion: 1`. Will be evaluated against whatever
  schema is current at submission time.

---

## 3. Tor-config / lan-config audit

This is the load-bearing addition the May 2026 Tor-posture
conversation asked for. The question is not just "are the blocks
well-formed" — it is: **does the declared exposure surface match
what marketing/threat-model claim, and does it match what an
operator actually exposes once they install the package?**

### 3.1 Declared exposure (manifest)

`manifest.yaml` `interfaces.main`:

- `tor-config.port-mapping: { 80: "3000" }` — the StartOS-managed
  Tor hidden service publishes onion port 80, which routes to the
  API server's container port 3000.
- `lan-config: { 443: { ssl: true, internal: 3000 } }` — the
  StartOS-managed LAN HTTPS endpoint publishes port 443, also
  routing to container port 3000.

Both targets point at the **same** backend port (3000). There is
no second container port, no admin endpoint, no debug socket, and
no separate signaling endpoint — the API server does signaling,
paywall, room state, ICE-server config, and static-asset serving
all on the same Express + Socket.io listener. The audit verified
this in `artifacts/api-server/src/index.ts`,
`artifacts/api-server/src/app.ts`, and the route index at
`artifacts/api-server/src/routes/index.ts`.

**Therefore the two blocks cannot overlap in a problematic way.**
The honest version of "the onion-service target is the signaling
endpoint" is that there is only one endpoint to begin with — the
signaling endpoint *is* the same surface the LAN HTTPS interface
exposes. There is no separate admin/debug surface that one block
should expose and the other should not.

### 3.2 Stated vs declared vs actual surface comparison

| Layer | What it says | Where |
|---|---|---|
| Marketing claim | "Self-hosting on StartOS routes traffic through Tor by default. Use it if this matters to you." | `artifacts/void-client/src/pages/ThreatModelPage.tsx` (Network metadata paragraph) — also on the `marketing-claims-audit.md` WATCH list as a forward-looking distribution claim. |
| Threat-model technical mirror | Tor is named as the network-anonymity layer for users who need it; VOID is "not an anonymizing system" by itself. | `docs/threat-model.md` §2. |
| Manifest declares | Two interfaces — `tor-config` (onion port 80 → 3000) and `lan-config` (HTTPS 443 → 3000). The operator picks at install/configuration time which interface(s) to enable in the StartOS UI. | `manifest.yaml` interfaces block. |
| Operator actually exposes | Whatever the operator selects in the StartOS interface picker. The default StartOS behavior is to advertise both interfaces; the user-facing "open this app" link in the StartOS dashboard offers both. | StartOS dashboard, post-install. |

~~**The drift is narrow but real**: marketing copy says "routes
traffic through Tor by default", and the manifest does declare a
Tor interface, but it does not assert a default *preference* —
both interfaces are advertised side-by-side. A user who installs
on StartOS and clicks the LAN HTTPS link gets a clearnet path; a
user who clicks the onion link gets a Tor path. Closing the drift
fully requires either softening the marketing copy (tracked
elsewhere as the "Tighten the Tor-by-default StartOS claim
wording" task) or shipping a Tor-only deployment switch (§4
below).~~

**Updated 2026-05-03 (Task #238 — wording tightened, drift closed.)**
The marketing copy was the surface that moved.
`ThreatModelPage.tsx`, `manifest.yaml` (the interfaces comment),
`umbrel-app.yml` (releaseNotes), and `README-selfhost.md` §6c now
all describe the package as `.onion`-**reachable** — the
signaling layer can be fronted by a Tor hidden service — and
explicitly disclaim end-to-end Tor routing, because WebRTC media
still gathers ICE candidates on the user's underlying network
regardless of how the page loaded. The manifest still advertises
both `tor-config` and `lan-config` side-by-side; the operator
still picks. A regression rule in
`artifacts/void-client/scripts/banned-phrases.mjs` now flags any
reintroduction of `Tor-by-default` or `Tor-routed` (with a
lookahead exclusion for the legitimate "Tor-routed wallet/node"
recommendations elsewhere on `ThreatModelPage` and `StartScreen`).
The Tor-only switch (§4 below) remains the orthogonal,
operator-side path for those who want a `.onion`-only posture.

### 3.3 Confidence

This section is at the **"verified by reading the manifest +
verified by reading the API server source"** confidence tier.
Because there is only one backend port and no separate admin
surface, no overlap can exist between the two interface blocks
that this static review would have missed. A different shape
would emerge only if the API server grew a second listener on a
new port (e.g. an admin socket on 3001) — that is the trigger
event a future review pass should watch for. None exists today.

---

## 4. Tor-only deployment switch

### 4.1 Mechanism

The manifest-level switch is **deletion (or comment-out) of the
`lan-config` block in `manifest.yaml`.** Once the LAN interface
is gone, StartOS only advertises the Tor hidden-service
interface, and the package ships `.onion`-only. The mechanism is
operator-side because the StartOS package format is text the
operator has full control over once the `.s9pk` is sideloaded;
the manifest's job is to make the edit obvious and safe.

A diff that ships `.onion`-only:

```diff
 interfaces:
   main:
     name: Web Interface
     description: VOID video conferencing UI
     tor-config:
       port-mapping:
         80: "3000"
-    lan-config:
-      443:
-        ssl: true
-        internal: 3000
     ui: true
     protocols:
       - tcp
       - http
```

The change is purely declarative — no API server code needs to
behave differently, because the API server is not aware which
interface a request arrived on. The only consequence is that the
StartOS dashboard stops offering the LAN-HTTPS link.

### 4.2 `TOR_ONLY` env var

`TOR_ONLY=1` is declared in `alerts.start` in `manifest.yaml`
and in `releaseNotes` in `umbrel-app.yml`. The manifest edit
that removes the `lan-config` block remains the load-bearing
part of the switch, but **the env var now keys runtime behavior
that protects the onion-only posture** (implemented in
`artifacts/api-server/src/lib/torOnly.ts` and wired into
`src/index.ts` and `src/routes/ice-servers.ts`):

- `GET /api/ice-servers` omits any configured `STUN_URL` from its
  response. A STUN binding request reveals each peer's public IP
  to a clearnet third party during ICE gathering, which defeats
  onion-only routing; under `TOR_ONLY=1` no STUN candidate is
  offered (the TURN relay is still advertised).
- The startup banner in `index.ts` prints the active onion-only
  posture so an operator can confirm it from the logs.
- A startup warning fires if `TURN_URL` is configured but does
  not appear to terminate over Tor — i.e. it is not a `turns:`
  relay on a `.onion` host. A clearnet TURN relay reached off-Tor
  undermines the posture.

The env var was originally reserved (rather than invented at
implementation time) so this behavior could ship under the
already-documented name without an env-var rename, sparing
operators who set `TOR_ONLY=1` early any surprise.

### 4.3 Default

Default is **both surfaces advertised** (i.e. the manifest stays
as written). Most StartOS users want LAN access; the Tor-only
mode is opt-in. This matches the marketing claim's framing ("Use
it if this matters to you") rather than forcing every operator
into a posture that breaks LAN-network discoverability.

### 4.4 Documentation home

`README-selfhost.md` §6b documents the switch with the
security tradeoff (no LAN access, all access via Tor; reduced
discoverability for casual users; recommended for operators
whose threat model includes a hostile LAN) and cross-references
the `.local/tasks/operator-onion-mirror-runbook.md` task.

The Umbrel manifest does not have a parallel — Umbrel's own Tor
support is enabled in the Umbrel UI, not in the app manifest, so
there is no equivalent `lan-config` block to remove. The Tor-only
posture on Umbrel is achieved by enabling Umbrel's per-app Tor
exposure and not publishing the local-network port; that is
already covered by the Umbrel platform documentation and
re-stated in `README-selfhost.md` §6a.

---

## 5. Persistent-state declaration

VOID is stateless by design. The audit (§5 of the internal doc)
confirms there is no database, no on-disk room state, no
persisted user content. State surfaces:

- **Room state** — in-memory only (`artifacts/api-server/src/rooms.ts`),
  wiped on process restart by design (audit §9.6).
- **Recovery codes** — in-memory only, wiped with the rest of
  room state.
- **JWT signing secret** — `PAYWALL_SECRET` if set, otherwise an
  ephemeral per-process secret (audit §1; `routes/paywall.ts`).
  The ephemeral fallback is the documented single-instance
  default. Operator-set values live in the operator's env, not in
  any package-managed volume.
- **TURN ephemeral credentials** — minted on demand, never
  persisted (audit §3.7).
- **Browser-side host token** — encrypted-at-rest in the
  *browser's* `localStorage` (audit §R-9.1). This is on the user's
  device, not on the operator's host; not in scope for the
  manifest's persistent-state declaration.

**Manifest declaration:** `main.mounts: {}` and `volumes: {}` in
`manifest.yaml`; no equivalent block in `umbrel-app.yml`. Both
are correct: the package requests no host volume.

The audit adds one nuance: `coturn/turnserver.conf` does require
operator state on the *Coturn* side (the operator-edited copy of
`turnserver.conf.example`), but that file lives in the Coturn
service's own surface and is referenced as an external dependency,
not in VOID's main image. See §6 and §8.

---

## 6. Network-mode justification

The bundled `coturn` service in `docker-compose.yml` runs with
`network_mode: host`. This is **required** by Coturn's design —
the relay port range (`min-port=49152`, `max-port=65535` in
`turnserver.conf.example`) must be reachable directly on the host,
because the WebRTC peers connect to those ports by IP, and Docker's
default bridge networking would NAT them in a way that breaks the
ICE candidate addresses Coturn advertises. This is documented
upstream in the Coturn project README and is the standard
deployment shape.

**Per-platform justification:**

- **StartOS**: Coturn is declared as an *opt-out dependency* in
  `manifest.yaml` (`requirement: opt-out`). The StartOS host-network
  policy permits dependent services to run with elevated network
  scope when the dependency declares the requirement explicitly,
  which the `coturn` package does (and which is the standard pattern
  for Coturn on StartOS). VOID's own image does not request host
  network mode — only the Coturn dependency does.
- **Umbrel**: Coturn is **not** packaged as a separate Umbrel app
  dependency (`dependencies: []` and the in-file comment block
  explain why — home-Umbrel boxes are typically not a good place to
  run TURN). The standard Umbrel deployment is "VOID app on Umbrel,
  Coturn on a public VPS"; neither half requests host network mode
  on the Umbrel side. This sidesteps the Umbrel host-network policy
  entirely.

Without this justification a platform reviewer would reject on the
network mode and the package would be back at step one. The
justification text above lives in this review document; the
manifest-level pointer is the `coturn` dependency description in
`manifest.yaml` (which explicitly names the HMAC-SHA1 credential
model and the relay port range expectation).

---

## 7. Upgrade behavior

What happens on N → N+1 (e.g. 1.2.0 → 1.3.0):

- **In-flight rooms terminate ephemerally.** The package is
  stateless (§5); a process restart wipes room state by design.
  Active peers see signaling drop and can rejoin a fresh room.
- **`PAYWALL_SECRET` behavior.** If the operator set it, the value
  persists across upgrades (it lives in the operator's env, not in
  a package-managed volume). If unset, a fresh ephemeral secret is
  generated per process — JWTs minted before the upgrade are
  invalidated. This is the documented single-instance default.
- **`TURN_SECRET` behavior.** Same as `PAYWALL_SECRET` — operator
  env-managed; persists across upgrades unless the operator
  rotates it.
- **No data migration.** No schema, no backfill, no
  format-conversion step. The empty `migrations` block is the
  correct value.
- **Re-auth required for hosts who lost their JWT to the restart
  but have a recovery code.** The recovery flow (audit §R-2) mints
  a fresh JWT against the original `paymentHash` for the remaining
  paid window.

**Manifest declaration:** the StartOS `release-notes` block on
`manifest.yaml` and the Umbrel `releaseNotes` block on
`umbrel-app.yml` both lead with the line **"Operators upgrading
from 1.1.0 should re-read the environment-variable section below
— defaults and startup guards have changed"**, so the platform
upgrade-notification machinery surfaces the change to operators.
This convention is preserved on every minor bump.

---

## 8. Coturn config workflow at the manifest level

The package ships `coturn/turnserver.conf.example` and **not**
`coturn/turnserver.conf` itself (the latter is gitignored, per
audit M-05 fix). The operator's copy-and-edit workflow is:

```bash
cp coturn/turnserver.conf.example coturn/turnserver.conf
# edit static-auth-secret to a fresh openssl rand -hex 32 value
# set the same value as TURN_SECRET in the env
```

The API server's `assertTurnSecretNotPlaceholder` startup guard
(`artifacts/api-server/src/lib/turnSecret.ts`, audit §R-7)
refuses to boot if the operator left the placeholder in place,
so the workflow fails closed.

**Manifest-level reference:**

- `manifest.yaml`: the `dependencies.coturn` block names the
  HMAC-SHA1 credential model and the placeholder-secret guard
  (existing language). The implicit expectation is that the
  StartOS `coturn` package the operator depends on already ships
  with its own config, and the operator sets the matching shared
  secret via the StartOS UI.
- `umbrel-app.yml`: the in-file comment block explains why Coturn
  is not packaged as an Umbrel dependency and points at
  `README-selfhost.md` §6a for the recommended split.

The workflow itself (the `cp ... && edit && set env` sequence)
lives in `README-selfhost.md` §3 (Quick Start step 2) and §4a
(detailed setup). Per the task scope, this review documents the
manifest-level pointer; the audit-doc §7 / §11 limitation 7
covers the Coturn config-file content review separately.

---

## 9. Edits made by this review

The minimisation and policy-clause-comment pass yielded the
following changes:

- `manifest.yaml`:
  - The `dependencies.coturn` description already enumerates the
    HMAC-SHA1 credential model and the placeholder-secret guard;
    no addition needed.
  - Added a `lan-config`-removal pointer to `alerts.start`
    naming the Tor-only switch.
  - Added `TOR_ONLY` to the env-var enumeration in `alerts.start`
    with the contract documented in §4.2 above.
  - Added a `host-network` justification comment block above
    `dependencies.coturn` so a platform reviewer can find the
    rationale at the manifest layer (rather than only here).
  - Added an explicit **Upgrade behavior (N → N+1)** section to
    `release-notes` declaring at the manifest layer that in-flight
    rooms terminate ephemerally on the upgrade restart, that
    operator-set `PAYWALL_SECRET` / `TURN_SECRET` persist via env
    while unset `PAYWALL_SECRET` regenerates and invalidates
    pre-upgrade JWTs (with the recovery-code re-mint path), and
    that no data migration is required (the omitted `migrations`
    block is the correct "no-op upgrade" declaration). This is
    the section the StartOS upgrade-notification surface reads.
  - Added an explicit **Coturn configuration workflow** section
    to `release-notes` naming the shipped
    `coturn/turnserver.conf.example` file, the `cp ... && edit
    static-auth-secret && set TURN_SECRET` operator workflow, the
    fail-closed posture provided by the placeholder-secret startup
    guard, and the StartOS-specific `dependencies.coturn`
    indirection (operator sets the matching shared secret via the
    StartOS UI rather than editing the bundled example file).
- `umbrel-app.yml`:
  - Added `TOR_ONLY` to the env-var enumeration in
    `releaseNotes` with the same contract.
  - Added an **Upgrade behavior (N → N+1)** paragraph to
    `releaseNotes` mirroring the StartOS declaration so the
    Umbrel upgrade-notification surface carries the same
    behavior to operators (rooms terminate, secret-persistence
    semantics, no migrations).
  - Added a **Coturn configuration workflow** paragraph to
    `releaseNotes` naming `coturn/turnserver.conf.example`, the
    `cp / edit static-auth-secret / set TURN_SECRET` workflow,
    and the Umbrel-specific recommended split (VOID on Umbrel,
    Coturn on a public VPS — `dependencies: []` is the matching
    correct value).
- `README-selfhost.md`:
  - §6b gains a Tor-only deployment subsection cross-referencing
    this document and the operator-onion-mirror runbook task.
  - §5 (env-var reference) gains a `TOR_ONLY` row.
- `docs/security-audit-internal-2026-04.md` and
  `docs/security-audit-public-2026-04.md`:
  - §11 limitation 9 is updated with a 2026-05 note pointing at
    this review document.

No permission, exposed-port, or volume request was found that
the running container does not actually use. Nothing was removed
on the minimisation pass — the manifests were already minimal
against the actual container surface, which is the audit-positive
outcome.

---

## 10. Residual gap — placeholder URLs

The `wrapper-repo` / `upstream-repo` / `support-site` /
`marketing-site` URLs in `manifest.yaml` and the
`icon` / `website` / `submission` / `repo` / `support` URLs in
`umbrel-app.yml` are deliberate RFC 2606 `void.example`
placeholders. The user confirmed on 2026-05-02 (recorded in
`docs/security-audit-internal-2026-04.md` "Self-host package
version bump") that no public repository has been published yet.

Submission to either store is blocked on these URLs being
swapped to real values. The placeholder state is itself the
correct posture today — better than inheriting a possibly-wrong
URL from a downstream fork — but it must be resolved before the
`.s9pk` is built and uploaded. This review document does not
attempt to set canonical URLs that do not yet exist.

---

## 11. Re-eval triggers

This review should be redone (writing a sibling
`manifest-review-2026-XX.md`, not editing this file in place) when
any of the following fires:

- StartOS publishes a new manifest-spec major version, or its
  store-acceptance policy changes in a way that touches host
  networking, persistent state declaration, or interface-block
  shape.
- The Umbrel `manifestVersion` increments past `1`, or its
  schema gains a `permissions`-shaped block that VOID would have
  to declare against.
- The API server grows a second listener (a new port beyond
  3000) — this changes the §3 confidence argument that the two
  interface blocks cannot overlap in a problematic way.
- A platform reviewer rejects the package on a manifest field
  this document graded as compliant.
- The Tor-only switch moves from "documented manifest-edit + env
  var contract" to "documented manifest-edit + env var with
  actual code behavior keyed off it" — the §4.2 contract becomes
  load-bearing at that point and must be re-stated against the
  shipping behavior.

Backstop calendar date for a refresh in the absence of any of
the above: **2026-11**.
