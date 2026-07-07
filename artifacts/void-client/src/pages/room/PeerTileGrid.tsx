// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  CryptoMismatchPeers,
  PeerSAS,
  PeerRelayStatuses,
  RemoteStreams,
  SecureChannelFailures,
  WebRTCManager,
} from "@/lib/webrtc";
import { VideoSlot, VuMeter, describeSecureChannelFailure } from "./videoTiles";
import type { VerifyState } from "@/hooks/useRoomCrypto";

type PeerMediaStateMap = Record<string, { camOff?: boolean; micMuted?: boolean; voiceMode?: number; viaOnion?: boolean } | undefined>;

interface Participant {
  id: string;
  isMe: boolean;
}

interface Slot {
  participant: Participant | null;
  index: number;
}

interface PeerTileGridProps {
  slots: Slot[];
  displayCount: number;
  hostPresent: boolean;
  hostPeerId: string | null;
  isScreenSharing: boolean;
  localPreviewStream: MediaStream | null;
  localStream: MediaStream | null;
  remoteStreams: RemoteStreams;
  peerTag: MutableRefObject<string>;
  screenSharePeerId: string | null;
  relayOnly: boolean;
  peerRelayPinned: PeerRelayStatuses;
  peerMediaState: PeerMediaStateMap;
  secureChannelFailures: SecureChannelFailures;
  cryptoMismatch: CryptoMismatchPeers;
  phraseChangedNotice: Record<string, boolean>;
  silentRekeyNotice: Record<string, boolean>;
  peerSAS: PeerSAS;
  camOff: boolean;
  micMuted: boolean;
  localAnalyser: AnalyserNode | null;
  webrtcRef: MutableRefObject<WebRTCManager | null>;
  verificationOpenFor: string | null;
  setVerificationOpenFor: Dispatch<SetStateAction<string | null>>;
  setVerificationAnchor: Dispatch<SetStateAction<HTMLElement | null>>;
  verifyStateFor: (pid: string) => VerifyState;
  setVerifyStatus: (pid: string, status: "verified" | "mismatch") => void;
  uiClick: () => void;
}

