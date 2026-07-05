---
name: VOID relay-only verification can't pass on a single host
description: Why node-datachannel relay-only (iceTransportPolicy=relay) peers + coturn on one host never select a relay/relay pair, so the SDK relay verifier fails and crashes mid-handshake.
---

# Relay-only WebRTC verification fails when both peers share a host

When the VOID SDK demo peers (`buyer`/`seller`, `tool-server`/`tool-client`) run
relay-only (`unsafeAllowDirectTransport=false`, i.e. `iceTransportPolicy=relay`)
against a coturn on the **same host** (single-host CI, e.g. GitHub Actions runner
or the Replit container), they cannot establish a verified relay path.

## What actually happens (measured, node-datachannel 0.32.2, coturn on 172.24.0.2)
- `iceTransportPolicy:"relay"` IS honored: a single relay-only PC gathers **only**
  a `relay` candidate (no host/srflx). Verified with a one-PC gather probe.
- BUT a two-peer connection still selects a **host/prflx** pair, not relay/relay:
  - offerer: local=`host`, remote=`relay`
  - answerer: local=`relay`, remote=`prflx`
- **Why:** both peers' base UDP sockets AND coturn's relay-allocation ports all live
  on the same reachable IP. Peer A's base socket reaches peer B's coturn relay port
  *directly* (same host), forming a peer-reflexive pair that bypasses the relay.
  ICE prefers it (higher priority than relay↔relay). This is inherent ICE behavior,
  not a node-datachannel bug.

## Consequence / the crash it causes
- The SDK relay verifier (`relayVerifier.ts` `classifyPair`) requires BOTH
  `local.type==="relay"` AND `remote.type==="relay"`. The host/prflx pair → "not-relay"
  → `onUnverified` → `agent.close("relay_path_unverified")` nulls `controlChannel`.
- This races `exchangeHellos()` (started right after `startRelayVerification()` in
  `agent.init`): if close() lands between the `onMessage` setup and `controlChannel!.send`,
  you get `TypeError: Cannot read properties of null (reading 'send')` at agent.ts
  (exchangeHellos) instead of a clean error. That null.send is a *symptom*, not the root.

## The only real fix (implemented)
Network isolation: run the two peers in **separate network namespaces**, mutually
reachable ONLY via coturn (no direct host route), AND give coturn a relay-ip that
DIFFERS from every peer's base-socket IP (coturn permission-by-IP otherwise lets the
base→relay shortcut through even with isolation). Then the sole working pair is
relay↔relay.

The harness stays single-process but launches each peer wrapped in
`ip netns exec <ns>` via the `SMOKE_WRAP_<ROLE>` hook (`peerLaunchCommand` in
`lib/void-agent-sdk/demo/shared.ts`; wrapper is a no-op when unset, so local/no-TURN
runs are unchanged). The wrapped harness MUST run as root so the wrapper needs no
`sudo` — a `sudo` would strip the spawn env and the two peers would derive different
room keys from different ephemeral TEST_SECRETs.

Pieces (all committed): `coturn/ci-netns-setup.sh` (up/check/down: two netns
`ns-peer-a`/`ns-peer-b` reused across both harnesses, dedicated relay-ip on a dummy
iface, per-peer route ONLY to the relay), `coturn/turnserver.ci.conf` (IPs passed at
launch, not hardcoded), `.github/workflows/connection-smoke.yml` (builds topology,
starts coturn+API, runs `demo` + `demo:tools` relay-backed, honest skip/fail).

**Why this matters:** the naive single-host coturn-as-CI-service approach does NOT
produce a relay-verified path. Validating the netns topology needs `ip`/veth which
is absent and `iptables` denied in the Replit executor, so it cannot be de-risked
locally — the real GitHub Actions run is the only proof and must be triggered by a
human (the agent cannot trigger GH Actions).

## Do NOT
- Do not weaken the relay verifier to accept host/prflx — it's production privacy code
  and out of scope for the CI task.
- Do not mock the transport to force green.
