# VOID Security Audit — Code Extracts

Companion to `docs/security-audit-public-2026-04.md`. Carries verbatim source for the two findings ranked **High** in the parent report (H-01, H-05) plus verbatim code for two demoted findings (M-01, M-02) so a reviewer can cross-check the severity reasoning. Each block is a paste from the file at audit time. Comments marked **AUDIT** are *added by this document* to highlight the audit-relevant point — they are not in the source.

---

## H-01 — `getSocketIp` reads leftmost X-Forwarded-For

**File:** `artifacts/api-server/src/socketHandlers.ts` (verbatim, lines 148–165 plus connection middleware at lines ~78–90)

```typescript
function getSocketIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    const first = forwarded.split(",")[0]?.trim();
    return first || socket.handshake.address || "unknown";
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const first = forwarded[0]?.split(",")[0]?.trim();
    return first || socket.handshake.address || "unknown";
  }
  return socket.handshake.address || "unknown";
}
```

**AUDIT.** `forwarded.split(",")[0]` is the *leftmost* X-Forwarded-For token. With Express `app.set("trust proxy", 1)` upstream, the trusted reverse proxy *appends* the real client IP to the right of the header. The leftmost value is whatever the client put there. A single attacker can rotate arbitrary leftmost tokens to bypass the per-IP connection cap and the per-IP join-failure throttle. The HTTP path uses `req.ip` correctly (`routes/ice-servers.ts`):

```typescript
function getClientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
```

**Fix.** Mirror the HTTP path: with `trust proxy = N`, walk the X-Forwarded-For chain from the right by `N` entries (or attach `req.ip` to the socket via the Express adapter and read it back inside the Socket.io connection middleware).

---

## H-05 — Room-creation JWT is not single-use; one paid invoice → many rooms

**File:** `artifacts/api-server/src/routes/paywall.ts` — JWT mint (verbatim, lines 339–342):

```typescript
    const token = jwt.sign(
      { authorized: true, tier },
      secret,
      { expiresIn: spec.jwtExpiresIn },
    );
```

**AUDIT.** The payload contains only `{ authorized, tier }` (and the standard `iat`/`exp` from `jsonwebtoken`). It does **not** include the `paymentHash` of the settled invoice or any room identifier.

**File:** `artifacts/api-server/src/socketHandlers.ts` — `create-room` handler (verbatim, lines 211–232, the JWT-verify and room-create steps):

```typescript
        let tier: Tier = "standard";
        let jwtExpMs: number | null = null;
        try {
          const decoded = jwt.verify(data.token, secret) as { authorized?: boolean; tier?: unknown; exp?: number };
          if (!decoded.authorized) {
            callback({ error: "PAYMENT_REQUIRED" });
            return;
          }
          if (isTier(decoded.tier)) {
            tier = decoded.tier;
          } else if (decoded.tier === "week") {
            // Legacy "week" JWT issued before Task #115 capped paid rooms at 24h.
            // Cap at the new ceiling instead of silently downgrading to standard (65m).
            tier = "day";
          }
          if (typeof decoded.exp === "number" && Number.isFinite(decoded.exp)) {
            jwtExpMs = decoded.exp * 1000;
          }
        } catch {
          callback({ error: "PAYMENT_REQUIRED" });
          return;
        }

        if (roomExists(data.roomId)) {
          callback({ error: "ROOM_EXISTS" });
          return;
        }
```

**AUDIT.** No `consumedTokens.add(...)` after `jwt.verify` succeeds. The only mutual-exclusion check is `roomExists(data.roomId)`, which gates the *room ID* (client-supplied), not the *token*.

**For comparison — the extension-token path *does* enforce single-use** (verbatim, lines 553 and 567 of the same file):

```typescript
        if (consumedExtensionTokens.has(tokenHash)) {
          // ... reject as already used
        }
        // ...
        consumedExtensionTokens.set(tokenHash, tokenExpMs > 0 ? tokenExpMs : now + additionalMs);
```

**Impact.** Within the JWT's `exp` window, a host can call `create-room` repeatedly with new client-derived `roomId` values. Bounded only by the per-socket `create-room` rate limit (`max: 10` per minute, line 46). For `standard` tier (60 min window): up to ~600 rooms per paid invoice. For `day` tier (24 h window): up to ~14,400. This breaks the documented "one payment = one room" economic model and is also the largest paid-vector memory-exhaustion path against the in-memory `rooms` map.

