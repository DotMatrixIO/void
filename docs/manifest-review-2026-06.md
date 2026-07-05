<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# StartOS / Umbrel manifest review — 2026-06 (URL-swap addendum)

**Date:** June 11, 2026
**Scope:** Narrow, single-purpose addendum to
`docs/manifest-review-2026-05.md`. It records that the one residual gap that
review left open — the RFC 2606 `void.example` placeholder URLs in both
manifests — is now **closed**, and it supersedes the 2026-05 review's §10
residual-gap note. Nothing else in the 2026-05 review changes; its
field-by-field tables, the `tor-config`/`lan-config` audit (§3), the Tor-only
switch (§4), and the persistent-state / network-mode / upgrade-behavior /
Coturn-workflow sections remain the authoritative baseline.

This sibling-document form (rather than editing the dated 2026-05 review in
place) follows the in-tree convention recorded in
`docs/manifest-review-2026-05.md` §0 and §11 and reaffirmed in
`docs/launch-decisions.md` §7: dated review docs are not retro-edited; a later
pass writes a sibling and supersedes the prior one in the cross-reference.

**Scope note (2026-06-11):** §1–§5 are the original URL-swap addendum. §6 and
§7 were appended on 2026-06-11 to record an in-environment **build-readiness
audit** (manifest config surface reconciled against the API server's actual
env-var contract and the Dockerfile) plus **operator build notes** for the
`.s9pk` build, requested ahead of an operator-run StartOS packaging attempt.
The live `.s9pk` build and StartOS install/smoke-test themselves are **not**
runnable in this environment (`start-sdk` is not installed and there is no
StartOS instance — same gate as §4) and remain operator actions.

---

## 1. What changed since 2026-05

The 2026-05 review (§10) recorded the manifest URLs as deliberate
`void.example` placeholders, correct-by-posture but blocking StartOS / Umbrel
store submission until the public repository, marketing site, and support
channel were live.

The maintainer locked the canonical public repository on 2026-06-04
(`docs/launch-decisions.md` §7): **`https://github.com/Void-PWA/void`**. The
placeholder→canonical swap was then landed as a single atomic pass across the
manifests, the in-app footer source link, and the threat-model deep-links.
There are now **zero `void.example` strings** in either manifest.

## 2. Canonical values now in the manifests

| File | Field(s) | Value |
| ---- | -------- | ----- |
| `manifest.yaml` | `wrapper-repo`, `upstream-repo`, `marketing-site` | `https://github.com/Void-PWA/void` |
| `manifest.yaml` | `support-site` | `https://github.com/Void-PWA/void/issues` |
| `umbrel-app.yml` | `repo`, `website`, `submission` | `https://github.com/Void-PWA/void` |
| `umbrel-app.yml` | `support` | `https://github.com/Void-PWA/void/issues` |
| `umbrel-app.yml` | `icon` | `https://raw.githubusercontent.com/Void-PWA/void/main/void-icon.png` |

Notes:

- `icon` resolves to the published repo-root `void-icon.png` via the
  `raw.githubusercontent.com/.../main/...` path, satisfying the 2026-05 §2
  row 5 requirement (the repo-root file is canonical; the URL form is what the
  Umbrel store consumes).
- `submission` is set to the repo root for now. If VOID is submitted to the
  Umbrel app store, update it to the submission-PR record at that time
  (2026-05 review §11 re-eval trigger; see also `docs/launch-decisions.md` §7).
- Test fixtures intentionally keep `void.example` as a permanent RFC 2606
  mock origin (`docs/launch-decisions.md` §3.4); only operator/user-facing
  placeholders were swapped.
- The manifest owner-comment blocks were updated in lockstep so they no longer
  describe the URLs as pending placeholders; both still carry the
  `docs/manifest-review-2026-05.md §11 for the re-eval trigger` cross-reference
  pinned by `artifacts/void-client/scripts/check-onion-mirror-sync.mjs`.

## 3. Status of 2026-05 §10 (residual gap) — CLOSED

The 2026-05 review §10 "Residual gap — placeholder URLs" is **superseded by
this section**. The placeholder URLs are no longer a residual gap; the URLs
are canonical. The §11 limitation-9 cross-references in
`docs/security-audit-internal-2026-04.md` and
`docs/security-audit-public-2026-04.md` are updated with a dated note pointing
here.

## 4. Remaining submission-readiness item (operator action)

One submission-readiness step from the 2026-05 review's "Done looks like" is
**not** code or doc work and cannot be performed in the build environment:

- **Build the bumped `.s9pk` and verify it installs in a StartOS test
  instance** before store submission. This requires the StartOS `start-sdk`
  packaging toolchain and a live StartOS instance — an operator/maintainer
  action, the same class as the repository push itself
  (`docs/launch-decisions.md` §8, §10; `docs/publish-opsec-prep-2026-06.md`
  §9). It is recorded here as the remaining gate, not closed.

