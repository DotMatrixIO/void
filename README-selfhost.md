# How to Self-Host VOID

Run your own signaling server. Run your own TURN. Run your own paywall. Keep the room small. Keep the residue smaller.

## At a Glance

- **What VOID is:** an ephemeral, privacy-first video room for up to 4 people
- **What it is not:** Zoom, Slack, a file locker, or a database with a camera attached
- **What you host:** the HTTPS app, the signaling API, the paywall API, and ideally your own TURN relay
- **What the server stores:** no accounts, no room history, no database rows, no persistent user content
- **What the standard distribution includes:** the human video/audio product only — VOID is human-only; all agent code has been removed
- **Minimum app server:** 1 vCPU, 512 MB RAM
- **Recommended real deployment:** 1–2 vCPU, 1 GB RAM, plus public bandwidth for TURN
- **Best production setup:** HTTPS reverse proxy + VOID app container + Coturn + real Lightning backend

## Table of Contents

- [At a Glance](#at-a-glance)
- [1. Introduction](#1-introduction)
- [2. Architecture Overview](#2-architecture-overview)
- [3. Quick Start (5 Minutes)](#3-quick-start-5-minutes)
- [4. Detailed Setup](#4-detailed-setup)
- [5. Environment Variable Reference](#5-environment-variable-reference)
- [6. Platform-Specific Guides](#6-platform-specific-guides)
- [7. Security Hardening](#7-security-hardening)
- [8. Updating](#8-updating)
- [9. Troubleshooting](#9-troubleshooting)
- [10. FAQ](#10-faq)
- [Appendix A: Production Checklist](#appendix-a-production-checklist)
- [Final Advice](#final-advice)

## 1. Introduction

Here is what VOID is. It is an ephemeral, end-to-end encrypted, peer-to-peer video conferencing PWA for privacy-focused conversations. There are no accounts. No database. No server-side user profiles. No stored room history. Rooms hold at most 4 participants, expire automatically after 65 minutes, and are created through a Lightning paywall where the host pays a small per-room fee (about the price of a cup of coffee, quoted live by the server) and joiners enter free. Media flows peer-to-peer over WebRTC. The server handles signaling and payment verification.

That is already unusual. Most software wants to know everything about you. VOID is trying to forget you as fast as possible. There is something almost polite about that.

Self-hosting, in this context, means you run the server infrastructure yourself: the HTTPS app, the signaling API, and ideally your own TURN relay and Lightning backend. That gives you control over the operational surface area and removes third-party SaaS from the core path. It does not mean all packets stay inside your LAN forever. Remote participants still communicate over the internet, and if you use external TURN or Lightning providers, those services sit outside your infrastructure.

The standard VOID self-host distribution is the human video/audio product only. VOID is human-only; all agent code has been removed from the monorepo.

VOID was developed with substantial AI assistance under the maintainer's architectural direction; the full GenAI / AI-assistance disclosure and the security-contact details are in the root [`README.md`](README.md) ("Development & AI assistance") and [`SECURITY.md`](SECURITY.md).

### Hardware Requirements

The machine does not need to be impressive.

For the VOID app server alone:

- **Minimum:** 1 vCPU, 512 MB RAM
- **Recommended:** 1–2 vCPU, 1 GB RAM

For Coturn, bandwidth matters more than CPU. If TURN is relaying traffic for several users at once, your limiting factor is usually:

- network egress
- public UDP reachability
- port availability

If you plan to run both the app and TURN on one VPS, 1–2 vCPU and 1 GB RAM is a comfortable starting point.

## 2. Architecture Overview

VOID is intentionally simple. This was a choice. Simple things are easier to trust.

A single Node.js / Express container serves all of the following:

- the static frontend
- the API routes
- the Socket.io signaling endpoint

A separate Coturn service handles TURN/STUN for NAT traversal and optional IP privacy.

There is no database. All room state lives in memory. Room state is deleted when empty or expired. Rooms live for 65 minutes maximum. Rooms allow 4 participants maximum. The one concession to durability is a small on-disk JSON file (`ROOM_STATE_FILE`) that lets *live* rooms — the paid window, tier, and host-reclaim hashes, nothing more — survive a restart; see §4e. It is not a database, holds no user content, and expired rooms are never resurrected from it.

### What the Server Actually Does

The VOID server does only a few things:

- Serves the frontend
- Verifies Lightning payment and issues a host JWT
- Creates and tracks ephemeral room state in memory
- Relays encrypted WebRTC signaling messages
- Returns ICE server configuration for WebRTC

It does not store user accounts, chat history, media, room archives, or uploaded documents.

Some people find this shocking. Those people have been using other software for too long.

### Room Lifecycle

1. Host pays the per-room fee (quoted live by the server)
2. Server issues a short-lived authorization token
3. Host creates a room
4. Guests join using the VOID Phrase
5. Room exists for the full paid window (65 minutes for the standard tier, 24 hours for the paid DAY tier) whether or not anyone is currently connected — the host can refresh, drop, or step away and rejoin via the phrase URL without re-paying
6. Room is forcibly deleted at TTL expiry (per-room timer, plus a periodic GC sweep)
7. Server restart wipes all volatile per-socket state by design; only the durable "this is a paid, unexpired room" metadata is rehydrated from `ROOM_STATE_FILE` (see §4e), so peers can reconnect to a still-valid room rather than being locked out until the host re-pays

### End-to-End Encryption

The VOID Phrase is shared in the URL fragment, which the browser does not send to the server. That phrase is used client-side to derive signaling encryption keys and the room identifier. The server sees only what it needs to route traffic and verify room membership. In current builds, peers can also upgrade to ephemeral per-peer session keys during connection setup.

The server does not know what you are talking about. This is intentional.

### Media Path

Media does not flow through the app server.

- **Best case:** browser ↔ browser
- **Hard case:** browser ↔ TURN relay ↔ browser

Either way, the app server does not carry your audio or video.

### Simple Diagram

```text
Browser A
   │
   │ HTTPS / WSS (signaling only, encrypted payloads)
   ▼
Your VOID Server (Express + Socket.io + paywall)
   ▲
   │ HTTPS / WSS (signaling only, encrypted payloads)
   │
Browser B

Direct media path:
Browser A  ═════════ WebRTC SRTP ═════════  Browser B

If direct connection fails:
Browser A  ════════ WebRTC via TURN ═══════ Browser B
                          │
                          ▼
                       Coturn
```

## 3. Quick Start (5 Minutes)

This section is for a local smoke test. Not a hardened public deployment. Do not confuse the two.

### Prerequisites

You need:

- Docker
- Docker Compose
- openssl

### 1) Clone the repo

```bash
git clone https://github.com/DotMatrixIO/void.git
cd void
```

> **If the repository is still private**, the unauthenticated HTTPS clone above will fail. Until the repo is flipped public (§6e Step 8), the clone must be authenticated — either an HTTPS Personal Access Token or an SSH deploy key:
>
> ```bash
> # HTTPS with a Personal Access Token
> git clone https://<TOKEN>@github.com/DotMatrixIO/void.git
> # or SSH with a deploy key
> git clone git@github.com:DotMatrixIO/void.git
> ```
>
> If you are the canonical operator, use the pseudonym's credentials for this — see the nym git-authorship note in §6e Step 0, so the clone does not leak a real-name identity.

### 2) Copy the example Coturn config

```bash
cp coturn/turnserver.conf.example coturn/turnserver.conf
# Then open coturn/turnserver.conf and replace `static-auth-secret=YOUR_SECRET_HERE`
# with the value of $TURN_SECRET you generate in the next step. The API server
# refuses to start if TURN_SECRET is still the placeholder.
```

### 3) Generate secrets

```bash
export PAYWALL_SECRET=$(openssl rand -hex 32)
export TURN_SECRET=$(openssl rand -hex 32)
```

### 4) Create a local .env

```bash
cat > .env <<EOF
# NODE_ENV here is a BUILD switch: 'development' lets the image build without a
# Tor .onion mirror address (a clearnet-only smoke build). The running container
# is always production-hardened regardless of this value — see the note below.
NODE_ENV=development
PORT=3000
SERVE_STATIC=1
LIGHTNING_BACKEND=mock
PAYWALL_SECRET=${PAYWALL_SECRET}
# TURN is optional for this first local smoke test.
# If TURN_URL is unset, the app falls back to STUN.
TURN_SECRET=${TURN_SECRET}
EOF
```

> **Security warning:** The shipped `docker-compose.yml` runs the container with `NODE_ENV=production` no matter what your `.env` says, so the `dev-pay` endpoint — which would let anyone settle invoices without paying — is **never** exposed by this stack. Safe by default. The `NODE_ENV=development` above only relaxes the build-time onion guard; it does not change the running container. That `dev-pay` endpoint appears only if you run the server yourself in development (for example a non-Docker `pnpm dev`, or by overriding the container's `NODE_ENV`) — never do that on a public host.

### 5) Start the stack

```bash
docker compose up -d --build
```

Compose forwards your `.env` `NODE_ENV` into the image **build**, where it drives the onion-bake guard. With the `NODE_ENV=development` from step 4 this first run builds a clearnet-only bundle — **no `.onion` address and no manual edits to `Dockerfile`/`docker-compose.yml` are required.** The running container is always production-hardened (the compose `environment:` block pins the runtime `NODE_ENV=production`, so `dev-pay` stays off — see the security warning in step 4). For a public deployment, see the production note below.

> **Production build note (read before you deploy publicly):** a production bundle (`NODE_ENV=production`) bakes in a Tor `.onion` mirror address **and** an absolute public origin, and **fails the build closed** if either is missing — so a "Tor-reachable" bundle can never ship with a silently-inert onion link, and social-card previews (`og:image` / `og:url`) can never ship with broken relative URLs. Before running `docker compose up -d --build` for production, set all three in `.env`:
>
> ```bash
> NODE_ENV=production
> VITE_VOID_ONION_HOST=<your-56-char-base32>.onion
> PUBLIC_ORIGIN=https://your-domain.example
> ```
>
> If you genuinely have no onion mirror yet and only want a clearnet smoke test, keep `NODE_ENV=development` for the build (as in step 4); the guard relaxes only when `NODE_ENV` is not `production`. See §5 "Build-Time Variables" for details.

> **Provenance note:** an image you build locally with Compose passes no git SHA or release tag, so `BUILD_INFO.json` and the `/api/proof/build` + `/api/provenance.json` endpoints report placeholder (`unknown`) provenance. This is expected for a local build. Meaningful, verifiable provenance comes from the signed release path (see "Rebuild from the recipe" and "Verify provenance" below), or by passing `GIT_SHA` / `GIT_SHA_SHORT` / `RELEASE_TAG` / `BUILD_TIMESTAMP` as `--build-arg`s.

### 6) Verify it is running

```bash
docker compose ps
docker compose logs -f void
```

Then open:

```text
http://localhost:3000
```

### 7) Test room creation

For local testing, keep:

```bash
NODE_ENV=development
LIGHTNING_BACKEND=mock
```

`LIGHTNING_BACKEND=mock` creates test invoices that remain unpaid until settled through the `dev-pay` endpoint. That endpoint is only available when `NODE_ENV` is not `production`. In the dev UI it appears as a "Simulate Payment" button. Together, `LIGHTNING_BACKEND=mock` and `NODE_ENV=development` give you a complete local payment loop without a real Lightning node.

If you set `LIGHTNING_BACKEND=mock` with `NODE_ENV=production`, invoices will be created but can never be settled, so room creation will fail. Do not do that.

For a public deployment, switch to LNbits or BTCPay and set `NODE_ENV=production`.

## 4. Detailed Setup

### 4a. TURN / STUN Server (Coturn)

#### Why You Need TURN

If you only test on friendly networks, WebRTC looks easy. This is one of the ways the internet lies to you.

In real life, a large number of users sit behind:

- symmetric NAT
- office firewalls
- carrier NAT
- hotel Wi-Fi
- mobile networks

Without TURN, calls will fail for a meaningful percentage of those users. The percentage is higher than you expect.

TURN also matters for IP privacy. In direct peer-to-peer mode, browsers may discover each other's network candidates. With TURN relay — especially if you force relay-only rooms — peers do not need to exchange direct reachable IP paths.

#### Recommended Deployment Model

- Run Coturn on a publicly reachable host
- Give it a real DNS name
- Use TLS for `turns:`
- Open the relay UDP port range
- Use a strong shared secret
- Keep Coturn separate from the app process

#### Generate a TURN Secret

```bash
openssl rand -hex 32
```

Use the same value in:

- your app `.env` as `TURN_SECRET`
- your Coturn config as `static-auth-secret`

#### Example Coturn Config

Start from your example file. The important lines:

```ini
use-auth-secret
static-auth-secret=REPLACE_WITH_YOUR_TURN_SECRET
realm=turn.your-domain.example

listening-port=3478
tls-listening-port=5349

min-port=49152
max-port=65535

no-cli
no-multicast-peers

# Deny private peer destinations
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255

# Set these to your actual addresses
listening-ip=0.0.0.0
external-ip=YOUR_PUBLIC_IP
```

If Coturn runs in Docker behind another private interface, you may need:

```ini
external-ip=YOUR_PUBLIC_IP/YOUR_CONTAINER_OR_HOST_PRIVATE_IP
```

Like this:

```ini
external-ip=203.0.113.10/172.18.0.2
```

#### Self-Hosted STUN (Same Coturn Instance)

Coturn natively answers STUN binding requests on the same UDP/TCP port it uses for TURN (`3478`). No extra daemon is needed. The example config in this repo does not set `no-stun`, so a fresh Coturn deployment will respond to STUN binding requests out of the box — you only need to publish a hostname for it and point the API server at it.

Why bother, given Google's public STUN servers exist? Because every WebRTC session that hits `stun:stun.l.google.com:19302` is a third-party telemetry channel: both peers reveal their public IPs to a Google-operated server during ICE gathering, on every single call. Running your own STUN closes that channel for your users by default, in the same spirit as proxying or replacing the other Google dependencies a privacy-focused OS like GrapheneOS goes out of its way to remove.

To stand it up:

1. **DNS** — Add an A (and AAAA if you have IPv6) record for a name like `stun.your-domain.example` pointing at the same VPS that runs Coturn. It can be the same name as your TURN host or a separate one; both work because they resolve to the same listener.
2. **Firewall** — `3478/udp` and `3478/tcp` must be reachable from the public internet. These are already in the TURN port list above, so if TURN works, STUN works.
3. **Verify from off-network** — From a machine *outside* your infrastructure (a phone on mobile data is fine), run a STUN binding test against the new hostname. Any standard `stunclient` / `stun-client` binary works:

   ```bash
   stunclient stun.your-domain.example 3478
   ```

   You should get a `Binding test: success` response with your client's mapped address. If you only have a browser, the Trickle ICE tester at `webrtc.github.io/samples/src/content/peerconnection/trickle-ice/` will show `srflx` candidates when your STUN URL is configured correctly.
4. **App env wiring** — Set `STUN_URL` on the API server (see §5):

   ```bash
   STUN_URL=stun:stun.your-domain.example:3478
   ```

   The `/api/ice-servers` route prepends this entry ahead of the TURN entry in the response, so clients prefer your STUN for srflx discovery before falling back to TURN relay.

**Why "self-hosted STUN" matters even when TURN works.** STUN lets peers discover their own server-reflexive (`srflx`) addresses so they can attempt a direct peer-to-peer media path. Without any STUN at all, ICE gathering degrades to host candidates only — meaning calls between peers on the same LAN or same NAT can still connect, but most cross-NAT calls cannot. With STUN but no TURN, direct paths work for most NATs but fail on symmetric NAT and restrictive firewalls. With both STUN and TURN, you get the best of both: cheap direct paths when possible, relay fallback when not. If you only run one, run TURN — relayed media is always reachable. If you can run both on the same Coturn, do.

**Important: "both unset" fails closed, loudly.** If you ship a production deployment with neither `STUN_URL` nor `TURN_URL` set, the API server returns `{ iceServers: [] }` from `/api/ice-servers` and emits a multi-line startup banner (boxed `ICE / TURN MISCONFIGURED` block) naming the consequence and pointing back at this section. It does **not** fall back to public (Google) STUN — every such call would silently leak peer IPs to a third party. The failure mode is honest but unfriendly: LAN / same-NAT calls keep working, while most cross-NAT calls just never connect. Operators have reported this as "VOID is broken for some of my users" when in fact ICE gathering has degraded to host-candidates-only. Set `STUN_URL` and `TURN_URL` on every public deployment. Treat an empty ICE-servers list as a misconfiguration, not a feature.

**Discoverability without scraping logs.** As of task #530, the same missing-TURN condition is surfaced on two additional surfaces so an operator never has to grep server logs to find it:

- The boxed startup banner above replaces the previous single `WARN` line and is deliberately hard to overlook.
- `GET /api/ice-servers` now also returns a structured `no_turn_configured: true` field whenever `TURN_URL` is unset (independent of whether `STUN_URL` is set). The field is absent / falsy when TURN is configured.
- The void-client reads that flag and renders a one-time, dismissible **operator banner** at the top of the room — but only for the room **host**, so guests never see operator-config noise. Dismissal persists per-browser per-origin in `localStorage`, so a host who has already acknowledged the warning is not nagged on every join. If you operate the deployment and never see this banner as the host, your TURN configuration is good.

**Future: STUNS over TLS on port 5349.** The same Coturn already terminates TLS on `5349/tcp` for `turns:`. Exposing STUN-over-TLS / STUN-over-DTLS on the same port is a small additional config change — a handful of lines — that lets clients on networks which block plain `:3478` still reach your STUN. It is intentionally out of scope for the initial STUN rollout (only `stun:` on `:3478` is in scope), but it is the obvious next operator improvement. Flag it on your own backlog so the next operator does not have to rediscover the same conclusion.

#### App Environment for TURN

In `.env`:

```bash
TURN_URL=turns:turn.your-domain.example:5349?transport=tcp
TURN_SECRET=REPLACE_WITH_THE_SAME_SECRET
STUN_URL=stun:stun.your-domain.example:3478
```

The server default for `TURN_CREDENTIAL_TTL` is **4500 seconds** — the room TTL of 3900 seconds plus a 10-minute safety buffer. This prevents late-session ICE restart failures when TURN credentials expire before the room does. You can override it. If you do, keep it above 3900:

```bash
TURN_CREDENTIAL_TTL=4500
```

If you also want non-TLS UDP:

```bash
TURN_URL=turn:turn.your-domain.example:3478?transport=udp
```

Many operators expose both a TLS TCP endpoint and a UDP endpoint, then prefer relay-only mode when IP privacy matters more than bandwidth cost. This is reasonable.

#### Optional: Cloudflare hosted TURN (testing only)

For staging or short-lived test deployments where standing up a coturn VPS is overkill, the API server can be pointed at [Cloudflare's hosted TURN](https://developers.cloudflare.com/calls/turn/) instead. Set both of these env vars on the API server:

```bash
CLOUDFLARE_TURN_TOKEN_ID=<your-turn-key-id>
CLOUDFLARE_TURN_API_TOKEN=<your-turn-api-token>
```

When both are set, `/api/ice-servers` POSTs to `https://rtc.live.cloudflare.com/v1/turn/keys/<id>/credentials/generate-ice-servers` and forwards Cloudflare's pre-minted `iceServers` array to the client. The response is cached per-process (keyed by token-ID) for the TTL window so a busy room does not hammer the Cloudflare API. Failures (timeout, 4xx, 5xx, malformed response) fail closed with a 503 + `{ iceServers: [], no_turn_configured: true }` — never a silent empty list. The startup banner skips the `ICE / TURN MISCONFIGURED` warning and emits a one-line `ICE: Cloudflare TURN configured (token …<suffix>)` instead, so operators can confirm the wiring without scraping requests.

This branch takes precedence over `TURN_URL` / `TURN_SECRET` when both are set: an operator who configured Cloudflare credentials gets a Cloudflare response, not a half-configured coturn one. Rotate credentials from the [Cloudflare dashboard](https://dash.cloudflare.com); the API server reads them from the environment on every request, so a restart is not required (but the per-process cache will hold the old credential until its TTL expires).

**Why this is testing-only, spelled out.** Cloudflare TURN is a hosted third party: operator IPs and call metadata (relay allocation, packet timings, both peers' IPs at allocation time) transit Cloudflare's edge. That defeats the sovereignty posture the self-hosted coturn path above is designed to give you — the whole reason VOID ships its own coturn config in the first place. Use Cloudflare for a three-VPN cross-NAT staging test, then unset the two env vars and go back to self-hosted coturn for production. We deliberately do not document Cloudflare in `coturn/turnserver.conf.example` or `docker-compose.yml` for the same reason: production-shaped configs should not normalize sending call metadata to a third party.

#### Firewall Ports to Open

These need to be reachable from the internet:

```text
80/tcp           (HTTP — for cert issuance or reverse proxy)
443/tcp          (HTTPS for the app)
3478/tcp         (TURN)
3478/udp         (TURN/STUN)
5349/tcp         (TURNS)
49152-65535/udp  (TURN relay ports)
```

#### UFW Example

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
```

#### Testing TURN

Use any WebRTC ICE tester or your browser's WebRTC diagnostics. Confirm that you see:

- relay candidates
- successful connection when direct candidates are unavailable
- stable call setup across different networks

If your calls only show host or srflx candidates and never relay, your TURN setup is not being used. Something is wrong. The relay ports are probably blocked.

#### TLS for TURNS

Give Coturn a certificate and key:

```ini
cert=/path/to/fullchain.pem
pkey=/path/to/privkey.pem
```

A common production pattern:

- reverse proxy terminates HTTPS for the app
- Coturn uses its own cert for `turns:`
- both names point to the same VPS or separate hosts

#### External TURN Providers

Here is the honest version of this.

VOID expects a TURN setup compatible with shared-secret / HMAC-style ephemeral credentials.

If an external provider supports that model, you can point VOID at it:

```bash
TURN_URL=...
TURN_SECRET=...
```

If the provider uses a different API or issues credentials itself, you will need to adapt the `/api/ice-servers` implementation. Do not assume every TURN provider is drop-in compatible. Some are not.

#### Practical Advice

If you are behind CGNAT, a home ISP that blocks inbound UDP, or a restrictive office network, run Coturn on a small public VPS even if the app itself lives elsewhere. The physical location of the app server matters much less than the public reachability of the relay.

### 4b. Lightning Payment Backend

VOID uses a host-only paywall. The host pays a small per-room fee, quoted live by the server at `GET /api/paywall/tiers`. Joiners enter free. The room lasts 65 minutes. The invoice has a short lifetime. Pay it before it expires.

At the moment a payment confirms, the server also issues a one-time **recovery code** (4 BIP-39 words) alongside the JWT. The PaywallModal shows it once with explicit "this is your only chance" framing. The user chooses whether to write it down — nothing is auto-persisted on the client. If the user closes the tab before opening the room, they can submit the code on the start screen's `RECOVER A PAID ROOM` flow to mint a fresh JWT for the **remaining** time in the same paid window. Recovery never extends the window past its original expiry, and the code is single-use. Codes live in memory only, so a server restart wipes them in step with the JWT secret.

#### Mock Mode

Mock mode is for local development, UI testing, and integration testing.

```bash
LIGHTNING_BACKEND=mock
```

`LIGHTNING_BACKEND=mock` creates test invoices backed by in-memory state instead of a real Lightning node. These invoices start as unpaid and must be settled through the `dev-pay` endpoint to complete.

When `NODE_ENV` is anything other than `production`, the server exposes `POST /api/paywall/dev-pay/:paymentHash`, which settles a mock invoice with a single HTTP call. The dev UI uses this endpoint behind its "Simulate Payment" button.

If you deploy with `NODE_ENV` set to anything other than `production` on a public server, anyone can settle invoices and create free rooms. Set `NODE_ENV=production` for public deployments. This point has been made before. It will be made again.

If you set `LIGHTNING_BACKEND=mock` with `NODE_ENV=production`, the mock backend will create invoices, but the settlement endpoint is disabled, so those invoices can never be paid. Use a real Lightning backend for production.

#### LNbits Setup

Use LNbits when you want a lightweight Lightning backend.

You need an LNbits wallet and an API key with permission to create and check invoices.

```bash
LIGHTNING_BACKEND=lnbits
LNBITS_URL=http://your-lnbits-host:port
LNBITS_API_KEY=YOUR_LNBITS_API_KEY
PAYWALL_SECRET=YOUR_STRONG_SECRET
```

Verify:

- the LNbits instance is reachable from the VOID app container
- the key can create invoices
- the key can check payment status

#### Reaching LNbits over a host-side Tor bridge

The verification above assumes LNbits sits at an ordinary `host:port` the container can dial directly. A common sovereign setup breaks that assumption: LNbits runs on a separate node at home (for example a Start9 or Umbrel box) and is reachable only over its Tor `.onion` address. The usual pattern is to run a local forwarder on the VPS — `socat` or similar, listening on a local port and forwarding through the Tor SOCKS proxy to the `.onion` — so the rest of the stack can treat LNbits as a plain local port.

Two traps show up when the VOID app runs under Docker and LNbits is reached this way. The first (a container cannot reach the host's loopback) needs a `docker-compose.override.yml`, which Compose merges automatically, so the tracked `docker-compose.yml` stays clean for `git pull` updates (§8). The second (the fetch timeout) is now just a `.env` value — the shipped `docker-compose.yml` forwards `LIGHTNING_FETCH_TIMEOUT_MS` to the container, so no override is needed for it:

```yaml
# docker-compose.override.yml  — local only, do not commit
services:
  void:
    networks:
      - lnbits
networks:
  lnbits:
    ipam:
      config:
        - subnet: 172.28.0.0/16
          gateway: 172.28.0.1
```

**1. A container cannot reach the host's `127.0.0.1`.** If the forwarder listens on `127.0.0.1:5000` on the host, `LNBITS_URL=http://127.0.0.1:5000` fails from inside the `void` container: within the container, `127.0.0.1` is the container's own loopback, not the host's. The forwarder must listen on an address the container can route to — a Docker bridge gateway — and `LNBITS_URL` must point at that gateway. The override above pins a network so the gateway address is deterministic (`172.28.0.1`). Bind the forwarder's **listen** side to `172.28.0.1:5000`, leave the Tor SOCKS side on `127.0.0.1:9050`, and set `LNBITS_URL=http://172.28.0.1:5000`. Do **not** bind the forwarder to `0.0.0.0`, and do **not** open its port in the firewall — it should be reachable only from the Docker network. (If you would rather not define a custom subnet, the default bridge gateway `172.17.0.1` works too; pinning the subnet just fixes the address instead of relying on Docker's default.)

**2. The default fetch timeout is tuned for a local node, not a Tor hop.** Every HTTP call to the Lightning backend has a deadline set by `LIGHTNING_FETCH_TIMEOUT_MS` (default `8000`; see §5). Reaching LNbits over a Tor circuit adds latency and jitter, so raise it — `15000` is a reasonable start. The shipped `docker-compose.yml` now lists this variable in the `void` service's `environment:` block, so setting `LIGHTNING_FETCH_TIMEOUT_MS=15000` in `.env` alone reaches the container — no override needed for the timeout. (The override above is only for the network trap.)

After bring-up, confirm the effective-config log shows the LNbits backend and your raised timeout (§4f), and that `POST /api/paywall/invoice` returns a real `lnbc…` invoice string.

#### Reaching LNbits over Tailscale (Start9 / StartOS)

If your LNbits runs on a Start9 (StartOS) box and you connect the two machines with [Tailscale](https://tailscale.com), you can dial it over the tailnet instead of running the Tor bridge above. It is simpler and faster — no `socat`, no Tor SOCKS hop, no bridge-gateway juggling — but StartOS's networking model has three sharp edges that make the "obvious" `LNBITS_URL` values fail from inside the container. Read this before you copy anything.

**StartOS does not expose a plain `host:port`.** A Start9 box runs a single reverse proxy that routes **by hostname (SNI / `Host` header) on HTTPS port 443**, not by per-service ports. Each service is addressed by a name:

- **LAN:** an mDNS name like `https://lnbits.local` on 443, with a certificate signed by StartOS's **own private certificate authority**.
- **Remote:** a Tor `.onion` (plain HTTP *inside* the onion — Tor itself provides the encryption and authentication, which is why nothing needs a CA there).

Over Tailscale you reach the box at its tailnet IP (`100.x.y.z`), but you must still present the **service hostname** so the proxy routes to LNbits and the TLS certificate matches. That is where the three edges come from — hitting `https://100.x.y.z` directly clears none of them:

1. **Name resolution.** The container uses Docker's resolver, which resolves *neither* mDNS `.local` *nor* Tailscale MagicDNS `*.ts.net`. So even though the name works from your laptop, it is unresolvable inside the container.
2. **Hostname / SNI routing.** `https://100.x.y.z` sends the wrong (or empty) `Host`/SNI, so the StartOS proxy will not route to LNbits and the certificate will not match its subject. You must use `LNBITS_URL=https://<hostname>` so the resolved name, the SNI, the `Host` header, and the certificate subject all agree.
3. **Certificate trust.** A StartOS-CA certificate is not signed by any public root, so Node's `fetch` (which the LNbits adapter uses) rejects the handshake. You must give Node the StartOS root CA.

**Find your working URL first.** From another device already on the tailnet (not the Start9 itself), open the URL that loads the LNbits UI and note two things: the exact hostname, and whether the browser shows the certificate as trusted. That answer picks one of the two cases below.

**Case A — a `.local` hostname with a StartOS-CA certificate (the browser warns / you had to trust it manually).** You need to pin the name to the tailnet IP *and* mount the StartOS root CA. Everything lives in a `docker-compose.override.yml`, which Compose merges automatically so the tracked `docker-compose.yml` stays clean for `git pull` (§8):

```yaml
# docker-compose.override.yml  — local only, do not commit
services:
  void:
    extra_hosts:
      - "lnbits.local:100.x.y.z"          # <-- your Start9's Tailscale IP
    environment:
      NODE_EXTRA_CA_CERTS: /certs/startos-ca.crt
    volumes:
      - ./startos-ca.crt:/certs/startos-ca.crt:ro
```

with, in `.env`:

```bash
LIGHTNING_BACKEND=lnbits
LNBITS_URL=https://lnbits.local
LNBITS_API_KEY=YOUR_LNBITS_API_KEY
```

Download the StartOS root CA from the StartOS dashboard (System → Root CA / "Download Certificate"), save it next to `docker-compose.yml` as `startos-ca.crt` (PEM), and make sure the `extra_hosts` name, the `LNBITS_URL` host, and the certificate's subject are the **same** hostname.

**Case B — a `*.ts.net` MagicDNS hostname your browser already trusts.** Tailscale has provisioned a real (Let's Encrypt) certificate for that name, so you do **not** need the CA mount — only the name-resolution pin. Drop the `NODE_EXTRA_CA_CERTS`/`volumes` lines and use the `.ts.net` name everywhere:

```yaml
# docker-compose.override.yml  — local only, do not commit
services:
  void:
    extra_hosts:
      - "your-start9.tailnet-name.ts.net:100.x.y.z"   # <-- tailnet IP
```

```bash
LNBITS_URL=https://your-start9.tailnet-name.ts.net
```

Whichever case, recreate the container so the override structure is picked up — `docker compose up -d` (a plain `restart` does **not** apply override changes).

**Verify from inside the container** with the *same* code path the app uses, so the test exercises DNS, routing, and TLS trust exactly as the server will:

```bash
docker compose exec void node -e 'fetch(process.env.LNBITS_URL+"/api/v1/wallet",{headers:{"X-Api-Key":process.env.LNBITS_API_KEY}}).then(r=>r.text()).then(t=>console.log(t)).catch(e=>{console.error(e.message);process.exit(1)})'
```

- **Wallet JSON** → DNS, routing, and TLS all work. Create a room.
- **A certificate error** (`self-signed certificate in certificate chain`, `unable to verify the first certificate`) → Node does not trust the cert. Confirm the file is mounted (`docker compose exec void ls -l /certs/startos-ca.crt`), that `NODE_EXTRA_CA_CERTS` points at that exact path, that you downloaded the StartOS **root** CA (PEM), and that the `LNBITS_URL` hostname matches the certificate's subject. If your working browser URL was a trusted `*.ts.net` name (Case B), you should not need the CA at all — switch to that hostname.
- **`getaddrinfo ENOTFOUND`** → the `extra_hosts` pin did not take: check the entry spelling and that you recreated with `docker compose up -d`, not `restart`.
- **A hang, `ECONNREFUSED`, or `ENETUNREACH`** → the container's egress is not reaching the tailnet, or a Tailscale ACL is blocking it. Confirm the host itself can reach the box (`tailscale ping <name>`, or `curl` from the host shell) and that the Start9's Tailscale ACLs permit the VPS. Note: a busybox `wget` cert test would be misleading here because `wget` reads the OS trust store, not `NODE_EXTRA_CA_CERTS` — the `node -e` check above is authoritative.

Unlike the Tor bridge, a tailnet hop is low-latency, so the default `LIGHTNING_FETCH_TIMEOUT_MS` (`8000`) is normally fine — the knob is still there (§5) if your link is unusually slow.

**Tailscale bridge or Tor bridge?** Use Tailscale when both machines are on your tailnet — it is simpler and faster. Use the Tor bridge above when you cannot (or will not) put the VPS on the tailnet and must reach LNbits over its `.onion`.

After bring-up, confirm the effective-config log shows the LNbits backend (§4f) and that `POST /api/paywall/invoice` returns a real `lnbc…` invoice string.

#### BTCPay Server Setup

Use BTCPay when you want a more full-featured self-hosted payment backend.

You need a BTCPay Server instance, a store, a Greenfield API key, and the store ID.

```bash
LIGHTNING_BACKEND=btcpay
BTCPAY_URL=https://btcpay.your-domain.example
BTCPAY_API_KEY=YOUR_GREENFIELD_API_KEY
BTCPAY_STORE_ID=YOUR_STORE_ID
PAYWALL_SECRET=YOUR_STRONG_SECRET
```

Verify:

- API key can create invoices
- API key can read invoice and payment status
- store ID matches the intended store

#### Can I Disable the Paywall Entirely?

Not in the standard production build just by setting mock.

For local development and testing, use `LIGHTNING_BACKEND=mock`. For a real public deployment, use LNbits or BTCPay. If you want production free rooms, that is a code change and a fork policy decision, not a stock environment toggle.

#### Rehearsing Lightning backend failures

If you want to verify how your deployment behaves when the Lightning
backend fails or misbehaves mid-payment — backend unreachable after the
user has paid, an under- or over-payment, or a duplicate/concurrent
invoice for the same intent — see
`docs/lightning-failure-injection-runbook.md`. It documents reversible
ways to inject each failure against a real LNbits / BTCPay backend, the
recovery and rollback procedures to stage first, and what correct
behaviour looks like in each case. It is the setup the launch
checklist's A.13 gate depends on.

#### Confirming the fetch timeout

Every HTTP call to the Lightning backend is bounded by a per-request
deadline set with `LIGHTNING_FETCH_TIMEOUT_MS` (range 1000–30000 ms,
default 8000; see the environment-variable table below). The value is
clamped into range or falls back to the default on invalid input, and
those corrections otherwise happen silently except for a one-line warning
on bad input. To confirm what the server actually resolved, look at the
startup logs: on every boot the server prints a single line reporting the
**effective** value, e.g.

```
Lightning: fetch timeout 15000ms (set via LIGHTNING_FETCH_TIMEOUT_MS)
```

When your override was clamped or rejected, the same line says so — for
example `... (clamped from requested 120000ms set via
LIGHTNING_FETCH_TIMEOUT_MS)` or `... (default; ignored invalid
LIGHTNING_FETCH_TIMEOUT_MS="8")` — so you can tell at a glance whether the
setting took effect. This sits alongside the ICE/TURN and `TOR_ONLY`
startup lines that confirm those postures.

### 4c. Reverse Proxy (Production)

A reverse proxy gives you HTTPS termination, a proper public domain, clean certificate management, WebSocket support, and a cleaner security posture.

Socket.io signaling depends on WebSocket upgrade support. If your proxy does not forward upgrade headers correctly, room joins and signaling will fail. This is one of the most common things people get wrong.

#### Nginx Example

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name void.your-domain.example;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name void.your-domain.example;

    ssl_certificate     /etc/letsencrypt/live/void.your-domain.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/void.your-domain.example/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

#### Caddy Example

Caddy handles WebSockets automatically. The config is short because it is doing the obvious thing.

```caddy
void.your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

#### Traefik Example

For Docker-native setups, add labels to the void service:

```yaml
services:
  void:
    labels:
      - traefik.enable=true
      - traefik.http.routers.void.rule=Host(`void.your-domain.example`)
      - traefik.http.routers.void.entrypoints=websecure
      - traefik.http.routers.void.tls=true
      - traefik.http.services.void.loadbalancer.server.port=3000
```

Traefik handles WebSockets correctly if routed normally.

#### Critical Note

Whatever proxy you use, confirm that `/api/socket.io` is reachable and upgrade-capable. If the site loads but rooms never connect, the proxy is usually where to look first.

### 4e. Room-State Persistence File (`ROOM_STATE_FILE`)

The signaling server keeps room state in memory. To survive a restart — a
`SIGTERM` → restart cycle, a crash, or a redeploy — it also writes a small
JSON file so live rooms can be rehydrated when the process comes back. Without
this, a restart strands existing rooms: peers already connected may keep
talking P2P, but no new joiner can reach the room and the host cannot rejoin
via the phrase URL until the paid window is bought again.

This is on by default. There is no toggle to enable it; the only knob is *where*
the file lives.

#### Default location

The file defaults to `data/rooms.json`, relative to the API server's working
directory. In the standard Docker image that is inside the container
filesystem. Override the path with the `ROOM_STATE_FILE` environment variable:

```bash
ROOM_STATE_FILE=/var/lib/void/rooms.json
```

The server creates the parent directory if it does not exist, writes atomically
(temp file + rename, so a kill mid-flush can never leave a half-written file),
and flushes synchronously during the shutdown drain so the latest state lands
on disk before exit. On startup it reads the file back and rehydrates any room
whose paid window has not yet expired; expired records are dropped. A missing,
empty, unparseable, or wrong-version file is logged and ignored — the server
starts with an empty room set rather than refusing to boot.

#### Put it on a persistent volume

The whole point of this file is to outlive the process, so it must outlive the
*container*. If you run VOID under docker-compose, systemd-nspawn, Kubernetes,
or any setup where a restart can hand you a fresh container filesystem, point
`ROOM_STATE_FILE` at a path backed by a persistent volume — otherwise a restart
that swaps the filesystem still loses room state, which is exactly the failure
this feature exists to prevent.

A docker-compose bind mount or named volume is the simplest form:

```yaml
services:
  void:
    environment:
      ROOM_STATE_FILE: /data/rooms.json
    volumes:
      - void-room-state:/data

volumes:
  void-room-state:
```

For systemd, write it under a `StateDirectory` (e.g.
`/var/lib/void/rooms.json`) so the path persists across restarts and survives
package updates.

#### What the file contains — and what it does not

The persisted snapshot is deliberately minimal: it stores only the durable
"what the host paid for" contract plus the moderation flags the host explicitly
set. Per room it holds:

- `code` — the room code (derived from the VOID Phrase; the phrase itself is
  never sent to or stored by the server)
- `createdAt` / `expiresAt` — the paid window
- `tier` — `standard` or `day`
- `roomType` — `human` (VOID is human-only)
- `relayOnly` and `locked` — privacy / moderation flags the host toggled
- `hostReclaimTokenHashes` — a **keyed HMAC** (`HMAC(PAYWALL_SECRET, reclaimToken)`)
  of the per-room **reclaim tokens** allowed to reclaim host on rejoin. The reclaim
  token is a fresh random value minted with each paid window and decoupled from the
  Lightning `paymentHash`, so the file holds nothing payment-derived

It does **not** contain: socket ids, peer ids, IP addresses, JWTs or the
`PAYWALL_SECRET`, recovery codes, pending knocks, screen-share state, or any
audio/video/chat content. None of that is persisted because none of it survives
a restart meaningfully — sockets are dead, peers reconnect and re-claim their
seats, and the host re-toggles moderation state on rejoin.

**Security note.** A `paymentHash` is not a secret — it does not let anyone
spend, settle, or reclaim a payment, and it is not the JWT that authorizes host
actions. But it *is* correlatable: it is the same value the Lightning backend
saw for that invoice, so anyone who can read both this file and your Lightning
backend's records could link a room to a specific payment. Treat the file as
operationally sensitive even though it holds no credentials: keep it on a volume
only the VOID process (and you) can read, and do not ship it off-box to log
aggregators or backups that have a wider audience than the server itself.

### 4d. Custom Domain & TLS

#### DNS

Point your DNS records at your server:

- A record for IPv4
- AAAA record for IPv6 if available

A clean production setup often uses:

- `void.your-domain.example` for the app
- `turn.your-domain.example` for Coturn

#### TLS

Use one of:

- Caddy auto-TLS
- Certbot with Nginx
- your existing certificate automation

For the app, HTTPS is mandatory in practice. PWAs behave better under secure origins. WebRTC and permissions behave more consistently. Users expect it. Browsers expect it. The internet has mostly decided on this.

For TURN, use `turns:` when possible.

#### Security Headers

VOID already expects sane HTTP hardening, but if you terminate TLS at a proxy, confirm that HTTPS is always enforced, HSTS is enabled if you are ready for it, and the proxy and app agree on the forwarded protocol.

The API server emits a fixed set of HTTP security headers on every response, including 4xx/5xx errors, OPTIONS preflights, and (when `SERVE_STATIC=1`) the bundled void-client assets and SPA fallback: `Content-Security-Policy` (with a `report-to default` directive), `Reporting-Endpoints` (naming the same `default` sink — the well-known group name that Permissions-Policy violations are also routed to via the Reporting API, so one endpoint covers both header families), `Strict-Transport-Security`, `Permissions-Policy` (deny-by-default with a small allow-list — `camera`, `microphone`, `display-capture`, `clipboard-write`, `fullscreen`, `autoplay`, `web-share` to `(self)`; everything else, including `clipboard-read`, denied), `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, and `X-Permitted-Cross-Domain-Policies: none`. `Cross-Origin-Embedder-Policy` is intentionally NOT set — the void-client does not use `SharedArrayBuffer` or any other API that requires cross-origin isolation, and enabling COEP would force every cross-origin subresource to opt in via CORP for no security gain.

`Cross-Origin-Resource-Policy` is keyed off your deployment topology:

- **Single-origin self-host (`SERVE_STATIC=1`, the default Docker path).** API and client share an origin, so CORP is locked to `same-origin` — strictest possible, blocks any cross-origin embedder.
- **Split-origin deployment (`SERVE_STATIC` unset; client served separately, e.g. via a static host or a different subdomain).** CORP relaxes to `same-site` so the static client can fetch `/api/*` cross-origin without being blocked. This still blocks cross-site embedders.

If you front the app with a reverse proxy that strips or rewrites response headers, make sure the headers above survive intact — a regression test in `artifacts/api-server/src/__tests__/security-headers.test.ts` asserts the exact set on every code path the app itself controls, but proxies can still strip them on the way back to the browser.

### 4f. Confirming the Effective Configuration at Startup

Individual postures are confirmed by their own startup lines — the ICE/TURN
banner (§4a), the `TOR_ONLY` banner (§6b), the opt-in log-retention check
(§8), and the Lightning fetch-timeout line (§4b). To verify a whole deploy in
one glance instead of scraping those lines, every boot also prints a single
consolidated **effective runtime configuration** summary. It reports the
resolved, post-clamp / post-fallback values for the main operator knobs:

```text
==============================================================================
  VOID — effective runtime configuration
------------------------------------------------------------------------------
  Mode:           self-hosted single-origin (SERVE_STATIC=1)
  Tor-only:       off
  ICE / TURN:     self-hosted TURN configured; STUN configured
  CORS origins:   none — same-origin requests only (fail-closed)
  Lightning:      backend=lnbits, fetch timeout 8000ms (default; LIGHTNING_FETCH_TIMEOUT_MS unset)
  Log retention:  ~5 day(s) (from logrotate config LOGROTATE_CONFIG_PATH)
  PAYWALL_SECRET: set (operator-provided)
  TURN_SECRET:    set
  Secrets are reported by presence/posture only; their values are never logged.
  See README-selfhost.md §4f.
==============================================================================
```

Find it with `docker compose logs void | grep -A12 "effective runtime configuration"`.

The **CORS origins** row prints the resolved cross-origin allowlist (derived
from `PUBLIC_ORIGIN`, `ONION_HOSTNAME`, or Replit domains — see §5). The
allowlist is fail-closed, so `none — same-origin requests only` is correct
for a single-origin deploy (`SERVE_STATIC=1`) but fatal for a split-origin
one: if the list is empty while `SERVE_STATIC` is unset, the server also
emits a boxed `CORS ALLOWLIST EMPTY IN SPLIT-ORIGIN MODE` warning pointing at
`PUBLIC_ORIGIN` in §5.

**Secrets are never echoed.** `PAYWALL_SECRET`, `TURN_SECRET`, and any
Cloudflare API token are reported only by presence/posture (`set` / `unset`,
or the token's last-4 suffix) — never their values. The summary supplements
the individual lines above; the loud per-misconfiguration warnings still fire
as before.

## 5. Environment Variable Reference

Below is a practical reference for the standard self-host deployment.

If your current build predates some of these variables, use the values supported by your codebase. The final source of truth is the actual server env parser and startup path, not this document.

### Core

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `NODE_ENV` | Recommended | `production` or `development` | Controls production vs dev behavior. In non-production mode, the dev-pay endpoint is enabled — never expose this publicly | Defaults vary; use `production` in public deployments |
| `PORT` | No | `3000` | Port the app server listens on | Usually defaults to 3000 |
| `SERVE_STATIC` | Recommended in Docker | `1` | Tells Express to serve the built frontend | If unset, behavior depends on your build/deploy path |
| `CLIENT_DIST` | Optional | build-specific path | Path to built frontend assets if serving static files | Usually already wired inside the image |
| `ROOM_STATE_FILE` | Recommended in containers | `/var/lib/void/rooms.json` | Path to the JSON file that persists live room metadata across restarts (see §4e). Point it at a persistent volume so a restart with a fresh container filesystem does not lose room state | Defaults to `data/rooms.json` relative to the API server's working directory |
| `PUBLIC_ORIGIN` (runtime) | Required for split-origin setups | `https://your-domain.example` | Adds your public web origin to the server's CORS allowlist (both the HTTP API and the Socket.io signaling endpoint). The allowlist is **fail-closed**: the server only vouches for origins it can derive from its environment (`PUBLIC_ORIGIN`, `ONION_HOSTNAME`, or Replit domains) — it never reflects arbitrary `Origin` headers. The standard same-origin layout (the API server serving the built frontend via `SERVE_STATIC=1`, or nginx proxying both from one domain) does not need it, because same-origin requests are not CORS requests. But if you serve the client from a **different origin** than the API (separate subdomain, separate CDN host, etc.), you MUST set `PUBLIC_ORIGIN` to the client's origin or every cross-origin API call and Socket.io connection will be blocked by the browser. Note this is the same variable as the build-time `PUBLIC_ORIGIN` below — set it in the runtime env too, not just the build | Same-origin deployments keep working; split-origin deployments are blocked (browser CORS errors on `/api/*` and the signaling socket) |
| `TRUST_PROXY_HOPS` | Recommended behind a proxy | `1` | Number of trusted reverse-proxy hops in front of the app. Express derives `req.ip` by counting this many entries from the right of `X-Forwarded-For`, and every per-IP limit keys on `req.ip` (see §7). Set it to the actual number of proxies you control in the chain | Defaults to 1 hop, matching the single-nginx setup in §4. If the value does not match your real chain, `req.ip` falls back to an attacker-controllable leftmost `X-Forwarded-For` token and every per-IP limit becomes trivially spoofable |

### Build-Time Variables

These are baked into the Docker image at build time. They are not runtime env vars.

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `BASE_PATH` | No | `/` | Frontend asset prefix for subpath deployments. Currently set as `ENV BASE_PATH=/` in the Dockerfile — to change it, edit the Dockerfile or add an `ARG` override in your build pipeline | Defaults to `/` |
| `VITE_VOID_ONION_HOST` | Required for production builds | `<56-char-base32>.onion` | The Tor v3 `.onion` mirror host baked into the bundle's onion affordance. `docker-compose.yml` forwards it from `.env` as a build arg. Under a production build the onion-bake guard **fails closed** if this is unset or not a valid v3 host, so a "Tor-reachable" bundle can never ship an inert onion link | A production build (`NODE_ENV=production`) **fails**; a non-production build (`NODE_ENV=development`) builds clearnet-only with no onion affordance |
| `PUBLIC_ORIGIN` | Required for production builds | `https://your-domain.example` | The absolute origin baked into the social-card metadata (`og:image` / `og:url`) by `gen-og-pages.mjs`. `docker-compose.yml` forwards it from `.env` as a build arg. Under a production build the OG generator **fails closed** if neither this nor `REPLIT_DOMAINS` is set, because relative OG URLs are rejected by Facebook/X/Slack/iMessage and would silently break every social preview. Like the onion host, it is baked into the bundle bytes | A production build (`NODE_ENV=production`) **fails**; a non-production build (`NODE_ENV=development`) still requires it only if `OG_STRICT=1` |
| `NODE_ENV` (build) | No | `production` (default) or `development` | At build time, selects the canonical production bundle (onion-bake guard ON — requires `VITE_VOID_ONION_HOST`) vs. a clearnet-only smoke-test bundle (`development`, guard relaxed). `docker-compose.yml` forwards your `.env` `NODE_ENV` into the build. The container's runtime `NODE_ENV` is separately pinned to `production` in the compose `environment:` block and is **not** read from `.env`, so a `development` value here only affects the build, never the running container's posture | Defaults to `production` |

### Room Types

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `TOR_ONLY` | Optional | unset, or `1` | Activates the onion-only runtime posture for the StartOS Tor-only deployment switch (see §6b). When set to `1`, `/api/ice-servers` omits any configured `STUN_URL` (a STUN request would leak each peer's public IP to a clearnet third party and defeat onion-only routing), the startup banner confirms the posture, and the server warns at startup if `TURN_URL` is set but is not a `turns:` relay on a `.onion` host. The manifest edit that removes the `lan-config` block is still the load-bearing part of the switch | App behaves as today; both surfaces are advertised by the StartOS package by default |

VOID is human-only; all agent code has been removed.

### Lightning

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `LIGHTNING_BACKEND` | Yes, for predictable behavior | `mock`, `lnbits`, or `btcpay` | Selects Lightning backend adapter | Often defaults to mock |
| `PAYWALL_SECRET` | Yes in production | random 32-byte hex string | JWT signing secret for host authorization | An ephemeral secret is auto-generated at startup — do not rely on this for production |
| `LNBITS_URL` | Required for LNbits | `http://lnbits-host:port` | LNbits base URL. For a Start9/StartOS LNbits reached over Tailscale use `https://<hostname>` (not a raw `100.x` IP) — see "Reaching LNbits over Tailscale" in the LNbits section | Ignored unless backend is `lnbits` |
| `LNBITS_API_KEY` | Required for LNbits | secret value | LNbits API key | Ignored unless backend is `lnbits` |
| `BTCPAY_URL` | Required for BTCPay | `https://btcpay.your-domain.example` | BTCPay base URL | Ignored unless backend is `btcpay` |
| `BTCPAY_API_KEY` | Required for BTCPay | secret value | BTCPay Greenfield API key | Ignored unless backend is `btcpay` |
| `BTCPAY_STORE_ID` | Required for BTCPay | store ID | Store to invoice against | Ignored unless backend is `btcpay` |
| `LIGHTNING_FETCH_TIMEOUT_MS` | No | `8000` | Per-request deadline (milliseconds) for every HTTP call to the Lightning backend. Raise it if you self-host on slow hardware (e.g. a Raspberry Pi) or reach your node only over a slow Tor first-hop. A value outside the range 1000–30000 is clamped to the nearest bound; a non-numeric, non-positive, or otherwise invalid value falls back to the 8000 default. Either correction logs a startup warning. The 30000 ceiling keeps a genuinely dead backend from hiding behind a minutes-long spinner | Server uses 8000 |

### TURN / STUN

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `TURN_URL` | Strongly recommended for production | `turns:turn.your-domain.example:5349?transport=tcp` | TURN server URL returned to clients | Clients fall back to STUN only |
| `TURN_SECRET` | Required if using TURN | random 32-byte hex string | Shared secret for ephemeral TURN credentials | TURN credential generation cannot work |
| `TURN_CREDENTIAL_TTL` | No | `4500` | Lifetime in seconds for generated TURN credentials. Default is 4500 (room TTL plus 10-minute buffer) to prevent late-session ICE restart failures | Server uses 4500 |
| `STUN_URL` | Strongly recommended for production | `stun:stun.your-domain.example:3478` | Self-hosted STUN URL prepended ahead of TURN in `/api/ice-servers`. Coturn answers STUN on the same `:3478` port it uses for TURN, so no extra daemon is needed — see §4a "Self-Hosted STUN" | If both `STUN_URL` and `TURN_URL` are unset, the server falls back to two Google public STUN URLs as a dev-only convenience and leaks peer IPs to Google on every call. If only `STUN_URL` is unset (but `TURN_URL` is set), the response includes only the TURN entry — calls still work, but srflx discovery is skipped |

### Operator Alerts (ntfy)

VOID can push operator alerts to an [ntfy](https://ntfy.sh) topic so a solo
operator is paged on the four signals that otherwise only surface in logs or a
GitHub issue: (1) a new High/Critical CVE in the daily dependency scan, (2) a
wave of CSP / Permissions-Policy violation reports, (3) a Lightning backend
changing its response shape, and (4) sustained payment-service slowness
(repeated `503 LIGHTNING_BACKEND_UNAVAILABLE`). All four route to one topic.

This is **entirely optional**. With no topic configured the alerting code is a
silent no-op — no errors, no behavior change. Subscribe to the topic in the
ntfy mobile/desktop app or via `curl -s https://ntfy.sh/YOUR_TOPIC/json`.

| Variable | Required | Typical Value | What It Does | If Unset |
|---|---|---|---|---|
| `NTFY_TOPIC` | Optional | a long, unguessable string | The ntfy topic to publish alerts to. **Treat as a secret** — anyone who knows the topic can read your alerts (and, on a public server, publish to it). Use a long random value, e.g. `void-alerts-$(openssl rand -hex 12)` | Alerting is disabled (silent no-op) |
| `NTFY_SERVER` | Optional | `https://ntfy.sh` | Base URL of the ntfy server. Point this at your own self-hosted ntfy for full sovereignty | Defaults to `https://ntfy.sh` |
| `NTFY_TOKEN` | Optional | ntfy access token | Bearer token for an access-controlled ntfy server (recommended if you self-host ntfy with auth) | No `Authorization` header is sent |

The CVE alert (signal 1) is fired by the `pnpm audit` GitHub Actions workflow,
not the api-server, so for that signal set `NTFY_TOPIC` (and optionally
`NTFY_SERVER` / `NTFY_TOKEN`) as **repository secrets**. Signals 2–4 are fired
by the api-server process, so set the same vars in the api-server's runtime
environment. Both paths use the same message format. Alerts are rate-limited /
deduped per signal so a storm of any one cannot flood the topic.

### Example Production .env

```bash
NODE_ENV=production
PORT=3000
SERVE_STATIC=1
# Required under NODE_ENV=production. The onion-bake guard fails closed without
# a valid 56-char base32 .onion mirror host, and gen-og-pages fails closed
# without an absolute PUBLIC_ORIGIN for social-card og:image / og:url metadata.
VITE_VOID_ONION_HOST=REPLACE_WITH_YOUR_56CHAR_BASE32.onion
PUBLIC_ORIGIN=https://void.your-domain.example

LIGHTNING_BACKEND=btcpay
PAYWALL_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
BTCPAY_URL=https://btcpay.your-domain.example
BTCPAY_API_KEY=REPLACE_WITH_BTCPAY_API_KEY
BTCPAY_STORE_ID=REPLACE_WITH_STORE_ID

TURN_URL=turns:turn.your-domain.example:5349?transport=tcp
TURN_SECRET=REPLACE_WITH_LONG_RANDOM_TURN_SECRET
STUN_URL=stun:stun.your-domain.example:3478
```

> `TURN_CREDENTIAL_TTL` is omitted here to use the server default of 4500 seconds. If you override it, keep it above 3900, which is the room TTL.

## 6. Platform-Specific Guides

### 6a. Umbrel

The repo includes an `umbrel-app.yml` manifest for Umbrel packaging. The current package version is `1.2.0`; the `releaseNotes` field on the manifest enumerates the security and resilience changes that have shipped since `1.1.0` (single-use room-creation JWTs, signed-hello with `roomId` binding, host-role bound to a recorded `paymentHash`, the placeholder-secret startup guards, the non-root container, the `BROWSER-LEVEL SURFACES` disclosure on the threat-model page, SRI / reproducible-build / CSP-HSTS posture cleanup, and so on). Read it before sideloading.

Umbrel is a fine place to run the VOID app. It is often a less fine place to run TURN. The reason is that Umbrel typically lives on a home network, home networks are often behind NAT, and TURN needs public reachability and open UDP. Many operators end up running VOID on Umbrel and Coturn on a public VPS. This is a perfectly reasonable arrangement.

Practical steps:

1. Update `umbrel-app.yml` with the current version and metadata
2. Provide your production env values: `PAYWALL_SECRET`, Lightning backend vars, `TURN_URL`, `TURN_SECRET`
3. Install as a local/community app or through your existing Umbrel sideload flow
4. Confirm the app responds over HTTPS, Socket.io signaling works, and TURN is reachable from the public internet

If your Umbrel box is not publicly reachable on the UDP relay range, do not pretend it is a good TURN host. Put TURN on a VPS and point the app at it.

### 6b. StartOS (Start9)

The repo includes a `manifest.yaml` intended for StartOS / Start9 packaging. The current package version is `1.2.0`; the `release-notes` block on the manifest enumerates the security and resilience changes that have shipped since `1.1.0`, and the `alerts.start` block lists the runtime environment variables the API server consumes (`LIGHTNING_BACKEND`, `PAYWALL_SECRET`, the LNbits/BTCPay credential triplets, `TURN_URL`, `TURN_SECRET`, `TURN_CREDENTIAL_TTL`, `STUN_URL`, `TRUST_PROXY_HOPS`, `PAYWALL_JITTER_MIN_MS`, `PAYWALL_JITTER_MAX_MS`, `PAYWALL_JITTER_DISABLE`, `LOG_LEVEL`, and the optional `NTFY_TOPIC` / `NTFY_SERVER` / `NTFY_TOKEN` operator-alert triplet). The health probe targets `/api/health`, the dedicated JSON endpoint exposed by the API server.

#### Configuration screen

You do **not** edit env vars by hand on StartOS. The manifest ships a `config` surface (`config_spec.yaml` / `config_rules.yaml` under the package `assets/`, driven by the StartOS `compat` image's `config get` / `config set` procedures) that renders as the package **Config** screen (Settings → Config). Every variable listed above has a field there — Lightning backend selector, paywall secret (masked), the LNbits/BTCPay credential groups, TURN URL/secret, TTL, STUN, trust-proxy hops, log level, the ntfy alert triplet, the Tor-only toggle, and the jitter bounds. Defaults shown in the UI match the code (`TURN_CREDENTIAL_TTL` 4500, jitter 10000/60000 ms, `TRUST_PROXY_HOPS` 1, `LOG_LEVEL` warn).

What you enter is validated by `config set`, persisted to `/root/start9/config.yaml` on the package's `main` data volume, and bridged into the container environment at boot by `deploy/startos/docker_entrypoint.mjs` (the `main` action's entrypoint): it reads that file, exports each field as the matching UPPER_SNAKE_CASE env var, and then imports the server. This data volume holds that config file; the only other thing VOID writes to disk is a minimal paid-room metadata snapshot (`data/rooms.json` — paid window, tier, room type, moderation flags, host-reclaim tokens; never room content or payment identifiers) that is rehydrated across restart so a paid host who refreshes mid-window need not re-pay, and is dropped once the paid window expires. Volatile per-socket room state, recovery codes, and the JWT secret stay in process memory and are wiped on restart, so the posture — no accounts and no room-content storage — is unchanged. Plain-Docker / Umbrel deployments do not use this entrypoint; they get their environment from `docker-compose.yml` directly.

Practical steps:

1. Update the manifest metadata and version
2. Build your `.s9pk` using your current StartOS SDK / packaging workflow
3. Sideload it through the StartOS UI
4. Open the package **Config** screen and set your Lightning backend, secrets, and TURN settings; configure public app domain/routing
5. Test from outside your LAN, not just inside it

The same caveat as Umbrel applies here. StartOS may live on a private residential network. That is fine for the app server. TURN still needs public reachability if you want reliable external calls.

A common sensible setup: StartOS runs the VOID app, a public VPS runs Coturn, the app uses that external TURN relay.

#### Tor-only Deployment (StartOS)

By default the StartOS package advertises **two** interfaces — a Tor hidden-service endpoint and a LAN HTTPS endpoint. Both point at the same backend port. Most operators want both, because LAN access is convenient and Tor access is opt-in for the users who need it.

If your threat model includes a hostile LAN — for example, you do not want devices on the same physical network to discover the app exists — you can ship the package `.onion`-only by editing the manifest before sideloading.

In `manifest.yaml`, delete (or comment out) the entire `lan-config:` block under `interfaces.main`:

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

Rebuild the `.s9pk` and sideload it. StartOS will only advertise the Tor hidden-service link in the dashboard.

**The security tradeoff is real, in both directions.** What you gain: the app is not reachable from the LAN at all, so devices on the same network cannot probe it, fingerprint it, or connect to it without going through Tor. What you lose: every device that wants to use the app — including ones on the same LAN as the host — has to talk to it over Tor, with the latency and connectivity quirks Tor brings (see §6c). WebRTC media is still browser-to-browser or via TURN; the Tor-only switch only changes how the *signaling* path is reached.

This is **not** the same as the operator-onion-mirror pattern, which keeps the LAN HTTPS interface and *adds* an `.onion` mirror in front of the same backend. The mirror gives Tor-aware users a Tor path without forcing every other user onto Tor. The Tor-only switch documented here is the stricter posture: no clearnet/LAN surface at all. The operator-onion-mirror runbook (filed separately) covers the additive pattern; this section covers the subtractive one.

Set `TOR_ONLY=1` alongside the manifest edit to activate the onion-only runtime posture. With it set, the API server: (1) omits any configured `STUN_URL` from `/api/ice-servers` — a STUN binding request would leak each peer's public IP to a clearnet third party during ICE gathering and defeat the posture; (2) prints a startup banner confirming the posture; (3) warns at startup if `TURN_URL` is configured but is not a `turns:` relay on a `.onion` host (a clearnet TURN relay reached off-Tor undermines onion-only routing); and (4) warns at startup if Cloudflare TURN credentials (`CLOUDFLARE_TURN_TOKEN_ID` / `CLOUDFLARE_TURN_API_TOKEN`, see §4a) are configured. The manifest edit that removes the `lan-config` block is still the load-bearing part of the switch. The manifest-review posture this implements — including the Tor-only deployment switch and its §11-limitation-9 cross-reference — is documented in `docs/security-audit-public-2026-04.md` §11 (limitation 9).

**Why Cloudflare TURN is warned (and not refused) under `TOR_ONLY`.** Stripping the clearnet STUN entry from the Cloudflare branch closed the STUN binding-request IP leak, but it does not make Cloudflare onion-safe: the Cloudflare relay *itself* terminates on Cloudflare's clearnet edge, so relayed call metadata (operator and peer IPs at relay-allocation time, packet timings) still transits a clearnet third party off-Tor. There is no `turns:`/`.onion` form of Cloudflare TURN that would keep this on Tor — the host is fixed clearnet — so the warning fires whenever the credentials are present, with no over-Tor exception. The server **warns rather than hard-refusing**: this mirrors the clearnet-`TURN_URL` behavior above (also warn-only) and avoids silently dropping the relay and breaking cross-NAT calls for an operator who chose Cloudflare deliberately — for example to stage a short cross-NAT test. An onion-only deployer who reads the banner can unset the two env vars; one mid-test keeps a working relay. Hard-refusal (start-time abort or dropping the Cloudflare branch under `TOR_ONLY`) was considered and rejected for that reason; if your threat model cannot tolerate any clearnet relay metadata at all, do not configure Cloudflare creds on a `TOR_ONLY` box and use a `.onion` `turns:` relay instead.

There is no Umbrel parallel because Umbrel's manifest does not have a `lan-config`-shaped block to remove. The Tor-only posture on Umbrel is achieved by enabling Umbrel's own per-app Tor exposure in the Umbrel UI and not publishing the local-network port; see §6a.

### 6c. Tor Hidden Service

You can expose VOID over Tor for signaling and access privacy. Two
deployment shapes use the same Tor primitive but mean different things,
and it is worth picking one deliberately:

- **Clearnet + `.onion` mirror.** You keep your existing public domain
  and additionally expose the same backend over a Tor hidden service.
  See `docs/onion-mirror-runbook.md` for the full operator runbook —
  tradeoffs, provisioning, verification, and how the mirror interacts
  with the rest of the deployment.
- **`.onion`-only (Tor-only).** No clearnet surface at all. This is
  the deployment switch tracked under the StartOS / Umbrel manifest
  review (Task #253), not this section.

The minimal torrc below is the per-host primitive both shapes share.

Minimal torrc example:

```text
HiddenServiceDir /var/lib/tor/void/
HiddenServicePort 80 127.0.0.1:3000
```

Restart Tor and read the generated hostname from the hidden service directory.

Tor is useful for hiding the origin of the web app request, protecting access to the signaling and control plane, and avoiding a public clearnet hostname.

<!-- banned-phrase-allow: canonical disclaimer wording per Task #238 quotes the deprecated terms to negate them -->
**Wording, said precisely (Task #238).** Either deployment shape above makes the package **`.onion`-reachable**: the signaling layer is fronted by a Tor hidden service and clients can reach it over Tor. Neither shape is **Tor-routed end-to-end**. WebRTC media still gathers ICE candidates on each peer's underlying network regardless of how the page loaded — so calls reached via `.onion` will still leak peer IPs to other peers unless relay-only is enabled, and even then will fall back to TURN-relayed media with degraded latency. The same caveat appears verbatim on `ThreatModelPage` ("TOR AND THE MEDIA PATH"). Operator-facing copy and the StartOS / Umbrel manifests use the same `.onion`-reachable phrasing rather than "Tor-by-default" or "Tor-routed".

WebRTC media over Tor is usually a bad experience. Expect higher latency, connectivity weirdness, TURN dependence, and degraded reliability. The technology was not designed for this.

Use Tor for signaling privacy if that matters to you, but do not expect it to make the calls good. If call quality matters, use Tor for the control plane and a proper TURN relay for the media path.

### 6d. VPS Providers

VOID runs fine on ordinary Linux VPS providers. Hetzner, DigitalOcean, Linode, and similar commodity hosts all work.

For the app server:

- 1 vCPU
- 512 MB RAM

For app and TURN together:

- 1–2 vCPU
- 1 GB RAM
- good outbound bandwidth

Use any recent Linux distribution you trust. Keep it boring. Boring infrastructure is reliable infrastructure.

Firewall ports to open:

```text
80/tcp
443/tcp
3478/tcp
3478/udp
5349/tcp
49152-65535/udp
```

You can run everything on one box — reverse proxy, VOID app, Coturn. That is the simplest production deployment. You can also run the app and TURN separately if you want to isolate relay traffic or place TURN closer to users. Both work.

### 6e. Go-Live: Standing Up the Canonical VPS-Front Instance

The sections above are a reference: each one explains a piece in isolation. This section is the opposite — one ordered runbook you can follow top to bottom to bring up the canonical public instance on a VPS-front, in the order the steps actually depend on each other. It is written for the instance that *advertises* the privacy posture, so it is deliberately stricter than the minimum a hobby deployment needs: a sovereign coturn relay (no third-party TURN), a built-and-served `.onion` mirror whose address is fixed *before* the build, log retention enforced in config rather than merely claimed, key backups, and an alert sink.

It cross-references the detailed sections rather than repeating them. Do the steps in order — several have hard prerequisites on earlier ones (the hidden-service key in particular must exist before anything is built).

#### Step 0 — Identity regime first (before you buy anything)

The canonical instance is run under a bounded pseudonym, and the bound is only as good as the first acquisition that breaks it. Decide and stand up the identity *before* you register a domain or pay a host, because the leak you cannot undo is the one in the signup you already completed. The hygiene checklist:

- **A dedicated email** used for nothing else — domain registrar, VPS account, alert sink, and any funder correspondence all go through this single mailbox, never a personal one.
- **Privacy WHOIS** on the domain (registrar WHOIS privacy / redaction). The `.onion` address needs no registrar, but the clearnet front does.
- **Privacy-respecting VPS acquisition** — a host and payment method that do not bind the box to your legal identity any harder than necessary. Pay in a way consistent with the pseudonym, not from a personal account that re-links everything.
- **Nym git authorship** — commits, tags, and the signing identity on the public repository use the pseudonym's name and the dedicated email, not your real-name git config. Set `user.name` / `user.email` for the repo explicitly so a stray global config does not leak through a single commit.

This is the load-bearing step the rest of the runbook assumes. Everything below — the domain, the host, the alert email — should be acquired *through* this identity, not retrofitted onto it.

#### Step 1 — Topology and proxy-hop trust

The canonical shape is **public internet → VPS-front (reverse proxy / TLS) → VOID app**. This is an ordinary self-managed proxy chain, not a managed platform that injects its own forwarding hops, so the proxy-hop assumption baked into the defaults has to be set to match *your* chain.

Set `TRUST_PROXY_HOPS` to the actual number of trusted proxies between the public internet and the app. For the single-nginx-on-the-VPS shape it is `1` (the default, matching §4). If you add a CDN or an external load balancer in front of that nginx, count *every* hop and set the number accordingly. Getting this wrong is not cosmetic: every per-IP limit keys on `req.ip`, and a too-low hop count lets a client forge `X-Forwarded-For` and mint a fresh rate-limit bucket per request. The full reasoning is in §7 "Trust Proxy and Per-IP Limits". Count the hops; do not guess.

#### Step 2 — Sovereign coturn relay + firewall ports

The canonical instance runs its **own** coturn relay with ephemeral HMAC credentials. Do not point it at a third-party TURN service — a relay you do not control sees the transport metadata (peer IPs, traffic volume) of every relayed call, which is exactly the exposure the deployment claims to bound. Stand up coturn per §4a, generate `TURN_SECRET` with `openssl rand -hex 32`, and set the same secret in the api-server env and in `coturn/turnserver.conf` (`static-auth-secret`). Drop any `STUN_URL` / `TURN_URL` pointing at someone else's infrastructure.

Then **open the relay ports** — closed relay ports are the single most common "calls silently fail" misconfiguration, and they fail *selectively* (same-NAT calls keep working, so it looks intermittent). Open:

```text
3478/tcp     # STUN / TURN
3478/udp     # STUN / TURN
5349/tcp     # TURNS (TLS)
49152-65535/udp   # relay range
```

Plus `80/tcp` and `443/tcp` for the app front. After bring-up, confirm `GET /api/ice-servers` from the *public internet* returns your STUN and TURN URLs, and that a real call surfaces `relay` ICE candidates (see §4a and §9 "Calls work for some users but not others"). If you only ever see `host`/`srflx` candidates, the relay is not actually reachable.

#### Step 3 — Persistent paywall secret + real Lightning backend

Set `PAYWALL_SECRET` to a **stable** value generated with `openssl rand -hex 32`, stored in the instance env (see §4e and §5). On the canonical instance this must be persistent: if it is left unset, the server synthesizes a fresh ephemeral secret on every restart, which silently invalidates all outstanding host JWTs and 4-word recovery codes — so a paying host who reconnects after a routine restart loses their room. (The deeper fix for persisting paid sessions across restart is tracked separately; for go-live the operator-side requirement is simply: set a stable `PAYWALL_SECRET`.)

Point `LIGHTNING_BACKEND` at a **real** backend — `lnbits` or `btcpay` — never `mock`, and set `NODE_ENV=production` (see §4b and §7). Mock invoices plus `NODE_ENV=production` means rooms can never be created; mock invoices with any other `NODE_ENV` means anyone can settle them for free via the `dev-pay` endpoint. Confirm `POST /api/paywall/dev-pay/anything` returns 404 in production.

#### Step 4 — Onion bake: key first, then CI, then provision

This is the step with the ordering trap. The `.onion` address is derived from the hidden-service **private key**, so the key — and therefore the address — must exist *before* anything is built. Resolve the chicken-and-egg in exactly this order:

1. **Generate the hidden-service key first.** Follow the key-generation step in `docs/onion-mirror-runbook.md` to create `/var/lib/tor/void/` and read the derived `*.onion` hostname. Do this *before* the first canonical build, not later — the address is an input to the build, not an output of the deploy. (If you have an existing key you intend to reuse, restore it from backup now; see Step 6.)
2. **Feed the fixed address into the canonical release CI** as the build-time `VITE_VOID_ONION_HOST` value, so the published, signed bundle is the onion-baked one. The address is **public** — it ships in the README and the page footer — so configure it as a CI **variable**, not a secret. Important: `release.yml` has **three** build steps (the `build-and-sign` job plus two `reproducibility-check` jobs), and all three should inject the **identical** value. The release-blocking check is the clean-container `reproducibility-check` job: if its rebuild does not match the signed bundle byte-for-byte, the release (correctly) refuses to publish — so a mismatch between `build-and-sign` and that job will stop the release. The arm64 `reproducibility-check-arm64` job runs informationally (`continue-on-error: true`) for Pi-class targets and does not by itself block the release, but give it the same value anyway so its diff stays meaningful.
3. **Then provision the instance around that fixed address** — DNS, TLS, the Tor hidden service bound to the key from step 1, and `ONION_HOSTNAME` set to the same address in the served instance env (§8.6 and `docs/onion-mirror-runbook.md`).
4. **Enable the onion-inertness build guard** for the production build. A production build of the canonical instance with the guard disabled is a deviation, not a shortcut — note it explicitly in the go-live record if you ever have to do it. (The guard's implementation is tracked separately; this runbook only requires that the operator build sets it.)

**Repository access while it is still private:** getting the source onto the build host happens *before* the Step 8 public flip, so at build time the repo is still private. A local build (Posture B) or any pre-launch checkout on the VPS must therefore use authenticated git — an HTTPS Personal Access Token or an SSH deploy key (same forms as §3 Step 1) — with the pseudonym's credentials from Step 0, not a real-name config. Posture A's release CI runs on the canonical repo and already has access. Only after Step 8 do unauthenticated clones work for anyone verifying the build.

**Choose a provenance posture and know what it lets you claim** — this is the same Posture A / Posture B distinction explained in detail in §7a ("The onion bake changes your hashes — and that's correct"):

- **Posture A (recommended for the canonical instance).** The canonical release CI builds with `VITE_VOID_ONION_HOST` already set, so the signed and SLSA-attested artifact *is* the onion-baked bundle for this address. Deploy that artifact unmodified and any visitor gets `/proof/runtime` matching `/api/proof/build` matching the cosign-signed `SHA256SUMS` for the release tag.
- **Posture B (self-hoster building locally).** You become your own reference: `/api/proof/build` reports *your* bundle's sums, and a visitor verifies your instance against itself plus a rebuild from the same commit — not against the canonical release sums. Honest, but a weaker external claim (determinism from source, not provenance from the signed release).

**Never hand-edit the served bundle to insert the onion address after a canonical build.** That silently breaks every hash in the chain and is indistinguishable from tampering. The address goes in at build time or not at all.

#### Step 5 — Enforce log retention in config

The published "What we log" policy at `/why` names a ≤5-day retention ceiling. On the canonical instance that claim must be *true in config*, not aspirational. Install the shipped `deploy/logrotate.d/void` config as `/etc/logrotate.d/void`, or set `MaxRetentionSec=5day` in `journald.conf` if you stream stdout through journald (see §7 "Logging Hygiene" and Appendix A item 8). Then make the running server verify it at startup by setting one of `LOG_RETENTION_MAX_DAYS` (simplest, e.g. `5`) or `LOGROTATE_CONFIG_PATH` (e.g. `/etc/logrotate.d/void`) — the server emits a loud `WARN` at startup if the effective ceiling exceeds 5 days or the config cannot be read.

#### Step 6 — Back up the hidden-service private key

Back up the hidden-service private key from `/var/lib/tor/void/` to secure offline storage, following the backup/rotate procedure in `docs/onion-mirror-runbook.md`. **Losing this key loses the `.onion` address forever** — and that address is printed in the README, on every page footer, and in any funder correspondence, so it is not a value you can quietly rotate after launch. Treat it like the load-bearing secret it is.

#### Step 7 — Wire an alert destination

Point the operational alerting paths (CVE / dependency-audit, CSP-report, Lightning-backend failures) at a real sink — ntfy, email through the dedicated mailbox from Step 0, or whatever you actually watch. The incident-response runbook (`docs/incident-response.md`) assumes alerts land somewhere a human sees them; an unrouted alert is the same as no alert.

#### Step 8 — Dogfood, then sequence the launch

Before pointing the world at the box, dogfood it against the existing smoke checklist and the production checklist in Appendix A. The go-live **acceptance gate** is:

1. **Config roundtrip** — env vars load as intended; `/api/ice-servers` returns your STUN+TURN from the public internet; `dev-pay` is 404 in production.
2. **Two-device call** — a real call between two separate devices/networks connects and carries media.
3. **Onion join pins relay-only** — joining over the `.onion` origin negotiates relay-only so peer IPs are not shared peer-to-peer.
4. **Restart persistence** — restart the app and confirm a previously issued host JWT / recovery code still works (this is the `PAYWALL_SECRET` persistence check from Step 3).
5. **`/proof/runtime` green-match over BOTH origins** — open `/proof/runtime` over the **clearnet** origin *and* over the **`.onion`** origin, on the same release, and confirm both show a green row-by-row match against `/api/proof/build`. For Posture A, also confirm both match the cosign-signed `SHA256SUMS` for the tag (the cross-network ritual in §7a).

Record the result as a dated **go-live note**: the posture chosen (A or B), the served `gitSha` (from `/api/proof/build`), and the pass/fail of each gate item above. That note is the artifact that says "this box is the release it claims to be."

**Then sequence the launch as explicit, ordered events:**

1. **Repository public first.** Make the canonical public repository available before anything points at it, so a reader who follows the announcement can immediately verify the build (the §7a chain only works if the repo and its release assets are reachable).
2. **Then announce the instance.** The instance announcement comes after the repo is public and the go-live gate is green — not before.

**Grant-timing rule:** do **not** publish the instance announcement while a funding application is in flight. The public product story refers to "the project's funders" generically on purpose; tying a live announcement to an in-flight application couples the launch to a decision you do not control and risks leaking funder-relationship detail that is not part of the public story. Announce on your own schedule, after the application's state is settled.

## 7. Security Hardening

Privacy software does not become private because it says the word "private" on the landing page. It becomes private because people who built it did specific technical things correctly and then did not do other things that would have undone those specific technical things.

Do the basics well.

### Secrets

Use strong, unique secrets for `PAYWALL_SECRET` and `TURN_SECRET`. Generate both:

```bash
openssl rand -hex 32
```

The API server refuses to start if either `TURN_SECRET` or `PAYWALL_SECRET` is set to one of the known placeholder strings shipped in this README and the example configs (`YOUR_SECRET_HERE`, `REPLACE_WITH_LONG_RANDOM_SECRET`, `YOUR_STRONG_SECRET`, `changeme`, etc.). The server logs a `FATAL` line naming the offending variable and exits before any port is bound. If you see that log, generate a real secret with `openssl rand -hex 32` and try again.

`PAYWALL_SECRET` may be left unset on a single-instance deployment — the server then synthesizes a strong ephemeral secret per process (JWTs are invalidated on restart, by design). The placeholder check runs whether or not the variable is set, so an empty `PAYWALL_SECRET=` is fine but `PAYWALL_SECRET=REPLACE_ME` is not.

### TLS Everywhere

Use HTTPS for the app. Use `turns:` for TURN when possible. Do not run a public deployment over plain HTTP and then talk about sovereignty in the README. These are not compatible positions.

### Coturn Hardening

Keep the Coturn protections enabled:

- denied private peer ranges
- `no-multicast-peers`
- `no-cli`

These settings are already in the example config. Do not remove them.

### Room-Type Policy

VOID is human-only; all agent code has been removed.

### NODE_ENV Policy

Always set `NODE_ENV=production` for any public deployment.

When `NODE_ENV` is not `production`, the server exposes a `dev-pay` endpoint that allows settling invoices without paying. This is a convenience for local development. It is a security hole on a public server. Set it to `production`. Do not forget.

### Built-In Limits

VOID already benefits from strict product limits:

- 4 users max
- 65-minute room TTL
- ephemeral room state
- rate limiting on signaling paths

These limits are not a nuisance. They are part of the security posture. A small room that forgets you quickly is harder to abuse than a large one that remembers everything.

### Trust Proxy and Per-IP Limits

Every per-IP limit — the per-IP connection cap, the per-IP join-failure throttle, and the `/paywall/recover` and `/ice-servers` rate buckets — keys on `req.ip`. Express derives `req.ip` by walking `X-Forwarded-For` from the right and skipping `TRUST_PROXY_HOPS` entries (default 1, matching the single-nginx setup in §4). If that count does not match the real proxy chain — say you run CDN → load balancer → app but still trust 1 hop — `req.ip` resolves to the leftmost `X-Forwarded-For` token, which the client controls. An attacker then rotates a fake header per request, mints a fresh bucket every time, and every per-IP limit collapses. Set `TRUST_PROXY_HOPS` to the actual number of trusted proxies between the public internet and the app. Count the hops; do not guess.

### Logging Hygiene

The app stores no persistent room history. This is true. It is also only part of the picture.

Your infrastructure may still log: reverse-proxy access logs, Docker stdout/stderr, Coturn logs, cloud provider metadata, system logs.

If you want minimal residue, reduce access logging, rotate logs aggressively, avoid verbose debug mode in production, and know what your host and proxy keep by default.

"No database" is true. "No operational metadata anywhere" is not automatically true. It depends on what you configure.

### Clock Sync

Keep server time correct. Room expiry, JWT validity, and TURN credential validity all depend on time being sane.

Use NTP.

## 7a. Verifying the Build (Reproducible Bundles)

A self-host story is only worth the bytes it ships. This section lets a stranger with no project history confirm the bytes their browser is loading match a tagged release built by the public CI — and, equally, lets them notice if they don't.

The mechanism has three loose layers and one ritual.

### What the release publishes

Every tagged release (`v*`) attaches the following assets to its GitHub Release:

- `SHA256SUMS.void-client` — the load-bearing one. Sorted, `LC_ALL=C`-stable sha256 of every file under the void-client bundle (`dist/public/`). This is the file the reproducibility CI job rebuilds and diffs byte-for-byte; this is the file you should diff locally too.
- `SHA256SUMS` — combined manifest containing the same `void-client` section plus the api-server Docker image digest from the canonical CI builder. Convenient single file for cosign verification.
- `SHA256SUMS.sig` and `SHA256SUMS.pem` — cosign keyless signature and certificate, bound by GitHub OIDC to the release workflow run that produced them
- `.docker-base-digest` — the exact base-image digest (`node:22.12.0-slim@sha256:…`) the release was built against
- SLSA build provenance, attached as an attestation on the void-client bundle and on `SHA256SUMS`

The release workflow (`.github/workflows/release.yml`) also runs a second job in a clean container that rebuilds the void-client bundle from the same git SHA and diff-asserts the resulting `SHA256SUMS` byte-for-byte. If a build-step nondeterminism (timestamps, source ordering, locale-dependent output) sneaks in, the release fails loudly rather than publishing an unverifiable bundle.

### Verify the signature

```bash
cosign verify-blob \
  --certificate-identity-regexp '^https://github\.com/<your-org>/<repo>/\.github/workflows/release\.yml@refs/tags/v[0-9]+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate SHA256SUMS.pem \
  --signature SHA256SUMS.sig \
  SHA256SUMS
```

Replace `<your-org>/<repo>` with the actual GitHub path. If verification passes you know `SHA256SUMS` was produced by the named workflow at the named tag — no long-lived signing key was involved.

### Rebuild from the recipe (copy-paste runnable)

The release publishes the exact base-image digest it was built against. Use it:

> **Read this before you run it — the onion address is a build input.** A `NODE_ENV=production` build bakes the `.onion` mirror address in via `VITE_VOID_ONION_HOST` and **fails closed if it is unset** (the onion-bake guard). That address is also part of the bytes: a bundle built with a different address (or none) hashes differently, so the `diff` below will not match. You must pass the address that was baked into the build you are checking:
>
> - **Verifying the canonical signed release (Posture A):** set `VITE_VOID_ONION_HOST` to the *canonical* address (printed in this README and the page footer). Your rebuild should then match the published `SHA256SUMS.void-client` byte-for-byte.
> - **Verifying your own self-hosted build (Posture B):** set it to *your* address. Your rebuild reproduces *your* bundle, not the canonical release — that is correct and expected. Do not diff a build with your own onion against the canonical sums.
>
> See §7a ("The onion bake changes your hashes — and that's correct") for the full Posture A vs B explanation. `ONION_HOST` below is a placeholder for whichever of the two you are verifying.

```bash
# 0. The .onion address baked into the build you are verifying (Posture A:
#    the canonical address; Posture B: your own). A production build fails
#    closed without it.
ONION_HOST=<56-char-base32>.onion

# 1. Read the digest the release was pinned to.
DIGEST=$(grep '^digest=' .docker-base-digest | cut -d= -f2)

# 2. Rebuild the void-client bundle in a clean container at the same SHA.
#    A production build (NODE_ENV=production) bakes in a Tor .onion mirror host
#    and the onion-bake guard FAILS THE BUILD CLOSED if it is unset — so you
#    must pass VITE_VOID_ONION_HOST here, and it must be the SAME address the
#    bundle you are verifying was built with (for the canonical release, the
#    address printed in this README / the page footer; for your own instance,
#    your own address). See "The onion bake changes your hashes" below for
#    Posture A vs. Posture B. Build the same address in or your diff in step 4
#    will (correctly) not reproduce.
git checkout <tag>           # e.g. v1.3.0
docker run --rm -v "$PWD":/src -w /src -e ONION_HOST "node:22.12.0-slim@${DIGEST}" \
  bash -c '
    apt-get update && apt-get install -y --no-install-recommends git ca-certificates
    # node:22.12.0-slim bundles corepack 0.29.4, which predates pnpm signing-key
    # rotation and fails with "Cannot find matching keyid". Pin a corepack that
    # carries the rotated keys first (matches the Dockerfile), then enable it.
    npm install -g corepack@0.34.5 && corepack enable && corepack prepare pnpm@10.26.1 --activate
    pnpm install --frozen-lockfile --prefer-offline
    NODE_ENV=production PORT=3000 BASE_PATH=/ VITE_VOID_ONION_HOST="$ONION_HOST" \
      pnpm --filter @workspace/void-client run build
  '

# 3. Recompute the bundle hashes the same way the release workflow did.
( cd artifacts/void-client/dist/public && \
  LC_ALL=C find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum ) \
  > SHA256SUMS.local

# 4. Compare against the released SHA256SUMS.void-client byte-for-byte.
diff -u SHA256SUMS.void-client SHA256SUMS.local && echo "REPRODUCED."
```

If the `diff` is empty, your local rebuild produced the same bytes the reference you targeted did (the canonical release under Posture A, or your own build under Posture B). If it is non-empty, that is the loud, honest failure mode — but first double-check you baked the *same* `ONION_HOST` the reference was built with, since a different onion address alone changes every hash.

The published Docker image digest is "what the canonical CI builder said" rather than something every reader can independently re-derive across all hosts — kernel and glibc variation across build hosts makes whole-image reproducibility impractical. The void-client bundle, which is what the user's browser actually executes, *is* reproducible from the recipe above. The image digest is for cross-checking the same builder over time, not for cross-checking across builders.

### Verify provenance

```bash
gh attestation verify SHA256SUMS --repo <your-org>/<repo>
```

This walks the SLSA attestation attached to the asset and confirms the workflow run identity.

### What the server claims it is serving

Every running VOID server exposes:

```bash
curl https://your-server.example/api/proof/build
```

The response includes the git SHA, build timestamp, Node version, and the same per-file sha256 map for the void-client bundle. A short caveat is part of the JSON body — read it. It says exactly what this endpoint can and cannot prove.

### The cross-network-path ritual (this is the load-bearing one)

A targeted attacker who controls the edge between you and the server can rewrite both the JS bundle and the `/api/proof/build` response together. SRI on the entry HTML covers asset-level tampering as long as the entry HTML itself is honest; this endpoint covers what the server claims to be serving; neither alone defeats a bespoke malicious bundle delivered to one user.

The check that does defeat it:

> Fetch `/api/proof/build` from a network you don't normally use (mobile data, a friend's machine, a Tor exit), and from your normal browser, on the same release. If the two responses don't match each other, or don't match the cosign-signed `SHA256SUMS` for the release tag, something is between you and the server.

In the app itself, `/proof/runtime` hashes the JS bundles your current browser session actually loaded with `crypto.subtle.digest` and compares each one against `/api/proof/build` row by row. Run that page on two different networks for the same release and the comparison takes about a minute and zero new tooling.

### Verify the onion-only posture (attestation)

The reproducible-build chain above proves *what bytes the server serves*. It does
not, on its own, tell you whether the operator runs the privacy posture the threat
model assumes: `TOR_ONLY` in force, no STUN in `/api/ice-servers` (so a peer's
public IP is never put on the wire to a clearnet STUN host), and onion-fronted
ingress. Every running server now exposes that posture, bound to the same build
identity:

```bash
curl https://your-server.example/api/proof/posture
```

The JSON reports `torOnly`, `iceStunSuppressed`, `onionIngress`
(`{configured, hostname}`), and a single `onionOnlyPostureActive` flag that is
true only when all three hold. It is bound to `gitSha` / `releaseTag` so you can
tie the posture to a build you have already verified, and it is served
`Cache-Control: no-store` because the posture is runtime config, not an immutable
per-commit artifact. In the app, `/proof/runtime` renders the same facts under
**POSTURE ATTESTATION** and degrades honestly — when the posture is not the
onion-only one it says so plainly rather than implying it is.

**Read the `caveat` in the body — it is the load-bearing part.** This attestation
verifies *the published, reproducible build's posture at the moment you read it*.
It does **not** prove the operator is running the un-modified attested binary (a
modified binary can report anything — that is what the reproducible-build chain
above is for), it does **not** prevent the config changing a millisecond after you
read it (a time-of-check/time-of-use window), and it does **not** rule out a
logging proxy sitting in front of the attested process and recording IPs upstream
of it. To make it meaningful, bind it to the build identity via the cosign-signed
`SHA256SUMS` and the cross-network ritual above, and read it from a network you do
not normally use — the same defense that makes `/api/proof/build` trustworthy.

### The onion bake changes your hashes — and that's correct

If the instance serves a Tor `.onion` mirror, the `.onion` address is baked into the client at build time via `VITE_VOID_ONION_HOST` (see §6e and §8.6). That one build-time input changes the bundle's bytes — and therefore every per-file sha256 in `SHA256SUMS.void-client`. This trips people up, so state it plainly: **a bundle built with an onion address will not match a bundle built without one, and that difference is expected, not corruption.** Different build inputs, different bytes, different (equally valid) hashes.

What matters is that whatever you verify against was built with the *same* address you are serving. There are two honest postures, and you should know which one you are in.

**Posture A — verify against the canonical signed release (recommended for the canonical instance).**
The canonical release CI builds with `VITE_VOID_ONION_HOST` already set to the canonical address, so the cosign-signed, SLSA-attested `SHA256SUMS` *describes the onion-baked bundle*. Deploy that release artifact unmodified and the whole chain lines up for any visitor: `/proof/runtime` (what their browser loaded) matches `/api/proof/build` (what the server says it serves) matches the signed `SHA256SUMS` for the release tag. This is provenance — "these bytes came from the named workflow at the named tag" — and it only holds if the address went in at build time in CI. For this to work, the *same* address must be injected into all three build steps in `release.yml` (the `build-and-sign` job and both `reproducibility-check` jobs). The release-blocking diff is the clean-container `reproducibility-check` job: a mismatch between it and `build-and-sign` fails the byte-for-byte assertion and the release refuses to publish. The arm64 `reproducibility-check-arm64` job is advisory (`continue-on-error: true`) and does not block on its own, but give it the same value too so its diff stays meaningful. The address is public (it ships in this README and the page footer), so it belongs in CI as a *variable*, not a secret.

`PUBLIC_ORIGIN` is the second build input under the exact same rule. The OG page generator bakes the absolute origin into every social-card's `og:image` / `og:url`, so it changes the bundle bytes just like the onion address does — and a production build fails closed without it. CI sources it from the public `PUBLIC_ORIGIN` repo *variable* (again public, not a secret) and injects the identical value into all three `release.yml` build steps and the Docker image's frontend stage. Change one build step's `PUBLIC_ORIGIN` (or `VITE_VOID_ONION_HOST`) without the others and the reproducibility diff fails for the wrong reason.

**Posture B — verify against your own rebuild (self-hoster building locally).**
If you build the bundle yourself with your own `.onion` address, you become your own reference. `/api/proof/build` reports *your* bundle's sums, and a visitor verifies your instance against itself plus a rebuild from the same commit *with the same `VITE_VOID_ONION_HOST` and `PUBLIC_ORIGIN`* — not against the canonical release sums. To reproduce locally, add your address to the build step of the recipe above:

```bash
NODE_ENV=production PORT=3000 BASE_PATH=/ \
  VITE_VOID_ONION_HOST=youraddress.onion \
  PUBLIC_ORIGIN=https://your-domain.example \
  pnpm --filter @workspace/void-client run build
```

Then recompute and `diff` exactly as above; an empty diff means your two builds agree. This is an honest claim — *determinism from source* — but a weaker one than Posture A, because it proves your bytes are reproducible from your commit, not that they came from a signed canonical release. That is fine: it is the correct posture for an independent self-host, and it fails loudly the same way if something does not reproduce.

**What you must not do, in either posture:** do not hand-edit the served bundle to splice the onion address in after a build. That changes the bytes *without* changing what produced them, so it breaks every hash in the chain and is indistinguishable from a tampered bundle to anyone running the verification. The address goes in at build time or not at all.

## 8. Updating

One of the genuine pleasures of an app with almost no state is that updates are boring. There is nothing to migrate. No schema to alter. The only thing on disk is the minimal paid-room metadata snapshot (`data/rooms.json`), which the server rehydrates itself across a restart so paid hosts keep their window — you do not manage it by hand.

### Update Flow

```bash
git pull
docker compose build --pull
docker compose up -d
```

If you want a cleaner rebuild:

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### No Migrations

There is no database, so there are no schema migrations. A restart wipes all volatile room state (peers, sockets, pending knocks, recovery codes, the JWT secret) by design; the one exception is the minimal paid-room metadata snapshot (`data/rooms.json` — paid window, tier, room type, moderation flags, host-reclaim tokens; never room content or peer identities), which is rehydrated on startup so a paid host who refreshes mid-window need not re-pay (see §4e).

### What to Check After Updating

- release notes and changelog for new env vars
- reverse proxy still points to the correct service
- TURN still authenticates correctly
- Lightning backend still works
- PWA cache behavior after major frontend changes

If the frontend had a significant asset or service-worker update, test from a clean browser profile as well.

## 9. Troubleshooting

### "Video calls don't connect"

Most likely causes:

- TURN not configured
- TURN misconfigured
- relay ports blocked
- UDP blocked by firewall
- clients on restrictive NAT

Check `TURN_URL` and `TURN_SECRET`, Coturn logs, firewall rules, and whether clients are receiving relay ICE candidates. If you see only host or srflx candidates, the TURN server is not being reached.

### "The page loads, but room join/signaling fails"

Most likely cause: the reverse proxy is not forwarding WebSocket upgrades.

Check `/api/socket.io`, proxy upgrade headers, proxy HTTP version, and proxy logs.

### "Payment isn't working"

Check `LIGHTNING_BACKEND`, backend-specific env vars, network connectivity from the container to LNbits or BTCPay, API key scopes and permissions, and app logs during invoice creation and status polling.

### "Room expired immediately"

Check system clock, NTP sync, whether the server time is sane, and whether the browser resumed from sleep with a stale page.

### "I can access it locally, but not from other devices"

Check the reverse proxy and published ports, the host firewall, Docker port binding, DNS, and whether the app is actually reachable on `0.0.0.0` through the proxy path.

### "Calls work for some users but not others, and nothing in the logs looks wrong"

The most common cause is an ICE-servers misconfiguration that fails *selectively* rather than loudly. Check `GET /api/ice-servers` from the public internet and confirm it returns both your `STUN_URL` and your `TURN_URL`. If the response is empty or contains only Google STUN URLs, see §4a — your env vars are not wired the way you think they are. LAN / same-NAT calls will keep working in that state, which makes the failure look intermittent.

### "TURN works on one network but not another"

That usually means one path has UDP trouble, TCP/TLS fallback is missing, the relay range is blocked, or the ISP or network is filtering traffic.

Expose both:

- UDP TURN if possible
- TLS TURN on 5349/tcp

### Useful Commands

```bash
docker compose ps
docker compose logs -f void
docker compose logs -f coturn
```

If you need to dig deeper, use your browser's WebRTC diagnostics and inspect the ICE candidate types.

## 10. FAQ

### Is there a database to back up?

No database. There is no user table, no message archive, no call history, and no room content. The single piece of server-written state is a minimal paid-room metadata snapshot (`data/rooms.json` — paid window, tier, room type, moderation flags, host-reclaim tokens; never room content), which the server manages itself and drops when the paid window expires; it is not worth backing up, since losing it only means a mid-window host may need to re-pay.

What you should back up: your `.env`, Coturn config, proxy config, certificates, and manifest or package metadata if you maintain your own deployment packaging.

### Can I run this without Lightning?

For development and testing:

```bash
LIGHTNING_BACKEND=mock
NODE_ENV=development
```

Mock invoices are created in memory and settled via the `dev-pay` endpoint, which is available only when `NODE_ENV` is not `production`. Together these two variables give you a complete payment loop without a Lightning node.

For a real public deployment, use LNbits or BTCPay Server.

If you want production free rooms, that is a deliberate code and fork decision, not a stock self-host env toggle.

### How many simultaneous rooms can one server handle?

The signaling server itself is lightweight. Room state is just in-memory objects.

In practice, your real bottlenecks are TURN bandwidth, the number of relayed participants, screen sharing, and network egress.

The app is light. Relay traffic is not. Keep that distinction in mind when sizing.

### Can participants see each other's IPs?

Potentially yes, in direct WebRTC mode. Browsers may expose direct network candidates to establish peer-to-peer paths.

If you want to reduce that exposure, run a TURN relay and prefer relay-only behavior where appropriate.

### Does the server see my video or audio?

The VOID app server does not carry your media. Media flows peer-to-peer or through TURN relay. TURN relays encrypted SRTP packets and cannot decrypt the media content, but it can observe transport metadata such as IPs and traffic volume.

Signaling payloads are encrypted end-to-end on the client side before they touch the server.

### Can I run everything on one VPS?

Yes. A single small VPS can run the reverse proxy, the VOID app, and Coturn. That is the simplest production deployment. TURN needs public UDP and enough bandwidth. Keep those requirements in mind.

### Is a home server good enough?

Sometimes. A home server works if you have a public IP, inbound port forwarding, an ISP that does not block UDP, and enough upstream bandwidth.

If you do not have those things, keep the app at home if you want and run Coturn on a public VPS.

### Does restarting the server kill active rooms?

It drops the live server room state (peers, sockets, pending knocks) immediately. Already-established peer-to-peer media may continue briefly because the media path is direct. Volatile per-socket state does not survive the restart — but a minimal paid-room metadata snapshot (`data/rooms.json` — paid window, tier, room type, moderation flags, host-reclaim tokens; never room content) is rehydrated on startup so a paid host who refreshes mid-window need not re-pay. It is not a full clean slate for paid rooms; it is a clean slate for everything volatile, by design.

## Appendix A: Production Checklist

Before you point DNS at this thing. Run through this list — roughly ordered by severity — and only then go live. Env-var details live in §5; this checklist intentionally just names them.

1. **Generate a strong `TURN_SECRET`** — `openssl rand -hex 32` (≥ 32 chars). Set it in the API server env *and* in `coturn/turnserver.conf` as `static-auth-secret`. The api-server refuses to boot on the well-known placeholder values.
2. **Set `PAYWALL_SECRET` to a stable value** — `openssl rand -hex 32`. If unset, the server generates an ephemeral per-process secret on every start, silently invalidating all outstanding host JWTs and 4-word recovery codes on each restart.
3. **Set `LIGHTNING_BACKEND` to `lnbits` or `btcpay`** — never leave it at `mock` in production. With `NODE_ENV=production` mock invoices can never be settled (room creation fails); with `NODE_ENV` anything else, anyone can settle them for free.
4. **Set `NODE_ENV=production`** — this also unmounts the `dev-pay` endpoint. Confirm by hitting `POST /api/paywall/dev-pay/anything` and checking that it returns 404, not 200.
5. **Run `pnpm audit` against the lockfile** — pairs with the release-time audit automation. Fail the deploy on any high/critical advisory you have not consciously waived.
6. **Firewall / port exposure** — only the api-server's HTTP(S) port needs to be public-facing through your reverse proxy. For Coturn, expose the documented ports (`3478/tcp`, `3478/udp`, `5349/tcp`, and the `49152-65535/udp` relay range; see §4a). Nothing else should be reachable from the internet.
7. **Healthcheck / monitoring** — point your monitoring at `/api/health` (mirrored at `/api/healthz`) and alert on non-2xx. The endpoint returns a deterministic JSON body without loading the client bundle.
8. **Log retention** — VOID does not log signaling content by design. Keep it that way. If you bolt on observability, do not add request-body logging, transcript capture, or anything else that re-introduces content logging. `LOG_LEVEL` defaults to `warn`; leave it there or quieter. The published "What we log" policy at `/why` names a ≤5-day retention ceiling — enforce it with the shipped `deploy/logrotate.d/void` config (install it as `/etc/logrotate.d/void`), or set `MaxRetentionSec=5day` in `journald.conf` if you stream stdout through journald. The HTTP access logger scrubs the 32-hex room code from 2xx URLs (`<room-id>` placeholder) and the Socket.io lifecycle logger applies the same rule to connect/join/leave/disconnect lines; both are pinned by `artifacts/api-server/src/__tests__/access-log-scrub.test.ts` and `socket-lifecycle-log.test.ts` so the published policy cannot silently drift from the wire.

   **Opt-in startup verification of the ceiling.** Installing the logrotate config is on the operator — nothing forces it, so a box that silently keeps logs for a year still serves the "≤5 days" claim on its own `/why` page. To have the running server check this at startup, set one of:
   - `LOG_RETENTION_MAX_DAYS` — your log rotation's worst-case retention in whole days (e.g. `5`). Simplest and most reliable; it does not depend on parsing a config file. Takes precedence over the probe below.
   - `LOGROTATE_CONFIG_PATH` — a path to your installed logrotate config (e.g. `/etc/logrotate.d/void`). The server reads it at startup and derives the effective retention from its `rotate`/`maxage`/frequency directives, confirming the config it documents is the one actually on disk.

   When either is set and the effective ceiling exceeds 5 days — or the env value cannot be parsed, or the config path cannot be read or has no `rotate`/`maxage` directive — the server emits a single loud `WARN` line at startup naming the figure and pointing back here. If neither is set the check stays silent (a default deploy does not read arbitrary files). The published ceiling and the check live in `artifacts/api-server/src/lib/logRetention.ts`.
9. **Backup posture: intentionally minimal** — the only server-written state is a short-lived paid-room metadata snapshot (`data/rooms.json`, bounded by each room's paid window — at most 24 h — and never room content), which exists so a paid host survives a restart; it is not worth backing up (a lost snapshot only means a mid-window host may need to re-pay) and there is no accounts/user database (see §10 "Is there a database to back up?"). Document this for whoever inherits the box so a well-meaning operator does not bolt a database onto an otherwise content-free system. Back up your `.env`, Coturn config, proxy config, and TLS certificates — that is it.
10. **Upgrade procedure** — pull, regenerate any built artifacts, restart. Existing peer-to-peer connections continue across the restart: the api-server handles `SIGTERM` gracefully, and because media flows browser-to-browser (or via TURN), in-call peers stay connected while the signaling process cycles. New joins resume once the server is back. Operator-set `PAYWALL_SECRET` and `TURN_SECRET` persist across restarts because they live in your env (not in any package-managed volume), so previously minted host JWTs and TURN credentials remain valid for their TTL.

## Final Advice

If you want the shortest possible path to a good deployment, do this:

1. Run VOID on a small VPS
2. Put HTTPS in front of it
3. Run Coturn on the same VPS or another public VPS
4. Use BTCPay or LNbits
5. Set strong secrets
6. Keep the product human-only
7. Accept that the best architecture is the one you can still explain to yourself six months later

That is the self-hosting version of the product philosophy.

Small room. Short life. Little residue.
