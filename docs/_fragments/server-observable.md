#### What the server can see

A signaling relay is not a black box. Distinct from what it *stores*, here is the full inventory of what the server-side process observes in memory while a room is live:

- **Source IPs** of every connected socket (the L4 peer address; `req.ip` after the configured `trust proxy` hop). Required to enforce per-IP socket caps and per-IP rate buckets.
- **Connection timing.** When each socket connected, when it joined, when it left, when it disconnected — at millisecond resolution, because the event loop sees the events when they happen.
- **The 32-character lowercase hex room ID.** The phrase itself never reaches the server (it lives only in the URL fragment and the client-side KDF), but the derived room ID is the routing key for every signaling event and is therefore in plaintext in the process.
- **The peer-ID → socket-ID → IP mapping** for the duration of the connection. The server is the relay; it has to know which socket gets which broadcast.
- **Screen-share lifecycle events in plaintext.** `request-screen-share`, `screen-share-started`, `screen-share-stopped`, and the resulting `screen-share-state` broadcast all transit the server as structured events — the server knows exactly who is sharing and when they started or stopped. This one stays server-arbitrated by design: there is a single shared presenter slot, and the server is the only party positioned to arbitrate that mutual exclusion fairly across peers who cannot all see each other yet. The tradeoff is explicit — the cost of a fair, race-free presenter lock is that the server sees who is sharing and when.
- **Lock / unlock / knock-mode events and pending-knock metadata.** Same shape — host actions are server events.
- **Room metadata exposed by `/api/room-state/:code`.** Anything `/proof/server-state` will print back to a user is, by construction, something the server sees: peer count, host presence, lock state, knock-mode state, screen-share state, room type, TTL.

What this means in practice. **The server observes these events in real-time, on the wire.** Whether any of them reaches disk depends on the logging configuration. The current production access logger (`artifacts/api-server/src/lib/accessLog.ts`, Task #374) writes one line per HTTP request — method, scrubbed URL, status, duration, IP — and **does not persist screen-share lifecycle events**; those live only in memory and only for as long as the room exists. A server operator who modifies the logger to emit those events, an attacker who compromises the running process, or a passive observer of the wire who can de-TLS the signaling channel can reconstruct a transcript like: "Peer B started a screen share at minute 5, Peer A left at minute 7, the host locked the room at minute 8, a knock arrived from a new IP at minute 9." The pattern itself is on the wire whether or not we choose to write it down. Overclaiming that the server *stores* this would be cosplay; understating that the server *sees* it would also be cosplay. Both are stated honestly here.

Per-peer **camera / mic / voice-mask / Tor-origin state is deliberately absent from both lists above.** It used to be a plaintext `peer-media-state` envelope the server broadcast (and therefore saw) every time a peer toggled their mic or camera. As of Task #868 it rides a per-peer `void.media-state` WebRTC data channel over DTLS-over-SCTP — the same encrypted association as media — and the signaling server no longer relays, reads, or is even on the path for it. The mute/camera transcript line ("Peer A muted at minute 4") that the wire-observer could previously reconstruct is gone: that toggle never reaches the server in any form. See `docs/signaling-envelope-audit.md` Table 2 for the channel's full envelope.

#### What the server cannot see

By construction, the server is excluded from:

- **The VOID Phrase.** It lives only in the URL fragment and the host's local KDF inputs; it is never sent over the network in any form.
- **Decrypted SDP offers, answers, or ICE candidates.** All signaling payloads carried via `relay-signal` are E2E-encrypted under the phrase-derived AES-GCM key (and, after ECDHE upgrade, under per-peer session keys). The server forwards opaque ciphertext.
- **Media content.** Audio and video travel peer-to-peer over SRTP (WebRTC's default media encryption) and never touch the server. In `relayOnly` mode they still travel through Coturn, but Coturn relays UDP packets — it does not have the keys.
- **Per-peer verification state (SAS).** Whether a user tapped `MATCH` or `NO MATCH` on a verification chip is computed and stored locally in the browser; it is never emitted over the wire.