**Fix.** (a) Add `paymentHash` to the JWT payload at mint time (`paywall.ts:339-342`). (b) Add a `consumedRoomCreationTokens: Map<paymentHash, expMs>` at the top of `socketHandlers.ts` mirroring the existing `consumedExtensionTokens` design (lines 57–62). (c) Reject `create-room` if `consumedRoomCreationTokens.has(decoded.paymentHash)`. (d) Independently, pin `algorithms: ["HS256"]` on `jwt.verify` (currently absent) for behavior-pinning against future library default changes.

---

## M-01 — Browser-to-browser ECDHE: silent fallback to phrase key; no signed hello binding

**File:** `artifacts/void-client/src/lib/webrtc.ts` — `initiateOffer` (verbatim, lines 353–367):

```typescript
  async initiateOffer(remotePeerId: string) {
    if (this.e2eKey) {
      try {
        await this.performKeyExchange(remotePeerId);
      } catch {
        // Fallback: peer may not support ECDHE, use phrase key
      }
    }

    const pc = this.buildPC(remotePeerId);
    const offer = await pc.createOffer();
    const clampedOffer = { ...offer, sdp: clampOpusBitrate(offer.sdp ?? "") };
    await pc.setLocalDescription(clampedOffer);
    await this.relay(remotePeerId, { type: "offer", sdp: pc.localDescription! });
  }
```

**AUDIT.** The `try { await this.performKeyExchange(...) } catch {}` swallows any failure (network blip during key exchange, peer-side error, transient WebCrypto failure). The offer continues, encrypted with the room-wide phrase key. The "peer may not support ECDHE" comment describes a path that does not exist in production (every VOID client supports ECDHE); in practice this catch only fires for transient errors, and silently downgrades from per-pair forward secrecy to room-wide secrecy.

**File:** `artifacts/void-client/src/lib/webrtc.ts` — `handleRelay` decryption fallback (verbatim, lines 380–409):

```typescript
    let payload: RelayPayload;
    try {
      if (typeof rawPayload === "string") {
        const sessionKey = this.peerSessionKeys.get(fromPeerId);
        if (sessionKey) {
          try {
            payload = (await decryptSignal(sessionKey, rawPayload)) as RelayPayload;
          } catch {
            if (this.e2eKey) {
              try {
                payload = (await decryptSignal(this.e2eKey, rawPayload)) as RelayPayload;
              } catch {
                this.recordDecryptFail(fromPeerId);
                return;
              }
            } else {
              this.recordDecryptFail(fromPeerId);
              return;
            }
          }
        } else if (this.e2eKey) {
```

**AUDIT.** When a per-pair session key fails to decrypt a relayed payload, the code retries with the phrase-derived `e2eKey`. A peer who legitimately rotated their session key, or whose ECDHE state was reset by an ICE restart, will silently use the phrase key from then on. Per-pair forward secrecy is not maintained on transient failure. The same pattern repeats in `attemptIceRestart` (lines 531–540).

