# Runbook: introducing a reproducible Tor circuit degradation for the A.14 rehearsal

This is the "before the window" setup that `LAUNCH-CHECKLIST-2.md`
A.14 (Tor circuit-degradation resilience) flagged but did not build. It
gives a launch-window operator a **deterministic, on-demand** way to put
latency / jitter on a live Tor session and to force a circuit drop
mid-call, so the A.14 DoD can be witnessed rather than waited-for.

It is **doc-only** — no VOID code or manifest changes. Everything here
is operator-side tooling (Tor's control port and Linux `tc netem`) run
against a real production deployment over a real Tor circuit. Task #748
closed the code side (the client's reconnection / relay-only-preserving
behaviour); this runbook is the rehearsal harness that exercises it.

## What A.14 actually exercises (read this first)

The thing that rides the Tor circuit is the **signaling / control
plane** — the Socket.IO connection to `/api/socket.io`. WebRTC **media**
does not go over Tor: ICE/TURN traffic gathers on each peer's own
network and relays via the operator's TURN server on the clearnet
internet (`docs/onion-mirror-runbook.md` "TURN", `README-selfhost.md`
§6c). So degrading the Tor circuit degrades signaling, not the media
bytes directly.

A circuit **drop** is therefore felt as a Socket.IO disconnect. On
reconnect the client tears down and rebuilds every peer connection
(`useRoomConnection.ts` `reconnect` → `manager.reinitializeAllPeers`),
re-runs the ECDHE handshake, and rebuilds each `RTCPeerConnection`
**using the current `iceTransportPolicyRef`** (`useRoomSignaling.ts`).
When the page was loaded over `.onion` that ref is pinned to `relay`
locally regardless of the room setting (`lib/origin.ts`
`initialIceTransportPolicy`), which is the property A.14 checks survives
the rebuild. During the rebuild each peer tile shows the
`secure-channel-failure` overlay once and clears it once when the new
channel comes up (`pages/room/PeerTileGrid.tsx`).

Relevant client timings to set expectations against the 30s budget:
ICE-disconnect debounce ~2s before an ICE restart, ECDHE key-exchange
timeout 5s, post-retry grace 5s (`lib/webrtcIceMonitor.ts`,
`lib/webrtc.ts`). A clean circuit drop should resume well inside 30s; if
it does not, that is the gate failing, not the harness.

## Why this method, not "wait for a flaky circuit"

A.14's DoD requires the drop to be repeatable so a `pass`/`fail` is
honest. Waiting for a circuit to misbehave on its own is exactly the
hand-wave the "before the window" note warns against. The two methods
below are both **operator-triggered and instantaneous**:

1. **Forced circuit drop** via Tor's control-port `CLOSECIRCUIT` — the
   surgical primary method. You close exactly the circuit carrying the
   call's onion stream, on demand, and time the recovery.
2. **Latency / jitter** via Linux `tc netem` on the Tor client's egress
   — for the "degrade, observe it limps, then drop" variant and for
   showing the call survives a slow circuit without dropping.

## The rehearsal rig

You need a Tor client whose control port you can reach and (for method
2) whose network interface you can shape. Pick one:

### Rig A — standalone `tor` + a SOCKS-pointed Chromium (recommended)

Best for evidence capture: Chromium gives you `chrome://webrtc-internals`
for the `iceTransportPolicy` check, and a standalone `tor` gives you a
clean control port and an interface you can `netem` without touching the
operator's own connectivity (run it in a throwaway VM or a network
namespace).

```bash
# 1. Minimal controllable tor (separate from any system tor).
cat > /tmp/void-rehearsal-torrc <<'EOF'
SocksPort 9050
ControlPort 9051
CookieAuthentication 1
DataDirectory /tmp/void-rehearsal-tor
EOF
tor -f /tmp/void-rehearsal-torrc &

# 2. Chromium routed through that tor. SOCKS5 with remote DNS lets
#    Chromium resolve and reach .onion hosts via the proxy.
chromium \
  --user-data-dir=/tmp/void-rehearsal-chrome \
  --proxy-server="socks5://127.0.0.1:9050" \
  --host-resolver-rules="MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"
```

