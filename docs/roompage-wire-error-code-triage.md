# Wire-level error code triage (Task #482 follow-up to #466)

Task #466 produced an audit of every wire-level error code emitted by
`artifacts/api-server/src/`, classified as **specific UI** / **generic**
/ **not handled**. Two rows (`KNOCK_QUEUE_FULL`, remote-initiated ICE
restart counter reset) were folded in then. The remainder were deferred
to this task, which closes each row out as either (a) a new specific UI
surface or (b) WONT-FIX with a one-line rationale.

## Method

`rg --no-filename -o 'error: "[A-Z_]+"' artifacts/api-server/src/ | sort -u`
yields the canonical 29-code list. Each was cross-referenced against
client handling in `artifacts/void-client/src/` (RoomPage.tsx, App.tsx,
PaywallModal.tsx, and the extracted hooks). Classification reflects the
state of `main` **after** the App.tsx create-room copy fix landed in
this task (see "Changes landed" below).

## Table

| Code | Surface | Status | Decision |
| --- | --- | --- | --- |
| `ROOM_NOT_FOUND` | join-room, reclaim-host | specific | Already maps to "ROOM NOT FOUND" / dead-room overlay. **CLOSED — handled.** |
| `ROOM_EXPIRED` | join-room, signaling | specific | "ROOM EXPIRED". **CLOSED — handled.** |
| `ROOM_LOCKED` | join-room | specific | "ROOM LOCKED". **CLOSED — handled.** |
| `ROOM_FULL` | join-room, approve-knock | specific | "ROOM FULL". **CLOSED — handled.** |
| `ROOM_EXISTS` | create-room | specific | Retried up to 3× with new phrase, then "COLLISION — TRY AGAIN". **CLOSED — handled.** |
| `ROOM_DESTROYED` | join-room | specific | Collapses into dead-room overlay (privacy: burned vs never-existed must be indistinguishable). **CLOSED — handled.** |
| `KNOCK_PENDING` | join-room | specific | Flips UI into the knock-pending waiting state. **CLOSED — handled.** |
| `KNOCK_QUEUE_FULL` | join-room | specific | "TOO MANY PEOPLE KNOCKING — TRY AGAIN" (folded into #466). **CLOSED — handled.** |
| `INVALID_CODE` | join-room, lookup | specific | "INVALID CODE". **CLOSED — handled.** |
| `RATE_LIMITED` | create-room, request-relay-only, paywall | specific | "TOO MANY REQUESTS" / "TOO MANY REQUESTS · TRY AGAIN LATER". **CLOSED — handled.** |
| `TOKEN_ALREADY_USED` | create-room, extend-room | specific | "ONE PAYMENT, ONE ROOM …" / "THIS PAYMENT WAS ALREADY USED …" (task #181). **CLOSED — handled.** |
| `PAYMENT_REQUIRED` | create-room, paywall | specific | "PAYMENT REQUIRED" + paywall modal. **CLOSED — handled.** |
| `NO_HOST` | request-relay-only | specific | "NO HOST IN ROOM TO ASK". **CLOSED — handled.** |
| `SCREEN_SHARE_ACTIVE` | request-screen-share | specific | "ANOTHER PARTICIPANT IS SHARING". **CLOSED — handled.** |
| `INVALID_REQUEST` | create-room, signaling | specific (new) | App.tsx now branches to "BAD REQUEST — RELOAD AND TRY AGAIN" instead of the misleading "PAYMENT REQUIRED" catch-all. Signaling-side `INVALID_REQUEST` (peer-signal payload validation) remains WONT-FIX silent — see below. **CLOSED — partially handled, signaling path WONT-FIX.** |
| `INVALID_ROOM_ID` | create-room | specific (new) | Same App.tsx branch as `INVALID_REQUEST`. **CLOSED — handled.** |
| `AGENT_ROOMS_DISABLED` | create-room (agent ns) | specific (new) | App.tsx now branches to "AGENT ROOMS DISABLED ON THIS SERVER". Surfacing this is required for self-hosters who toggle the agent namespace off. **CLOSED — handled.** |
| `LIGHTNING_BACKEND_UNAVAILABLE` | paywall HTTP routes | specific | PaywallModal renders the "Lightning backend unavailable" state. **CLOSED — handled.** |
| `NOT_HOST` | host-only socket events (approve/deny-knock, lock-room, destroy-room, set-knock-mode) | generic | **WONT-FIX.** Reachable only if the server desyncs about who is host, which is a server-side ordering bug rather than a user-facing condition. Surfacing a toast would invite confusion ("am I the host or not?"); the next `host-changed` broadcast self-heals the UI. Tracked by server invariants, not client copy. |
| `NOT_IN_ROOM` | leave-room, peer-media-state, screen-share-stopped, relay-flip ack | silent | **WONT-FIX.** Only fires on teardown races (the client already left or never joined). The relevant local state is already torn down at this point, so a toast would surface noise about an action the user did not initiate. Logged server-side in the rate-limit / membership audit trail. |
| `KNOCK_NOT_FOUND` | approve-knock, deny-knock | generic | **WONT-FIX.** The knocker cancelled or timed out between the host seeing the prompt and acting. The knock row disappears from the moderation tray via the next `knocks-updated` broadcast, which is the correct UX cue. A toast would tell the host their own click "failed" when in fact the queue self-corrected. |
| `HOST_PRESENT` | reclaim-host | generic | **WONT-FIX.** The reclaim-host path is fully automatic (token replay on rejoin) and the only legitimate response when the host slot is already occupied is "do nothing, you joined as a guest." The host pill already reflects the truth via the join callback's `hostPresent` / `hostPeerId` fields — surfacing a separate "couldn't reclaim host" toast would confuse the guest case. |
| `PAYMENT_HASH_MISMATCH` | reclaim-host, extend-room | generic | **WONT-FIX (security).** Cross-room token replay attempt. Surfacing distinct copy would help an attacker confirm they had the wrong room. Falls through to the generic extend / reclaim failure path — the same indistinguishability property as `ROOM_DESTROYED` vs `ROOM_NOT_FOUND` applies. |
| `ROOM_CAP_REACHED` | create-room (operator-side capacity cap) | silent | **WONT-FIX in client.** Already surfaces server-side via `logCapRejection` for operator observability (task #461 covers the live-count UI). End users see the standard "PAYMENT REQUIRED" / "COLLISION" fallback, which is the correct UX — a hard cap is an operator-scale event, not something an end user can act on. |
| `AGENT_QUOTA_REACHED` | create-room (agent ns capacity cap) | silent | **WONT-FIX in client**, same rationale as `ROOM_CAP_REACHED`. Operator-side observability covers it; surfacing it to an agent client would just say "try later" which the retry already implies. |
| `NO_RESERVATION` | screen-share-stopped, slot lifecycle | silent | **WONT-FIX.** Only fires when a stop is sent for a slot the server already released (race with `screen-share-stopped` broadcast). Local UI has already cleared the share state, so a toast would contradict what the user sees. |
| `SLOT_OCCUPIED` | screen-share / persistent-room slot | silent | **WONT-FIX.** Functionally equivalent to `SCREEN_SHARE_ACTIVE`, which already has UI copy. The `SLOT_OCCUPIED` path is the internal name returned by the slot allocator; clients never see it directly because the screen-share flow translates it. Tracked here for completeness. |
| `SLOT_RESERVED` | screen-share / persistent-room slot | silent | **WONT-FIX.** Transient — the reservation resolves on the next ack. UI would flicker. |
| `NOT_SHARING` | screen-share-stopped | silent | **WONT-FIX.** Idempotent stop. The user already sees that they are not sharing. |
| `EXTENSION_CAPPED` | extend-room (paywall) | generic | **WONT-FIX.** Already surfaces through `flashExtendNotice("COULDN'T EXTEND: EXTENSION_CAPPED")`. The cap is documented in the paywall modal copy and on the pricing page; raw-code surfacing is acceptable here because the host actively chose to extend and needs to see *some* failure signal. Future work to plain-language this is captured by the existing paywall-copy review, not this triage. |
| `INVALID_EXTENSION` | extend-room | generic | **WONT-FIX.** Same channel and same rationale as `EXTENSION_CAPPED` — appears via `flashExtendNotice`. Only fires on stale or malformed extension tokens, which is operationally rare; raw-code visibility is acceptable as a debugging aid. |

## Changes landed in this task

- `artifacts/void-client/src/App.tsx` (create-room error branching): stop
  collapsing `INVALID_REQUEST`, `INVALID_ROOM_ID`, and
  `AGENT_ROOMS_DISABLED` into "PAYMENT REQUIRED". They now read,
  respectively, "BAD REQUEST — RELOAD AND TRY AGAIN" and
  "AGENT ROOMS DISABLED ON THIS SERVER". The catch-all default stays as
  "PAYMENT REQUIRED" for the genuine no-token path.

## What is NOT in scope here

- Plain-language rewrite of the extend-room raw-code path
  (`EXTENSION_CAPPED` / `INVALID_EXTENSION`). That belongs with the
  paywall copy pass, not the wire-error triage.
- Operator-facing live counters for `ROOM_CAP_REACHED` /
  `AGENT_QUOTA_REACHED` — tracked separately ("Show operators a live
  count of capacity-cap rejections").
- Any server-side change. Triage is client-handling only.
