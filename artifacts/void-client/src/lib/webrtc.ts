// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Socket } from "socket.io-client";
import {
  encryptSignal,
  decryptSignal,
  generateECDHKeyPair,
  exportECDHPublicKey,
  importECDHPublicKey,
  deriveSessionKey,
  base64urlEncode as b64uEncode,
  base64urlDecode as b64uDecode,
} from "./signalCrypto";
import {
  generateSigningIdentity,
  signHello,
  verifySignedHello,
  buildBrowserHelloBody,
  HelloVerificationError,
  type SignedHello,
  type SigningIdentity,
} from "./helloEnvelope";
import { DEFAULT_ICE_SERVERS } from "./iceServers";
import {
  createDropThrottle,
  type LeadingTrailingThrottle,
} from "./dropRateLimit";
import { RELAY_SIGNAL_MAX_PAYLOAD_BYTES } from "@workspace/wire-core";

// ── Refactor 2 (task #448) extracted modules ──────────────────────────
// `webrtc.ts` remains the public façade — RoomPage.tsx and the existing
// test suite import every type/value they need from "./webrtc". The
// individual concerns now live in focused sibling modules:
//   - webrtcSdp                 codec / fingerprint helpers (pure)
//   - webrtcRelayProbe          per-peer relay-pinned probe + breaker
//   - webrtcIceMonitor          ICE restart debounce scheduling
//   - webrtcPerPeer             per-peer RTCPeerConnection factory
//   - webrtcMediaCoordinator    track add/remove + override bookkeeping
//   - webrtcPerfectNegotiation  Phase 2 seam (interface stub only)
import { clampOpusBitrate, fingerprintRemoteKey } from "./webrtcSdp";
import { validateSdp, validateIceCandidate } from "./sdpValidator";
import {
  isPeerRelayPinned,
  runRelayProbe,
  RELAY_STATUS_PROBE_INTERVAL_MS,
  RELAY_PROBE_FAILURE_THRESHOLD,
} from "./webrtcRelayProbe";
import {
  clearIceRestartTimer as clearIceRestartTimerFn,
  scheduleIceRestart as scheduleIceRestartFn,
  type IceRestartTimerMap,
} from "./webrtcIceMonitor";
import { buildPC as buildPCFn, applyVideoConstraints } from "./webrtcPerPeer";
import {
  replaceLocalStream as replaceLocalStreamFn,
  replaceVideoTrack as replaceVideoTrackFn,
  clearVideoOverride as clearVideoOverrideFn,
  type MediaCoordinatorContext,
} from "./webrtcMediaCoordinator";

// Re-export the public surface so existing consumers keep working
// after the decomposition (RoomPage.tsx, DirectP2PBadge, and the
// webrtc.*.test.ts files all import from "./webrtc" / "@/lib/webrtc").
export { isPeerRelayPinned };
export type { PeerRelayStatuses } from "./webrtcRelayProbe";
export type {
  PerfectNegotiationContext,
  PerfectNegotiationHandler,
} from "./webrtcPerfectNegotiation";

export type PeerSAS = Record<string, [string, string]>;

export type WebRTCRoomType = "human";

interface RelayPayload {
  type: "offer" | "answer" | "ice" | "key-exchange";
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  // Browser-to-browser key-exchange always carries a signed hello
  // envelope. A legacy `publicKey`-only path has no analogue here:
  // browsers ride the shared relay-signal socket with no per-session
  // channel boundary, so the signed hello (with embedded roomId) is the
  // only thing protecting the key exchange from cross-room replay and
  // from the M-01 phrase-key downgrade. Missing `hello` is a loud-fail.
  hello?: SignedHello;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream;
}

export type RemoteStreams = Record<string, MediaStream | null>;
export type PeerConnectionStates = Record<string, RTCPeerConnectionState>;
export type CryptoMismatchPeers = Record<string, boolean>;
export type SecureChannelFailures = Record<string, SecureChannelFailureReason>;
// Task #293: per-peer flag derived from RTCStats indicating whether the
// selected candidate pair on our side of the connection has BOTH the
// local and remote candidate types observed as `relay`. When true, the
// UI surfaces a small "VIA TOR" subscript on that peer's tile so the
// asymmetry of a non-relay-only room with a Tor-using peer is visible
// to everyone in the call without leaking *who* is on Tor (the relay
// pinning is itself observable from the candidate set).
// (Type is re-exported above from webrtcRelayProbe.)

const KEY_EXCHANGE_TIMEOUT_MS = 5000;

// Fired after every completed ECDHE handshake. `keyFingerprint` is
// a base64url SHA-256 of the peer's raw ECDH public key — a stable,
// full-entropy identity of the key material, distinct from the
// 2-word SAS.
export type RekeyHandler = (peerId: string, keyFingerprint: string) => void;

// Fired after a SILENT, continuity-bound rekey performed over the
// SAS-verified `void.rekey` data channel (see the time-based rekey
// block below). Distinct from `RekeyHandler` in two ways: it carries
// the fresh 2-word SAS so the UI can re-anchor a prior "verified"
// verdict to the new key material WITHOUT prompting a re-verify, and
// it is never fired for the signaling-path ECDHE (which stays loud via
// `RekeyHandler` because that path is not continuity-bound).
export type SilentRekeyHandler = (
  peerId: string,
  keyFingerprint: string,
  sas: [string, string],
) => void;

// ── Time-based PFS rekey (data-channel ratchet) ───────────────────────
// While a call is live we rotate the per-pair ECDHE session key every
// REKEY_INTERVAL_MS. The new ECDH public keys are exchanged over the
// dedicated `void.rekey` RTCDataChannel, AES-GCM-encrypted under the
// CURRENT session key — NEVER over the signaling socket. The DTLS
// transport alone is not sufficient: a peer's DTLS fingerprint rides
// the signaling SDP, so a phrase-knowing relay (the residual M-01 /
// "hostile peer in room" threat) could MITM the raw DTLS channel.
// Encrypting the rotation under the current session key — the key whose
// SAS the user already verified — makes the rotation MITM-safe by
// construction: only the genuine, verified peer can read or forge it,
// so the rekey is SILENT and needs no re-verification. The smaller
// peerId initiates (same glare rule as `shouldInitiateTo`). See
// docs/client-threat-model.md §1 and docs/signaling-envelope-audit.md.
const REKEY_INTERVAL_MS = 15 * 60 * 1000;
const REKEY_CHECK_INTERVAL_MS = 30 * 1000;
const REKEY_CHANNEL_LABEL = "void.rekey";

// Task #868: per-peer media-state control channel. Camera-on/off, mic
// mute, voice-mask mode index, and the self-advertised `.onion`-origin
// flag travel directly peer-to-peer over this channel (DTLS-over-SCTP on
// the same encrypted association as media) instead of via a plaintext
// `peer-media-state` signaling broadcast. The signaling server no longer
// relays or can read these contents — it sees only that small encrypted
// data-channel messages cross the SCTP association at distinctive
// moments. The label MUST be spelled as a string literal at the
// `createDataChannel(...)` callsite (the envelope scanner only matches
// literals) and stay byte-equal to this constant. See Table 2 of
// docs/signaling-envelope-audit.md.
const MEDIA_STATE_CHANNEL_LABEL = "void.media-state";

// Maximum byte length we will accept off the media-state channel. A
// generous cap for the small JSON object below; anything larger is a
// malformed/hostile sender and is dropped.
const MEDIA_STATE_MAX_PAYLOAD_BYTES = 1024;

/** Task #868: the media-state snapshot exchanged over the
 * `void.media-state` data channel. `camOff`/`micMuted` are always
 * present; `voiceMode`/`viaOnion` are optional and, on a partial
 * update, the receiver preserves its prior cached value rather than
 * clobbering it to undefined. */
export interface PeerMediaStateMessage {
  camOff: boolean;
  micMuted: boolean;
  voiceMode?: number;
  viaOnion?: boolean;
}

/**
 * Parse + strictly validate an inbound `void.media-state` payload.
 * Mirrors the validation that used to live in the server's
 * `handlePeerMediaState` (Task #114/#349): `camOff`/`micMuted` must be
 * booleans; `voiceMode` is accepted only as an integer in [0, 16];
 * `viaOnion` only as a boolean. Any malformed field causes the optional
 * field to be omitted (so the receiver preserves its prior cached
 * value); a malformed required field rejects the whole message. Returns
 * null on anything we won't honor.
 */
function parseMediaStateMessage(raw: string): PeerMediaStateMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.camOff !== "boolean" || typeof o.micMuted !== "boolean") {
    return null;
  }
  const out: PeerMediaStateMessage = { camOff: o.camOff, micMuted: o.micMuted };
  if (
    typeof o.voiceMode === "number" &&
    Number.isInteger(o.voiceMode) &&
    o.voiceMode >= 0 &&
    o.voiceMode <= 16
  ) {
    out.voiceMode = o.voiceMode;
  }
  if (typeof o.viaOnion === "boolean") {
    out.viaOnion = o.viaOnion;
  }
  return out;
}

interface RekeyChannelMessage {
  // `o` = rekey-offer (initiator → responder), `a` = rekey-answer
  // (responder → initiator). Both carry a fresh raw ECDH public key and
  // a per-peer monotonic epoch that defeats replay of a captured offer.
  t: "o" | "a";
  pub: string;
  epoch: number;
}

export type SecureChannelFailureReason =
  | "ecdhe_failed"
  | "hello_invalid"
  | "decrypt_failed"
  | "ice_restart_failed"
  // Task #466 (H-03): inbound SDP from a peer failed structural
  // validation (oversized, exotic codec, malformed fingerprint,
  // link-local candidate, etc.). Distinct from `decrypt_failed` so
  // the audit log can tell a forged ciphertext apart from a hostile
  // peer who survived the secure channel and then tried to push
  // pathological SDP at the WebRTC stack.
  | "sdp_validation_failed";

const CRYPTO_MISMATCH_THRESHOLD = 3;

// Task #483: bound on each per-peer replay cache (IVs and hello nonces).
// A legitimate session emits ~1 hello per ECDHE handshake and well
// under 100 ICE candidates per negotiation (the H-04 cap caps inbound
// at 50). 4096 leaves three orders of magnitude of margin for
// long-lived multi-restart calls; an actual overflow is treated as
// an attack signal by `failSecureChannel("decrypt_failed")` rather
// than as a reason to FIFO-evict and re-open the replay window.
const MAX_SEEN_REPLAY_ENTRIES = 4096;

// Byte length of the AES-GCM IV used in `signalCrypto.ts`. Mirrored
// here so the replay-defense IV-extract slice does not silently drift
// if `IV_BYTES` is ever changed (which it must not be — see the
// invariant comment in `signalCrypto.ts`).
const SIGNAL_IV_BYTES = 12;

