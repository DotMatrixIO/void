# TURN-over-Tor: Research & Usability Spike

**Type:** Research-only spike with a build / opt-in / don't-build recommendation.
**Question:** Should VOID route the WebRTC **media** path over Tor? Today only the
signaling/control plane rides Tor (via the `.onion` mirror); media flows
peer-to-peer or via a clearnet TURN relay. The temptation is a feature that is
*technically true* ("we route media over Tor") but *unusable in practice*.

**Recommendation (one line): Don't build it.** Keep the current posture
(relay-pin so peer IPs aren't gathered + signaling over Tor + media over clearnet
TURN). Do not ship an in-product media-over-Tor toggle, expert or otherwise. The
measured latency and the structural TCP head-of-line-blocking problem make a
real-time call over Tor unusable for everyone except a proof-of-concept demo, and
an underperforming toggle would invite a "media over Tor" positioning claim that
the experience cannot honour.

The rest of this document is the work behind that line: the architecture that was
evaluated, the usability thresholds fixed **before** the spike ran, the measured
results, and the reasoning.

---

## 1. The architecture that was evaluated

### 1.1 Why direct UDP media over Tor is not possible

WebRTC media (DTLS-SRTP over RTP) is carried over **UDP** by default, because
real-time media is loss-tolerant: a dropped audio/video packet is better skipped
than retransmitted late. Tor does not carry UDP. Tor is a TCP-only overlay — its
cells, its SOCKS proxy, and its onion-service rendezvous are all TCP. There is no
conformant path by which a browser's UDP RTP flow traverses a Tor circuit
unchanged. So "media over Tor" cannot mean "the existing UDP media path, but
through Tor." It necessarily means **tunnelling the media over a TCP transport
that itself rides Tor**, which is the next option.

### 1.2 The only viable path: TURN-over-TCP/TLS as an onion service, relay-forced ICE

The single architecture that can put VOID media bytes inside Tor is:

1. **Run a TURN server reachable over TCP/TLS** (coturn `listening-port` on a
   TCP/TLS listener, not the UDP listener).
2. **Expose that TURN listener as a Tor onion service** (a `HiddenServicePort`
   pointing at the TURN TCP port), so the client reaches it as
   `turns:<base32>.onion:443?transport=tcp` through Tor's SOCKS proxy.
3. **Force relay-only ICE** so the browser never gathers or offers `host`/`srflx`
   candidates and the *only* candidate pair that can form is `relay`/`relay`
   through that onion TURN. VOID already does this on `.onion` origins
   (`artifacts/void-client/src/lib/origin.ts` `initialIceTransportPolicy()` pins
   `iceTransportPolicy: "relay"`), and the relay-status probe already confirms a
   `relay`/`relay` pair at runtime (`artifacts/void-client/src/lib/webrtcRelayProbe.ts`).

With this in place, the media path for two Tor peers is:

```
peerA browser ── Tor circuit (3 hops) ──┐
                                        ├─ rendezvous ─ onion TURN (relay) ─ rendezvous ─┐
peerB browser ── Tor circuit (3 hops) ──┘                                                ├─ ...
```

Each peer's media leg traverses a full Tor circuit to the onion service's
rendezvous point. The onion-service path is **6 hops** (3 client-side + 3
service-side) — roughly double the hop count of an ordinary 3-hop exit circuit —
so it is structurally the *slowest* Tor configuration, not the fastest. That fact
matters for reading the measurements below: the spike measured a **3-hop exit
circuit** as a generous **lower bound**; the real onion-TURN design is worse.

### 1.3 What this would and would not change about the threat model

- **Would change:** the media bytes' network path would be inside Tor, so a
  network observer at either peer's access network would see Tor traffic, not RTP
  to a clearnet TURN IP. This is the only privacy gain on offer.
- **Would not change:** the end-to-end encryption (DTLS-SRTP keys exchanged inside
  phrase/ECDHE-encrypted relay payloads) is identical with or without Tor — Tor is
  a network-layer wrapper, not a content-layer one (`docs/onion-mirror-runbook.md`
  "Does not improve E2EE").
