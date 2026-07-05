# Incident Response — Launch-Window Runbook

The post-mortem written before the post-mortem. The four scenarios
below are the failure modes most likely to land in the launch window;
the closing section is the catch-all for anything that doesn't.

The order inside each section is the order an operator actually
moves through one of these: **see it → run the checks → say
something → fix it → name what it surfaces about VOID**. Don't
re-order. The "say something" step is in the middle on purpose
because that is when the operator actually needs the wording — after
they know what's happening but before they know how long the fix
will take.

Cross-references:

- **Operator alerts (ntfy).** If `NTFY_TOPIC` is configured (see
  `README-selfhost.md` → "Operator Alerts (ntfy)"), four of the
  signals below page you on your ntfy topic instead of waiting in a
  log: a new High/Critical CVE in the daily dependency scan (fired
  by the `pnpm audit` workflow), a CSP/Permissions-Policy report
  wave, a Lightning response-shape drift, and sustained payment
  slowness (repeated `503 LIGHTNING_BACKEND_UNAVAILABLE`). The
  alerts are deduped per signal, so a single page does not mean a
  single event — open the api-server log (or the workflow run, for
  the CVE) to see the full picture before acting. Each scenario
  below notes where its alert fires. Alerting is optional; with no
  topic set nothing changes.
