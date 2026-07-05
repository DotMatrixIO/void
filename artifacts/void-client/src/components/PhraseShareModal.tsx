// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { uiClick } from "@/lib/uiSounds";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";
import { shareOrCopyUrl } from "@/lib/shareOrCopyUrl";

interface Props {
  phrase: string;
  joinUrl: string;
  onClose: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => {
    switch (ch) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

export default function PhraseShareModal({ phrase, joinUrl, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [shared, setShared] = useState(false);
  // Native share is only offered on touch devices that expose
  // navigator.share — mirrors the gate inside shareOrCopyUrl so the button
  // never appears where it would silently fall back to a clipboard copy
  // (the modal already has dedicated COPY / COPY LINK actions for that).
  // Resolved in an effect so the first render is stable.
  const [canNativeShare, setCanNativeShare] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({ onEscape: onClose });
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isMobile =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    setCanNativeShare(isMobile && "share" in navigator);
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (linkCopyTimerRef.current) clearTimeout(linkCopyTimerRef.current);
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
    };
  }, []);

  function handleClose() {
    uiClick();
    onClose();
  }

  async function handleCopy() {
    uiClick();
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch {
      // ignore
    }
  }

  async function handleCopyLink() {
    uiClick();
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(joinUrl);
      setLinkCopied(true);
      if (linkCopyTimerRef.current) clearTimeout(linkCopyTimerRef.current);
      linkCopyTimerRef.current = setTimeout(() => {
        setLinkCopied(false);
        linkCopyTimerRef.current = null;
      }, 2000);
    } catch {
      // ignore
    }
  }

  async function handleShare() {
    uiClick();
    const outcome = await shareOrCopyUrl({
      url: joinUrl,
      title: "VOID room",
      shareText: "Join my VOID room",
      clipboardText: joinUrl,
    });
    // Show transient confirmation only when something actually went out
    // (native sheet sent, or it fell back to a clipboard copy). An aborted
    // sheet or an unavailable API leaves the button idle.
    if (outcome === "sent" || outcome === "copied") {
      setShared(true);
      if (shareTimerRef.current) clearTimeout(shareTimerRef.current);
      shareTimerRef.current = setTimeout(() => {
        setShared(false);
        shareTimerRef.current = null;
      }, 2000);
    }
  }

  function handlePrint() {
    uiClick();
    const svgEl = qrWrapRef.current?.querySelector("svg");
    const svgMarkup = svgEl ? svgEl.outerHTML : "";
    const w = window.open("", "_blank", "width=480,height=680");
    if (!w) return;
    const safe = escapeHtml(phrase);
    w.document.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>VOID room phrase</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: #0A0908;
    background: #ffffff;
    padding: 48px 32px;
    max-width: 520px;
    margin: 0 auto;
  }
  h1 {
    font-size: 14px;
    letter-spacing: 4px;
    margin: 0 0 6px;
    text-transform: uppercase;
    font-weight: 700;
  }
  .sub {
    font-size: 12px;
    letter-spacing: 2px;
    color: #555;
    text-transform: uppercase;
    margin: 0 0 28px;
  }
  .label {
    font-size: 12px;
    letter-spacing: 3px;
    color: #555;
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  .phrase {
    font-size: 22px;
    line-height: 1.5;
    word-spacing: 8px;
    font-weight: 700;
    padding: 16px;
    border: 3px solid #0A0908;
    margin-bottom: 28px;
    word-break: break-word;
  }
  .qr {
    display: flex;
    justify-content: center;
    padding: 16px;
    border: 3px solid #0A0908;
  }
  .qr svg { width: 280px; height: 280px; display: block; }
  .footer {
    text-align: center;
    font-size: 12px;
    letter-spacing: 2px;
    color: #555;
    margin-top: 28px;
    text-transform: uppercase;
  }
  @media print { body { padding: 24px; } }
</style>
</head>
<body>
  <h1>VOID — room phrase</h1>
  <p class="sub">Share this phrase to let peers join the room.</p>
  <div class="label">Phrase</div>
  <div class="phrase">${safe}</div>
  <div class="label">Or scan</div>
  <div class="qr">${svgMarkup}</div>
  <p class="footer">No account · End-to-end encrypted</p>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
</body>
</html>`);
    w.document.close();
  }

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
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="phrase-share-modal-title"
        style={{
          background: "var(--bg)",
          border: "3px solid var(--gold)",
          width: "100%",
          maxWidth: "380px",
          position: "relative",
        }}
      >
        <div
          style={{
            borderBottom: "3px solid var(--fg)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            id="phrase-share-modal-title"
            style={{
              fontSize: "12px",
              letterSpacing: "3px",
              color: "var(--fg)",
              fontWeight: 700,
            }}
          >
            ROOM PHRASE
          </span>
          <button
            onClick={handleClose}
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

        <div
          style={{
            padding: "18px 18px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "14px",
          }}
        >
          <div
            ref={qrWrapRef}
            style={{
              background: "#F2EADA",
              padding: "14px",
              border: "3px solid var(--fg)",
              lineHeight: 0,
            }}
          >
            <QRCodeSVG
              value={joinUrl}
              size={220}
              bgColor="#F2EADA"
              fgColor="#0A0908"
              level="M"
            />
          </div>

          <div
            style={{
              width: "100%",
              border: "3px solid var(--fg-dim)",
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: "var(--fg-dim)",
                marginBottom: "6px",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              Phrase
            </div>
            <div
              style={{
                fontSize: "15px",
                letterSpacing: "1px",
                wordSpacing: "6px",
                color: "var(--fg)",
                fontWeight: 700,
                lineHeight: 1.4,
                wordBreak: "break-word",
              }}
            >
              {phrase}
            </div>
          </div>

          <div
            style={{
              width: "100%",
              border: "3px solid var(--fg-dim)",
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "3px",
                color: "var(--fg-dim)",
                marginBottom: "6px",
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              Link
            </div>
            <div
              id="phrase-share-modal-join-url"
              title={joinUrl}
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
              {joinUrl}
            </div>
          </div>

          {canNativeShare && (
            <button
              type="button"
              onClick={handleShare}
              className={`void-btn${shared ? " void-btn--teal active" : ""}`}
              style={{
                width: "100%",
                fontSize: "12px",
                padding: "10px 8px",
                letterSpacing: "2px",
              }}
            >
              {shared ? "SHARED ✓" : "SHARE VIA…"}
            </button>
          )}

          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
            <button
              type="button"
              onClick={handleCopy}
              aria-describedby="phrase-share-modal-copy-caution"
              className={`void-btn${copied ? " void-btn--teal active" : ""}`}
              style={{
                flex: 1,
                fontSize: "12px",
                padding: "10px 8px",
                letterSpacing: "2px",
              }}
            >
              {copied ? "COPIED ✓" : "COPY"}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className={`void-btn${linkCopied ? " void-btn--teal active" : ""}`}
              style={{
                flex: 1,
                fontSize: "12px",
                padding: "10px 8px",
                letterSpacing: "2px",
              }}
            >
              {linkCopied ? "LINK COPIED ✓" : "COPY LINK"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="void-btn"
              style={{
                flex: 1,
                fontSize: "12px",
                padding: "10px 8px",
                letterSpacing: "2px",
              }}
            >
              PRINT
            </button>
          </div>

          {/* Clipboard-caution caption (task #382). Mirrors the lobby
              (PreviewGate, task #373) and the in-room share sheet
              (RoomShareSheet, task #375): the COPY button above writes the
              room phrase to the clipboard, and on older Android / many
              in-app browsers other apps can read the clipboard — the QR
              rendered above never touches it. Wired to the COPY button via
              aria-describedby so assistive tech announces the caveat as part
              of the button's description. Literal-identical to the other two
              mirrors so the cross-surface message stays consistent. */}
          <div
            id="phrase-share-modal-copy-caution"
            style={{
              width: "100%",
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

        {/* BURN-as-moderation reminder (task #436). A single quiet line
            of body copy near the share affordance, so a host who is
            about to hand the phrase out has the structural answer to
            "what if I share with the wrong person?" in their visual
            field at the moment of decision. No icon, no color flag,
            matched to the existing modal voice. */}
        <div
          id="phrase-share-modal-burn-reminder"
          style={{
            padding: "10px 16px 0",
            fontSize: "11px",
            lineHeight: 1.4,
            color: "var(--fg-dim)",
            letterSpacing: "0.5px",
            textAlign: "center",
          }}
        >
          if the wrong person ends up in the room, BURN and share a new phrase
        </div>

        {/* Fragment-leak caption (task #399). Permanent, non-dismissable,
            non-animated line of muted text. The room phrase travels in
            the URL fragment when the join link is shared, so anything
            with read access to the URL — browser sync, history,
            extensions — sees the phrase. Pinned in the required-literals
            manifest so a future "let's soften this" edit fails CI. */}
        <div
          id="phrase-share-modal-fragment-caution"
          style={{
            padding: "10px 16px",
            fontSize: "11px",
            lineHeight: 1.4,
            color: "var(--fg-dim)",
            letterSpacing: "0.5px",
            textAlign: "center",
            borderTop: "3px solid var(--fg-dim)",
          }}
        >
          Phrase travels in the URL. Anything that reads the URL — browser sync, history, extensions — reads the phrase.
        </div>

        {/* Link-wrapping caution (task #729). Some messengers and corporate
            proxies rewrite or strip the URL fragment that carries the phrase,
            so a plain-link share can land the joiner on the start screen with
            no error. Recommend the QR or reading the six words aloud for those
            channels. Distinct from the fragment-leak line above (which is
            about who can READ the URL) — this is about the link arriving
            intact. */}
        <div
          id="phrase-share-modal-channel-caution"
          style={{
            padding: "0 16px 10px",
            fontSize: "11px",
            lineHeight: 1.4,
            color: "var(--fg-dim)",
            letterSpacing: "0.5px",
            textAlign: "center",
          }}
        >
          Some messengers and proxies (Slack, LinkedIn) can mangle the link. Share the QR or read the six words aloud instead.
        </div>

        <div
          style={{
            borderTop: "3px solid var(--fg-dim)",
            padding: "10px 16px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--fg-dim)",
            letterSpacing: "2px",
            textTransform: "uppercase",
          }}
        >
          Hand off offline · No account needed
        </div>
      </div>
    </div>
  );
}