export default function PeerTileGrid({
  slots,
  displayCount,
  hostPresent,
  hostPeerId,
  isScreenSharing,
  localPreviewStream,
  localStream,
  remoteStreams,
  peerTag,
  screenSharePeerId,
  relayOnly,
  peerRelayPinned,
  peerMediaState,
  secureChannelFailures,
  cryptoMismatch,
  phraseChangedNotice,
  silentRekeyNotice,
  peerSAS,
  camOff,
  micMuted,
  localAnalyser,
  webrtcRef,
  verificationOpenFor,
  setVerificationOpenFor,
  setVerificationAnchor,
  verifyStateFor,
  setVerifyStatus,
  uiClick,
}: PeerTileGridProps) {
  return (
    <div
      className="void-video-grid"
      data-slots={String(Math.min(4, Math.max(1, displayCount)))}
    >
      {slots.map(({ participant, index }) => {
        const isMe = participant?.isMe ?? false;
        // Task #571 masked-output guarantee: when this is the local
        // (self) tile, the stream MUST come from one of two pipeline
        // outputs — never the raw camera. `localStream` is the
        // `processedStream` produced by `buildMediaPipeline` (the
        // current shader / voice-mask result that we also forward to
        // peers). `localPreviewStream` is the watermarked screen-share
        // composition. Both are masked. If a future contributor wires
        // a raw camera track into either prop, every peer ALSO breaks
        // (we forward what we render), so this site is structurally
        // safe. The `data-self-stream-source` attribute below pins
        // the contract for unit tests so a regression fails loudly.
        const selfStreamSource: "screen-share-preview" | "masked-pipeline" =
          isScreenSharing && localPreviewStream ? "screen-share-preview" : "masked-pipeline";
        const stream = participant
          ? isMe
            ? (isScreenSharing && localPreviewStream ? localPreviewStream : localStream)
            : remoteStreams[participant.id] ?? null
          : null;
        // Task #702 defense-in-depth: silence the incoming audio element
        // for any remote peer whose advertised media-state reports the mic
        // muted. The sender already stops transmitting (task #697), but a
        // buggy or malicious sender that keeps sending audio still must not
        // be heard locally. This reconciles automatically when the peer
        // un-mutes (the prop flips back to false). Our own tile is always
        // muted to avoid echo, so this only matters for remote tiles.
        const peerMicMuted =
          !isMe && peerMediaState[participant?.id ?? ""]?.micMuted === true;
        // Task #718 defense-in-depth: blank the incoming video for any
        // remote peer whose advertised media-state reports `camOff`. The
        // cosmetic "CAM OFF" overlay below still covers the tile, but the
        // live track is also detached from the <video> element so it can't
        // be seen if the overlay were bypassed/removed. Reconciles when the
        // peer re-enables their camera (the prop flips back to false). We
        // never blank our own tile here — the local camera-off path already
        // governs `localStream`.
        const peerCamOff =
          !isMe && peerMediaState[participant?.id ?? ""]?.camOff === true;

        return (
          <div
            key={index}
            className={`void-video-slot ${isMe ? "void-video-slot--local" : "void-video-slot--remote"}`}
            data-self-stream-source={isMe ? selfStreamSource : undefined}
          >
            <VideoSlot stream={stream} muted={isMe || peerMicMuted} mirror={isMe && !isScreenSharing} blankVideo={peerCamOff} />
            {participant && (
              <>
                <div className="void-slot-label">
                  {(() => {
                    // Surface the per-peer watermark tag on every slot label
                    // so a host (or any participant) can manually map "Alice
                    // = PEER-XYZ" during the call. This is the bridge that
                    // makes leaked-recording attribution possible without
                    // VOID storing identity anywhere.
                    const remoteTag = (participant.id ?? "")
                      .replace(/^peer-/, "PEER-")
                      .toUpperCase();
                    if (isMe) {
                      const meTag = peerTag.current;
                      return isScreenSharing
                        ? `YOU [${meTag}] [SHARING]`
                        : `YOU [${meTag}]`;
                    }
                    const baseLabel = `P${index + 1} [${remoteTag}]`;
                    return screenSharePeerId === participant.id
                      ? `${baseLabel} [SHARING]`
                      : baseLabel;
                  })()}
                </div>
                {/* Task #344: mark the host's tile so guests can spot the
                    moderator at a glance without cross-referencing the
                    "HOST: PEER-XYZ" header pill against the burned-in tag.
                    Only ever drawn on a remote tile (isMe is excluded), so
                    the host never sees the marker on their own local tile.
                    Reactive to hostPresent / hostPeerId, so it disappears
                    when the host leaves and re-attaches to the new host when
                    reclaimed. Style matches the dim/bordered header pill. */}
                {!isMe && hostPresent && hostPeerId === participant.id && (
                  <div
                    data-testid={`host-tile-badge-${participant.id}`}
                    title="This is the room's host — they hold lock and knock moderation."
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "8px",
                      background: "rgba(20,17,13,0.6)",
                      /* Task #1112: --fg-dim is 1.39:1 on the dark video slot —
                         #A89E90 is the audited dim-on-dark token (7.13:1). */
                      border: "1px solid #A89E90",
                      color: "#A89E90",
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      fontWeight: 700,
                      letterSpacing: "1.2px",
                      padding: "2px 5px",
                      textTransform: "uppercase",
                      zIndex: 6,
                      pointerEvents: "none",
                    }}
                  >
                    HOST
                  </div>
                )}
                {/* Task #293: surface a per-peer "VIA TOR" subscript when
                    this peer's connection is observed to be relay-pinned
                    (both ends of the selected candidate pair are TURN).
                    Skip when the room itself is relay-only — the existing
                    RELAY ONLY pill already makes that condition obvious
                    for everyone, and a per-tile hint would be noisy.
                    Skip on our own tile because we already have the teal
                    CONNECTED VIA TOR ONION pill for that case. */}
                {!isMe && !relayOnly && peerRelayPinned[participant.id] && (
                  <div
                    data-testid={`peer-via-tor-${participant.id}`}
                    title="This peer’s connection is going through a TURN relay only — typically because they joined from a Tor .onion address. They cannot see your IP and you cannot see theirs."
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      left: "8px",
                      background: "rgba(0,0,0,0.6)",
                      border: "1px solid var(--teal, #2ec4b6)",
                      color: "var(--teal, #2ec4b6)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "1.5px",
                      padding: "1px 5px",
                      textTransform: "uppercase",
                      zIndex: 6,
                      pointerEvents: "auto",
                      cursor: "help",
                    }}
                  >
                    VIA TOR
                  </div>
                )}
                {/* Task #366: surface a per-peer ".ONION" indicator
                    whenever that remote peer has advertised — over the
                    existing peer-media-state channel — that they loaded
                    VOID from a .onion origin. The host-perspective case
                    is already covered by the room-level HOST VIA .ONION
                    pill, so we keep this strictly per-tile for guests.
                    Informational only — no enforcement change. */}
                {!isMe && peerMediaState[participant.id]?.viaOnion === true && (
                  <div
                    data-testid={`peer-via-onion-${participant.id}`}
                    title="This peer loaded VOID over a Tor .onion address. Informational — does not change connection enforcement."
                    style={{
                      position: "absolute",
                      bottom: "8px",
                      right: "8px",
                      background: "rgba(0,0,0,0.6)",
                      border: "1px solid var(--teal, #2ec4b6)",
                      color: "var(--teal, #2ec4b6)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "10px",
                      fontWeight: 700,
                      letterSpacing: "1.5px",
                      padding: "1px 5px",
                      textTransform: "uppercase",
                      zIndex: 6,
                      pointerEvents: "auto",
                      cursor: "help",
                    }}
                  >
                    .ONION
                  </div>
                )}
                {!isMe && secureChannelFailures[participant.id] && (() => {
                  const reason = secureChannelFailures[participant.id];
                  const { headline, detail, kind } = describeSecureChannelFailure(reason);
                  return (
                    <div
                      data-testid={`secure-channel-failure-${participant.id}`}
                      data-failure-reason={reason}
                      data-failure-kind={kind}
                      role="alert"
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        flexDirection: "column",
                        background: "rgba(40, 0, 0, 0.92)",
                        border: "3px solid var(--red)",
                        color: "var(--red)",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        textAlign: "center",
                        padding: "8px",
                        zIndex: 20,
                        gap: "6px",
                      }}
                    >
                      {/* Task #518: the descriptive text scrolls within
                          the remaining tile height so the retry button
                          stays anchored at the bottom of the tile and
                          is always visible/tappable, no matter how
                          small the tile is. */}
                      <div
                        data-testid={`secure-channel-failure-detail-${participant.id}`}
                        style={{
                          flex: "1 1 auto",
                          minHeight: 0,
                          overflowY: "auto",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "6px",
                          padding: "4px",
                        }}
                      >
                        <div style={{ fontSize: "12px", letterSpacing: "2px", lineHeight: 1.4 }}>
                          SECURE CHANNEL<br />COULD NOT BE<br />ESTABLISHED
                        </div>
                        <div style={{
                          fontSize: "12px",
                          letterSpacing: "1.5px",
                          lineHeight: 1.3,
                          color: "var(--red)",
                        }}>
                          {headline}
                        </div>
                        <div style={{
                          fontSize: "11px",
                          letterSpacing: "1.2px",
                          color: "#A89E90",
                          lineHeight: 1.4,
                          maxWidth: "200px",
                        }}>
                          {detail}
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid={`secure-channel-retry-${participant.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          uiClick();
                          // Task #182: tear down the failed peer-state and
                          // re-initiate ECDHE without forcing a full room
                          // rejoin.
                          webrtcRef.current?.retrySecureChannel(participant.id);
                        }}
                        style={{
                          flex: "0 0 auto",
                          alignSelf: "center",
                          background: "var(--red)",
                          color: "var(--bg)",
                          border: "1px solid var(--red)",
                          fontFamily: "var(--font-mono)",
                          fontWeight: 700,
                          fontSize: "12px",
                          letterSpacing: "1.5px",
                          textTransform: "uppercase",
                          padding: "6px 12px",
                          cursor: "pointer",
                          appearance: "none",
                          marginTop: "auto",
                        }}
                      >
                        RETRY SECURE CHANNEL
                      </button>
                    </div>
                  );
                })()}
                {!isMe && !secureChannelFailures[participant.id] && cryptoMismatch[participant.id] && (
                  <div style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    fontSize: "12px",
                    letterSpacing: "2px",
                    color: "var(--red)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    background: "rgba(10, 9, 8, 0.85)",
                    padding: "8px 14px",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    border: "2px solid var(--red)",
                    zIndex: 10,
                    textAlign: "center",
                    lineHeight: 1.6,
                  }}>
                    PHRASE MISMATCH<br />
                    <span style={{ fontSize: "12px", letterSpacing: "1.5px", color: "#A89E90" }}>VERIFY VOID PHRASE</span>
                  </div>
                )}
                {!isMe && !secureChannelFailures[participant.id] && !cryptoMismatch[participant.id] && phraseChangedNotice[participant.id] && (
                  <button
                    type="button"
                    data-testid={`keys-rotated-banner-${participant.id}`}
                    aria-label={`Keys rotated — re-verify SAS with P${index + 1}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setVerificationAnchor(e.currentTarget);
                      setVerificationOpenFor(participant.id);
                    }}
                    className="void-phrase-changed-notice"
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "rgba(10, 9, 8, 0.85)",
                      border: "1px solid var(--gold)",
                      color: "var(--gold)",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: "12px",
                      letterSpacing: "1.5px",
                      textTransform: "uppercase",
                      padding: "4px 8px",
                      whiteSpace: "nowrap",
                      zIndex: 6,
                      textAlign: "center",
                      lineHeight: 1.4,
                      cursor: "pointer",
                      appearance: "none",
                    }}
                  >
                    KEYS ROTATED<br />
                    <span style={{ fontSize: "12px", letterSpacing: "1.2px", color: "#A89E90" }}>RE-VERIFY SAS</span>
                  </button>
                )}
                {!isMe && !secureChannelFailures[participant.id] && !cryptoMismatch[participant.id] && !phraseChangedNotice[participant.id] && silentRekeyNotice[participant.id] && (
                  <div
                    data-testid={`keys-rotated-silent-${participant.id}`}
                    aria-label={`Session keys rotated automatically with P${index + 1}; identity unchanged, no action needed`}
                    className="void-silent-rekey-notice"
                    style={{
                      position: "absolute",
                      top: "8px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "rgba(10, 9, 8, 0.72)",
                      border: "1px solid var(--teal)",
                      color: "var(--teal)",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 700,
                      fontSize: "11px",
                      letterSpacing: "1.4px",
                      textTransform: "uppercase",
                      padding: "3px 7px",
                      whiteSpace: "nowrap",
                      zIndex: 6,
                      textAlign: "center",
                      lineHeight: 1.4,
                      pointerEvents: "none",
                    }}
                  >
                    KEYS ROTATED
                  </div>
                )}
                {!isMe && !secureChannelFailures[participant.id] && !cryptoMismatch[participant.id] && (() => {
                  const vState = verifyStateFor(participant.id);
                  const sas = peerSAS[participant.id];
                  const chipColor =
                    vState === "verified" ? "var(--teal)"
                    : vState === "mismatch" ? "var(--red)"
                    : "#A89E90";
                  const chipLabel =
                    vState === "pending" ? "SECURING…"
                    : vState === "verified" ? "YOU VERIFIED"
                    : vState === "mismatch" ? "CHECK FAILED"
                    : "VERIFY";
                  const isOpen = verificationOpenFor === participant.id;
                  const isPending = vState === "pending";
                  return (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isPending) return;
                        if (isOpen) {
                          setVerificationOpenFor(null);
                          setVerificationAnchor(null);
                        } else {
                          setVerificationAnchor(e.currentTarget);
                          setVerificationOpenFor(participant.id);
                        }
                      }}
                      aria-label={`Phrase verification with P${index + 1}: ${chipLabel}. Opens verification dialog.`}
                      aria-expanded={isOpen}
                      aria-haspopup="dialog"
                      disabled={isPending}
                      data-testid={`sas-chip-${participant.id}`}
                      className="void-sas-chip"
                      style={{
                        position: "absolute",
                        bottom: "4px",
                        right: "4px",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "2px",
                        background: "rgba(10, 9, 8, 0.75)",
                        border: `1px solid ${chipColor}`,
                        padding: "3px 6px",
                        cursor: isPending ? "default" : "pointer",
                        color: chipColor,
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                        textTransform: "uppercase",
                      }}
                    >
                      {sas && (
                        <span style={{
                          fontSize: "12px",
                          letterSpacing: "1.5px",
                          color: "var(--teal)",
                          opacity: vState === "mismatch" ? 0.6 : 1,
                        }}>
                          {sas[0]} {sas[1]}
                        </span>
                      )}
                      <span style={{ fontSize: "12px", letterSpacing: "1.5px" }}>
                        {chipLabel}
                      </span>
                    </button>
                  );
                })()}
                <VuMeter
                  analyserOrStream={
                    isMe
                      ? localAnalyser
                      : (remoteStreams[participant.id] ?? null)
                  }
                  muted={peerMicMuted}
                />
              </>
            )}
            {(() => {
              if (!participant) return null;
              const peerEntry = isMe ? undefined : peerMediaState[participant.id];
              const isCamOff = isMe ? camOff : peerEntry?.camOff === true;
              const isMicMuted = isMe ? micMuted : peerEntry?.micMuted === true;
              // Task #868: a remote peer's mic/cam state now rides the
              // per-peer `void.media-state` data channel. Until that channel
              // opens — and if it fails closed — we have NO knowledge of the
              // peer's mic/cam. We must NOT render the absence of state as if
              // the peer were unmuted / camera-on (a false claim about
              // another person's device). Instead show a neutral "unknown"
              // badge. We treat state as known only once an actual boolean has
              // arrived over the channel; a partial update that omits one of
              // the two leaves that field unknown.
              const camUnknown =
                !isMe && typeof peerEntry?.camOff !== "boolean";
              const micUnknown =
                !isMe && typeof peerEntry?.micMuted !== "boolean";
              return (
                <>
                  {isCamOff && (
                    <div className="void-cam-off-overlay">
                      <div className="void-cam-off-icon">▣</div>
                      <div className="void-cam-off-text">CAM OFF</div>
                    </div>
                  )}
                  {(isMicMuted || micUnknown || camUnknown) && (
                    <div className="void-media-badges">
                      {isMicMuted && (
                        <div className="void-badge void-badge--mic">⊘ MIC</div>
                      )}
                      {micUnknown && (
                        <div
                          data-testid={`peer-mic-unknown-${participant.id}`}
                          className="void-badge void-badge--unknown"
                          title="This peer's microphone state hasn't arrived yet over the encrypted peer-to-peer channel. VOID never assumes a peer is unmuted — the indicator stays neutral until their device reports it."
                        >
                          MIC ?
                        </div>
                      )}
                      {camUnknown && !isCamOff && (
                        <div
                          data-testid={`peer-cam-unknown-${participant.id}`}
                          className="void-badge void-badge--unknown"
                          title="This peer's camera state hasn't arrived yet over the encrypted peer-to-peer channel. VOID never assumes a peer's camera is on — the indicator stays neutral until their device reports it."
                        >
                          CAM ?
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