No manifest `version` bump is made for the URL swap on its own: the version
(`1.2.0`) is tied to the release-notes content describing the May 2026
monorepo state, and any bump belongs to the operator's `.s9pk` rebuild /
submission step.

## 5. Re-eval triggers

Unchanged from `docs/manifest-review-2026-05.md` §11. Add one:

- When the `.s9pk` is built and a StartOS install is verified, record the
  outcome (and any `version` bump) as a sibling note here or in
  `docs/launch-decisions.md` §10's post-push template.

---

## 6. Build-readiness audit (in-environment, 2026-06-11)

**Method.** The API server's actual env-var contract was extracted by reading
every `process.env[...]` / `process.env....` site under `artifacts/api-server/src`
and `lib/` (excluding tests/demos), then reconciled against `manifest.yaml`,
`umbrel-app.yml`, `docker-compose.yml`, and the root `Dockerfile`. The live
`.s9pk` build and StartOS install were not run (see scope note). Findings are
tagged **[BLOCKER]**, **[LIKELY-BREAK]**, **[OK]**, or **[MINOR]**.

### 6.1 Env-var contract reconciliation

Consumed across `artifacts/api-server/src` (server runtime) and `lib/`
(adjacent SDK/build reads), excluding tests/demos: `LIGHTNING_BACKEND`,
`PAYWALL_SECRET`, `LNBITS_URL`, `LNBITS_API_KEY`, `BTCPAY_URL`,
`BTCPAY_API_KEY`, `BTCPAY_STORE_ID`, `TURN_URL`, `TURN_SECRET`,
`TURN_CREDENTIAL_TTL`, `STUN_URL`, `DEFAULT_STUN_URL`, `TOR_ONLY`,
`ONION_HOSTNAME`, `TRUST_PROXY_HOPS`, `PAYWALL_JITTER_MIN_MS`,
`PAYWALL_JITTER_MAX_MS`, `PAYWALL_JITTER_DISABLE`, `ENABLE_AGENT_ROOMS`,
`LOG_LEVEL`, `NODE_ENV`, `PORT`, `CLIENT_DIST`/`CLIENT_DIST_DIR`,
`SERVE_STATIC`, `ROOM_STATE_FILE`, `SHUTDOWN_DRAIN_MS`, `RELEASE_CHECK_REPO`,
`LIGHTNING_FETCH_TIMEOUT_MS`, `NTFY_SERVER`, `NTFY_TOKEN`, `NTFY_TOPIC`,
`CLOUDFLARE_TURN_API_TOKEN`, `CLOUDFLARE_TURN_TOKEN_ID`, `REPLIT_DEV_DOMAIN`,
`REPLIT_DOMAINS`.

Attribution precision: two entries above are **not** API-server runtime vars and
are not operator-facing StartOS config — `DEFAULT_STUN_URL` is read only by the
agent SDK (`lib/void-agent-sdk/src/agent.ts`), and `CLIENT_DIST_DIR` is
build-time only (`artifacts/api-server/build.mjs`); the server reads
`CLIENT_DIST` at runtime. `STUN_URL` (distinct from `DEFAULT_STUN_URL`) *is* a
real API-server runtime read (`index.ts`, `routes/ice-servers.ts`).

Note (process audit): these are read via **bracket notation**
(`process.env["TURN_SECRET"]`). A dot-only grep falsely reports the TURN /
PAYWALL / ONION group as absent — they are consumed. Any future audit must
scan both notations.

- **[OK]** The operator-facing set in `manifest.yaml` `alerts.start` and
  `umbrel-app.yml` `releaseNotes` covers every var an operator must set for a
  production deployment: `LIGHTNING_BACKEND`, `PAYWALL_SECRET`, the LNbits /
  BTCPay credential groups, `TURN_URL` / `TURN_SECRET`, `TURN_CREDENTIAL_TTL`,
  `STUN_URL`, `TRUST_PROXY_HOPS`, `LOG_LEVEL`, `NTFY_*`, `TOR_ONLY`,
  `PAYWALL_JITTER_*`, `ENABLE_AGENT_ROOMS`. Defaults stated in prose match the
  code (`TURN_CREDENTIAL_TTL` 4500; jitter 10000/60000; `TRUST_PROXY_HOPS` 1;
  `ENABLE_AGENT_ROOMS` 0).