Load the deployment's `.onion` mirror (relay-only auto-enables) **or**
the clearnet origin and toggle relay-only in room settings. Either way
confirm relay-only is on before you start — A.14 is about preserving it.

### Rig B — Tor Browser (no extra install)

Tor Browser bundles its own `tor` with a control port on **9151**
(cookie auth). Use it when you cannot stand up a standalone daemon. The
`iceTransportPolicy` check is then done via `about:webrtc` (Firefox)
instead of `chrome://webrtc-internals`. Substitute `9151` for `9051`
in every control-port command below.

## Method 1 — forced circuit drop (primary, deterministic)

Run this from the same host as the Tor client. It authenticates to the
control port with the cookie, finds the circuit carrying the onion
stream, and closes it.

### Fast path — `scripts/tor-rehearsal-drop.sh`

The helper does all of the steps below for you: it authenticates with the
control cookie, finds the circuit(s) carrying the target `.onion` stream
from `stream-status`, prints them (with the matching `circuit-status`
line) for confirmation, and issues `CLOSECIRCUIT` on the correct id(s).
This removes the hand-parsing that makes closing the *wrong* circuit easy
(a documented gotcha — closing a non-onion circuit does nothing visible).

```bash
# Rig A — standalone tor (control port 9051, default cookie path).
scripts/tor-rehearsal-drop.sh --onion <deployment>.onion

# Rig B — Tor Browser (control port 9151, bundled cookie).
scripts/tor-rehearsal-drop.sh \
  --onion <deployment>.onion \
  --port 9151 \
  --cookie ".../Browser/TorBrowser/Data/Tor/control_auth_cookie"
```

It prints the matching stream/circuit and prompts before closing. For a
hands-off drop (e.g. scripted timing) add `--yes`. On `250 OK` start your
stopwatch and witness the A.14 DoD below. Run `--help` for all options.

#### Hands-off `--watch` — fire the instant the circuit forms

For the most deterministic rehearsal, let the helper arm itself and drop
the circuit automatically the moment the call's onion stream attaches.
`--watch` subscribes to the control port's `STREAM`/`CIRC` events
(`SETEVENTS STREAM CIRC`) and issues `CLOSECIRCUIT` the instant the
target onion stream lands on a circuit — no prompt, no second shell, no
hand-parsing. (If the stream is already attached when you start it — the
call is already up — it drops immediately, since that *is* the moment.)

```bash
# Rig A — arm the watcher, then bring the call up (or it fires at once if
# the call is already live). Fires once, then exits.
scripts/tor-rehearsal-drop.sh --watch --onion <deployment>.onion

# Rig B — Tor Browser control port + bundled cookie, 5-minute window.
scripts/tor-rehearsal-drop.sh \
  --watch \
  --onion <deployment>.onion \
  --port 9151 \
  --cookie ".../Browser/TorBrowser/Data/Tor/control_auth_cookie" \
  --timeout 300
```

It waits up to `--timeout` seconds (default 600) for the stream to
attach. A timeout exits cleanly with code 2; **Ctrl-C** exits cleanly
too. Either way the control connection is closed (it sends `QUIT` and
tears down the event subscription) so nothing is left dangling. This is
the scripted equivalent of the manual `SETEVENTS` watch below.

### Manual fallback

If you cannot run the helper (no `nc`/`xxd`, or you want to drive the
control port by hand), do it directly:

