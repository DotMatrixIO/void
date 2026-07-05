# VOID — Hostile White-Box Vulnerability Report

**Task:** #457
**Date:** 2026-05-22
**Scope:** Read-only static pen-test across four phases — (1) crypto/RNG,
(2) signaling relay & DoS, (3) paywall/auth, (4) WebRTC state & media leaks.
**Method:** White-box source review against `main` HEAD. No live exploitation.
**Reviewer stance:** Hostile. Findings are graded on the assumption an attacker
holds source, can stand up arbitrary peers, can sit on the wire, and may
collude with one room participant — but does **not** control the API server
binary or its secrets.

---

## Executive summary

| Severity | Count |
| --- | --- |
| Critical | 0 |
| High     | 0 |
| Medium   | 1 |
| Low      | 2 |
| Info     | 3 |

**Top 3 risks (ranked):**

1. **M-01 — AES-GCM ciphertexts on `relay-signal` carry no AAD binding.**
   Peer identity is enforced server-side only. If the server is compromised
   or the deployment ever swaps in a relay that does not validate
   `senderUser.peerId === fromPeerId`, a same-room attacker can reflect or
   re-address a captured ciphertext under a different `fromPeerId`. Within
   the current server, the attack reduces to "replay within a single pair
   under a known session key," which signaling-layer idempotency largely
   absorbs.
2. **L-01 — `/paywall/recover` global brute-force counter only warns, never
   blocks.** Per-IP cap (10/min) makes single-source attack uneconomical, but
   a botnet exhausting the 2048⁴ codespace at global scale produces a log
   line and nothing more.
3. **L-03 — Client lacks its own inbound payload size cap on `relay-signal`.**
   Server enforces 64 KiB; client trusts the server. Defense-in-depth gap.

**Verdict: SHIP with note.** No finding rises to "block release." M-01 should
be patched in the next maintenance window (~1 hour of work — add a typed AAD
parameter through `encryptSignal`/`decryptSignal` and bind `fromPeerId`).
Everything else is defense-in-depth or documentation-grade.

---

## Phase 1 — Cryptographic primitives & RNG

### Files audited

- `artifacts/void-client/src/lib/signalCrypto.ts` (full)
- `artifacts/void-client/src/lib/hostTokenStorage.ts` (encrypt/decrypt
  surface, lines 145-219)
- `artifacts/void-client/src/lib/voidPhrase.ts` (HKDF derivation lines
  2130-2179; phrase RNG)
- `artifacts/void-client/src/lib/relayFlipHandshake.ts` (flipId RNG)
- `artifacts/api-server/src/routes/paywall.ts` (recovery code RNG, lines
  105-115; jitter RNG line 263)
- `artifacts/api-server/src/lib/bip39.ts` (wordlist source)

### What was checked

| Check | Result |
| --- | --- |
| `Math.random` in any security path | None reachable — see I-03 |
| `crypto.getRandomValues` / `crypto.randomInt` exclusivity | ✅ enforced |
| AES-GCM IV freshness (no reuse, no counter) | ✅ 12 fresh bytes per encrypt |
| AES-GCM AAD binding of peer identity | ❌ — see **M-01** |
| HKDF salt/info pinning | ✅ pinned constants (`HKDF_INVITE_SALT`/`INFO`) |
| 6-word phrase entropy ≥ 66 bits | ✅ `Uint32Array(6) % 2048` from CSPRNG |
| Recovery code unbiased sampling | ✅ `crypto.randomInt(0, len)` (paywall.ts:112) |

### Evidence — clean items

`generateVoidPhrase()` (voidPhrase.ts:2171-2178):
```ts
const arr = new Uint32Array(6);
crypto.getRandomValues(arr);
for (let i = 0; i < 6; i++) {
  words.push(BIP39_WORDLIST[arr[i] % BIP39_WORDLIST.length]);
}
```
The `% 2048` modulo is unbiased over a `Uint32` since 2³² is divisible
by 2048. Also covered by `voidPhrase.entropy.test.ts`.

The recovery code
generator (paywall.ts:105-115) uses CSPRNG with no fallback. The
relay jitter (paywall.ts:263) uses `crypto.randomInt`.