- **[MINOR]** `ONION_HOSTNAME` is consumed (`artifacts/api-server/src/app.ts`
  drives the canonical/onion redirect when it is set and matches
  `/^[a-z2-7]{16,}\.onion$/i`) but is **not** listed in either manifest's
  operator surface. On StartOS the hidden-service hostname is assigned by the
  OS and is unknown until the Tor interface is created, so it cannot be a
  build-time value; if the canonical-redirect behavior is wanted on StartOS it
  must be wired post-provision. Left unset it is simply inert (no redirect),
  which is a safe default — hence MINOR, not a blocker.
- **[MINOR]** `CLOUDFLARE_TURN_API_TOKEN` / `CLOUDFLARE_TURN_TOKEN_ID` are an
  alternate managed-TURN path read by `routes/ice-servers.ts` (takes
  precedence over the coturn `TURN_URL`/`TURN_SECRET` branch). Not mentioned
  in either manifest. Operators using bundled/external coturn do not need
  them; document only if the Cloudflare TURN path is to be supported on
  StartOS.

### 6.2 [BLOCKER] No StartOS `config` mechanism exists

`manifest.yaml` has **no** `config`, `actions`, or `properties` section, there
is **no** config-spec file, and there are **no** StartOS wrapper artifacts in
the repo (`git ls-files` finds no `config-spec`, `*.s9pk`, `embassy`,
`procedures`, or `start-sdk` scaffolding). The only thing that maps env vars
into a container is `docker-compose.yml`, which is the plain-Docker / Umbrel
path — **not** StartOS.

Consequence: with the current manifest, start-sdk can build an image and
package it, but StartOS will render **no config UI**, so an operator cannot set
`PAYWALL_SECRET`, `TURN_SECRET`, `LIGHTNING_BACKEND`, the Lightning credential
groups, `TURN_URL`, etc. through the StartOS interface. The container would
boot on the Dockerfile `ENV` defaults only (`PORT=3000`, `NODE_ENV=production`,
`SERVE_STATIC=1`, `ENABLE_AGENT_ROOMS=0`, ephemeral `PAYWALL_SECRET`, no
Lightning backend configured, no TURN) — i.e. it starts but is not a usable
paid-room deployment. The `alerts.start` prose tells operators *what* to set
but provides no surface to set it.

This directly fails the 2026-05 "Done looks like" bar that every env var the
server requires be settable through the StartOS config UI. **It must be
resolved before a StartOS submission build is meaningful.** Resolution is a
StartOS config spec (config-spec + a `config` set procedure that writes the
env/`io-format: yaml` payload the entrypoint consumes) — design work, not a
one-line edit. The `io-format: yaml` already declared on `main` and
`health-checks` anticipates a config payload, but nothing currently produces
one.

### 6.3 [RESOLVED] Health-check no longer uses `wget` (was [LIKELY-BREAK])

**Original finding.** `manifest.yaml` health-check entrypoint was
`["sh","-c","wget -qO- http://localhost:3000/api/health ..."]`. The production
image is `node:22.12.0-slim` (Debian slim) with **no `apt-get install`** step,
so `wget` is not present. The StartOS health probe would fail
(`wget: not found`) on a perfectly healthy app, reporting the service down.

**Fix (landed).** The manifest health-check now uses the same node-fetch form
as the Dockerfile `HEALTHCHECK` — node is guaranteed present in the image:
`["node","-e","fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]`.
`/api/health` is a real 200 JSON route (`artifacts/api-server/src/routes/health.ts`,
mirror at `/api/healthz`), so a serving app exits 0 (healthy) and a non-200 or
unreachable server exits 1 (unhealthy).

