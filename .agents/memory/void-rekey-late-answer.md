---
name: VOID mid-call rekey late-answer desync
description: Why the rekey initiator must retain its ephemeral key with no answer-timeout; why "resend cached answer" cannot recover a desync.
---

The mid-call PFS rotation (void.rekey RTCDataChannel) is initiator-driven by the
deterministic glare rule (smaller peerId initiates). The responder commits its
new session key **optimistically** the instant it sends the answer.

**Rule:** the initiator must keep its pending ephemeral private key alive until
either the answer arrives or the peer/channel is torn down. Do NOT arm a short
answer-timeout that discards the pending key.

**Why:** an answer-timeout that deletes the pending ephemeral key races a
slow-but-delivered answer. Because the responder already committed on send, a
late answer arrives with no pending entry to complete against → silent key
partition (responder on new key, initiator stuck on old), breaking the
silent-rotation property. The channel is reliable+ordered (SCTP), so the answer
is always delivered eventually unless the transport itself closes — and channel
closure, not message loss, is the real failure signal.

**Why "responder re-sends cached answer" does NOT recover:** once the initiator
has discarded its ephemeral private key the resent answer can't complete the
ECDH, and once the responder commits the channel is key-partitioned anyway.
Retaining the key is the only minimal correct fix.

**How to apply:** clear pending rekey state on the channel `onclose`, in
removePeer, and in destroy (not on a timer). A pending rotation intentionally
blocks the next scheduled rotation for that peer until answer-or-closure; that
is an availability tradeoff, never a silent downgrade. Keep regression coverage
for "late answer still completes" and "onclose clears pending".
