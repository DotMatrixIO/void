# Operator Runbook: `.onion` Mirror for a Clearnet VOID Deployment

This runbook is for operators who already run a clearnet VOID deployment
(public domain, HTTPS, real Lightning backend) and want to additionally
expose a Tor `.onion` mirror that points at the same backend. It is
**doc-only** — no VOID code or manifest changes are required. Everything
here is operator infrastructure.

If you instead want a `.onion`-only deployment with no clearnet surface
at all, that is a different option owned by the StartOS / Umbrel
manifest review (Task #253) and the Tor-only deployment switch landing
there. This runbook is specifically for **clearnet + `.onion` mirror**,
where both surfaces share one backend.

## Quickstart

If you already understand the tradeoffs and just want a mirror in front
of an existing clearnet VOID deployment, this is the minimum sequence.
Replace `127.0.0.1:3000` with the loopback address of your reverse
proxy's plain-HTTP upstream if you front the API with one (recommended
— see §4c of `README-selfhost.md`).

```bash
# 1. Install Tor (Debian/Ubuntu shown; use your distro's package).
sudo apt-get update && sudo apt-get install -y tor

# 2. Append the hidden service block to /etc/tor/torrc.
sudo tee -a /etc/tor/torrc >/dev/null <<'EOF'
HiddenServiceDir /var/lib/tor/void-mirror/
HiddenServicePort 80 127.0.0.1:3000
EOF

# 3. Restart Tor and read the generated .onion hostname.
sudo systemctl restart tor
sudo cat /var/lib/tor/void-mirror/hostname

# 4. Smoke-test the mirror over Tor's local SOCKS port (default 9050).
ONION=$(sudo cat /var/lib/tor/void-mirror/hostname)
curl --socks5-hostname 127.0.0.1:9050 -i "http://${ONION}/api/health"
```

A `200 OK` from step 4 means the mirror is live. For tradeoffs,
reverse-proxy notes, source-IP and rate-limit caveats, full
verification, and how the mirror interacts with the rest of the
deployment, read the rest of this document.

## What an `.onion` mirror gives you (and what it doesn't)

A Tor hidden service in front of your existing API server hides the
operator's IP from clients reaching the mirror, and lets clients reach
VOID without revealing their own IP at the network layer to the
operator. It does **not** make the call itself private in any
new way. Specifically:

