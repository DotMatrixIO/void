# VOID Code Quirks Index

A navigable map of the **load-bearing weirdness** in this codebase — the
non-obvious decisions that look strange in isolation but exist for a specific
reason. If you are about to "clean up" one of these, read the linked code
comments and the referenced task before changing anything.

Scope is intentionally narrow. Surfaces covered:

- [Audio (browser)](#audio-browser)
- [WebRTC (browser)](#webrtc-browser)
- [Lightning / paywall (server)](#lightning--paywall-server)
- [Crypto (browser + shared protocol)](#crypto-browser--shared-protocol)
- [Signaling / rooms (server)](#signaling--rooms-server)
- [Build chain (void-client)](#build-chain-void-client)
- [Typecheck gates and shared composite libs (workspace)](#typecheck-gates-and-shared-composite-libs-workspace)
- [Express middleware ordering (server)](#express-middleware-ordering-server)

Conventions:

- File paths are workspace-relative.
- Line numbers are anchors at the time of writing — drift is expected. Use
  them to find the comment block, then trust the comment, not the number.
- "Task #N" / "M-0N" / "R-9.NN" refer to entries in the project task log
  and the April 2026 internal audit. The inline comment in the linked
  code is the authoritative explanation.
- Protocol-level quirks (signed-hello envelope, argon2id parameters,
  signing contexts, timing-safe compare) are documented in
  `lib/wire-core/` only — consumers reference that canonical
  location instead of duplicating the rationale.

---

## Audio (browser)

### Two-stage teardown of `AudioContext` on burn / leave (Task #283)
- **Where:** `artifacts/void-client/src/lib/sounds.ts` L305–L325
  (`closeAudioContext`)
- **Why:** Run `beforeCloseHooks` first to stop scheduled
  `BufferSource` / oscillator nodes, *then* `close()` the context.
  Closing while sources are still scheduled leaks the context on
  Chromium and the burn / leave sound bleeds into the next session.
- **Browser verification:** see
  `docs/audio-context-leak-verification.md` (Task #305) for the
  Chrome / Firefox / Safari devtools checklist that confirms no
  `AudioContext` or `AudioWorklet` thread survives a teardown.

### `AudioContext` sample rate is browser-chosen, not pinned
- **Where:** `artifacts/void-client/src/lib/sounds.ts` L17–L22
  (`getCtx`), L36–L37 (`createNoiseBuffer` derives `frameCount` from
  `audioCtx.sampleRate`); `artifacts/void-client/src/lib/music.ts`
  L41–L43 (same pattern in the music engine);
  `artifacts/void-client/src/lib/mediaPipeline.ts` L494–L496
  (mic `MediaStreamSource` adopts the context's rate)
- **Why:** We never pass `{ sampleRate }` to `new AudioContext()`.
  The browser picks the device's native rate (commonly 44.1 kHz or
  48 kHz). Every buffer / filter coefficient must be scaled from
  `audioCtx.sampleRate` at construction time — hardcoding 44.1 kHz
  would cause pitch / duration drift on 48 kHz devices. (Indexed
  only — Web Audio spec consequence, no task ref.)

### `AudioWorklet` teardown order: port first, then nodes
- **Where:** `artifacts/void-client/src/lib/mediaPipeline.ts`
  L508–L530 (worklet construction with `?v=` cache-bust on the
  module URL — load-bearing rationale at L508–L520), L594–L613
  (teardown sequence: port.close first, then disconnect)
- **Why:** Reversing the order leaks the worklet's message channel
  (the audio thread holds a reference to a port whose JS-side owner
  is already gone). The cache-bust query string is required because
  browsers cache `addModule` outputs aggressively and a stale
  processor silently runs the old masking algorithm against the new
  pipeline. (Indexed in docs/code-quirks-index.md.)

### Per-call `BufferSource` reconstruction
- **Where:** `artifacts/void-client/src/lib/sounds.ts` L27–L35
  (canonical rationale comment), L52, L89, L133, L192, L231 (every
  `playClick` / `playSelectClick` / `playBleep` / `playBloop` /
  `playSlide`)
- **Why:** `AudioBufferSourceNode` is single-use by spec. Each
  playback constructs a fresh source AND a fresh noise buffer; only
  the `AudioContext` itself is shared across calls. Do not "optimize"
  by caching either the source or the buffer. (Index-only — no
  task / audit ref; this is a Web Audio spec constraint.)

### Music engine registers a before-close hook
- **Where:** `artifacts/void-client/src/lib/music.ts` L792–L797
  (`registerBeforeAudioClose`), `sounds.ts` L7–L15
- **Why:** The music loop scheduler enqueues notes on a `setTimeout` that
  re-enters `scheduleLoop` against the live `AudioContext`. If the
  context closes first, the next loop tick schedules against a closed
  context and throws / leaks. The hook stops timers and disconnects
  nodes *before* `closeAudioContext` actually closes the context.

### Audio monitor gain transitions use `audioCtx.currentTime`, not wall-clock
- **Where:** `artifacts/void-client/src/lib/mediaPipeline.ts` L562–L581
  (`enableMonitor` / `disableMonitor`, including the new rationale
  block at L562–L568)
- **Why:** Web Audio gain ramps must be scheduled on the audio clock
  to avoid sample-boundary clicks. `setInterval` / `setTimeout` drift
  on backgrounded tabs; `audioCtx.currentTime` is sample-accurate. Do
  not rewrite these as wall-clock-driven sets.

### Recording-honesty watermark draw is per-frame, not per-tick
- **Where:** `artifacts/void-client/src/lib/mediaPipeline.ts` L144–L158
  (header), L188–L227 (`drawWatermark`), L482–L483 (camera
  compositor), L630–L709 (screenshare wrapper)
- **Why:** The watermark is composited inside the existing per-frame
  draw loop (camera compositor + screenshare compositor). There is no
  separate scheduler. Adding one would race the captureStream framerate
  and produce stutter. Helpers are exported in a minimal-context shape
  so jsdom-based unit tests can drive them without a real canvas.

---

## WebRTC (browser)

### Screenshare snapshot pattern (capture-then-detach)
- **Where:** `artifacts/void-client/src/lib/webrtc.ts` L204–L206
  (`preOverrideVideoTrack`), restored by `clearVideoOverride`
- **Why:** Task #285. Some browsers fire `ended` on the captured display
  track if you read it back through the `RTCRtpSender` after replacement.
  We snapshot the original camera track first and restore it from the
  snapshot on both the share-failure and graceful-end paths. Reverting to
  a "swap and forget" pattern breaks camera resume on stop-share.

### `iceTransportPolicy: "relay"` is pinned, not advisory
- **Where:** `artifacts/void-client/src/lib/webrtc.ts` L212, L262, L638–L646
  (`buildPC`); regression tests in `webrtc.iceTransportPolicy.test.ts`
  and `webrtc.relayPinned.test.ts`
- **Why:** When the room is created with `relayOnly: true` (opt-in for
  human rooms), the transport policy must
  remain `"relay"` for the lifetime of the connection. Renegotiation
  must not drop it. The pinned-policy tests exist because a regression
  here silently leaks participant IPs.

### Per-peer relay-pinned status is poll-derived, not event-driven (Task #293)
- **Where:** `artifacts/void-client/src/lib/webrtc.ts` L108–L115 (header),
  L117 (`RELAY_STATUS_PROBE_INTERVAL_MS`), L126–L172 (`isPeerRelayPinned`),
  L199–L200 + L279–L281 (probe timer)
- **Why:** Chromium does not always emit `icegatheringstatechange` before
  the first relay candidate is selected. We poll `pc.getStats()` on a
  3 s cadence and tolerate both `nominated+succeeded` and `selected:true`
  signals because browsers vary. Do not switch to event-driven without
  reproducing the original race.

### Loud-fail teardown on hello / ECDHE failure (M-01)
- **Where:** `artifacts/void-client/src/lib/webrtc.ts` L360–L400
  (`failSecureChannel`), L437–L458 (`relay`), L699–L726 (`initiateOffer`),
  L771–L831 (`handleRelay` decrypt branches), L1035–L1043 (ICE-restart
  reoffer); shim header at `artifacts/void-client/src/lib/helloEnvelope.ts`
  L1–L11
- **Why:** April 2026 audit M-01. A failed hello verification or
  ECDHE/decrypt path must tear down the per-peer connection, not silently
  fall back to the room-wide phrase key. The narrow exception (a
  `key-exchange` payload arriving phrase-key-encrypted while the old
  session key is still installed, L788–L808) is typed and gated, not a
  general fallback. `failSecureChannel` surfaces the reason for the
  red-overlay UI.

### `relay` vs `relayWithPhraseKey` are not interchangeable
- **Where:** `artifacts/void-client/src/lib/webrtc.ts` L437–L458
  (`relay`), L460–L469 (`relayWithPhraseKey`)
- **Why:** `relay` is post-handshake and *requires* a per-pair session
  key — missing key triggers `failSecureChannel`. `relayWithPhraseKey` is
  pre-handshake only and is the single legitimate caller of phrase-key
  encryption on the post-task-#283 path. Do not promote either to
  general use.

---

## Lightning / paywall (server)

### Per-call backend timeout, 8 s default, env-configurable
- **Where:** `artifacts/api-server/src/services/lightning.ts`
  (`DEFAULT_LIGHTNING_FETCH_TIMEOUT_MS` / `MIN…` / `MAX…`,
  `resolveLightningFetchTimeoutMs`, `lightningFetch`,
  `LightningBackendUnavailableError`)
- **Why:** Backends occasionally hang past 30 s. The 8 s default keeps
  the paywall responsive at the cost of an occasional "try again" on a
  healthy invoice. The route maps the typed error to HTTP 503 so the
  PaywallModal renders a real state instead of spinning. Operators on
  slow hardware / Tor can override via the `LIGHTNING_FETCH_TIMEOUT_MS`
  env var, clamped to 1000–30000 ms (out-of-range / invalid values warn
  and fall back to the default); the 30 s ceiling stops a generous knob
  from masking a genuinely dead backend.

### 60-second sweep cadence on the in-memory invoice map
- **Where:** `artifacts/api-server/src/services/lightning.ts` L62–L79
  (sweep `setInterval`)
- **Why:** Worst-case overshoot is one sweep past `INVOICE_TTL_MS`,
  which is well inside the JWT clamp window. Faster cadence burns CPU
  for no benefit; slower cadence lets recovery codes outlive their paid
  window before GC.

### Mock backend is the only one that pays itself
- **Where:** `artifacts/api-server/src/services/lightning.ts` L368–L390
  (backend selection); the `dev-pay` route is in
  `artifacts/api-server/src/routes/paywall.ts`
- **Why:** `POST /paywall/dev-pay/:hash` is a local-dev / CI affordance.
  Real backends do not implement the dev-pay shape. The env-gated
  selection (`LIGHTNING_BACKEND`) is the safety; an unknown value
  throws at startup.

---

## Crypto (browser + shared protocol)

### ECDH on P-384, AES-GCM 256, fresh 12-byte IV per message
- **Where:** `artifacts/void-client/src/lib/signalCrypto.ts` L3 (`IV_BYTES`),
  L5–L43 (`encryptSignal` / `decryptSignal`), L45–L67 (P-384 keypair +
  raw export/import)
- **Why:** P-384 is the Web Crypto common denominator across our
  supported browsers without polyfills. The 12-byte IV is the AES-GCM
  spec default and is freshly random per message — do not reuse IVs and
  do not switch to a fixed nonce.

### HKDF salt is 32 zero bytes; two `info` strings domain-separate AES key from SAS bits
- **Where:** `artifacts/void-client/src/lib/signalCrypto.ts` L69–L70
  (`HKDF_INFO`, `SAS_HKDF_INFO`), L77–L128 (`deriveSessionKey`)
- **Why:** Both peers derive independently from shared ECDH bits — a
  random salt would require a separate exchange. RFC 5869's "salt not
  available" mode is a 32-byte zero salt; the input keying material is
  already high-entropy ECDH output. The two `info` strings give the AES
  key and the SAS bits independent KDF outputs.

### SAS truncation: high bits of a single big-endian uint32, two BIP-39 words
- **Where:** `artifacts/void-client/src/lib/signalCrypto.ts` L143–L154
  (rationale + extraction), L156–L159 (`sharedBits` zeroing)
- **Why:** Two BIP-39 words (11 bits each) extracted from a big-endian
  uint32: word 1 is bits 31..21 (`sasVal >>> 21 & 0x7FF`), word 2 is
  bits 20..10 (`sasVal >>> 10 & 0x7FF`). The shifts and mask are the
  load-bearing wire contract — changing them invalidates SAS
  verification across versions. The `sharedBits` buffer is zeroed
  best-effort before return. (Index-only — protocol-level invariant
  with no task / audit ref.)

### Argon2id parameters are fixed, with a fixed salt (replaced PBKDF2 from Task #23)
- **Where:** `lib/wire-core/src/argon2.ts` L1–L39
  (header + `ARGON2ID_ROOM_PARAMS`), L20–L23 (48-byte hash length
  matches the prior PBKDF2 layout exactly so the split-into-roomId+key
  logic does not change), L31–L33 (no PBKDF2 downgrade path),
  L41–L60 (`ROOM_DERIVATION_SALT` reused verbatim from the prior
  PBKDF2 derivation), L62–L92 (`deriveRoomBytesArgon2id`)
- **Why:** The browser client imports this single constant. Changing
  values requires re-deriving any pinned argon2id test vectors and
  updating the audit doc. The fixed salt is
  intentional — a per-room salt is structurally impossible since the
  phrase is the only shared secret. The PBKDF2 iteration count from
  Task #23 (the original derivation) is no longer the active
  derivation; the in-source comments at L20–L23 and L31–L33 document
  the migration so a contributor reading historical context understands
  why the layout matches PBKDF2 byte-for-byte but the algorithm does
  not. Do not introduce a downgrade / fallback path.

### `timingSafeStringCompare` length-fold pattern
- **Where:** `lib/wire-core/src/brand.ts` (`timingSafeStringCompare` —
  full docstring with the length-leak / length-fold rationale, and the
  implementation: encode → pad to common length →
  `crypto.timingSafeEqual` → AND with the `lengthsMatch` bool)
- **Why:** `crypto.timingSafeEqual` requires equal-length inputs.
  The two strings are encoded to UTF-8, padded to the longer length
  with zero bytes, compared in constant time, and the length match
  is folded in at the very end. Length itself still leaks (the
  encode + pad sees both lengths) — this is intentional and
  unavoidable in JS. For VOID's secret-class values (paywall JWT,
  recovery code, paymentHash) the lengths are fixed
  by format, so length-leakage is a non-event. (Indexed in
  docs/code-quirks-index.md.)

### TURN credential generation: ephemeral HMAC-SHA1 of `expiry:randomId`
- **Where:** `artifacts/api-server/src/routes/ice-servers.ts` L51–L83
  (mint), L14–L18 (TTL constants — `MIN_TTL=300`, `MAX_TTL=86400`,
  default = `ROOM_TTL_SECONDS + TTL_SAFETY_BUFFER` so credentials
  outlive a 65-min standard room with margin), L24–L31 (per-IP rate
  limit using `req.ip` against `trust proxy = 1`), L52–L75 (brand at
  declaration site so `Secret<string>` survives to the
  `crypto.createHmac` call); operator-side guard at
  `artifacts/api-server/src/lib/turnSecret.ts` L1–L13 (header)
  and L56–L69 (`assertTurnSecretNotPlaceholder`)
- **Why:** Coturn's "shared secret" credential mode (Task #8/#38).
  The username is `${expiry}:${randomId}`; coturn validates by
  computing HMAC-SHA1 of the username with the shared secret and
  comparing to the `credential` the client presents. The TTL clamp
  prevents an operator from accidentally minting credentials
  outliving the room they were issued for, which would let a
  ex-participant continue to use the relay forever. The
  placeholder-secret guard at boot prevents an open-relay outcome.
  Do not extract the unwrapped secret outside this route.

### Branded `Secret<T>` + `no-secret-equality` ESLint rule
- **Where:** `artifacts/api-server/src/lib/turnSecret.ts` L45–L54
  (`brandTurnSecret`), `lib/wire-core/src/brand.ts` (whole file),
  `lib/wire-core/src/hello-envelope.ts` L66–L75 (signature is
  `Secret<string>`); rule lives at `@workspace/secrets/no-secret-equality`
- **Why:** Plain `===` against a secret leaks length / prefix via early
  return. The brand survives through every consumer so the lint rule
  can flag the equality compare.

### TURN-secret placeholder guard at startup
- **Where:** `artifacts/api-server/src/lib/turnSecret.ts` L1–L13 (header),
  L16–L28 (placeholder list), L56–L69 (`assertTurnSecretNotPlaceholder`);
  call site at `artifacts/api-server/src/index.ts` L16–L34
- **Why:** Coturn accepts whatever secret it is given; the API server is
  the one party that derives ephemeral credentials from it. Booting with
  a documented placeholder mints valid credentials for any caller — an
  open relay. The placeholder list is intentionally over-broad. Same
  shape applied to `PAYWALL_SECRET` at `index.ts` L36–L56.

### `timingSafeStringCompare` is **not** re-exported from the barrel
- **Where:** `lib/wire-core/src/brand.ts`
  (`timingSafeStringCompare`, the `node:crypto` import); comment at
  `lib/wire-core/src/index.ts` L59–L67
- **Why:** Re-exporting it pulls `node:crypto` into the void-client
  Vite production bundle (rollup error: `"timingSafeEqual" is not
  exported by node:crypto`). Server consumers import the file
  directly. Do not add it to `index.ts`.

---

## Signaling / rooms (server)

### Per-room expiry timer with `createdAt` binding (Task #127)
- **Where:** `artifacts/api-server/src/rooms.ts` L213–L260 (`createRoom`),
  the captured-`createdAt` stale-timer guard at L231–L243
- **Why:** A room can be destroyed and recreated under the same `code`
  before the original `setTimeout` fires (host burns + repays, or expiry
  + recreate within the TTL window). The timer captures `createdAt` and
  no-ops if the current room's `createdAt` has changed. A plain
  `clearTimeout` reference covers explicit destroy but not the
  create-then-create race.

### Sweep safety net at fixed cadence
- **Where:** `artifacts/api-server/src/rooms.ts` L50–L64 (`GC_INTERVAL_MS`
  + rationale)
- **Why:** The per-room timer is the primary mechanism; the 30 s sweep
  is a safety net for long timers across system suspend/resume or any
  future bug that loses a room's `expiryTimer` reference.

### Room TTL is clamped, not extended unboundedly
- **Where:** `artifacts/api-server/src/rooms.ts` L50–L53 (TTL constants),
  L226–L229 (clamp inside `createRoom`); extension path mirrors at
  `artifacts/api-server/src/socketHandlers.ts` L811–L815 ("Mirror the
  create-room clamp (Task #127) on the extension path.")
- **Why:** Both create and extend clamp to `[ROOM_TTL_MIN_MS,
  ROOM_TTL_MAX_MS]`. The clamp is the enforcement point — there is no
  separate audit. Removing it lets a refreshed JWT outlive its invoice.

### Host claim is identity-bound, not socket-bound (Task #171 / M-02)
- **Where:** `artifacts/api-server/src/rooms/` — state shape + rationale on
  `hostReclaimTokenHashes` (`registry.ts`), `addHostReclaimToken`, `isRoomHost`,
  and `claimHost` (`registry.ts`)
- **Why:** Reconnects get a new socket id. Host claim requires
  possession of a JWT whose per-room **reclaim token** HMACs to a value in
  `hostReclaimTokenHashes` (the reclaim token is decoupled from the
  `paymentHash` so nothing payment-derived is stored — Task #886).
  Audit M-02: an early version auto-promoted "first user in an empty
  room" to host. That fallback is gone — see `isRoomHost` comment.

### Capacity cap of 4 is enforced server-side (Task #286)
- **Where:** `artifacts/api-server/src/rooms.ts` L1 (`MAX_USERS`),
  L551–L636 (`joinRoom`, especially the `>= MAX_USERS` check at L625),
  L80–L98 (global caps), L120–L138
  (`checkRoomCapacity`)
- **Why:** Client also enforces it. The cap is the contract — a
  hand-crafted socket client bypasses the client-side check.

### Single `rejectIfRoomExpired` guard fans out as ack vs. silent drop
- **Where:** `artifacts/api-server/src/socketHandlers.ts` L189–L215
  (helper + rationale on callback / silent-drop split)
- **Why:** Request/response events return `ROOM_EXPIRED` via ack.
  Fire-and-forget broadcasts (relay-signal, peer-media-state,
  leave-room, cancel-knock) drop silently to avoid a feedback storm on
  the way out. The helper collapses the
  ROOM_NOT_FOUND-after-GC race into the same code clients already
  handle.

### `request-screen-share` rate-limited per socket
- **Where:** `artifacts/api-server/src/socketHandlers.ts` L88
  (`EVENT_LIMITS["request-screen-share"]`), L1052–L1071
  (`request-screen-share` handler)
- **Why:** A peer can spam reservation attempts to deny others the
  slot. 5/min is the documented ceiling.

### Cap-rejection log lines are themselves rate-limited
- **Where:** `artifacts/api-server/src/socketHandlers.ts` L96–L114
  (`logCapRejection`)
- **Why:** Without this, an attacker driving the global cap to its
  ceiling could spam the operator's log at the create-room rate. One
  WARN per cap type per minute. The numeric counters in
  `getCapRejectionCounters()` remain the source of truth for "how
  many".

### Trust-proxy hops default to 1 (Task #256)
- **Where:** `artifacts/api-server/src/app.ts` L10–L22
- **Why:** Per-IP rate limiters on `/paywall/recover` and
  `/ice-servers` need the rightmost `X-Forwarded-For` entry — the one
  the trusted proxy added — not a leftmost value an untrusted client
  could spoof. Defaults match Replit's edge proxy and the documented
  nginx self-host setup. Override via `TRUST_PROXY_HOPS` for deeper
  chains.

---

## Build chain (void-client)

The `build` script in `artifacts/void-client/package.json` chains five
steps **in this exact order** (package.json cannot carry comments — the
rationale lives in each script's header docstring):

```
vite build
  → scripts/gen-og-rewrites.mjs
  → scripts/gen-og-pages.mjs
  → scripts/add-sri.mjs
  → scripts/add-modulepreload-sri.mjs
```

### Step-by-step rationale
- **`vite build`** (no comment needed — the standard tool).
- **`scripts/gen-og-rewrites.mjs`** L1–L17 (header) — regenerates the
  `[[services.production.rewrites]]` block in
  `.replit-artifact/artifact.toml` from `og-routes.mjs`. Must run
  *after* `vite build` so the dist exists, but *before* per-route HTML
  is stamped out. Sentinel-delimited targeted replacement so the rest
  of the TOML is untouched (L29–L70).
- **`scripts/gen-og-pages.mjs`** L1–L50 (header) — clones
  `dist/public/index.html` into one per-route HTML file with mutated
  `og:*` / `twitter:*` head metadata. Crawlers do not run JS, so a
  single SPA shell would show the landing card on every link. Strict
  mode (L24–L36) refuses relative `og:image` / `og:url` in production.
- **`scripts/add-sri.mjs`** L1–L52 (header) — hashes every
  `<script src>` and `<link rel="stylesheet"|"modulepreload">` against
  the on-disk asset bytes and injects `integrity="sha384-…"`. Must run
  *after* all HTML mutation (otherwise the cloned per-route HTMLs
  ship without integrity). In-tree, no plugin dependency.
- **`scripts/add-modulepreload-sri.mjs`** L1–L67 (header, including
  the canonical pipeline-order block at L42–L49) — closes the SRI
  coverage gap on dynamic-import chunks (Task #258). Walks the Vite
  manifest's dynamic-import closure and synthesises
  `<link rel="modulepreload" integrity>` tags. Idempotent via
  `BEGIN_MARKER` / `END_MARKER` (L83–L84, L190–L198). Splitting this
  from `add-sri.mjs` is intentional — see L35–L40.

### Both SRI scripts hash the **bundled** file, not the source
- **Where:** `add-sri.mjs` L77–L85 (`sriFor`), L97–L121
  (`resolveAssetPath`); `add-modulepreload-sri.mjs` L139–L162
- **Why:** Vite's content hash is in the filename, not in an
  `integrity` attribute by default. The SRI scripts close that gap so
  a CDN swap is detectable in the browser.

---

## Typecheck gates and shared composite libs (workspace)

The shared libs under `lib/` (`signaling-types`, `api-zod`,
`api-client-react`) are TypeScript **composite** projects: they
`emitDeclarationOnly` into a per-lib `dist/` directory, and that `dist/`
is **gitignored**. Consuming packages (every artifact) resolve these
workspace deps to the built `.d.ts` files, **not** the libs' `.ts`
source. So a package typecheck reads whatever is in `lib/*/dist` at that
moment.

### Every artifact `typecheck` builds the libs first

- **Where:** the `typecheck` script in each
  `artifacts/*/package.json` is prefixed with
  `pnpm -w run typecheck:libs && …` (root `typecheck:libs` is
  `tsc --build`, which builds the three composite libs via the root
  `tsconfig.json` project references). `scripts/post-merge.sh` runs the
  same `pnpm run typecheck:libs` as a warm-up.
- **Why:** on a fresh checkout `lib/*/dist` does not exist, and after the
  shared types are regenerated it is stale. Running a per-artifact gate
  (e.g. `api-server-typecheck`, `coordination-demo-video-typecheck`)
  against missing/stale dist fails with **TS6305** ("Output file … has
  not been built from source file …") — or, worse, passes green against
  stale declarations. Plain `tsc -p … --noEmit` does **not** build
  referenced projects, so the libs must be built explicitly. `tsc -b`
  (build mode, used by void-client) does build references, but the prefix
  is kept there too so the rule is uniform and copy-pasteable.
- **For new artifacts:** start the `typecheck` script with
  `pnpm -w run typecheck:libs &&` so the gate is correct on a clean
  checkout without a manual lib build. `tsc --build` is incremental, so
  the prefix is a no-op once `dist/` is fresh.

---

## Express middleware ordering (server)

### Strict order is enforced; comments in `app.ts` are normative (Task #256)
- **Where:** `artifacts/api-server/src/app.ts` L36–L86 (helmet),
  L88–L142 (`Permissions-Policy` + `Reporting-Endpoints`),
  L144–L148 (cors), L150–L151 (body parsers), L153 (routes),
  L155–L209 (static + per-route OG + SPA fallback),
  L211–L229 (custom 404 + error handlers)
- **Why:** Order is:

  1. helmet (CSP, HSTS, frame-ancestors)
  2. `Permissions-Policy` + `Reporting-Endpoints` headers
  3. cors
  4. `express.json` / `express.urlencoded`
  5. routes
  6. static + SPA fallback (self-host only)
  7. custom 404 handler
  8. custom error handler

  Specific quirks called out by inline comments:

  - **cors after Permissions-Policy** (L144–L148): preflight 204
    responses must carry the security headers. Browsers cache
    preflights aggressively; headers missing on preflight stay
    missing in the user's view.
  - **Custom 404 / error handlers after routes** (L211–L229):
    Express's default `finalhandler` overwrites helmet's CSP on
    4xx / 5xx. The custom handlers preserve every header helmet
    applied.
  - **CORP keyed off `SERVE_STATIC`** (L40–L43): same-origin under
    single-origin self-host; same-site otherwise. Both block
    cross-site embedders.
  - **CSP / Reporting-Endpoints both name the group `default`**
    (L65–L72, L128–L136): Permissions-Policy reports route to the
    Reporting API's `default` endpoint group (no per-policy
    directive on the header value itself), so a single ingestion
    endpoint covers both header families.

### Per-route OG manifest is loaded from disk, not hard-coded
- **Where:** `artifacts/api-server/src/app.ts` L159–L208
- **Why:** Adding a new marketing route is a void-client-only change
  (edit `og-routes.mjs`, rebuild). The server reads `og-routes.json`
  from the dist folder. Missing manifest warns loudly but does not
  fail boot — self-host operators may legitimately serve an older
  client build without the manifest.

---

## Wire-core protocol (shared library)

These are protocol-level quirks that live in `lib/wire-core/`
so the browser and the API server agree byte-for-byte.
Comments belong here, not in consumers.

### Wire format header & `roomId` semantics
- **Where:** `lib/wire-core/src/hello-envelope.ts` L1–L42
  (full module header)
- **Why:** The header is the canonical specification of the optional
  extension fields (`sessionId`, `ecdhFingerprint`, `roomId`),
  including why `roomId` is *optional in the schema, required in
  practice* — browsers always supply it because they ride the shared
  relay-signal socket; the verifier controls enforcement via
  `expectedRoomId` (L90–L94).

### `MAX_TIMESTAMP_SKEW_MS = 5 * 60_000`
- **Where:** `lib/wire-core/src/hello-envelope.ts` L57–L58
  (constant), L288–L292 (use site)
- **Why:** Five-minute clock-skew tolerance for hello replay
  protection. Tighter values break peers behind NTP-less networks;
  looser values widen the replay window. Paired with the per-session
  nonce.

### Nonces are 24 random bytes, base64url
- **Where:** `lib/wire-core/src/hello-envelope.ts` L57
  (`NONCE_BYTES`), L172–L176 (`generateNonce`)
- **Why:** 192 bits gives a comfortable margin against birthday
  collisions across a long-running session.

### Signing contexts are NUL-delimited literals
- **Where:** `lib/wire-core/src/schemas.ts` L108–L111
  (`SIGNING_CONTEXTS`); used by L154–L161 (`canonicalize` /
  `signingPayload`)
- **Why:** Domain separation between hello and envelope signing
  inputs. The literal `\0` separator is the contract; concatenating
  without one collides hello vs. envelope payloads of the right
  prefix.

### Ed25519 public keys travel as raw 32-byte SPKI, not PEM
- **Where:** `lib/wire-core/src/hello-envelope.ts` L18–L23
  (header note), L160–L170 (`generateSigningIdentity` raw export),
  L319–L329 (raw import on verify)
- **Why:** Smaller payloads on the signaling channel, trivial to
  fingerprint, and matches what browsers and Node webcrypto exchange
  natively. No `node:crypto` import keeps this module browser-safe.

### `verifySignedHello` throws `HelloVerificationError` (typed throw, not return union)
- **Where:** `lib/wire-core/src/hello-envelope.ts` L83–L88
  (error class), L271–L353 (`verifySignedHello`)
- **Why:** Verification failures are exceptional in the data-flow
  sense — the only correct caller response is teardown
  (`webrtc.ts:initiateOffer` L699–L726). A return-type union invites
  callers to handle "failed but continue" paths the threat model
  forbids. See M-01.

### Canonical JSON via sorted-keys before signing
- **Where:** `lib/wire-core/src/schemas.ts` L141–L156
  (`sortKeys` + `canonicalize`)
- **Why:** Field order is part of the wire format. Two
  implementations that disagree on key order produce different
  signing inputs and verification fails. `JSON.stringify` is
  insertion-ordered in ES2020+ but two encoders do not necessarily
  insert in the same order — sort is the contract.

---

## Accessibility (browser)

### In-room overlays use the dialog / alertdialog pattern with focus trap (Task #287, Task #309)
- **Where:**
  - `artifacts/void-client/src/lib/useDialogFocusTrap.ts` — shared hook.
  - `artifacts/void-client/src/components/BurnedOverlay.tsx` (`alertdialog`,
    `aria-live="assertive"`, no trap — auto-dismisses).
  - `artifacts/void-client/src/components/SasVerificationDialog.tsx`
    (`dialog`, modal + own focus-trap implementation; reference pattern).
  - `artifacts/void-client/src/components/DeadRoomOverlay.tsx`
    (`alertdialog`, modal, Escape → BACK TO MENU).
  - `artifacts/void-client/src/pages/RoomPage.tsx`:
    - `session-ended-overlay` — `alertdialog`, `aria-live="assertive"`,
      no Escape (terminal screen).
    - `media-error-overlay` — `alertdialog`, modal, Escape → goBack.
    - `knock-pending-overlay` — `dialog`, modal, Escape → cancel knock.
    - `share-warning-dialog` — `alertdialog` (warns about screen-share
      side-effects), modal, Escape → cancel.
    - `pending-share-dialog` — `alertdialog` for full-screen captures
      (loud risk), `dialog` for window/tab captures (preflight only),
      modal, Escape → cancel.
- **Why:** Each of these overlays is a persistent, focus-stealing
  surface that screen-reader users would otherwise miss or escape into
  the still-rendered page underneath. The role choice is
  consequence-driven: `alertdialog` for screens that announce a state
  change the user did not initiate (BURN, SESSION ENDED, ROOM DEAD,
  media error, screen-share risks); plain `dialog` for prompts where
  the user is the actor (KNOCKING wait state, preflight share check on
  a window/tab). The shared `useDialogFocusTrap` hook keeps Tab cycling
  inside each overlay and restores focus to the trigger on unmount,
  matching `SasVerificationDialog`'s long-standing behavior. Escape is
  wired to the safest dismissal path per overlay; SESSION ENDED
  intentionally has none because the room is gone.