- **Already covered without it:** relay-pinning on `.onion` already prevents the
  user's clearnet IP from being *gathered as an ICE candidate* and offered to
  peers. The residual exposure media-over-Tor would close is the clearnet TURN
  operator (and an on-path observer between the user and that TURN) seeing the
  user's IP connect to TURN — which is exactly the surface the
  `docs/onion-mirror-runbook.md` "TURN" note and `docs/threat-model.md` §1
  document as intrinsic to relay-based media today.

---

## 2. Usability thresholds — FIXED BEFORE THE SPIKE RAN

These tiers are derived from **ITU-T G.114** (one-way mouth-to-ear latency
guidance for interactive conversation), not fitted to the spike result. They are
written down here, ahead of §3, so the recommendation maps measured numbers to a
pre-defined tier rather than the tier drifting to fit the numbers. The governing
metric is **added one-way latency** (the latency Tor adds *on top of* the normal
WebRTC/TURN media path), with jitter, bandwidth ceiling, and degradation-under-loss
as gating side-conditions.

| Tier | Added one-way latency | Jitter / loss behaviour | Verdict |
|---|---|---|---|
| **Usable for at-risk conversation** | ≤ 150 ms | jitter < 30 ms, no sustained loss; survives congestion without stalls | A frightened, non-technical guest can hold a natural back-and-forth. |
| **Usable for technical conversation** | 150–400 ms | jitter < 80 ms; brief degradation tolerated | Two technical peers who *expect* lag and adapt their cadence (walkie-talkie style). |
| **Proof-of-concept only** | 400–800 ms | any visible jitter or loss-driven stall | Demonstrates the bytes go over Tor; not a real conversation. |
| **Not usable** | > 800 ms, **or** any tier above when loss/congestion causes media to stall ("slideshow") | TCP head-of-line blocking stalls all media on one lost segment | Do not ship as media. |

Two hard side-conditions, set before the spike, that **demote any result by at
least one tier regardless of latency**:

- **C1 — TCP head-of-line blocking is present by construction.** Tor is all-TCP.
  Real-time media is designed for UDP precisely so that a lost packet is skipped,
  not retransmitted. Over a TCP tunnel, one lost/reordered segment stalls *every*
  subsequent media packet behind it until the retransmit lands. If a realistic
  circuit exhibits loss-driven stalls, the result is **Not usable** even if the
  median latency looked acceptable.
- **C2 — the recommendation reflects the realistic case, not best-case.** If
  best-case (fresh circuit, nearby relays) lands in a usable tier but the realistic
  spread (multiple circuits, varying load) does not, the verdict follows the
  realistic spread. Most users get the realistic case.

---

## 3. Spike: method and measured results

### 3.1 What was stood up (throwaway, isolated)

A throwaway harness — **not wired into the shipping client or API server, and torn
down after measurement** — was run in the project container:

- `tor` (0.4.8.16) installed as a system dependency, configured with a local SOCKS
  port (9050), a control port (9051) for circuit rotation, and a local onion
  service pointing at a static HTTP server.
- `coturn`'s `turnserver` is present in the environment (the same binary the CI
  relay-verify harness uses, `coturn/turnserver.ci.conf`), confirming the
  TURN-over-TCP half of the architecture is buildable here.

**Honest limitation of the sandbox.** Hosting *and* connecting to a local onion
service from inside the same restricted container did not complete — the onion
descriptor never became reachable over SOCKS (`cannot complete SOCKS5
connection`), while **clearnet-over-Tor worked fine**. The spike therefore
measured the transport characteristic that matters — *bytes through a live Tor
circuit and back* — over a **3-hop exit circuit to a fast clearnet endpoint**
(`speed.cloudflare.com`), rotating circuits via the control port's `NEWNYM`
signal. This is a **conservative proxy**: the real onion-TURN design is a 6-hop
rendezvous path (§1.2), strictly slower than what was measured. If a 3-hop path is
already too slow, the 6-hop production path is worse, not better — so the spike's
optimism cuts against Tor, which is the safe direction for a "don't build" call.

