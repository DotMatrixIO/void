# Log Correlation Audit — IP ↔ Room ID

**Invariant.** No single log line emitted by the VOID signaling server
carries a **client IP** and a **room ID** together.

**Why this is the property that matters.** The signaling server
legitimately sees client IPs (HTTP access lines; socket connect/disconnect
lifecycle) and room codes. Each *alone* is operational telemetry that
supports rate limiting and abuse triage. The two *together in one line* are
a **correlation** — they reconstruct "this IP was in that room", which is
the de-anonymization the product promises not to create. "VOID never logs
your IP" is **not** the true claim and never was (see
`docs/privacy-non-goals.md` and the follow-up audit of IP-logging posture);
the true, enforceable claim is **non-correlation**.

**Current reality (2026-06-05).** No log line correlates the two:

- `artifacts/api-server/src/lib/accessLog.ts` logs `ip`, `method`, `url`,
  `status`, `durationMs`. The room code can only appear inside `url`; it is
  scrubbed to `<room-id>` on the 2xx success path. A 4xx line can retain a
  *malformed* (non-32-hex) path value, which by construction is not a valid
  room ID (valid 32-hex codes resolve 2xx and are scrubbed). This URL-string
  case is pinned at runtime by
  `artifacts/api-server/src/__tests__/access-log-scrub.test.ts`.
- `artifacts/api-server/src/socketHandlers.ts` socket-connect/disconnect
  lifecycle logs `ip`, `event`, `peerCount` — no room code.
- Both IP-bearing lines are `info` level, i.e. **off** under the self-host
  default `LOG_LEVEL=warn`.

## How the invariant is enforced

Two complementary guards:

1. **Static, structured-field** —
   `artifacts/void-client/scripts/check-log-ip-room-correlation.mjs` scans
   every `.ts`/`.tsx` under `artifacts/api-server/src` (excluding tests) and
   fails CI if any `logger.*` / `console.*` call's first-argument object
   contains **both** an IP-bearing key (`ip`, `clientIp`, `clientIP`,
   `remoteAddress`, `forwardedFor`) **and** a room-ID-bearing key (`code`,
   `roomCode`, `roomId`, `room`). Wired into the `marketing-voice`
   validation workflow.
2. **Runtime, URL-string** — `access-log-scrub.test.ts` proves the access
   log scrubs valid room codes out of request URLs on the success path.

The static guard stops a new *structured* correlation from being
introduced; the runtime test stops the URL scrub from being silently
removed. Neither replaces the other.

## Scope note

Only the signaling **server** is scanned. A browser client trivially knows
its own IP; an IP↔room pair in a *client-side* log is not the threat. The
threat is the **instance operator's** server-side logs.

## Adding an exception (don't, unless you must)

There is no legitimate reason to correlate an IP with a room ID in a log
line. If a reviewed, unavoidable need ever arises, add the `{file, line}` to
`ALLOWLIST` in the check script **and** a row to the table below describing
the payload, why it is necessary, and its retention.

| File:line | IP field | Room field | Why necessary | Retention |
|-----------|----------|------------|---------------|-----------|
| _(none)_  | —        | —          | —             | —         |

## Related, deliberately out of scope here

Whether the server should log client IPs **at all** (vs. drop or hash them),
and whether the posture should differ between the public instance and a
self-hosted instance, is a separate **threat-model question** — not a
correlation question. It is tracked as its own audit (deliverable: an
analysis with a recommendation, not a code change). This document and its
guard only pin **non-correlation**, which holds regardless of how that
audit resolves.