**Hello binding.** No signed envelope binds the local ECDH public key to a per-session signing identity; at the time of this audit the browser implemented neither side. *(Later resolved: the browser-side signed-hello envelope shipped in Task #199 — `helloEnvelope.ts` / `@workspace/wire-core`.)*

**Why this is Medium not High.** The phrase-derived key encrypts the ECDHE handshake itself. An attacker who does not know the phrase cannot read or forge the handshake messages, so cannot grind a SAS collision. The current "SAS provides MITM resistance" claim is true *because of the phrase-encrypted envelope*, not because of an independent commitment. The Medium reflects two real defense-in-depth gaps: silent FS downgrade on transient failure, and no in-band proof that the ECDH public key the receiver sees is the one its sender meant to send.

**Fix.** (a) Replace each silent catch with explicit close + user-visible error. A peer should never silently downgrade from per-pair to room-wide encryption. (b) Add a signed hello on the browser side mirroring the SDK design.

---

## M-02 — Empty room can be claimed by any phrase-holder as host without a JWT

**File:** `artifacts/api-server/src/rooms.ts` — `joinRoom` host-grant (verbatim, lines 354–360):

```typescript
  const updated = [...users, { socketId, peerId }];
  room.users = updated;
  if (!room.hostSocketId) {
    room.hostSocketId = socketId;
  }
  return { success: true, users: updated, locked: room.locked, maxUsers: MAX_USERS };
}
```

**AUDIT.** When the previous host disconnected and was the last user, `leaveRoom` clears `hostSocketId` to `null` (lines 475–484). The room itself remains until per-room TTL. The next call to `joinRoom` for that room finds `room.hostSocketId === null`, takes the `if (!room.hostSocketId)` branch, and assigns the joining socket as host. There is **no JWT check** on this path — `joinRoom` does not see the JWT at all (only `socketHandlers.ts` `create-room` does). The phrase is the only thing the joiner needed to compute the room code in the first place.

**Why this is Medium not High.** Within VOID's threat model, phrase-holders are by design treated as a trusted group: anyone with the phrase can already join the call, see/hear everyone, and (with screen-share permission) display arbitrary content. The "host" privileges this transfers — `destroyRoom`, `lock`, `knockMode`, `screenShareReservation` — do not cross a confidentiality boundary. They cross a **resilience and UX-control boundary**, and they break the invariant a paying host might assume (their JWT entitles them to the host role for the room they paid for).

**Fix paths.** (a) Once H-05 is fixed, bind host role to the JWT's `paymentHash`: store `room.hostPaymentHash` on create, and only re-grant host on `join-room` if the joiner presents a JWT whose `paymentHash` matches. (b) Or: refuse to re-grant host once the room has emptied, requiring the original host to use the recovery-code flow. (c) Or: accept the current behavior and document it on the threat-model page as "any phrase-holder can become host of an empty room until expiry."

---

## R-N1 — `path-to-regexp` DoS in production `express` dependency (May 2026 re-audit)

**Finding:** `path-to-regexp < 8.4.0` is a transitive runtime dependency of Express in the API server production image. Two advisories apply:

- **CVE-2026-4926 (High)** — DoS via sequential optional groups: a route pattern using sequences like `/:a?/:b?/:c?` compiles a regex that hangs the process under adversarial input. CVSS 3.1 score 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H).
- **CVE-2026-4923 (Moderate)** — ReDoS via multiple wildcards: patterns using multiple `*` can produce exponential backtracking.

**Dependency path:**

```
artifacts/api-server
  └─ express@^5.x
       └─ router@~2.x
            └─ path-to-regexp@^8.0.0   ← vulnerable: <8.4.0, patched >=8.4.0
```

**Why the risk is lower than CVSS suggests for VOID specifically:**

VOID's Express route table is static and author-defined (e.g. `"/api/paywall/status/:paymentHash"`, `"/api/ice-servers"`). The DoS trigger requires a *route pattern* containing sequential optional groups or multiple wildcards — not a crafted *incoming request URL*. An attacker cannot inject a new route pattern at runtime; they can only send requests that match or fail to match existing patterns.

However, the Express router evaluates every registered route pattern against every incoming request URL. A crafted request URL could still trigger the ReDoS on a vulnerable pattern if any registered VOID route happens to have the vulnerable shape. The fix is available with no API-compatibility change.

**Patched version:** `path-to-regexp >= 8.4.0` (fix: step increment of 0 is sanitized; optional-group recursion is bounded).

**Recommended remediation:**

Option A — bump Express to a version that pulls in `path-to-regexp >= 8.4.0`:

```jsonc
// artifacts/api-server/package.json
{
  "dependencies": {
    "express": "^5.x.y"   // confirm this version pulls in path-to-regexp >=8.4.0 transitively
  }
}
```

Option B — use a pnpm workspace override to force the patched version regardless of what Express requests:

```jsonc
// root package.json
{
  "pnpm": {
    "overrides": {
      "path-to-regexp": ">=8.4.2"
    }
  }
}
```

Either option should be followed by `pnpm install` and a re-run of `pnpm audit --json` to confirm the advisory is resolved in the `artifacts__api-server` subtree.

**Status:** OPEN as of May 2, 2026. Tracked as follow-up task #239.

---
