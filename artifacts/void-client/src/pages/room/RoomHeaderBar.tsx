// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import SelfViewToggle from "@/components/SelfViewToggle";
import InCallOverflowMenu from "@/components/InCallOverflowMenu";
import { uiClick } from "@/lib/uiSounds";

interface RoomHeaderBarProps {
  voidPhrase: string;
  expiryDisplay: string | null;
  expiresAtWallClock: number | null;
  tierLabel: string | null;
  countdownColor: string;
  countdownUrgent: boolean;
  count: number;
  maxUsers: number;
  isHost: boolean;
  hostPresent: boolean;
  hostPeerId: string | null;
  peerTag: MutableRefObject<string>;
  verifiedCount: number;
  aggregateTotal: number;
  knockMode: boolean;
  roomLocked: boolean;
  copied: boolean;
  shareMethod: "sent" | "copied";
  handleToggleKnock: () => void;
  handleToggleLock: () => void;
  handleShareLink: () => void;
  handleShowQR: () => void;
  selfViewVisible: boolean;
  onToggleSelfView: (next: boolean) => void;
}

export default function RoomHeaderBar({
  voidPhrase,
  expiryDisplay,
  expiresAtWallClock,
  tierLabel,
  countdownColor,
  countdownUrgent,
  count,
  maxUsers,
  isHost,
  hostPresent,
  hostPeerId,
  peerTag,
  verifiedCount,
  aggregateTotal,
  knockMode,
  roomLocked,
  copied,
  shareMethod,
  handleToggleKnock,
  handleToggleLock,
  handleShareLink,
  handleShowQR,
  selfViewVisible,
  onToggleSelfView,
}: RoomHeaderBarProps) {
  const pausedTitle = !isHost && !hostPresent
    ? undefined
    : undefined;
  const pausedStyle: CSSProperties | undefined = !isHost && !hostPresent
    ? { opacity: 0.4, cursor: "not-allowed" }
    : undefined;

  const chipStyle: CSSProperties = {
    fontSize: "11px",
    letterSpacing: "1.2px",
    /* Task #1112: chips sit on the dark .void-header — --fg-dim is 1.39:1
       there (invisible). #A89E90 is the audited dim-on-dark token
       (headerBtn/headerBg, 7.13:1 in check-contrast.mjs). */
    color: "#A89E90",
    fontFamily: "var(--font-mono)",
    fontWeight: 700,
    textTransform: "uppercase",
    border: "1px solid #A89E90",
    padding: "2px 5px",
    whiteSpace: "nowrap",
  };

  const btnStyle: CSSProperties = {
    fontSize: "16px",
    padding: "5px 8px",
    letterSpacing: "1px",
  };

  return (
    <div className="void-header" data-testid="room-header-bar">
      <FullHeaderContents
        voidPhrase={voidPhrase}
        expiryDisplay={expiryDisplay}
        expiresAtWallClock={expiresAtWallClock}
        tierLabel={tierLabel}
        countdownColor={countdownColor}
        countdownUrgent={countdownUrgent}
        count={count}
        maxUsers={maxUsers}
        isHost={isHost}
        hostPresent={hostPresent}
        hostPeerId={hostPeerId}
        peerTag={peerTag}
        verifiedCount={verifiedCount}
        aggregateTotal={aggregateTotal}
        knockMode={knockMode}
        roomLocked={roomLocked}
        copied={copied}
        shareMethod={shareMethod}
        handleToggleKnock={handleToggleKnock}
        handleToggleLock={handleToggleLock}
        handleShareLink={handleShareLink}
        handleShowQR={handleShowQR}
        selfViewVisible={selfViewVisible}
        onToggleSelfView={onToggleSelfView}
        chipStyle={chipStyle}
        btnStyle={btnStyle}
        pausedTitle={pausedTitle}
        pausedStyle={pausedStyle}
      />
    </div>
  );
}

type FullHeaderContentsProps = RoomHeaderBarProps & {
  chipStyle: CSSProperties;
  btnStyle: CSSProperties;
  pausedTitle: string | undefined;
  pausedStyle: CSSProperties | undefined;
};