export class WebRTCManager {
  private peers = new Map<string, PeerEntry>();
  private connectionStates = new Map<string, RTCPeerConnectionState>();
  private iceRestartTimers: IceRestartTimerMap = new Map();
  private peerSessionKeys = new Map<string, CryptoKey>();
  private peerEphemeralKeys = new Map<string, CryptoKey>();
  private pendingKeyExchange = new Map<string, (hello: SignedHello) => void>();
  private peerSASMap = new Map<string, [string, string]>();
  private peerKeyFingerprints = new Map<string, string>();
  private decryptFailCounts = new Map<string, number>();
  // Time-based PFS rekey state. `peerRekeyChannels` holds the single
  // bidirectional `void.rekey` data channel per peer (created by the
  // offerer, accepted by the answerer). `peerRekeyEpoch` is the last
  // completed monotonic rekey epoch — a replay/staleness guard on
  // inbound offers. `peerLastRekeyAt` seeds the interval clock (set on
  // the initial handshake and on every rotation). `peerPendingRekey`
  // holds the initiator's in-flight ephemeral private key while it waits
  // for the responder's `rekey-answer`. The entry is retained until the
  // answer arrives (the `void.rekey` channel is reliable + ordered, so a
  // slow answer is still delivered) or the peer is torn down — we do NOT
  // discard it on a short timeout, which would silently desync the pair
  // (see `initiateRekey`).
  private peerRekeyChannels = new Map<string, RTCDataChannel>();
  private peerRekeyEpoch = new Map<string, number>();
  private peerLastRekeyAt = new Map<string, number>();
  private peerPendingRekey = new Map<
    string,
    { privateKey: CryptoKey; epoch: number }
  >();
  private rekeyTimer: ReturnType<typeof setInterval> | null = null;
  private secureChannelFailures = new Map<string, SecureChannelFailureReason>();
  // Task #529: per-peer generation counter bumped on every
  // `failSecureChannel` write. The clear-on-success helper captures
  // this value at observation time and only proceeds with the clear
  // if the counter has not advanced since — encoding the "failure
  // always wins" rule explicitly instead of relying on event
  // ordering between the success observation, a deferred grace-window
  // timer, and any racing `failSecureChannel` call.
  private secureChannelFailureGen = new Map<string, number>();
  private peerRelayPinned = new Map<string, boolean>();
  // Task #443: per-peer RTCDataChannel("drop") used for the shared DROP
  // slot. We open one outbound channel per peer as the offerer (in
  // initiateOffer) and accept the symmetric inbound channel as the
  // answerer (via pc.ondatachannel). Both ends end up holding a channel
  // pointing the same direction; we send through whichever is open and
  // accept incoming messages from either side. The slot itself is
  // a single UTF-8 string ≤2 KB that atomically overwrites the previous
  // value — there is no history, no per-peer view, no queue.
  private peerDropChannels = new Map<string, RTCDataChannel[]>();
  // Task #868: per-peer RTCDataChannel("void.media-state"). The offerer
  // opens one outbound channel per peer in `initiateOffer`; the answerer
  // accepts the symmetric inbound channel via pc.ondatachannel. We send
  // the current local snapshot through whichever is open and accept
  // inbound snapshots from either side. `localMediaState` caches the
  // last snapshot we published so that when a NEW peer's channel opens
  // we immediately replay it to them — this is the late-joiner
  // convergence mechanism (a peer that joins after our last toggle still
  // learns our current mute/cam/voice state the moment the channel
  // opens).
  private peerMediaStateChannels = new Map<string, RTCDataChannel>();
  private localMediaState: PeerMediaStateMessage | null = null;
  // Audit H-04 (task #464): per-peer accepted-ICE-candidate counter. See
  // the cap at `addIceCandidate` in `handleRelay`. Reset on legitimate
  // re-negotiations (`attemptIceRestart`, `reinitializeAllPeers`),
  // implicitly cleared when a peer is dropped via `removePeer` /
  // `destroy`.
  private peerIceCandidateCounts = new Map<string, number>();
  // Task #483: same-sender replay defense at the VOID application layer.
  // Hostile-signaling-server replay is otherwise blocked only by
  // incidentals (the WebRTC signaling state machine for SDP, ICE dedup
  // for candidates, and the rekey-renegotiation flow tolerating a stale
  // `key-exchange`). These two per-peer caches catch the
  // (sender, IV)/(sender, hello-nonce) pair before any payload-typed
  // handler runs.
  //
  // `peerSeenIvs` stores the base64url-encoded 12-byte AES-GCM IV of
  // every successfully-decrypted relay-signal envelope from this peer,
  // across both the phrase key and any installed session key. The IVs
  // are 96-bit random per `signalCrypto.ts:encryptSignal`; collisions
  // across keys are negligible (~2^-96), so a single per-peer set is
  // sufficient and avoids the false-positive trap of clearing the
  // cache on session-key install (which would re-open the replay
  // window for the previous phase). Cleared only on `removePeer` /
  // `destroy`.
  //
  // `peerSeenHelloNonces` stores the verified nonce of every accepted
  // signed-hello body from this peer for the lifetime of the connection.
  // `verifySignedHello` itself enforces a ±5min timestamp-skew window
  // (see `MAX_TIMESTAMP_SKEW_MS` in `hello-envelope.ts`), so the cache
  // is bounded both by the window and by `MAX_SEEN_REPLAY_ENTRIES`
  // below. Exceeding either bound is itself an attack signal (no
  // legitimate session sends more than a handful of hellos / a few
  // hundred ICE candidates), so we treat overflow as a loud-fail
  // rather than falling back to FIFO eviction (which would re-open the
  // replay window for the oldest entries).
  private peerSeenIvs = new Map<string, Set<string>>();
  private peerSeenHelloNonces = new Map<string, Set<string>>();
  // Task #229 follow-up: short per-peer grace window opened when the user
  // (or the remote, via `peer-secure-channel-retry`) tears the secure
  // channel down for retry. Between `removePeer` and the new key-exchange
  // completing, any ciphertext that was already in flight encrypted with
  // the previous (now-deleted) session key arrives at handleRelay with no
  // session key installed, falls into the phrase-key fallback path, and
  // fails to decrypt (it wasn't phrase-key encrypted) — which would
  // otherwise trip `failSecureChannel("decrypt_failed")` and slam the
  // user straight back into the overlay they just dismissed. During the
  // grace window we silently drop those stragglers instead. Cleared the
  // instant a fresh session key is installed (handshake actually
  // completed) and on `destroy`. TTL is a backstop; the normal exit is
  // the install-side clear.
  private peerPostRetryGrace = new Map<string, number>();
  private static readonly POST_RETRY_GRACE_MS = 5000;
  private relayStatusProbeTimer: ReturnType<typeof setInterval> | null = null;
  // Refactor 2 (task #448): circuit-breaker accounting for the relay
  // probe. Counts consecutive uncaught throws from `runRelayProbe`; on
  // hitting RELAY_PROBE_FAILURE_THRESHOLD we tear down the interval and
  // emit a single warning. `relayProbeCircuitBroken` ensures we never
  // restart the probe in the same WebRTCManager lifetime once broken.
  private relayProbeConsecutiveFailures = 0;
  private relayProbeCircuitBroken = false;
  private signingIdentityPromise: Promise<SigningIdentity> | null = null;
  private localStream: MediaStream;
  private overrideVideoTrack: MediaStreamTrack | null = null;
  // Snapshotted pre-share camera track, restored by clearVideoOverride
  // on both the share-failure and graceful-end paths. Task #285:
  // some browsers fire `ended` on the captured display track if the
  // original camera track is read back through the `RTCRtpSender`
  // after replacement, so we keep the original reference here and
  // restore from this snapshot instead of from the sender. Reverting
  // to a "swap and forget" pattern breaks camera resume on
  // stop-share. (Indexed in docs/code-quirks-index.md.)
  private preOverrideVideoTrack: MediaStreamTrack | null = null;
  private socket: Socket;
  private myPeerId: string;
  private roomCode: string;
  private iceServers: RTCIceServer[];
  private iceTransportPolicy: RTCIceTransportPolicy;
  private e2eKey: CryptoKey | null;
  private onUpdate: (streams: RemoteStreams) => void;
  private onConnectionStateUpdate: (states: PeerConnectionStates) => void;
  private onSASUpdate: (sas: PeerSAS) => void;
  private onCryptoMismatch: (peers: CryptoMismatchPeers) => void;
  private onSecureChannelFailure: (peers: SecureChannelFailures) => void;
  private onPeerRelayStatusUpdate: (peers: Record<string, boolean>) => void;
  private onPeerConnectionCreated: (peerId: string, pc: RTCPeerConnection) => void;
  private onRekey: RekeyHandler;
  private onSilentRekey: SilentRekeyHandler;
  private roomType: WebRTCRoomType;
  // Task #443: callback fired when a peer sends a new DROP slot value.
  // The text has already been clamped to the 2 KB channel-side cap; the
  // UI is expected to sanitize again (NFC + invisible-strip) before
  // rendering. Production callers pass a real handler; tests that don't
  // exercise DROP can leave it undefined.
  private onDropReceived: (text: string) => void;
  // Per-sender leading+trailing throttle on the DROP RECEIVE path. A
  // hostile peer rewriting the slot at channel speed can't thrash our UI;
  // the last value in any burst still renders (see dropRateLimit.ts).
  private peerDropThrottles = new Map<string, LeadingTrailingThrottle>();
  // Self-throttle on the DROP SEND path so this client can't be the
  // heckler if its own UI submits faster than the cap.
  private dropSendThrottle: LeadingTrailingThrottle;
  // Task #868: callback fired when a peer sends a media-state snapshot
  // over the `void.media-state` channel. The payload has already been
  // validated (strict types, voiceMode range) before this fires. The UI
  // merges it into per-peer state, preserving prior voiceMode/viaOnion
  // on a partial update.
  private onMediaStateReceived: (peerId: string, state: PeerMediaStateMessage) => void;
  private bound: (data: { fromPeerId: string; payload: unknown }) => void;

  constructor(opts: {
    localStream: MediaStream;
    socket: Socket;
    myPeerId: string;
    roomCode: string;
    /** Room policy. VOID is human-only, so this is always "human". It is
     * still advertised inside this peer's Ed25519-signed hello body and
     * cross-checked against the locally-derived expectation on every
     * inbound hello (mismatch → `hello_invalid`), so a hostile signaling
     * server cannot relax the policy. It also gates the browser↔browser
     * timed PFS rekey (the `void.rekey` data channel + interval ratchet).
     * NOTE: signed-hello *acceptance* fails closed — an unsigned /
     * malformed / forged hello always yields `hello_invalid` (see
     * `verifySignedHello`). */
    roomType: WebRTCRoomType;
    iceServers?: RTCIceServer[];
    iceTransportPolicy?: RTCIceTransportPolicy;
    e2eKey?: CryptoKey | null;
    onUpdate: (streams: RemoteStreams) => void;
    onConnectionStateUpdate?: (states: PeerConnectionStates) => void;
    onSASUpdate?: (sas: PeerSAS) => void;
    onCryptoMismatch?: (peers: CryptoMismatchPeers) => void;
    onSecureChannelFailure?: (peers: SecureChannelFailures) => void;
    /** Task #281: explicit per-peer rekey signal. See `RekeyHandler`
     * for the contract. Optional — production callers pass a real
     * handler; tests for unrelated paths can leave it undefined. */
    onRekey?: RekeyHandler;
    /** Fired after a SILENT, continuity-bound data-channel rekey. See
     * `SilentRekeyHandler`. Optional — tests for unrelated paths can
     * leave it undefined. */
    onSilentRekey?: SilentRekeyHandler;
    /** Task #293: per-peer relay-pinned status, derived from RTCStats on a
     * periodic poll of every connected peer. Fired whenever the per-peer
     * map changes; UI subscribes and renders a "VIA TOR" subscript on the
     * affected peer's tile. */
    onPeerRelayStatusUpdate?: (peers: Record<string, boolean>) => void;
    /** Test/observability hook fired immediately after `buildPC` constructs a
     * new RTCPeerConnection for `peerId`. Production callers can leave this
     * undefined; tests use it to map every PC the manager ever creates back
     * to its peerId without monkey-patching private members. */
    onPeerConnectionCreated?: (peerId: string, pc: RTCPeerConnection) => void;
    /** Task #443: callback invoked when a peer sends a new DROP slot
     *  value. Argument is the raw UTF-8 string the peer sent (already
     *  capped at 2 KB on the wire). Production callers wire this to the
     *  shared DROP slot React state via the page-level sanitize step. */
    onDropReceived?: (text: string) => void;
    /** Task #868: callback invoked when a peer sends a media-state
     *  snapshot over the `void.media-state` data channel. Production
     *  callers wire this to the per-peer media-state React reducer.
     *  Tests for unrelated paths can leave it undefined. */
    onMediaStateReceived?: (peerId: string, state: PeerMediaStateMessage) => void;
  }) {
    this.localStream = opts.localStream;
    this.socket = opts.socket;
    this.myPeerId = opts.myPeerId;
    this.roomCode = opts.roomCode;
    this.iceServers = opts.iceServers ?? DEFAULT_ICE_SERVERS;
    this.iceTransportPolicy = opts.iceTransportPolicy ?? "all";
    this.e2eKey = opts.e2eKey ?? null;
    this.onUpdate = opts.onUpdate;
    this.onConnectionStateUpdate = opts.onConnectionStateUpdate ?? (() => {});
    this.onSASUpdate = opts.onSASUpdate ?? (() => {});
    this.onCryptoMismatch = opts.onCryptoMismatch ?? (() => {});
    this.onSecureChannelFailure = opts.onSecureChannelFailure ?? (() => {});
    this.onPeerRelayStatusUpdate = opts.onPeerRelayStatusUpdate ?? (() => {});
    this.onPeerConnectionCreated = opts.onPeerConnectionCreated ?? (() => {});
    this.onRekey = opts.onRekey ?? (() => {});
    this.onSilentRekey = opts.onSilentRekey ?? (() => {});
    // Task #313: no `?? "human"` fallback. roomType is a required option
    // derived locally from the invite by the caller (RoomPage →
    // useRoomConnection). A missing value is a caller bug, not something
    // to silently paper over with the most permissive policy.
    this.roomType = opts.roomType;
    this.onDropReceived = opts.onDropReceived ?? (() => {});
    this.dropSendThrottle = createDropThrottle((text) =>
      this.broadcastDrop(text),
    );
    this.onMediaStateReceived = opts.onMediaStateReceived ?? (() => {});

    this.bound = this.handleRelay.bind(this);
    this.socket.on("relay-signal", this.bound);
    this.startRelayStatusProbe();
    this.startRekeyTimer();
  }

