// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";

interface Props {
  url: string;
  phrase: string;
  tierLabel?: string | null;
  expiresAtWallClock?: number | null;
  onClose: () => void;
}

function formatExpiryDisplay(epochMs: number): string {
  const d = new Date(epochMs);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return time;
  const day = d.toLocaleDateString([], { weekday: "short" });
  return `${day} ${time}`;
}

function buildClipboardText(
  url: string,
  expiresAtWallClock: number | null | undefined,
  tierLabel: string | null | undefined,
): string {
  if (expiresAtWallClock == null) return url;
  const expiry = formatExpiryDisplay(expiresAtWallClock);
  const tierSuffix = tierLabel ? ` (${tierLabel} tier)` : "";
  return `${url}\nExpires ${expiry}${tierSuffix}`;
}

export default function RoomShareSheet({
  url,
  phrase,
  tierLabel,
  expiresAtWallClock,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onEscape: onClose });

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(
        buildClipboardText(url, expiresAtWallClock, tierLabel),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  const phraseWords = phrase.split(/\s+/).filter(Boolean);
  const expiryDisplay =
    expiresAtWallClock != null ? formatExpiryDisplay(expiresAtWallClock) : null;
  const expiryTitle =
    expiresAtWallClock != null
      ? `Room ends at ${new Date(expiresAtWallClock).toLocaleString()}${
          tierLabel ? ` (${tierLabel} tier)` : ""
        }`
      : undefined;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--scrim)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "var(--font-mono)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-share-sheet-title"
        style={{
          background: "var(--bg)",
          border: "3px solid var(--gold)",
          width: "100%",
          maxWidth: "420px",
          position: "relative",
        }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: "3px solid var(--fg)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span id="room-share-sheet-title" style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg)", fontWeight: 700 }}>
            SCAN TO JOIN
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "3px solid var(--fg-dim)",
              color: "var(--fg-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              fontWeight: 700,
              padding: "2px 10px",
              cursor: "pointer",
              letterSpacing: "1px",
              lineHeight: 1.2,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: "20px 20px 24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "18px",
          }}
        >
          {/* QR code */}
          <div
            style={{
              background: "#F2EADA",
              padding: "16px",
              border: "3px solid var(--fg)",
              lineHeight: 0,
            }}
          >
            <QRCodeSVG
              value={url}
              size={260}
              bgColor="#F2EADA"
              fgColor="#0A0908"
              level="M"
            />
          </div>

          {/* Readable join URL. Parity with PhraseShareModal so a host
              who shares from this sheet can read or dictate the link
              without copying it to the clipboard. The QR above encodes
              the same URL. */}
          <div
            style={{
              width: "100%",
              border: "3px solid var(--fg-dim)",
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div style={{
              fontSize: "12px",
              letterSpacing: "3px",
              color: "var(--fg-dim)",
              marginBottom: "6px",
              fontWeight: 700,
              textTransform: "uppercase",
            }}>
              Link
            </div>
            <div
              id="room-share-sheet-join-url"
              title={url}
              style={{
                fontSize: "12px",
                letterSpacing: "0.5px",
                color: "var(--fg)",
                fontWeight: 700,
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                direction: "ltr",
              }}
            >
              {url}
            </div>
          </div>

          {/* Phrase */}
          <div
            style={{
              width: "100%",
              border: "3px solid var(--fg-dim)",
              padding: "12px 14px",
              textAlign: "center",
            }}
          >
            <div style={{
              fontSize: "12px",
              letterSpacing: "3px",
              color: "var(--fg-dim)",
              marginBottom: "8px",
              fontWeight: 700,
            }}>
              OR TYPE THE PHRASE
            </div>
            <div style={{
              fontSize: "16px",
              letterSpacing: "1px",
              wordSpacing: "6px",
              color: "var(--fg)",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              lineHeight: 1.4,
              wordBreak: "break-word",
            }}>
              {phraseWords.join(" ")}
            </div>
          </div>

          {/* Expiry / tier badge */}
          {expiryDisplay && (
            <div
              title={expiryTitle}
              aria-label={expiryTitle}
              style={{
                width: "100%",
                border: "3px solid var(--gold)",
                padding: "10px 14px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                gap: "4px",
              }}
            >
              <div style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: "var(--fg-dim)",
                fontWeight: 700,
              }}>
                LINK EXPIRES
              </div>
              <div style={{
                fontSize: "14px",
                letterSpacing: "2px",
                color: "var(--fg)",
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
              }}>
                {expiryDisplay}{tierLabel ? ` · ${tierLabel}` : ""}
              </div>
            </div>
          )}

          {/* Copy link button + clipboard caution caption.
              Mirrors the lobby pattern from PreviewGate (task #373): on
              older Android and many in-app browsers, any app can read
              the clipboard, so the QR rendered above the button is the
              safe alternative. The caption is wired to the COPY LINK
              button via aria-describedby so assistive tech announces
              the caveat as part of the button's description. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              width: "100%",
            }}
          >
            <button
              onClick={handleCopy}
              aria-describedby="room-share-sheet-copy-caution"
              className={`void-btn${copied ? " void-btn--teal active" : ""}`}
              style={{
                width: "100%",
                fontSize: "12px",
                padding: "10px 12px",
                letterSpacing: "2px",
              }}
            >
              {copied ? "LINK COPIED ✓" : "COPY LINK"}
            </button>
            <div
              id="room-share-sheet-copy-caution"
              style={{
                fontSize: "11px",
                lineHeight: 1.4,
                color: "var(--fg-dim)",
                letterSpacing: "0.5px",
                textAlign: "center",
              }}
            >
              On older Android and many in-app browsers, other apps can read the clipboard. QR doesn’t touch it.
            </div>
          </div>

          {/* Fragment-leak caption (task #399). Permanent, non-dismissable,
              non-animated line of muted text. The room phrase travels in
              the URL fragment, so anything with read access to the URL —
              browser sync, history, extensions — sees the phrase. Pinned
              in the required-literals manifest. */}
          <div
            id="room-share-sheet-fragment-caution"
            style={{
              width: "100%",
              fontSize: "11px",
              lineHeight: 1.4,
              color: "var(--fg-dim)",
              letterSpacing: "0.5px",
              textAlign: "center",
            }}
          >
            Phrase travels in the URL. Anything that reads the URL — browser sync, history, extensions — reads the phrase.
          </div>

          {/* Link-wrapping caution (task #729). Some messengers and corporate
              proxies rewrite or strip the URL fragment that carries the
              phrase, so a plain-link share can land the joiner on the start
              screen with no error. Recommend the QR or reading the six words
              aloud for those channels. Distinct from the fragment-leak line
              above (which is about who can READ the URL) — this is about the
              link arriving intact. */}
          <div
            id="room-share-sheet-channel-caution"
            style={{
              width: "100%",
              fontSize: "11px",
              lineHeight: 1.4,
              color: "var(--fg-dim)",
              letterSpacing: "0.5px",
              textAlign: "center",
            }}
          >
            Some messengers and proxies (Slack, LinkedIn) can mangle the link. Share the QR or read the six words aloud instead.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: "3px solid var(--fg-dim)",
            padding: "10px 16px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--fg-dim)",
            letterSpacing: "2px",
          }}
        >
          POINT A CAMERA · NO ACCOUNT NEEDED
        </div>
      </div>
    </div>
  );
}