- **Hides:** the operator's server IP from mirror visitors; the
  visitor's IP from the operator on the signaling/control plane
  (`.onion` connections terminate inside the Tor network at the
  hidden service's rendezvous point — there is no Tor exit node
  involved, and the operator never sees the visitor's address).
- **Does not hide:** anything about the WebRTC media path. Media still
  flows peer-to-peer (or via TURN) over the regular internet, exactly
  as on the clearnet surface. A `.onion` URL does not tunnel media.
- **Does not improve E2EE:** the cryptography on the wire is the same
  end-to-end encryption the clearnet deployment already provides. Tor
  is a network-layer wrapper, not a content-layer one.
- **Does not eliminate metadata at peers:** in default (non-relay-only)
  rooms, peers still exchange ICE candidates with each other directly.
  See `ThreatModelPage` → "Network observers and IP visibility" for
  the precise list.

For the asymmetric leak surface around `relayOnly` and what the mirror
does and does not change about it, see the security audit §2.3 (`docs/security-audit-public-2026-04.md`).

VOID's client already auto-enables relay-only when the page is loaded
from a `.onion` host, so users who arrive via the mirror get the
expected media-path behaviour without any manual toggle. This is the
same code path documented in the ThreatModelPage Tor section — no new
code lives here, the runbook just enables the surface.

### Mirror vs. Tor-only: pick one model deliberately

| Model | Clearnet surface | `.onion` surface | Owner |
|---|---|---|---|
| Clearnet only | yes | no | default self-host (this README's §6c is the per-host reference) |
| Clearnet + `.onion` mirror | yes | yes (this runbook) | operator |
| `.onion` only (Tor-only switch) | no | yes | Task #253 / StartOS manifest |

Running both surfaces means anyone who finds either URL gets the same
backend. That is the point of a mirror, and it is also the thing to be
honest with users about: a leak on the clearnet surface is a leak for
the mirror's users too, because they share a process.

## Provisioning a Tor hidden service in front of the API

The infrastructure is straightforward. You need a working Tor daemon on
the same host (or a host that can reach the API server over the loopback
or a private network) and one block of `torrc`.

```text
# /etc/tor/torrc  (excerpt)
HiddenServiceDir /var/lib/tor/void-mirror/
HiddenServicePort 80 127.0.0.1:3000
```

If your API server is already fronted by an HTTPS reverse proxy (Nginx,
Caddy, Traefik — see §4c of `README-selfhost.md`), point the hidden
service at the proxy's plain-HTTP upstream rather than at the app
container directly, so the proxy still applies the same headers,
WebSocket upgrades, and rate limits to mirror traffic. A typical line
looks like:

```text
HiddenServicePort 80 127.0.0.1:8080
```

where `127.0.0.1:8080` is the plain-HTTP port the reverse proxy
exposes locally for the VOID upstream.

Restart Tor and read the generated hostname:

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/void-mirror/hostname
```

The output is your `.onion` address. Treat the contents of
`/var/lib/tor/void-mirror/` as a private key file — back it up if you
care about keeping the same `.onion` across host rebuilds, and
permission it to the `tor` user only. The "Backing up and rotating the
hidden-service key" section below walks through the actual procedure.

### Source IP, rate limits, and logging on the mirror

When Tor runs on the same host as the API server (or its reverse
proxy) and forwards to a loopback port, every mirror request arrives
at the app from `127.0.0.1` (or whatever loopback / private address
the Tor daemon connects from). Operator implications:

- **Per-IP rate limits behave differently for mirror traffic.** A
  rate limiter keyed on the request source address will treat all
  mirror users as one client. Either accept that the mirror shares
  one bucket, or key the limiter on something other than IP for the
  mirror upstream (and accept that you have less Sybil resistance on
  that surface than on clearnet).
- **Access logs do not contain visitor IPs for mirror traffic.** This
  is a privacy feature, not a bug, but it does mean operator-side
  abuse triage on the mirror is limited to application-layer signals
  (room codes, payment hashes, rate of join attempts) rather than
  network identity.
- **Do not try to recover the visitor IP.** Hidden-service connections
  do not carry one. Any header an operator forwards claiming to be
  the visitor's address (`X-Forwarded-For`, etc.) on the mirror
  upstream is something the operator wrote, not something the
  network produced — strip it at the proxy if you forward at all.

### Discoverability: the `Onion-Location` header

The clearnet API server emits the standard `Onion-Location` response
header on https responses when the `ONION_HOSTNAME` environment
variable is set to the mirror's `.onion` address. Tor Browser reads
this header and surfaces a one-click "this site has an onion version
— switch?" affordance, so users on Tor Browser auto-discover the
mirror without anyone having to copy the address by hand.

To enable, set `ONION_HOSTNAME` on the **clearnet** API server
process to the same hostname you read out of
`/var/lib/tor/void-mirror/hostname`:

```bash
# /etc/systemd/system/void-api.service.d/onion.conf  (or equivalent)
Environment="ONION_HOSTNAME=abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz23.onion"
```

Restart the API server and confirm with curl against the clearnet
host:

```bash
curl -sI https://void.example/api/health | grep -i ^onion-location
# Onion-Location: http://abcdefghijklmnopqrstuvwxyz23...onion/api/health
```

For an automatable check that catches the same misconfiguration —
"the middleware shipped but `ONION_HOSTNAME` is missing from the
deployment's environment" — there is a smoke script you can run from
any machine with network access to the clearnet origin:

```bash
SMOKE_ONION_ORIGIN=https://void.example \
  pnpm --filter @workspace/api-server run smoke:onion-location

# Or with explicit flags:
pnpm --filter @workspace/api-server run smoke:onion-location -- \
  --origin=https://void.example \
  --path=/api/health \
  --expect-hostname=abcdefghijklmnopqrstuvwxyz23...onion
```

The script fetches the origin over https, asserts that the
`Onion-Location` header is present, that its scheme is `http://`,
that its hostname matches the `<base32>.onion` shape pinned by the
middleware, and that its path equals the request path (so the Tor
Browser prompt lands users on the same page, not the homepage).
Exit code is `0` on pass, `1` on a header that is missing or
malformed, `2` on usage / network errors. Wire it into the
deployment / release checklist or a smoke workflow so a future
secret-rotation that forgets `ONION_HOSTNAME` fails the release
loudly. After rotating the `.onion` key (see the rotation procedure
above), re-run the script with `--expect-hostname=<new>` to confirm
the deployment is advertising the new address and not still pointing
at the burned one.

This wiring is already in place for the canonical hosted deployment
via `.github/workflows/onion-smoke.yml`, which runs this same script
automatically after every `release` workflow completes and again on a
daily schedule (task #423). To opt in on a self-hosted fork, set two
repository Variables on the deployment's GitHub repo:

- `SMOKE_ONION_ORIGIN` — the clearnet https origin to probe
  (e.g. `https://void.example`). Without this the workflow is a no-op
  so self-hosted forks without a published origin don't see spurious
  failures.
- `SMOKE_ONION_EXPECT_HOSTNAME` *(optional)* — the exact `.onion`
  hostname the deployment should be advertising. Intentional rotations
  require updating this variable in the same PR that updates the
  deployment's `ONION_HOSTNAME` secret, so a silent drift between the
  two surfaces fails the next scheduled smoke loudly.

A failure fails the workflow run and opens (or comments on) an
`onion-smoke` labelled GitHub issue; the next green run auto-closes
it. After an intentional rotation, kick the workflow manually
(`workflow_dispatch`) with the new hostname in the `expect_hostname`
input before updating the variable, to confirm the deployment is
serving the new address.

The header is path-equivalent — it carries the same path the user is
reading, so the prompt lands them on the same page on the mirror, not
the homepage. It is suppressed automatically on plain-HTTP responses
(Tor Browser ignores it there) and on requests that already arrived
via the `.onion` (avoiding a no-op switch loop). If your reverse
proxy strips response headers, allow `Onion-Location` through.

The browser client carries a matching `VITE_VOID_ONION_HOST` build-
time env var that drives the "ALSO ON .ONION" footer link and the
in-app copy helper on `ThreatModelPage`, so users on other Tor-aware
browsers (Brave Tor, Orbot-routed connections) and users who want to
share the address out of band can find the mirror without depending
on Tor Browser's automatic prompt.

### Notes on TLS, headers, and WebSockets

- **TLS:** Tor provides the transport authentication and
  confidentiality for `.onion` connections. You do not need a public
  CA cert for the mirror, and serving the mirror over plain HTTP from
  the hidden service to the loopback is the standard pattern. If you
  are using HSTS on the clearnet host, do not preload the `.onion`
  hostname.
- **Headers:** the API server's existing security headers apply
  unchanged. There is nothing mirror-specific to configure here.
- **WebSockets:** Socket.io signaling must work over the mirror, so
  if you front the hidden service with a reverse proxy, that proxy
  must forward `Upgrade` / `Connection` headers correctly (the same
  requirement called out in §4c of `README-selfhost.md`).

## Backing up and rotating the hidden-service key

The directory referenced by `HiddenServiceDir` (in this runbook,
`/var/lib/tor/void-mirror/`) is what binds your operator identity to a
specific `.onion` address. Lose it and the address is gone forever;
leak it and someone else can impersonate your mirror. Treat it the way
you would treat a TLS private key.

The directory typically contains:

- `hs_ed25519_secret_key` — the private key. **This is the secret.**
- `hs_ed25519_public_key` — the public key, derived from the secret.
- `hostname` — the `.onion` address, derived from the public key.
- (older Tor versions, or v2 services, may have additional files; copy
  the whole directory rather than cherry-picking.)

### Back up

Stop Tor (or at least make sure nothing is writing to the directory),
then copy the entire directory off the host while preserving ownership
and permissions:

```bash
sudo systemctl stop tor
sudo tar -czpf void-mirror-hs-backup.tar.gz -C /var/lib/tor void-mirror
sudo systemctl start tor
```

Move `void-mirror-hs-backup.tar.gz` somewhere safe — encrypted offline
storage, a hardware token, or an encrypted password manager attachment
are all reasonable. **Do not** check this file into a git repo, paste
it into a chat, or upload it unencrypted to S3, R2, or any other shared
object-storage bucket. If you must store it in cloud storage, encrypt
it first with a key the cloud provider does not hold (e.g. `age`,
`gpg`, or a passphrase-protected archive).

### Restore on a fresh host

On the new host, install Tor, write the same `torrc` block from the
provisioning section, then drop the backup into place before starting
Tor for the first time:

```bash
sudo systemctl stop tor
sudo mkdir -p /var/lib/tor
sudo tar -xzpf void-mirror-hs-backup.tar.gz -C /var/lib/tor
sudo chown -R tor:tor /var/lib/tor/void-mirror
sudo chmod 700 /var/lib/tor/void-mirror
sudo systemctl start tor
sudo cat /var/lib/tor/void-mirror/hostname
```

The `hostname` file should print the same `.onion` address you had
before. Give Tor a minute to publish the descriptor, then re-run the
`curl --socks5-hostname` health check from the "Verifying the mirror
is reachable" section.

### Deliberately rotate to a new `.onion`

Sometimes you want a new address — for example, the old one was
printed on materials you no longer want associated with the mirror, or
you simply want a clean identity. Rotation is destructive: there is
no way to "rename" a hidden service, only to throw away the old key
and let Tor generate a new one.

```bash
sudo systemctl stop tor
sudo rm -rf /var/lib/tor/void-mirror
sudo systemctl start tor
sudo cat /var/lib/tor/void-mirror/hostname
```

The new `hostname` file is your new `.onion`. Publish it wherever you
previously published the old one. **Every link, QR code, bookmark,
README, social post, and printed sticker pointing at the old hostname
is now dead** — Tor will not resolve it, and there is no redirect
mechanism at the hidden-service layer. Plan the rotation around that
fact: update your published references first or in lockstep, and
expect a window where users on stale links land on nothing.

### Suspected key compromise

If you believe `hs_ed25519_secret_key` has leaked — a backup ended up
somewhere it should not have, a host was compromised, an old disk left
your custody without being wiped — treat the address as burned and
rotate immediately using the procedure above. There is no revocation
mechanism for a hidden-service key; the only remediation is to stop
using it and publish a new one. After rotating:

- Securely destroy any backups of the old key you still control
  (`shred`, crypto-erase, physical destruction of the medium).
- Announce the new `.onion` through whatever out-of-band channel your
  users trust, and explicitly mark the old one as no longer operated
  by you. An attacker who holds the old key can keep serving content
  at that address.
- Audit how the key got out before restoring from any other backup —
  if your backup pipeline is the leak, restoring from it just
  reproduces the problem.

## Verifying the mirror is reachable

From any machine with a Tor client (the Tor Browser, or `tor` running
locally with a SOCKS port on `127.0.0.1:9050`):

```bash
# Replace with the hostname you read out of the HiddenServiceDir.
ONION=abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuvwxyz23.onion

# Health endpoint should return HTTP 200.
curl --socks5-hostname 127.0.0.1:9050 -i "http://${ONION}/api/health"
```

You should see a `200 OK` and the same body the clearnet `/api/health`
endpoint returns. If you get a connection error, the most common
causes are:

1. Tor has not finished publishing the descriptor yet (give it a
   minute on first launch).
2. The `HiddenServicePort` target is wrong — the daemon is listening
   on a different loopback port than you wrote in `torrc`.
3. A reverse proxy in front of the API is rejecting the request because
   of `Host` header checks. Either accept the `.onion` hostname
   explicitly in the proxy config or relax the host filter for the
   mirror upstream.

### Automatable version: `smoke:onion-reachable`

The `curl --socks5-hostname` line above is the manual version of an
end-to-end reachability check. There is a script that does the same
thing non-interactively, suitable for a release checklist or a smoke
workflow:

```bash
SMOKE_ONION_ORIGIN=https://void.example \
  pnpm --filter @workspace/api-server run smoke:onion-reachable

# Or with explicit flags:
pnpm --filter @workspace/api-server run smoke:onion-reachable -- \
  --origin=https://void.example \
  --path=/api/health \
  --socks=127.0.0.1:9050 \
  --expect-hostname=abcdefghijklmnopqrstuvwxyz23...onion
```

Unlike `smoke:onion-location` (which only proves the clearnet origin is
*advertising* an `.onion`), this script reads the advertised
`Onion-Location` value, then connects to that `.onion` through the local
Tor SOCKS proxy (default `127.0.0.1:9050`, override with `--socks` or
`SMOKE_ONION_SOCKS`) and asserts that `/api/health` returns `200` with
the **same body** the clearnet origin returns. A reachable address that
serves a different body fails the check — that means the `.onion` is
fronting a different backend than the clearnet origin. It hands the
hostname to the proxy for resolution (SOCKS5h), because `.onion` names
only resolve inside the Tor network.

It catches the failure mode the location smoke cannot: a stale
`ONION_HOSTNAME` left pointing at a hidden service that was rotated or
taken down. After rotating the key (see "Deliberately rotate to a new
`.onion`" above), re-run with `--expect-hostname=<new>` to confirm the
deployment is advertising *and* serving the new address.

Exit codes mirror the manual check's intent: `0` on a reachable mirror
with a matching body, `1` when the advertised `.onion` is unreachable,
returns non-200, or serves a mismatched body, and `2` on usage errors
or an unreachable / malformed clearnet origin. Crucially, if no Tor
SOCKS port is reachable the script **skips** with a clear log line and
exits `0`, so a CI runner without a Tor daemon does not false-fail.

This is wired into CI as the `reachable` job in
`.github/workflows/onion-smoke.yml`: it installs and starts Tor on the
runner, waits for Tor to reach 100% bootstrap (failing the job if it
does not — otherwise the script's skip-on-no-Tor behaviour would let a
broken runner pass silently), then runs `smoke:onion-reachable` against
the configured origin. Like the location smoke it is opt-in via the
`SMOKE_ONION_ORIGIN` / `SMOKE_ONION_EXPECT_HOSTNAME` repository
Variables, runs on each `release` and daily on a schedule, and
opens/closes an `onion-smoke`-labelled issue on failure/recovery. To
run it by hand, do so on a machine where `tor` is up (or use Tor
Browser's SOCKS port).

For a fuller smoke test, open the `.onion` URL in Tor Browser and walk
through the host flow end to end: pay an invoice (use your real
Lightning backend, not `mock`, for a public mirror), create a room,
then join it from a second Tor Browser window. You should see
relay-only mode auto-enable in the room settings without you toggling
it. That confirms the client-side `.onion` detection is firing on
mirror traffic.

## How the mirror interacts with the rest of the deployment

- **No code changes.** The API server does not need to know it is
  being reached over Tor. It serves the same routes, the same Socket.io
  endpoint, and the same static frontend.
- **One backend, two surfaces.** Rooms created via the clearnet host
  and rooms created via the mirror live in the same in-memory state.
  A host who paid on clearnet can have guests join from the `.onion`
  and vice versa, as long as they share the VOID Phrase out of band.
- **Auto relay-only on `.onion`.** The client detects the `.onion`
  hostname and turns on relay-only mode automatically for rooms that
  load from the mirror. Operators do not need to configure this.
- **Lightning paywall.** The paywall runs unchanged. If you are
  running a real Lightning backend (LNbits, BTCPay), invoices created
  via the mirror are settled by the same node. There is nothing
  mirror-specific to configure on the paywall.
- **TURN.** The TURN relay is still reached on the public internet by
  the user's browser, not over Tor. This is intentional — sending
  WebRTC media through Tor produces unusable call quality. The mirror
  protects the signaling/control plane; TURN protects the media path.

## Cross-references

- `README-selfhost.md` §6c (Tor Hidden Service) — the per-host
  configuration reference. This runbook is the operator-level companion
  that explains the *why* and the *tradeoffs*.
- `artifacts/void-client/src/pages/docs/DocsThreatModelPage.tsx`
  (rendered at `/docs/threat-model`) — the unified threat model users
  read, including the "NETWORK OBSERVERS AND IP VISIBILITY" and
  "TOR AND THE MEDIA PATH" sections this runbook cross-references. The
  short-form `ThreatModelPage` summarises and links out to this page
  after the Task #550 split. The mirror does not change any claim
  there; in particular it does not improve the media-path privacy
  story.
- Task #253 (StartOS / Umbrel manifest review) — owns the
  `.onion`-only / Tor-only deployment switch, which is a different
  product configuration from this runbook.
- `docs/security-audit-public-2026-04.md` §2.3 — the asymmetric
  leak surface around `relayOnly`, relevant context for what the
  auto-enable-on-`.onion` behaviour does and does not buy you.
- `docs/tor-circuit-degradation-runbook.md` — the launch-window
  rehearsal harness for the A.14 gate: a reproducible way to introduce
  circuit latency/jitter and a forced circuit drop to a live Tor
  session, to witness that a call resumes within 30s with relay-only
  preserved.