  private startRelayStatusProbe() {
    if (this.relayStatusProbeTimer) return;
    if (this.relayProbeCircuitBroken) return;
    if (typeof setInterval === "undefined") return;
    this.relayStatusProbeTimer = setInterval(() => {
      // Refactor 2 (task #448) fix #2: the previous `void this.probe…()`
      // call lost any uncaught rejection. We now await inside an async
      // IIFE, count consecutive failures, and circuit-break after
      // RELAY_PROBE_FAILURE_THRESHOLD ticks so a genuinely broken
      // probe doesn't silently spam throws for the lifetime of the
      // call.
      void (async () => {
        try {
          const { changed } = await runRelayProbe({
            peers: this.peers,
            peerRelayPinned: this.peerRelayPinned,
          });
          if (changed) this.publishPeerRelayStatuses();
          this.relayProbeConsecutiveFailures = 0;
        } catch (err) {
          this.relayProbeConsecutiveFailures += 1;
          if (this.relayProbeConsecutiveFailures >= RELAY_PROBE_FAILURE_THRESHOLD) {
            this.tripRelayProbeCircuitBreaker(err);
          }
        }
      })();
    }, RELAY_STATUS_PROBE_INTERVAL_MS);
  }

  /**
   * Tear down the relay-status probe interval and emit a single
   * structured warning. Idempotent — the `relayProbeCircuitBroken`
   * flag guards both this method and `startRelayStatusProbe` so the
   * probe never restarts in the same WebRTCManager lifetime.
   */
  private tripRelayProbeCircuitBreaker(err: unknown) {
    if (this.relayProbeCircuitBroken) return;
    this.relayProbeCircuitBroken = true;
    if (this.relayStatusProbeTimer) {
      clearInterval(this.relayStatusProbeTimer);
      this.relayStatusProbeTimer = null;
    }
    try {
      console.warn("[VOID] relay-status probe circuit-broken", {
        consecutiveFailures: this.relayProbeConsecutiveFailures,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {}
  }

  private publishPeerRelayStatuses() {
    const out: Record<string, boolean> = {};
    for (const [id, pinned] of this.peerRelayPinned) {
      out[id] = pinned;
    }
    this.onPeerRelayStatusUpdate(out);
  }

  private getSigningIdentity(): Promise<SigningIdentity> {
    if (!this.signingIdentityPromise) {
      this.signingIdentityPromise = generateSigningIdentity();
    }
    return this.signingIdentityPromise;
  }

  private publishSAS() {
    const out: PeerSAS = {};
    for (const [id, sas] of this.peerSASMap) {
      out[id] = sas;
    }
    this.onSASUpdate(out);
  }

  private publishCryptoMismatch() {
    const out: CryptoMismatchPeers = {};
    for (const [id, count] of this.decryptFailCounts) {
      if (count >= CRYPTO_MISMATCH_THRESHOLD) {
        out[id] = true;
      }
    }
    this.onCryptoMismatch(out);
  }

  private publishSecureChannelFailures() {
    const out: SecureChannelFailures = {};
    for (const [id, reason] of this.secureChannelFailures) {
      out[id] = reason;
    }
    this.onSecureChannelFailure(out);
  }

  /**
   * Loud-fail teardown for a per-peer secure channel. Replaces the silent
   * fallback paths flagged in the April 2026 audit (M-01) — a peer must
   * never silently downgrade from per-pair encryption to room-wide
   * encryption. Closes the affected RTCPeerConnection, drops every per-pair
   * key, and surfaces a structured error so the UI layer can render the
   * red "secure channel could not be established" overlay.
   */
  private failSecureChannel(peerId: string, reason: SecureChannelFailureReason) {
    if (this.secureChannelFailures.has(peerId) && !this.peers.has(peerId)) {
      return;
    }
    this.secureChannelFailures.set(peerId, reason);
    // Task #529: bump the per-peer generation so any in-flight
    // deferred clear (e.g. scheduled by `clearSecureChannelFailureOnSuccess`
    // for the grace window) becomes a no-op when its timer fires.
    // Failure always wins over a racing pending clear.
    this.secureChannelFailureGen.set(
      peerId,
      (this.secureChannelFailureGen.get(peerId) ?? 0) + 1,
    );
    // Structured diagnostic line so support can distinguish active-attack
    // failures (forged signature / wrong room) from transient transport
    // failures (ICE restart) when reading browser logs from the field.
    // Kept at warn level — these are user-visible, security-relevant
    // events but not unrecoverable JS errors.
    try {
      console.warn("[VOID] secure-channel failed", { peerId, reason });
    } catch {}

    const entry = this.peers.get(peerId);
    if (entry) {
      try { entry.pc.close(); } catch {}
      this.peers.delete(peerId);
    }
    this.clearIceRestartTimer(peerId);
    this.connectionStates.set(peerId, "failed");
    this.peerSessionKeys.delete(peerId);
    this.peerEphemeralKeys.delete(peerId);

    const pending = this.pendingKeyExchange.get(peerId);
    if (pending) {
      this.pendingKeyExchange.delete(peerId);
    }

    this.publish();
    this.publishStates();
    this.publishSecureChannelFailures();
  }

  private recordDecryptFail(peerId: string) {
    const prev = this.decryptFailCounts.get(peerId) ?? 0;
    const next = prev + 1;
    this.decryptFailCounts.set(peerId, next);
    if (next === CRYPTO_MISMATCH_THRESHOLD) {
      this.publishCryptoMismatch();
    }
  }

  private clearDecryptFails(peerId: string) {
    if (this.decryptFailCounts.has(peerId)) {
      const wasMismatch = (this.decryptFailCounts.get(peerId) ?? 0) >= CRYPTO_MISMATCH_THRESHOLD;
      this.decryptFailCounts.delete(peerId);
      if (wasMismatch) {
        this.publishCryptoMismatch();
      }
    }
  }

  private publish() {
    const out: RemoteStreams = {};
    for (const [id, entry] of this.peers) {
      out[id] = entry.stream.getTracks().length > 0 ? entry.stream : null;
    }
    this.onUpdate(out);
  }

  private publishStates() {
    const out: PeerConnectionStates = {};
    for (const [id, state] of this.connectionStates) {
      out[id] = state;
    }
    this.onConnectionStateUpdate(out);
  }

  private async relay(toPeerId: string, payload: RelayPayload) {
    // Post-handshake messages (offer/answer/ice) MUST be encrypted with
    // the per-pair session key. If the session key is missing the channel
    // is not actually secure — never fall back to the room-wide phrase
    // key (the April 2026 audit M-01 silent-downgrade path).
    const sessionKey = this.peerSessionKeys.get(toPeerId);
    if (!sessionKey) {
      this.failSecureChannel(toPeerId, "ecdhe_failed");
      return;
    }
    try {
      // Audit M-01 (Task #461): bind sender peerId into AES-GCM AAD so a
      // captured ciphertext cannot be re-addressed under a different
      // fromPeerId, even by a hostile relay.
      const outPayload = await encryptSignal(sessionKey, payload, this.myPeerId);
      this.socket.emit("relay-signal", {
        code: this.roomCode,
        toPeerId,
        fromPeerId: this.myPeerId,
        payload: outPayload,
      });
    } catch {
      this.failSecureChannel(toPeerId, "decrypt_failed");
    }
  }

  private async relayWithPhraseKey(toPeerId: string, payload: RelayPayload) {
    if (!this.e2eKey) throw new Error("PHRASE_KEY_MISSING");
    // Audit M-01 (Task #461): bind sender peerId into AES-GCM AAD.
    const outPayload = await encryptSignal(this.e2eKey, payload, this.myPeerId);
    this.socket.emit("relay-signal", {
      code: this.roomCode,
      toPeerId,
      fromPeerId: this.myPeerId,
      payload: outPayload,
    });
  }

  private async buildSignedHello(pubKeyStr: string): Promise<SignedHello> {
    const identity = await this.getSigningIdentity();
    const body = await buildBrowserHelloBody({
      ecdhPublicKey: pubKeyStr,
      roomId: this.roomCode,
    });
    return signHello(identity, body);
  }

  private async performKeyExchange(remotePeerId: string): Promise<void> {
    const keyPair = await generateECDHKeyPair();
    const pubKeyStr = await exportECDHPublicKey(keyPair.publicKey);
    this.peerEphemeralKeys.set(remotePeerId, keyPair.privateKey);

    const exchangePromise = new Promise<SignedHello>((resolve) => {
      this.pendingKeyExchange.set(remotePeerId, resolve);
    });

    const signed = await this.buildSignedHello(pubKeyStr);
    await this.relayWithPhraseKey(remotePeerId, {
      type: "key-exchange",
      hello: signed,
    });

    let remoteHello: SignedHello;
    try {
      remoteHello = await Promise.race([
        exchangePromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("KEY_EXCHANGE_TIMEOUT")), KEY_EXCHANGE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      this.pendingKeyExchange.delete(remotePeerId);
    }

    // Verify the signed hello binds the room and we can use its
    // ecdhPublicKey for ECDHE. Throws HelloVerificationError on any
    // mismatch — propagates up to `initiateOffer`, where the
    // loud-fail teardown fires. Task #483: also pass the per-peer
    // seen-nonce cache so a hostile relay cannot replay a captured
    // signed-hello envelope from this peer to re-trigger an ECDHE rekey.
    const helloNonceCache = this.getOrCreateHelloNonceCache(remotePeerId);
    const verified = await verifySignedHello(remoteHello, {
      expectedRoomId: this.roomCode,
      // Task #313: the peer's signed hello must assert the same room type
      // we derived locally from the invite. A mismatch is a loud fail.
      expectedRoomType: this.roomType,
      seenNonces: helloNonceCache,
    });
    this.recordHelloNonce(remotePeerId, helloNonceCache, verified.nonce);

    const remotePubKey = await importECDHPublicKey(verified.ecdhPublicKey);
    const { key: sessionKey, sas } = await deriveSessionKey(keyPair.privateKey, remotePubKey);
    this.installSessionKey(remotePeerId, sessionKey);
    this.peerSASMap.set(remotePeerId, sas);
    const fingerprint = await fingerprintRemoteKey(verified.ecdhPublicKey);
    this.peerKeyFingerprints.set(remotePeerId, fingerprint);
    this.publishSAS();
    this.onRekey(remotePeerId, fingerprint);
  }

  // Task #483: install a freshly-derived session key for this peer.
  // The IV cache is intentionally NOT cleared on rekey: a legitimate
  // ECDHE rekey produces fresh random 96-bit IVs that have negligible
  // probability of colliding with previously-seen IVs, while clearing
  // would re-open the replay window for any phrase-key-encrypted
  // `key-exchange` envelope already observed under the old session.
  private installSessionKey(peerId: string, key: CryptoKey) {
    this.peerSessionKeys.set(peerId, key);
    // Seed the time-based rekey clock from the moment a session key is
    // first installed for this peer, so the first scheduled rotation
    // fires ~REKEY_INTERVAL_MS after the handshake rather than
    // immediately on the next timer tick. A subsequent reconnect /
    // ICE-restart that re-runs the handshake legitimately resets the
    // clock too (the freshly-derived key restarts its own lifetime).
    if (!this.peerRekeyEpoch.has(peerId)) this.peerRekeyEpoch.set(peerId, 0);
    this.peerLastRekeyAt.set(peerId, Date.now());
    // Task #529: the secure channel just entered a Secured state for
    // this peer. If a prior failure entry is still around (e.g. an
    // ICE-restart-driven rekey on the same PC, or a remote-driven
    // `peer-secure-channel-retry` that we processed without going
    // through our own `removePeer` clear path), drop it so the red
    // "could not be established" overlay disappears. Must run BEFORE
    // the grace-window delete below so the helper can observe the
    // still-open grace window and defer the clear to grace expiry
    // per task step 4 — we never tell the user "healthy" while we
    // are still silently dropping stale ciphertext from the prior
    // session.
    this.clearSecureChannelFailureOnSuccess(peerId);
    // Task #229 follow-up: handshake completed → close the post-retry
    // grace window. Any further decrypt failure from now on is a real
    // event and must reach the loud-fail overlay (audit M-01).
    this.peerPostRetryGrace.delete(peerId);
  }

  // ── Time-based PFS rekey (data-channel ratchet) ─────────────────────
  // See the constants block near the top of this file for the full
  // rationale. The smaller peerId initiates (glare-free, reusing
  // `shouldInitiateTo`); the larger peerId only responds.

  private startRekeyTimer() {
    // Browser↔browser ("human") rooms ratchet on a timer.
    if (this.rekeyTimer) return;
    if (typeof setInterval === "undefined") return;
    this.rekeyTimer = setInterval(() => {
      void this.runScheduledRekeys();
    }, REKEY_CHECK_INTERVAL_MS);
  }

  private async runScheduledRekeys() {
    const now = Date.now();
    // Snapshot the peer set: a rekey may mutate `peerLastRekeyAt` as we
    // iterate, and we never want to rekey a peer twice in one tick.
    for (const peerId of [...this.peerSessionKeys.keys()]) {
      // Only the smaller peerId initiates; the larger one waits for the
      // offer. This is the same deterministic glare rule the SDP
      // offer/answer uses, so exactly one side drives each rotation.
      if (!this.shouldInitiateTo(peerId)) continue;
      // A pending rotation blocks the next one until the answer arrives or the
      // transport declares closure (onclose clears pending). This is by design:
      // the rekey channel is reliable+ordered, so we wait for in-flight answers
      // rather than racing a timeout that could discard our ephemeral key.
      if (this.peerPendingRekey.has(peerId)) continue;
      if (this.secureChannelFailures.has(peerId)) continue;
      const channel = this.peerRekeyChannels.get(peerId);
      if (!channel || channel.readyState !== "open") continue;
      const last = this.peerLastRekeyAt.get(peerId) ?? 0;
      if (now - last < REKEY_INTERVAL_MS) continue;
      try {
        await this.initiateRekey(peerId);
      } catch {
        // A rekey is strictly best-effort: a failed rotation keeps the
        // current session key intact and the next tick retries. We
        // never tear down a live, verified call over a missed rekey.
      }
    }
  }

  private async initiateRekey(peerId: string) {
    const oldKey = this.peerSessionKeys.get(peerId);
    const channel = this.peerRekeyChannels.get(peerId);
    if (!oldKey || !channel || channel.readyState !== "open") return;
    const keyPair = await generateECDHKeyPair();
    const pub = await exportECDHPublicKey(keyPair.publicKey);
    const epoch = (this.peerRekeyEpoch.get(peerId) ?? 0) + 1;
    const message: RekeyChannelMessage = { t: "o", pub, epoch };
    // Encrypt the offer under the CURRENT session key — continuity
    // binding. Only the verified peer can read it. `aad` is our own
    // peerId, matching the relay-signal convention (decrypted with the
    // remote peerId on the far side).
    const ciphertext = await encryptSignal(oldKey, message, this.myPeerId);
    // Reset the clock now so a stalled exchange does not re-fire every
    // tick (the scheduler also skips while a pending entry exists).
    this.peerLastRekeyAt.set(peerId, Date.now());
    // Retain the ephemeral private key until the answer arrives or the
    // peer is torn down. We deliberately do NOT arm a short "answer
    // timeout" that discards it: the responder installs its new key the
    // moment it sends the answer, so if we threw our key away on a
    // timeout the responder's reliably-delivered (but slow) answer would
    // arrive with nothing to complete against — silently desyncing the
    // pair (responder on the new key, us stuck on the old one) and
    // breaking the silent-rotation guarantee. The `void.rekey` channel is
    // reliable + ordered, so the answer is always delivered eventually; a
    // genuinely dead channel fires `onclose`, which clears this entry.
    this.peerPendingRekey.set(peerId, {
      privateKey: keyPair.privateKey,
      epoch,
    });
    try {
      channel.send(ciphertext);
    } catch {
      this.peerPendingRekey.delete(peerId);
    }
  }

  private attachRekeyChannel(peerId: string, channel: RTCDataChannel) {
    // Replace any stale channel reference (e.g. a renegotiation that
    // re-created the peer connection) and close the old one.
    const existing = this.peerRekeyChannels.get(peerId);
    if (existing && existing !== channel) {
      try { existing.close(); } catch { /* ignore */ }
    }
    this.peerRekeyChannels.set(peerId, channel);
    channel.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      void this.handleRekeyMessage(peerId, ev.data);
    };
    channel.onclose = () => {
      if (this.peerRekeyChannels.get(peerId) === channel) {
        this.peerRekeyChannels.delete(peerId);
      }
      // A closed channel will never deliver a pending answer; drop the
      // retained ephemeral key so a post-reconnect handshake starts clean
      // and the scheduler is not blocked by a dead in-flight rekey.
      this.peerPendingRekey.delete(peerId);
    };
  }

  private async handleRekeyMessage(peerId: string, raw: string) {
    const oldKey = this.peerSessionKeys.get(peerId);
    // No verified session key → nothing to bind continuity to. Drop.
    if (!oldKey) return;
    if (this.secureChannelFailures.has(peerId)) return;
    // Defensive inbound size cap, mirroring the relay-signal guard.
    if (new TextEncoder().encode(raw).byteLength > RELAY_SIGNAL_MAX_PAYLOAD_BYTES) {
      return;
    }
    let message: RekeyChannelMessage;
    try {
      // CONTINUITY BINDING — the entire security argument for Option A:
      // a rotation payload MUST decrypt under the current SAS-verified
      // session key. Only the genuine, verified peer holds that key, so
      // a phrase-knowing signaling relay can neither read nor forge a
      // rotation. A payload we cannot decrypt is silently dropped — it
      // is NOT a `decrypt_failed` event (the data channel is a separate
      // transport from relay-signal and carries no attacker-probe
      // surface: an attacker who could write valid ciphertext here would
      // already hold the session key).
      const decoded = (await decryptSignal(oldKey, raw, peerId)) as RekeyChannelMessage;
      // SECURITY (cross-transport replay): the `void.rekey` channel and
      // the relay-signal path share this peer's session key AND its
      // AES-GCM IV space, but keep SEPARATE replay caches. The `t`
      // discriminator below is what stops a ciphertext captured on one
      // transport from being accepted on the other — a relay envelope
      // replayed here fails the `"o"`/`"a"` check, and a rekey payload
      // replayed onto the relay path fails that path's envelope schema.
      // Do NOT widen these message types to overlap the relay envelope
      // without first adding a shared cross-transport replay guard.
      if (
        !decoded ||
        (decoded.t !== "o" && decoded.t !== "a") ||
        typeof decoded.pub !== "string" ||
        typeof decoded.epoch !== "number" ||
        !Number.isInteger(decoded.epoch)
      ) {
        return;
      }
      message = decoded;
    } catch {
      return;
    }
    if (message.t === "o") {
      await this.respondToRekey(peerId, oldKey, message);
    } else {
      await this.completeRekey(peerId, message);
    }
  }

  private async respondToRekey(
    peerId: string,
    oldKey: CryptoKey,
    message: RekeyChannelMessage,
  ) {
    // Monotonic epoch guard: reject a replayed or stale offer. The
    // initiator increments the epoch on every fresh offer, so anything
    // at or below the last completed epoch is a duplicate.
    const lastEpoch = this.peerRekeyEpoch.get(peerId) ?? 0;
    if (message.epoch <= lastEpoch) return;
    const channel = this.peerRekeyChannels.get(peerId);
    if (!channel || channel.readyState !== "open") return;
    const keyPair = await generateECDHKeyPair();
    const ourPub = await exportECDHPublicKey(keyPair.publicKey);
    const remotePub = await importECDHPublicKey(message.pub);
    const { key: newKey, sas } = await deriveSessionKey(
      keyPair.privateKey,
      remotePub,
    );
    const fingerprint = await fingerprintRemoteKey(message.pub);
    // Send the answer encrypted under the OLD key BEFORE swapping, so
    // the initiator (still on the old key until it sees this answer) can
    // decrypt it. After this point both sides install the new key.
    const answer: RekeyChannelMessage = { t: "a", pub: ourPub, epoch: message.epoch };
    const ciphertext = await encryptSignal(oldKey, answer, this.myPeerId);
    try {
      channel.send(ciphertext);
    } catch {
      // Could not deliver the answer → keep the old session intact.
      return;
    }
    this.installRekeyedSession(peerId, newKey, sas, fingerprint, message.epoch);
  }

  private async completeRekey(peerId: string, message: RekeyChannelMessage) {
    const pending = this.peerPendingRekey.get(peerId);
    // Only accept an answer that matches the offer we are waiting on.
    if (!pending || pending.epoch !== message.epoch) return;
    this.peerPendingRekey.delete(peerId);
    const remotePub = await importECDHPublicKey(message.pub);
    const { key: newKey, sas } = await deriveSessionKey(
      pending.privateKey,
      remotePub,
    );
    const fingerprint = await fingerprintRemoteKey(message.pub);
    this.installRekeyedSession(peerId, newKey, sas, fingerprint, message.epoch);
  }

  private installRekeyedSession(
    peerId: string,
    key: CryptoKey,
    sas: [string, string],
    fingerprint: string,
    epoch: number,
  ) {
    // Cover the brief window where the two sides momentarily hold
    // different session keys: an in-flight relay-signal straggler (e.g.
    // a trickled ICE candidate) encrypted under the old key must be
    // silently dropped, not raised as a `decrypt_failed` overlay. The
    // post-retry grace window is exactly this "drop stale old-key
    // ciphertext" mechanism, so we reuse it.
    this.markPostRetryGrace(peerId);
    this.peerSessionKeys.set(peerId, key);
    this.peerSASMap.set(peerId, sas);
    this.peerKeyFingerprints.set(peerId, fingerprint);
    this.peerRekeyEpoch.set(peerId, epoch);
    this.peerLastRekeyAt.set(peerId, Date.now());
    this.publishSAS();
    // SILENT: continuity is cryptographically proven (the rotation rode
    // the verified session key), so we do NOT fire the loud `onRekey`
    // that arms the RE-VERIFY banner. The UI re-anchors any prior
    // "verified" verdict to the fresh SAS and shows a subtle,
    // non-actionable "keys rotated" indicator.
    this.onSilentRekey(peerId, fingerprint, sas);
  }

  /**
   * Task #529: single clear-on-success helper used by every code path
   * that observes a previously-failed pairwise secure channel
   * transitioning back to a healthy, verified state — `installSessionKey`
   * (Secured), and `onConnectionStateChange === "connected"` after a
   * prior `failed`. (The `retrySecureChannel` user path is covered
   * transitively: it calls `removePeer` which drops the entry, then
   * the fresh handshake re-runs `installSessionKey`.)
   *
   * Rules (must remain explicit here, not implicit in event ordering):
   *
   *   - **Failure always wins.** We capture the per-peer failure
   *     generation at observation time; if another `failSecureChannel`
   *     write bumps the generation before we run, the clear becomes a
   *     no-op. This guarantees a legitimate second failure that races
   *     a pending clear is not swallowed.
   *
   *   - **Grace-window deferral.** If `POST_RETRY_GRACE_MS` is still
   *     open at observation time, the clear fires when the window
   *     closes — never during it. While the window is open we are
   *     still silently dropping stale ciphertexts from the prior
   *     session; flipping the overlay to "healthy" mid-window would
   *     lie to the user.
   *
   *   - **No suppression of new failures.** This helper never
   *     installs a debounce or hold-down: a subsequent
   *     `failSecureChannel` call is free to repopulate the entry
   *     with the new reason at any time.
   */
  private clearSecureChannelFailureOnSuccess(peerId: string) {
    if (!this.secureChannelFailures.has(peerId)) return;
    const observedGen = this.secureChannelFailureGen.get(peerId) ?? 0;
    const expires = this.peerPostRetryGrace.get(peerId);
    const now = Date.now();
    const wait =
      expires !== undefined && expires > now ? expires - now : 0;

    const finish = () => {
      if (!this.secureChannelFailures.has(peerId)) return;
      const currentGen = this.secureChannelFailureGen.get(peerId) ?? 0;
      if (currentGen !== observedGen) return;
      this.secureChannelFailures.delete(peerId);
      this.secureChannelFailureGen.delete(peerId);
      this.publishSecureChannelFailures();
    };

    if (wait > 0) {
      setTimeout(finish, wait);
    } else {
      finish();
    }
  }

  /**
   * Task #229 follow-up: open the post-retry grace window for `peerId`.
   * Called by `retrySecureChannel` locally and by the
   * `peer-secure-channel-retry` socket handler on the remote side, before
   * `removePeer`, so that in-flight ciphertext encrypted under the
   * about-to-be-deleted session key can be silently drained instead of
   * tripping `failSecureChannel("decrypt_failed")` and re-raising the
   * overlay the user just dismissed.
   */
  markPostRetryGrace(peerId: string) {
    this.peerPostRetryGrace.set(
      peerId,
      Date.now() + WebRTCManager.POST_RETRY_GRACE_MS,
    );
  }

  private inPostRetryGrace(peerId: string): boolean {
    const expires = this.peerPostRetryGrace.get(peerId);
    if (expires === undefined) return false;
    if (Date.now() >= expires) {
      this.peerPostRetryGrace.delete(peerId);
      return false;
    }
    return true;
  }

  private getOrCreateHelloNonceCache(peerId: string): Set<string> {
    let cache = this.peerSeenHelloNonces.get(peerId);
    if (!cache) {
      cache = new Set<string>();
      this.peerSeenHelloNonces.set(peerId, cache);
    }
    return cache;
  }

  // Task #483: record a freshly-verified hello nonce in the per-peer
  // cache. Overflow is treated as a loud-fail event (caller routes to
  // `failSecureChannel("hello_invalid")`) rather than FIFO-evicting the
  // oldest entries — eviction would re-open the replay window inside
  // the timestamp-skew envelope for any nonce that aged out.
  private recordHelloNonce(peerId: string, cache: Set<string>, nonce: string) {
    if (cache.size >= MAX_SEEN_REPLAY_ENTRIES) {
      throw new HelloVerificationError("nonce_cache_overflow");
    }
    cache.add(nonce);
  }

  // Task #483: pull the AES-GCM IV prefix out of a base64url relay-signal
  // payload without doing any crypto work. Returns the base64url-encoded
  // first 12 bytes (`SIGNAL_IV_BYTES`) of the wire payload, or `null` if
  // the payload is too short to contain an IV at all (in which case
  // `decryptSignal` would fail anyway, and we let the existing
  // loud-fail path handle it instead of double-rejecting here).
  private extractIvKey(rawPayload: string): string | null {
    let decoded: Uint8Array;
    try {
      decoded = b64uDecode(rawPayload);
    } catch {
      return null;
    }
    if (decoded.length < SIGNAL_IV_BYTES) return null;
    return b64uEncode(decoded.subarray(0, SIGNAL_IV_BYTES));
  }

  private hasSeenIv(peerId: string, ivKey: string): boolean {
    const cache = this.peerSeenIvs.get(peerId);
    return cache ? cache.has(ivKey) : false;
  }

  // Task #483: record a freshly-decrypted envelope's IV. Returns
  // `false` on overflow so the caller can route to loud-fail without
  // racing the payload-typed handler (we have already authenticated
  // the envelope by this point — overflow on a successful decrypt is
  // an attack signal, not a routine ceiling).
  private recordSeenIv(peerId: string, ivKey: string): boolean {
    let cache = this.peerSeenIvs.get(peerId);
    if (!cache) {
      cache = new Set<string>();
      this.peerSeenIvs.set(peerId, cache);
    }
    if (cache.size >= MAX_SEEN_REPLAY_ENTRIES) {
      return false;
    }
    cache.add(ivKey);
    return true;
  }

  // ICE restart always app-level rekeys before pc.createOffer({iceRestart}),
  // so a fresh ECDH keypair is generated and the fingerprint differs by
  // construction. The UI banner is gated on the fingerprint diff, not on
  // the rekey *attempt*.

  private async handleKeyExchange(fromPeerId: string, remoteHello: SignedHello) {
    const pending = this.pendingKeyExchange.get(fromPeerId);
    if (pending) {
      this.pendingKeyExchange.delete(fromPeerId);
      pending(remoteHello);
      return;
    }

    if (!this.e2eKey) {
      this.failSecureChannel(fromPeerId, "ecdhe_failed");
      return;
    }

    let verified;
    const helloNonceCache = this.getOrCreateHelloNonceCache(fromPeerId);
    try {
      verified = await verifySignedHello(remoteHello, {
        expectedRoomId: this.roomCode,
        // Task #313: cross-check the peer's asserted room type against
        // the type we derived locally from the invite (loud fail on
        // mismatch — `hello_invalid`).
        expectedRoomType: this.roomType,
        seenNonces: helloNonceCache,
      });
      this.recordHelloNonce(fromPeerId, helloNonceCache, verified.nonce);
    } catch (err) {
      const reason = err instanceof HelloVerificationError ? "hello_invalid" : "ecdhe_failed";
      this.failSecureChannel(fromPeerId, reason);
      return;
    }

    try {
      const keyPair = await generateECDHKeyPair();
      const ourPubKeyStr = await exportECDHPublicKey(keyPair.publicKey);
      this.peerEphemeralKeys.set(fromPeerId, keyPair.privateKey);

      const remotePubKey = await importECDHPublicKey(verified.ecdhPublicKey);
      const { key: sessionKey, sas } = await deriveSessionKey(keyPair.privateKey, remotePubKey);
      this.installSessionKey(fromPeerId, sessionKey);
      this.peerSASMap.set(fromPeerId, sas);
      const fingerprint = await fingerprintRemoteKey(verified.ecdhPublicKey);
      this.peerKeyFingerprints.set(fromPeerId, fingerprint);
      this.publishSAS();
      this.onRekey(fromPeerId, fingerprint);

      const signed = await this.buildSignedHello(ourPubKeyStr);
      await this.relayWithPhraseKey(fromPeerId, {
        type: "key-exchange",
        hello: signed,
      });
    } catch {
      this.failSecureChannel(fromPeerId, "ecdhe_failed");
    }
  }

  // ICE leak audit: see webrtcPerPeer.buildPC for the policy comment.
  // The manager just hands the per-peer factory its current iceServers
  // + iceTransportPolicy and wires the per-peer state hooks.
  private buildPC(remotePeerId: string): RTCPeerConnection {
    return buildPCFn(
      {
        iceServers: this.iceServers,
        iceTransportPolicy: this.iceTransportPolicy,
        localStream: this.localStream,
        overrideVideoTrack: this.overrideVideoTrack,
        onPeerConnectionCreated: (peerId, pc) => {
          this.onPeerConnectionCreated(peerId, pc);
          this.connectionStates.set(peerId, "new");
          this.publishStates();
        },
        registerPeer: (peerId, pc, remoteStream) => {
          this.peers.set(peerId, { pc, stream: remoteStream });
        },
        onIceCandidate: (peerId, candidate) => {
          this.relay(peerId, { type: "ice", candidate });
        },
        attachDataChannel: (peerId, channel) => {
          // Only known labels are recognized — a future feature that
          // wants its own data channel must extend this dispatch and the
          // docs/signaling-envelope-audit.md Table 2 row at the same
          // time.
          if (channel.label === "drop") {
            this.attachDropChannel(peerId, channel);
          } else if (channel.label === REKEY_CHANNEL_LABEL) {
            // The offerer creates the `void.rekey` channel; the answerer
            // accepts it here. Acceptance is label-driven and not gated
            // on `roomType` — only the offerer decides whether to open
            // it (see `initiateOffer`).
            this.attachRekeyChannel(peerId, channel);
          } else if (channel.label === MEDIA_STATE_CHANNEL_LABEL) {
            // Task #868: the offerer creates the `void.media-state`
            // channel; the answerer accepts it here. Camera/mic/voice/
            // onion state flows P2P over it instead of via the signaling
            // server.
            this.attachMediaStateChannel(peerId, channel);
          }
        },
        onTrack: (peerId, track) => {
          const entry = this.peers.get(peerId);
          if (!entry) return;
          entry.stream.addTrack(track);
          this.publish();
        },
        onConnectionStateChange: (peerId, pc) => {
          // Task #529: capture the prior state BEFORE we overwrite it so
          // the "connected after a prior failed" branch below can decide
          // whether to run the clear-on-success helper. A bare
          // `connectionState === "connected"` is not enough on its own:
          // we only want to dismiss the red overlay when the channel
          // genuinely recovered from a failure, not on the very first
          // healthy connect of a fresh PC where no failure was ever
          // raised in the first place.
          const prevState = this.connectionStates.get(peerId);
          this.connectionStates.set(peerId, pc.connectionState);
          this.publishStates();

          if (pc.connectionState === "connected") {
            this.clearIceRestartTimer(peerId);
            applyVideoConstraints(pc);
            this.peerEphemeralKeys.delete(peerId);
            // Task #529: defense-in-depth alongside the
            // `installSessionKey` call site. If the PC recovers from a
            // `failed` state without a fresh key-exchange (e.g. ICE
            // restart on the same PC where the existing session key is
            // still valid), `installSessionKey` won't fire — but the
            // overlay must still come down. The helper's
            // generation/grace-window invariants keep this safe even
            // when both call sites observe the same recovery.
            if (prevState === "failed") {
              this.clearSecureChannelFailureOnSuccess(peerId);
            }
          } else if (pc.connectionState === "disconnected") {
            this.scheduleIceRestart(peerId, pc);
          } else if (pc.connectionState === "failed") {
            this.clearIceRestartTimer(peerId);
            this.attemptIceRestart(peerId, pc);
          } else if (pc.connectionState === "closed") {
            this.clearIceRestartTimer(peerId);
            this.peers.delete(peerId);
            this.publish();
          }
        },
      },
      remotePeerId,
    );
  }

  /**
   * True iff the local peer is the entitled initiator for this pair.
   * The convention — already used by `reinitializeAllPeers` (see the
   * "peers that sort after mine" comment near the call site) and the
   * relay-flip handshake in `useRoomConnection.ts` (`p > peerIdRef.current`)
   * — is that the peer with the lexicographically SMALLER peerId
   * initiates the ECDHE handshake and SDP offer/answer; the larger
   * side waits and responds. Without this rule, two peers that join
   * roughly simultaneously (both end up with each other in
   * `result.peers`) both call `initiateOffer` → two parallel ECDHE
   * rounds → each side keeps a different keypair's output →
   * mismatched session keys → mismatched SAS ("duet words") → all
   * subsequent `relay()` calls fail with `decrypt_failed`. The user-
   * visible symptom is the "SECURE HANDSHAKE DIDN'T COMPLETE / KEY
   * EXCHANGE FAILED" overlay flapping between the two peers.
   */
  shouldInitiateTo(remotePeerId: string): boolean {
    return this.myPeerId < remotePeerId;
  }

  async initiateOffer(remotePeerId: string) {
    // Glare avoidance: only the smaller peerId initiates. The larger
    // side waits for the inbound key-exchange and runs the responder
    // path in `handleKeyExchange`. Callers can fire this
    // unconditionally — the manager filters.
    if (!this.shouldInitiateTo(remotePeerId)) {
      return;
    }
    // Idempotency: a second initiate while the first is still in
    // flight (e.g. retry-event arriving at the smaller peer who just
    // clicked retry locally) would generate a fresh ECDH keypair,
    // overwrite the pending resolver, and leave the first awaiter to
    // time out — producing the same multi-round race the glare check
    // above is designed to prevent. Skip when a handshake is already
    // pending or a session key is already installed for this peer.
    if (this.pendingKeyExchange.has(remotePeerId)) {
      return;
    }
    if (this.peerSessionKeys.has(remotePeerId)) {
      return;
    }
    if (!this.e2eKey) {
      this.failSecureChannel(remotePeerId, "ecdhe_failed");
      return;
    }
    try {
      await this.performKeyExchange(remotePeerId);
    } catch (err) {
      // Loud fail: never silently downgrade to room-wide phrase key when
      // ECDHE or hello verification fails. Tear the peer connection down
      // so the UI surfaces the unmistakable "secure channel could not be
      // established" overlay.
      const reason: SecureChannelFailureReason =
        err instanceof HelloVerificationError ? "hello_invalid" : "ecdhe_failed";
      this.failSecureChannel(remotePeerId, reason);
      return;
    }

    const pc = this.buildPC(remotePeerId);
    // Task #443: open the outbound DROP data channel on the offerer side
    // BEFORE createOffer so it appears in the initial SDP. The answerer
    // accepts via pc.ondatachannel (wired in buildPC). Default options
    // (no second argument) give us ordered + reliable delivery, which is
    // what the "atomically overwrite the slot for everyone" contract
    // needs — out-of-order or dropped fragments would silently corrupt
    // the visible text.
    try {
      this.attachDropChannel(remotePeerId, pc.createDataChannel("drop"));
    } catch {
      // A DataChannel-open failure must never block the call itself —
      // the slot will simply stay empty for this peer until reconnect.
    }
    // Open the outbound `void.rekey` control channel on the offerer side
    // too (browser↔browser rooms only). The answerer accepts it via
    // pc.ondatachannel. Ordered + reliable (default options) so a
    // rekey-offer/answer pair is never reordered or dropped mid-rotation.
    // The label is spelled as a string literal here (not REKEY_CHANNEL_LABEL)
    // so check-signaling-envelope.mjs — which scans for literal
    // createDataChannel("…") callsites — sees it and enforces the audit
    // whitelist + Table 2 row. It must stay byte-equal to REKEY_CHANNEL_LABEL.
    try {
      this.attachRekeyChannel(remotePeerId, pc.createDataChannel("void.rekey"));
    } catch {
      // Best-effort: a failed channel-open just means no timed rekey
      // for this peer until the next reconnect.
    }
    // Task #868: open the outbound `void.media-state` channel on the
    // offerer side; the answerer accepts it via pc.ondatachannel. Ordered
    // + reliable (default options) so a sequence of toggle snapshots is
    // never reordered. The label is a string literal here (not
    // MEDIA_STATE_CHANNEL_LABEL) so check-signaling-envelope.mjs sees it
    // and enforces the audit whitelist + Table 2 row; it must stay
    // byte-equal to MEDIA_STATE_CHANNEL_LABEL.
    try {
      this.attachMediaStateChannel(remotePeerId, pc.createDataChannel("void.media-state"));
    } catch {
      // Best-effort: a failed channel-open just means this peer won't
      // receive our media-state until the next reconnect.
    }
    try {
      const offer = await pc.createOffer();
      const clampedOffer = { ...offer, sdp: clampOpusBitrate(offer.sdp ?? "") };
      await pc.setLocalDescription(clampedOffer);
      await this.relay(remotePeerId, { type: "offer", sdp: pc.localDescription! });
    } catch {
      this.failSecureChannel(remotePeerId, "ecdhe_failed");
    }
  }

  // ─── Shared DROP slot (Task #443) ───────────────────────────────────
  // The DROP slot is a single UTF-8 string ≤2 KB that any participant
  // can atomically overwrite for everyone. It travels per-peer over a
  // dedicated `"drop"` RTCDataChannel (DTLS-over-SCTP, encrypted
  // browser-to-browser on the same DTLS association as media). There is
  // no history, no per-peer view, no late-joiner replay. We send the
  // string raw and rely on `dropSanitize.ts` to keep both ends honest.
  private attachDropChannel(peerId: string, channel: RTCDataChannel) {
    const list = this.peerDropChannels.get(peerId) ?? [];
    list.push(channel);
    this.peerDropChannels.set(peerId, list);
    channel.onmessage = (ev) => {
      // Browsers can deliver string OR ArrayBuffer depending on
      // binaryType — DROP is always sent as a string, so reject anything
      // else loudly (by ignoring) rather than guessing at decoding.
      if (typeof ev.data !== "string") return;
      // Hard cap on the receive side too: a peer running a modified
      // client cannot make us render more than the documented budget.
      const trimmed = ev.data.length > 4096 ? ev.data.slice(0, 4096) : ev.data;
      // Per-sender rate cap: coalesce a flood into at most one render per
      // window, but always render the LAST value in a burst (trailing
      // edge). Sanitize/size limits above are untouched.
      let throttle = this.peerDropThrottles.get(peerId);
      if (!throttle) {
        throttle = createDropThrottle((text) => this.onDropReceived(text));
        this.peerDropThrottles.set(peerId, throttle);
      }
      throttle.push(trimmed);
    };
    channel.onclose = () => {
      const cur = this.peerDropChannels.get(peerId);
      if (!cur) return;
      const next = cur.filter((c) => c !== channel);
      if (next.length === 0) this.peerDropChannels.delete(peerId);
      else this.peerDropChannels.set(peerId, next);
    };
  }

  /**
   * Broadcast the current DROP slot value to every connected peer.
   * Atomically overwrites the previous value on every receiver. An
   * empty string clears the slot. Callers are responsible for
   * sanitizing the text first (see `dropSanitize.ts`) — this method
   * does not re-sanitize because the page-level send path already did.
   */
  sendDrop(text: string) {
    // Self-throttle outbound so a fast-submitting UI can't make this
    // client the heckler. Leading edge keeps a single normal edit
    // instant; the trailing edge guarantees the final value of a burst
    // is the one that actually goes out on the wire.
    this.dropSendThrottle.push(text);
  }

  /** The actual fan-out, invoked by the outbound throttle. */
  private broadcastDrop(text: string) {
    for (const channels of this.peerDropChannels.values()) {
      for (const ch of channels) {
        if (ch.readyState !== "open") continue;
        try {
          ch.send(text);
        } catch {
          // A single failed send must not block delivery to the other
          // peers — the slot will heal on the next sendDrop call.
        }
      }
    }
  }

  // ─── Per-peer media-state (Task #868) ───────────────────────────────
  // camOff / micMuted / voiceMode / viaOnion travel peer-to-peer over a
  // dedicated `void.media-state` RTCDataChannel (DTLS-over-SCTP), not via
  // the signaling server. The server can no longer relay or read these
  // contents. On channel open we replay the cached local snapshot so a
  // late joiner converges to our current state.
  private attachMediaStateChannel(peerId: string, channel: RTCDataChannel) {
    // Replace any stale channel reference (e.g. a renegotiation that
    // re-created the peer connection) and close the old one.
    const existing = this.peerMediaStateChannels.get(peerId);
    if (existing && existing !== channel) {
      try { existing.close(); } catch { /* ignore */ }
    }
    this.peerMediaStateChannels.set(peerId, channel);
    // Late-joiner convergence: the moment THIS peer's channel is usable,
    // push our current snapshot so they render the correct mute/cam/voice
    // state even though they joined after our last toggle. If the channel
    // is already open (some browsers fire onopen before this handler is
    // wired), send immediately as well.
    const sendCurrent = () => {
      if (!this.localMediaState) return;
      if (channel.readyState !== "open") return;
      try {
        channel.send(JSON.stringify(this.localMediaState));
      } catch {
        // Best-effort — the next setLocalMediaState() broadcast will
        // re-attempt delivery to this peer.
      }
    };
    channel.onopen = sendCurrent;
    if (channel.readyState === "open") sendCurrent();
    channel.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      // Defensive inbound size cap — a peer running a modified client
      // cannot make us parse an oversized blob.
      if (new TextEncoder().encode(ev.data).byteLength > MEDIA_STATE_MAX_PAYLOAD_BYTES) {
        return;
      }
      const parsed = parseMediaStateMessage(ev.data);
      if (!parsed) return;
      this.onMediaStateReceived(peerId, parsed);
    };
    channel.onclose = () => {
      if (this.peerMediaStateChannels.get(peerId) === channel) {
        this.peerMediaStateChannels.delete(peerId);
      }
    };
  }

  /**
   * Publish the local media-state snapshot to every connected peer and
   * cache it so a peer whose channel opens later (late joiner) is
   * replayed the current value on open. Callers invoke this whenever any
   * of camOff / micMuted / voiceMode / viaOnion changes (mute toggle,
   * cam toggle, mask apply, screen-share start/stop) and once on
   * join/reconnect to seed the snapshot.
   */
  setLocalMediaState(state: PeerMediaStateMessage) {
    this.localMediaState = state;
    const serialized = JSON.stringify(state);
    for (const ch of this.peerMediaStateChannels.values()) {
      if (ch.readyState !== "open") continue;
      try {
        ch.send(serialized);
      } catch {
        // A single failed send must not block delivery to other peers —
        // the cached snapshot is replayed when that peer's channel reopens.
      }
    }
  }

  hasPeer(peerId: string): boolean {
    return this.peers.has(peerId);
  }

  hasSecureChannelFailure(peerId: string): boolean {
    return this.secureChannelFailures.has(peerId);
  }

  /**
   * User-initiated recovery from a per-peer secure-channel failure
   * (Task #182). Tears down all per-pair state for `peerId` (which
   * also clears the `secureChannelFailures` entry and republishes,
   * dismissing the overlay) and reinitiates the ECDHE handshake by
   * calling `initiateOffer`. This is intentionally one-sided: for
   * symmetric transient failures (e.g. ice_restart_failed) the new
   * offer reaches the remote peer over the phrase-key channel and
   * both sides re-derive a fresh session key. For attack-shaped
   * failures (`hello_invalid`) the handshake will fail again and
   * the overlay will reappear with the same reason — which is the
   * correct outcome.
   */
  retrySecureChannel(peerId: string) {
    // Task #229: tell the remote peer to drop its failure entry for us so
    // that the inbound ECDHE offer is not silently short-circuited on their
    // side. We emit before tearing down local state so our peerId is still
    // available in the socket payload; the server validates room membership
    // and forwards the event only to the target.
    this.socket.emit("peer-secure-channel-retry", {
      code: this.roomCode,
      toPeerId: peerId,
      fromPeerId: this.myPeerId,
    });
    // Task #229 follow-up: open the grace window BEFORE removePeer so any
    // ciphertext from the remote that arrives between our teardown and the
    // new key-exchange completing is silently dropped (it was encrypted
    // under a session key we just deleted, and we'd otherwise loud-fail
    // with `decrypt_failed` and snap the user back into the overlay).
    this.markPostRetryGrace(peerId);
    this.removePeer(peerId);
    // Refactor 2 (task #448) fix #1: the previous `void this.initiateOffer(peerId)`
    // swallowed any rejection from the renegotiation path — if the
    // fresh ECDHE failed the peer would silently never reconnect and
    // the UI would be stuck on a stale "connecting" state. We now
    // await and route any failure through the existing
    // `failSecureChannel("ice_restart_failed")` overlay so the user
    // sees the standard "WE LOST THE CONNECTION AND COULDN'T RECOVER
    // IT — RETRY USUALLY HELPS" red banner instead of an indefinite
    // spinner.
    void this.initiateOffer(peerId).catch((err) => {
      try {
        console.warn("[VOID] retrySecureChannel reconnect failed", {
          peerId,
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {}
      this.failSecureChannel(peerId, "ice_restart_failed");
    });
  }

  private async handleRelay({
    fromPeerId,
    payload: rawPayload,
  }: {
    fromPeerId: string;
    payload: unknown;
  }) {
    if (this.secureChannelFailures.has(fromPeerId)) {
      // Once a secure channel has failed for this peer we never speak to
      // it again with phrase-key fallback. The user must verify the phrase
      // or rejoin to reset state.
      return;
    }

    // Audit L-03 (Task #461): mirror the server's 64 KiB inbound cap
    // client-side, before decrypt. If a future deployment runs an alternate
    // signaling server that skips the cap, this keeps the client's memory
    // bound the same. JSON.parse happens after AEAD auth in decryptSignal,
    // so this is purely a memory-pressure guard, not an auth boundary.
    // Mirrors the server's byte-length accounting (utf8) — TextEncoder is
    // browser-native and avoids the UTF-16 code-unit under-count that
    // `.length` would produce for multibyte input.
    if (typeof rawPayload === "string") {
      const byteLen = new TextEncoder().encode(rawPayload).byteLength;
      if (byteLen > RELAY_SIGNAL_MAX_PAYLOAD_BYTES) return;
    }

    // Task #483: same-sender replay defense for the AES-GCM envelope
    // itself. The IV is the first 12 bytes of every relay-signal
    // ciphertext (`signalCrypto.ts` invariant) and is, by construction,
    // unique per `(key, plaintext)` for any honest sender. A hostile
    // signaling server that replays a captured `(IV, ciphertext)` pair
    // back at the recipient is, definitionally, re-using an IV under
    // the same installed key — so we can cheaply detect and reject
    // every replayed `offer` / `answer` / `ice` / `key-exchange`
    // envelope at the wire boundary, before handing it to either
    // `decryptSignal` (which would succeed against AES-GCM) or to the
    // payload-typed handler (where the only thing standing between
    // the replay and observable effect was incidental browser-level
    // state — `RTCPeerConnection`'s signaling-state machine for SDP,
    // ICE de-duplication for candidates, the renegotiation tolerance
    // for `key-exchange`).
    let ivKey: string | null = null;
    if (typeof rawPayload === "string") {
      ivKey = this.extractIvKey(rawPayload);
      if (ivKey !== null && this.hasSeenIv(fromPeerId, ivKey)) {
        this.recordDecryptFail(fromPeerId);
        this.failSecureChannel(fromPeerId, "decrypt_failed");
        return;
      }
    }

    let payload: RelayPayload;
    if (typeof rawPayload === "string") {
      const sessionKey = this.peerSessionKeys.get(fromPeerId);
      if (sessionKey) {
        // Post-handshake messages decrypt with the session key.
        // Narrow exception: a `key-exchange` envelope from the peer
        // (e.g. ICE-restart rekey) arrives phrase-key encrypted while
        // the old session key is still installed — try the phrase key
        // as a typed fallback for that type only. Anything else
        // remains a hard `decrypt_failed` (audit M-01).
        let decrypted: RelayPayload | null = null;
        try {
          decrypted = (await decryptSignal(sessionKey, rawPayload, fromPeerId)) as RelayPayload;
        } catch {
          if (this.e2eKey) {
            try {
              const candidate = (await decryptSignal(this.e2eKey, rawPayload, fromPeerId)) as RelayPayload;
              if (candidate.type === "key-exchange") {
                decrypted = candidate;
              }
            } catch {
              // fall through to the loud-fail below
            }
          }
        }
        if (!decrypted) {
          // Task #229 follow-up: during the post-retry grace window this
          // ciphertext is almost certainly an in-flight straggler from
          // before the user clicked retry, encrypted under the previous
          // (now-deleted) session key. Drop it silently instead of
          // re-raising the overlay the user just dismissed.
          if (this.inPostRetryGrace(fromPeerId)) {
            return;
          }
          this.recordDecryptFail(fromPeerId);
          this.failSecureChannel(fromPeerId, "decrypt_failed");
          return;
        }
        // Task #483: record the now-authenticated IV. Overflow on this
        // path is itself an attack signal — see `recordSeenIv` for the
        // rationale against FIFO eviction.
        if (ivKey !== null && !this.recordSeenIv(fromPeerId, ivKey)) {
          this.failSecureChannel(fromPeerId, "decrypt_failed");
          return;
        }
        payload = decrypted;
      } else if (this.e2eKey) {
        // Pre-handshake messages (key-exchange) are encrypted with the
        // phrase key. Once decrypted the type guard below ensures only
        // key-exchange payloads are accepted on this path; any other type
        // arriving without a session key is treated as a loud-fail event.
        //
        // A decrypt failure here is itself a loud-fail event (April 2026
        // audit M-01). The previous behavior silently recorded the
        // failure and waited for the cryptoMismatch threshold (3
        // strikes) before showing UI — that left a window where a
        // malicious or wrong-phrase peer could probe the relay-signal
        // channel without the user seeing an error. We now mirror the
        // post-handshake pattern: count the strike for telemetry
        // continuity AND tear down with the unmistakable
        // `decrypt_failed` overlay.
        let candidate: RelayPayload;
        try {
          candidate = (await decryptSignal(this.e2eKey, rawPayload, fromPeerId)) as RelayPayload;
        } catch {
          // Task #229 follow-up: same in-flight-straggler rationale as
          // the session-key path above. During the post-retry grace
          // window the most likely cause of a phrase-key decrypt failure
          // is an `offer` / `answer` / `ice` that was encrypted under
          // the previous session key and is still in flight after the
          // user clicked retry — silently drop instead of re-raising
          // the overlay.
          if (this.inPostRetryGrace(fromPeerId)) {
            return;
          }
          this.recordDecryptFail(fromPeerId);
          this.failSecureChannel(fromPeerId, "decrypt_failed");
          return;
        }
        if (candidate.type !== "key-exchange") {
          // Task #229 follow-up: a non-`key-exchange` envelope that
          // happens to decrypt with the phrase key during the grace
          // window is also an in-flight straggler (the only sender of
          // phrase-key-encrypted non-key-exchange traffic would be an
          // attacker, and they would have failed the previous decrypt
          // step — anything that reaches here legitimately is from the
          // honest peer pre-retry). Drop silently.
          if (this.inPostRetryGrace(fromPeerId)) {
            return;
          }
          this.failSecureChannel(fromPeerId, "ecdhe_failed");
          return;
        }
        // Task #483: record the now-authenticated IV. Same rationale as
        // the session-key path above.
        if (ivKey !== null && !this.recordSeenIv(fromPeerId, ivKey)) {
          this.failSecureChannel(fromPeerId, "decrypt_failed");
          return;
        }
        payload = candidate;
      } else {
        return;
      }
    } else {
      payload = rawPayload as RelayPayload;
    }

    this.clearDecryptFails(fromPeerId);

    try {
      if (payload.type === "key-exchange") {
        if (!payload.hello) {
          this.failSecureChannel(fromPeerId, "hello_invalid");
          return;
        }
        await this.handleKeyExchange(fromPeerId, payload.hello);
        return;
      }

      if (payload.type === "offer") {
        // Audit H-03 (task #466): structural SDP validation BEFORE the
        // browser parses anything. A peer who shares the phrase can
        // otherwise push pathological SDP at our WebRTC stack
        // (oversized payloads, exotic codecs, link-local candidates,
        // SHA-1 fingerprints). Loud-fail teardown — same teardown
        // semantics as `decrypt_failed`, distinct reason code so the
        // audit log can distinguish the two attack shapes.
        const offerSdp = payload.sdp?.sdp ?? "";
        const offerValidation = validateSdp(offerSdp);
        if (!offerValidation.ok) {
          // Surface the specific sdpValidator reason so operators can
          // distinguish disallowed_codec / disallowed_address /
          // too_large / etc. The umbrella `sdp_validation_failed`
          // sent to failSecureChannel is intentionally coarse for the
          // remote-facing UI; this log line is local-only diagnostics.
          console.warn(`[VOID] sdp_validation_failed (offer) reason=${offerValidation.reason}${offerValidation.detail ? ` detail=${offerValidation.detail}` : ""} peer=${fromPeerId}`);
          this.failSecureChannel(fromPeerId, "sdp_validation_failed");
          return;
        }
        const existing = this.peers.get(fromPeerId);
        let pc: RTCPeerConnection;
        if (existing) {
          pc = existing.pc;
          // Task #467: a fresh offer against an *existing* peer connection
          // is the remote-initiated counterpart to `attemptIceRestart` —
          // the peer is renegotiating (typically iceRestart:true after a
          // network blip). The local ICE-candidate counter is sized for a
          // single negotiation; without resetting here, a long-lived
          // session that survives one or two remote restarts would silently
          // run into the 50-candidate cap and drop legitimate candidates
          // mid-recovery. Mirrors the reset already done on the
          // locally-initiated restart paths (attemptIceRestart,
          // reinitializeAllPeers).
          this.peerIceCandidateCounts.delete(fromPeerId);
        } else {
          pc = this.buildPC(fromPeerId);
        }
        const clampedRemoteOffer = { ...payload.sdp!, sdp: clampOpusBitrate(offerSdp) };
        await pc.setRemoteDescription(new RTCSessionDescription(clampedRemoteOffer));
        const answer = await pc.createAnswer();
        const clampedAnswer = { ...answer, sdp: clampOpusBitrate(answer.sdp ?? "") };
        await pc.setLocalDescription(clampedAnswer);
        await this.relay(fromPeerId, { type: "answer", sdp: pc.localDescription! });
      } else if (payload.type === "answer") {
        const entry = this.peers.get(fromPeerId);
        if (entry) {
          // Audit H-03 (task #466): same validator as the offer path.
          const answerSdp = payload.sdp?.sdp ?? "";
          const answerValidation = validateSdp(answerSdp);
          if (!answerValidation.ok) {
            console.warn(`[VOID] sdp_validation_failed (answer) reason=${answerValidation.reason}${answerValidation.detail ? ` detail=${answerValidation.detail}` : ""} peer=${fromPeerId}`);
            this.failSecureChannel(fromPeerId, "sdp_validation_failed");
            return;
          }
          const clampedRemoteAnswer = { ...payload.sdp!, sdp: clampOpusBitrate(answerSdp) };
          await entry.pc.setRemoteDescription(
            new RTCSessionDescription(clampedRemoteAnswer)
          );
        }
      } else if (payload.type === "ice") {
        const entry = this.peers.get(fromPeerId);
        if (entry && payload.candidate) {
          // Audit H-03 (task #466): validate the trickled candidate
          // before addIceCandidate. Same address / size / UTF-8 rules
          // the per-offer SDP path applies to inline candidates.
          const candValidation = validateIceCandidate(payload.candidate);
          if (!candValidation.ok) {
            // Reason enum only — never log the raw candidate string.
            // It contains the peer's IP address, port, foundation, and
            // candidate type, all of which are peer metadata that
            // threat model §4 says must not leak to devtools (and
            // therefore to any browser extension with debugger access).
            // The reason value (disallowed_address / malformed_candidate
            // / attribute_too_long / invalid_utf8) is enough to triage
            // which rule fired; if we ever need address-level detail,
            // gate it behind an explicit debug flag.
            console.warn(`[VOID] sdp_validation_failed (ice) reason=${candValidation.reason} peer=${fromPeerId}`);
            this.failSecureChannel(fromPeerId, "sdp_validation_failed");
            return;
          }
          // Audit H-04 (task #464): cap accepted ICE candidates per peer
          // per negotiation. A hostile remote that survived the secure-
          // channel handshake could otherwise stream candidates forever,
          // each one forcing a STUN/TURN check on the local agent —
          // burning CPU + battery on mobile and the user's TURN quota
          // on paid networks. Real negotiations settle in <30 candidates
          // even with IPv6 + relay; 50 leaves margin for hosts behind
          // complex CGNAT or multi-interface dev environments. Counter
          // is reset on `attemptIceRestart` (the only legitimate reason
          // a peer would emit fresh candidates mid-call), on `removePeer`
          // (via Map delete), and on `destroy`.
          const count = this.peerIceCandidateCounts.get(fromPeerId) ?? 0;
          if (count >= 50) {
            console.warn(
              `[webrtc] ICE candidate cap reached for peer ${fromPeerId}; dropping further candidates this negotiation`,
            );
            return;
          }
          this.peerIceCandidateCounts.set(fromPeerId, count + 1);
          await entry.pc.addIceCandidate(
            new RTCIceCandidate(payload.candidate)
          );
        }
      }
    } catch {
      return;
    }
  }

  /**
   * Update the ICE transport policy that future RTCPeerConnections will
   * be built with. Existing connections keep their original policy until
   * they're torn down — pair this with `reinitializeAllPeers` to actually
   * apply the change. Used by the cooperative relay-only switch (Task #106).
   */
  setIceTransportPolicy(policy: RTCIceTransportPolicy) {
    this.iceTransportPolicy = policy;
  }

  /**
   * Tear down every existing peer connection (which also drops per-pair
   * session keys via `removePeer`) and re-initiate offers to the peers
   * named in `initiateTo`. Caller is expected to use a deterministic
   * ordering across peers — typically "initiate to peers whose peerId
   * sorts after mine" — so each pair has exactly one initiator and we
   * avoid offer/answer glare. Used by the relay-only mid-call switch
   * (Task #106) so PCs are rebuilt with the new `iceTransportPolicy`.
   */
  reinitializeAllPeers(initiateTo: string[]) {
    const existing = Array.from(this.peers.keys());
    for (const peerId of existing) {
      this.removePeer(peerId);
    }
    // Audit H-04 (task #464): every PC is gone; the counter map is
    // already drained by `removePeer`, but defensive clear keeps
    // `reinitializeAllPeers` self-contained if a future refactor moves
    // counter cleanup elsewhere.
    this.peerIceCandidateCounts.clear();
    for (const peerId of initiateTo) {
      this.initiateOffer(peerId);
    }
  }

  removePeer(peerId: string) {
    this.clearIceRestartTimer(peerId);
    const entry = this.peers.get(peerId);
    if (entry) {
      entry.pc.close();
      this.peers.delete(peerId);
      this.publish();
    }
    // Task #443: close every DROP data channel we held for this peer.
    // The channel's onclose handler also unlinks itself from the map,
    // but we do an explicit delete here so removePeer is idempotent.
    const dropList = this.peerDropChannels.get(peerId);
    if (dropList) {
      for (const ch of dropList) {
        try { ch.close(); } catch { /* ignore */ }
      }
      this.peerDropChannels.delete(peerId);
    }
    // Cancel the per-peer DROP throttle so a scheduled trailing emit
    // can't fire onDropReceived after the peer is gone.
    const dropThrottle = this.peerDropThrottles.get(peerId);
    if (dropThrottle) {
      dropThrottle.cancel();
      this.peerDropThrottles.delete(peerId);
    }
    // Close the per-peer `void.rekey` control channel and drop all
    // time-based rekey state. A peer that rejoins under the same peerId
    // gets a fresh handshake (epoch 0) and a new channel.
    const rekeyChannel = this.peerRekeyChannels.get(peerId);
    if (rekeyChannel) {
      try { rekeyChannel.close(); } catch { /* ignore */ }
      this.peerRekeyChannels.delete(peerId);
    }
    this.peerPendingRekey.delete(peerId);
    this.peerRekeyEpoch.delete(peerId);
    this.peerLastRekeyAt.delete(peerId);
    // Task #868: close the per-peer `void.media-state` channel. The
    // channel's onclose also unlinks itself, but delete explicitly so
    // removePeer is idempotent. We deliberately keep `localMediaState`
    // (our own snapshot) — it's manager-wide, not per-peer, and a
    // rejoining peer must still converge to it.
    const mediaStateChannel = this.peerMediaStateChannels.get(peerId);
    if (mediaStateChannel) {
      try { mediaStateChannel.close(); } catch { /* ignore */ }
      this.peerMediaStateChannels.delete(peerId);
    }
    this.connectionStates.delete(peerId);
    this.peerSessionKeys.delete(peerId);
    this.peerEphemeralKeys.delete(peerId);
    this.pendingKeyExchange.delete(peerId);
    this.peerSASMap.delete(peerId);
    this.peerKeyFingerprints.delete(peerId);
    this.decryptFailCounts.delete(peerId);
    // Audit H-04 (task #464): drop the per-peer accepted-ICE counter on
    // peer teardown. Without this, a peer that rejoins under the same
    // peerId after a hangup would inherit the stale count and could be
    // starved out of its candidate budget on the second negotiation.
    this.peerIceCandidateCounts.delete(peerId);
    // Task #483: drop the per-peer replay caches when a peer is torn
    // down. A peer that rejoins under the same peerId after a hangup
    // gets a fresh handshake, fresh keys, and therefore fresh IV /
    // hello-nonce spaces — keeping stale entries would produce
    // false-positive replay rejections on the legitimate rejoin.
    this.peerSeenIvs.delete(peerId);
    this.peerSeenHelloNonces.delete(peerId);
    if (this.secureChannelFailures.delete(peerId)) {
      this.publishSecureChannelFailures();
    }
    // Task #529: bump-and-drop the per-peer failure generation so any
    // in-flight deferred clear scheduled before this teardown becomes
    // a no-op when its timer fires (its captured generation no longer
    // matches), and a rejoining peer under the same peerId starts
    // from a clean slate.
    if (this.secureChannelFailureGen.has(peerId)) {
      this.secureChannelFailureGen.set(
        peerId,
        (this.secureChannelFailureGen.get(peerId) ?? 0) + 1,
      );
      this.secureChannelFailureGen.delete(peerId);
    }
    if (this.peerRelayPinned.delete(peerId)) {
      this.publishPeerRelayStatuses();
    }
    this.publishStates();
    this.publishSAS();
    this.publishCryptoMismatch();
  }

  replaceLocalStream(stream: MediaStream) {
    const next = replaceLocalStreamFn(this.mediaCtx(), stream);
    this.localStream = next.localStream;
    this.overrideVideoTrack = next.overrideVideoTrack;
    this.preOverrideVideoTrack = next.preOverrideVideoTrack;
  }

  replaceVideoTrack(track: MediaStreamTrack) {
    const next = replaceVideoTrackFn(this.mediaCtx(), track);
    this.localStream = next.localStream;
    this.overrideVideoTrack = next.overrideVideoTrack;
    this.preOverrideVideoTrack = next.preOverrideVideoTrack;
  }

  clearVideoOverride() {
    const next = clearVideoOverrideFn(this.mediaCtx());
    this.localStream = next.localStream;
    this.overrideVideoTrack = next.overrideVideoTrack;
    this.preOverrideVideoTrack = next.preOverrideVideoTrack;
  }

  private mediaCtx(): MediaCoordinatorContext {
    return {
      peers: this.peers,
      localStream: this.localStream,
      overrideVideoTrack: this.overrideVideoTrack,
      preOverrideVideoTrack: this.preOverrideVideoTrack,
    };
  }

  private clearIceRestartTimer(remotePeerId: string) {
    clearIceRestartTimerFn(this.iceRestartTimers, remotePeerId);
  }

  private scheduleIceRestart(remotePeerId: string, pc: RTCPeerConnection) {
    scheduleIceRestartFn(this.iceRestartTimers, remotePeerId, pc, (peerId, peerPc) => {
      this.attemptIceRestart(peerId, peerPc);
    });
  }

  private async attemptIceRestart(remotePeerId: string, pc: RTCPeerConnection) {
    if (pc.connectionState === "closed") return;
    if (!this.e2eKey) {
      this.failSecureChannel(remotePeerId, "ice_restart_failed");
      return;
    }
    try {
      // Rekey on every ICE restart. If ECDHE rekey fails the channel must
      // tear down — we cannot continue with stale per-pair state and must
      // never fall back to the room-wide phrase key (April 2026 audit
      // M-01). performKeyExchange re-runs the full signed-hello verify,
      // including the Task #313 room-type cross-check.
      await this.performKeyExchange(remotePeerId);
      // Audit H-04 (task #464): reset the per-peer accepted-candidate
      // counter on every legitimate ICE restart. Without this, a peer
      // that legitimately exhausted its 50-candidate budget on the
      // first negotiation would be unable to recover from a network
      // change (CGNAT rebind, WiFi → LTE) because every fresh
      // candidate would be dropped by the cap.
      this.peerIceCandidateCounts.delete(remotePeerId);
      const offer = await pc.createOffer({ iceRestart: true });
      offer.sdp = clampOpusBitrate(offer.sdp ?? "");
      await pc.setLocalDescription(offer);
      await this.relay(remotePeerId, { type: "offer", sdp: pc.localDescription! });
    } catch (err) {
      const reason: SecureChannelFailureReason =
        err instanceof HelloVerificationError ? "hello_invalid" : "ice_restart_failed";
      this.failSecureChannel(remotePeerId, reason);
    }
  }

  destroy() {
    this.socket.off("relay-signal", this.bound);
    if (this.relayStatusProbeTimer) {
      clearInterval(this.relayStatusProbeTimer);
      this.relayStatusProbeTimer = null;
    }
    for (const timer of this.iceRestartTimers.values()) {
      clearTimeout(timer);
    }
    this.iceRestartTimers.clear();
    for (const { pc } of this.peers.values()) {
      pc.close();
    }
    this.peers.clear();
    // Audit H-04 (task #464): drop the per-peer accepted-ICE counter so
    // a destroyed-and-rebuilt manager (test harness, hot reload) starts
    // from zero.
    this.peerIceCandidateCounts.clear();
    // Task #483: clear the per-peer replay caches on full teardown so a
    // destroyed-and-rebuilt manager (test harness, hot reload) starts
    // from zero.
    this.peerSeenIvs.clear();
    this.peerSeenHelloNonces.clear();
    this.connectionStates.clear();
    this.peerSessionKeys.clear();
    this.peerEphemeralKeys.clear();
    this.pendingKeyExchange.clear();
    this.peerSASMap.clear();
    this.peerKeyFingerprints.clear();
    this.decryptFailCounts.clear();
    this.secureChannelFailures.clear();
    // Task #529: clear the per-peer failure-generation map on full
    // teardown. Any deferred clear timers still pending will fail
    // their `has`/generation checks and no-op.
    this.secureChannelFailureGen.clear();
    this.peerRelayPinned.clear();
    // Task #229 follow-up: clear the post-retry grace map on full
    // teardown so a destroyed-and-rebuilt manager (test harness, hot
    // reload) starts from zero.
    this.peerPostRetryGrace.clear();
    // Task #443: ensure no DROP data channel leaks past teardown.
    for (const channels of this.peerDropChannels.values()) {
      for (const ch of channels) {
        try { ch.close(); } catch { /* ignore */ }
      }
    }
    this.peerDropChannels.clear();
    // Cancel every per-peer DROP throttle and the outbound self-throttle
    // so no scheduled trailing emit fires after teardown.
    for (const throttle of this.peerDropThrottles.values()) {
      throttle.cancel();
    }
    this.peerDropThrottles.clear();
    this.dropSendThrottle.cancel();
    // Tear down the time-based rekey machinery: stop the interval, drop
    // any in-flight rekey state, and close every `void.rekey` channel so
    // a destroyed-and-rebuilt manager starts from zero.
    if (this.rekeyTimer) {
      clearInterval(this.rekeyTimer);
      this.rekeyTimer = null;
    }
    this.peerPendingRekey.clear();
    for (const ch of this.peerRekeyChannels.values()) {
      try { ch.close(); } catch { /* ignore */ }
    }
    this.peerRekeyChannels.clear();
    this.peerRekeyEpoch.clear();
    this.peerLastRekeyAt.clear();
    // Task #868: close every `void.media-state` channel and forget our
    // own cached snapshot so a destroyed-and-rebuilt manager starts from
    // a clean slate.
    for (const ch of this.peerMediaStateChannels.values()) {
      try { ch.close(); } catch { /* ignore */ }
    }
    this.peerMediaStateChannels.clear();
    this.localMediaState = null;
  }
}

export const __testing = { clampOpusBitrate };