`encryptSignal()` (signalCrypto.ts:15-30):
```ts
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  key,
  data,
);
```
Fresh IV per call, no counter, no cache. The 12-byte random IV at
2⁹⁶ space gives a collision probability << 2⁻³² after the entire room
lifetime's signaling volume — within the NIST SP 800-38D bound.

The host-token storage path (hostTokenStorage.ts:157-167) follows the
same pattern with the IV prepended to the ciphertext, decoded back in
loadHostToken (lines 202-209). No nonce reuse vectors.

### Finding M-01 — Missing AAD binding on AES-GCM signaling envelopes

**File:** `artifacts/void-client/src/lib/signalCrypto.ts:15-50`
**Severity:** Medium
**Status:** Open

Both `encryptSignal` (lines 18-22) and `decryptSignal` (lines 40-44)
construct `{ name: "AES-GCM", iv }` with **no `additionalData` field**.
The sender's `peerId` is not bound into the AEAD authenticator. The
ciphertext is authenticated against tampering of the payload bytes, but
the *envelope* metadata (`fromPeerId`, `toPeerId`, room code) is purely
server-controlled.

**Reflection / re-addressing sketch (white-box):**

1. Attacker `A` is a legitimate participant in room `R` with session key
   `K_AB` to peer `B`.
2. `A` captures an envelope `B → A` ciphertext `C` (intended for `A`).
3. If `A` controls or has compromised the relay, `A` re-emits the same
   `C` to the server with `fromPeerId = B`, `toPeerId = C` (some third
   peer). The relay forwards it to `C`.
4. `C` looks up the session key for `B`, decrypts successfully (because
   the AAD does not bind `toPeerId`), and treats the result as
   originating from `B`.

**Why this is Medium and not High:**

- `artifacts/api-server/src/services/signalingRelay.ts:56-58` validates
  `senderUser.peerId === fromPeerId` server-side, blocking the re-emit
  step above for any attacker who does **not** control the server.
- Per-pair session keys (`peerSessionKeys`, derived in
  webrtc.ts:520-528 via ECDHE) mean an attacker without `K_BC` cannot
  forge an envelope readable by `C` claiming to be from `B`. The attack
  reduces to "replay a known ciphertext to the original recipient under
  the original session key."
- Within a pair, WebRTC signaling messages are largely idempotent:
  `offer`/`answer` overwrite, ICE candidates dedupe, `key-exchange`
  triggers a fresh ECDHE (and any forged replay would mismatch the
  freshly minted ephemeral keys).
- The DROP slot is **not** on this surface — it rides DTLS-SCTP between
  browsers (webrtc.ts:646-695), not `relay-signal`.

**What still bites:** an attacker who compromises the API server (or a
custom self-hosted deployment removing the sender-binding check) can
mount reflection. The current architecture relies on **server honesty**
for peer identity — exactly what end-to-end crypto is supposed to make
unnecessary.

**Recommendation:** Add `additionalData = utf8(fromPeerId)` (or the
canonicalized envelope) to both encrypt and decrypt sites. Version the
crypto envelope with a magic byte so old peers can be transitioned.
Estimate: ~1 hour including tests.

### Finding I-03 — `Math.random` fallback in `generateFlipId` (dead code)

**File:** `artifacts/void-client/src/lib/relayFlipHandshake.ts:204-215`
**Severity:** Info (unreachable on any supported runtime)
**Status:** Open

```ts
if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
  crypto.getRandomValues(buf);
} else {
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
}
```

The `else` branch is dead code on any runtime that can run AES-GCM
elsewhere in the file (every supported browser, modern Node). However:

- A linter sweep or `no-restricted-globals: ["Math.random"]` would catch
  this consistently with the marketing-voice gates already in place.
- `flipId` is a correlation id only — collisions are not exploitable
  because the per-peer pending set is keyed by `(fromPeerId, flipId)` and
  the server-side sender binding still applies. Comment at line 205-207
  acknowledges this explicitly.

**Recommendation:** Delete the fallback branch and throw if CSPRNG is
absent — the rest of the app is already unusable in that environment.

