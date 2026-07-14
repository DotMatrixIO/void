# Workspace

## Overview

pnpm workspace monorepo using TypeScript. **VOID** — a stateless P2P video conferencing PWA with a Vibrant Brutalist Terminal UI ("Gold Voyager" theme). No database, no accounts, ephemeral 4-person rooms. Lightning L402 paywall for hosting (1,000 sats/hour), stateless JWT auth, E2E encrypted signaling, and sovereign self-hosting ready.

## User preferences

- Communication: brutal honesty, plain language, no emojis. "Do what has been asked; nothing more, nothing less."
- Follow-up tasks: ALLOWED. (Revoked the prior standing preference of not proposing follow-ups — propose them per the follow-up-tasks skill when genuinely useful.)

## Project structure

VOID is a single consumer product — a stateless P2P privacy video conferencing PWA. It lives in `artifacts/void-client/` and `artifacts/api-server/`, with shared wire/crypto primitives in `lib/wire-core/`. All public-facing surfaces, marketing copy, threat-model docs, and security audits target this product.

## Stack

- **Monorepo tool**: pnpm workspaces; **Package manager**: pnpm; **Node.js**: 24; **TypeScript**: 5.9
- **API framework**: Express 5 + Socket.io (real-time signaling)
- **Frontend**: React + Vite (artifacts/void-client)
- **Validation**: Zod (`zod/v4`); **Build**: esbuild (ESM bundle)

## Artifacts

- **`artifacts/void-client`** (`/`) — VOID WebRTC app frontend (React + Vite)
- **`artifacts/api-server`** (`/api`, `/api/socket.io`) — Express + Socket.io signaling server

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Spec — source of truth + codegen (lib/api-spec)

- `lib/api-spec/openapi.yaml` is the canonical contract for every public HTTP endpoint; `lib/api-spec/asyncapi.yaml` is the sibling AsyncAPI 3.0 contract for the Socket.io signaling channel at `/api/socket.io`. Both are served live at `GET /api/openapi.yaml` / `GET /api/asyncapi.yaml` (bundled into the server binary at build time). Treat both spec files as the source of truth — `VOID_TECHNICAL_OVERVIEW.md` §3.5 is the prose companion.
- When adding or changing a public HTTP route, update `openapi.yaml` in the same change, then re-run `pnpm --filter @workspace/api-spec run codegen` to refresh the generated TypeScript types (`lib/api-client-react`) and Zod validators (`lib/api-zod`). Generated files are checked in.
- When adding or changing a signaling event, update `asyncapi.yaml` in the same change, then re-run the same codegen. The generator writes `lib/signaling-types/src/generated.ts`; `@workspace/signaling-types` re-exports it and is consumed by `@workspace/api-server` and `@workspace/void-client`.
- Recovery codes: `/paywall/status/:hash` mints a single-use 4-word BIP-39 recovery code alongside the JWT; `POST /paywall/recover` redeems it. Never auto-persisted on the client. See `VOID_TECHNICAL_OVERVIEW.md` §4.6.

## Hard rules — never do

- **Editorial hero still & social card are hand-chosen and MUST NEVER be auto-regenerated:**
  - Landing-page hero: `public/portraits/self-portrait-gold-ascii.png` (Task #588).
  - Social card: `public/og/this-room-will-not-exist-social.jpg` (1200x630), a hand-chosen user screenshot installed permanently in Task #1125. The old still-poster regen pipeline was deleted and the `still-poster-drift` validation neutralized to a no-op. Do not reintroduce any script or guard that overwrites this file.
- **RoomPage decomposition (Task #490)** — When `artifacts/void-client/src/pages/RoomPage.tsx` grows past its budget, decompose via **hook / pure-FSM extraction** (`useRoomCrypto`, `useRoomMedia`, `useRoomSignaling`, `RoomStateMachine`, `ExpiryStateMachine`) — never via "dumb subcomponent" extraction. The render block is a single coordinated UI; splitting it produces prop-tunnels and double-renders, while hook/FSM extraction preserves coordination and isolates testable units.

## Visual Design — Gold Voyager Theme

Brutalist concrete aesthetic with warm amber geometry. `border-radius: 0` everywhere. Body font JetBrains Mono; VOID wordmark system-ui weight 900.

CSS tokens (index.css :root): `--bg: #BEB3A2` (warm concrete), `--surface: #A89E90`, `--fg: #1E1A14`, `--fg-dim: #5C5040`, `--red: #CC2200`, `--teal: #0D9D8B`, `--gold: #E8A200` (primary CTA), `--burnt: #C85A00`.

Button classes: `.void-btn--gold` (primary CTA), `.void-btn--teal` (join/secondary), `.void-btn--red` (leave/danger). Decorative geometry specifics (absolutely positioned slabs/stripes on LandingPage/StartScreen) — see the pages themselves.

## Where the detail lives

- **`docs/replit-md-archive.md`** — full detail relocated from this file: room-system function inventory (server + client file-by-file), video/audio/voice-mask mode specs, WebRTC/ICE + TURN config, Lightning paywall backends, E2E signaling crypto, security hardening list, PWA, URL routing, per-route Open Graph card pipeline, CI walk-throughs (SRI freshness gate, Docker build & smoke, API-spec drift, AsyncAPI drift, routes-vs-overview drift), strategy/marketing + onboarding-audit notes, self-hosting file list, and the resolved-gaps changelog.
- **`VOID_TECHNICAL_OVERVIEW.md`** — the canonical technical architecture document.
- **`docs/code-quirks-index.md`** — navigable map of the **load-bearing weirdness** in this codebase. Read it before "cleaning up" anything that looks odd.
- **pnpm-workspace skill** — workspace structure, TypeScript setup, and package details.

Key facts worth keeping top-of-mind: all rooms E2E encrypted via 6-word BIP39 Void Phrase (argon2id-derived roomId + AES-GCM key, key never touches the server); ECDHE P-384 + HKDF session keys for PFS; room TTL 65 min (standard) / 24 h (DAY tier); 4-person cap; TURN credentials are ephemeral HMAC-SHA1; Lightning backends `mock`/`lnbits`/`btcpay` via `LIGHTNING_BACKEND`; PWA manifest + service worker in `artifacts/void-client/public/`.
