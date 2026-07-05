---
name: VideoSlot muted prop & isolated render stubs
description: Why VideoSlot sets el.muted imperatively, and the jsdom stubs needed to render PeerTileGrid/VideoSlot in isolation.
---

# React `muted` on <video>/<audio> is unreliable — set it imperatively

VideoSlot (artifacts/void-client/src/pages/room/videoTiles.tsx) sets
`el.muted = muted` in a useEffect (keyed on muted + stream) in addition to
the JSX `muted` prop.

**Why:** React does not reflect `muted` as a DOM attribute and can skip
setting the property on mount (facebook/react#10389). For privacy-critical
paths (receiver-side mute of a peer reporting micMuted), relying on the JSX
prop alone risks audio leaking through. Setting the DOM property in an
effect guarantees it applies.

**How to apply:** Any time correctness of audio muting matters (not just
cosmetic), set the media element's `.muted` via ref, don't trust the prop.

# Receiver-side peer mute lives in PeerTileGrid

PeerTileGrid passes `muted={isMe || peerMicMuted}` where `peerMicMuted` is
`peerMediaState[id].micMuted === true` for a remote tile. The sender also
stops transmitting (mic-mute fix), but the receiver muting is the
defense-in-depth layer against a sender that keeps sending audio. Note the
camOff path is still cosmetic-only (overlay) — incoming video is not paused.

# Isolated jsdom render of PeerTileGrid / VideoSlot needs stubs

To mount a remote tile with a stream under vitest/jsdom you must stub:
- `HTMLMediaElement.prototype.play` → returns a resolved Promise (jsdom
  leaves it undefined, and VideoSlot calls `.play().catch()`).
- global `AnalyserNode` (VuMeter does `x instanceof AnalyserNode`).
- global `ResizeObserver` (VideoSlot observes its container).
RoomPage integration tests avoid this because they render remote tiles with
no stream (NoSignalSlot, null analyser). See PeerTileGrid.test.tsx.
