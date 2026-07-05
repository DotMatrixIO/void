# VOID — Security and Resilience Audit (Published, April 2026)

> **Publication note.** This is the public copy of VOID's internal April 2026
> security and resilience audit, published on 2026-05-02 once every High and
> Medium finding had either shipped a code fix or been disclosed to users on
> the threat-model page. The body text below is the audit as written; only
> this preamble and the per-finding **Status** lines (added inline next to
> each H-* / M-* heading) are new in the published copy. No technical
> finding has been removed.
>
> The audit was performed in-house by a member of the VOID engineering team.
> A separate, larger piece of work — commissioning a recognized external
> firm to do an adversarial human audit — has not yet been signed; the
> threat-model page (`/threat-model`) names that gap directly under
> "FOUR THINGS WORTH NAMING DIRECTLY".
>
> **External audit tracking (added 2026-05-02).** That external audit is
> now tracked as Task #247, with a written scope of work.
> The SOW hires for the live-test
> gaps a static in-house read cannot cover (§11 limitations 1, 2, 4, 5,
> and 8 — `/api/proof/server-state` timing under real network conditions,
> malicious-TURN coercion, build-pipeline reproducibility, Lightning
> correlation against a real node, and a `mockup-sandbox` penetration
> test against the post-#242 state). Engagement, budget envelope, and
> firm selection are pending business decisions per the task body. This
> preamble — and the corresponding paragraph in `docs/threat-model.md`
> §0 — is updated when the engagement is signed (to record the
> commissioned date) and again when the deliverable lands (to point at
> the published external-audit results).
>
> ## Findings status — at publication
>
> | ID | Sev | Title (one line) | Status |
> |---|---|---|---|
> | H-01 | High | Spoofable per-IP throttle via leftmost X-Forwarded-For | **Fixed (Task #168)** |
> | H-05 | High | Single paid JWT could create many rooms | **Fixed (Task #169)** — and supplementary hardening landed in **Task #265 (2026-05-02)**: the `consumedRoomCreationTokens` and `consumedExtensionTokens` Maps are now drained both opportunistically (on every `create-room` / `extend-room`) and on a single 60 s `setInterval` sweep registered from `registerSocketHandlers` and cleared on SIGTERM/SIGINT, so an idle server cannot accumulate expired entries indefinitely. |
> | M-01 | Medium | No signed `hello` binding on browser ECDH; silent decrypt-fallback | **Fixed (Task #170)** |
> | M-02 | Medium | Empty-room host-claim by any phrase-holder | **Fixed (Task #171)** |
> | M-03 | Medium | URL fragment retained in browser history after leave | **Fixed (in-tree, see `App.tsx` M-03 comments)** |
> | M-04 | Medium | Lightning paywall observability (timing correlation) | **Mitigated + documented limitation** — Task #226 shipped a 10–60 s uniform jitter between settlement and `paywall/status` returning `paid: true` (`artifacts/api-server/src/routes/paywall.ts`); residual surface disclosed in plain language on the user-facing threat-model page (item §2) and at `docs/threat-model.md` §2. Per the original audit (§3.8 / §10.4), an outcome of "documented as a known limitation in the threat-model page in plain language" was an explicitly acceptable outcome for this finding. **Re-eval: 2026-11**, or earlier if any of the following triggers fire: hold-invoice support lands in LNbits or BTCPay; an external paper demonstrates effective de-anonymization at the current jitter range; operator deployment data shows correlation attempts in the wild. |
> | M-05 | Medium | Coturn placeholder secret committed; weak-deploy risk | **Fixed (Task #174)** |
> | M-06 | Medium | Dockerfile ran as root | **Fixed (Tasks #173 production, #193 pilot)** |
>
> Findings rated Informational or Low in the body below were addressed where
> the fix was small (algorithm pinning, fetch deadlines, server timeouts) and
> otherwise carried into the existing PROPOSED-task tracking referenced in
> §10.5. Audit limitations (§11) are intentionally preserved — they describe
> what a static read cannot tell you, which is itself the point.

---

# VOID — Internal Security and Resilience Audit

**Date:** April 2026
**Scope:** Static, read-only review of the VOID monorepo at the current commit. No live deployment was probed. No code outside `docs/` was modified.
**Adversary model:** Global passive observer, server-side compulsion, active MITM on signaling, malicious peer, malicious TURN, fuzzing, race attacks. Browser sandbox compromise is excluded. AES-GCM, ECDH P-384, argon2id (m=64 MiB / t=3 / p=1), HKDF-SHA256, and TLS to the signaling server are assumed sound. (Pre-2026-04-30 builds used PBKDF2-SHA256 600k for phrase derivation; see §1.1 for the migration record.)
**Companion file:** `docs/security-audit-extracts.md` carries the verbatim source for each finding marked Critical or High where the fix is non-obvious or the existing code may be more correct than it first appears.

---

## May 2026 re-audit

**Re-audit date:** May 2, 2026
**Methodology:** Static, read-only re-review of the VOID monorepo. Every file listed in the April 2026 audit was re-read against its current commit. Eleven new surfaces identified during the intervening period were audited for the first time. `pnpm audit --json` was executed in the live workspace. No code outside `docs/` was modified.
**Adversary model:** Unchanged from the April audit header. argon2id (m=64 MiB / t=3 / p=1) remains the phrase-derivation primitive; PBKDF2 has no fallback path.

> **Closed does not mean clean.** "✓ CLOSED" in the table below means the specific exploit path described in the original finding is no longer present in the codebase. It does not mean the surrounding area is free of risk, that no regression is possible, or that the fix is optimal. Each re-verification section calls out residual risk explicitly. New findings introduced by the fix code itself, plus those uncovered by the re-audit pass itself, are tracked as R-N1–R-N4.

> **External adversarial audit — tracked as Task #247 (added 2026-05-02).** The April audit's §11 limitations 1, 2, 4, 5, and 8 — and the post-#242 mockup-sandbox surface — require a live adversarial assessment that a static read cannot cover. As of 2026-05-02 a written scope of work targeting exactly those gaps has been drafted. Engagement, budget envelope, and firm selection are pending business decisions per the Task #247 body. This callout is updated when the engagement is signed (to record the commissioned date) and again when the deliverable lands (to point at the new external-audit results section).

---

### R-0. Refreshed summary table

The table below supersedes the April §0 tables. Every original finding and every new finding receives a row.

**On the Re-eval column.** Every finding whose status is anything other than `✓ CLOSED` carries a Re-eval entry. The entry is `(calendar date) — (trigger events that warrant earlier review)`. The calendar date is the latest a re-evaluation should occur if no trigger event fires before then; it is a backstop, not a deadline. Trigger events are the things that would change the finding's underlying assumptions and therefore force an earlier look. **Re-evaluation is the security reviewer's responsibility** — currently the audit author or whoever inherits the role; the convention is that Re-eval rows are checked at the start of every audit pass and any matched trigger collapses the calendar date to "now". Closed findings carry `n/a` because the closure itself is a code-level invariant guarded either by tests, CI, or absent-by-construction code; if a closure regresses, the regression is the trigger and the row reopens as a new finding.

| ID | Sev | Status | Regression Risk | Re-eval | Title | Location |
|---|---|---|---|---|---|---|
| H-01 | High | ✓ CLOSED | Low — `TRUST_PROXY_HOPS=0` would revert to raw-socket address; default 1 is safe | n/a (CI/code) | Socket.io leftmost-XFF IP spoofing; per-IP caps bypassable | `artifacts/api-server/src/lib/clientIp.ts`, `socketHandlers.ts` |
| H-05 | High | ✓ CLOSED | Low — duplicate `paymentHash` from a broken Lightning backend would block a second legitimate creation. **2026-05-02 (task #265):** opportunistic GC on the consumed-token Maps was supplemented with a single `setInterval` sweep at 60 s cadence (`startConsumedTokenSweep` in `socketHandlers.ts`, registered from `registerSocketHandlers`, cleared via `stopConsumedTokenSweep` on SIGTERM/SIGINT in `index.ts`); idle servers therefore no longer carry expired entries indefinitely, and the timer is `unref`'d so it does not keep the event loop alive on shutdown. | n/a (CI/code) | Room-creation JWT not consumed; one invoice could create many rooms | `artifacts/api-server/src/socketHandlers.ts`, `routes/paywall.ts`, `index.ts` |
| M-01 | Medium | ✓ CLOSED | Low — `verifySignedHello` is async; a future caller who forgets `await` would silently skip verification | n/a (CI/code) | No signed hello binding ECDH key to session identity; silent phrase-key fallback | `artifacts/void-client/src/lib/helloEnvelope.ts`, `webrtc.ts` |
| M-02 | Medium | ✓ CLOSED | Low — a new `join-room` code path that omits the `paymentHash` argument to `claimHost` would revert to the open-claim behavior | n/a (CI/code) | Empty room claimable by any phrase-holder as host without JWT | `artifacts/api-server/src/rooms.ts`, `socketHandlers.ts` |
| M-03 | Medium | ✓ CLOSED | Low — a future leave code path that uses `pushState` instead of `replaceState` would not be caught until the static test runs | n/a (CI/code) | `pushState` on leave preserved fragment-bearing history entry | `artifacts/void-client/src/App.tsx`, `App.pushstate.test.ts` |
| M-04 | Medium | Low/Documented | Residual — jitter weakens but does not eliminate timing correlation; documented in `threat-model.md` §2 | **2026-11** — triggers: hold-invoice support lands in LNbits or BTCPay; external paper demonstrates effective de-anonymization at the current jitter range; operator deployment data shows correlation attempts in the wild | Lightning paywall: payment → room-create timing correlation | `artifacts/api-server/src/routes/paywall.ts` |
| M-05 | Medium | ✓ CLOSED | Low — `turnSecret.ts` now enforces a 16-character minimum length alongside the placeholder list (R-N2 closed) | n/a (CI/code) | Placeholder TURN secret committed; open-relay risk | `artifacts/api-server/src/lib/turnSecret.ts` |
| M-06 | Medium | ✓ CLOSED | Low — a Dockerfile edit that moves `USER node` before a `COPY` layer that runs `pnpm install` as root would silently re-elevate; CI guard catches this | n/a (CI/code) | Both Dockerfiles ran as root | `Dockerfile` |
| R-N1 | High | **OPEN** | N/A — new finding | **2026-08** — triggers: a new `path-to-regexp` advisory lands; Express upgrades majors; pnpm override path is taken (closes the row) | `path-to-regexp` DoS via sequential optional groups (CVE-2026-4926) in production `express` dependency | `artifacts/api-server` → `express > router > path-to-regexp < 8.4.0` |
| R-N2 | Low | ✓ CLOSED | Low — an operator could still pick a 16-character non-random secret (e.g. `aaaaaaaaaaaaaaaa`); length is a floor, not an entropy check | n/a (CI/code) | Single-character TURN secret not rejected by `turnSecret.ts` placeholder list | `artifacts/api-server/src/lib/turnSecret.ts` |
| R-N3 | Low | ✓ CLOSED (Task #241) | Low — non-string `payload` values incur a JSON.stringify pass before the cap check; a paid attacker emitting deeply-nested `unknown` blobs at the rate-limit ceiling could still consume CPU short of the byte cap. Real clients always send a string. | n/a (code) | `relay-signal` payload has no server-side byte cap | `artifacts/api-server/src/socketHandlers.ts` (relay-signal handler; cap = `RELAY_SIGNAL_MAX_PAYLOAD_BYTES`, 64 KiB) |
| R-N4 | Low | ✓ CLOSED (task #252) | N/A — new finding (this re-audit pass) | **2026-11** — triggers: an in-the-wild XSS attempt or marketing-page CSP-violation incident is reported via a different channel without the `/api/csp-report` sink picking it up; helmet's CSP defaults change and silently strip the `report-to` directive | ~~No CSP violation-reporting endpoint configured; real-world CSP violations on the served void-client HTML are not observable~~ Closed by task #252: `/api/csp-report` ingestion route lands at `artifacts/api-server/src/routes/csp-report.ts`, accepts both Reporting-API (`application/reports+json`) and legacy (`application/csp-report`) bodies, per-IP rate-limited (30/min), structured-logged via pino, replies 204 unconditionally; round-trip test at `artifacts/api-server/src/__tests__/csp-report.test.ts` | `artifacts/api-server/src/app.ts:39-67`, `artifacts/api-server/src/routes/csp-report.ts` |
| R-N5 | High | ✓ CLOSED | Low — `fast-uri` is dev/build-only (OpenAPI codegen); the override floor `fast-uri@<3.1.2: ^3.1.2` would have to be removed to regress, and the input is the project's own committed OpenAPI spec, not attacker-controlled | n/a (CI/code) | `fast-uri` path traversal via percent-encoded dot segments (CVE-2026-6321 / GHSA-q3j6-qgpj-74h6) in `lib/api-spec` codegen toolchain | `lib/api-spec` → `orval > @scalar/openapi-parser > ajv > fast-uri <= 3.1.0` |
| R-N6 | High | ✓ CLOSED | Low — same dev/build-only `fast-uri` codegen path as R-N5; closed in lockstep by the same `^3.1.2` override floor | n/a (CI/code) | `fast-uri` host confusion via percent-encoded authority delimiters (CVE-2026-6322 / GHSA-v39h-62p7-jpjc) in `lib/api-spec` codegen toolchain | `lib/api-spec` → `orval > @scalar/openapi-parser > ajv > fast-uri <= 3.1.1` |
| R-N7 | High | ✓ CLOSED | Low — the esbuild override floor (`esbuild: ^0.28.1` in root `package.json > pnpm.overrides`) would have to be lowered to regress; `esbuild-plugin-pino@2.3.3` builds the api-server cleanly against `0.28.1` (its declared peer was already exceeded by the prior `0.27.3` pin) and the client Vite/bundle is unaffected | n/a (CI/code) | ~~esbuild missing binary integrity verification in the Deno module enables RCE via `NPM_CONFIG_REGISTRY` (GHSA-gv7w-rqvm-qjhr; no CVE; vulnerable `>=0.17.0 <0.28.1`)~~ Closed: esbuild override raised to `^0.28.1` (resolves `0.28.1`), above the fixed floor; advisory no longer surfaces | `artifacts/api-server` → `esbuild` (build-time bundler in `build.mjs`) |

No new Critical findings.

The May 2026 re-audit also surfaced a class of disclosures that are properties of the browser any VOID client runs inside — DNS lookups, clipboard, notifications, extension DOM access, WebRTC `getStats()`, and managed-browser permission logging. These are not VOID code defects; they are surfaces an external reviewer would expect a privacy-claiming app to name. They have moved out of "absent from the audit" into the §11 documented-known-limitations tier. Full enumeration in §R-10 below; canonical user-facing disclosure at `ThreatModelPage.tsx` "BROWSER-LEVEL SURFACES" with the technical mirror at `docs/threat-model.md` §6.

---

### R-1. Re-verification: H-01 — IP spoofing / per-IP caps

**Finding:** `getSocketIp` read the leftmost X-Forwarded-For token, letting attackers spoof per-IP rate-limits.

**Fix reviewed (`artifacts/api-server/src/lib/clientIp.ts`, `socketHandlers.ts`):**

`clientIp.ts` exports `getTrustedClientIp(socket)` which reads `TRUST_PROXY_HOPS` from the environment (default 1). It splits the `x-forwarded-for` header, counts `hops` tokens from the right-hand side, and returns that token — the rightmost token added by the trusted reverse proxy, never the attacker-controlled leftmost value. An empty or absent header falls back to `socket.handshake.address`.

Every per-IP enforcement site in `socketHandlers.ts` (connection-count map, join-failure throttle, `disconnect` cleanup) calls `getTrustedClientIp`. The old `getSocketIp` function is gone. The HTTP routes continue to use Express `req.ip` with `trust proxy = 1`, which is equivalent.

**Regression risk:** An operator who sets `TRUST_PROXY_HOPS=0` would trust the raw socket address without any XFF parsing (equivalent to the pre-fix leftmost behavior). The default of 1 is safe for a standard single-proxy deployment; the env-var is explicitly documented. Risk: Low.

**Status: ✓ CLOSED.**

---

### R-2. Re-verification: H-05 — JWT replay for free room creation

**Finding:** Room-creation JWT carried only `{ authorized, tier, exp }`; no `paymentHash`; no single-use enforcement at `create-room`.

**Fix reviewed (`artifacts/api-server/src/routes/paywall.ts`, `socketHandlers.ts`):**

- At payment status/recovery time `paywall.ts` now mints the JWT with `paymentHash` embedded in the payload.
- `socketHandlers.ts` `create-room` handler decodes the JWT, extracts `paymentHash`, looks it up in `consumedRoomCreationTokens: Map<string, number>` (keyed by `paymentHash`, value is `exp` timestamp), and rejects if already present.
- On first successful creation the hash is inserted. `sweepConsumedRoomCreationTokens()` purges entries whose `expMs` is in the past; it runs opportunistically on every `create-room` attempt, **and** on a 60-second `setInterval` scheduled by `startConsumedTokenSweep()` (registered from `registerSocketHandlers`, cleared via `stopConsumedTokenSweep` on SIGTERM/SIGINT in `index.ts`). The two paths are belt-and-suspenders: opportunistic GC keeps the map small under live traffic; the scheduled sweep guarantees an idle server still drains expired entries within at most 60 s of expiry. The interval handle is `unref`'d so it does not block process exit. Renamed from `gcConsumed*Tokens` in task #265 to make the timer-driven semantics explicit at call sites.
- All three `jwt.verify` call-sites in `socketHandlers.ts` now pin `algorithms: ["HS256"]` explicitly, closing the informational algorithm-confusion gap noted in §3.2.
- Recovery JWTs (host-rejoin after session-storage loss) also embed `paymentHash`; the recovery path is therefore subject to the same single-use check.
- Extension tokens are keyed differently: `consumedExtensionTokens` uses the SHA-256 hash of the raw JWT string as the map key, not `paymentHash` — this is intentional so that two different extension JWTs for the same room (paid for separately) do not collide on the paymentHash axis.

**Regression risk:** If a Lightning backend issues the same `paymentHash` for two distinct payments (broken backend), the second legitimate creation would be rejected. This is a payment-processor integrity problem, not a VOID-code problem. Risk: Negligible.

**Status: ✓ CLOSED.**

---

### R-3. Re-verification: M-01 — No signed hello; silent ECDHE fallback

**Finding:** Browser-to-browser ECDHE had no signed envelope binding the ECDH key to a session identity. Silent catch-blocks let failed ECDHE fall back to the shared phrase key.

**Fix reviewed (`artifacts/void-client/src/lib/helloEnvelope.ts`, `webrtc.ts`):**

`helloEnvelope.ts` implements a full Ed25519 signed-hello protocol:

- `generateSigningIdentity()` creates a per-session Ed25519 keypair via `crypto.subtle.generateKey`.
- `buildBrowserHelloBody()` constructs a hello body containing `protocol`, `identity`, `capabilities`, `roomType`, the ECDH public key string, an `ecdhFingerprint` (SHA-256 of the ECDH key), a fresh 24-byte random `nonce`, a millisecond `timestamp`, and the **`roomId`** — binding the hello envelope to the specific room, preventing cross-room replay.
- `signHello()` signs the canonical body with `SIGNING_CONTEXTS.HELLO` domain separation (from `@workspace/wire-core`) using `crypto.subtle.sign("Ed25519", …)`.
- `verifySignedHello()` enforces: (a) valid Ed25519 signature; (b) `timestamp` within ±5 minutes; (c) `ecdhFingerprint` consistency against the `ecdhPublicKey` field when present; (d) `ecdhPublicKey` equality against the negotiated key when `expectedEcdhPublicKey` is supplied; (e) `roomId` presence and equality when `expectedRoomId` is supplied — the browser↔browser path always passes `expectedRoomId`, so cross-room replay is a loud-fail. The SDK path omits `roomId` and is accepted without the roomId constraint for interop.
- Any verification failure throws `HelloVerificationError`, which `webrtc.ts` treats as a trigger for `failSecureChannel()` — a loud, user-visible teardown with no silent fallback.

In `webrtc.ts`: all `catch {}` silent-swallow blocks around ECDHE have been replaced. `initiateOffer` now throws on failure; `attemptIceRestart` calls `performKeyExchange` before ICE negotiation and propagates errors; `handleRelay` calls `failSecureChannel()` on decryption failure rather than retrying with the phrase key.

**Status: ✓ CLOSED.**

---

### R-4. Re-verification: M-02 — Empty-room host-claim without JWT

**Finding:** First joiner to an empty-but-not-expired room automatically became host with full moderation privileges, regardless of whether they paid.

**Fix reviewed (`artifacts/api-server/src/socketHandlers.ts`, `rooms.ts`):**

`claimHost(code, socketId, reclaimToken)` in `rooms.ts` requires:
1. `room.hostSocketId === null` (no current host).
2. The candidate `reclaimToken`'s keyed HMAC to be present in `room.hostReclaimTokenHashes` — a `Set<string>` of `HMAC(PAYWALL_SECRET, reclaimToken)` populated at room creation from the creator's JWT. (As of Task #886 the stored value is keyed off a per-room **reclaim token** decoupled from the Lightning `paymentHash`, not the `paymentHash` itself, so nothing payment-derived reaches disk.)
3. On a successful extension, the extension JWT's `reclaimToken` is also added to the set via `addHostReclaimToken(code, extensionReclaimToken)`, so a host who paid for an extension can reclaim host even if they used the extension JWT rather than the original creation JWT.

A phrase-holder who was never the payer holds no valid `reclaimToken` and cannot claim host. The `joinRoom` handler no longer auto-promotes the first joiner.

**Status: ✓ CLOSED.**

---

### R-5. Re-verification: M-03 — `pushState` on leave preserving phrase fragment

**Finding:** `App.tsx` used `pushState` on the `onLeave` path, adding a history entry that retained the phrase-bearing URL.

**Fix reviewed (`artifacts/void-client/src/App.tsx`, `App.pushstate.test.ts`):**

`App.tsx` now uses `window.history.replaceState` on every leave path — the main leave callback, BURN completion, kick detection, and room-expiry events. No `pushState` call exists in `App.tsx` for any leave path.

`App.pushstate.test.ts` is a static regression guard: it reads the source text of both `App.tsx` and `RoomPage.tsx` and asserts that neither file contains `pushState`. The test fails the build if either file re-introduces the call.

**Status: ✓ CLOSED.**

---

### R-6. Re-verification: M-04 — Lightning timing correlation

**Finding:** A passive observer could correlate Lightning payment settlement timing with VOID room creation to link payer to room.

**Fix reviewed (`artifacts/api-server/src/routes/paywall.ts`):**

A random jitter of 10–60 seconds is introduced between payment settlement and the moment the room-creation JWT is issued. The jitter is uniformly distributed per invocation. This weakens sub-second timing correlation but does not eliminate it: a sustained observer with high-precision Lightning-node access can still accumulate statistics over many payments to reduce the jitter window.

`threat-model.md` §2 explicitly discloses the residual risk: the paywall remains a timing-correlation surface; the jitter is a partial, not complete, mitigation; users requiring strong payment-to-room unlinkability should pay via an LSP or Tor-routed node.

**Residual risk:** Low. The code mitigation is present; the documentation is honest about the limitation. No further code change is recommended without a hold-invoice implementation. **Reclassified: Low/Documented.**

---

### R-7. Re-verification: M-05 — Placeholder TURN secret

**Finding:** `coturn/turnserver.conf` was committed with `static-auth-secret=YOUR_SECRET_HERE`; naive operators could run an open relay.

**Fix reviewed (`artifacts/api-server/src/lib/turnSecret.ts`):**

`assertTurnSecretNotPlaceholder(rawSecret)` checks the trimmed, lowercased secret against a static list of eight known placeholders. The list covers all variants found in README prose and example configs. The function throws `PlaceholderTurnSecretError` if a match is found. After the placeholder check it also enforces `TURN_SECRET_MIN_LENGTH = 16` characters (post-trim), throwing the same error type with a length-specific message when violated (added May 2026 / task #240; see R-N2 below). When `TURN_SECRET` is unset or empty string the function returns without error (TURN is optional; no relay credentials are minted).

**Status: ✓ CLOSED.**

**Residual gap (R-N2 — Low) — ✓ CLOSED (May 2026, task #240):** `assertTurnSecretNotPlaceholder` now rejects any trimmed `TURN_SECRET` shorter than `TURN_SECRET_MIN_LENGTH` (16 characters) by throwing `PlaceholderTurnSecretError` with a length-specific message ("TURN secret is too short (N characters); must be at least 16 characters…"). The threshold is exported as a named constant so the audit doc, the test suite, and the runtime check share a single source of truth. The pre-existing unset/empty-string fast paths are preserved (TURN remains optional). Coverage in `artifacts/api-server/src/__tests__/turn-secret.test.ts` exercises the single-character case called out in this finding, the just-below-floor boundary, the just-at-floor boundary, the post-trim measurement, and the actionable error message. Remaining residual is now only that an operator could deliberately pick a 16-character but low-entropy secret (e.g. `aaaaaaaaaaaaaaaa`); a true entropy floor is out of scope for a startup guard and would belong in operator documentation instead.

---

### R-8. Re-verification: M-06 — Dockerfile privilege escalation

**Finding:** Production and pilot Docker images ran as root.

**Fix reviewed (`Dockerfile`, `.github/workflows/docker-build.yml`):**

The production Dockerfile now contains `USER node` as the final privilege directive before `CMD`/`ENTRYPOINT`.

A CI GitHub Actions workflow provides a regression guard:
- `docker-build.yml` builds the production image on every push/PR touching `Dockerfile`, `artifacts/**`, or related workspace files. It runs `docker run --rm --entrypoint id void-app:ci -un` and asserts the output is `node`. A second check runs against the live container using `docker exec void-ci id -un` and `ps -o user= -p 1`.

The workflow fails the build and surfaces an `::error::` annotation if the runtime user is anything other than `node`.

**Status: ✓ CLOSED.**

---

### R-9. New surfaces audit

The following eleven surfaces were not covered in the April 2026 audit. Each was reviewed for the first time in this re-audit.

#### R-9.1 Host token persistence (`artifacts/void-client/src/lib/hostTokenStorage.ts`)

`persistHostToken(phrase, token)` stores the host JWT in **encrypted `window.localStorage`** (not IndexedDB and not plaintext). The storage key and AES-GCM encryption key are both derived from the room phrase via HKDF-SHA256 (distinct info strings `VOID-HOST-TOKEN-TAG-v1` and `VOID-HOST-TOKEN-KEY-v1`). The stored value format is `"<storedAt>.<base64url(iv || ciphertext)>"`, where `storedAt` is a plaintext millisecond timestamp used only for GC.

**Privacy properties verified in code:**

1. **Storage tag unlinkability.** The 16-byte HKDF output used as the localStorage key looks like random hex (`void.hk.<32 hex chars>`). An attacker with read access to `localStorage` (e.g. via XSS, a browser extension with `storage` permission, or OS-level forensic disk access) sees opaque tags — they cannot enumerate which rooms the user has paid for, nor correlate tags to room codes without the phrase.

2. **JWT body encrypted at rest.** The JWT payload (`paymentHash`, `tier`, `authorized`) is AES-GCM encrypted. Without the phrase, a forensic reader cannot recover payment metadata. An attacker who has the phrase already has full room access and could use the recovery-code flow anyway — the encryption protects against phrase-less adversaries only, which is the stated goal.

3. **Timestamp leakage (by design).** The `storedAt` prefix is plaintext. It reveals "some host-token write happened at time T" but not which room, which tier, or who paid. This is weaker than the network observer who already learns the same timing from paywall HTTP flow. The comment documents this tradeoff explicitly.

4. **GC on every persist/load.** `gcStaleEntries` removes entries older than `MAX_AGE_MS` (24 h + 5 min) without decryption, bounding storage accumulation across many rooms.

**Clearance triggers reviewed in `RoomPage.tsx`:**
- Explicit BURN: `clearHostToken` called before the `destroy-room` socket emit.
- Room expiry (`room-expired` event): `clearHostToken` called in the event handler.
- The `room-expired` path mirrors the BURN path; no token leakage on natural expiry.

**Browser-extension / XSS exposure:**
`localStorage` is accessible to any same-origin JavaScript, including injected scripts and extensions with `storage` permissions. However, the stored blob is AES-GCM ciphertext — an XSS payload that exfiltrates `localStorage` cannot decrypt the JWT without also exfiltrating the phrase (and if the attacker has the phrase, they already have full peer-level room access). The encrypted-at-rest design materially limits the value of a `localStorage` exfiltration compared to a plaintext-JWT design.

**Severity:** Informational. The encrypted-localStorage design is intentional, well-commented, and materially privacy-preserving. No finding.

#### R-9.2 JWT algorithm pinning — all `verify` call-sites

All three `jwt.verify` calls in `socketHandlers.ts` now carry `{ algorithms: ["HS256"] }` explicitly. This closes the informational gap noted at §3.2 of the April audit. The `paywall.ts` `jwt.sign` call specifies no explicit algorithm (defaults to HS256 when the secret is a string, which `jsonwebtoken` documents as deterministic behavior). The `algorithms` pin on `verify` is the load-bearing guard.

**Severity:** Informational — confirmed resolved.

#### R-9.3 `consumedExtensionTokens` key design

Extension-room tokens are consumed using `consumedExtensionTokens: Map<string, number>` where the key is the SHA-256 hash of the raw JWT string. This differs from the creation-token map, which keys on `paymentHash`. The rationale: two distinct extension payments for the same room produce different JWT strings (different `iat`, different random components if any), so SHA-256(raw JWT) is unique per issuance. This correctly enforces "each extension JWT is single-use" without conflating different payments.

**Severity:** Informational — design is correct and intentional.

#### R-9.4 ICE restart re-keying discipline (`webrtc.ts`)

`attemptIceRestart` now calls `performKeyExchange` before initiating the ICE restart, ensuring that a peer whose ECDHE-derived session key was lost on a network blip re-establishes a fresh key pair rather than silently falling back to the phrase key. The original M-01 finding's specific sub-concern (forward-secrecy abandoned on ICE restart) is addressed by this ordering.

**Severity:** Informational — confirmed resolved as part of M-01 fix.

#### R-9.5 `bufferSource.ts` — cross-realm `instanceof` safety

`asBufferSource(u8)` guards the `Uint8Array → BufferSource` cast using `Object.prototype.toString.call(u8) !== "[object Uint8Array]"` rather than `instanceof Uint8Array`. The comment documents the exact reason: `instanceof` fails across JS realms (jsdom, `vm` contexts, web workers with structured-cloned typed arrays). The fallback error message includes the constructor name for diagnostics. The runtime guard makes downstream `crypto.subtle` failures attributable to the correct call site.

**Severity:** Informational — positive finding.

#### R-9.6 `relay-signal` payload size cap (carry-forward)

The `relay-signal` handler in `socketHandlers.ts` (lines 764–784) performs rate-limiting (200 events per 10 s per socket) and validates `code`, `toPeerId`, `fromPeerId` types. It does **not** enforce a maximum byte length on `data.payload`. The server forwards the payload opaque. A paid attacker with a valid room token can emit large payloads up to the ws engine's per-frame buffer limit on every allowed event.

This was first noted at §3.5 of the April audit (severity: Low) and is unchanged.

**Status: ✓ CLOSED (Task #241).** The relay-signal handler now rejects payloads larger than `RELAY_SIGNAL_MAX_PAYLOAD_BYTES` (64 KiB) with a silent return — string payloads are measured via `Buffer.byteLength(..., "utf8")`, and non-string `unknown` payloads are conservatively measured via `JSON.stringify`.

#### R-9.7 Signed-hello `roomId` binding — cross-room replay prevention

`buildBrowserHelloBody` includes `roomId` (the room code derived from the phrase) in every browser hello body. `verifySignedHello` is called with `{ expectedRoomId: currentRoomCode }` on the browser↔browser path. If the hello's `roomId` is absent or does not match, verification throws `HelloVerificationError("room_id_missing" | "room_id_mismatch")`, which triggers `failSecureChannel()`.

A hello captured in room A cannot be replayed into room B because the `roomId` field differs. Combined with the 24-byte nonce and the ±5-minute timestamp window, replay attacks are blocked at three independent levels.

**Severity:** Informational — positive finding.

#### R-9.8 Screen-share two-phase reservation (updated from §2.5)

The reservation TTL is now 12 s (`SCREEN_SHARE_RESERVATION_TTL_MS = 12_000` in `rooms.ts`). The `setTimeout` ref is stored on the room and cleared on confirmation, cancellation, or socket disconnect (`clearScreenShareForSocket`). `confirmScreenShare` verifies both `peerId` and `socketId` match the reservation — preventing a different socket from claiming a reservation it did not create.

**Severity:** Informational — the race condition noted in §2.5 remains theoretical under the short TTL; no change in finding.

#### R-9.9 Relay-only cooperative flow (`socketHandlers.ts`)

The `request-relay-only` / `respond-relay-only-request` flow allows any room member to request that the host flip the room into relay-only mode. The handler verifies:
- Rate-limited (`checkRate`).
- Sender is a current room member (`users.find(u => u.socketId === socket.id)`).
- For `respond-relay-only-request`: caller must be room host (`isRoomHost`); `data.accept` is strictly a boolean; `data.peerId` passes `PEER_ID_RE` validation.

A non-host peer cannot force relay-only directly: the request reaches the host, who approves or declines. A host self-request short-circuits approval without a round-trip, which is correct.

**Severity:** Informational — flow design is sound.

#### R-9.10 CI regression guards for Docker non-root (new surface)

Reviewed `.github/workflows/docker-build.yml`. The workflow:
- Trigger on push and pull-request to `main` when any relevant file changes.
- Build the production Docker image.
- Assert `docker run --rm --entrypoint id <image> -un` returns `node`.
- Start the container and assert the live `id -un` and `ps -o user= -p 1` both return `node`.
- The workflow comments explicitly cite `docs/security-audit-public-2026-04.md §7.1` as the justification.

This provides the live-validation coverage the April §7.1 entry noted was absent (because the dev container has no Docker daemon).

**Severity:** Informational — positive finding; CI guard closes the live-validation gap noted in the original §7.1 narrative.

#### R-9.11a CSP and HSTS — applicability to served void-client HTML

The April audit noted helmet was registered (§7.1 mention) but did not verify (a) that helmet's CSP actually applies to the served void-client HTML in production, or (b) the per-directive correctness of the policy against actual app behavior. Both are addressed here.

**Applicability — does the helmet CSP cover the served void-client HTML?**

Yes, in production self-host. `artifacts/api-server/src/app.ts` registers `helmet({...})` at lines 39–67 — *before* the static-serve block at lines 74–76 (`app.use(express.static(clientDist, …))`) and the SPA catch-all at lines 102–125 (`app.get("*", …) → res.sendFile(...index.html)`). Express middleware registration order is the request-handling order, so every response served from `clientDist` (the void-client `index.html`, the bundled JS/CSS, the `voice-mask-processor.js` AudioWorklet, the `sw.js` service worker, fonts, icons, OG cards) is wrapped by helmet's `Content-Security-Policy` and `Strict-Transport-Security` headers. The `SERVE_STATIC=1` mode is the production self-host path (`Dockerfile` runs `node ./dist/index.mjs` with `SERVE_STATIC=1` and `CLIENT_DIST=./client` baked into the multi-stage build).

In dev, the void-client is served by Vite on its own port — helmet does not run there. This is dev-only and out of scope for the user-facing security claim. Operators who run a different production topology (Vite dev server, separate static host, CDN-only) are responsible for replicating the CSP and HSTS headers there; the current README-selfhost guidance assumes the bundled `SERVE_STATIC=1` path.

**Per-directive verification (`app.ts` lines 41–55):**

| Directive | Value | Verified against | Result |
|---|---|---|---|
| `defaultSrc` | `'self'` | All other directives are explicit; `defaultSrc` only catches future undeclared resource types | Verified — conservative default |
| `scriptSrc` | `'self'` | `index.html` loads exactly one script: `<script type="module" src="/src/main.tsx">` (bundled to `/assets/...js` at build time, same-origin). No CDN scripts, no analytics SDKs, no inline `<script>` in the served HTML, no `eval`/`new Function` sinks (separately checked in §4.2) | Verified — covers the actual script surface. Inline `<script>` exists in `PhraseShareModal.tsx` (the print-preview popup that calls `document.write`), but the popup is opened as `about:blank` via `window.open` and does not inherit the parent's CSP — it is not a served-HTML resource and is therefore outside this directive's scope |
| `styleSrc` | `'self'`, `'unsafe-inline'` | Tailwind/utility-class build emits inline `style` attributes and inline `<style>` blocks; React inline `style={{...}}` is in active use across the app | Verified with caveat — `'unsafe-inline'` is required by the current styling approach. Trading it for nonces or hashes would require a styling-pipeline change; out of scope here. Recorded as the necessary tradeoff |
| `connectSrc` | `'self'`, `wss:`, `ws:` | Socket.io connects same-origin at path `/api/socket.io` (`artifacts/void-client/src/lib/socket.ts:31-32`); `fetch` calls hit `/api/...` (same origin); WebRTC ICE/STUN/TURN connections go through the browser's ICE agent transport, not fetch/XHR, so they are *not* governed by `connect-src` (correctly noted in the source comment at `app.ts:37-38`) | Verified — covers Socket.io (both `wss:` for prod TLS and `ws:` for the dev `http://localhost` path) and `/api/...` fetches. The `wss:`/`ws:` schemes broaden beyond `'self'` for the Socket.io websocket upgrade; same-origin in practice |
| `workerSrc` | `'self'`, `'blob:'` | Service worker registered at `${BASE_URL}sw.js` (`main.tsx:10`, same-origin); AudioWorklet module loaded from `${BASE_URL}voice-mask-processor.js` (`mediaPipeline.ts:476`, same-origin); `'blob:'` covers any future Web Worker constructed from a `Blob` URL (no current usage observed but reserved as defensive headroom) | Verified — covers both the SW and the AudioWorklet |
| `mediaSrc` | `'self'`, `'blob:'`, `'mediastream:'` | `<video>`/`<audio>` elements bound to `MediaStream` via `srcObject` (WebRTC peer streams) need `'mediastream:'`; `<video poster>` attributes use same-origin assets; recorded blob fallback paths use `'blob:'` | Verified — covers the actual media bindings |
| `imgSrc` | `'self'`, `'data:'`, `'blob:'` | OG cards, icons, favicons all same-origin; `'data:'` covers inline SVG icons and the QR code `data:image/svg+xml` rendering on `PhraseShareModal`; `'blob:'` covers any client-generated blob image (e.g. screenshot tool output, none today) | Verified — covers the actual image surface |
| `fontSrc` | `'self'` | Two fonts under `public/fonts/` (`jetbrains-mono-latin.woff2`, `staatliches-latin.woff2`), both same-origin. No Google Fonts, no third-party CDN | Verified — covers the actual font surface |
| `objectSrc` | `'none'` | No `<object>`/`<embed>`/`<applet>` elements; rules out plugin-based code injection | Verified — correct for the codebase |
| `frameSrc` | `'none'` | No `<iframe>` elements rendered by the client. The `frameguard: { action: "deny" }` setting independently blocks the void-client from being embedded in third-party frames | Verified — correct for the codebase |
| `baseUri` | `'self'` | Locks the document `<base>` so a script-injection attack cannot relocate relative URLs to attacker-controlled origins | Verified — defense-in-depth |
| `formAction` | `'self'` | No `<form action="...">` elements with cross-origin destinations; the paywall flow is JSON-over-fetch, not form-POST | Verified — defense-in-depth |
| HSTS | `maxAge: 31536000, includeSubDomains: true, preload: true` | One-year max-age, subdomain coverage, preload-list compatible | Verified — meets the HSTS preload criteria; operator can submit to `hstspreload.org` if not already enrolled via the upstream domain |

**Cross-origin policies intentionally disabled.** `crossOriginEmbedderPolicy: false`, `crossOriginOpenerPolicy: false`, `crossOriginResourcePolicy: false` are explicit in the helmet block. COEP would block the cross-origin `<video>` / `<audio>` poster frames and any future media-asset CDN; COOP would interfere with `window.open(...)` for the print-preview popup in `PhraseShareModal`. These disables are deliberate and recorded inline in the source for the next reader.

**Gap — no `report-to` / `report-uri` directive.** The current CSP has no reporting endpoint. Real-world CSP violations on the served void-client HTML — whether caused by a future bundler change that introduces a non-`'self'` script source, a marketing-page edit that adds an inline event handler, or an actual injection attempt against a deployed instance — are not observable to the operator. Without a reporting endpoint, the policy is enforced silently: a legitimate refactor that violates a directive will manifest as a broken page in production and a console-only error; an injection attempt will be blocked but undetected. Recommended: add `report-to` (the modern directive, with a matching `Report-To` header naming a same-origin sink at e.g. `/api/csp-report`) and a server-side route that ingests, rate-limits, and logs the reports. Tracked as **R-N4** above and as a follow-up task.

**Severity:** Informational — the CSP applies, the directives are correct against actual app behavior; the only gap is observability of violations, recorded as R-N4 (Low).

**Post-audit fixes (May 2, 2026 — task #256).** The header surface above was widened in code the same day. The summary below records the final state; the per-directive table above remains accurate for the rows it covers.

- **`Permissions-Policy` added** (deny-by-default allow-list). The void-client API audit done as task #256 step 1 (ripgrep across `artifacts/void-client/src/`) found exactly four feature-policy-relevant browser APIs in use: `getUserMedia` (camera/mic), `getDisplayMedia` (screen-share), `navigator.clipboard.writeText` (copy phrase / invoice / room URL — never read), and `navigator.share` (Web Share for room invites). The emitted policy whitelists `camera=(self)`, `microphone=(self)`, `display-capture=(self)`, `clipboard-write=(self)`, `fullscreen=(self)`, `autoplay=(self)`, `web-share=(self)` and explicitly denies `clipboard-read=()` plus the long tail of `accelerometer / ambient-light-sensor / battery / bluetooth / browsing-topics / encrypted-media / geolocation / gyroscope / hid / idle-detection / interest-cohort / magnetometer / midi / otp-credentials / payment / picture-in-picture / publickey-credentials-{create,get} / screen-wake-lock / serial / speaker-selection / storage-access / sync-xhr / usb / window-management / xr-spatial-tracking` — every feature the void-client does not use, denied. The middleware that emits this header is registered before `cors()` so it persists on the 204 OPTIONS preflight that the cors short-circuit returns.
- **`Referrer-Policy: no-referrer`** (was helmet's default `no-referrer`; declared explicitly so the regression test asserts the value rather than the absence of an opt-out, and so a future helmet default change cannot silently downgrade it).
- **`Cross-Origin-Opener-Policy: same-origin`** (previously disabled). Closes opener-relationship cross-origin attacks (tabnabbing, popup XS-leaks). Web Share API uses `navigator.share()` which hands off to the OS share-sheet and does NOT depend on a `window.open` opener; verified per task #256 step 2 that `RoomPage.tsx`'s invite flow still works on iOS Safari, Android Chrome, and Firefox under COOP `same-origin`. The earlier note about `PhraseShareModal`'s `window.open` print-preview popup is preserved by COOP `same-origin` because the popup is opened by the same origin (it inherits the COOP relationship, not breaks it).
- **`Cross-Origin-Resource-Policy`: keyed off `SERVE_STATIC`.** Single-origin self-host (`SERVE_STATIC=1`, the production Docker path) sets `same-origin` — strictest possible. Split-origin deployments (`SERVE_STATIC` unset, client served from a different host) relax to `same-site` so the static client can fetch `/api/*` cross-origin without a CORB block. README-selfhost.md §"Security Headers" documents both modes for operators.
- **`X-Permitted-Cross-Domain-Policies: none`** (was helmet's default; declared explicitly for the same regression-test reason as `Referrer-Policy`).
- **`Cross-Origin-Embedder-Policy` declined.** Task #256 step 1 also confirmed via ripgrep that the void-client uses no `SharedArrayBuffer`, `crossOriginIsolated`, `OffscreenCanvas`, `bluetooth`, `usb`, `hid`, `serial`, `geolocation`, or sensor APIs. COEP `require-corp` would force every cross-origin subresource (none today, but a future marketing-page image tomorrow) to opt in via CORP for zero security gain on the current API surface. Declined deliberately; recorded inline in the source.
- **CSP `report-to` directive + `Reporting-Endpoints` header added, both naming the well-known group `default`.** The CSP directive (`reportTo: ["default"]`) wires CSP violations to the `default` endpoint group; `Reporting-Endpoints: default="/api/csp-report"` is what the browser's Reporting API consults to find the actual URL. The Permissions-Policy header value itself does NOT carry a per-policy `report-to` directive — the spec routes Permissions-Policy violations to the `default` endpoint group of the Reporting API automatically (see Permissions Policy spec §"Reporting"), which is why we deliberately use the group name `default` rather than e.g. `csp-endpoint`: a single sink covers both header families with no second header or per-policy directive needed. The endpoint itself remains R-N4 / task #252's deliverable; declaring the headers here means the moment #252 ships the `/api/csp-report` ingestion route, browsers will start posting both CSP and Permissions-Policy violations automatically with no further app.ts change.
- **Custom 404 + error handlers added** (`app.use((req, res) => res.status(404).send(...))` and a 4-arg error middleware). Express's default `finalhandler` would otherwise overwrite `Content-Security-Policy` with `default-src 'none'` on error responses, breaking the "headers persist on 4xx/5xx" invariant.
- **Catch-all SPA route migrated** from `app.get("*", ...)` to `app.get(/.*/, ...)`. Express 5 / path-to-regexp v8 rejects bare `"*"` strings; the regex form is semantically equivalent and unblocks the `SERVE_STATIC=1` startup path that the regression test exercises. (Adjacent fix forced by the same test that asserts headers on static assets and the SPA fallback.)

A regression test at `artifacts/api-server/src/__tests__/security-headers.test.ts` asserts the exact value of every header above on (a) a normal 200 response, (b) a 404 response, (c) a route that throws (5xx), (d) the OPTIONS preflight short-circuited by `cors()`, and (e) — under `SERVE_STATIC=1` with a tmp client dist — JS asset, CSS asset, image asset, and SPA fallback responses. Both CORP modes (`same-origin` for `SERVE_STATIC=1`, `same-site` for split-origin) are covered. The full CSP value (the entire directive string helmet emits) is asserted exactly via `toBe(...)`, not via per-directive `toContain` substring checks, so any silent directive add/remove/reorder fails the test. 9/9 tests pass as of the task #256 commit; run via `pnpm --filter @workspace/api-server exec vitest run src/__tests__/security-headers.test.ts`.

**Severity:** Informational — the prior R-9.11a finding (CSP applies, directives correct, only gap is reporting observability) is unchanged. The widened header surface tightens defense-in-depth for the standard published browser hardening checklist (Mozilla Observatory, securityheaders.com) without affecting the underlying risk model. **R-N4 (CSP report sink) was closed by task #252 on 2026-05-03**: the `/api/csp-report` ingestion route now lands at `artifacts/api-server/src/routes/csp-report.ts`, mounted via the routes barrel and reachable through both the `report-to` CSP directive and the `Reporting-Endpoints` header named here. The route accepts both the modern Reporting-API content type (`application/reports+json`, batched envelopes with `type === "csp-violation"` or `"permissions-policy-violation"`) and the legacy `application/csp-report` `{ "csp-report": { … } }` body, applies a per-IP rate limit of 30/min (with a global threshold WARN at 500/min for distributed floods), normalizes the salient fields, and emits a structured pino WARN tagged `event: "csp_report"` carrying `reportType`, `blockedUrl`, `documentUrl`, `effectiveDirective`, `disposition`, `sourceFile`, `lineNumber`, `columnNumber`, `featureId`, client IP, and user-agent. The handler always replies 204 (including on parse failure and on unrecognized payload shapes) so the endpoint cannot be used as an oracle. A round-trip test at `artifacts/api-server/src/__tests__/csp-report.test.ts` covers the Reporting-API shape, the legacy shape, the no-oracle invariant on bad input, and the 429 rate-limit branch.

#### R-9.11 `pnpm audit` results (May 2, 2026)

`pnpm audit --json` was executed in the workspace root. Fourteen advisories were returned across five packages on the original audit pass. They are classified below by production risk; subsequent task #242 (vite) and task #251 (the dev-tool tail) closed every row except the two `path-to-regexp` runtime rows tracked as R-N1, leaving the workspace at two `pnpm audit` findings as of May 2, 2026.

**Production API server (`artifacts/api-server`) — action required:**

| CVE | Severity | Package | Affected version | Path | Notes |
|---|---|---|---|---|---|
| CVE-2026-4926 | **High** | `path-to-regexp` | `>=8.0.0 <8.4.0` | `express > router > path-to-regexp` | DoS via sequential optional groups in route pattern; Express uses this for all route matching |
| CVE-2026-4923 | Moderate | `path-to-regexp` | `>=8.0.0 <8.4.0` | `express > router > path-to-regexp` | ReDoS via multiple wildcards |
| ~~CVE-2026-8723~~ | ~~Moderate~~ | ~~`qs` (DoS via `qs.stringify` `TypeError`)~~ | ~~`>=6.11.1 <=6.15.1`~~ | ~~`express > qs`~~ | ✓ CLOSED (post-audit) — pinned via `overrides.qs@<6.15.2: ^6.15.2` in root `package.json`, resolving `qs` to `6.15.2`. Only triggerable when application code calls `qs.stringify` with both `arrayFormat: 'comma'` and `encodeValuesOnly: true` (both non-default) on arrays containing `null`/`undefined`; VOID does not, but the floor closes it regardless. GHSA-q8mj-m7cp-5q26 |

`path-to-regexp < 8.4.0` is a transitive runtime dependency of Express in the API server. Operator-defined routes are static (not user-supplied), so the DoS trigger requires a specially crafted *route pattern* at server startup — not a crafted incoming request in the typical attack sense. The realistic risk is lower than CVSS suggests for this code base (VOID's Express routes are author-defined constants). However, the patched version is `>=8.4.0` and the fix is available: the `express` dependency should be bumped or `path-to-regexp` overridden in `pnpm` overrides. **Recommended: update promptly; tracked as R-N1 (High).**

**Development / build-time only (no production runtime exposure):**

| CVE | Severity | Package | Path |
|---|---|---|---|
| ~~CVE-2026-33671~~ | ~~High~~ | ~~`picomatch` (ReDoS)~~ | ✓ CLOSED (task #251) — `artifacts__api-server > vitest > picomatch`; pinned via `overrides.picomatch@^4.0.0: ^4.0.4` in `pnpm-workspace.yaml` (the patched release in the v4 line that vitest pulls in) |
| ~~CVE-2026-33750~~ | ~~Moderate~~ | ~~`brace-expansion` (DoS)~~ | ✓ CLOSED (task #251) — `lib__api-spec > orval > typedoc > minimatch > brace-expansion`; pinned via `overrides.brace-expansion@^2.0.0: ^2.0.3` (the patched release in the v2 line that minimatch pulls in) |
| ~~CVE-2026-45149~~ | ~~Moderate~~ | ~~`brace-expansion` (DoS — large numeric range defeats `max`)~~ | ✓ CLOSED (post-audit) — `eslint > minimatch > brace-expansion` (the v5 line, distinct from the v2 `orval > typedoc > minimatch` chain above); pinned via `overrides.brace-expansion@<5.0.6: ^5.0.6` in root `package.json`, resolving that copy to `5.0.6`. GHSA-jxxr-4gwj-5jf2 |
| ~~CVE-2026-33532~~ | ~~Moderate~~ | ~~`yaml` (stack overflow)~~ | ✓ CLOSED (task #251) — `lib__api-spec > yaml`; bumped the direct `lib/api-spec` dep from `^2.8.2` to `^2.8.3` |
| ~~CVE-2026-6321~~ | ~~**High**~~ | ~~`fast-uri` (path traversal via percent-encoded dot segments)~~ | ✓ CLOSED (R-N5) — `lib__api-spec > orval > @scalar/openapi-parser > ajv > fast-uri <= 3.1.0`; pinned via `overrides.fast-uri@<3.1.2: ^3.1.2` in root `package.json` (the patched 3.x floor; staying inside the 3.x line avoids the fast-uri 4.0.0 major that `ajv@8.18.0` does not declare). GHSA-q3j6-qgpj-74h6 |
| ~~CVE-2026-6322~~ | ~~**High**~~ | ~~`fast-uri` (host confusion via percent-encoded authority delimiters)~~ | ✓ CLOSED (R-N6) — same `lib__api-spec` codegen chain (`fast-uri <= 3.1.1`); closed in lockstep by the same `^3.1.2` override floor (3.1.2 satisfies both `>=3.1.1` and `>=3.1.2`). GHSA-v39h-62p7-jpjc |
| ~~GHSA-gv7w-rqvm-qjhr~~ | ~~**High**~~ | `esbuild` (Deno-module RCE via `NPM_CONFIG_REGISTRY`) | ✓ CLOSED (R-N7) — the `esbuild` override floor was raised to `^0.28.1` in root `package.json > pnpm.overrides` (resolves `0.28.1`, above the fixed `>=0.28.1` floor), so the vulnerable line no longer resolves and the advisory no longer surfaces. `esbuild-plugin-pino@2.3.3` builds the api-server cleanly against `0.28.1` (its declared peer was already exceeded by the prior `0.27.3` pin), and the client Vite/bundle is unaffected. See the §R-11 "Post-audit triage — `esbuild`" paragraph. No CVE; vulnerable `>=0.17.0 <0.28.1`, fixed `>=0.28.1` |
| ~~GHSA-g7r4-m6w7-qqqr~~ | ~~Low~~ | `esbuild` (arbitrary file read via dev server on Windows) | ✓ CLOSED — same `artifacts__api-server > esbuild` copy; closed in lockstep with R-N7 by the `^0.28.1` override floor. No CVE; vulnerable `>=0.27.3 <0.28.1`, fixed `>=0.28.1` |

These affect `vitest` (test runner) and `orval` (API codegen tool). They are not present in the production bundle and are not reachable from the API server or void-client at runtime. The first three (`picomatch`, `brace-expansion`, `yaml`) were patched on May 2, 2026 (task #251); see the §R-11 "Post-audit fixes (May 2, 2026, follow-up — task #251)" paragraph for the verification commands. The two `fast-uri` rows (CVE-2026-6321, CVE-2026-6322) are **post-audit advisories** that surfaced later on the same `orval > @scalar/openapi-parser > ajv` codegen chain and were closed as R-N5 / R-N6; see the §R-11 "Post-audit fixes — `fast-uri` codegen advisories (R-N5 / R-N6)" paragraph.

**Design-tool / mockup-sandbox only (`artifacts/mockup-sandbox`) — not in production image:**

| CVE | Severity | Package | Notes |
|---|---|---|---|
| ~~CVE-2026-33671 / CVE-2026-33672~~ | ~~High / Moderate~~ | ~~`picomatch`~~ | ✓ CLOSED (task #251) — `fast-glob > micromatch > picomatch` in Vite dev server; pinned via `overrides.picomatch@^2.0.0: ^2.3.2` (the patched release in the v2 line that micromatch pulls in, kept separate from the v4 override above) |
| ~~CVE-2026-4800~~ | ~~**High**~~ | ~~`lodash`~~ | ✓ CLOSED (task #251) — code injection via `_.template` key names; `recharts > lodash` pinned via `overrides.lodash: ^4.18.1` (4.18.x is API-compatible with the `4.17.x` range recharts declared, so no peer-dep warnings) |
| ~~CVE-2026-2950~~ | ~~Moderate~~ | ~~`lodash`~~ | ✓ CLOSED (task #251) — prototype pollution via `_.unset`/`_.omit`; same `overrides.lodash: ^4.18.1` patch as above |
| ~~CVE-2026-39363~~ | ~~**High**~~ | ~~`vite`~~ | ✓ CLOSED (task #242) — patched in `vite@7.3.2`; catalog bumped to `^7.3.2` and a `vite: ^7.3.2` override added to `pnpm-workspace.yaml` so the transitive `vitest>vite` copy cannot lag behind |
| ~~CVE-2026-39364~~ | ~~**High**~~ | ~~`vite`~~ | ✓ CLOSED (task #242) — same patch as above |
| ~~CVE-2026-39365~~ | ~~Moderate~~ | ~~`vite`~~ | ✓ CLOSED (task #242) — same patch as above |
| ~~CVE-2026-41305~~ | ~~Moderate~~ | ~~`postcss`~~ | ✓ CLOSED (task #251) — XSS via unescaped `</style>` in stringify output; `mockup-sandbox > vite > postcss` pinned via `overrides.postcss: ^8.5.13` |

The `mockup-sandbox` artifact is a design/preview tool that does not serve external users in production. These vulnerabilities are real but confined to that internal tooling. The three Vite CVEs above (CVE-2026-39363, -39364, -39365) were patched on May 2, 2026 (task #242): `pnpm-workspace.yaml` was updated to `vite: ^7.3.2` (the lowest 7.x release that backports all three fixes — see Vite v8.0.5 changelog: *"apply server.fs check to env transport"*, *"check `server.fs` after stripping query as well"*, *"avoid path traversal with optimize deps sourcemap handler"*), and a matching `overrides.vite: ^7.3.2` was added to deduplicate the transitive copy that vitest pulls in independently. Verified via `pnpm audit` (the three CVEs no longer appear), `pnpm why vite` (single resolved version `7.3.2`), restarted dev workflows for both `void-client` and `mockup-sandbox` (both report `VITE v7.3.2 ready`), `pnpm --filter @workspace/void-client run build` (succeeds; `dist/` file count unchanged at 48 files; total size delta -0.025% / -2,833 bytes; `index.html` loads in a real browser preview without console errors). The original framing — "confined to internal tooling kept behind authentication" — was an operator-discipline argument; the realistic surface was developer machines (engineer browser tabs co-resident with a local Vite dev server), so the patch was applied unconditionally.

**Overall audit verdict for pnpm findings:** One tracked finding affects a production runtime path — R-N1 (`path-to-regexp`), tracked separately as task #239. R-N1 covers two related advisories on the same package (CVE-2026-4926 High and CVE-2026-4923 Moderate, both `>=8.0.0 <8.4.0`), which is why `pnpm audit` reports two raw rows for one tracked finding. The remainder were confined to dev/build/internal-tool dependencies and have been closed by tasks #242 and #251 — `pnpm audit` now reports zero rows other than the two `path-to-regexp` advisories that compose R-N1. **Update (post-audit):** two further High advisories later surfaced on the dev/build-only `fast-uri` codegen path (CVE-2026-6321 / CVE-2026-6322) and were closed by the `^3.1.2` override tracked as R-N5 / R-N6; see the §R-11 "Post-audit fixes — `fast-uri` codegen advisories" paragraph. A later pass closed two Moderate advisories — `qs` (CVE-2026-8723, production `express > qs`) and `brace-expansion` (CVE-2026-45149, dev/build-only `eslint > minimatch`) — via `^6.15.2` and `^5.0.6` override floors; see the §R-11 "Post-audit fixes — `qs` and `brace-expansion`" paragraph. **Update (post-audit):** a later High esbuild advisory (GHSA-gv7w-rqvm-qjhr, Deno-module RCE) surfaced on the dev/build-only `artifacts/api-server > esbuild` bundler; it was initially **accepted as residual risk** (R-N7) and has since been **closed** by raising the `esbuild` override floor to `^0.28.1` (above the fixed `>=0.28.1` floor) once it was confirmed `esbuild-plugin-pino` builds cleanly against `0.28.1` and the client Vite/bundle is unaffected; see the §R-11 "Post-audit triage — `esbuild`" paragraph.

---

#### R-9.12 Type-level secret tagging (`Brand<"Secret">`) and lint enforcement (task #264)

Background: §3.7 ("Wrong-phrase vs no-peer side channel — timing") established that any equality compare against a secret value must be constant-time. Enforcing that property by code review alone is brittle — a single `===` against a JWT signing key, a TURN HMAC secret, or an Ed25519 private key reintroduces the side channel that §3.7 closed. Task #257 contemplated a grep-based guard that scanned for `===` against identifiers imported from a conventional `lib/secrets/` path; that guard was never landed (the conventional path was never created, no helper module exists at `lib/secrets/timing-safe-string.ts`), so #264 supersedes #257 outright rather than retiring a shipped guard.

The replacement is a TypeScript brand: `Brand<"Secret">` and the `Secret<T>` alias defined in `lib/wire-core/src/brand.ts`, plus `markSecret()` / `unwrapSecret()` constructors. Every secret value in the workspace is now branded at its declaration site, and the brand is threaded through call signatures so that any downstream consumer also sees the `Secret<T>` type. The branded surfaces are:

| Symbol | File | Branded type |
|---|---|---|
| `PAYWALL_SECRET` | `artifacts/api-server/src/lib/paywallSecret.ts` | `Secret<string>` |
| `TURN_SECRET` | `artifacts/api-server/src/lib/turnSecret.ts` | `Secret<string>` |
| `RegisterSocketHandlersOptions.paywallSecret` | `artifacts/api-server/src/socketHandlers.ts` | `Secret<string> \| string` (re-branded at the boundary) |
| `CreatePaywallRouterOptions.secret` | `artifacts/api-server/src/routes/paywall.ts` | `Secret<string> \| string` (re-branded at the boundary) |
| `generateRecoveryCode()` return | `artifacts/api-server/src/routes/paywall.ts` | `Secret<string>` |
| JWT outputs (status / recover handlers) | `artifacts/api-server/src/routes/paywall.ts` | `Secret<string>` |
| `SignedHello.signature` | `artifacts/void-client/src/lib/helloEnvelope.ts` | `Secret<string>` |
| `SigningIdentity.privateKey` | `artifacts/void-client/src/lib/helloEnvelope.ts` | `Secret<CryptoKey>` |

`unwrapSecret()` is called only at the boundary where the value crosses into a constant-time primitive (`crypto.createHmac`, `crypto.timingSafeEqual`, `jwt.sign`, the WebCrypto `sign`/`verify` calls). Branded values never flow into a `BinaryExpression` operand directly.

Enforcement is the custom ESLint rule `@workspace/secrets/no-secret-equality`, shipped from `tools/eslint-plugin-secrets/`. The rule is type-aware: it asks the TypeScript program for the inferred type of each operand of `===` / `!==` / `==` / `!=` (and each argument of `Buffer.equals`) and reports if the type carries the `__brand: "Secret"` tag — directly, intersected, or as a constituent of a union. This catches the brand wherever the type-checker can resolve it, including through function parameters, destructured fields, and re-exports. Comparisons against the `null` / `undefined` literals are explicitly allowed (a presence check cannot extract a byte of the secret). The rule is wired into `eslint.config.mjs` at `error` severity for the secret-handling source trees (`artifacts/api-server/src`, `artifacts/void-client/src/lib`) and into CI as `.github/workflows/lint-secrets.yml`. `pnpm run lint` is the single entry point; `pnpm run lint:secrets` runs only this rule for fast local feedback.

What this catches that the #257 grep would not: (1) secrets passed as function arguments and re-bound to a different identifier — the type still carries the brand, but the identifier no longer matches the grep regex; (2) secrets read out of a struct field (`options.secret`, `decoded.signature`) — the access expression has no identifier the grep can latch onto, but the type-checker still resolves the brand; (3) secrets returned from a helper that the grep was never taught about (e.g. `generateRecoveryCode`) — adding new helpers requires no rule change, only the `Secret<T>` annotation on the return type.

Verification (May 2, 2026): `pnpm run lint` produces zero errors across the two scoped trees; a deliberate violation (`s === "leak"` where `s: Secret<string>`) reproduces an error with the rule's diagnostic message; `pnpm run typecheck` is unchanged for `api-server` (the `void-client` typecheck retains the same pre-existing `peer-secure-channel-retry` errors recorded before this task and verified unrelated by `git stash`).

---

### R-10. Browser-level surfaces — moved into the documented-known-limitations tier

External reviewer feedback in late April 2026 flagged that the threat-model page acknowledged TLS-observer and metadata-correlation surfaces but was silent on adjacent browser-level surfaces that any privacy-claiming web app inherits. None of the six surfaces below are VOID code defects. They are properties of running anything inside a modern web browser, and they constrain the maximum privacy a VOID client can offer regardless of how the relay or the cryptography behave.

**Tier classification.** These six items move from "absent from the audit" into the §11 documented-known-limitations confidence tier: no code fix is recommended (the mitigations are configuration choices on the user's end), and the canonical disclosure surface is the user-facing `ThreatModelPage.tsx` "BROWSER-LEVEL SURFACES" section with the technical mirror at `docs/threat-model.md` §6.

| # | Surface | Adversary | Mitigation tier |
|---|---|---|---|
| R-10.1 | DNS lookup of operator's domain | Local resolver / ISP / captive portal | User-side: browser/OS DNS-over-HTTPS; Tor for strongest posture |
| R-10.2 | Clipboard read on phrase paste | Extensions with `clipboardRead` | User-side: extension-free profile; manual clipboard clear after paste |
| R-10.3 | Notification API content | Extensions with notification access | User-side: deny notification permission; rely on in-tab UI |
| R-10.4 | DOM read on room page | Extensions with `<all_urls>` | User-side: extension-free profile / private window |
| R-10.5 | `RTCPeerConnection.getStats()` | Extensions with `debugger` perm; devtools panel | User-side: extension-free profile; close devtools during screen-share |
| R-10.6 | Managed-browser `getUserMedia` log | Enterprise admin / browser vendor under MDM | User-side: do not use a managed browser for personal-privacy use |

**Why these are not code findings.** None of them are reachable from VOID's own code paths — VOID does not call `navigator.clipboard.readText()` on its own behalf, does not request the `debugger` capability, and does not control whether a deployment runs inside a managed browser. They are surfaces the *page itself* exposes to the *runtime environment* the user chose. The honest mitigation is configuration the user makes on their end. Adding code-level workarounds (e.g., a clipboard-clear toast, a `getStats()`-counter shim) was explicitly considered and deferred — those would be UI/UX changes that move on a different review surface and should be tracked as separate follow-up tasks.

**Why this matters for the audit's §11 framing.** §11 already enumerates the things a static read cannot meaningfully assess. These six items are a different shape — the static read could enumerate them perfectly well; they were simply absent from the original April audit because the threat-model surface chosen for the audit was VOID-specific (relay, signaling, paywall, KDF). Moving them into the same documented-known-limitations register that §11 uses gives an external auditor a single place to look for "things VOID has acknowledged but not coded around." The published audit (`docs/security-audit-public-2026-04.md` §11) carries the same enumeration in identical language for the same reason.

---

### R-11. May 2026 re-audit conclusions

**All eight original findings (H-01, H-05, M-01–M-06) are confirmed closed** in code. The fixes are structurally sound and implemented consistently across all relevant call sites. Regression guards (CI non-root check for the production image per `.github/workflows/docker-build.yml`, static `pushState` test, GC on consumed-token maps) are in place.

**Post-audit fixes (May 2, 2026):** Three of the R-9.11 dev-tool CVEs flagged in `pnpm audit` were patched the same day (task #242): the catalog `vite` pin was bumped from `^7.3.0` to `^7.3.2` and an `overrides.vite: ^7.3.2` was added (now in root `package.json > pnpm.overrides`; see the override-location reconciliation paragraph below) so the transitive `vitest>vite` copy is forced to the same version. This closes CVE-2026-39363 (dev-server WebSocket arbitrary file read, High), CVE-2026-39364 (`server.fs.deny` query-string bypass, High), and CVE-2026-39365 (optimized-deps `.map` path traversal, Moderate). Verification commands run: `pnpm audit` (the three vite CVEs no longer appear), `pnpm audit --prod` (only `path-to-regexp` remains, tracked as R-N1), `pnpm why vite` (single resolved `7.3.2`), restarted `void-client` and `mockup-sandbox` dev workflows (both boot on `VITE v7.3.2`), `pnpm --filter @workspace/void-client run build` (succeeds; same 48 `dist/` files; total size delta −0.025%; built `index.html` loads in a real browser without console errors).

**Post-audit fixes (May 2, 2026, follow-up — task #251):** The remaining six dev/build-only R-9.11 rows were closed the same day by adding targeted floors to the workspace's `pnpm` overrides (originally written to `pnpm-workspace.yaml > overrides`; **these are now consolidated into root `package.json > pnpm.overrides` — see the override-location reconciliation paragraph below, which explains why the `pnpm-workspace.yaml` copies never actually took effect**): `brace-expansion@^2.0.0: ^2.0.3` (CVE-2026-33750, the `orval > typedoc > minimatch` chain), `picomatch@^2.0.0: ^2.3.2` and `picomatch@^4.0.0: ^4.0.4` (CVE-2026-33671 / CVE-2026-33672, both the `vitest` v4 line and the `mockup-sandbox > vite > fast-glob > micromatch` v2 line), `lodash: ^4.18.1` (CVE-2026-4800 / CVE-2026-2950, the `recharts` chain), `postcss: ^8.5.13` (CVE-2026-41305, the `mockup-sandbox > vite` chain), and a direct bump of `lib/api-spec`'s `yaml` from `^2.8.2` to `^2.8.3` (CVE-2026-33532). The two-major-line picomatch override is required because `micromatch` and `vitest` resolve to different majors and only the patched release in each line restores the pre-CVE behaviour. Verification: `pnpm install` resolved cleanly with `+12 / -12` packages; `pnpm audit` now reports only the two `path-to-regexp` rows (R-N1, tracked separately as task #239) — total down from 11 (4 high / 7 moderate) to 2 (1 high / 1 moderate); `pnpm --filter @workspace/api-server run test` passes (18 files / 206 tests); `pnpm --filter @workspace/api-server run build` succeeds; `pnpm --filter @workspace/api-spec run codegen` succeeds (orval still loads the new `yaml@2.8.3` and emits the same outputs). The `recharts > lodash` row was the only one with material risk of forcing a major upgrade, but `lodash@4.18.1` is API-compatible with the `4.17.x` range `recharts` declared — a `pnpm install` produces no peer-dep warnings on the recharts subgraph.

**Post-audit fixes — `fast-uri` codegen advisories (R-N5 / R-N6):** Two new High `fast-uri` advisories surfaced on the lockfile after the May 2 pass — CVE-2026-6321 (path traversal via percent-encoded dot segments, GHSA-q3j6-qgpj-74h6, `<=3.1.0`) and CVE-2026-6322 (host confusion via percent-encoded authority delimiters, GHSA-v39h-62p7-jpjc, `<=3.1.1`). Both reach the tree only through the API codegen toolchain: `lib/api-spec > orval > @scalar/openapi-parser > ajv > fast-uri`. `fast-uri` is a build-time-only dependency — `ajv` uses it for URI parsing while validating the OpenAPI schema during codegen — and it is neither bundled into nor reachable from the `api-server` or `void-client` production runtimes; the only input it ever parses is the project's own committed OpenAPI spec, not attacker-controlled data, so the realistic risk is low. Both were nonetheless closed by pinning the patched floor: `overrides.fast-uri@<3.1.2: ^3.1.2` was added to root `package.json > pnpm.overrides` (the location pnpm actually reads overrides from in this workspace), resolving `fast-uri` to `3.1.2`. The override is constrained to the `^3.1.2` (3.x) line deliberately: an unbounded `>=3.1.2` floor resolves to `fast-uri@4.0.0`, a major `ajv@8.18.0` does not declare, so the 3.x cap keeps `ajv` on a compatible URI parser. Verification: `pnpm install` resolved cleanly and `fast-uri@3.1.2` is the single resolved copy (`ajv@8.18.0 > fast-uri 3.1.2` in `pnpm-lock.yaml`); `pnpm audit --json --audit-level=info` no longer surfaces either CVE (0 `fast-uri` rows, 0 High/Critical rows); `pnpm --filter @workspace/api-spec run codegen` succeeds (orval + the signaling-types generator emit the same outputs against `fast-uri@3.1.2`); `node scripts/regen-cve-appendix.mjs --strict` exits 0. Mapped into `AUDIT_LEDGER` in `scripts/regen-cve-appendix.mjs` so the release-gate ledger records the resolution even though the now-patched rows no longer render in the appendix.

**Post-audit fixes — `qs` and `brace-expansion` moderate DoS advisories:** Two Moderate advisories were the last two rows in the lockfile-complete CVE appendix (`docs/security-audit-cve-appendix.md`) after the `fast-uri` pass. Both were closed by pinning the patched floor in root `package.json > pnpm.overrides` (the location pnpm reads overrides from in this workspace). (1) **CVE-2026-8723** (GHSA-q8mj-m7cp-5q26, `qs` `>=6.11.1 <=6.15.1`) — a remotely-triggerable DoS where `qs.stringify` throws a `TypeError` on `null`/`undefined` entries in comma-format arrays when `encodeValuesOnly` is set. `qs` reaches the tree as a production transitive of Express (`artifacts/api-server > express > qs`), but the crash only fires when application code calls `qs.stringify` with both `arrayFormat: 'comma'` and `encodeValuesOnly: true` (both non-default) on arrays that may contain `null`/`undefined`; VOID does not, so the realistic risk was low. Closed by `overrides.qs@<6.15.2: ^6.15.2`, resolving `qs` to `6.15.2`. (2) **CVE-2026-45149** (GHSA-jxxr-4gwj-5jf2, `brace-expansion` `>=5.0.0 <5.0.6`) — a DoS where a large numeric range such as `{1..10000000}` allocates the full intermediate array before the documented `max` limit is applied. It reaches the tree only through the dev/build-only `eslint > minimatch > brace-expansion` chain (the v5 line, distinct from the already-closed v2 `orval > typedoc > minimatch` chain at CVE-2026-33750) and was closed by `overrides.brace-expansion@<5.0.6: ^5.0.6`, resolving that copy to `5.0.6`. Neither advisory needs an `AUDIT_LEDGER` entry — the ledger and its release-gate cross-references are High/Critical-only, so Moderate rows render `—`, and once fixed these rows no longer appear in the appendix at all. Verification: `pnpm install` resolved cleanly (`+2 / -4` packages); `pnpm audit --json --audit-level=info` no longer surfaces either CVE; `node scripts/regen-cve-appendix.mjs --check` exits 0 against the regenerated appendix (the two Moderate rows are gone); `pnpm --filter @workspace/api-server run build` succeeds and `pnpm --filter @workspace/api-server run test` passes except for two pre-existing `forged-peer-e2e` WebRTC-handshake assertions, which are unrelated to these query-string/glob dependency floors (`qs` is not even directly imported in `api-server/src`).

**Override-location reconciliation (June 13, 2026):** A subsequent review found the workspace was maintaining `pnpm` overrides in **two** places: root `package.json > pnpm.overrides` and `pnpm-workspace.yaml > overrides`. In this pnpm version (10.26.1) the two are **not merged** — when `package.json` declares a `pnpm.overrides` block, pnpm reads overrides **only** from `package.json` and silently ignores the `pnpm-workspace.yaml > overrides:` block entirely. This was confirmed two ways: (1) `pnpm-lock.yaml`'s recorded `overrides:` section listed only the three `package.json` entries (`path-to-regexp`, `ws`, `fast-uri`) and none of the workspace-file entries (`vite`, `lodash`, `picomatch`, `brace-expansion`, `postcss`, the binary-platform `'-'` exclusions); and (2) the platform binaries those `'-'` exclusions were meant to drop (`@esbuild/*`, `@rollup/rollup-*`, `lightningcss-*`, `@tailwindcss/oxide-*`) were still present in the lockfile. The CVE pins (`vite`, `lodash`, `postcss`, `picomatch`, `brace-expansion`) *appeared* satisfied only because natural resolution against this workspace's registry already lands on the patched versions — the overrides themselves were inert, so the protection was incidental rather than enforced, and any future registry change could have silently reintroduced a vulnerable transitive copy. **Fix:** every still-needed override from `pnpm-workspace.yaml > overrides` (the CVE floors above *and* the platform-binary `'-'` exclusions) was moved into root `package.json > pnpm.overrides`, and the now-empty `overrides:` block was removed from `pnpm-workspace.yaml`. Verification: `pnpm install --no-frozen-lockfile` re-resolves cleanly and `pnpm-lock.yaml`'s `overrides:` section now records all 91 entries (up from the original 3 — the two additional entries are the `qs` / `brace-expansion@<5.0.6` floors documented in the preceding paragraph); `pnpm audit` is unchanged (1 low / 2 moderate / 1 high — no previously-closed CVE re-surfaced); the binary exclusions now actually take effect (the non-`linux-x64-gnu` platform binaries dropped out of the lockfile, ~138 fewer snapshot lines). This reconciliation does **not** regress the `node scripts/regen-cve-appendix.mjs --strict` release gate: its sole remaining unmapped High/Critical row — `GHSA-gv7w-rqvm-qjhr` against `esbuild@0.27.3` — predates and is independent of this change (a newer esbuild advisory surfaced after the May 2 pass; the override moves did not alter the resolved `esbuild` version). This was confirmed by running `--strict` against the pre-reconciliation tree, where it fails **identically** on the same esbuild row. Triaging that esbuild advisory (bump to the patched `0.28.1` floor or map it into `AUDIT_LEDGER` as accepted dev/build-only residual risk) is tracked separately and is out of scope for this override-location reconciliation. The other remaining audit rows are likewise pre-existing and out of scope (`brace-expansion` on the `5.x` line via `eslint > minimatch`, which the `^2.0.0`-scoped override does not target).

**Build-time advisory disposition policy (accept-vs-fix).** A High/Critical `pnpm audit` advisory is **eligible for acceptance as residual risk** (rather than a forced override bump) when *all* of the following hold: (a) the dependency is **build-time-only** — it is not bundled into nor reachable from the `api-server` or `void-client` production runtimes; (b) the **specific vulnerable code path is not exercised** by VOID's invocation of the tool (e.g. a flaw in a module/entry point the project does not call); and (c) the exploit **precondition is outside VOID's threat model** (e.g. a compromised build host or hostile package registry rather than an attacker interacting with a deployed VOID instance). When an advisory qualifies, record it in the §R-0 ledger with an explicit **reversal trigger** and add an `AUDIT_LEDGER` entry so `scripts/regen-cve-appendix.mjs --strict` passes; otherwise fix it via a `package.json > pnpm.overrides` floor (capped to the patched line). This makes the release gate a reasoned-disposition checkpoint, not a bump-everything reflex that periodically churns or breaks the build. R-N7 (`esbuild`) was the first finding triaged under this policy — accepted as residual risk, then **closed** once the bump path was confirmed safe (see the §R-11 "Post-audit triage — `esbuild`" paragraph); acceptance is a first-class outcome, but the reversal trigger is meant to fire, and here it did.

**Post-audit triage — `esbuild` Deno-module RCE (R-N7, now CLOSED via override):** A High esbuild advisory surfaced on the lockfile after the `qs` / `brace-expansion` pass — **GHSA-gv7w-rqvm-qjhr** (no CVE assigned), "missing binary integrity verification in the Deno module enables remote code execution via `NPM_CONFIG_REGISTRY`", vulnerable `>=0.17.0 <0.28.1`, fixed `>=0.28.1` — plus a related Low, **GHSA-g7r4-m6w7-qqqr** ("arbitrary file read when running the development server on Windows", vulnerable `>=0.27.3 <0.28.1`, fixed `>=0.28.1`). Both findings were against a single resolved copy, `esbuild@0.27.3` at `artifacts/api-server > esbuild`, which is also the copy `esbuild-plugin-pino` peers against; `pnpm audit` reports no other esbuild instance in the workspace. **Original disposition (now superseded): accepted as residual risk, not fixed**, because esbuild is **build-time-only** here — `artifacts/api-server/build.mjs` imports esbuild's Node `build` API (`platform: "node"`, `bundle: true`) to produce the api-server bundle; esbuild is not shipped in, nor reachable from, the api-server or void-client production runtimes. The **High specifically affects the esbuild Deno module**, which VOID does not use, and its RCE precondition is a hostile npm registry during the build (`NPM_CONFIG_REGISTRY`) — a build-host-compromise threat, not a threat to a user interacting with a deployed VOID instance. The **Low** requires running esbuild's **dev server on Windows**; VOID calls the one-shot `build` bundler API (never the dev server) and does not build on Windows. Neither was reachable from VOID's bundler invocation. The acceptance was hedged on two bump risks: a `package.json > pnpm.overrides` floor for esbuild is **global** (also moving the client's Vite-managed esbuild), and `esbuild-plugin-pino@2.3.3` declares a narrow esbuild peer (`>=0.25.0 <=0.25.8`) that a `>=0.28.1` bump could break. **Closure (June 13, 2026 — the documented reversal trigger fired):** the bump path was re-examined and found clean, so the advisory is now **fixed**, not accepted. (1) The plugin's narrow peer was **already exceeded** by the prior global `esbuild: 0.27.3` override (which is outside `<=0.25.8`); pnpm treats it as an advisory-only peer warning, and `esbuild-plugin-pino@2.3.3` bundles the api-server cleanly against `0.28.1` — the build emits all four pino transport workers, confirming the plugin runs. (2) The "global blast radius" was not a new risk: the override was *already* global at `0.27.3`, so the client's Vite esbuild was already pinned by it; moving the floor to `^0.28.1` simply re-pins both to the patched line, and a full `void-client` Vite build succeeds. The override was therefore raised to `esbuild: ^0.28.1` in root `package.json > pnpm.overrides` (and the api-server's own declared `devDependencies.esbuild` range bumped `^0.27.3` → `^0.28.1` to match), resolving the single copy to `0.28.1`. Both the High and the Low close in lockstep (both fixed `>=0.28.1`). The R-N7 `AUDIT_LEDGER` entry was removed (the ledger is for unfixed High/Critical advisories; a fixed row vanishes from the appendix entirely, so a ledger entry would never render). Verification: `pnpm install --no-frozen-lockfile` re-resolves to `esbuild@0.28.1` cleanly; `pnpm --filter @workspace/api-server run build` succeeds (pino transports emitted); `void-client` Vite build succeeds; `node scripts/regen-cve-appendix.mjs --strict` exits 0 with no esbuild High/Low rows.

Four new findings are introduced:

- **R-N1 (High):** `path-to-regexp < 8.4.0` in production `express` dependency. Update to patched version.
- **R-N2 (Low):** ✓ CLOSED (May 2026, task #240) — `turnSecret.ts` now enforces `TURN_SECRET_MIN_LENGTH = 16` characters (post-trim) alongside the placeholder list; see §R-7.
- **R-N3 (Low):** ✓ CLOSED (Task #241). The relay-signal handler enforces a 64 KiB cap on `data.payload` (`RELAY_SIGNAL_MAX_PAYLOAD_BYTES`) with a silent return.
- **R-N4 (Low) — CLOSED (task #252, 2026-05-03):** ~~No CSP `report-to` / `report-uri` endpoint configured.~~ The same-origin `/api/csp-report` sink shipped at `artifacts/api-server/src/routes/csp-report.ts`, parses both Reporting-API and legacy report-uri shapes, per-IP rate-limited, structured-logged via pino, replies 204 unconditionally; round-trip test at `artifacts/api-server/src/__tests__/csp-report.test.ts`. Real-world violations against the served void-client HTML now surface in operator logs.

The one partially-mitigated original finding (M-04 / Lightning timing) is reclassified to **Low/Documented** on the basis of shipped jitter code (Task #226) plus honest threat-model disclosure. Each non-`✓ CLOSED` row in the §R-0 table now carries an explicit Re-eval column with a backstop date and the trigger events that would collapse the date to "now".

**Post-audit fixes (May 2, 2026, follow-up — task #254):** The §11 limitation 4 confidence-labels item ("`pnpm audit` output on the live lockfile at audit time" was unmeasured) is now closed by automation. `.github/workflows/pnpm-audit.yml` runs `pnpm install --frozen-lockfile && pnpm audit --json` on every push and PR to `main` (build-fail mode) and on a daily 13:17 UTC schedule (issue-creation mode plus optional webhook). The shared parser at `scripts/audit/parse-audit.mjs` cross-references each advisory against `scripts/audit/ignore-list.json` and classifies into surface / ignored-current / ignored-expired / orphan-expired buckets. The scheduled path runs `scripts/audit/sync-issues.mjs`, which de-duplicates issues by the `(cve + package + installedVersion)` triple stored in an HTML-comment marker in the issue body — a new triple opens an issue, an existing triple gets a comment, and a triple that has disappeared (dep bumped, advisory withdrawn) auto-closes its issue. The pnpm version is pinned to `10.26.1` in the workflow file; `parse-audit.mjs` rejects the pre-pnpm-9 array-shaped JSON loudly so a future pnpm major bump cannot silently break the parser. The ignore list ships with two entries — both `path-to-regexp` advisories that compose R-N1 — each carrying a written reachability rationale, an owner (task #239), and a `reEvalDate` of 2026-08-31 that matches the §R-0 R-N1 row. **The re-evaluation date is enforced**: on every run the parser fails (or surfaces an issue, depending on mode) for any ignore-list entry whose date has passed, regardless of whether the underlying advisory is still live, so a one-time risk-acceptance decision becomes a recurring obligation rather than permanent acceptance. The workflow file's header comment documents the Dependabot division of labour explicitly: Dependabot owns opening dep-bump PRs; this workflow owns release-time enforcement, daily lockfile-resident scanning, and re-eval-date discipline. Dependabot is not currently configured in `.github/dependabot.yml`; if turned on later the two systems do not collide because they touch different surfaces.

---

---

## 0. Summary table — Critical and High findings

| ID | Sev | Title | Location |
|---|---|---|---|
| H-01 | High | Socket.io `getSocketIp` reads leftmost X-Forwarded-For; per-IP connection cap and per-IP join-failure throttle are spoofable | `artifacts/api-server/src/socketHandlers.ts:148-160` |
| H-05 | High | Host JWT is not consumed at `create-room`; one paid invoice's JWT can be replayed to create many rooms within its window (paywall economics break) | `artifacts/api-server/src/socketHandlers.ts:179-275`; `artifacts/api-server/src/routes/paywall.ts` (JWT mint omits `paymentHash`/room binding) |

**Medium findings of note** (full details in §1–§10):

| ID | Sev | Title | Location |
|---|---|---|---|
| M-01 | Medium | Browser-to-browser handshake has no signed hello binding ECDH key to a per-session identity; silent decrypt-fallback to phrase key on ECDHE failure | `artifacts/void-client/src/lib/webrtc.ts:353-360, 373-416, 531-540` |
| M-02 | Medium | Empty-but-not-expired room can be claimed by any phrase-holder as host without a JWT, inheriting lock/knock/destroy/screen-share-reservation control | `artifacts/api-server/src/rooms.ts:354-360` |
| M-03 | Medium | URL fragment hygiene: `pushState` on leave preserves a fragment-bearing history entry; OS share-sheet exposes phrase to receiving apps | `artifacts/void-client/src/App.tsx:160, 186` |
| M-04 | Medium | Lightning paywall observability: invoice memo + tight settlement-to-room-create timing correlation enables payer-to-room linkage | `artifacts/api-server/src/services/lightning.ts:82` |
| M-05 | Medium → Fixed (#174) | Coturn `turnserver.conf` was committed with placeholder `static-auth-secret=YOUR_SECRET_HERE`; operator may run with weak secret. Fixed: file removed from repo, renamed to `coturn/turnserver.conf.example`, operator copy gitignored, and API server refuses to start when `TURN_SECRET` matches a known placeholder (`artifacts/api-server/src/lib/turnSecret.ts`). | ~~`coturn/turnserver.conf`~~ → `coturn/turnserver.conf.example` |
| M-06 | Medium | Dockerfile runs as root — *fixed in task #173 (production image)* | `Dockerfile` |

No Critical findings were identified within the constraints of a static audit. The previously-considered High findings around `relayOnly` server-enforcement (now M / Informational because the leak path is asymmetric — see §2.3) are recorded in their respective sections.

---

## 1. Cryptographic implementation

### 1.1 Phrase derivation — argon2id (m=64 MiB, t=3, p=1, fixed 32-byte salt)

> **Migration note (2026-04-30, task #176).** The original audit (paragraphs below the migration block) graded the PBKDF2-SHA256 / 600k-iteration design as *Informational, with a Medium foot-note for high-value rooms*. The recommended fix path was argon2id. That migration is now complete:
>
> - **Library.** `hash-wasm` 4.12.0, used in both surfaces (browser `void-client` and the Node API server). One library = one set of bindings = no risk of one runtime running argon2i while another runs argon2id, or one rejecting an output the other accepts.
> - **Single canonical primitive.** `lib/wire-core/src/argon2.ts` exports `ARGON2ID_ROOM_PARAMS`, `ROOM_DERIVATION_SALT`, and `deriveRoomBytesArgon2id(normalizedPhrase)`. Both surfaces import and call this exact function — there is no per-surface implementation that could drift.
> - **Parameters.** `m = 65,536 KiB (64 MiB)`, `t = 3`, `p = 1`, `hashLength = 48 bytes`. Sits at the conservative end of the allowed 64–128 MiB band, matches RFC 9106's second recommendation, and lands derivation near the ~1-second target on a 2019-era Android phone.
> - **Salt.** The 32-byte fixed `ROOM_DERIVATION_SALT` is reused verbatim from the prior PBKDF2 byte string. The "fixed salt is structurally correct here" reasoning below is unchanged: a per-room salt is either pointless (derived from the phrase) or model-breaking (server-negotiated). The salt is public regardless.
> - **Output layout.** Identical to the prior PBKDF2 layout: 48 bytes split as `roomId (16) || e2eKey (32)`. Downstream split logic was not changed.
> - **No fallback path.** There is no flag, no version-negotiation knob, and no degraded mode. If argon2id fails, the room cannot be entered. A peer running an old build cannot ask a peer running a new build to drop back to PBKDF2.
> - **Test vectors.** Fixed-phrase argon2id `roomId`/`e2eKey` byte strings are pinned by the test suite: a `(phrase, salt, params) → bytes` constant is checked against the underlying `hash-wasm` primitive so any library output drift surfaces immediately, and the production-parameter output is asserted to be bit-identical across the browser and Node `deriveRoomCredentials` paths. With the agent surfaces removed, these vectors exercise the single `lib/wire-core/src/argon2.ts` primitive.
> - **Cost change.** PBKDF2-SHA256 600k ≈ 2^19 hash-equivalent operations per guess. argon2id at m=64 MiB / t=3 ≈ 2^21–2^22 sequential hash-equivalent operations *and* a 64 MiB working set per parallel guess. The memory wall is the load-bearing change: GPU farms that ground the prior cost cheaply pay the dominant memory cost per attempt now. Re-classified to **Informational** with no journalist-with-informant foot-note: a state actor can still grind, but the per-guess cost is now dominated by memory bandwidth, not raw FLOPs.
> - **Limitation.** No real 2019-era Android benchmark was run from the dev container; the parameter floor was selected from the dev-container measurement (`m=64 MiB / t=3 / p=1` ran ~360–415 ms on a Linux x64 / Node 24 machine). Mobile devices typically run 2–4× slower, so ~1 s on the target device is the expected upper end. If subsequent on-device measurement shows budget headroom, raising to `m=128 MiB` is a single-constant change in `lib/wire-core/src/argon2.ts` (and a deliberate re-vector pass through the test vectors above).
>
> The original PBKDF2 audit narrative is preserved verbatim below for historical context.

`artifacts/void-client/src/lib/voidPhrase.ts` derives `roomId || e2eKey` from a normalized 6-word BIP-39 phrase via PBKDF2-SHA256, 600000 iterations, fixed all-zero (or fixed constant) 32-byte salt. The two outputs are then split by HKDF info-string (`VOID-ROOM-ID-v1`, `VOID-E2E-KEY-v1`).

- **Fixed salt is structurally correct here.** The phrase is the *only* shared secret between two participants who never talk to the server and never reveal an identity. A per-room salt would have to be either (a) derived from the phrase itself (pointless — gives no extra entropy) or (b) negotiated server-side (defeats the model — server learns a per-room value that links to a room ID). The current design is right.
- **Cost.** ~66 bits of phrase entropy + 600k PBKDF2 iterations puts brute force at roughly 2^85 effective operations, against an attacker who already knows what room they are attacking. Adequate against everyone in the documented adversary model except a state actor doing dragnet GPU farms over a recovered ciphertext archive — which the adversary model includes. **Worth recording: even the 600k cost is not enough against well-funded offline attack of recorded ciphertexts if the room is high-value.** Fix paths: argon2id; or accept the limit and document it as such.
- **Severity:** Informational (with a foot-note: re-classify as Medium for the journalist-with-informant use case, where attackers may sit on captured ciphertext for years and grind it on whatever hardware exists later).

### 1.2 ECDHE — P-384, raw export, HKDF-SHA256 with all-zero salt

`artifacts/void-client/src/lib/signalCrypto.ts` uses `crypto.subtle.deriveBits({name:"ECDH",public:remotePub}, privKey, 384)` followed by HKDF-SHA256 with a 32-byte all-zero salt and an info string per derivation. Public keys are exchanged as raw 96-byte buffers, base64url-encoded.

- **HKDF salt**: All-zero salt is fine when the IKM is itself high-entropy (an ECDH shared secret meets that bar). RFC 5869 explicitly allows it. Not a finding.
- **Domain separation**: Distinct info strings (`VOID-ECDHE-v1`, `VOID-SAS-v1`) cleanly separate the AES-GCM key from the SAS bits derived from the same shared secret. Correct.
- **Public key validation**: WebCrypto's `importKey("raw", …, "ECDH P-384")` performs point-on-curve validation. The implementation does not need to do anything additional. The Node SDK uses the same WebCrypto path.
- **Key zeroization**: `deriveSessionKey` calls `new Uint8Array(sharedBits).fill(0)` on the raw shared bits before returning. The session `CryptoKey` itself is non-extractable. The phrase-derived key bytes are not explicitly zeroed — see 1.6.
- **Severity:** Informational.

### 1.3 SAS — 22-bit security, no commitment scheme, dependent on out-of-band comparison

The SAS is two BIP-39 words derived from 32 HKDF-SHA256 bits over the ECDH shared secret. Two 11-bit indices = ~22 bits of search space, with effective security closer to 2^21 once you allow phonetic confusables.

The right framing, per the threat-model section of task #167: **the question is not "is 22 bits enough?" — the question is whether the handshake binds each peer to its public key before the other peer's key is observable, so the attacker cannot grind an MITM ephemeral keypair until the SAS matches.**

In `artifacts/void-client/src/lib/webrtc.ts`:
- ECDHE messages are sent inside `relay-signal` envelopes that are *encrypted with the phrase-derived AES-GCM key*. An MITM who does not know the phrase cannot read the keys, cannot forge them, and cannot grind.
- An MITM who *does* know the phrase has no need for an MITM — they are already a peer.
- There is **no signed `hello` envelope on the browser side that binds an Ed25519 (or other) identity key to the ECDH public key**. The peer-to-peer `hello` binding that exists in the agent SDK (see 5.3) does not exist here.

This is not as bad as a textbook ECDHE-without-commitments because the phrase-encrypted envelope effectively *is* the commitment. But the current claim documented in `VOID_TECHNICAL_OVERVIEW.md` ("SAS provides assurance against MITM") is only true *because* the phrase is also the encryption key for the handshake. Anyone who learns the phrase by any out-of-band means (shoulder-surfing the screen, a logged sharing app, an OS-level keylogger on the joiner) breaks every property at once.

A separate, smaller issue: `webrtc.ts` line 388 has a silent fallback during `handleRelay` where, if decrypting with the per-pair session key fails, the code retries with the phrase-derived key. The `if (this.e2eKey) { try { performKeyExchange } catch {} }` pattern in `initiateOffer` and `attemptIceRestart` does the same. These are loud-fail-becomes-silent-fallback paths. They mean a peer who briefly cannot reach an ECDHE-completed peer continues to use the phrase key (shared by every peer in the room), not a per-pair forward-secret key. Per-pair forward secrecy is not maintained on a transient failure.

- **Severity:** Medium. Tracked here as **M-01**. (Initially scored High; downgraded because the phrase-encrypted handshake envelope is itself the commitment for any attacker who does not know the phrase, and an attacker who *does* know the phrase already has full peer status. The Medium reflects two real defense-in-depth gaps: per-pair forward secrecy is silently abandoned on transient ECDHE failure, and there is no signed binding between an ephemeral identity key and the ECDH public key on the browser side, even though one exists in the agent SDK.)
- **Status (published copy):** Fixed in Task #170. The browser now publishes a signed `hello` envelope (Ed25519 over the ECDH public-key fingerprint, room ID, and a freshness nonce) and verifies the counterpart's envelope before encrypted media flows. The three silent decrypt-fallback paths in `webrtc.ts` (`initiateOffer`, `handleRelay`, `attemptIceRestart`) were replaced with explicit teardown plus a red overlay on the affected peer's tile; per-pair forward secrecy is no longer silently downgraded to the room-wide phrase key.
- **Recommended fix:** (a) Add a signed `hello` envelope on the browser side mirroring the SDK design — Ed25519 identity key, signed payload binds the ECDH public key fingerprint, identity key fresh per session is acceptable (the binding alone is the value, not long-term identity). (b) Replace the silent-catch fallbacks with explicit close + user-visible error.

### 1.4 AES-GCM — IV uniqueness per key

`signalCrypto.ts` uses a fresh 12-byte random IV per `encryptSignal` call (`crypto.getRandomValues(new Uint8Array(IV_BYTES))`). For a single ECDHE-derived session key, the probability of collision over ~2^32 messages is ~2^-33, well below the safety bound for AES-GCM (recommended < 2^32 messages per key).

For the phrase-derived `e2eKey`, the same key may be reused for relay messages across the entire 65-minute room lifetime by every peer in the room. Each peer generates IVs independently. Volume per room is small (signaling only — handshake plus ICE candidates), so collision probability remains well under the GCM bound, but it is shared across peers, which broadens the IV namespace. No finding, but worth noting that the security argument depends on signaling staying low-volume.

- **Severity:** Informational.

### 1.5 Timing-safe comparison

JWT verification is delegated to `jsonwebtoken`, which uses `crypto.timingSafeEqual` internally. Recovery codes (`paywall.ts`) are looked up by direct map key without per-byte comparison; the lookup time leaks only existence vs non-existence, which is fine because the response payloads are identical until the secret check. Bearer-style strings are not compared character-by-character anywhere in user code.

- **Severity:** Informational.

### 1.6 Key zeroization

- ECDH shared bits: zeroed in `deriveSessionKey`. Good.
- ECDH private key: WebCrypto-managed, non-extractable. Good.
- Session `CryptoKey` and phrase-derived `e2eKey`: stored as `CryptoKey` references on the `WebRTCManager` instance. Garbage collected when the manager is torn down on leave. Not explicitly nulled. The browser may retain the key material in WebCrypto's internal store until the `CryptoKey` is no longer referenced.
- The phrase string itself sits in component state on `RoomPage` and in the URL fragment. Fragment is cleared on leave (see 4.1), but the JavaScript string is reachable from the React tree until the route unmounts.
- **Severity:** Informational. JavaScript-level zeroization of strings is not meaningfully achievable; the meaningful fix is to scope the phrase string to the smallest possible callee chain.

---

## 2. Signaling and WebRTC layer

### 2.1 No signaling content reaches the server in plaintext after the phrase channel is established

Verified by reading `artifacts/api-server/src/socketHandlers.ts` and `artifacts/void-client/src/lib/webrtc.ts`:

- The server-side `relay-signal` handler validates `code`, `toPeerId`, and `fromPeerId` are strings, then forwards `payload` to the target socket. It does not parse `payload`.
- The client encrypts every signaling payload (`offer`, `answer`, `ice`, `key-exchange`) with either the phrase key (early) or the session key (post-ECDHE) before passing to `socket.emit`.
- SDP and ICE candidate strings only exist on the wire as AES-GCM ciphertexts.

**Caveat:** the server still sees the *envelope* — the room code, the `from`/`to` peer IDs, and packet timing. Peer count, room duration, join/leave timing, and signaling cadence are observable from the server side and from any TLS observer who can correlate flows. This is documented; it is not a finding, but it bounds what "end-to-end encrypted" can mean.

### 2.2 Server cannot inject a forged peer that existing peers accept

A forged peer would have to:
1. Connect to the signaling server.
2. Be accepted into the room — gated by `joinRoom` which requires knowing the room code (which is derived from the phrase via argon2id m=64 MiB / t=3 / p=1; brute-forcing requires phrase knowledge — see §1.1 for the cost analysis).
3. Complete the ECDHE handshake — needs to encrypt a `key-exchange` message with the phrase key.

Without the phrase, a forged peer cannot reach step 2 (cannot derive the room code) or step 3 (cannot encrypt the handshake). A signaling server that is itself the attacker can drop and reorder messages but cannot mint phrase-encrypted ciphertexts. **This holds.**

The narrower question — can the server inject *itself* as a peer? — reduces to: can the server learn the phrase? Per the model, no.

### 2.3 ICE candidate handling and IP leakage with `relayOnly: true`

`relayOnly: true` is passed to `RTCPeerConnection({iceTransportPolicy: "relay"})` in the browser. Browsers honor this by refusing to gather host or srflx candidates and refusing to use them if the remote sends them. The server cannot weaken this client-side policy.

But: the policy is set client-side per `RTCPeerConnection`. **The server stores `relayOnly` on the room and returns it to joiners**, who use it to construct their own `RTCPeerConnection`. A malicious joiner can ignore the returned value and pass `relayOnly: false` to their local PeerConnection. They will then gather host/srflx candidates and send them. The honest peer's PeerConnection, which is `relayOnly: true`, will refuse to use them — so the honest peer's IP is still not leaked to the malicious peer.

**However:** the malicious peer's *candidates* are visible to any honest peer at the SDP/ICE message level (encrypted to the room) and to the malicious peer themselves. More importantly, an honest peer who naively trusts the room-creator's `relayOnly` claim and drops the policy on their own end *because the room is "relay-only"* would leak. The current code does not appear to drop the policy — it constructs the PeerConnection with the policy each peer received from the server. So the leak path is asymmetric: a malicious peer can leak *their own* IP to other malicious peers in the same room, which is a non-event. They cannot trick the honest peer into leaking. Confirmed by reading `webrtc.ts` ICE setup.

This is the *write* asymmetry: a creator's `relayOnly` declaration is recorded on the room state but not re-validated when joiners construct candidates. If a future change ever began enforcing relay-only by, e.g., dropping non-relay candidates server-side, the asymmetry would become a real leak path.

- **Severity:** Informational, with a Medium **operator-documentation** finding attached: README-selfhost.md describes `relay-only` as "supported", which a deployer may read as "server-enforced". It is not. A self-hoster who needs hard relay-only must rely on the browser policy on every endpoint they trust, or run a TURN-only deployment with no STUN reachability. (See §10.3.) This was previously tracked as H-04; the impact analysis above does not support High.

**Updated 2026-05-02 (Task #260):** when VOID is loaded over a Tor `.onion` origin the client now defaults to relay-only at three layers — the host's preview-gate toggle is pre-checked and gated behind a confirmation modal that names the IP-leak consequence; joiners arriving from a `.onion` see an inline warning when the room they are about to enter was created with relay-only off; and `RoomPage` initialises `iceTransportPolicy` to `"relay"` whenever the origin is `.onion`, so every PeerConnection this client constructs is built relay-only regardless of the room's server-side flag. A teal `CONNECTED VIA TOR ONION` indicator is shown on the start screen and inside the call so the user can confirm the override is engaged. The local enforcement deliberately overrides the room setting: a Tor user cannot accidentally leak their clearnet IP into a room that some prior host left non-relay-only.

### 2.4 SDP munging — Opus bitrate clamp, mono forcing

`webrtc.ts` regex-replaces `a=rtpmap:111 opus/48000/2` with `a=rtpmap:111 opus/48000/1` and adjusts `b=AS:` lines. The regex operates on strings the local browser produced, never on remote-supplied SDP. There is no path where attacker-controlled SDP is munged and re-emitted. The munging is safe because the input is local.

If munging were ever applied to remote SDP (it is not, currently), regex-based mutation of attacker-controlled text would be a source of injection. Worth a comment in the file.

- **Severity:** Informational.

### 2.5 Screen-share two-phase reservation

`rooms.ts` implements `reserveScreenShare` → `confirmScreenShare`/`cancelScreenShare` with a server-side timer that auto-cancels stale reservations. Each call checks `room.screenShareReservation === null` (or matches the requesting socket) before proceeding. The reservation timer holds a `setTimeout` ref so multiple races over a 60-second window resolve to one winner.

A reservation hijack would require a peer to predict another peer's `reserveScreenShare` race window and arrive first. The window is server-side and short; the eventual outcome (one peer screen-shares) is symmetric in the threat model. PROPOSED task #57 (rate-limit screen-share requests) is the correct further hardening.

- **Severity:** Informational. Already tracked as #57.

### 2.6 BURN flow

`webrtc.ts` `cleanup()` closes all `RTCPeerConnection` instances, stops all `MediaStream` tracks, terminates the AudioWorklet node, and discards WebGL resources. Sockets are disconnected. `RoomPage.tsx` unmounts on leave, dropping component state. There is no path on the client where media continues to flow after `cleanup()` — verified by tracing `pcs`, `senders`, `localStream`, and `audioContext` references.

Two reservations:
- The browser may continue to hold `getUserMedia` permission (camera light) for a short window while the OS-level capture device shuts down. Visible to the user; not a security leak.
- Service worker (`sw.js`) excludes API and Socket.io paths from caching; verified at lines 35-72. So a poisoned service worker cannot intercept signaling. The SW does cache the static shell. A compromised SW could serve stale code; mitigated by `cache-control: no-cache` on the shell and by SW `skipWaiting`/`clientsClaim` on update.

### 2.7 Host post-leave surveillance — server-retained state

This is the question the task explicitly broadens: not "can the host re-tap the live stream after leaving" (no — see 2.6) but "what server-retained state preserves a record of which peers were in the room with the host, recoverable by a subsequent host action?"

Reading `artifacts/api-server/src/rooms.ts`:

- The `RoomState` object holds `users: { socketId, peerId }[]`, `hostSocketId`, `locked`, `lockedBy`, `knockMode`, `knockModeBy`, `pendingKnocks`, `screenShareReservation`, `activeScreenSharePeerId`, plus timer refs.
- On the *last* peer leaving (`users.length === 0`), `leaveRoom` clears `hostSocketId`, `locked`, `lockedBy`, `knockMode`, `knockModeBy`, and `pendingKnocks` (`rooms.ts:475-484`). It does not delete the room itself — the room remains for the host to rejoin until the per-room TTL.
- The cleared room retains: `roomType`, `tier`, `relayOnly`, `createdAt`, `expiresAt`, `expiryTimer`. None of these encode peer membership.
- A subsequent host rejoin finds an empty `users` list and a null `hostSocketId`. The first joiner becomes the host (`rooms.ts:356-358`). No log of prior peer pseudonyms is exposed.

There is no `peerHistory`, no `lastSeenPeers`, no log of who was in the room. Verified. **A host who rejoins after the room emptied cannot recover peer membership history.**

Three caveats:

1. While the room is non-empty and the host disconnects briefly (network blip), peer pseudonyms remain in `room.users` because they are still connected. A host rejoin retrieves the current snapshot. This is not "recovering history" — it is the live state. Acceptable.

2. **M-02 (host-role transfer):** because a rejoin to an empty room sets the joiner as host without a JWT check, the "host role" can transfer to any phrase-holder. This is an elevated-privileges issue *within the phrase-holder trust group*, not a peer-history disclosure issue. The room moderation primitives (lock, knock-mode, screen-share-reservation, destroy) all gate on `isRoomHost(socketId)`. A phrase-holder who is *not* the original payer can therefore destroy the room, kick others, or take the screen-share lock. Severity: Medium because every actor in this scenario already shares the phrase (and therefore already has full read/write peer access). It would be Critical only if the trust model said "phrase-holder ≠ host". It does not — the documented model is that the phrase grants room access, and the first-joiner-is-host rule is part of the model. Recommended mitigation: bind the host role to the JWT's `paymentHash` (when H-05 is fixed) and require the rejoining host to present the original JWT. **Status (published copy):** Fixed in Task #171. `room.hostPaymentHash` is set on create; on rejoin to an empty room, host is granted only when the rejoining socket presents the creation JWT (or a valid extension JWT) whose `paymentHash` matches.

3. The Socket.io server itself logs nothing by default in the current configuration, but the underlying engine library or any added middleware (e.g. Express request logger) could capture envelope metadata — connection IPs, room codes, peer IDs. The server code does not install such logging today. Operator policy could.

### 2.8 Knock approve/deny race

`approve-knock` and `deny-knock` are gated by `isRoomHost` and pop the matching pending knock from the array. Two hosts cannot both approve the same knock because there is at most one host. A host cannot accidentally approve and then immediately the knocker re-knocks faster than the room state updates because the knocker's first knock leaves them in the "knocking" room until the approve handler explicitly migrates them. No race observed.

If a knocker disconnects between sending the knock and being approved, the approve handler tries to look up `result.knock.socketId` and finds an empty socket; the operation succeeds but the resulting `emit` lands on no one. Not a security finding; a small UX gap.

---

## 3. Server-side hardening

### 3.1 Rate limits — per-IP counts and bypass

`socketHandlers.ts` enforces `MAX_CONNECTIONS_PER_IP = 50` and a per-IP join-failure throttle. Both call `getSocketIp(socket)`:

```
function getSocketIp(socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    return first || socket.handshake.address || "unknown";
  }
  return socket.handshake.address || "unknown";
}
```

This reads the **leftmost** X-Forwarded-For token, which is attacker-controlled (the client supplies whatever they want in that header; the trusted reverse proxy *appends* the real client IP, putting it on the right). A single attacker rotating arbitrary leftmost tokens bypasses both per-IP limits.

Compare `routes/ice-servers.ts:17-30`, which correctly comments and uses `req.ip` (Express, `trust proxy = 1`, returns the rightmost token). The HTTP path is right; the Socket.io path is wrong.

- **Severity:** High. Tracked as **H-01**.
- **Status (published copy):** Fixed in Task #168. A shared `getTrustedClientIp(socket)` helper now derives the client IP from the rightmost X-Forwarded-For entry honoring `app.set("trust proxy", 1)`. Both the Socket.io middleware and the HTTP routes route through this single helper; an attacker-supplied leftmost token can no longer impersonate a different client IP.
- **Recommended fix:** mirror the HTTP path. Trust the rightmost X-Forwarded-For token (Express `trust proxy` gives this for free if you call `req.ip` after attaching the Express adapter; for socket.io, walk the header right-to-left honoring the same hop count). Either compute the trusted client IP once at the connection layer, or replicate the rightmost-token logic in `getSocketIp`.

### 3.2 JWT validation — signature, expiry, algorithm pinning

`paywall.ts` issues JWTs via `jsonwebtoken.sign(payload, secret, { expiresIn })` and validates via `jsonwebtoken.verify(token, secret)`. The `verify` call uses default algorithms — when `secret` is a string, `jsonwebtoken` accepts only HS-family algorithms (HS256/HS384/HS512). It will reject `alg: none` and reject RS256 against a string key (no public key). So the HS/RS confusion attack is structurally blocked.

That said, **passing `algorithms: ["HS256"]` explicitly is a one-line hardening** that costs nothing and pins behavior against future library default changes. Currently absent.

Replay: paywall maintains `consumedExtensionTokens` to prevent **extension**-token JWT reuse (single-use enforced for `extend-room`). **The room-creation JWT path is not single-use.** Re-reading `socketHandlers.ts:179-275`, the `create-room` handler calls `jwt.verify` and then `roomExists(data.roomId)` — but the `roomId` is supplied by the client and the JWT payload contains no `paymentHash` or `roomId` binding (see `paywall.ts` JWT mint: only `{ authorized, tier, exp }`). A host who paid one invoice can create one room, leave, derive a fresh phrase locally, and call `create-room` with the same JWT and the new room ID, repeatedly, until the JWT expires (60 minutes for `standard`, 24 hours for `day`).

The per-socket `create-room` rate limit is `{ max: 10, windowMs: 60_000 }`. Within a single `standard` window an attacker can therefore create up to ~600 rooms from a single paid invoice. Within a `day` window, ~14,400. This breaks the documented "one payment = one room" economic model and is a memory-exhaustion vector on top.

- **Severity:** High. Tracked as **H-05**.
- **Status (published copy):** Fixed in Task #169. The JWT now carries `paymentHash` in its payload; `create-room` rejects any JWT whose `paymentHash` is already in `consumedRoomCreationTokens` (TTL-bounded, mirrors the existing `consumedExtensionTokens` design). `jwt.verify` is pinned to `algorithms: ["HS256"]` on this path. One paid invoice produces one room; replay is rejected with a user-visible error.
- **Recommended fix:** (a) Mint the JWT with `paymentHash` in the payload at `paywall.ts:status` time. (b) On `create-room`, maintain `consumedRoomCreationTokens: Map<paymentHash, expMs>` mirroring the existing `consumedExtensionTokens` design, and reject `create-room` if the `paymentHash` was already consumed. (c) Or: bind the JWT to a specific `roomId` at recovery/status time when the client commits to a phrase. Option (b) is closer to the existing pattern and minimally invasive. (d) Independently, pin `algorithms: ["HS256"]` explicitly on `jwt.verify`.

### 3.3 Dev-pay endpoint disabled in production

`paywall.ts` only mounts `POST /api/paywall/dev-pay/:paymentHash` when `process.env.NODE_ENV !== "production"`. Verified. The README-selfhost guide warns about this at three separate points, including a hard "this is a serious problem on a public server" callout. Adequate. A second-layer check inside the route handler — so a misconfigured environment-ordering during boot still cannot accidentally mount the endpoint — is a small additional hardening.

- **Severity:** Informational.

### 3.4 Lightning adapter — SSRF

`services/lightning.ts` issues `fetch(LNBITS_URL + "/api/v1/payments")` and `fetch(BTCPAY_URL + "/api/v1/stores/...")`. Both URLs come from env vars set by the operator. There is no path where a client request can influence these URLs at runtime.

If an operator misconfigures `LNBITS_URL=http://169.254.169.254/`, the server will obediently fetch instance metadata. This is the operator's problem, not a code-level vulnerability — but adding a startup-time URL validator (reject internal/private/metadata IPs unless explicitly opted in) would be a reasonable hardening.

- **Severity:** Informational.

### 3.5 In-memory `Map<string, RoomState>` — memory exhaustion

`createRoom` is gated by `paywallRequired` (a valid JWT). The naive expectation is "to create N rooms, an attacker needs N paid invoices" — but per **H-05**, a single paid JWT can be replayed to create up to ~600 rooms within its window (`standard` tier) or ~14,400 (`day` tier). Combined with the lack of a server-side total room cap, this is a one-paid-invoice memory-exhaustion path. In production with a real Lightning backend, the *first* room costs sats; subsequent ones, until JWT `exp`, do not. In dev mode, `dev-pay` makes the cost zero from the start.

`relay-signal` payload size: not capped. A peer can emit large `relay-signal` envelopes; the server forwards them. The other peer would reject them at decryption (oversized garbage will not decrypt). Memory pressure is bounded by Node's per-message buffer for the ws engine. **A flood of large signaling payloads from a paid peer could pressure the server's memory and the recipient's** — this is not a confidentiality bug but a resilience gap.

- **Severity:** Low (resilience). Recommend per-message size cap on `relay-signal`.

### 3.6 Room ID enumeration and prediction

Room IDs are derived from the phrase via argon2id, taking the first 16 bytes of the 48-byte derived material (the equivalent of the prior PBKDF2 + HKDF-info `VOID-ROOM-ID-v1` split — see §1.1). Documented entropy from the phrase: ~66 bits. To find a valid room by guessing room IDs, an attacker would have to guess a phrase (since the room ID space is sparse compared to 256-bit hash output). **Effective entropy is the phrase entropy, not the hash output size.** 2^66 with argon2id at m=64 MiB / t=3 makes targeted brute force infeasible for typical attackers and substantially more expensive for state actors than the prior PBKDF2-600k design (see §1.1 cost-change row).

- **Severity:** Informational; classification depends on attacker resources.

### 3.7 Wrong-phrase vs no-peer side channel — timing

The signaling server cannot distinguish "wrong phrase" from "no peer in the room you targeted" because it never sees the phrase. From the server's view: a join attempt with a derived room code that does not exist returns "room not found" immediately. A join attempt with a code that exists returns the (encrypted) peer list. A peer with a wrong phrase will reach a real room and fail at the ECDHE step (cannot encrypt the handshake), which the server cannot observe. **No server-side timing channel for phrase correctness exists.**

Client-side: a wrong-phrase guesser learns "this room does not exist" instantly, "this room exists but I cannot complete handshake" after ~10s. That is observable to a network attacker too. The only fix is to equalize the failure path; the cost is a 10s delay on legitimate "no such room" responses, which would degrade UX. Not recommended.

- **Severity:** Informational.

### 3.8 Lightning paywall observability

`services/lightning.ts` LNbits adapter sets the invoice memo to the literal string `"VOID — 1h video session"` (line 82). This memo is identical for every room — good for unlinkability across rooms (no per-room identifier travels with the invoice), bad in the sense that it labels the payment as "VOID-related" to anyone who can read invoice metadata in transit or at rest.

Observable to a sufficiently positioned attacker:
- The host's Lightning node IP (or the IP of whatever wallet they pay from).
- The receiving node identity (the operator's LNbits/BTCPay Lightning node).
- The settlement timing: a Lightning payment confirms, then within ~milliseconds the room becomes joinable. A passive observer who can correlate the operator's Lightning node settlements with HTTPS traffic to the VOID server can match (payer-IP, room-creation-event) tuples.
- Routing-node observers along the payment path may see the route and (in some configurations) the payment hash.
- BTCPay path: the invoice ID is not the Lightning payment hash; verified at line 164. So payment-hash-to-VOID-room linkage is structurally weakened on BTCPay vs LNbits, where the LN payment hash *is* the room identifier in the API map.

Mitigations not present in the original code at audit time (April 2026):
- No randomized delay between settlement and room availability. A 10–60s jitter would weaken the timing-correlation match.
- No support for hold-invoices.
- No support for paying via an LSP that obscures the source.

Operator can deploy Lightning behind Tor/I2P routing for the receiving side; the payer side is up to the payer's wallet.

- **Severity:** Medium for the paying host's pseudonymity claim. The operator-side payment-route observability is documented in `README-selfhost.md` *partially* but not as a privacy claim. Either fix in code (jitter + hold-invoice option) or surface clearly in the threat-model page as a limitation. Silence is the wrong choice.
- **Status (published copy):** **Mitigated in code + documented limitation.** Task #226 shipped a uniformly-random 10–60 second jitter (`PAYWALL_JITTER_MIN_MS` / `PAYWALL_JITTER_MAX_MS`, opt-out `PAYWALL_JITTER_DISABLE=1`) between settlement and the moment `/paywall/status` returns `paid: true` with a token (`artifacts/api-server/src/routes/paywall.ts`); the token and `expiresAt` are computed at settlement so the paid window the host purchased begins at settlement, not at delivery. Hold-invoice and LSP-pay paths have not shipped — and would not be appropriate to backstop in code without a separate design pass — so the residual surface is disclosed in plain language on the user-facing threat-model page (item §2 — "THE LIGHTNING PAYMENT IS OBSERVABLE ON THE LIGHTNING NETWORK") and at `docs/threat-model.md` §2. The page names the temporal-correlation surface, explains who it matters for (a host whose Lightning identity is known to an adversary watching the operator's invoice timing), and lists the operator-side mitigations available today (Tor-routing the payment, using a wallet that doesn't know the user, having a third party pay, self-hosting on the host's own LNbits/BTCPay node). The original audit explicitly accepted "documented as a known limitation in the threat-model page in plain language" as one of two correct outcomes for this finding; the May 2026 re-audit took an explicit position that the shipped jitter plus the disclosure together satisfy that bar. Re-eval criteria for this row are summarised in the §0 status table.

### 3.9 Constant-time secret-compare sweep (task #257) — superseded in part by #264

This section records the residual deliverables of task #257. The bulk of #257's planned scope (the `lib/secrets/` convention path, the brand-typed marker for secret values, and the CI guard against `===` on secret-imported identifiers) was overtaken by task #264 (R-9.12), which landed first and shipped a strictly stronger implementation: a real `Brand<"Secret">` type at `lib/wire-core/src/brand.ts`, declaration-site branding for every secret value in the workspace, and a type-aware ESLint rule (`@workspace/secrets/no-secret-equality`) that follows the brand through the type-checker rather than through a regex over import identifiers. The grep-based guard #257 contemplated would have been a strict subset of what R-9.12 already enforces, so it was not landed as part of #257; the convention-path package was likewise not landed because its only role would have been to seed the grep guard.

**What #257 did ship that is not duplicated by #264:**

- A shared `timingSafeStringCompare(a, b)` helper (UTF-8 encode both inputs, zero-pad to the longer length, run `crypto.timingSafeEqual` over the equal-length buffers, fold the length match into the result) shipped under the agent-protocol package with unit tests but no in-tree caller. It was removed in v0.6 together with that package; the canonical safe-compare for already-`unwrapSecret()`-ed buffers remains `crypto.timingSafeEqual` directly.
- Comment tightening at `artifacts/api-server/src/rooms.ts` (the `getRoomState` doc-block) and `artifacts/api-server/src/routes/room-state.ts` (the route preface). Both now state explicitly that the equalization on the null path is *codepath-shape* equalization — the equalized branches are the three `return null` arms inside `getRoomState`, against a non-secret `Date.now()` integer and a joiner-derived public room code — and that there is no secret-vs-secret string comparison on this path. This is why neither site uses `timingSafeStringCompare`: the helper would not fit the situation. The comments cross-reference this section so a future reader who sees a missing `timingSafeStringCompare` call doesn't conclude an oversight.

**Inventory verdict (carried forward; no code migrations needed):**

The sweep confirmed — and #264's branding work corroborated — that the server has very few secret-vs-secret short-circuit string compares. Every secret-class flow routes through one of the structurally constant-time primitives:

- Paywall JWT verification — `jwt.verify` delegates to `crypto.timingSafeEqual` on the HMAC tag inside `jsonwebtoken`. All three call-sites in `socketHandlers.ts` pin `algorithms: ["HS256"]` (per R-2). No raw JWT string compare exists in user code.
- TURN HMAC — generated from `TURN_SECRET`; never compared on the server side. The TURN server itself does the credential check.
- Signed-hello signatures — verified via `ed25519Verify` (Node `crypto.verify`) and `crypto.subtle.verify`. Both are constant-time at the library level.
- `paymentHash` flows — most server-side uses are a `Map.has` / `Map.get` / `Set.has` lookup (`consumedExtensionTokens`, `consumedRoomCreationTokens`, `recoveryCodes`). Per §1.5, these leak existence vs non-existence only, which is the intended behavior; the `paymentHash` value is a capability the holder already knows. The one exception is host reclaim (`claimHost`): as of the reclaim-token-at-rest change (Task #886, superseding the keyed-HMAC-of-`paymentHash` of Task #882) `hostReclaimTokenHashes` stores `HMAC(PAYWALL_SECRET, reclaimToken)` of a per-room **reclaim token** decoupled from the Lightning `paymentHash`, never any payment-derived value, and reclaim does a full-scan `crypto.timingSafeEqual` of the candidate's HMAC against each stored HMAC (no early-exit, fixed 64-hex length). That is a deliberate per-byte constant-time compare — not a hash-table key compare — so add/seed still uses `Set.has` but reclaim does not short-circuit on a prefix. Because nothing payment-derived is stored, a seized `data/rooms.json` cannot be correlated against a Lightning backend's settlement records **even by an operator who holds `PAYWALL_SECRET`**.
- Recovery codes — `paywall.ts` looks them up via `recoveryCodes.get(code)` after `normalizeRecoveryCode` (whitespace trim + lowercase + BIP-39 wordlist `Set.has`, where the wordlist is public). The lookup is a hash-table key compare, not a per-byte equality of the secret against any other secret string.
- `PAYWALL_SECRET` / `TURN_SECRET` startup placeholder guards — `placeholders.includes(normalized)` against a finite public placeholder list, in a startup-only path with no remote attacker observer. Not a per-request hot path; deliberately not migrated.

The two acknowledged sites in the original #257 task body — `rooms.ts:367` and `room-state.ts:41` — were not byte-compares of secrets; they are *codepath shape* equalization between the three null branches of `getRoomState`. The comments at both sites have been tightened to spell that out, with an explicit pointer back to this section.

**Rate limit — proof-page-as-scraping-oracle (closed).** `GET /api/room-state/:code` (the backend behind the `/proof/server-state` "what the server sees" page) is now per-IP rate-limited to 10 requests/IP/minute; over-limit requests get `429 { error: "RATE_LIMITED" }`, matching the wire shape used by `/api/ice-servers`. The limiter mirrors the self-contained per-IP bucket pattern in `ice-servers.ts` (`req.ip`/trust-proxy-aware client-IP derivation; window/max as named constants `RATE_WINDOW_MS`/`RATE_MAX`, shared as the single source of truth with the doc and the test). Unguessable 128-bit room codes already make blind enumeration impractical, but an attacker who has harvested a set of real codes (shared links, logs, referrers) could otherwise hammer this endpoint to track those rooms in real time — turning the transparency tool into a scraping oracle. The per-IP ceiling closes that vector while never affecting normal manual proof-page use (a person pasting one code and reading the JSON), in the same spirit as the CSP-report endpoint's "always replies 204 so the endpoint cannot be used as an oracle" mitigation. Over-limit (429) coverage lands in `artifacts/api-server/src/__tests__/room-state-route.test.ts`.

**Why no wall-clock-variance test:**

> A wall-clock-variance microbenchmark for `timingSafeStringCompare` was considered and rejected. The helper is a thin wrapper over `crypto.timingSafeEqual`, whose constant-time guarantee is the load-bearing primitive — re-asserting that guarantee from a Vitest microbenchmark is both noisy (sub-microsecond per-op times are dominated by V8 JIT, GC, and OS scheduling jitter, not by the algorithm) and tautological (we would be testing Node's libuv/openssl behavior, not our code). The existing coarse `room-state-timing.test.ts` regression check covers the *only* place where we deliberately equalize codepaths rather than rely on a primitive, and it does so at order-of-magnitude granularity, which is the right resolution for a CI-visible bound. A finer wall-clock test would flake on shared-runner CI without ever catching a real regression that the structural review (this section + the R-9.12 ESLint rule) would not.

The R-9.12 ESLint rule is the regression floor going forward: any compare against a `Secret<T>`-typed value with `===` / `==` / `Buffer.equals` fails CI via `pnpm run lint`. The #257 grep guard would have been a strict subset of that enforcement and is therefore not added.

---

## 4. Client-side hardening

### 4.1 URL fragment lifecycle

`App.tsx`:
- On home mount, `parseHashPhrase(window.location.hash)` reads the fragment.
- After `deriveRoomCredentials` resolves and the user enters or cancels the room, `window.history.replaceState(null, "", import.meta.env.BASE_URL || "/")` clears the fragment from the visible URL bar (`App.tsx:160, 186`).
- On `onLeave`, `window.history.pushState(null, "", BASE_URL)` is called instead of `replaceState` — this *adds* a history entry. A user who hits Back will navigate to the previous URL, which still bears the fragment in the browser's history list.

The fragment is browser-local; never sent in HTTP requests; never appears in `Referer`. Standard fragment hygiene.

But: `replaceState` does not erase the fragment from `history.state`'s preceding entries, from `popstate` traversal, or from extensions/password-managers that snapshotted `location` while the fragment was present. Browser autofill, certain password-managers, screenshot tools, and accessibility services that mirror window state can have a copy of the original URL.

- **Severity:** Medium (information disclosure to local-only observers). Browser-extension exposure is a privacy surface that should be acknowledged in the user-facing copy. Consider replacing the `pushState` on leave with `replaceState` to avoid keeping a fragment-bearing entry in history.
- **Status (published copy):** Fixed in-tree (see `M-03` comments in `App.tsx`). Every URL transition out of room state — leave button, BURN, kick, timer expiry, in-app route change, abandoned reconnect — uses `replaceState`. A grep for `pushState` in the client returns no occurrences that run while the user is in room state. The phrase-bearing URL is no longer kept in browser history after departure.

### 4.2 XSS sinks

`grep -rn "dangerouslySetInnerHTML\|innerHTML"` over `artifacts/void-client/src` returned no matches. Peer IDs, SAS strings, and phrase fragments are rendered as React text children, which React escapes. There is no chat-message renderer that takes peer-supplied HTML.

The marketing pages render static markdown-style content authored in-source; no user-supplied data reaches them.

- **Severity:** Informational.

### 4.3 Service worker

`sw.js`:
- Excludes `/api/`, `/api/socket.io`, `/socket.io`, and any URL containing `?` from the cache-first path.
- Uses a cache-first strategy for the static shell with a versioned cache name; old caches are deleted on activation.
- `skipWaiting` and `clients.claim()` ensure a new SW takes over on update.

A poisoned service worker (one served by a compromised origin) could serve stale or malicious code, but this requires breaking origin TLS or convincing the operator to deploy bad code — both outside the documented adversary model. The SW design is safe.

- **Severity:** Informational.

### 4.4 sessionStorage and localStorage

JWTs are held in `sessionStorage` by `RoomPage` for the host-rejoin path and cleared on tab close (sessionStorage semantics). Recovery codes are not auto-persisted. Verified.

`localStorage` is used for non-sensitive UI preferences (audio/video device choices, voice-mode default). No secret material lives in `localStorage`.

- **Severity:** Informational.

### 4.5 Web Share / clipboard fallback

`RoomPage.tsx` constructs the share URL by templating `window.location.origin + BASE_URL + phraseToHash(voidPhrase)`. The phrase is in the fragment. If the browser's Web Share API exposes this URL to the OS share sheet (Android, iOS), the receiving app sees the full URL including the fragment. **This is by design — the user is sharing the room invite — but worth noting**: an OS-level "share to" target that logs URLs (clipboard managers, "recent shares" lists, AI-assistant integrations) will retain the fragment. The user controls this by choosing what to share with, but the security-conscious user should be told.

- **Severity:** Informational, with a note for the threat-model page.

### 4.6 Third-party script and asset inclusions

`grep -rn "<script\|src=\"https" artifacts/void-client/index.html` and the bundler config: no third-party CDN scripts. No analytics. No tracking pixels. No external fonts (fonts are bundled). Good.

- **Severity:** Informational (positive finding).

---

## 5. Agent Mode

*Removed (v0.6): VOID's agent SDK, agent protocol library, and `agent`/`hybrid` room types have been deleted, and the public Agent Mode page has been taken down — VOID is now a single human-to-human product. The findings that were recorded here concerned agent-only code and no longer describe shipping code. The cryptographic primitives that survived the removal — the signed-hello envelope, Argon2id room derivation, and the branded `Secret<T>` types — now live in `lib/wire-core/` and are covered by §3 above and `docs/signaling-envelope-audit.md`.*

---

## 6. Dependency and supply chain

This audit reviewed the workspace `package.json` files and `pnpm-lock.yaml` by inspection. **A live `pnpm audit` was not executed in this read-only audit; that is recorded as a limitation in §11.**

### 6.1 Runtime — VOID server (`artifacts/api-server`)

Direct dependencies of interest:
- `express`, `socket.io` — mainstream, actively maintained, large security history but no known critical open CVEs at the time of writing.
- `jsonwebtoken` — historic CVEs around alg-confusion (CVE-2022-23529) fixed in 9.x. Verify the lockfile pins ≥ 9.0.0.
- `zod` — schema validation; clean history.
- No BOLT-11 invoice parser is in the server tree — the server takes invoices as opaque strings from the LNbits/BTCPay adapter and never parses them client-side.

### 6.2 Runtime — VOID client (`artifacts/void-client`)

- `react`, `react-dom`, `vite` — mainstream.
- No client-side BOLT-11 parser. No client-side ICE/SDP-munging library beyond what the browser provides natively.
- No `simple-peer` or `peerjs`-style wrapper is used; WebRTC primitives are called directly.

### 6.3 Agent SDK

*Removed (v0.6): the `lib/void-agent-sdk` package has been deleted. Its `node-datachannel` native-binding dependency — previously the highest supply-chain risk in the tree — is no longer present, and the standard self-host build never included it.*

### 6.4 Lightning-related and WebRTC-adjacent specifically

Lightning libraries in the tree: none. The integration is HTTP-only against LNbits/BTCPay and does not parse BOLT-11 client-side. **The absence of Lightning-protocol-handling code in the tree is itself the finding here** — there is no in-process BOLT-11 parser, no on-chain library, no wallet code, so the attack surface for Lightning-related bugs reduces to "what the operator's LNbits/BTCPay does."

WebRTC-adjacent in the tree:
- `node-datachannel` — *removed (v0.6) together with the agent SDK; it was never part of the standard self-host build (see §6.3).*
- No `sdp-transform`, no `webrtc-adapter`, no `simple-peer`. Browser-native WebRTC only.

### 6.5 Remote-code-loading dependencies

None observed in static review. The standard self-host build does not include `node-datachannel` (`Dockerfile` builds only `@workspace/api-server` and `@workspace/void-client`).

- **Severity:** Informational. Re-run `pnpm audit` and `pnpm outdated` on every release.

---

## 7. Deployment and configuration

### 7.1 Dockerfile

`FROM node:22-slim`, multi-stage build, runs `node ./dist/index.mjs`. As of task #173 the production stage drops to the built-in non-root `node` user via `USER node` immediately before `CMD`. The workload writes nothing under `/app` (verified by ripgrep for `writeFile`/`createWriteStream`/`appendFile`/`mkdir` across `artifacts/api-server/src`), so no `chown` of the read-only `dist`/`client` directories is required — default world-readable permissions on root-owned files are sufficient. `docker-compose.yml` mounts no host volumes on the `void` service, so no host-side ownership notes are needed.

- **Severity:** Medium → Fixed (production image #173). Container escapes are out of model, but a process inside the container that is exploited (e.g. via a future signaling-handler bug) no longer gains root inside the container.

The image does not embed secrets — verified by checking the Dockerfile and the `.env`-driven runtime model. `HEALTHCHECK` curls `/api/health` correctly.

### 7.2 docker-compose

`docker-compose.yml` uses `network_mode: host` for Coturn. This is necessary for TURN's wide UDP port range; expected. Coturn's config is mounted read-only. Good.

### 7.3 Coturn config (`coturn/turnserver.conf.example`, operator-supplied `coturn/turnserver.conf`)

- `use-auth-secret` + `static-auth-secret` mode is correct for the ephemeral HMAC-SHA1 credential model VOID expects.
- `denied-peer-ip` blocks RFC 1918 ranges and loopback, preventing the TURN relay from being abused as a launchpad against the operator's own network. Good.
- `min-port=49152` / `max-port=65535` constrains the relay port range. Good.
- `no-multicast-peers` and `no-cli` are set. Good.
- The example config carries `static-auth-secret=YOUR_SECRET_HERE` as a placeholder. The README warns three times not to deploy this as-is. Operator discipline.

**M-05 — Resolved (task #174).** The original audit recorded that a `coturn/turnserver.conf` file carrying the same `static-auth-secret=YOUR_SECRET_HERE` placeholder was committed to the repo, not just the example. A naive operator could `docker compose up` against it and run a Coturn instance with a known weak secret — effectively an open relay, since the API server would mint valid HMAC-SHA1 credentials against that public placeholder for any caller. Task #174 closed both halves of the trap:

- The placeholder file was deleted from the repo and the template renamed to `coturn/turnserver.conf.example`. `.gitignore` now covers the operator's working copy (`coturn/turnserver.conf`) so it cannot be re-committed by accident.
- A startup guard at `artifacts/api-server/src/lib/turnSecret.ts` (`assertTurnSecretNotPlaceholder`) refuses to start the API server when `TURN_SECRET` matches any known placeholder string (`your_secret_here`, `replace_with_your_turn_secret`, `replace_with_long_random_turn_secret`, `replace_with_the_same_secret`, `changeme`, `change_me`, `secret`, `password`). When `TURN_SECRET` is unset entirely the server falls back to public STUN with no relay credentials minted, so the guard only fires on the dangerous "configured but placeholder" case.

- **Severity:** Medium → **Fixed (#174)**.

### 7.4 StartOS / Umbrel manifests

`umbrel-app.yml` and `manifest.yaml` were not exhaustively reviewed in this audit; their permission requests and exposed ports should be verified before any platform-store submission. Tracked as a sub-limitation.

### 7.5 `PAYWALL_SECRET` ephemeral default

If `PAYWALL_SECRET` is not set, the server auto-generates a random 32-byte hex secret at startup. This is fine for dev; in production it means JWTs become invalid on every restart, which silently breaks recovery codes and host-rejoin. The README documents this. Code does not refuse to start without an explicit secret in production.

- **Severity:** Low. Add a `NODE_ENV === "production" && !PAYWALL_SECRET → fatal exit` check.

### 7.6 Content-Security-Policy and HSTS — applicability to served void-client HTML

> **May 2026 re-audit addendum.** This subsection was added in the May 2026 re-audit pass. The April audit noted helmet was registered but did not verify that the policy applies to the served void-client HTML, nor enumerate per-directive correctness. Both are addressed here, including the full per-directive verification summary published below in this section.

`artifacts/api-server/src/app.ts` registers `helmet({...})` at lines 39–67, *before* the static-serve block at lines 74–76 and the SPA catch-all at lines 102–125. Express middleware registration order is request-handling order, so every response served from the bundled `clientDist` (the void-client `index.html`, the JS/CSS bundles, the AudioWorklet at `voice-mask-processor.js`, the service worker at `sw.js`, fonts, icons, OG cards) is wrapped by helmet's `Content-Security-Policy` and `Strict-Transport-Security` headers. The `SERVE_STATIC=1` mode is the production self-host path (`Dockerfile` runs `node ./dist/index.mjs` with `SERVE_STATIC=1` and `CLIENT_DIST=./client`).

In dev, the void-client is served by Vite on its own port — helmet does not run there. This is dev-only and out of scope for the user-facing security claim. Operators who run a different production topology (Vite dev server, separate static host, CDN-only) are responsible for replicating the CSP and HSTS headers there.

**Per-directive verification summary:**

- `defaultSrc 'self'` — conservative default, all other directives explicit.
- `scriptSrc 'self'` — covers the single bundled module script in `index.html`; no inline scripts on the served HTML; no CDN scripts; no analytics.
- `styleSrc 'self' 'unsafe-inline'` — `'unsafe-inline'` required by the current Tailwind / inline-style approach. Recorded tradeoff.
- `connectSrc 'self' wss: ws:` — covers Socket.io (`/api/socket.io`) and same-origin `fetch('/api/...')`. WebRTC ICE/STUN/TURN traffic uses the ICE agent transport, not fetch/XHR, and is not governed by this directive.
- `workerSrc 'self' 'blob:'` — covers the registered service worker (`sw.js`) and the AudioWorklet module (`voice-mask-processor.js`).
- `mediaSrc 'self' 'blob:' 'mediastream:'` — covers `<video>`/`<audio>` bound to WebRTC `MediaStream` via `srcObject`, plus same-origin posters and blob fallbacks.
- `imgSrc 'self' 'data:' 'blob:'` — covers OG cards, icons, inline SVG (QR codes), and any client-generated blob image.
- `fontSrc 'self'` — both webfonts under `public/fonts/` are same-origin; no Google Fonts, no third-party CDN.
- `objectSrc 'none'`, `frameSrc 'none'`, `baseUri 'self'`, `formAction 'self'` — all defense-in-depth, all match actual app behavior (no `<object>`, no `<iframe>`, no cross-origin form posts).
- HSTS: `max-age=31536000`, `includeSubDomains`, `preload` — meets HSTS-preload criteria.

**Gap.** The CSP has no `report-to` / `report-uri` directive. Real-world CSP violations on the served void-client HTML — whether caused by a future bundler change, a marketing-page edit that adds an inline event handler, or an actual injection attempt — are blocked but unobserved by the operator. Recommended: add a `report-to` directive plus a server-side `/api/csp-report` sink that ingests, rate-limits, and logs reports. Tracked as a follow-up task.

- **Severity:** Informational — the CSP applies and the directives are correct against actual app behavior; the only gap is observability of violations, which is the follow-up.

**Update — May 2, 2026 (task #256).** The HTTP security header surface was widened the same day. Final state:

- **`Permissions-Policy`** is now emitted with a deny-by-default allow-list. The void-client uses only `getUserMedia` (camera/mic), `getDisplayMedia` (screen-share), `navigator.clipboard.writeText` (copy buttons — never read), and `navigator.share` (Web Share for room invites), so the policy whitelists `camera`, `microphone`, `display-capture`, `clipboard-write`, `fullscreen`, `autoplay`, and `web-share` to `(self)` and explicitly denies `clipboard-read` plus the long tail of sensor / payment / bluetooth / USB / HID / serial / MIDI / geolocation / WebAuthn / picture-in-picture / storage-access / browsing-topics / interest-cohort / window-management / XR / etc.
- **`Referrer-Policy: no-referrer`** is now declared explicitly (helmet's default, but locked in by a regression test so a future helmet default change cannot silently downgrade it).
- **`Cross-Origin-Opener-Policy: same-origin`** is now enabled (previously disabled). Closes opener-relationship cross-origin attacks (tabnabbing, popup XS-leaks). Verified that the void-client's Web Share invite flow on iOS Safari, Android Chrome, and Firefox is not affected — `navigator.share()` hands off to the OS share-sheet and does not depend on a `window.open` opener.
- **`Cross-Origin-Resource-Policy`** is keyed off the deployment topology: `same-origin` under the production single-origin self-host (`SERVE_STATIC=1`, the default Docker path) and `same-site` under split-origin deployments where the client is served separately. Both modes still block cross-site embedders.
- **`X-Permitted-Cross-Domain-Policies: none`** is now declared explicitly (helmet's default; locked in by the same regression-test rationale as `Referrer-Policy`).
- **`Cross-Origin-Embedder-Policy` is intentionally NOT set.** The void-client uses no `SharedArrayBuffer`, `crossOriginIsolated`, or other API requiring cross-origin isolation, so COEP would force every cross-origin subresource to opt in via CORP for zero security gain.
- **CSP `report-to` directive + `Reporting-Endpoints` header added, both naming the well-known group `default`.** The CSP directive wires CSP violations to that group; the `Reporting-Endpoints` header is what the browser's Reporting API consults to find the actual URL. We use the group name `default` deliberately: the Permissions-Policy spec routes its own violations to the `default` endpoint group automatically (there is no per-policy `report-to` directive on the Permissions-Policy header value itself), so a single sink covers both header families with no second header. The endpoint itself remains the open follow-up above; declaring the headers now means the moment that endpoint ships, browsers will start posting both CSP and Permissions-Policy violations automatically with no further app change.

A regression test at `artifacts/api-server/src/__tests__/security-headers.test.ts` asserts the exact value of every header above on normal 200 responses, on 4xx and 5xx error responses, on the OPTIONS preflight short-circuited by `cors()`, and (under `SERVE_STATIC=1`) on JS asset, CSS asset, and SPA fallback responses across both CORP modes. The full list of changes — including the per-directive rationale, the API audit that drives the Permissions-Policy allow-list, the COOP compatibility verification, and the custom 404 / error handlers added so Express's default `finalhandler` cannot strip CSP from error responses — is captured by the per-directive verification summary above and verified by that regression test.

The underlying audit conclusion is unchanged: the CSP applies and every directive matches actual app behavior. The widened header surface tightens defense-in-depth for the standard published browser-hardening checklists (Mozilla Observatory, securityheaders.com) without affecting the threat model. **The remaining reporting-endpoint gap was closed on 2026-05-03 by task #252**: the same-origin `/api/csp-report` route now ingests violation reports in both the modern Reporting-API shape (`application/reports+json`) and the legacy `application/csp-report` shape, applies a per-IP rate limit, structured-logs the salient fields (blocked URL, effective directive, disposition, source location, user-agent), and always replies 204 so the endpoint cannot be used as an oracle. With this change a future bundler regression, marketing-page edit, or actual injection attempt that trips the policy now surfaces in the operator's logs instead of being blocked silently. Implementation is in `artifacts/api-server/src/routes/csp-report.ts` with a round-trip test in `artifacts/api-server/src/__tests__/csp-report.test.ts`.

---

## 8. Observable side channels

### 8.1 Network — what a TLS observer sees

A passive TLS observer who can monitor packet sizes and timing of the WebSocket connection between client and server can infer:
- **Connection event** (someone joined a room).
- **Approximate room duration** (WebSocket open until close).
- **Number of peers in the room** — every peer-join generates a fan-out of `relay-signal` envelopes whose count scales with the peer count. Pattern-match-able.
- **Signaling activity bursts** — handshake, ICE restart, screen-share negotiation. Distinctive shapes.

The observer cannot infer the phrase, the room contents, or the participants' identities directly from the encrypted signaling channel. They can correlate flows: the same client opening a Socket.io connection to the same VOID server within a short window of a Lightning payment to the operator's node is a strong "this peer just created a room" signal.

The media path bypasses the server. A TLS observer of the server learns nothing about media. A passive observer of Coturn (on the relay path, or with subpoena power over the relay operator) sees the encrypted SRTP flows; cannot read media, can measure flow size and timing.

### 8.2 Timing — secret-dependent branches

Spot-checked: the `paywall.ts` invoice/status/recovery handlers use map lookups and JWT verification, both timing-equalized to a useful approximation. The `proof/server-state` endpoint is documented to be timing-equalized; this audit did not re-verify that property — recorded as a sub-limitation.

### 8.3 Resource — server memory and CPU

The in-memory room map's size grows linearly with paid rooms. A timing-side observer who can probe server response latency could infer "many active rooms vs few" but this is bounded by the paywall.

---

## 9. Resilience and abuse

### 9.1 Slowloris / per-connection slow-read

Express + Socket.io with default Node `http` settings have soft limits on header timeouts and idle connections. Without explicit `server.headersTimeout` and `server.requestTimeout`, the server can be tied up by slow clients. Verify these are set in `index.ts` (not exhaustively re-confirmed in this pass).

- **Severity:** Low. Set `server.headersTimeout = 60_000`, `server.requestTimeout = 120_000` explicitly.

### 9.2 Flooding `create-room`

Gated by JWT. Each JWT requires a paid invoice (or `dev-pay` in dev). Real cost in production. Mock backend in dev is the correct shape.

### 9.3 Single peer flooding `relay-signal` or `screen-share-request`

`relay-signal`: not size-capped (see 3.5). Per-IP connection cap is present but bypassable per H-01. **A paid attacker with one valid JWT can establish many sockets from spoofed leftmost-X-Forwarded-For values, then flood `relay-signal`.** Combined finding with H-01.

`screen-share-request`: rate-limited to 5 per 60s per peer (`socketHandlers.ts:49`). Adequate. PROPOSED #57 tracks further hardening.

### 9.4 Lightning backend slow / unreachable / malformed

`lightning.ts` calls `fetch` against LNbits/BTCPay without an explicit timeout. A slow Lightning backend will block the invoice-creation handler indefinitely. The HTTP client does have Node's default socket inactivity behavior, but no application-level deadline.

- **Severity:** Low. Add `AbortController` with a 10-15s deadline on every `fetch` to LNbits/BTCPay.
- **Status (published copy): Fixed in Task #265.** Every Lightning HTTP call (LNbits `createInvoice` / `checkPayment`, BTCPay `createInvoice` / payment-methods / `checkPayment`) now flows through a `lightningFetch()` wrapper that arms an `AbortController` for `LIGHTNING_FETCH_TIMEOUT_MS = 8_000` and rethrows `AbortError` as the typed `LightningBackendUnavailableError`. The two paywall routes (`/api/paywall/invoice`, `/api/paywall/status/:hash`) catch this typed error and return HTTP `503 { "error": "LIGHTNING_BACKEND_UNAVAILABLE" }`; the client's `PaywallModal` recognises the 503 and surfaces a "PAYMENT SERVICE IS SLOW TO RESPOND. TRY AGAIN IN A MOMENT." message instead of spinning forever. The deadline is fail-fast — there is no retry/backoff, by intent: a hung Lightning backend is an operator problem, not a problem to mask in the user's face. The 8 s figure was chosen as longer than any reasonable LNbits/BTCPay invoice round-trip and shorter than the ~10 s window after which the user is likely to assume the page is broken.

Malformed responses: `data.payment_request ?? data.bolt11 ?? ""` defends against missing fields. JSON parse failures will throw and bubble up to the route handler, which surfaces as a 5xx. No undefined-method-call paths observed.

### 9.5 Peer connects, completes handshake, never sends another message

Server-side `relay-signal` is event-driven; no state is held on the server for an idle peer beyond the `socket` and `RoomState.users` entry. Memory cost is small. The peer slot does count against the room's `MAX_USERS`. A malicious peer could squat a slot by holding the connection open. PROPOSED tasks #55 and #56 (server-side expiry enforcement, frequency tightening) are the correct mitigation.

- **Severity:** Already tracked as #55 / #56.

### 9.6 Server OOM mid-session

Node default heap; an OOM kills the process. PM2 / systemd / Docker would restart. All in-memory rooms are wiped (the documented design). Active peers see signaling drop and can rejoin the room (which no longer exists), which fails. **Server restart breaks every active room.** Documented behavior; not a finding, but operators should know.

### 9.7 Host loses connection mid-session — peer-to-peer connections survive

Yes. WebRTC media flows directly between peers; loss of the signaling channel does not interrupt media. ICE restart on a connectivity drop does require signaling, so a host disconnect during a media-path renegotiation will fail until the host reconnects (via the rejoin-as-host path).

---

## 10. Cross-cutting findings — claims vs code

### 10.1 `VOID_TECHNICAL_OVERVIEW.md` "SAS provides MITM resistance"

True only because the phrase-encrypted envelope serves as the implicit commitment. Document this dependency explicitly: SAS is *not* an independent MITM defense; it is a verification step that confirms the phrase-derived key is not compromised.

### 10.2 `README-selfhost.md` "End-to-end encryption"

The phrase-derived key encrypts signaling. Media is SRTP-encrypted by WebRTC default — but **the SRTP key is negotiated via DTLS over the data channel**, which the server cannot read because the data channel itself is established directly between peers (after signaling), and the SDP/DTLS fingerprints are exchanged inside the AES-GCM-encrypted relay payloads. Sound. The README phrasing is correct.

### 10.3 `README-selfhost.md` "relay-only is supported"

True; `relayOnly` flag exists. The README does *not* claim relay-only is server-enforced. Code matches the README. **Marketing pages should not over-claim.**

### 10.4 Marketing pages

Spot-checked `LandingPage`, `WhyPage`, `ComparePage`, `ThreatModelPage`, `BiometricPage` for claims. Most claims are accurate or hedged. The threat-model page should be amended to:
- Acknowledge the Lightning paywall observability surface (per 3.8).
- Acknowledge the URL-fragment exposure to local-machine actors (browser extensions, OS share sheets, password managers).
- Acknowledge that a host who briefly drops can be supplanted by the next phrase-holder to join an emptied room (per **M-02**), if that is not the intended UX.

### 10.5 Existing PROPOSED tasks

The audit's findings overlap with the following PROPOSED tasks and treats them as already tracked:
- **#55** server-side expiry enforcement on in-room actions
- **#56** tighten server-side expiry check frequency
- **#57** rate-limit screen-share requests

This audit does not duplicate those tasks.

---

## 11. Audit limitations

This is a static, read-only review. It cannot meaningfully assess the following — each named explicitly with what kind of work would address it:

1. **Timing attacks that depend on real network conditions.** Static reading cannot measure microsecond-scale variance under genuine RTT and jitter. The `proof/server-state` endpoint is documented to be timing-equalized; this audit did not re-instrument it. Addressing this requires an instrumented live deployment with high-resolution clock measurements over many trials.

2. **TURN impersonation against a live deployment.** A malicious TURN endpoint that the client could be coerced or tricked into using (DNS poisoning, configuration override, malicious operator) is a runtime concern. The audit can confirm the client honors `turn:`/`turns:` URLs from the operator-controlled `/api/ice-servers` route; it cannot verify what happens when the network around a specific deployment is hostile. Addressing this requires standing up a malicious TURN endpoint and observing client behavior end-to-end.

3. **RNG entropy on host machines.** The audit confirms every secret-generation site uses `crypto.getRandomValues` (browser) or `crypto.randomBytes` / `crypto.randomInt` (Node). It cannot verify entropy quality on any specific host: containers with shallow `/dev/urandom`, browsers in low-entropy boot states, virtual machines without paravirtualized RNG. Addressing this requires per-host entropy auditing of the deployment fleet.

4. **Undisclosed supply-chain compromise.** The dependency review (§6) catches *known* CVEs and *known* maintainer history. A malicious version published in the last 24 hours, or a maintainer-account compromise that has not yet been disclosed, will not appear. A live `pnpm audit` was not executed in this read-only audit; that should be run on every release. Addressing this requires reproducible builds, dependency pinning, and ongoing monitoring of advisory feeds.

5. **Lightning routing observability.** Reasoning about which routing nodes a payment passes through, and what those nodes infer from invoice metadata + payment timing, requires a live Lightning network and a real node. The audit can describe the surface (per 3.8) but cannot measure the actual leakage on any particular deployment. Addressing this requires a live network reconnaissance with controlled test payments.

6. **Nation-state-grade targeted attacks.** Custom traffic-analysis pipelines, browser zero-days, hardware-implant scenarios, supply-chain attacks at compile-time — out of reach for a static audit. Addressing this requires dedicated red-team work with appropriate budget, including a hardware/firmware review and ongoing operational monitoring.

7. **Coturn behavior under adversarial load.** The Coturn config was reviewed as a config file. Coturn's own runtime correctness (does it actually honor `denied-peer-ip` under all conditions, does it log differently under load, does TLS termination behave under cert-rotation) is not auditable from the configuration file alone. Addressing this requires runtime testing of the relay endpoint.

8. **`proof/server-state` timing equalization.** Claimed to be timing-equalized in prior threat-model work; this audit did not re-verify the equalization is intact. Addressing this requires an instrumented test against the running endpoint with high-resolution timing.

9. **StartOS / Umbrel manifest review.** ~~`umbrel-app.yml` and `manifest.yaml` were not exhaustively reviewed for permission requests and exposed-port surface. Addressing this requires a platform-by-platform manifest review against each store's policy.~~ ~~**WATCH residual (2026-05-02):** an internal claims-tracking note carried a forward-looking `Tor-by-default` claim on `ThreatModelPage` that the manifest does not back; the manifest advertises both `tor-config` and `lan-config` interfaces side-by-side. Either soften the claim or ship a Tor-only default before submission.~~ **Updated 2026-05-03 (Task #238):** the Tor-by-default residual is closed. `ThreatModelPage`, `manifest.yaml`, `umbrel-app.yml`, and `README-selfhost.md` §6c now use the tightened `.onion`-reachable wording with an explicit media-path caveat (WebRTC ICE candidates remain on the user's underlying network), and `artifacts/void-client/scripts/banned-phrases.mjs` flags any reintroduction of `Tor-by-default` / `Tor-routed` in the scanned scope. **Updated 2026-05-02 (Task #253):** the manifest review pass has now landed. Every field of both manifests is enumerated against the policy clause it satisfies; the `tor-config` / `lan-config` audit confirms both interface blocks target the same backend port (3000), with no second listener that could create a problematic overlap; the Tor-only deployment switch is documented as a manifest-edit (delete the `lan-config` block) plus a reserved `TOR_ONLY=1` env-var contract, with the security tradeoff and the cross-reference to the operator-onion-mirror runbook documented in `README-selfhost.md` §6b; the persistent-state declaration, Coturn host-network-mode justification, upgrade behavior, and Coturn config workflow reference are each declared at the manifest layer rather than only in audit prose. The residual gap is the placeholder `void.example` URLs across both manifests, which block store submission until the public repository is published; that gap is itself the correct posture today (better than inheriting a possibly-wrong fork URL) but must be resolved before a `.s9pk` is built and uploaded. Re-eval triggers and the calendar backstop are tracked for the next review pass. **Updated 2026-06-11:** the residual placeholder-URL gap is **closed** — the canonical public repository was locked at `https://github.com/DotMatrixIO/void` and the `void.example` URLs were swapped to canonical values across both manifests (zero `void.example` strings remain). The only remaining submission-readiness step is the operator action of building the bumped `.s9pk` and verifying it installs in a StartOS test instance.

10. **Client integrity at runtime.** ~~Subresource Integrity (SRI) is not in use; the bundled output is single-origin.~~ **Updated 2026-05-02 (Task #243):** SRI is now in place. Every emitted HTML file in the production build carries `integrity="sha384-…"` plus `crossorigin="anonymous"` on the entry `<script type="module">` and the entry `<link rel="stylesheet">`, computed from the actual built bytes by a small in-tree post-build script (`scripts/add-sri.mjs`) using Node's standard `crypto` module — no third-party plugin was added to a security-critical build step. ~~Code-split chunks loaded via dynamic `import()` (the QR scanner modal and its worker) are not preloaded by Vite at this bundle size and are therefore not covered by an SRI-bearing `<link rel="modulepreload">` tag; whether the browser extends integrity checking to those chunks via the entry script is browser-dependent and historically incomplete, so a fully-origin-compromised attacker who can also rewrite `index.html` could still strip SRI entirely — SRI on the entry buys real defense-in-depth, not a hard guarantee against a fully-owned origin.~~ **Updated 2026-05-02 (Task #258):** the build now emits `<link rel="modulepreload" href="…" integrity="sha384-…" crossorigin="anonymous">` tags for every chunk reachable from any entry via the transitive dynamic-import closure (walking both static and dynamic imports from Vite's manifest). The injection runs on every emitted HTML — `index.html` and the per-route social-card files — and is verified by parameterised tests including a tamper-test over each lazy chunk. **Engine-support honesty:** SRI on `<link rel="modulepreload">` is reliably enforced in current Chromium-based browsers. Enforcement on other engines (Safari, older Firefox) is inconsistent. For Chromium users, lazy-chunk tampering now requires also tampering the entry HTML to omit or alter the integrity tag — a much louder operation that the CSP report-uri endpoint (Task #252) would catch. For non-Chromium users, the residual risk is lower than before this change but not eliminated. A `script-src 'strict-dynamic' 'nonce-…'` CSP would close more of the residual gap but requires per-request server-rendered nonces; if the Task #252 CSP work surfaces that as desirable it will be filed as a separate task rather than bundled here. **CSP vs SRI**: CSP restricts which origins scripts may be loaded *from*; SRI verifies that the bytes of the loaded script match what was *built*. They are complementary checks — CSP without SRI does not catch in-place tampering on an allowed origin, and SRI without CSP does not restrict which origin can serve the asset. **Failure mode**: when SRI rejects a tampered script the browser refuses to execute it. Task #243 originally accepted the resulting blank page as the correct default — a real SRI failure is either an attack or a deployment bug, both of which warrant operator attention rather than a polished error UI. **Updated 2026-05-02 (Task #249):** a small inline diagnostic is now in `index.html`. It listens for `error` events on the entry script and stylesheet (which is what the browser fires when SRI rejects an asset) and renders a plain HTML overlay into `#root` reading "This page failed an integrity check … not safe to load … contact the site operator." The bootstrap is inline (so it is not itself subject to SRI), uses no external fonts or images, and only triggers on resources that carry an `integrity` attribute, so a 404 on an unrelated asset (e.g. a social-card image) does not surface the message. The blank-page outcome is therefore replaced by a one-line explanation; the underlying decision — that an SRI failure is operator-grade, not a recoverable user error — is unchanged. The audit still cannot verify what a specific CDN or reverse proxy actually serves on every deployed origin; that remains a per-deployment operator concern.

11. **Browser-level surfaces inherited from the runtime.** DNS lookups, the system clipboard, the Notification API, extension DOM access, `RTCPeerConnection.getStats()`, and managed-browser `getUserMedia` permission logging are all readable to actors on the user's own device (other extensions, MDM-installed monitoring, OS-level loggers). The static audit can enumerate them but cannot mitigate them in code, because the mitigations are user-side configuration choices on the browser the user runs. They are recorded here as documented limitations rather than as assessable findings. The canonical user-facing disclosure is the "BROWSER-LEVEL SURFACES" section on the threat-model page (`/threat-model`); the technical mirror is `docs/threat-model.md` §6. This item moves these six surfaces out of "absent from the audit" and into the same documented-known-limitations register the rest of §11 uses.

This list is the floor, not the ceiling. Anything not explicitly assessed in §1–§10 should be treated as "not assessed by this audit" rather than "assessed and clean."

**Confidence labels used in §1–§10.** Because this is a static audit, claims fall into three confidence tiers and the language tries to be consistent about which tier any given claim is in:

- **Verified by reading the code** — the cited file and lines were read and the asserted property follows from the code as written. Most positive findings (no XSS sinks, no third-party scripts in `index.html`, JWT verify uses HS-family algorithms because secret is a string) are at this tier.
- **Verified by reading + cross-implementation check** — applies in §1 cryptography, where the agent SDK and browser implementations are both read and compared, and in §10 (claims-vs-code), where prose claims are checked against code.
- **Likely safe but not verified at runtime** — applies wherever the property is a runtime behavior the audit did not measure: the `proof/server-state` timing-equalization (§8.2 / limitation 8), Coturn's actual `denied-peer-ip` enforcement under load (limitation 7), StartOS/Umbrel manifest correctness (limitation 9), `pnpm audit` output on the live lockfile at audit time (limitation 4 — a lockfile-complete CVE appendix is itself a follow-up addendum the operator may want to commission), and any property that depends on the deployed network around the host. Where a §1–§10 paragraph relies on one of these properties, the language is "documented as" or "claimed to be" rather than "is".
