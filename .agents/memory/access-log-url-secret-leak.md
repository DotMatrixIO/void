---
name: Access-log URL carries path-segment secrets
description: Redacting a secret from structured log FIELDS misses the access logger, which logs req.originalUrl verbatim — scrub by route position, not a charset regex.
---

When redacting a sensitive identifier from operator logs, the structured
`logger.warn({ field })` call sites are NOT the only leak path. The HTTP access
logger logs `req.originalUrl`, so any secret that appears as a **path segment**
(e.g. `/api/paywall/status/:paymentHash`) is emitted there too — at info level,
on every status. Grep for the field name alone misses this; also grep for the
route that embeds the value in its URL.

**Why:** Two consecutive code reviews on the paymentHash-redaction task caught
this. First pass missed the access logger entirely. Second pass: a lowercase
`[0-9a-f]{64}` regex leaked (a) uppercase 64-hex (the route guard is
`/^[0-9a-f]{64}$/i`) and (b) BTCPay-backend non-hex IDs (the route only requires
`length >= 10` under that backend). A charset/case regex cannot enumerate every
identifier shape a pluggable backend may accept.

**How to apply:** Scrub the `:param` segment by **route position**
(`/(\/route\/(?:a|b)\/)([^/?#]+)/gi`) so it covers any charset/case/length,
applied on EVERY status (unlike room IDs which may be kept on 4xx/5xx for
triage). Keep a case-insensitive fixed-shape catch-all as defence-in-depth.
Distinguish a triage digest (plain unkeyed sha256 prefix — removes raw value,
NOT correlation-resistant against a holder of candidate hashes) from a keyed
HMAC (defeats a file-holder); do not "consolidate" the two — they defend
different threats. Don't claim "uncorrelatable against settlement records" for
an unkeyed digest in user-facing docs.