```bash
CTRL_PORT=9051   # 9151 for Tor Browser
COOKIE=/tmp/void-rehearsal-tor/control_auth_cookie   # Tor Browser:
                 #   .../Browser/TorBrowser/Data/Tor/control_auth_cookie
HEXCOOKIE=$(xxd -p -c 256 "$COOKIE")

# Helper: send a control command and print the reply.
torctl() { printf 'AUTHENTICATE %s\r\n%s\r\nQUIT\r\n' "$HEXCOOKIE" "$1" \
  | nc 127.0.0.1 "$CTRL_PORT"; }

# 1. List streams; find the one whose target is <deployment>.onion:80
#    (or :443). Note its circuit id (the 4th field of the stream line).
torctl 'GETINFO stream-status'

# 2. (sanity) inspect that circuit.
torctl 'GETINFO circuit-status'

# 3. Drop it. Replace 7 with the circuit id from step 1.
torctl 'CLOSECIRCUIT 7'
```

The instant `CLOSECIRCUIT` returns `250 OK`, start your stopwatch. The
browser's Tor client notices the dead circuit, Socket.IO reconnects over
a fresh circuit, and the client rebuilds the peer connection(s).

For a fully hands-off drop, watch the stream events live and close the
onion circuit the moment it forms:

```bash
{ printf 'AUTHENTICATE %s\r\nSETEVENTS STREAM CIRC\r\n' "$HEXCOOKIE";
  sleep 600; } | nc 127.0.0.1 "$CTRL_PORT"
# Watch for a STREAM ... <onion>.onion:80 line, read its circ id from the
# matching CIRC line, then issue CLOSECIRCUIT <id> from a second shell.
```

The helper's `--watch` mode automates exactly this (subscribe, match the
onion stream, `CLOSECIRCUIT` on attach, then quit) — use it instead of
the two-shell dance unless you cannot run the script.

## Method 2 — latency / jitter (the "degrade then drop" variant)

Apply `netem` to the interface the Tor client uses for its guard
connections. **Do this only on a dedicated rehearsal box, VM, or network
namespace** — shaping a shared host's egress degrades everything on it,
including the operator's own connectivity and any production traffic.

### Fast path — `scripts/tor-rehearsal-netem.sh`

The helper applies / changes / clears the netem qdisc for you and guards
the sharp gotcha above: it **refuses to shape the host's own default-route
interface (or loopback) without `--force`**, so a stray `eth0` can't take
out the operator's connectivity or production traffic. Its default mode is
"apply and hold" — it shapes the interface, then blocks while you run the
drop from another shell, and removes the qdisc on exit (Ctrl-C,
`--duration` timeout, or any signal). The shaping only exists while the
helper runs, so you can't walk away leaving a box throttled.

```bash
# Apply ~800ms ±300ms latency + 2% loss on the rehearsal box's egress and
# hold until Ctrl-C, auto-clearing on exit. (Defaults match the manual
# values below; override with --delay/--jitter/--loss.)
scripts/tor-rehearsal-netem.sh --iface eth0

# In a second shell, force the drop while the circuit is slow:
scripts/tor-rehearsal-drop.sh --onion <deployment>.onion
# then Ctrl-C the netem helper to clear the shaping.

# Hold for a fixed window instead of waiting on Ctrl-C:
scripts/tor-rehearsal-netem.sh --iface eth0 --duration 120

# Or apply detached (left in place), retune, and clear yourself:
scripts/tor-rehearsal-netem.sh --iface eth0 --detach
scripts/tor-rehearsal-netem.sh --iface eth0 --change --delay 1500 --loss 5
scripts/tor-rehearsal-netem.sh --iface eth0 --clear
```

Run `--help` for all options. On a deliberately disposable VM whose only
interface is the default route, add `--force` to override the guard.

### Manual fallback

If you cannot run the helper, drive `tc` directly:

```bash
IF=eth0   # the rehearsal box's egress interface

# Add ~800ms latency with ~300ms jitter (normal distribution) and a
# small loss rate. This makes the circuit visibly slow without killing it.
sudo tc qdisc add dev "$IF" root netem delay 800ms 300ms distribution normal loss 2%

# (optional) tighten/loosen on the fly:
sudo tc qdisc change dev "$IF" root netem delay 1500ms 500ms loss 5%

# Remove when done — always clean up.
sudo tc qdisc del dev "$IF" root
```

