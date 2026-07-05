# Tor circuit-degradation reconnection notes (Task #748)

**Date:** 2026-06-04
**Scope:** The behavioral (not posture) Tor risk — does VOID's
signaling/reconnection path actually survive a slow/jittery circuit, or
does a dropped socket on a high-latency link silently kill the call?

Tor *posture* (fail-closed egress, relay-only pinning, live `.onion`
advertising) is already covered (merged #385, #390, #423, #664, #666).
This note characterizes the **reconnection** path and justifies the
pinned reconnect budget that the new resilience tests assert against.

## 1. Baseline — current reconnection behavior

### Socket.io client configuration (`artifacts/void-client/src/lib/socket.ts`)

| Setting | Value | Notes |
|---|---|---|
| `reconnection` | `true` | auto-reconnect enabled |
| `reconnectionAttempts` | `Infinity` | the client never gives up — it keeps retrying for the life of the page |
| `reconnectionDelay` | `1000` ms | base backoff before the first reconnect attempt |
| `reconnectionDelayMax` | `5000` ms | backoff grows geometrically and is capped here |
| `transports` | `["websocket", "polling"]` | websocket preferred, polling fallback |
| ping/heartbeat | *socket.io defaults* | not overridden on the client; the Engine.IO server drives `pingInterval` (~25 s) / `pingTimeout` (~20 s). A dead circuit is detected by a missed pong within that window, after which the client begins the reconnection backoff above. |

**Key consequence:** because `reconnectionAttempts` is `Infinity`, there
is no client-side "give up and fail" path today — on a slow circuit the
client keeps retrying. The risk is therefore *not* "the client stops
trying too early"; it is "a reconnect that does fire must re-emit
`join-room` and rebuild peer state **correctly and within a sane
window**, without (a) duplicating peer tiles or (b) losing the
relay-only pin that protects a Tor user's clearnet IP."

### What a drop-and-rejoin currently does (`useRoomConnection.ts`, `reconnectHandler`)

On the socket.io manager's `"reconnect"` event the handler:

1. Tears down the existing `WebRTCManager` (`destroy()` closes every
   `RTCPeerConnection`) and nulls `webrtcRef` **before** anything new is
   built.
2. Clears all peer-derived state up front: `setPeers([])`,
   `setRemoteStreams({})`, `setPeerConnectionStates({})`,
   `setPeerMediaState({})`, plus the crypto/SAS/mismatch maps.
3. Re-emits `join-room` with the **stable** `peerId` (preserved across
   reconnects) and the cached host token.
4. On the ack, repopulates `setPeers(result.peers)` and constructs a
   **fresh** `WebRTCManager` via `createManager`, which reads
   `signaling.iceTransportPolicyRef.current` for its `iceTransportPolicy`.

Because step 1 clears peers and destroys the old manager before step 4
sets the new peers and builds the new manager, the peer list passes
through `[]` between the old and new membership — it is never the union
of the two, so a peer present both before and after the drop cannot
appear twice. The fresh manager inherits `iceTransportPolicyRef.current`,
which on an onion origin (or in a relay-only room) is `"relay"` and is
never reset by the reconnect path — so relay-only survives the reconnect.

### Observed behavior under simulation

Simulated with the deterministic transport mock
(`src/lib/test-utils/mockTransport.ts`), which models socket.io's
exponential backoff (1 s → 5 s cap) plus a configurable per-event
signaling latency and a configurable number of failed reconnect
attempts (jitter/packet-drop stand-in):

- **~2 s-latency link, single clean reconnect:** drop → `reconnect`
  fires after one backoff cycle → `join-room` round-trip → rejoin
  completes well inside the clearnet budget.
- **Jittery onion link (high latency + several failed attempts before
  one succeeds):** drop → multiple backoff cycles → `reconnect` →
  high-latency `join-room` round-trip → rejoin completes inside the
  onion budget. The peer list never duplicates an ID, the old PC is
  closed before the new one is built, and every post-reconnect
  `RTCPeerConnection` (including ones built for a late-joining peer)
  keeps `iceTransportPolicy: "relay"`.

## 2. The pinned reconnect budget — and why these numbers

Defined as the single source of truth in
`artifacts/void-client/src/lib/reconnectBudget.ts`, origin-aware via the
same `isOnionOrigin()` utility that drives `initialIceTransportPolicy()`:

| Origin | Budget | Derivation |
|---|---|---|
| Clearnet | **8 s** (`CLEARNET_RECONNECT_BUDGET_MS`) | backoff caps at 5 s + a sub-second signaling round-trip; 8 s leaves margin while still failing loudly if clearnet reconnection regresses to multi-second sluggishness. A clearnet user must not be made to wait the full Tor budget for a reconnect that should take ~2 s. |
| `.onion` | **30 s** (`ONION_RECONNECT_BUDGET_MS`) | Tor circuit re-establishment is empirically ~5–15 s; each signaling round-trip on top is multi-second and jittery. 30 s covers worst-case circuit rebuild (~15 s) plus a couple of high-latency join round-trips with margin, so a genuinely slow circuit does not trigger a false-positive failure. This is the task's recommended default. |

Why **not** a single flat 30 s: a flat budget would hide a clearnet
regression behind the generous Tor number. Splitting the budget by
origin keeps each path honest and is exactly the asymmetry the task
asked for.

### Tuning decision

The existing socket.io configuration (`reconnectionAttempts: Infinity`,
`reconnectionDelay: 1000`, `reconnectionDelayMax: 5000`) already
tolerates Tor round-trips — it never abandons the reconnect and its
capped 5 s backoff fits comfortably inside both budgets. **No change to
the socket.io reconnection/heartbeat values was required.** The budget
is therefore a verification SLA (asserted in the resilience tests),
not a new client-side timeout that could itself become a premature
fail-closed path on a slow circuit.

## 3. Cross-references

- Budget source of truth: `artifacts/void-client/src/lib/reconnectBudget.ts`
- Resilience tests: `artifacts/void-client/src/hooks/useRoomConnection.reconnect.test.tsx`
- Transport mock: `artifacts/void-client/src/lib/test-utils/mockTransport.ts`
- Reconnection handler: `artifacts/void-client/src/hooks/useRoomConnection.ts` (`reconnectHandler`)
- Onion detection / relay pin: `artifacts/void-client/src/lib/origin.ts`
- Socket.io config: `artifacts/void-client/src/lib/socket.ts`
- Manual real-circuit rehearsal gate: Task #746 (out of scope here)
