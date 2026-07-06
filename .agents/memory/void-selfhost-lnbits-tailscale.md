---
name: VOID self-host — reaching a Start9 LNbits over Tailscale
description: How the canonical VOID VPS must address a Start9/StartOS LNbits over Tailscale (hostname+SNI on 443, extra_hosts, StartOS CA), and where it's now documented.
---

# Canonical VOID self-host: LNbits on Start9, reached over Tailscale

The operator's canonical VOID instance runs on a Debian VPS via Docker (Path B,
`NODE_ENV=production`, `LIGHTNING_BACKEND=lnbits`). LNbits lives on a **Start9
(StartOS)** box whose native address is a Tor `.onion`; the VPS reaches it over
**Tailscale**, not Tor. The VOID container has no Tor, so an `.onion` `LNBITS_URL`
can't resolve → invoice creation hard-fails with a 500 (client shows "Failed to
generate invoice. Try again." — the non-503 hard-error path, distinct from the 503
"slow backend" path).

**This is now documented** in `README-selfhost.md` → "Reaching LNbits over Tailscale
(Start9 / StartOS)" (sibling to the Tor-bridge section). Prefer editing that section
over re-deriving the below.

## The non-obvious model (why the "obvious" LNBITS_URL fails)
StartOS does NOT expose a plain `host:port`. Its single reverse proxy routes **by
hostname (SNI/`Host`) on HTTPS 443**. Each service is a name: LAN = mDNS `*.local`
on 443 with a **StartOS private-CA** cert; remote = `.onion` (plain HTTP inside Tor).

So the fix is NOT a raw `https://100.x` (that was my earlier WRONG note). Three edges,
all cleared from inside the container by a `docker-compose.override.yml`:
1. **Resolution** — container's Docker resolver resolves neither mDNS `.local` nor
   Tailscale MagicDNS `*.ts.net`; pin the service hostname to the Start9's tailnet
   `100.x` IP via `extra_hosts`.
2. **SNI/Host** — `LNBITS_URL=https://<hostname>` (the same name), so resolved name,
   SNI, Host header, and cert subject all agree.
3. **Trust** — StartOS-CA cert isn't publicly rooted; Node `fetch` (LNbits adapter
   uses global fetch, no custom agent) rejects it. Mount the StartOS root CA and set
   `NODE_EXTRA_CA_CERTS`. EXCEPTION: if the working tailnet URL is a `*.ts.net` name
   the browser already trusts (Tailscale-issued LE cert), skip the CA mount.

## Gotchas
- Change `.env`/override then `docker compose up -d` (recreate) — `restart` does NOT
  re-read env or apply override structure. `LNBITS_URL`/`LNBITS_API_KEY` are read at
  process start, not baked into the Vite build.
- **Authoritative reachability test = `docker compose exec void node -e 'fetch(...)'`**,
  NOT busybox `wget`: `wget` reads the OS trust store, not `NODE_EXTRA_CA_CERTS`, so a
  wget cert error is a false negative for the app's actual trust path.
- Which certificate case the operator is in is driven by the exact URL that already
  loads the LNbits UI from another tailnet device + whether the browser trusts it.

**Why:** StartOS's SNI-on-443 routing means a raw tailnet IP in `LNBITS_URL` cannot
work — the naive "just use the 100.x IP" fix is wrong and must not be reintroduced.
