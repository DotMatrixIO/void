---
name: knock-approve peer-joined sender
description: Why knock-admission peer-joined must be emitted from the joiner's socket, not the approving host's
---

# Knock-approve `peer-joined` must come from the joiner's socket

In the api-server signaling (roomService `handleApproveKnock`), the
`peer-joined` broadcast that wakes existing members up to negotiate WebRTC
must be sent from the **newly-admitted joiner's** socket
(`knockSocket.to(code)`), exactly like the normal join path (where the
sender is the joining socket).

**Why:** socket.io `.to(room)` excludes the sender. The approve handler's
`ctx.socket` is the HOST who clicked ADMIT — so `ctx.socket.to(code)`
excludes the host and targets the joiner, the inverse of what's wanted.
The host then never learns a peer joined, and since client glare avoidance
(`webrtc.ts shouldInitiateTo`: smaller peerId initiates) only lets one side
offer, whenever the host holds the smaller peerId neither side ever sends
an offer → no audio/video on both ends. It also fired a spurious self
`peer-joined` at the joiner.

**How to apply:** Any server moderation/admission path that admits a peer
on behalf of someone else (host approves, auto-admit, transfer) must emit
`peer-joined` from the admitted peer's socket — never from the actor's
socket — or WebRTC negotiation silently dead-locks for half the peerId
orderings.
