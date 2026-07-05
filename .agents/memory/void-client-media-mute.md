---
name: void-client mute is cosmetic by default
description: In-call MIC/CAM toggles only emit peer-media-state (a receiver-side cosmetic indicator); true privacy requires disabling the local outgoing track.
---

# void-client MIC/CAM mute: cosmetic vs. real

In `artifacts/void-client/src/pages/RoomPage.tsx`, `toggleMic`/`toggleCam`
historically only set React state + `socket.emit("peer-media-state", ...)`.
That event is rendered by the receiver (`PeerTileGrid.tsx`) as a muted-icon /
CAM-OFF overlay — it does NOT stop the sender's media or mute the incoming
element. So the UI says "MIC OFF" while audio keeps flowing to the peer.

**Why:** camera mute "looked" correct only because the receiver hides the
whole video tile on `camOff`; mic had no equivalent receiver-side silencing,
exposing the gap. Both are cosmetic — neither stopped the outgoing track.

**How to apply:** for any real mute/privacy guarantee, disable the local
outgoing track at the source:
`localStreamRef.current?.getAudioTracks().forEach(t => t.enabled = !muted)`
(and the `getVideoTracks()` equivalent for camera). Treat `peer-media-state`
as a display hint only, never as the enforcement mechanism. Defense-in-depth:
also mute the incoming element on the receiver when a peer reports muted.
`useScreenShareLifecycle.ts` already toggles `getVideoTracks().enabled`, so
respect its ordering when touching the video track.
