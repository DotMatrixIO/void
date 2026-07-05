// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-flight WebRTC capability probe.
//
// Privacy-hardened browsers (Vanadium on GrapheneOS, Tor Browser,
// Mullvad, LibreWolf, Brave on Strict) and managed Chrome/Edge profiles
// with `WebRtcLocalIpsAllowedUrls` set commonly enforce a "no
// non-proxied UDP" WebRTC policy. The symptom on the wire is identical
// every time: the page can construct an `RTCPeerConnection`, signaling
// completes normally, but ICE finishes with zero usable candidates and
// the call silently times out 30+ seconds later.
//
// `probeWebRtcCapability` short-circuits that: it stands up a throwaway
// peer connection against a STUN server, gathers candidates for at most
// ~3 seconds, and reports whether anything usable came back. If the
// answer is "no", the caller can show a dedicated fix-it screen instead
// of letting the user walk into a long, silent failure.
//
// The probe is intentionally cheap: one RTCPeerConnection, one data
// channel, one offer, no media tracks. It never touches getUserMedia
// (we don't want to provoke a permission prompt for a diagnostic).

import { DEFAULT_ICE_SERVERS } from "./iceServers";

// Probe defaults to the same ICE-server set as the live call so the
// probe's pass/fail reflects what the user would actually see when the
// real RTCPeerConnection comes up. See `iceServers.ts`.
const DEFAULT_STUN_SERVERS: RTCIceServer[] = DEFAULT_ICE_SERVERS;

/** Total wall-clock budget for the probe. */
export const DEFAULT_PROBE_TIMEOUT_MS = 3000;

export type WebRtcCapabilityStatus =
  /** Browser produced at least one usable ICE candidate. */
  | "ok"
  /** Probe ran, but ICE gathered no host/srflx/relay candidates within the budget. */
  | "blocked"
  /** `RTCPeerConnection` itself isn't defined in this runtime. */
  | "no-rtc"
  /** Probe threw unexpectedly. The runtime supports WebRTC but the construction failed. */
  | "error";

export interface CandidateCounts {
  host: number;
  srflx: number;
  relay: number;
  prflx: number;
}

export interface WebRtcCapability {
  status: WebRtcCapabilityStatus;
  /** Per-type ICE candidate counts observed during gathering. */
  candidates: CandidateCounts;
  /** Time spent gathering, in ms. */
  elapsedMs: number;
  /** Free-form note for debugging. Never surfaced to the user verbatim. */
  reason?: string;
}

export interface ProbeOptions {
  /** Override the STUN/TURN config. Defaults to public Google STUN. */
  iceServers?: RTCIceServer[];
  /** Total wall-clock budget. Defaults to 3000ms. */
  timeoutMs?: number;
  /**
   * Inject a custom RTCPeerConnection constructor for testing. Defaults
   * to the global, when one is present.
   */
  RTCPeerConnectionImpl?: typeof RTCPeerConnection;
}

interface RTCIceCandidateWithType {
  type?: string | null;
  candidate?: string;
}

function classifyCandidate(c: RTCIceCandidateWithType): keyof CandidateCounts | null {
  // Prefer the parsed `type` property when it's populated. Fall back to
  // parsing the candidate-attribute string ("candidate:... typ host ...")
  // for runtimes (and mocks) that don't fill it in.
  const explicit = c.type;
  if (explicit === "host" || explicit === "srflx" || explicit === "relay" || explicit === "prflx") {
    return explicit;
  }
  const s = c.candidate;
  if (typeof s !== "string") return null;
  const m = s.match(/\btyp\s+(host|srflx|relay|prflx)\b/);
  if (m) return m[1] as keyof CandidateCounts;
  return null;
}

/**
 * Run a short, side-effect-free WebRTC probe and report whether the
 * browser is willing to gather any usable ICE candidates.
 *
 * The probe never throws. Any failure is captured in the returned
 * `status` field.
 */
export async function probeWebRtcCapability(
  opts: ProbeOptions = {},
): Promise<WebRtcCapability> {
  const started = Date.now();
  const counts: CandidateCounts = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const iceServers = opts.iceServers ?? DEFAULT_STUN_SERVERS;

  const PCImpl: typeof RTCPeerConnection | undefined =
    opts.RTCPeerConnectionImpl
    ?? (typeof RTCPeerConnection !== "undefined" ? RTCPeerConnection : undefined);

  if (!PCImpl) {
    return {
      status: "no-rtc",
      candidates: counts,
      elapsedMs: Date.now() - started,
      reason: "RTCPeerConnection is not defined in this runtime",
    };
  }

  let pc: RTCPeerConnection | null = null;
  try {
    pc = new PCImpl({ iceServers });
  } catch (e) {
    return {
      status: "error",
      candidates: counts,
      elapsedMs: Date.now() - started,
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  return new Promise<WebRtcCapability>((resolve) => {
    let settled = false;
    const finish = (status: WebRtcCapabilityStatus, reason?: string) => {
      if (settled) return;
      settled = true;
      try { pc?.close(); } catch { /* ignore */ }
      resolve({
        status,
        candidates: { ...counts },
        elapsedMs: Date.now() - started,
        reason,
      });
    };

    const timer = setTimeout(() => {
      const total = counts.host + counts.srflx + counts.relay + counts.prflx;
      finish(total > 0 ? "ok" : "blocked", "timeout reached without enough candidates");
    }, timeoutMs);

    try {
      pc!.onicecandidate = (ev) => {
        const c = ev.candidate as RTCIceCandidateWithType | null;
        if (c === null) {
          // Null candidate signals end-of-gathering. Decide now.
          clearTimeout(timer);
          const total = counts.host + counts.srflx + counts.relay + counts.prflx;
          finish(total > 0 ? "ok" : "blocked", "ice gathering complete");
          return;
        }
        const kind = classifyCandidate(c);
        if (kind) counts[kind]++;
        // Server-reflexive or relay candidates are the strongest
        // positive signal — they prove the browser is willing to send
        // UDP off-host. Resolve as soon as we see one to keep the
        // probe budget minimal for the happy path.
        if (kind === "srflx" || kind === "relay") {
          clearTimeout(timer);
          finish("ok", `${kind} candidate observed`);
        }
      };

      // The data channel is what actually causes ICE gathering to
      // start for a connection with no tracks; without it the offer
      // is empty and the browser short-circuits.
      pc!.createDataChannel("probe");
      pc!.createOffer()
        .then((offer) => pc!.setLocalDescription(offer))
        .catch((e) => {
          clearTimeout(timer);
          finish("error", e instanceof Error ? e.message : String(e));
        });
    } catch (e) {
      clearTimeout(timer);
      finish("error", e instanceof Error ? e.message : String(e));
    }
  });
}
