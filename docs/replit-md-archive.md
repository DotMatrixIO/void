# VOID — Detailed Reference (relocated from replit.md)

Deep-detail reference relocated out of `replit.md` (Task #1140) so the agent-facing README stays compact. Wording preserved from the original. The compact index in `replit.md` points here. Where a section duplicates `VOID_TECHNICAL_OVERVIEW.md`, the overview is the richer source — this file preserves the working-notes form.

Contents:
- [Room System Architecture](#room-system-architecture)
- [Privacy Features](#privacy-features)
- [WebRTC / ICE Configuration](#webrtc--ice-configuration)
- [Lightning Paywall](#lightning-paywall)
- [E2E Encrypted Signaling](#e2e-encrypted-signaling)
- [Security](#security)
- [PWA](#pwa)
- [URL Routing](#url-routing)
- [Per-Route Open Graph Cards](#per-route-open-graph-cards)
- [CI — SRI Build-Freshness Gate](#ci--sri-build-freshness-gate)
- [Strategy & Marketing / Onboarding Audit](#strategy--marketing)
- [Self-hosting (Sovereign Packaging)](#self-hosting-sovereign-packaging)
- [CI — Self-host container build & smoke](#ci--self-host-container-build--smoke)
- [CI — API Spec Drift Check](#ci--api-spec-drift-check)
- [CI — AsyncAPI Signaling Drift Check](#ci--asyncapi-signaling-drift-check)
- [CI — Routes vs Technical-Overview Drift Check](#ci--routes-vs-technical-overview-drift-check)
- [Known gaps from Task #464 (resolved)](#known-gaps-from-task-464-deferred-not-blocking)

## Room System Architecture

### Server-side (artifacts/api-server)
- `src/rooms.ts` — In-memory room state management (Map<roomId, RoomState>)
  - `createRoom(roomId, relayOnly, hostSocketId, roomType)` — Creates room with capacity 4, tracks host identity; `roomType` is `"human"` (the only room type); sets per-room expiry timer (setTimeout at ROOM_TTL_MS) with stale-timer protection via createdAt binding
  - `joinRoom()` — Enforces 4-person capacity, checks locked/knock/expired state
  - `isRoomExpired(code)` — Checks if room exists and is past its expiresAt timestamp
  - `lockRoom()` / `unlockRoom()` — Host-only room lock/unlock
  - `setKnockMode()` / `approveKnock()` / `denyKnock()` — Host-only knock-to-enter moderation
  - `isRoomHost()` — Checks if socket is room creator (first user)
  - `removePendingKnockBySocket()` — Cleanup stale knocks on cancel/disconnect
  - `leaveRoom()` / `leaveAllRooms()` — Cleanup on disconnect, auto-unlock/un-knock if owner leaves
  - `destroyRoom()` — Clears pruneTimer, expiryTimer, and screenShareReservationTimer
- `src/index.ts` — HTTP + Socket.io server with IP-based rate limiting
  - Socket events: `create-room` (accepts `{ roomId, token, relayOnly }`, validates JWT, checks roomId is 32-char hex), `join-room`, `leave-room`, `lock-room`, `unlock-room`, `set-knock-mode`, `approve-knock`, `deny-knock`, `cancel-knock`
  - Broadcast events: `peer-joined`, `peer-left`, `room-locked`, `room-unlocked`, `knock-request`, `knock-mode-changed`, `knock-approved`, `knock-denied`
  - All room-scoped handlers enforce expiry via `isRoomExpired()` guard — returns ROOM_EXPIRED for callbacks, silently drops fire-and-forget events
  - Rate limits: per-socket + per-IP join rate limiting, exponential backoff on failures, max 10 connections per IP; `request-screen-share` rate-limited to 5/min
- `src/routes/ice-servers.ts` — `GET /api/ice-servers` returns STUN + optional TURN with HMAC-SHA1 ephemeral credentials
- `src/routes/paywall.ts` — Lightning L402 paywall (invoice creation, payment verification, JWT token)
- `src/services/lightning.ts` — Lightning backend adapters (mock, LNbits, BTCPay Server) selected via `LIGHTNING_BACKEND` env var

### Client-side (artifacts/void-client)
- `src/lib/socket.ts` — Socket.io client singleton with auto-reconnect
- `src/lib/sounds.ts` — Web Audio API chiptune sound effects (bleep, bloop, click, selectClick, slide, printerSound)
- `src/lib/webrtc.ts` — WebRTCManager: dynamic ICE servers, per-peer connection state tracking, E2E encrypted signaling, screen share track replacement (`replaceVideoTrack`/`clearVideoOverride`/`overrideVideoTrack` field; `buildPC` uses override track for new peers)
- `src/lib/voidPhrase.ts` — BIP39 Void Phrases: `deriveRoomCredentials(invite)` derives the roomId + AES-256 `e2eKey` from a 6-word phrase via the shared `@workspace/wire-core` argon2id primitive (m=64MiB, t=3, p=1); `generateVoidPhrase()`, `validateVoidPhrase()`, `parseHashPhrase()`, `phraseToHash()`
- `src/lib/signalCrypto.ts` — AES-GCM 256-bit E2E encryption: encrypt/decrypt with Base64url(IV+Ciphertext) wire format + ECDHE P-384 key generation, export/import, and HKDF session key derivation for Perfect Forward Secrecy
- `src/lib/mediaPipeline.ts` — WebGL2 320×240 @ 15fps privacy-aware video pipeline with 6 modes in a single fragment shader (uniform int u_mode branching): Clear (natural color passthrough), Gold Voyager (duotone), Pixel Mosaic (40×30 nearest-neighbor), Contour (Sobel edge detection), Silhouette (luma threshold), ASCII (font atlas character render). Additional uniforms: u_font_atlas (TEXTURE1), u_time. Audio chain: mic → gain → noiseGate → highpass → compressor → pitchShifter → lowpass @ 8000Hz → analyser → dest
- `src/lib/palettes.ts` — Shared palette definitions (10 palettes, all unlocked)
- `src/lib/caseThemes.ts` — Case color themes (13 themes, all unlocked). CaseTheme interface with CSS var overrides for all shell colors, optional `overlay` (CSS background-image for decorative patterns), optional `shimmer` (boolean for metallic sweep animation)
- `src/components/ClearPCB.tsx` — Inline SVG component rendering fictional PCB internals for the CLEAR transparent case variant
- `src/pages/LandingPage.tsx` — Dark-themed landing/splash page with install prompts and LAUNCH APP button. Footer links to /why, /compare
- `src/pages/StartScreen.tsx` — Home screen: NEW SESSION (generates void phrase + pays), JOIN SESSION (enter 6-word phrase), SCAN A ROOM QR (opens camera scanner via lazy-loaded `QrScannerModal`), Hide IP toggle, mic selection
- `src/components/QrScannerModal.tsx` — Camera-based QR scanner (lazy-loaded, wraps `qr-scanner` library). Decodes Void room URLs / phrase-hash QRs via `lib/parseRoomQr.ts`; handles permission-denied / no-camera / unsupported errors with explicit copy; dismissible via Escape, close button, or cancel button.
- `src/lib/parseRoomQr.ts` — Extracts a Void phrase from scanned QR data (full URL hash, bare hash fragment, or bare dashed phrase). Returns `null` for anything that is not a valid 6-BIP39-word room reference.
- `src/pages/RoomPage.tsx` — In-room UI: void phrase header, video grid, controls (CAM/MIC/STYLE/VOICE), room lock/unlock/knock, share link (copies phrase URL), E2E encrypted indicator. Hosts also see a one-shot, dismissible expiry-warning toast at a tier-scaled lead time (10m for STANDARD, 30m for DAY) — see `src/lib/expiryWarning.ts` (Task #118).
- `src/lib/expiryWarning.ts` — Pure helpers (`getExpiryWarnLeadMs`, `shouldFireExpiryWarning`) used by RoomPage to fire the host wrap-up toast exactly once per session. Covered by `src/lib/expiryWarning.test.ts` (Vitest).
- `src/pages/WhyPage.tsx` — `/why` — "We didn't make a promise. We made a proof." Technical manifesto with VOID Phrase, encryption, video filters, voice masks, stateless architecture sections
- `src/pages/ComparePage.tsx` — `/compare` — "Why Not Zoom, Signal, or Jitsi?" Character-driven comparison essay (Gerald/Zoom, Rosalind/Signal, Damian/Jitsi). CTAs link to /, /threat-model
- `src/pages/ThreatModelPage.tsx` — `/threat-model` — Full threat model: Howard parable, threat actor taxonomy, what VOID protects (teal) / doesn't protect (red) / partially protects (gold), the Duet SAS verification, honest summary. CTAs link to /, /compare
- `src/pages/BiometricPage.tsx` — `/biometric-masking` — Biometric masking deep-dive: Patricia parable, what a biometric asset is, all 6 video modes (Clear through ASCII) with preserves/destroys for each, all 5 voice modes (Voice through Combined), local processing explanation, honest limitations, "reduced exposure" framing. CTAs link to /, /threat-model, /compare
- `src/App.tsx` — URL hash phrase routing (`#word1-word2-word3-word4-word5-word6`), derives roomId+e2eKey via PBKDF2, landing page gate

## Privacy Features

### Video Style Modes (GOLD / MONO / GHOST button)
Cycled via the style button in the in-call control bar.

- **CLEAR (mode 0, default)** — Unmodified natural color passthrough. No filters, no stylization. Still 320×240 @ 15fps.
- **GOLD (mode 1)** — Gold Voyager duotone: luminance gradient map from theme dark (#1E1A14) to gold (#E8A200). Degrades facial recognition signal while keeping faces human-readable.
- **PIXEL (mode 2)** — 40×30 pixel mosaic with orange-tinted duotone palette. Presence without detail.
- **CONTOUR (mode 3)** — Sobel edge detection, white outlines on black. Silhouette only.
- **SILHOUETTE (mode 4)** — Grayscale luma threshold mask. Shape remains, features do not.
- **ASCII (mode 5)** — 16-character font atlas mapping via luma in a 3×5 cell grid.
- All modes processed at 320×240 @ 15fps via WebGL2 fragment shader (GPU-only, no CPU pixel loops).
- WebRTC sender constraints: `maxBitrate: 200000` (200 Kbps), `maxFramerate: 15`.

### Audio Pipeline
Full chain: Mic → GainNode (0.8) → **Noise Gate** (AudioWorklet) → Highpass (300Hz) → DynamicsCompressor → [PitchShifter] → Lowpass (8kHz) → AnalyserNode → MediaStreamDestination.

- **Noise Gate** (`public/noise-gate-processor.js`): AudioWorklet with threshold -45dB, attack 5ms, release 50ms. Runs on audio rendering thread (immune to UI/WebGL jank). Kills background noise/keyboard bleed when not speaking. Reports gate open/closed state via message port for VU meter integration.
- **SDP Opus Bitrate Clamping**: Intercepts SDP offer/answer, dynamically parses Opus payload type, appends `maxaveragebitrate=24000;stereo=0;sprop-stereo=0`. Caps audio at 24kbps mono — saves significant bandwidth across 6 mesh connections with no quality loss given 8kHz lowpass.
- **VU Meter**: 5-block horizontal bar in each participant's video panel. Local uses AnalyserNode from pipeline; remote peers get separate AnalyserNode per incoming stream. Updates at ~10fps via requestAnimationFrame with frame skip. Shows zero when local noise gate is closed.
- **Input Device Selection**: StartScreen shows mic dropdown (if multiple audioinput devices detected). Selected deviceId passed as exact constraint to getUserMedia. Skipped if permissions not granted (labels empty).
- **Headphone Warning**: Static `[ WARNING: HEADPHONES HIGHLY RECOMMENDED TO PREVENT FEEDBACK ]` on StartScreen, styled with --burnt token. No programmatic detection.

### Voice Masking Modes (VOICE button)
Cycled via the **VOICE** pill button in the in-call controls (cycles through 7 modes).

- Single unified AudioWorklet processor (`public/voice-mask-processor.js`) wired between compressor and low-pass filter in a static audio graph.
- **Mode 0 — VOICE**: Passthrough (no effect).
- **Mode 1 — VOICE -4**: OLA pitch shift −4 semitones (512-sample Hann grains, 50% overlap, ratio ≈ 0.7937).
- **Mode 2 — DEEP**: OLA pitch shift −8 semitones (ratio ≈ 0.6300).
- **Mode 3 — FORMANT**: Two-pass OLA — pitch down −5 st then formant up +3 st, with 0.35 Hz LFO wobble (±1 semitone depth).
- **Mode 4 — VOCODER**: Single-band vocoder with sawtooth carrier (120 Hz base), bandpass 300–3400 Hz, RMS envelope modulation.
- **Mode 5 — SCRAMBLE**: Fixed-size grain shuffle (512-sample Hann-windowed grains, 8-grain pool, Fisher-Yates shuffle, 50% overlap-add).
- **Mode 6 — WHISPER**: ZCR-based voiced/unvoiced detection (threshold 0.3, RMS gate 0.005). Voiced frames: 4-band spectral envelope matching (BPF at 0–500, 500–1500, 1500–4000, 4000–8000 Hz) shapes white noise through matching filters with smoothed amplitude tracking. Unvoiced frames: passed through at 0.8× gain.
- Mode switch via `port.postMessage({ type: "mode", value })` — no graph mutations. All internal buffers reset on mode change.
- Graceful degradation if AudioWorklet unavailable.

## WebRTC / ICE Configuration

### TURN Server (HMAC-SHA1 ephemeral credentials)
Set two environment variables to activate TURN support:
- `TURN_URL` — e.g. `turn:relay.example.com:3478`
- `TURN_SECRET` — shared secret for HMAC-SHA1 credential generation (matches coturn `static-auth-secret`)
- `TURN_CREDENTIAL_TTL` — optional, credential TTL in seconds (default: 4500 = room TTL 65min + 10min safety buffer, range 300-86400)

When configured, `GET /api/ice-servers` returns STUN + TURN with short-lived HMAC-SHA1 credentials plus `ttl` and `expiresAt` fields. Relay-only mode is opt-in via `?relay=1` query param (used when "Hide my IP" is toggled on).

### Dev / no-TURN mode
When TURN vars are absent, the endpoint returns Google STUN only. The client uses `iceTransportPolicy: "all"` (default). Peers connect directly.

### Credential TTL Alignment
The default TURN credential TTL (4500s) exceeds the room TTL (3900s) by a 10-minute safety buffer. This prevents late-session ICE restart failures when TURN credentials expire before the room does. The `expiresAt` Unix timestamp is returned to clients for credential refresh awareness.

## Lightning Paywall

Room creation requires a Lightning payment (1,000 sats/hour). Backend adapters selected via `LIGHTNING_BACKEND` env var:
- `mock` (default) — In-memory mock invoices with dev-pay endpoint (non-production only)
- `lnbits` — Requires `LNBITS_URL` + `LNBITS_API_KEY`
- `btcpay` — Requires `BTCPAY_URL` + `BTCPAY_API_KEY` + `BTCPAY_STORE_ID`

`PAYWALL_SECRET` — JWT signing key. If not set, generates ephemeral secret at startup (tokens invalidated on restart, by design for single-instance deployments).

## E2E Encrypted Signaling

- All rooms are E2E encrypted by design via BIP39 Void Phrase derivation
- **Perfect Forward Secrecy (PFS)**: ECDHE P-384 ephemeral keypair exchange before SDP signaling. Initial key exchange authenticated by phrase-derived AES key. Session key derived via ECDH + HKDF-SHA256 → AES-GCM-256. Ephemeral private keys dereferenced on WebRTC "connected" state. 5-second timeout with graceful fallback to phrase-key-only encryption.
- AES-GCM-256 key derived client-side from phrase via PBKDF2 (600k iterations); key never touches the server
- All relay-signal payloads encrypted as `Base64url(12-byte IV + AES-GCM ciphertext)`
- Fresh 96-bit IV generated via `crypto.getRandomValues()` per `encryptSignal` call
- Decrypt failures silently dropped (wrong key = no connection, not a crash)
- Void phrase stored only in React memory + URL hash fragment; never in localStorage/sessionStorage

## Security

- **HTTP Headers (Helmet)**: CSP (`default-src 'self'`, `connect-src 'self' wss: ws:`, `style-src 'self' 'unsafe-inline'`, `worker-src 'self' blob:`, `media-src 'self' blob: mediastream:`), `X-Frame-Options: DENY`, HSTS (1 year, includeSubDomains, preload)
- **Socket.io payload limit**: `maxHttpBufferSize: 10000` (10KB) — prevents large-payload DoS
- **Room TTL**: 65-minute hard TTL with 5-minute GC sweep; rooms auto-deleted regardless of activity
- **Empty room pruning**: 3-minute countdown when peers drop to 0; cancelled if a new peer joins before timer fires
- **CORS**: Locked to production domain + dev domain (no wildcards)
- **Rate limiting**: Per-socket rate limiting on `create-room` (10/min), `join-room` (10/min), `relay-signal` (200/10s)
- **IP rate limiting**: Per-IP join rate limit (5/min), max 10 concurrent connections per IP
- **Join failure backoff**: Exponential backoff on failed join attempts (3 failures/min threshold)
- **Input validation**: Room IDs validated as 32-char lowercase hex; peerId format enforced `peer-[a-z0-9]{6}`
- **Signaling auth**: relay-signal verifies sender membership in room
- **Screen share**: One-at-a-time server-arbitrated screen sharing; `getDisplayMedia` capture (1280×720 max, 8-10fps, `contentHint: "detail"`); replaces camera track via `replaceVideoTrack` (bypasses shader pipeline); pre-share camera state preserved and restored on stop; `track.onended` auto-cleanup; server events: `request-screen-share`, `screen-share-started`, `screen-share-stopped`, `screen-share-state`; 12s reservation TTL; CAM/STYLE buttons disabled during share; SCREEN button shows share state
- **Knock-to-enter**: Host-only moderation — only room creator can approve/deny/toggle knock mode
- **ICE credentials**: HMAC-SHA1 ephemeral credentials, never stored in frontend code
- **WebGL cleanup**: `WEBGL_lose_context` extension called on pipeline teardown to free GPU memory
- **E2E encryption**: AES-GCM-256 signaling encryption with key derived from void phrase (never on server)
- **Error boundaries**: All `crypto.subtle` operations and WebRTC signaling wrapped in try/catch; failures silently dropped
- **Zero console leakage**: No console.log/warn/error of cryptographic material, SDP, or JWTs in source

## PWA

- `public/manifest.json` — PWA manifest (name: 2bit, standalone display)
- `public/sw.js` — Service worker (stale-while-revalidate for assets, network-first for pages, cache name: `2bit-v1`)
- `public/icon-192.png`, `public/icon-512.png` — App icons
- iOS/Android install prompts in LandingPage.tsx
- Standalone mode skips landing page
- Font loading uses `display=swap` for FOUT over FOIT

## URL Routing

- `/` — Landing page (first visit) → Start screen (after LAUNCH APP)
- `/#word1-word2-word3-word4-word5-word6` — Auto-derive and join via BIP39 void phrase (bypasses landing page)

## Per-Route Open Graph Cards

The 6 marketing routes each ship their own social-preview card so links shared on Facebook/Twitter/X/Slack/iMessage show route-specific copy + imagery instead of the generic landing card.

- **Routes**: `/`, `/compare`, `/threat-model`, `/pricing`, `/biometric-masking`, `/limits`
- **Single source of truth**: `artifacts/void-client/scripts/og-routes.mjs` — title/description/headline/accent per route + Gold Voyager `PALETTE` export
- **Image generation**: `artifacts/void-client/scripts/gen-og-images.mjs` — renders 1200x630 PNGs via sharp+SVG using Staatliches (headline) + JetBrains Mono (body). Auto-converts `public/fonts/*.woff2` → TTF in `~/.fonts/` because librsvg can't read woff2. Outputs to `public/og/<slug>.png`. Run via `pnpm --filter @workspace/void-client run gen:og`
- **Per-route HTML**: `artifacts/void-client/scripts/gen-og-pages.mjs` — runs after `vite build`. Reads `dist/public/index.html`, regex-rewrites the og:* / twitter:* / `<title>` / description tags, writes one `<slug>.html` per non-landing route. Origin resolved from `PUBLIC_ORIGIN` → `REPLIT_DOMAINS` → relative (loud warning). Source `index.html` carries comment annotating regex-coupling assumptions
- **Strict mode**: when `NODE_ENV=production` or `OG_STRICT=1` is set, `gen-og-pages.mjs` exits non-zero instead of falling back to relative URLs (Facebook/X/Slack/iMessage all reject relative og:image / og:url, which would silently break every social card). Production deploys set `OG_STRICT=1` explicitly via `artifacts/void-client/.replit-artifact/artifact.toml`'s `[services.production].build`, so the guard fires even if `NODE_ENV` isn't propagated to the build step. Local `pnpm build` keeps the warn-and-continue behaviour
- **Origin validation**: `PUBLIC_ORIGIN` (and the `REPLIT_DOMAINS`-derived value) is validated by `validateOrigin()` before use. A value must (a) parse as a valid URL, (b) use an `http` or `https` scheme, and (c) have no path component (pathname must be exactly `"/"`). Examples that fail: `void.example.com` (missing scheme), `ftp://void.example.com` (wrong scheme), `https://void.example.com/app/` (non-root path). In strict mode a malformed value exits non-zero with a message naming the offending value; in dev mode it warns and falls back to relative URLs, identical to the no-origin-set behaviour
- **Routing**: production static-serve uses per-route rewrites in `artifacts/void-client/.replit-artifact/artifact.toml` (`/compare → /compare.html` etc, before `/* → /index.html` catch-all). Self-host `SERVE_STATIC=1` mode in `artifacts/api-server/src/app.ts` mirrors the same dispatch table with index.html fallback if a per-route file is missing
- **Adding a route**: append entry to `og-routes.mjs`, run `pnpm gen:og`, add a rewrite to both `artifact.toml` and `app.ts` `ogRouteFiles` map

## CI — SRI Build-Freshness Gate

- `artifacts/void-client/src/__tests__/sri.test.ts` verifies the post-build SRI pipeline (`add-sri.mjs`, `add-modulepreload-sri.mjs`, `gen-sw-known-hashes.mjs`) actually ran and that every emitted HTML + the SW known-hashes table carry correct sha384 baselines.
- **Why STRICT_SRI=1 is wired into the `void-client-tests` validation workflow**: when `dist/public/` is missing the SRI suite self-skips, and when `dist/` is stale it can fail with an opaque message — either way a real regression could slip through CI on a stale build. `STRICT_SRI=1` flips the self-skip-on-missing-build behaviour into a hard failure with an actionable message ("run `pnpm --filter @workspace/void-client build` before tests"), so the pre-deploy gate cannot pass on a missing or partial build. The `test` script already runs `pnpm run build && vitest`, so under normal CI the build is fresh; STRICT_SRI is the belt-and-suspenders guard against any future change that decouples build from test or a build that succeeds but emits incomplete SRI output.
- Local `pnpm --filter @workspace/void-client test` (without `STRICT_SRI`) keeps the skip-on-missing-build convenience for fast iteration.

## Strategy & Marketing

- The canonical marketing-vision and positioning notes for the human-facing product — core positioning ("Meet in real time. Leave less behind."), target archetypes (Sovereign Host, Pseudonymous Collaborator, High-Discretion Earner), the five human needs VOID meets, aesthetic-as-strategy principles, phased GTM plan (comparison manifesto first), growth model (host as distribution unit), and explicit anti-patterns — anchor all branding, messaging, audience, and go-to-market decisions.

## Onboarding Audit

- The first-60-seconds onboarding audit — three annotated walkthroughs (host happy path, joiner happy path, failure modes for non-technical users) of the first minute of contact with VOID, followed by a numbered friction list — feeds the launch checklist. Findings only — fixes are out of scope.

## Self-hosting (Sovereign Packaging)

- `app.ts` supports `SERVE_STATIC=1` + `CLIENT_DIST` env vars for Express to serve Vite dist in production
- `Dockerfile` — Multi-stage Node.js build (frontend + backend → single production image)
- `docker-compose.yml` — VOID + Coturn services
- `coturn/turnserver.conf.example` — Coturn config template; operator copies to `coturn/turnserver.conf` (gitignored). API server refuses to start if `TURN_SECRET` is left at the placeholder (see `artifacts/api-server/src/lib/turnSecret.ts`).
- `umbrel-app.yml` — Umbrel community app store manifest
- `manifest.yaml` — StartOS service manifest
- `README-selfhost.md` — Complete self-hosting guide
- The public-launch checklist — the launch threshold for the project itself (not the self-host production checklist), with numbered gates each carrying a one-line definition-of-done and a check-date column, plus a goalposts-locked clause dated to its creation — reconciles with the won't-fix list on `ThreatModelPage` (Task #319).
- `docs/launch-rehearsal-2026-05-03.md` — Seed dress-rehearsal retro (Task #320). Records the four-hour rehearsal window held 2026-05-03, the Scenario-4 incident walk against `docs/incident-response.md`, the honest two-people-agree pass over the launch checklist, and the paper-only stand-in for the outsider-onboarding exercise. The "what broke" section is the rehearsal-done triage that the launch checklist item 16 tracks; a second rehearsal inside the two-week-to-one-week window before the chosen launch date is required to satisfy that gate.
- `docs/incident-response.md` — Launch-window runbook (Task #317). Four scenarios — Lightning backend down, signaling-server crash mid-session, room spam/abuse, bad-faith participant recording — plus a catch-all section. Each scenario carries Symptom → Immediate triage commands → send-ready user-facing comms drafts (status banner, Nostr/tweet, longer write-up) → Mitigation actions → "What this surfaces about VOID" line that maps to a `ThreatModelPage` paragraph or won't-fix item. Comms-and-ops doc; not engineering work on the underlying weaknesses.
- CORS auto-allows all origins when `SERVE_STATIC=1` (self-hosted mode)

## CI — Self-host container build & smoke

- `.github/workflows/docker-build.yml` — GitHub Actions workflow triggered on push/PR to `main` when Docker/build-input files change (`Dockerfile`, `docker-compose.yml`, `.dockerignore`, the lockfile/workspace manifests, `artifacts/void-client/**`, `artifacts/api-server/**`, `lib/**`, `docs/**`, `VOID_TECHNICAL_OVERVIEW.md`), plus a nightly run and manual `workflow_dispatch`.
- Reproduces the canonical self-host path (`docker compose up -d --build`) from a **fresh checkout**: the build context is a `git archive` of `HEAD` (only committed files), so an under-copied build input or reliance on an untracked/generated file fails loudly — the same class of silent breakage (corepack signing-key rotation, missing `docs/`/`tsconfig.base.json`/`lib/` sources, missing workspace `package.json` manifests) that previously only surfaced when a human ran the compose build by hand.
- Writes a clearnet Quick Start `.env` (`NODE_ENV=development`) so the onion-bake guard relaxes and no `.onion` host is required; the container still **runs** as `NODE_ENV=production` (hardcoded in compose).
- Asserts **serving**, not just booting: `GET /api/health` returns 200, root serves the real app shell (`<div id="root">`), and the referenced hashed `/assets/*.js` entry bundle loads non-empty — catching a build that succeeds but ships a broken/empty frontend.
- Keeps the non-root runtime guard (audit §7.1): live PID 1, `docker exec id`, and a fresh launch of the built image must all run as `node`.

## CI — API Spec Drift Check

- `.github/workflows/api-spec-drift.yml` — GitHub Actions workflow triggered on push/PR to `main` when `lib/api-spec/**`, `lib/api-zod/**`, `lib/api-client-react/src/generated/**`, `artifacts/api-server/**`, or the lockfile change.
- Two sequential jobs:
  1. **`codegen-drift`** — re-runs `pnpm --filter @workspace/api-spec run codegen` and then `git diff --exit-code` against `lib/api-zod/src/generated` and `lib/api-client-react/src/generated`. Fails if the regenerated output diverges from what is committed (i.e. someone changed `openapi.yaml` or upgraded orval without re-running codegen).
  2. **`runtime-schema-smoke`** — runs `pnpm --filter @workspace/api-spec run smoke`, which builds the api-server, spawns it in mock-Lightning / development mode, then for every documented `operationId` in `openapi.yaml` (`healthCheck`, `healthCheckAlias`, `createInvoice`, `getPaymentStatus`, `recoverPaidWindow`, `devSimulatePayment`, `getIceServers`) issues a real HTTP request and validates the response body against the matching generated Zod schema in `lib/api-zod/src/generated/api.ts`. Catches the case where an Express handler quietly returns a shape different from what the spec promises — the inverse of what `codegen-drift` catches. The script chains `createInvoice → devSimulatePayment → getPaymentStatus → recoverPaidWindow` so the recovery route is hit with a real, just-minted code. Implemented in `lib/api-spec/scripts/smoke.ts`.
- **What to do when `codegen-drift` fails:** run `pnpm --filter @workspace/api-spec run codegen` locally and commit the regenerated files in `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/`. The CI failure log prints the same instruction.
- **What to do when `runtime-schema-smoke` fails:** the log prints, per failing operation, the offending response body and the per-issue Zod parse errors (path + code + message). Either fix the handler in `artifacts/api-server/src/routes/` to match the spec, or — if the spec change is intentional — update `lib/api-spec/openapi.yaml` and re-run codegen.

## CI — AsyncAPI Signaling Drift Check

- `.github/workflows/asyncapi-spec-drift.yml` — GitHub Actions workflow triggered on push/PR to `main` when `lib/api-spec/asyncapi.yaml`, the drift script, the api-server src, the void-client src, or the lockfile change.
- Runs `pnpm --filter @workspace/api-spec run check-asyncapi`, which executes `lib/api-spec/scripts/check-asyncapi-drift.mjs`. The script enumerates every Socket.io `socket.emit("…")` / `socket.on("…")` (also `io.to(…).emit`, `socket.broadcast.emit`, etc.) call site in `artifacts/api-server/src/**` and `artifacts/void-client/src/**` (production source only — `__tests__/`, `*.test.tsx`, `*.spec.ts` are excluded), filters out Socket.io built-ins (`connect`, `disconnect`, `reconnect`, …), and diffs the resulting set of kebab-case event names against every `address:` declared in `lib/api-spec/asyncapi.yaml`.
- The job fails if either side of the diff is non-empty:
  - **Code → spec drift**: a new `emit`/`on` exists with no matching channel in the AsyncAPI spec.
  - **Spec → code drift**: a channel is declared in the spec that no production source actually emits or subscribes to.
- **What to do when this check fails:** add (or remove) the channel + operation + message entries in `lib/api-spec/asyncapi.yaml` so the spec and source agree, then re-run `pnpm --filter @workspace/api-spec run check-asyncapi` locally to confirm. The CI failure log lists every offending event name with the source files that reference it. If the new event name is genuinely internal (e.g. an EventEmitter call that happens to look like a Socket.io event), rename it or quote it differently so the kebab-case filter doesn't pick it up.

## CI — Routes vs Technical-Overview Drift Check

- `artifacts/void-client/scripts/check-routes-overview-drift.mjs` — sibling drift check to the AsyncAPI one above, but for the void-client router and `VOID_TECHNICAL_OVERVIEW.md` §6.2 ("Page Structure"). Reconciles the route list in code with the route list in the documentation introduced in Task #325 (which removed `/music` and gated `/agents`; `/agents` has since been removed entirely).
- The script enumerates every `<Route path="…">` declaration in `artifacts/void-client/src/App.tsx`, classifies each as production or DEV-gated (DEV-gated = wrapped in `{import.meta.env.DEV && (…)}` within a 5-line lookback — e.g. the smoke-harness routes), and diffs the production set against every backticked route literal in the §6.2 markdown table.
- The job fails if either side of the diff is non-empty:
  - **Code → overview drift**: a `<Route>` exists with no §6.2 row, OR exists with a §6.2 row that is struck-through / marked "Hidden in vX" (i.e. the overview asserts the route is gated out but the router still serves it).
  - **Overview → code drift**: a §6.2 row references a route with no matching `<Route>` in `App.tsx` AND no "Hidden in vX" / "deferred" / strike-through gating note in the row.
- Wired into CI as an additional step on `.github/workflows/asyncapi-spec-drift.yml` (alongside `check-asyncapi`) and into the local `marketing-voice` validation workflow (alongside `check:phrases`, `check:literals`, `check:feature-policy-sync`, `check:og-routes`). The workflow's path-trigger list also includes `VOID_TECHNICAL_OVERVIEW.md` and the new script + `artifacts/void-client/package.json` so doc-only edits to §6.2 still get checked.
- Run locally via `pnpm --filter @workspace/void-client run check:routes-overview`. Hidden-by-design rows MUST keep both their `~~strikethrough~~` AND a "Hidden in v…" note in the purpose cell — the script accepts either signal, but using both makes intent obvious to human readers.

## Known gaps from Task #464 (deferred, not blocking)

_All previously-listed gaps have been resolved — see "Resolved" below._

### Resolved

- **KNOCK_QUEUE_FULL UI copy** — shipped in Task #467 (commit `5321e37`). `RoomPage.tsx` join-failure handler now maps `KNOCK_QUEUE_FULL` to the literal "TOO MANY PEOPLE KNOCKING — TRY AGAIN" instead of falling through to the generic CONNECTION ERROR toast.
- **Per-peer ICE candidate counter reset on remote-initiated ICE restart** — shipped in Task #467 (commit `5321e37`). `webrtc.ts` clears `peerIceCandidateCounts` for the peer when a fresh offer arrives against an existing peer connection (the remote-initiated counterpart to `attemptIceRestart`), so a long-lived session that survives one or two remote restarts no longer silently hits the 50-candidate cap mid-recovery.
