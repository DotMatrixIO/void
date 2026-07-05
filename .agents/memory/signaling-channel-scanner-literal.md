---
name: signaling-envelope scanner needs literal createDataChannel string
description: Why a data-channel label passed as a constant evades check-signaling-envelope.mjs and ships undetected.
---

The `check-signaling-envelope.mjs` audit guard discovers data channels by
regex-matching **literal** `createDataChannel("…")` string arguments. A
label passed via a named constant — e.g. `createDataChannel(REKEY_CHANNEL_LABEL)`
— is invisible to the scanner, so the channel ships with no audit-doc row and
no whitelist entry, silently bypassing the guard.

**Why:** the regex extracts the quoted literal; it does not resolve identifiers.

**How to apply:** when adding any new RTCDataChannel, pass the label as an
inline string literal at the `createDataChannel` call site (keep a constant for
comparisons elsewhere if you like, but the call itself must be literal). Then
add the matching row to `docs/signaling-envelope-audit.md` Table 2 and the
whitelist in the script, and bump the channel counts. Run the
`marketing-voice` workflow (includes `check:signaling-envelope`) to confirm
found-count == whitelist-count.