Use either path to show the call **survives** a slow circuit (no spurious
tile drop under latency alone), then run Method 1 to force the actual drop.
If you want a netns-isolated shaper instead of touching `eth0`, the
single-host pattern in `docs/` (per-peer network namespaces with a veth
pair, as used by the relay-verify harness) applies `netem` to the veth
without affecting the host — point `--iface` at the veth.

## Witnessing the A.14 DoD

With two peers in a relay-only call (one of them the Tor user), trigger
Method 1 and record:

- **Resume < 30s.** Stopwatch from `CLOSECIRCUIT` `250 OK` to media/audio
  restored. Must be under 30 seconds. (Expect it well inside, given the
  2s/5s/5s client timings above.)
- **Peer tile reappears once and only once.** Watch `PeerTileGrid`: the
  red `secure-channel-failure` overlay should appear once and clear once.
  Flapping (overlay appears, clears, reappears) is a `fail`.
- **`iceTransportPolicy` is `relay` after recovery.** In Rig A open
  `chrome://webrtc-internals` *before* the drop; after recovery a **new**
  `RTCPeerConnection` entry appears — confirm its config reads
  `iceTransportPolicy: "relay"` and that every selected candidate pair is
  `relay`/`relay` (no `host` or `srflx`). In Rig B use `about:webrtc` and
  confirm the new connection gathered relay candidates only.
- **No manual refresh.** You must not reload the tab. If recovery only
  happens after a refresh, the gate fails.

### Result log template

Paste a filled copy into the A.14 gate's record (and the launch
rehearsal log) so the `pass`/`fail` is dated and reproducible:

```
A.14 Tor circuit-degradation rehearsal
Date (UTC):            ____________________
Operator:              ____________________
Deployment / origin:   ____________ (.onion mirror | clearnet+relay-only)
Rig:                   A (standalone tor + Chromium) | B (Tor Browser)
Method:                CLOSECIRCUIT <id>  (+ netem delay ___ jitter ___ : y/n)
Resume time:           ______ s   (budget: < 30s)         pass / fail
Peer tile reappears:   once only? ______                  pass / fail
iceTransportPolicy:    relay after recovery? ______       pass / fail
Manual refresh needed: ______ (must be "no")              pass / fail
webrtc-internals dump saved to: ____________________
Overall:               PASS / FAIL
```

## Gotchas

- **Shaping a shared host.** Method 2 on a non-dedicated machine will
  degrade the operator's own connectivity and any production traffic on
  that box. Use a VM, throwaway host, or netns.
- **`CLOSECIRCUIT` the wrong circuit.** Closing a circuit that is not
  carrying the onion stream does nothing visible. Confirm the target in
  `stream-status` shows `<deployment>.onion:<port>` before closing.
- **Latency alone won't drop the call.** That is correct behaviour and
  part of the evidence (the client rides out a slow circuit). The drop
  has to be forced with Method 1.
- **Media did not "freeze" when I added latency.** Expected — media is
  not routed over Tor (see "What A.14 actually exercises"). Latency only
  slows signaling; the rebuild on a forced drop is what interrupts media.
- **Clearnet-over-Tor rig.** If you loaded the clearnet origin through
  Tor rather than the `.onion` mirror, relay-only is **not** auto-pinned
  — you must toggle it on, and confirm it before the drop, or the
  `iceTransportPolicy` check is meaningless.

## Cross-references

- `LAUNCH-CHECKLIST-2.md` A.14 — the gate this runbook services, and the
  "Before the window" prep note that pointed here.
- `docs/onion-mirror-runbook.md` — provisioning the `.onion` mirror the
  Tor user loads; the source of truth for the signaling-over-Tor /
  media-over-TURN split.
- `docs/onion-fail-open-audit.md` — the relay-only / no-clearnet-egress
  posture A.14 confirms survives a real circuit drop.
- `README-selfhost.md` §6c — the per-host Tor primitive and the
  `.onion`-reachable (not Tor-routed) wording.