**Verified against the base image** (the production stages only `COPY` app
artifacts on top — no `apt-get`, so the base determines tool presence):
`docker run --rm node:22.12.0-slim@<digest> sh -c 'command -v wget || echo NO-WGET'`
prints `NO-WGET` (confirming the old probe's failure mode), while
`node -e "console.log(typeof fetch)"` prints `function` (confirming the new
probe's interpreter is present and `fetch` is a global). See §9 for full detail.

### 6.4 [OK] Port contract is consistent and fail-closed

`PORT` is **required** — `artifacts/api-server/src/index.ts` throws
"PORT environment variable is required but was not provided." if unset (no
silent default). The Dockerfile sets `ENV PORT=3000` (build + production
stages), `docker-compose.yml` sets `PORT: "3000"`, and the manifest pins
`3000` in the health-check and in `interfaces` (`tor-config` 80→3000,
`lan-config` 443→3000). All agree. The required-PORT design means the image
**must** carry `ENV PORT`; it does. Caveat for the operator: the manifest
hardcodes `3000` in two places — if you change the image port, change the
health-check and both interface mappings in lockstep.

### 6.5 [OK] `NODE_ENV=production` set in image → dev-pay disabled

Both the build and production stages set `ENV NODE_ENV=production`. The
mock-Lightning `/api/paywall/dev-pay` endpoint (settles invoices without real
payment) is gated off when `NODE_ENV=production`, matching the `alerts.start`
claim. StartOS runs the same image, so the posture holds.

### 6.6 [OK] Placeholder-secret guards present and tested

`assertTurnSecretNotPlaceholder` / `assertPaywallSecretNotPlaceholder` exist
(`artifacts/api-server/src/lib/turnSecret.ts`,
`.../lib/paywallSecret.ts`, with unit tests) and are called from `index.ts`
before any port bind. `coturn/turnserver.conf.example` ships
`static-auth-secret=YOUR_SECRET_HERE`, which the guard rejects — so the
documented "fails closed if the secret-rotation step is skipped" workflow is
real.

### 6.7 [OK] Entrypoint and build artifact agree

Manifest `main.entrypoint` = `["node","--enable-source-maps","./dist/index.mjs"]`
= Dockerfile `CMD` = `package.json` `start`. The api-server build
(`build.mjs`, run in the backend stage) produces `dist/index.mjs`, which the
production stage copies to `/app/dist`. No mismatch.

### 6.8 [OK] coturn secret cannot leak via the image

The production stage copies only `dist`, `client`, and `BUILD_INFO.json`; no
stage `COPY`s `coturn/`. The (gitignored) `coturn/turnserver.conf` present in
the working tree is therefore not baked into the VOID image. On StartOS,
coturn is a separate `dependencies.coturn` service; its secret is set
OS-side, not in this image.

### 6.9 [MINOR] Assets and version

`LICENSE` and `void-icon.png` exist at repo root (manifest `assets`). Versions
agree (`1.2.0` in both manifests). There is no `instructions` asset declared;
StartOS shows package instructions from one if present — optional, worth
adding for first-run operator guidance but not required to build.

---

## 7. Operator build notes (for the `.s9pk` build attempt)

Ordered by what will bite first.

1. **Resolve the config gap first (§6.2) or accept a defaults-only install.**
   Without a StartOS config spec there is no UI to set secrets/Lightning/TURN.
   Either add the config-spec + set procedure before building, or knowingly
   build a "starts but unconfigured" package for a smoke test only.
2. **Health-check is fixed (§6.3) — RESOLVED.** The manifest probe no longer
   uses `wget` (absent from `node:22.12.0-slim`); it now uses the node-fetch
   form already used by the Dockerfile `HEALTHCHECK`. Verified against the base
   image: `command -v wget` → `NO-WGET`, `typeof fetch` → `function`. No further
   action needed; StartOS health now reflects the real serving state.
3. **Toolchain:** `start-sdk` is not installed here; install it on your build
   host. The Dockerfile base is pinned by digest
   (`node:22.12.0-slim@sha256:…`, kept in sync with `.docker-base-digest`) and
   `corepack prepare pnpm@10.26.1` must match `packageManager` in
   `package.json` — a pnpm mismatch silently changes lockfile resolution.
4. **Build provenance:** the backend stage reads `GIT_SHA`, `GIT_SHA_SHORT`,
   `RELEASE_TAG`, `BUILD_TIMESTAMP` via `--build-arg`. `.dockerignore` excludes
   `.git`, so without these `--build-arg`s the baked `BUILD_INFO.json` (served
   at `/api/proof/build`) is a useless placeholder. Pass them at build time.
5. **PORT is mandatory (§6.4):** keep `ENV PORT=3000` in the image; the server
   refuses to boot without `PORT`, and the manifest's `3000` health-check and
   interface mappings assume it.
6. **TURN on StartOS:** the manifest declares `dependencies.coturn`
   (opt-out). If you depend on the StartOS-packaged coturn, set the matching
   shared secret OS-side and point `TURN_URL`/`TURN_SECRET` at it; the
   placeholder guard (§6.6) will refuse boot if `TURN_SECRET` is left at the
   example value.
7. **What's verified safe to leave alone:** entrypoint/build artifact (§6.7),
   `NODE_ENV=production`/dev-pay gating (§6.5), no coturn-secret leak in the
   image (§6.8), version consistency (§6.9). No action needed on these.
8. **After a successful install + smoke test,** record the outcome per §5 and
   `docs/launch-decisions.md` §10's post-push template, including whether the
   config-gap fix (§6.2) and health-check fix (§6.3) were landed in the
   built `.s9pk`.

---

## 8. §6.2 BLOCKER resolution — StartOS config surface added (2026-06-11)

The §6.2 [BLOCKER] ("No StartOS `config` mechanism exists") is **resolved in
the repo**. A StartOS config surface was added so an operator can set every
production env var through the StartOS Config screen instead of being stuck on
Dockerfile defaults. This is the in-tree code/doc resolution; the live `.s9pk`
build + StartOS install verification remain operator actions (same gate as §4).

**What landed:**

- `assets/config_spec.yaml` — the operator-facing config spec. One field per
  env var the `alerts.start` block documents: `lightning-backend` (enum,
  default `mock`), `paywall-secret` (masked, hex-64 pattern), the LNbits /
  BTCPay credential groups, `turn-url` / `turn-secret` (masked),
  `turn-credential-ttl` (default 4500), `stun-url`, `trust-proxy-hops` (default
  1), `log-level` (enum, default `warn`), `tor-only` (bool), the
  `paywall-jitter-min-ms` / `paywall-jitter-max-ms` (defaults 10000 / 60000) /
  `paywall-jitter-disable` trio, `ntfy-topic` / `ntfy-server` (default
  `https://ntfy.sh`) / `ntfy-token`, and `enable-agent-rooms` (bool, default
  off). Field keys are **kebab-case** — the StartOS-native id form and the only
  form the `compat` config-rule engine can reference (see §8.3); the entrypoint
  converts each key's hyphens to underscores before uppercasing, so the env var
  names are unchanged (`lightning-backend` → `LIGHTNING_BACKEND`). **Defaults
  match the code** (the §6.1 [OK] values), satisfying the 2026-05 "Done looks
  like" bar.
- `assets/config_rules.yaml` — one cross-field rule, **verified against the real
  `compat` tool** (see §8.3): `!(#paywall-jitter-min-ms > #paywall-jitter-max-ms)`,
  which rejects an inverted jitter window at Save time. The remaining cross-field
  requirements stay enforced fail-closed by the server (placeholder-secret
  guards; backend-credential checks in `services/lightning.ts`) because the
  compat rule grammar cannot reliably express "a nullable string is set" — an
  unset nullable is null and `'field != ""` is TRUE for null, so a
  "required-when" rule would pass the realistic blank-field case (§8.3).
- `deploy/startos/docker_entrypoint.mjs` — the `main` action's new entrypoint.
  Reads `/root/start9/config.yaml` (written by `config set`), exports each
  field as its UPPER_SNAKE_CASE env var (booleans → `"1"`/`"0"`; empty optional
  strings skipped so server defaults apply; existing OS env not overridden),
  then `import()`s `./dist/index.mjs` in the same process so SIGTERM drain is
  unchanged. Dependency-free flat-YAML reader — no `yq`/YAML lib added to the
  image. The Dockerfile copies it into the production image; plain-Docker /
  Umbrel still use the unchanged `CMD` and get env from `docker-compose.yml`.
- `manifest.yaml` — added the `config.get` / `config.set` docker procedures
  (StartOS `compat` system image, spec/rules mounted from the `compat` assets
  volume), pointed `main.entrypoint` at the shim, mounted the new `main` data
  volume at `/root`, and declared `volumes.main` (type `data`) +
  `volumes.compat` (type `assets`). The `main` data volume persists **only**
  the config file — room state remains in-memory, so the §5 stateless
  declaration still holds (the comment block in `volumes:` says so). The
  `alerts.start` lead now tells operators to use the Config screen.

**Note on §6.3 (health-check `wget`).** Left as-is — it is a distinct finding
with its own fix path and is out of scope for the config-surface task. Still
open per the §7 operator notes. **(Now resolved — see §9.)**

**Re-eval trigger (adds to §5):** when the `.s9pk` is built, verify the Config
screen renders all fields and that values entered there reach
`process.env` in the running container (e.g. `LIGHTNING_BACKEND` /
`TURN_CREDENTIAL_TTL` reflect the UI). Record the result here.

---

## 9. §6.3 LIKELY-BREAK resolution — health-check no longer uses `wget` (2026-06-11)

The §6.3 [LIKELY-BREAK] ("Health-check uses `wget`, absent from the runtime
image") is **resolved in the repo**. The StartOS `health-checks.web-ui`
procedure no longer shells out to `wget`, which is not present in the
`node:22.12.0-slim` production image (no `apt-get install` step in the
`Dockerfile`) and would have made the StartOS dashboard report a serving app as
unhealthy.

**What landed:**

- `manifest.yaml` — the `health-checks.web-ui.entrypoint` was changed from the
  `["sh","-c","wget -qO- http://localhost:3000/api/health ..."]` probe to the
  node built-in `fetch` form already used by the Dockerfile `HEALTHCHECK`:
  `["node","-e","fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]`.
  `node` is guaranteed present in the image (it is the entrypoint runtime), so
  the probe runs; `/api/health` is a real 200 JSON route
  (`artifacts/api-server/src/routes/health.ts`, mirror at `/api/healthz`), so a
  serving app exits 0 (healthy) and a non-200 or unreachable server exits 1
  (unhealthy). This gives the StartOS dashboard a deterministic, reliable
  up/down signal that matches real process state.
- The §6.3 fix recommendation ("change the manifest health-check to the same
  node-fetch form … node is guaranteed present; `/api/health` is a real 200
  route, confirmed") is now implemented verbatim. The §7 operator note #2 is
  satisfied for the in-tree manifest; the `wget`/`curl` add-to-image
  alternative it offered is no longer needed.

**Operator verification (unchanged gate, same class as §4 / §8).** On the built
image, confirm the probe runs without a shell dependency:
`docker run --rm <img> node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`
against a running container, and confirm the StartOS dashboard shows the
"VOID is ready" success message when the service is up and flips to unhealthy
when it is stopped. The `wget`-absent failure mode itself can be confirmed with
`docker run --rm <img> sh -c 'command -v wget || echo NO-WGET'` (expected:
`NO-WGET`).

### 8.1 Verification attempt (2026-06-11) — local round-trip PASS, hardware step still BLOCKED

A verification pass was run in this environment. The on-hardware half of the
"Done looks like" bar **could not be exercised** and remains an operator action;
the in-repo half (the parser/mapping round-trip) was simulated and **passes**.

**Blocked (needs operator hardware/toolchain — unchanged from §4 / §7.3):**

- **No `start-sdk`** in this environment (`which start-sdk` → not found; absent
  from the nix profile), so a live `.s9pk` **cannot be built** here.
- **No StartOS device** to sideload onto, so the **Config screen render** and
  the **on-hardware `process.env` spot-check** cannot be performed here. These
  three steps stay gated on the operator, same as the §4 submission-readiness
  item.

**Verified locally (de-risks the `config set` → entrypoint → `process.env`
half, which §8 flagged as "not confirmed"):**

- Reconstructed the flat `config.yaml` that `compat config set` writes for this
  spec, covering **every field type** — enum, masked hex string, quoted URL,
  unquoted number, boolean `true`/`false`, YAML null markers (`~` / `null`),
  and an empty-string optional — and ran it through the real
  `deploy/startos/docker_entrypoint.mjs` (`VOID_STARTOS_CONFIG` override) with a
  stub `dist/index.mjs` dumping the resulting env. Results:
  - Scalars pass through; numbers stringify (`turn_credential_ttl: 4500` →
    `TURN_CREDENTIAL_TTL="4500"`); booleans map to the code's form
    (`tor_only: true` → `TOR_ONLY="1"`; `enable_agent_rooms: false` →
    `ENABLE_AGENT_ROOMS="0"`).
  - Null markers and empty-string optionals are **skipped** (`btcpay_*`,
    `stun_url`, `ntfy_token` left `<unset>`) so the server's own defaults /
    fail-closed fallbacks apply — exactly the intended behaviour.
  - **OS-env precedence holds**: with `TURN_SECRET` pre-set in the process env,
    the config value does **not** override it.
  - **Missing file** path (`ENOENT`) logs the "starting on
    environment/Dockerfile defaults" notice and applies nothing, as designed.
- Cross-checked all 21 spec field keys: each uppercases to an env var the API
  server actually consumes (reconciled against §6.1's contract).

**Caveat (as of 2026-06-11).** This confirmed the entrypoint mapping against a
*representative* `compat`-style YAML, not against bytes emitted by the real
`compat config set` binary, and did not exercise the StartOS rendering of field
defaults/patterns/enums. Those remained the operator's to confirm on a built
`.s9pk`. **The first half of this caveat is now closed — see §8.2.**

## 8.2 Real-packaging-tool verification (2026-06-12) — `compat` round-trip CONFIRMED

The §8.1 caveat (round-trip checked only against a hand-reconstructed
stand-in, never against the real `compat config set` output) is **closed**. The
StartOS `compat` tool — the exact binary the manifest's `config.get` /
`config.set` procedures invoke (`image: compat`, `system: true`, `entrypoint:
compat`) — is published as a Docker image (`start9/compat:latest`, pulled and
run in this environment, which has a working Docker daemon). It was run directly
against the **shipped** `assets/config_spec.yaml` / `assets/config_rules.yaml`,
so this is no longer a simulation of the packaging tool but the packaging tool
itself.

**What was run (reproducible):**

```
docker pull start9/compat:latest
# render the Config screen's source data from the real spec (empty data dir):
docker run --rm -v DATA:/root -v ASSETS:/mnt/assets --entrypoint compat \
  start9/compat:latest config get /root /mnt/assets/config_spec.yaml
# write the operator's choices the way the Config screen's Save does (stdin):
docker run --rm -i -v DATA:/root -v ASSETS:/mnt/assets --entrypoint compat \
  start9/compat:latest config set void /root /mnt/assets/config_rules.yaml \
  < operator-input.yaml
# -> compat writes DATA/start9/config.yaml ; feed THOSE bytes to the entrypoint:
VOID_STARTOS_CONFIG=DATA/start9/config.yaml node deploy/startos/docker_entrypoint.mjs
```

**`config get` (spec render) — PASS.** `compat config get` parsed the real spec
with no error and emitted the normalised spec StartOS renders as the Config
screen. This exercises, for the first time, the field surface §8.1 said had
never been rendered: every `default` is preserved and matches the code
(`turn_credential_ttl: 4500`, `trust_proxy_hops: 1`, `log_level: warn`,
`lightning_backend: mock`, `ntfy_server: https://ntfy.sh`,
`paywall_jitter_min_ms/max_ms: 10000/60000`); the `paywall_secret` `pattern`
(`^[0-9a-fA-F]{64}$`) and `pattern-description` survive; the `lightning_backend`
and `log_level` enum `values` + `value-names` render (compat auto-fills
identity value-names for the enum entries that declared none); `number` fields
keep their `range`/`integral`/`units`. No spec field was rejected or silently
dropped.

**`config set` (real bytes) — PASS.** Fed an operator input covering every field
type, `compat config set` wrote a flat scalar `config.yaml` to
`/root/start9/config.yaml`. Observed real-tool byte conventions (these differ
in detail from the prior stand-in and are now what the test fixture and the
entrypoint parser are validated against):

- Leading `---` document marker; one top-level `key: value` per line, no
  nesting — exactly the flat subset `docker_entrypoint.mjs` parses.
- **Per-value quoting:** compat double-quotes only values that YAML requires it
  to (colon-bearing URLs — `lnbits-url`, `turn-url`, `ntfy-server`); plain
  alphanumeric secrets and the hex `paywall-secret` are left **unquoted**.
- **Unset nullables normalise to `~`** (not `""` and not `null`) — for every
  nullable the operator left blank (`btcpay-*`, `stun-url`, `ntfy-topic`,
  `ntfy-token`).
- A field's **spec default is baked into the file** when the operator does not
  override it (e.g. `ntfy-server: "https://ntfy.sh"` appears even though it was
  not entered).
- Numbers and booleans are emitted unquoted (`turn-credential-ttl: 4500`,
  `tor-only: true`, `enable-agent-rooms: false`).

**Entrypoint round-trip against the real bytes — PASS.** Feeding the file
`compat` wrote through the real `deploy/startos/docker_entrypoint.mjs` (clean
process env, stub `dist/index.mjs` dumping `process.env`) produced exactly the
intended environment: enum/string pass-through with quotes stripped; numbers
stringified (`TURN_CREDENTIAL_TTL="4500"`, `TRUST_PROXY_HOPS="2"`); booleans
mapped to the code's form (`tor-only: true`→`TOR_ONLY="1"`;
`paywall-jitter-disable: false`→`PAYWALL_JITTER_DISABLE="0"`;
`enable-agent-rooms: false`→`ENABLE_AGENT_ROOMS="0"`); every `~` nullable
**skipped** so the server's own default/fail-closed fallback applies; the
baked-in `ntfy-server` default surfaced as `NTFY_SERVER="https://ntfy.sh"`. A
follow-up run confirmed the OS-env precedence guard still holds (a pre-set
`TURN_SECRET` is not overridden). All 21 spec fields were covered.

**Test fixture upgraded.** `artifacts/api-server/src/__tests__/startos-entrypoint.test.ts`
no longer round-trips a hand-reconstructed YAML; its primary fixture is now the
**verbatim bytes** captured from the real `compat config set` run above (with a
regenerate recipe in the file header), plus a small separate "parser tolerance"
case for YAML forms compat does not emit (`""`, `null`, single quotes) but the
hand-rolled reader is built to tolerate. The CI suite passes (12/12) and so the
real-output mapping is now regression-guarded.

**Now automated (2026-06-12).** The real-tool round-trip above is no longer a
one-off manual capture. `artifacts/api-server/scripts/smoke-startos-compat.mjs`
(pnpm script `smoke:startos-compat`, registered as the `startos-compat`
validation step) pulls `start9/compat:latest`, runs `compat config get` /
`compat config set` against the shipped `assets/config_spec.yaml` +
`assets/config_rules.yaml`, feeds the bytes the tool writes through
`deploy/startos/docker_entrypoint.mjs`, and asserts the resolved env mapping —
**failing if the spec and entrypoint drift apart**. It also cross-checks that
its operator payload and assertions cover exactly the spec's field set, so a
field added to / removed from the spec without updating the round-trip fails
loudly rather than shipping unchecked. Where Docker is unavailable (no daemon or
no registry access) it **skips with exit 0**, never a false failure. Reproduce
locally with `pnpm --filter @workspace/api-server run smoke:startos-compat`.
Findings that shaped the harness: `compat config set` does **not** itself
validate the payload against the spec (bad patterns, out-of-range numbers and
unknown keys all pass straight through — the StartOS UI enforces those), and it
does **not** fill defaults or normalise unset nullables from a partial input, so
the script sends the **complete** Config-screen payload (`~` for every unset
nullable, the spec default for `ntfy_server`) and passes colon-bearing URLs
unquoted to exercise compat's real quoting on output.

**Still operator/hardware-gated (unchanged from §4 / §8.1).** Running the
`compat` binary against the real spec closes the *packaging-tool* half. It does
**not** replace the remaining on-hardware steps, which still cannot be done in
this environment (no `start-sdk`, no StartOS device):

- Building the full `.s9pk` with `start-sdk` (compat is one component of the
  package build, not the whole pipeline).
- Rendering the Config screen in the **StartOS web UI** on a device and saving
  it (compat produces the screen's source data here, but the GUI widget render
  — masked fields, enum dropdowns, pattern validation messages — is the OS
  front end, not compat).
- The in-container **on-hardware `process.env` spot-check** from §8 on a running
  install (e.g. confirming `LIGHTNING_BACKEND` / `TURN_CREDENTIAL_TTL` reflect
  the UI inside the live container).

When those are performed, append the device result (and any `version` bump)
here per §5.

## 8.3 Cross-field config rules now exercised (2026-06-12) — `config_rules.yaml` no longer deferred

§8.1 shipped `config_rules.yaml` as an empty list, deferring all cross-field
validation to the server on the grounds that a compat rule expression was
"unverifiable." That deferral is now **partially closed**: the rule grammar was
reverse-engineered and exercised directly against `start9/compat config set`
(same binary, same Docker image as §8.2), and one rule that passes the
accept-valid / reject-invalid bar now ships.

**Rule grammar (verified empirically against `start9/compat:latest`, 2026-06-12):**

- **References are kebab-case.** A number field is `#field`, a string field is
  `'field` (leading single-quote prefix, no closing quote). A reference to an
  underscore key (`#paywall_jitter_min_ms`) fails to parse — this is why the
  spec was migrated to kebab-case keys (§8.1). String literals are `"..."`.
- **Operators:** `=` and `!=`; single-char `<` and `>` only (there is **no**
  `<=` / `>=` — `#a <= #b` fails parsing at the `=`); `!( ... )` to negate;
  UPPERCASE `AND` / `OR` / `XOR`.
- **YAML gotcha:** a rule scalar starting with `#` is a YAML comment unless
  quoted, so rule strings are double-quoted in the file.

**The shipped rule — accept-valid / reject-invalid CONFIRMED.**
`!(#paywall-jitter-min-ms > #paywall-jitter-max-ms)` (i.e. min ≤ max; equal
bounds = a fixed delay, allowed). Run against the **shipped**
`assets/config_spec.yaml` + `assets/config_rules.yaml`:

| Operator input (min / max) | Result |
| --- | --- |
| 10000 / 60000 (min < max) | **ACCEPT** |
| 5000 / 5000 (min == max)  | **ACCEPT** |
| 60000 / 10000 (min > max) | **REJECT** — "Paywall Jitter Minimum must not exceed Paywall Jitter Maximum." |
| defaults (10000 / 60000)  | **ACCEPT** |

This is a genuine at-save-time error for an inverted jitter window that would
otherwise silently collapse the settlement-to-room-create delay at runtime.

**Why the backend-credential "required-when" rules stay fail-closed (not added
here).** The realistic invalid case is an operator who selects `lnbits` but
leaves the URL field blank. A blank nullable normalises to **null**, and compat
evaluates `'lnbits-url != ""` as **TRUE** for null (null is unequal to every
string literal, and the grammar has no null/exists literal), so a
"required-when" rule would *pass* the very case it is meant to catch — giving
operators false confidence. Those requirements therefore remain enforced
fail-closed by the server itself (the first LNbits/BTCPay invoice fails closed
in `services/lightning.ts`; a placeholder `TURN_SECRET` / `PAYWALL_SECRET`
aborts startup before any port bind). The jitter rule is safe to enforce here
only because both operands are non-nullable numbers.

**Still operator/hardware-gated.** As in §8.2, this confirms the rule against
the packaging tool; the StartOS web-UI render of the Save-time validation error
on a device remains the operator's to confirm on a built `.s9pk`.
