// SPDX-License-Identifier: AGPL-3.0-or-later
// Canonical ICE-server set used by every WebRTC consumer in the
// void-client: the live call (`webrtc.ts`), the in-room peer setup
// (`RoomPage.tsx`), and the pre-flight capability probe
// (`browserCapability.ts`).
//
// Having one source of truth matters specifically for the probe: if
// the probe ran against a different STUN/TURN set than the real call,
// it could pass on a network where the call would fail (or vice
// versa). Importing this constant guarantees the probe and the call
// see the same network reachability surface.
//
// Build-time default: `VITE_DEFAULT_STUN_URL` injects the VOID-operated
// STUN endpoint to use as the static default. When unset, the default
// is an empty list — privacy fails closed (host-candidates-only)
// rather than leaking peer IPs to a third party. The runtime fetch of
// `/api/ice-servers` is the authoritative source at call time; this
// constant only matters when that fetch fails or hasn't completed.
//
// When TURN credentials are introduced (per-room or per-deploy), this
// is the single function to extend.

const DEFAULT_STUN_URL = (import.meta.env.VITE_DEFAULT_STUN_URL as string | undefined)?.trim();

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = DEFAULT_STUN_URL
  ? [{ urls: DEFAULT_STUN_URL }]
  : [];