The reproducibility appendix (§7) records the exact commands so a future engineer
can re-run, or extend this to a real onion-TURN allocation on a less restricted
host.

### 3.2 Measured: round-trip latency (the headline number)

Round-trip time for a minimal request, 8 direct samples vs. 24 Tor samples spread
across 4 freshly-rotated circuits:

| Path | min | median | mean | p95 | max |
|---|---|---|---|---|---|
| **Direct** (no Tor, container → clearnet) | 90 ms | 119 ms | 130 ms | 229 ms | 229 ms |
| **Tor** (3-hop exit, 4 circuits) | 755 ms | **927 ms** | 1027 ms | 1613 ms | 1677 ms |

Per-circuit means showed the circuit-to-circuit spread that condition **C2** is
about:

| Circuit | mean RTT | range |
|---|---|---|
| 1 | 887 ms | 787–993 ms |
| 2 | 872 ms | 755–974 ms |
| 3 | 974 ms | 801–1170 ms |
| 4 (the unlucky draw) | **1374 ms** | 1065–1677 ms |

**Added latency.** Subtracting the direct baseline and halving for one-way:

- **Best-case circuit:** added one-way ≈ **(755 − 119)/2 ≈ 320 ms**.
- **Median circuit:** added one-way ≈ **(927 − 119)/2 ≈ 404 ms**.
- **Realistic-bad circuit (circuit 4 / p95):** added one-way ≈ **(1613 − 119)/2 ≈ 750 ms**, peaking near **780 ms**.

These are *added* latencies on a 3-hop path. They sit **on top of** the normal
WebRTC jitter buffer (typically 40–200 ms), codec/packetisation delay, and the
base media RTT — and the real onion-TURN path is 6 hops, ~double the Tor
contribution measured here.

### 3.3 Measured: bandwidth ceiling

3 MB download, direct vs. Tor:

| Path | time | throughput |
|---|---|---|
| **Direct** | 0.30 s | ~10.0 MB/s (~80 Mbit/s) |
| **Tor** (two runs) | 3.9 s / 2.8 s | ~0.77–1.07 MB/s (**~6–8.5 Mbit/s**) |

A single circuit's ceiling (~6–8.5 Mbit/s on a *good* draw) is, in isolation,
enough for one compressed video stream. But it is bursty, it is shared with the
rest of the circuit, it collapses under congestion, and it does not multiply for a
multi-party room. Bandwidth is **not** the binding constraint here — latency and
HoL blocking are — but the ceiling rules out the "Tor is basically fine for one
stream" hand-wave for anything past a 1:1 audio call.

### 3.4 Observed: jitter and degradation behaviour (qualitative + measured)

- **Jitter within a circuit** was modest (mean consecutive-sample delta ~40 ms),
  but **jitter *between* circuits was large** — a single `NEWNYM` swung the mean
  from ~870 ms to ~1370 ms. A real call rebuilds circuits on reconnect
  (`docs/tor-circuit-degradation-runbook.md`), so a user is exposed to this
  circuit-draw variance mid-call, not just at join.
- **TCP head-of-line blocking (condition C1) is structural, not incidental.**
  Every byte rides Tor's TCP cells. The "media did not freeze under latency"
  observation in `docs/tor-circuit-degradation-runbook.md` is about *signaling*
  today; routing *media* over the same TCP transport removes UDP's
  skip-the-late-packet property entirely. Under any real loss or congestion the
  call degrades to the "slideshow" failure mode the task warns about — audio
  drops out in chunks, video stalls and catches up in bursts. This is the
  well-understood reason the WebRTC ecosystem treats TURN-over-TCP as a
  last-resort fallback for *connectivity*, never as a *quality* path.

---

## 4. Mapping results to the pre-defined tiers

