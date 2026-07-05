// SPDX-License-Identifier: AGPL-3.0-or-later
// Detect when the page was loaded over a Tor `.onion` address.
//
// The actual v3 host validation lives in src/lib/onionHost.ts so it can be
// shared verbatim with the build-time onion-bake guard (vite.config.ts).
//
// A user who reaches VOID via an onion hostname has signaled that they
// want privacy at the network layer. WebRTC's ICE candidate gathering
// happens on the underlying network regardless of how the page loaded —
// so without `iceTransportPolicy: "relay"`, the user's clearnet IP is
// offered as a host or srflx candidate to other peers in the room.
// Detecting onion access lets the UI default the host's relay-only
// toggle on, force the joiner's local PeerConnection into relay-only
// regardless of the room setting, and surface a "Connected via Tor
// onion" indicator that builds trust in the auto-default.
//
// The check is intentionally conservative: the hostname must end in a
// `.onion` label whose preceding label is a valid Tor v3 address (exactly
// 56 base32 [a-z2-7] characters — see src/lib/onionHost.ts, the single
// source of truth shared with the build-time onion-bake guard). Strings
// that contain `.onion` in a path or query but not in the hostname, bare
// `foo.onion` values, v2-length labels, localhost, IP literals, and
// clearnet hostnames all return false.

import { isOnionV3Hostname } from "@/lib/onionHost";

/**
 * The initial `iceTransportPolicy` to use when constructing the local
 * RTCPeerConnection on first join. When VOID is loaded over a Tor
 * `.onion` origin we pin the policy to `"relay"` so the browser refuses
 * to gather host/srflx candidates that would otherwise expose the
 * user's clearnet IP — regardless of whether the room as a whole was
 * created with `relayOnly: true`. This is the single source of truth
 * consumed by `RoomPage`'s `iceTransportPolicyRef` initialiser; lifting
 * the decision out of the component lets it be regression-tested
 * directly without needing to mount the entire room UI.
 */
export function initialIceTransportPolicy(): RTCIceTransportPolicy {
  return isOnionOrigin() ? "relay" : "all";
}

export function isOnionOrigin(): boolean {
  if (typeof window === "undefined" || !window.location) return false;
  return hostnameIsOnion(window.location.hostname);
}

// Re-exported from the shared single source of truth so the runtime origin
// check and the build-time onion-bake guard can never disagree about what a
// valid v3 `.onion` host looks like. See src/lib/onionHost.ts.
export function hostnameIsOnion(hostname: string | null | undefined): boolean {
  return isOnionV3Hostname(hostname);
}