function FullHeaderContents(props: FullHeaderContentsProps) {
  const {
    voidPhrase,
    expiryDisplay,
    expiresAtWallClock,
    tierLabel,
    countdownColor,
    countdownUrgent,
    count,
    maxUsers,
    isHost,
    hostPresent,
    hostPeerId,
    peerTag,
    verifiedCount,
    aggregateTotal,
    knockMode,
    roomLocked,
    copied,
    shareMethod,
    handleToggleKnock,
    handleToggleLock,
    handleShareLink,
    handleShowQR,
    selfViewVisible,
    onToggleSelfView,
    chipStyle,
    btnStyle,
    pausedStyle,
  } = props;

  // Task #597: the phrase row is now a tap-to-mask label. It shows the
  // full 6-word phrase by default; tapping it (click / Enter / Space)
  // hides the words behind fixed asterisk blocks for shoulder-surfing
  // privacy and toggles back on a second tap. State is per-mount (resets
  // on reload / rejoin) — no persistence.
  const [phraseMasked, setPhraseMasked] = useState(false);
  const maskedPhrase = "**** **** **** **** **** ****";

  // Task #594/#597: the SHARE / SHOW QR affordance always lives in the
  // overflow menu now (the phrase row no longer carries it). Built once
  // here so the fragment-leak caption (pinned in
  // scripts/check-required-literals.mjs) has a single home.
  const shareAffordance: ReactNode = (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px", alignItems: "stretch" }}>
      <div style={{ display: "flex", gap: "6px" }}>
        <button
          role="menuitem"
          className={`void-btn${copied ? " void-btn--teal active" : ""}`}
          onClick={handleShareLink}
          aria-describedby="room-share-fragment-caution"
          style={btnStyle}
        >
          {copied ? (shareMethod === "sent" ? "SENT" : "COPIED") : "SHARE"}
        </button>
        <button
          role="menuitem"
          className="void-btn"
          onClick={handleShowQR}
          title="Show QR code to scan"
          aria-describedby="room-share-fragment-caution"
          style={btnStyle}
        >
          SHOW QR
        </button>
      </div>
      <div
        id="room-share-fragment-caution"
        style={{
          fontSize: "9px",
          lineHeight: 1.25,
          color: "var(--fg-dim)",
          letterSpacing: "0.4px",
          maxWidth: "240px",
        }}
      >
        Phrase travels in the URL. Anything that reads the URL — browser sync, history, extensions — reads the phrase.
      </div>
      {/* Link-wrapping caution (task #731). The same guidance the two main
          share surfaces (RoomShareSheet/PhraseShareModal, task #729) already
          carry: some messengers and corporate proxies rewrite or strip the
          URL fragment, so a plain-link share can drop the joiner on the
          start screen with no error. Prefer the QR or reading the six words
          aloud for those channels. Distinct from the fragment-leak line
          above (who can READ the URL) — this is about the link arriving
          intact. Trimmed to fit the cramped 9px caption area. */}
      <div
        id="room-share-channel-caution"
        style={{
          fontSize: "9px",
          lineHeight: 1.25,
          color: "var(--fg-dim)",
          letterSpacing: "0.4px",
          maxWidth: "240px",
        }}
      >
        Some messengers and proxies (Slack, LinkedIn) can mangle the link. Share the QR or read the six words aloud instead.
      </div>
    </div>
  );

  return (
    <>
      {/* Phrase row — full width, dedicated row, no truncation. The 6-word
          phrase is the single most-referenced piece of info in a room
          (read aloud to share, used for verification). The whole row is a
          tap-to-mask toggle: shown in full by default, tapping hides the
          words behind fixed asterisk blocks (shoulder-surfing privacy)
          and a second tap reveals them again. The lock glyph reflects the
          current state. */}
      <div
        className="void-header-phrase-row"
        style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}
      >
        <button
          type="button"
          data-testid="room-phrase-toggle"
          onClick={() => {
            uiClick();
            setPhraseMasked((v) => !v);
          }}
          aria-pressed={phraseMasked}
          aria-label={phraseMasked ? "Show the room phrase" : "Hide the room phrase"}
          title={phraseMasked ? "Tap to show the room phrase" : "Tap to hide the room phrase"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            background: "transparent",
            border: "none",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
            textAlign: "left",
          }}
        >
          <span
            className="void-header-phrase"
            data-testid="room-phrase-row"
            data-masked={phraseMasked ? "1" : "0"}
          >
            {phraseMasked ? maskedPhrase : voidPhrase}
          </span>
          <span aria-hidden="true" style={{ display: "inline-flex", color: "#A89E90", flexShrink: 0 }}>
            {phraseMasked ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" rx="1" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="11" width="14" height="9" rx="1" />
                <path d="M8 11V7a4 4 0 0 1 8 0" />
              </svg>
            )}
          </span>
        </button>
      </div>

      {/* Controls row — wraps on narrow viewports so every chip/button
          stays reachable without horizontal scroll. */}
      <div className="void-header-controls">
        <div className="void-wordmark">V&nbsp;&nbsp;&nbsp;[]&nbsp;&nbsp;&nbsp;I&nbsp;&nbsp;&nbsp;D</div>
        {expiryDisplay && (
          <div
            title={
              expiresAtWallClock !== null
                ? `Room ends at ${new Date(expiresAtWallClock).toLocaleString()}${tierLabel ? ` (${tierLabel} tier)` : ""}`
                : undefined
            }
            style={{
              fontSize: "11px",
              color: countdownColor,
              letterSpacing: "1px",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              animation: countdownUrgent ? "void-pulse 1s ease-in-out infinite" : undefined,
              whiteSpace: "nowrap",
            }}
          >
            {expiryDisplay}{tierLabel ? ` · ${tierLabel}` : ""}
          </div>
        )}
        <div style={{ fontSize: "11px", color: "#A89E90", letterSpacing: "1px", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
          {count}/{maxUsers}
        </div>
        {!isHost && hostPresent && hostPeerId && (
          <div
            data-testid="host-peer-tag"
            title="The peer ID of the current moderator. Match it to the tag burned into their video tile to know who holds lock and knock."
            style={chipStyle}
          >
            HOST: {hostPeerId.replace(/^peer-/i, "PEER-").toUpperCase()}
          </div>
        )}
        {!isHost && !hostPresent && (
          <div
            data-testid="host-offline-pill"
            title="The original host can rejoin to restore moderation. Lock and knock are paused until they do."
            style={chipStyle}
          >
            HOST OFFLINE — REJOIN PAUSED
          </div>
        )}
        <div
          data-testid="local-peer-tag"
          title="Your per-room tag. This is what is burned into your outgoing video. Read it aloud so the host can note who you are — VOID does not store this."
          style={{
            ...chipStyle,
            color: "var(--gold)",
            borderColor: "var(--gold)",
          }}
        >
          YOU ARE {peerTag.current}
        </div>
        {aggregateTotal > 0 && (
          <div
            title="Local-only verification status. You marked these peers' phrase pairs as matching."
            style={{
              ...chipStyle,
              color: verifiedCount === aggregateTotal ? "var(--teal)" : "#A89E90",
              borderColor: verifiedCount === aggregateTotal ? "var(--teal)" : "#A89E90",
            }}
          >
            YOU VERIFIED {verifiedCount}/{aggregateTotal} {aggregateTotal === 1 ? "PEER" : "PEERS"}
          </div>
        )}
        {/* Action group stays pinned to the right edge (margin-left:auto)
            and travels together as one unit when the header wraps onto a
            new line on narrow viewports — so the kebab never falls back to
            the left side. */}
        <div className="void-header-actions">
          <SelfViewToggle
            value={selfViewVisible}
            onChange={onToggleSelfView}
            style={btnStyle}
          />
          {/* Task #594: secondary controls (UI sounds, host KNOCK / LOCK,
              post-dismissal SHARE / SHOW QR, REVOKE UNMASK PERMISSION) move
              into the overflow ("kebab") menu to reclaim header width. */}
          <InCallOverflowMenu
            isHost={isHost}
            hostPresent={hostPresent}
            knockMode={knockMode}
            roomLocked={roomLocked}
            handleToggleKnock={handleToggleKnock}
            handleToggleLock={handleToggleLock}
            shareAffordance={shareAffordance}
            btnStyle={btnStyle}
            pausedStyle={pausedStyle}
          />
        </div>
      </div>
    </>
  );
}