| Metric | Measured (realistic) | Tier it lands in |
|---|---|---|
| Added one-way latency, median circuit | ~404 ms | **Proof-of-concept only** (already at the 400 ms boundary) |
| Added one-way latency, bad circuit (p95) | ~750 ms | **Proof-of-concept only**, bordering **Not usable** |
| 6-hop onion-TURN correction (×~2 Tor contribution) | well past 800 ms | **Not usable** |
| TCP head-of-line blocking (C1) | present by construction | **demotes to Not usable** under any loss |

Even the **best-case** 3-hop circuit (~320 ms added one-way) only reaches the top
of "Proof-of-concept" / bottom of "technical conversation," and that is before the
6-hop correction, before the base media path, and before C1. The **realistic**
case — which is what the recommendation must reflect per C2 — is squarely **Not
usable** for the at-risk-conversation audience VOID exists for, and is a stretch
even for two technical peers willing to talk in walkie-talkie cadence.

The picture the task warned against — "technically true but unusable
(multi-second latency, dropouts, slideshow under congestion)" — is exactly what
the measurements describe.

---

## 5. Recommendation: don't build it

**Build it? No. Build it behind an expert toggle? No. Don't build — keep the
current posture.**

### 5.1 Why not "build it"

A default-on or generally-available media-over-Tor path would degrade VOID's core
promise — a real conversation — for the very users it is meant to protect. A
frightened, non-technical guest on a realistic circuit gets a sub-second-latency,
loss-stalling call. That is worse for them than the honest status quo, and it
weakens rather than strengthens the positioning.

### 5.2 Why not even "expert/opt-in toggle"

The default presumption for a toggle is that **an underperforming toggle is worse
than no feature** — it carries maintenance, documentation, support, and
threat-model-explanation burden with no value for the median user. A toggle is
only justified by a *specific, identifiable* use case (e.g. a named partner
organisation that needs it for a defined workflow and accepts the tradeoff). **No
such use case exists today.** Against that, a "media over Tor (experimental)"
toggle carries two concrete costs:

1. **It invites a positioning claim the experience can't honour.** The moment the
   toggle ships, "VOID can route media over Tor" becomes sayable — the precise
   technically-true-but-unusable claim the task scopes out of marketing
   (`docs/marketing-claims-audit.md` discipline). A toggle that produces a
   slideshow is a claim liability, not a feature.
2. **It adds a permanent support and threat-model surface** (a new failure mode in
   `PeerTileGrid`, new runbook entries, new "why is my call so slow" triage) for a
   path we would have to caveat into uselessness anyway.

If a named partner with a concrete workflow and an explicit acceptance of
sub-second latency + slideshow-under-loss emerges, this decision should be
**re-opened as a normal scoped task** (security review, integration tests, the
usual gates) — not resurrected from this spike's throwaway harness.

### 5.3 The honest fallback posture (the recommended status quo)

The current design is already the right answer, and it should be stated plainly
rather than apologised for:

- **Relay-pin so the IP isn't gathered.** On `.onion` origins VOID forces
  `iceTransportPolicy: "relay"`, so the browser never offers the user's clearnet
  IP as an ICE candidate to peers (`origin.ts`, `webrtcRelayProbe.ts`).
- **Signaling over Tor.** The `.onion` mirror puts the entire signaling/control
  plane inside Tor (`docs/onion-mirror-runbook.md`); the server never sees a
  visitor IP on that surface.
- **Media over clearnet TURN — and say so.** The media bytes relay via a clearnet
  TURN server. The honest threat-model framing (already in
  `docs/threat-model.md` §1 and `docs/onion-mirror-runbook.md` "TURN"): VOID
  protects content end-to-end and prevents peer-to-peer IP exposure via
  relay-pinning, but the *media path is not anonymised at the network layer* — the
  TURN operator and an on-path observer between the user and TURN can see the
  user's IP talking to TURN.
- **The user's lever for media-path network anonymity is OS-level Tor**, with the
  understood quality cost — i.e. route the whole device through Tor and accept the
  degraded call, a choice the user makes knowingly. VOID should **document** this
  option, not bake an in-product toggle that makes the degraded path look
  first-class.

