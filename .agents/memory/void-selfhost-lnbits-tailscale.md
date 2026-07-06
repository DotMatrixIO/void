---
name: VOID canonical self-host LNbits-over-Tailscale
description: The operator's canonical VOID VPS reaches its LNbits backend on a Start9 (onion) via Tailscale — use the tailnet IP, not the onion, in LNBITS_URL.
---

# Canonical VOID self-host: LNbits reachability

The operator's canonical VOID instance runs on a Debian VPS via Docker (Path B,
`NODE_ENV=production`) and uses `LIGHTNING_BACKEND=lnbits`. The LNbits wallet
lives on a **Start9 server**, whose native address is an **onion**, but the VPS
reaches it over **Tailscale**, not Tor.

**Rule: `LNBITS_URL` on the VPS must be the Tailscale address of the Start9, NOT
the onion.** The VOID container has no Tor proxy — the LNbits adapter uses plain
`fetch`, so an `.onion` `LNBITS_URL` cannot resolve and invoice creation hard-fails
with a 500 (client shows "Failed to generate invoice. Try again.", which is the
non-503 hard-error path, distinct from the 503 "slow backend" path).

**How to apply:**
- Use the raw Tailscale **100.x.y.z IP** in `LNBITS_URL`, not the MagicDNS name —
  the Docker container uses Docker's resolver, not the host's Tailscale MagicDNS
  (100.100.100.100), so `*.ts.net` names won't resolve inside the container.
- `LNBITS_URL` / `LNBITS_API_KEY` are read at process start (module load), NOT
  baked into the Vite build. Changing `.env` needs `docker compose up -d`
  (recreate) to take effect — `docker compose restart` alone does not re-read `.env`.
- Verify container→Start9 reachability from inside the container before blaming the
  app: `docker compose exec void sh -c 'wget -qO- --header="X-Api-Key: <key>" http://100.x.y.z:<port>/api/v1/wallet'`.
- Watch for TLS: if Start9 serves LNbits over HTTPS with a self-signed cert on the
  tailnet, Node `fetch` rejects it (still surfaces as a 500). Prefer the plain-http
  tailnet endpoint/port if one is exposed.

**Why:** compression repeatedly loses this topology; the onion-vs-tailscale swap is
the recurring failure and the operator has flagged that I "forgot" it.