---

## Phase 2 — Signaling relay & DoS

### Files audited

- `artifacts/api-server/src/services/signalingRelay.ts` (full)
- `artifacts/api-server/src/services/socketRateLimits.ts` (full)
- `artifacts/api-server/src/services/roomService.ts` (lines 240-460,
  knock isolation + join validation)
- `artifacts/api-server/src/socketHandlers.ts` (full)
- `artifacts/void-client/src/lib/webrtc.ts` (handleRelay path lines
  750-870; DROP receive lines 653-674)

### What was checked

| Check | Result |
| --- | --- |
| Payload size cap on `relay-signal` | ✅ 64 KiB (signalingRelay.ts:38-54) |
| Rate limit on `relay-signal` | ✅ 200 events / 10s per socket |
| Sender peerId binding (server-side) | ✅ `senderUser.peerId === fromPeerId` |
| Recipient existence check | ✅ `getRoomUsers(code).find(...)` |
| Per-IP join-rate cap | ✅ (`checkIpJoinRate`, roomService.ts:255) |
| JSON parse before AES auth (panic vector) | ✅ parse happens **after** AEAD success |
| Knock peer relay-signal isolation | ✅ see Phase 4 |
| DROP receive bounds | ✅ 4 KiB cap + string-only (webrtc.ts:661-664) |
| Client-side bound on inbound rawPayload | ⚠️ relies on server cap — see **L-03** |

### Evidence — clean items

`signalingRelay.ts:38-54`:
```ts
const payloadSize = typeof payload === "string" ? payload.length : ...;
if (payloadSize > RELAY_SIGNAL_MAX_PAYLOAD_BYTES) {
  // 64 KiB cap; drop without forwarding
  return;
}
```
Combined with `socketRateLimits.ts:19` (200 events / 10s) the per-socket
worst case is 12.8 MB/10s into the relay. The relay performs no
allocation beyond a forward, so memory pressure is bounded by Socket.io's
own per-socket buffer (which Replit's deployment sizing already
accommodates).

`socketHandlers.ts` is a thin dispatch to `roomService` / `signalingRelay`
with no validation gaps inside the dispatcher itself.

DROP channel (webrtc.ts:657-666): rejects non-string payloads outright,
clamps to 4096 chars before invoking `onDropReceived`. A malicious peer
running a modified client cannot push more than the documented budget.

### Finding L-03 — Client lacks its own inbound payload size cap

**File:** `artifacts/void-client/src/lib/webrtc.ts:750-810`
**Severity:** Low (defense-in-depth)
**Status:** Open

`handleRelay` accepts `rawPayload: unknown`, narrows to `string`, and
hands the entire string to `decryptSignal` (which base64-decodes and
AES-GCM-decrypts). The 64 KiB cap that bounds memory pressure here is
**server-enforced**, not client-enforced. If a future deployment runs an
alternate signaling server that skips the cap, the client will allocate
proportional to whatever the peer sent.

JSON.parse occurs **after** AEAD authentication (signalCrypto.ts:45-50),
so an unauthenticated attacker cannot deliver crafted JSON; this is
purely a memory-pressure consideration.

**Recommendation:** Mirror the 64 KiB cap client-side as a typed
constant shared between `signalingRelay.ts` and `webrtc.ts` (e.g., move
to `lib/wire-core`).

### Items with no finding

- **Recipient validation:** `signalingRelay.ts` rejects `relay-signal`
  to a peerId not currently in the room. Re-addressing to a
  not-in-room peerId is dropped silently.
- **Room-code validation:** `ROOM_CODE_RE` enforced on every code-taking
  handler (e.g., roomService.ts:274, 381, 396, 436, 454).
- **Knocking peer isolation:** Phase 4 covers in detail.

---

## Phase 3 — Paywall / auth

### Files audited

- `artifacts/api-server/src/routes/paywall.ts` (full, 580 lines)
- `artifacts/api-server/src/services/accessController.ts` (full)
- `artifacts/api-server/src/lib/paywallSecret.ts` (full)
- `artifacts/api-server/src/lib/clientIp.ts` (resolution policy)