This keeps the product honest: we don't claim media-over-Tor, we don't ship a
toggle that can't deliver it, and we point the rare user who truly needs
network-layer media anonymity at the OS-level tool that provides it (with the same
latency cost this spike measured, which is intrinsic to Tor and not something a
VOID feature could fix).

---

## 6. Teardown

The spike was throwaway by construction. After measurement:

- The `tor` and local HTTP-server processes were killed; the temporary
  `/tmp/tor-spike` working directory (torrc, onion key, data blobs, raw samples)
  was not committed and is removed.
- **No experimental config was added to the shipping client or API server.** No
  changes were made to `artifacts/void-client` or `artifacts/api-server`, no new
  workflow was registered, and no `iceServers`/TURN/Tor wiring was altered. The
  `coturn` binary and `tor` system dependency are environment-level only.
- Even if the recommendation had been "build," this harness would **not** be the
  basis for the production implementation — that would go through normal task
  scoping with security review and integration testing. The spike's deliverable is
  the measurement and the recommendation in this document, not code.

---

## 7. Reproducibility appendix (commands, not committed scaffolding)

Run on a host with `tor` and `curl` available. This is documentation, not a wired
script.

```bash
# 1. Minimal controllable tor: SOCKS 9050, control 9051 (no auth, local only),
#    plus an onion service in front of a local HTTP server (for the 6-hop variant
#    on a less restricted host than the project sandbox).
cat > /tmp/torrc <<'EOF'
SocksPort 9050
ControlPort 9051
CookieAuthentication 0
DataDirectory /tmp/tordata
HiddenServiceDir /tmp/hs
HiddenServicePort 80 127.0.0.1:8765
Log notice file /tmp/tor.log
EOF
python3 -m http.server 8765 --bind 127.0.0.1 &   # serve a /ping.txt + a blob
tor -f /tmp/torrc &                              # wait for "Bootstrapped 100%"

# 2. RTT across rotated circuits (NEWNYM via control port). Repeat per circuit.
newnym(){ exec 3<>/dev/tcp/127.0.0.1/9051; \
  printf 'AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n' >&3; cat <&3 >/dev/null; }
URL="https://speed.cloudflare.com/__down?bytes=1"      # or http://<onion>/ping.txt
newnym; sleep 6
for i in $(seq 1 6); do
  curl -s --max-time 30 --socks5-hostname 127.0.0.1:9050 \
    -o /dev/null -w '%{time_starttransfer}\n' "$URL"
done

# 3. Throughput, direct vs Tor.
BIG="https://speed.cloudflare.com/__down?bytes=3000000"
curl -s -o /dev/null -w 'DIRECT %{speed_download}Bps %{time_total}s\n' "$BIG"
curl -s --socks5-hostname 127.0.0.1:9050 \
  -o /dev/null -w 'TOR %{speed_download}Bps %{time_total}s\n' "$BIG"
```

Direct vs. Tor deltas, not absolute numbers, are the signal — the absolute Tor
latency depends on the circuit draw, and the production onion-TURN path adds the
second 3-hop leg this appendix's clearnet variant omits.

---

## 8. Cross-references

- `docs/onion-mirror-runbook.md` — the `.onion` mirror that puts **signaling** over
  Tor; its "TURN" note is the source of truth for the signaling-over-Tor /
  media-over-clearnet-TURN split this spike confirms should stay.
- `docs/tor-circuit-degradation-runbook.md` — "What A.14 actually exercises":
  media does not go over Tor today, and why a circuit drop is felt as a signaling
  reconnect, not a media freeze.
- `docs/threat-model.md` §1 — server-observable metadata and the explicit
  statement that VOID is end-to-end encrypted but not an anonymising system; the
  honest framing this recommendation preserves.
- `artifacts/void-client/src/lib/origin.ts`, `.../webrtcRelayProbe.ts` — the
  existing relay-pin-on-`.onion` behaviour that already removes the IP-gathering
  exposure, and which this recommendation keeps as the status quo.