- The launch checklist — the launch gate (Task #316). Items 6, 7,
  and 8 are the rehearsal side of scenarios 1, 3, and 2 respectively.
- `artifacts/void-client/src/pages/ThreatModelPage.tsx` — the user-
  facing threat model. The "what this surfaces about VOID" lines at
  the bottom of each scenario below match a paragraph there or a
  line on the won't-fix list (Task #319).
- `docs/marketing-claims-audit.md` — the claim ledger. If an
  incident forces a claim change, the audit gets a row.

The user-facing drafts below are **send-ready with a 60-second
edit** — fill in the timestamp, the room count, the wallet name,
and send. They are written in the same brutalist voice the rest of
the product uses; `pnpm --filter @workspace/void-client run
check:phrases` does not scan this doc, but the same banned-word
list applies. If you find yourself reaching for "powerful",
"seamless", "robust", "best-in-class", "next-generation",
"world-class", or "we're committed to" — stop, and write the
literal sentence instead.

---

## 1. Lightning backend goes down

The paywall cannot mint invoices, or can mint them but cannot
confirm settlement. New hosts see "PAYMENT SERVICE IS SLOW TO
RESPOND" (Task #265). Existing rooms keep working — the backend is
only on the create-room and extend-room paths.

### Symptom

What the operator sees:

- API server log lines from `artifacts/api-server/src/services/lightning.ts`:
  - `[lightning] adapter response shape mismatch backend=…` — the
    upstream returned an unexpected JSON shape (`LightningBackendShapeError`).
  - Repeated thrown `LightningBackendUnavailableError` from
    `lightningFetch` — the upstream did not respond within
    `LIGHTNING_FETCH_TIMEOUT_MS` (8 seconds).
- HTTP 503 with body `{ error: "LIGHTNING_BACKEND_UNAVAILABLE" }`
  on `POST /api/paywall/invoice`.
- User reports of the PaywallModal stuck on "PAYMENT SERVICE IS
  SLOW TO RESPOND" or "GENERATING INVOICE…" timing out.
- `GET /api/paywall/status/:paymentHash` returning 503 for invoices
  that should have settled.

**ntfy alert:** if `NTFY_TOPIC` is set, two of this scenario's signals
page you directly. Sustained 503s (≥5 in 60s across `/paywall/invoice`
and `/paywall/status`) fire an **urgent** "VOID: Lightning backend slow
/ unavailable" page; a response-shape mismatch fires a **high** "VOID:
Lightning response shape drift" page, deduped per backend + the failing
field set. The page is the prompt — run the triage below to confirm.

### Immediate triage (first 5 min)

```sh
# 1. Is our process up at all?
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR-DOMAIN/api/health

# 2. Is the upstream Lightning backend reachable from the api-server host?
#    LNbits:
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" \
  -H "X-Api-Key: $LNBITS_API_KEY" \
  "$LNBITS_URL/api/v1/wallet"
#    BTCPay:
curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" \
  -H "Authorization: token $BTCPAY_API_KEY" \
  "$BTCPAY_URL/api/v1/stores/$BTCPAY_STORE_ID"

# 3. End-to-end: mint an invoice through our own endpoint.
curl -sS -X POST https://YOUR-DOMAIN/api/paywall/invoice \
  -H "Content-Type: application/json" \
  -d '{"tier":"standard"}'
# Expect 200 with { invoice, paymentHash, ... }. 503 means the adapter
# threw LightningBackendUnavailableError or the backend rejected the call.

# 4. Tail the api-server log for the two lightning.ts error shapes.
#    (Substitute your log destination — journalctl, docker logs, etc.)
journalctl -u void-api -n 200 --no-pager | grep -iE 'lightning|LightningBackend'
```

### User-facing communication

**Status banner / pinned post on the launch surface:**

> The Lightning paywall is slow to respond right now. Existing
> rooms are unaffected — calls in progress keep working. New rooms
> cannot be created until this clears. Updating in 30 minutes.

**Nostr note / tweet:**

> VOID's Lightning paywall is slow right now. If you're already in
> a call, it keeps working — payments only run on room creation.
> If you're trying to start a new room, hold tight. We'll post when
> the path is clear.

**Longer post-incident write-up template:**

> At HH:MM UTC on YYYY-MM-DD, VOID's Lightning paywall stopped
> responding within the 8-second timeout we wrap every Lightning
> call in. New room creation returned 503 for N minutes. Existing
> rooms were not affected — the Lightning backend is only on the
> create-room and extend-room paths; signaling, media, and BURN
> all work without it.
>
> The cause was [BACKEND]. We fixed it by [FIX]. No invoices were
> double-spent and no payments were lost — the per-invoice replay
> guard (one paid invoice = one room) does not depend on the
> backend being up.
>
> If you paid for a room during this window and never got one,
> redeem your recovery code at /recover within the original paid
> window (60 minutes for standard, 24 hours for day). If your
> window has passed, reply to this post and we'll work it out.

### Mitigation actions

- Confirm `LIGHTNING_BACKEND` env var on the api-server is what you
  expect (`mock`, `lnbits`, `btcpay`). A misconfigured deploy that
  flipped to `mock` is a different incident — see the catch-all
  section.
- If the upstream is genuinely down: there is no automatic
  failover. Either wait for the upstream to recover, or stand up a
  second backend and flip `LIGHTNING_BACKEND` + the matching
  `*_URL` / `*_API_KEY` env vars and restart the api-server.
- If the upstream is up but slow (Tor first-hop, congested
  channel): there is no runtime control for this. The 8s
  `LIGHTNING_FETCH_TIMEOUT_MS` is a hard-coded `const` in
  `artifacts/api-server/src/services/lightning.ts` (the comment
  at the top of that file flags an env-var override as a future
  request, not a shipped feature). Raising it requires a code
  change and redeploy. Document the redeploy in the post-incident
  write-up; do not promise a runtime knob in the comms.
- Do **not** disable the paywall to "let people in for free."
  That breaks the one-payment-one-room model in
  `socketHandlers.ts` (`consumedRoomCreationTokens`) and the host-
  reclaim path in `rooms.ts` (`hostReclaimTokenHashes`). The paywall is
  load-bearing.

### What this surfaces about VOID

The Lightning backend is the only third-party dependency on the
hot path for new rooms. When it goes down, new rooms stop and
existing rooms keep working — that is the design, and it is the
honest thing to say. The host's own Lightning node sees the
incoming sat amount and timing in its own logs (Task #319 won't-
fix: "LIGHTNING ROUTE OBSERVABILITY FOR THE HOST"); a Lightning
incident does not change that property.

---

## 2. Signaling server crashes / unreachable mid-session

The api-server SIGTERMs, OOMs, the deploy restarts it, or its
network drops. This is the load-bearing test of the claim that
**ongoing calls continue when the server goes away** — see
`shutdown.ts` (the `server-shutdown` broadcast in the drain
window) and `App.tsx` (the dismissible "SIGNALING SERVER OFFLINE
— YOUR CALL CONTINUES P2P." banner).

### Symptom

What the operator sees:

- The api-server process is gone, or `GET /api/health` from
  outside the host returns connection refused / 502 / timeout.
- Browser console reports from users: socket.io disconnect, no
  reconnect.
- Users in active calls report the offline banner appearing AND
  their existing call continuing — that is the success case, but
  only while the existing peer connection stays healthy. Anything
  that requires a fresh signaling round-trip will fail until the
  server is back: ICE restarts (network handoff, NAT rebinding —
  see `webrtc.ts`, which sends the renegotiated offer over
  `relay-signal`), starting a NEW screen share (the
  `request-screen-share` / `screen-share-started` round trip in
  `RoomPage.tsx` lines ~1865/2013), and any host-knock approval.
  The user-visible failure surface for a failed ICE restart is
  `ice_restart_failed` ("WE LOST THE CONNECTION AND COULDN'T
  RECOVER IT" in `RoomPage.tsx` line 209).
- Users trying to JOIN a room during the outage cannot connect at
  all — that is expected; signaling is required for new
  connections.
- Users mid-handshake (after click-join, before ICE complete) get
  stuck on the connecting screen.

### Immediate triage (first 5 min)

```sh
# 1. Is the process running on the host?
systemctl status void-api    # or: docker ps | grep void-api
ps -ef | grep -E 'node.*api-server' | grep -v grep

# 2. Is the port bound?
ss -tlnp | grep ":${PORT:-3000}\b"

# 3. From OUTSIDE the host (different machine, not localhost):
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR-DOMAIN/api/health

# 4. If it crashed, capture WHY before restarting.
journalctl -u void-api -n 500 --no-pager | tail -200
# Look for: SIGSEGV, OOM-killer entries (dmesg | grep -i oom),
# unhandled rejections, the two `assertTurnSecretNotPlaceholder` /
# `assertPaywallSecretNotPlaceholder` FATAL lines from index.ts.

# 5. Confirm the shutdown broadcast went out before restart.
# (If the process was SIGKILL'd it didn't.)
journalctl -u void-api -n 200 --no-pager | grep -i 'shutdown'

# 6. Restart.
systemctl restart void-api    # or: docker compose restart api

# 7. Once back up, ask any user who reported a stuck call during
#    the outage which message they saw:
#    - "SIGNALING SERVER OFFLINE — YOUR CALL CONTINUES P2P." +
#      audio/video still flowing  →  success path, media held.
#    - "WE LOST THE CONNECTION AND COULDN'T RECOVER IT."
#      (RoomPage.tsx line 209, ice_restart_failed)  →  the call's
#      ICE state needed to renegotiate during the outage and the
#      relay-signal round-trip had nowhere to land. Media stopped.
#    The split between those two outcomes is the real impact of
#    the outage; do not collapse them into a single "calls kept
#    working" line in the public write-up.
```

### User-facing communication

**Status banner / pinned post on the launch surface:**

> The signaling server is down. If you are already in a call,
> existing audio and video usually keep flowing — media is
> peer-to-peer and does not route through us. If your network
> changes during the outage and you see "WE LOST THE CONNECTION
> AND COULDN'T RECOVER IT," that is the recovery path failing
> because it needs the signaling server. New rooms, new joins,
> and starting a new screen share are unavailable until this
> clears. Updating in 30 minutes.

**Nostr note / tweet:**

> Signaling is down. Existing calls usually keep flowing — media
> is peer-to-peer and doesn't route through our server. The
> exception is if your network changes mid-call and the recovery
> path needs to renegotiate; that uses the signaling server and
> will fail until it's back ("WE LOST THE CONNECTION AND
> COULDN'T RECOVER IT"). New rooms, new joins, and starting a
> new screen share are unavailable. We'll post when it's back.

**Longer post-incident write-up template:**

> At HH:MM UTC on YYYY-MM-DD, the VOID signaling server became
> unreachable for N minutes. The cause was [CAUSE].
>
> Calls in progress at the time of the outage continued working,
> as designed: WebRTC media flows browser-to-browser, and the
> signaling server is only required for room creation, joining,
> and the BURN broadcast. The "SIGNALING SERVER OFFLINE — YOUR
> CALL CONTINUES P2P." banner appeared in the affected clients
> for the duration.
>
> What did NOT work during the outage: new room creation, new
> joins, host-knock approvals, starting a new screen share
> (`request-screen-share` is a server round-trip), ICE restarts
> after a network change (the renegotiated offer rides
> `relay-signal` — affected peers see "WE LOST THE CONNECTION
> AND COULDN'T RECOVER IT"), and the host-driven BURN broadcast
> (each peer's local mute/camera-off still works; what was
> unavailable was the server-side room-destroyed signal). What
> kept working: existing peer-to-peer audio and video on calls
> whose ICE state did not need to renegotiate, local mute /
> camera-off / hang-up, and stopping an already-running screen
> share locally.
>
> Room-creation invoices were not lost on the wire. The
> server-side state that backs payments and recovery is all
> in-memory and does not survive a process restart: the
> per-invoice replay guard (`consumedRoomCreationTokens` in
> `socketHandlers.ts`), the invoice state map (`invoiceStates`
> in `routes/paywall.ts`), and the recovery-code map
> (`recoveryCodes` in `routes/paywall.ts`) are all wiped at
> restart regardless of `PAYWALL_SECRET`. What `PAYWALL_SECRET`
> pinned in the environment buys you is JWT survivability — a
> paywall JWT minted before the restart can still be verified
> after the restart, so a held-open browser tab can still create
> a room with the JWT it already has. With `PAYWALL_SECRET`
> unset (the ephemeral default), the secret regenerates and
> every outstanding JWT becomes invalid. Recovery codes and
> outstanding invoice/recovery state do **not** survive the
> bounce in either case; if you paid during the outage and the
> recovery code is rejected, contact the operator with your
> Lightning invoice for manual reissue. Pin `PAYWALL_SECRET` in
> any deploy where you expect to restart with hosts in flight.

### Mitigation actions

- If the server crashed on a startup invariant
  (`PlaceholderTurnSecretError`, `PlaceholderPaywallSecretError`
  in `index.ts`), fix the env var before restarting; the process
  will refuse to come up otherwise. That is the intended
  fail-closed behavior, not a bug.
- If `PAYWALL_SECRET` is unset, the api-server falls back to a
  strong ephemeral secret — every restart invalidates every
  outstanding paywall JWT. For a launch-window deploy, pin
  `PAYWALL_SECRET` in the environment so a restart doesn't
  invalidate every host's session. (Documented in `index.ts`
  comment block, lines 36–55.)
- If you must restart under load, prefer SIGTERM over SIGKILL.
  SIGTERM gives `performShutdown` (in `shutdown.ts`) the
  configured `SHUTDOWN_DRAIN_MS` window (default 5s) to broadcast
  `server-shutdown` so connected clients flip into the offline
  banner state cleanly. SIGKILL skips the broadcast and the
  client only learns about the disconnect from socket.io's
  silent disconnect.
- Do not lower the cap (`MAX_TOTAL_ROOMS_DEFAULT` in `rooms.ts`)
  to "shed load" without understanding what shed: hosts get
  `ROOM_CAP_REACHED` on create and their paid invoice slot is
  preserved (the cap check runs before token consumption). That
  is correct; don't paper over it with comms that imply we lost
  payments.

### What this surfaces about VOID

This is the load-bearing claim: **the server is in the way of
making a call, not in the way of holding one.** Signaling is
required to set up a peer connection; once peers are connected,
the server's only remaining role is to broadcast room-level
events (knock approvals, BURN, host changes). Media never
touches the server (`ThreatModelPage` "WHAT THE SERVER SEES").
An outage exposes both halves of that property — that new joins
break, AND that existing calls continue. The honest version is
that this is the load-bearing thing about the architecture, and
the worst time for the server to die is the most-load-bearing
moment to demonstrate it.

---

## 3. Room spam / abuse

A burst of room creations, a flood of join attempts against a
known room ID, or a single bad actor spamming a knock-mode room
with knock requests. Slow-burn rather than launch-day-explosion —
the system has caps, but the user-facing comms problem is real.

### Symptom

What the operator sees:

- Rate-limited log lines from `socketHandlers.ts`:
  `[rooms] capacity cap fired: ROOM_CAP_REACHED` or
  `[rooms] capacity cap fired: AGENT_QUOTA_REACHED` (one line per
  cap per minute — `CAP_LOG_INTERVAL_MS`).
- The cap rejection counters (`getCapRejectionCounters()`)
  climbing without a corresponding climb in legitimate room
  count.
- Hosts reporting "TOO MANY REQUESTS" on create (the
  `RATE_LIMITED` error mapped to copy in `App.tsx` `emitHostCreate`).
- Joiners reporting unable-to-join on a specific room they have a
  legitimate phrase for, with the host reporting their knock
  prompt being spammed.
- Outbound TURN bandwidth or socket.io connection counts
  spiking.

### Immediate triage (first 5 min)

```sh
# 1. Liveness only — /api/health returns { status: "ok" } and nothing
#    else. Live room count is NOT exposed on any HTTP endpoint and the
#    cap-rejection counters (`getCapRejectionCounters()` in rooms.ts)
#    are in-process only. Use the log signal in step 2 as the actual
#    "are the caps firing right now" indicator.
curl -sS -o /dev/null -w "%{http_code}\n" https://YOUR-DOMAIN/api/health

# 2. Cap-rejection log lines — one warn per cap type per minute
#    (CAP_LOG_INTERVAL_MS in socketHandlers.ts). Volume here is the
#    "is the cap firing" signal.
journalctl -u void-api --since '15 min ago' | grep -E 'capacity cap fired'

# 3. Per-IP socket count (the guard is in socketHandlers.ts, MAX_CONNECTIONS_PER_IP=50).
ss -tn state established '( sport = :443 )' | awk '{print $5}' | \
  sed 's/:[0-9]*$//' | sort | uniq -c | sort -rn | head -20

# 4. socket.io connection rate is NOT separately logged in
#    socketHandlers.ts (the only log line in that file is the
#    cap-rejection warn from step 2). Use the per-IP socket
#    distribution from step 3 as the connection-rate proxy, or
#    inspect your reverse-proxy / load-balancer access log.

# 5. If it's a single host with a spammed knock-mode room, the host
#    can flip OUT of knock mode (LOCK ROOM in the UI) — that closes
#    the door entirely until they re-open it.
```

### User-facing communication

**Status banner / pinned post on the launch surface:**

> Some rooms are seeing a burst of join attempts. The rate
> limits and caps are doing their job. If you got
> "TOO MANY REQUESTS" creating or joining a room, or
> "ROOM CAP REACHED" trying to create one, that is the system
> holding the door — wait 60 seconds and retry. The vast
> majority of legitimate traffic is going through; if your
> retry still fails, post in the support channel with the
> error code.

**Nostr note / tweet:**

> Seeing a burst of automated traffic against the signaling
> server. The rate limits and the per-IP caps are holding.
> If your create or join was rejected with "TOO MANY REQUESTS,"
> retry in a minute. We'll update if anything actually breaks.

**Longer post-incident write-up template:**

> Between HH:MM and HH:MM UTC on YYYY-MM-DD, VOID's signaling
> server saw an elevated rate of [room-creation attempts /
> join attempts against room ID X / knock spam in room Y].
>
> The system held: per-socket rate limits in
> `socketHandlers.ts` (10 create-room/min, 10 join-room/min, 200
> relay-signal/10s), per-IP join limits (50/min), per-IP socket
> limits (50 concurrent), and the global room cap (10,000) all
> fired as designed. The cap-rejection log throttle (one warn per
> cap type per minute) kept the operator log readable; the
> numeric counters carried the actual count.
>
> [If a specific host was the target:] The host of room [phrase
> hash prefix] flipped out of knock mode and the spam stopped.
> No legitimate join was prevented; no room state was lost; no
> media was affected.

### Mitigation actions

- The caps are tunable via the `__setRoomCapsForTest` /
  `__resetRoomCapsForTest` test hooks in `rooms.ts`, but the
  production caps (`MAX_TOTAL_ROOMS_DEFAULT = 10_000`,
  `AGENT_ROOM_FRACTION = 0.2`) are set in code and need a redeploy
  to change. Before lowering them, confirm the legitimate room
  count: lowering the global cap shuts the door for new payers
  (they get `ROOM_CAP_REACHED` and their paid invoice slot is
  preserved, but they cannot create until capacity frees).
- A knock-spammed host can flip to LOCK ROOM (no further
  knocks are accepted) and continue with whoever is already
  inside. They don't need an operator-side action.
- If a single IP is the source, the per-IP socket cap
  (`MAX_CONNECTIONS_PER_IP = 50` in `socketHandlers.ts`) is
  already in front of you. Beyond that, drop it at the upstream
  proxy / firewall — the api-server should not be the perimeter
  for an actual DDoS.
- If `ENABLE_AGENT_ROOMS=1` and the agent quota is the one
  filling, the human slice is unaffected by design — humans get
  through, agent-mode creates get `AGENT_QUOTA_REACHED`. Do
  not disable agent rooms reflexively; the quota is the
  defense.

### What this surfaces about VOID

The system holds. The comms problem is the moment a legitimate
host gets `RATE_LIMITED` or `ROOM_CAP_REACHED` and reads it as
"VOID is broken" instead of "VOID's caps are doing their job."
The honest version: caps exist because the only customer worth
keeping the door open for is a paying human, and a botnet with
many invoices would still otherwise be unbounded
(`socketHandlers.ts` comment, lines 80–94). The cap is the
defense, and the defense being visible is what defense looks
like.

---

## 4. A bad-faith actor records and posts a session

Someone joins a real room — legitimately, with a phrase — and
posts a recording of the audio/video/screen-share. This will
happen on launch day, because someone will test the "ephemeral"
claim adversarially.

### Symptom

What the operator sees:

- A public post (Nostr / tweet / forum / news) showing recorded
  VOID call content — usually a participant's screen, sometimes
  their face, sometimes a transcript.
- DMs and replies asking "I thought VOID was ephemeral?"
- No log evidence on the server side. There is none to find. The
  recording was made client-side by a participant; nothing about
  it touched the server.
- The phrase the room was derived from is not in the post (the
  attacker is the recorder, not the leaker of the phrase) — and
  even if it were, the room is gone.

### Immediate triage (first 5 min)

There is no triage at the system level for this. The system
worked as designed; the design does not prevent this. The
"first 5 minutes" is comms.

```sh
# 1. Confirm there is no server-side recording surface. Verify by
#    search, not by memory. The api-server should have ZERO matches
#    here; this is the load-bearing claim.
rg -n 'MediaRecorder|getDisplayMedia|saveAs|toBlob.*video' \
  artifacts/api-server/src/

# 1b. Client-side hits exist and are expected: getDisplayMedia is
#     used by the screen-share path in RoomPage.tsx (the user
#     opted in), and MediaRecorder is used by the local audio test
#     in PreviewGate.tsx (the recorded blob never leaves the page).
#     Neither persists or transmits captured media. If new matches
#     appear elsewhere in artifacts/void-client/, that is the
#     bigger problem.
rg -n 'MediaRecorder|getDisplayMedia' artifacts/void-client/src/

# 2. Confirm BiometricPage "WHAT THIS DOES NOT DO" still names the
#    correct surfaces. If it doesn't, that is the bigger problem.
rg -n 'WHAT THIS DOES NOT DO' artifacts/void-client/src/pages/BiometricPage.tsx

# 3. Confirm the ThreatModelPage won't-fix list still names this.
rg -n 'SCREEN RECORDING BY PARTICIPANTS' \
  artifacts/void-client/src/pages/ThreatModelPage.tsx
# That section is pinned by __tests__/threatModelWontFix.test.tsx.

# 4. There is nothing to restart. There is nothing to flip.
```

### User-facing communication

**Status banner / pinned post on the launch surface:**

> A recording of a VOID call was posted. The system worked
> exactly as designed. VOID does not — and cannot — prevent a
> participant in a call from recording it. We say this on the
> threat model page and on the biometric page. We are saying it
> again here.

**Nostr note / tweet:**

> A recording of a VOID call is circulating. The recording was
> made by a participant on their own device. VOID cannot stop
> that — no software can. End-to-end encryption protects you
> from the network. It does not protect you from the people you
> let into the room. This is on our threat model page and on the
> won't-fix list, and it has been since v0.5: voidchat.com/threat-model

**Longer post-incident write-up template:**

> A recording of a VOID call was posted publicly at HH:MM UTC on
> YYYY-MM-DD. The recording was made by a participant in the
> call, on their own device, using [OS screen recorder / a
> second device pointed at the screen / a screen-capture tool].
>
> No part of the recording came from VOID's server. There is no
> recording surface in the VOID codebase: media is end-to-end
> encrypted, it never touches our server, and we keep no
> transcripts and no logs of what was said. What we cannot
> control is what a participant chooses to do with the audio and
> video on their own machine after they have joined the call.
>
> This is on the published threat model. Specifically:
> "SCREEN RECORDING BY PARTICIPANTS" on the won't-fix list:
> 'A participant in your call can press their OS screen
> recorder, point a second device at the screen, or run any
> number of local capture tools. There is no DRM model that
> solves this for browser-based video, and we will not pretend
> otherwise — the people who claim to solve it are shipping
> security theater.'
>
> If your threat model requires that no one in your call ever
> records it, VOID is not the right tool for you. Pick the
> people you let in carefully. That is the only defense.

### Mitigation actions

There are no system-level mitigations. Do not promise any. The
only mitigations are editorial and they are already shipped:

- The biometric masking modes (`BiometricPage`) reduce what a
  recording captures of the user — CONTOUR and ASCII strip the
  most biometric utility, CLEAR transmits the face unmodified.
- The threat-model page, the biometric page's "WHAT THIS DOES
  NOT DO" section, and the won't-fix list all name this. Do not
  edit them under pressure to soften the language. The brutalist
  voice is the load-bearing thing here.

### What this surfaces about VOID

We have no way to **prevent** a participant from recording.
What we have is no recording infrastructure of our own and no
ability to compel a recording on someone else's behalf. That is
the won't-fix item titled "SCREEN RECORDING BY PARTICIPANTS"
and the line on the comparison page footnote that says VOID
"does not provide the infrastructure for it." The incident
proves the line; it doesn't refute it.

---

## Scenario not covered above

For anything not in the four scenarios above:

- **Default public response:** "We're investigating. Will update
  in 30 minutes."
- **Default action:** pull the maintainer URLs / dashboards
  listed in this doc and in `docs/threat-model.md`, and walk
  them: api-server health, Lightning backend health, signaling
  log tail, per-IP socket counts, cap-rejection counters, and
  the four browser console reports from real users.
- **Default mistake to avoid:** don't speculate publicly about
  cause. Acknowledge the symptom, not the diagnosis. "The
  paywall is slow" is a symptom; "our LNbits instance is
  hitting an upstream rate limit" is a diagnosis. Ship the
  symptom in 60 seconds; ship the diagnosis when it is true.