### What was checked

| Check | Result |
| --- | --- |
| JWT `algorithms` pinned to `HS256` (no `alg: none`/RS256 confusion) | ✅ all 3 verify sites |
| Paywall secret rejects known placeholders at startup | ✅ paywallSecret.ts |
| Per-IP rate limit on `/paywall/recover` | ✅ 10/min |
| Global rate limit on `/paywall/recover` | ⚠️ warn-only — see **L-01** |
| Replay guard on creation JWTs (one payment = one room) | ✅ `consumedRoomCreationTokens` |
| Replay guard on extension JWTs | ✅ `consumedExtensionTokens` |
| `paymentHash` claim required on creation | ✅ accessController.ts:200 |
| Tier downgrade for legacy `"week"` tokens | ✅ capped at `day` |
| Recovery code entropy | 2048⁴ ≈ 1.76 × 10¹³ (44 bits) |
| Recovery code comparison | ⚠️ plain `Map.get(code)` — see note below |
| Host-claim token verified through same pinned path | ✅ accessController.ts:295 |

### Evidence — clean items

`accessController.ts:170, 244, 295` all pin algorithms:
```ts
const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as { ... };
```
There is no code path in the server that calls `jwt.verify` outside this
file. The comment at lines 10-14 documents this discipline explicitly,
and the test `socket-handlers.test.ts:788-812` ("paywall JWT is verified
with algorithms pinned to HS256 (#178)") asserts an HS384 token is
rejected — so any future regression breaks a workflow.

Replay defense for room creation (accessController.ts:194-204):
```ts
sweepConsumedRoomCreationTokens(now);
if (!paymentHash) return { ok: false, error: "PAYMENT_REQUIRED" };
if (consumedRoomCreationTokens.has(paymentHash)) {
  return { ok: false, error: "TOKEN_ALREADY_USED" };
}
```
This is the "one payment = one room" enforcement. Combined with the
per-socket create-room rate limit (10/min), the worst case for a
replayed JWT is one room before the key is consumed.

`paywallSecret.ts` blocks the known development/test placeholders at
process start — covered by tests.

### Finding L-01 — `/paywall/recover` global brute-force is observed but not blocked

**File:** `artifacts/api-server/src/routes/paywall.ts` (~lines 165, 490-500)
**Severity:** Low
**Status:** Open

The recovery endpoint enforces 10 requests/minute per IP, and a separate
global counter that **logs a WARN at 100/min** but does not refuse to
serve. Math:

- Codespace: `2048⁴` ≈ `1.76 × 10¹³` (44 bits).
- One IP (10/min): ~3.3 million years to exhaust 50% of keyspace.
- Botnet of 10,000 IPs: ~166 years to 50%, ~33 years to 1% (~88 billion
  guesses). Still uneconomical at any plausible per-recovery yield —
  one successful guess returns a single tier credit (max 24h of
  service).

**Attack still relevant if:**

- An attacker discovers any side channel that meaningfully shrinks the
  keyspace (e.g., a non-CSPRNG path — none exists today, paywall.ts:112
  uses `crypto.randomInt`).
- The room cap or tier price ever inverts the economics (e.g., a paid
  tier becomes much more valuable per recovery code).

**Recommendation:** Promote the global WARN to a soft block (e.g.,
short-circuit recovery for 30 seconds when global > 1000/min) so the
deployment isn't relying purely on operator vigilance. Cheap; doesn't
hurt legitimate users (they tail far below the threshold).

### Items with no finding

- **`alg: none` / algorithm confusion:** blocked by `algorithms: ["HS256"]`
  at all three verify sites. Confirmed by `paywall-routes` and
  `socket-handlers` test suites.
- **JWT signing key separation:** there is one paywall secret. Mints
  and verifies all three token roles. Acceptable: all three roles trust
  the paywall.
- **Timing attacks on `/paywall/recover`:** the comparison itself is a
  plain `recoveryCodes.get(code)` Map lookup (paywall.ts:508) — **not** a
  constant-time HMAC compare. V8's hash-table lookup is not specified as
  constant-time, but the response is jittered via
  `crypto.randomInt(JITTER_MIN_MS, JITTER_MAX_MS + 1)` (paywall.ts:263)
  before any branch, and the 10/min per-IP cap caps observable samples.
  Not a finding given the jitter + cap, but worth recording: if the
  jitter is ever removed, the Map lookup alone is not a safe substitute.
- **Single-shot redemption:** `recoveryCodes.delete(code)` runs **before**
  the JWT is signed (paywall.ts:536), so a duplicate request races to a
  404 rather than minting a second valid token.
- **`getClientIp` spoofing:** documented to follow the configured
  `trust proxy` setting; XFF leftmost spoofing is not in scope when the
  reverse proxy enforces the trust boundary (Replit deployment does).

---

## Phase 4 — WebRTC state & media leaks

### Files audited

- `artifacts/void-client/src/pages/RoomPage.tsx` (BURN path lines
  1700-1820; session-expired path 1841-1892; share-stop sites; mount
  effects)
- `artifacts/void-client/src/lib/burnTeardown.ts` (full)
- `artifacts/void-client/src/lib/webrtc.ts` (handleRelay 750-870,
  ECDHE 500-602, ICE-restart paths, DROP attach)
- `artifacts/api-server/src/services/roomService.ts` (knock flow
  290-459; join validation 244-369)

### What was checked

| Check | Result |
| --- | --- |
| `track.stop()` for every track on BURN | ✅ getTracks().forEach |
| `localStreamRef.current = null` after stop | ✅ line 1772 |
| `webrtcRef.current = null` before `destroy()` | ✅ line 1744 (re-entry safe) |
| `e2eKeyRef.current = null` on BURN | ✅ line 1800 |
| `setLocalStream(null)` (React state cleared) | ✅ line 1808 |
| sessionStorage / localStorage / caches cleared | ✅ lines 1788-1798 |
| BURN idempotency (rapid double-click safe) | ✅ `sessionEndedRef` guard 1709 |
| BURN partial-failure resilience | ✅ `safe(label, fn)` wraps every step |
| SESSION EXPIRED path mirrors BURN cleanups | ⚠️ partial — see **I-01** |
| Knock peer cannot receive `relay-signal` | ✅ see analysis below |
| Knock peer cannot receive `peer-joined` for full peers | ✅ broadcast to `code`, not `code:knocking` |
| ICE candidates restricted to chosen transport policy | ✅ `buildPC` pipes `iceTransportPolicy` |
| Per-peer ephemeral private keys deleted on connect | ✅ webrtc.ts:587 |

### Evidence — BURN teardown discipline (clean)

`performLocalBurn()` at RoomPage.tsx:1703-1820 is exemplary:

```ts
// Idempotency guard
if (sessionEndedRef.current) return;
sessionEndedRef.current = true;

// Every step wrapped in safe() — one throw cannot abort the rest
safe("peer connections", () => {
  const w = webrtcRef.current;
  webrtcRef.current = null;     // null BEFORE invoking
  w?.destroy();
});

// Every local track stopped individually
const tracks = localStreamRef.current?.getTracks() ?? [];
for (const t of tracks) {
  safe(`local ${t.kind} track`, () => t.stop());
}
localStreamRef.current = null;

// Plus: drainObjectUrlRegistry, clearVoidSessionStorage,
// clearVoidLocalStorage, clearVoidCaches, e2eKeyRef.current = null,
// setLocalStream(null), setRemoteStreams({}), setPeerSAS({}).
```

If any step fails the user is shown a "Some media could not be released
cleanly (…). Close this tab to be safe." message (line 1814-1817) —
explicit failure surfacing instead of silent.

### Evidence — knock-mode isolation (clean)

A knocking peer joins **only** `code + ":knocking"` (roomService.ts:290):
```ts
ctx.socket.join(code + ":knocking");
```
They are **not** in the main `code` room. Consequences:

- `signalingRelay.ts:54-58` looks up sender via `getRoomUsers(code)` and
  rejects if not found — knockers cannot send `relay-signal` into the
  room.
- `peer-joined` is broadcast to `code` not `code:knocking`
  (roomService.ts:346), so knockers never learn the peerIds of the
  existing participants.
- The only event a knocker can receive is `knock-approved`/`knock-denied`
  addressed to their own socket (lines 423, 442), or `room-destroyed`
  for the knocking room (line 553).
- On approval, the server explicitly transitions them
  (`knockSocket.leave(":knocking")` + `knockSocket.join(code)`,
  lines 402-403) **before** broadcasting `peer-joined` for them.

There is no path by which an un-approved knocker receives ICE, SDP,
key-exchange, or media tracks.

### Finding I-01 — SESSION EXPIRED partial-failure resilience is weaker than BURN

**File:** `artifacts/void-client/src/pages/RoomPage.tsx:1841-1892`
**Severity:** Info
**Status:** Already tracked as a backlog follow-up

The `handleSessionExpired` path does the same release set as
`performLocalBurn`, but **without** the `safe(label, fn)` wrapper. A
single throw in `webrtcRef.current?.destroy()` would skip
`localStreamRef.current?.getTracks().forEach((t) => t.stop())` at line
1877, leaving the OS-level recording indicator on.

This is already on the follow-up queue ("Apply the same partial-failure
resilience to SESSION EXPIRED") so I'm logging it here as **Info** for
audit completeness rather than re-filing.

### Evidence — `handleRelay` decrypt failure handling (clean)

webrtc.ts:789-793 — on any decrypt failure, the channel is hard-failed:
```ts
if (!decrypted) {
  this.recordDecryptFail(fromPeerId);
  this.failSecureChannel(fromPeerId, "decrypt_failed");
  return;
}
```
No silent fall-back to phrase key for non-`key-exchange` messages
(lines 769-787 document the narrow phrase-key fallback restricted to
the `key-exchange` type and that path alone). The "fail loud, never
silently downgrade" pattern is enforced.

### Finding I-02 — Knocker peerId is disclosed to the host before approval

**File:** `artifacts/api-server/src/services/roomService.ts:289-296`
**Severity:** Info
**Status:** Behavior by design

```ts
ctx.io.to(u.socketId).emit("knock-request", { peerId, code });
```
This is a deliberate UX disclosure (host UI needs to render *something*
to approve), not a vulnerability — but worth recording because the
knocker's peerId is otherwise the only stable handle they have, and a
host who declines still observed it.

Not actionable. Listed for completeness so future tasks don't accidentally
shrink this surface without realizing it was already known.

---

## Cross-cutting observations (informational, no findings)

- **Server-side authority is load-bearing.** Sender peerId binding,
  payload caps, knock isolation, and tier enforcement all live on the
  API server. A self-hosted deployment that swaps in a custom server
  must replicate every check. M-01 is the most visible instance.
- **Test coverage tracks the security boundaries closely.** The
  paywall, JWT-algorithm, and replay-guard behaviors are all covered by
  the existing vitest suites (`paywall-routes`, `paywall-socket-integration`,
  `socket-handlers`). The BURN path is covered indirectly via
  `burnTeardown.ts` extraction. Crypto invariants are covered by
  `voidPhrase.entropy.test.ts` and `crypto-tests`.
- **Marketing-voice gates already extend to crypto invariants** (e.g.,
  the `check:signaling-envelope` workflow). Adopting a similar lint for
  `no-restricted-globals: [Math.random]` would mechanically prevent
  L-02-class regressions.

---

## Recommendations summary (priority order)

| # | Finding | Effort | Action |
| --- | --- | --- | --- |
| 1 | M-01 | ~1h | Bind `fromPeerId` into AES-GCM AAD in `encryptSignal`/`decryptSignal`; version the envelope. |
| 2 | L-01 | ~30m | Promote `/paywall/recover` global WARN to a soft block at ~1000/min. |
| 3 | L-03 | ~15m | Mirror the 64 KiB inbound cap client-side as a shared constant. |
| 4 | I-03 | ~10m | Delete `Math.random` fallback in `generateFlipId`; throw if CSPRNG missing. |
| 5 | I-01 | (already tracked) | Wrap SESSION EXPIRED in `safe(label, fn)` mirroring BURN. |

None of the above blocks ship.
