---
name: security-key expiry guard verification
description: how to exercise the security-contact key-expiry branches without gpg
---

# Testing the security-contact key-expiry guard

`check-security-key-fingerprint.mjs` (void-client) verifies `security-contact.asc`
in pure Node (no gpg in CI) and fails on an expired contact key. The committed
key has no expiry subpacket, so the expired / expiring-soon branches are never
exercised by CI on the real key — they need synthetic fixtures.

**How to make synthetic fixtures without gpg:** inject a key-expiration subpacket
into a COPY of the real self-signature and re-armor.

**Why this works:** the guard does NOT cryptographically verify signatures (it
only parses subpackets), and the key fingerprint is computed over the
public-key packet ONLY. So editing a signature packet leaves the fingerprint and
UID checks passing while changing the expiry the guard reads. Always restore the
real `.asc` byte-identical afterward and `diff` to confirm.
