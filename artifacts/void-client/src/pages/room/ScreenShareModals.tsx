// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RefObject } from "react";
import { SharePreviewVideo } from "./videoTiles";

interface PendingShare {
  stream: MediaStream;
  surface: string;
}

interface ScreenShareModalsProps {
  showShareWarning: boolean;
  shareWarningDialogRef: RefObject<HTMLDivElement | null>;
  setShowShareWarning: (v: boolean) => void;
  confirmAndStartShare: () => void;
  screenShareRequesting: boolean;

  pendingShare: PendingShare | null;
  pendingShareDialogRef: RefObject<HTMLDivElement | null>;
  cancelPendingShare: () => void;
  pickAnotherShareSource: () => void;
  confirmPendingShare: () => void;
}

export default function ScreenShareModals({
  showShareWarning,
  shareWarningDialogRef,
  setShowShareWarning,
  confirmAndStartShare,
  screenShareRequesting,
  pendingShare,
  pendingShareDialogRef,
  cancelPendingShare,
  pickAnotherShareSource,
  confirmPendingShare,
}: ScreenShareModalsProps) {
  return (
    <>
      {/* Pre-share warning modal */}
      {showShareWarning && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "var(--scrim)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: "20px",
        }}>
          <div
            ref={shareWarningDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="share-warning-dialog-title"
            aria-describedby="share-warning-dialog-desc"
            data-testid="share-warning-dialog"
            style={{
              background: "var(--bg)",
              border: "2px solid var(--gold)",
              padding: "24px",
              maxWidth: "420px",
              width: "100%",
              fontFamily: "var(--font-mono)",
            }}
          >
            <h2
              id="share-warning-dialog-title"
              style={{
                fontSize: "13px",
                letterSpacing: "3px",
                /* Task #1114: was var(--gold) on the var(--bg) panel
                   (1.35:1, unreadable). --fg passes AA; the gold panel
                   border keeps the accent. */
                color: "var(--fg)",
                fontWeight: 700,
                marginBottom: "16px",
                marginTop: 0,
                textTransform: "uppercase",
              }}
            >
              SCREEN SHARE WARNING
            </h2>
            <div id="share-warning-dialog-desc" style={{
              fontSize: "12px",
              lineHeight: 1.7,
              color: "var(--fg)",
              letterSpacing: "0.5px",
              marginBottom: "8px",
            }}>
              Screen sharing may reveal notifications, tabs, wallet balances, or other sensitive information visible on your display.
            </div>
            <div style={{
              fontSize: "12px",
              lineHeight: 1.7,
              color: "var(--fg-dim)",
              letterSpacing: "0.5px",
              marginBottom: "20px",
            }}>
              Prefer sharing a single tab or window instead of your full desktop.
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                className="void-btn"
                onClick={() => setShowShareWarning(false)}
                style={{ fontSize: "16px", padding: "8px 16px", letterSpacing: "2px" }}
              >
                CANCEL
              </button>
              <button
                className="void-btn void-btn--gold active"
                onClick={confirmAndStartShare}
                disabled={screenShareRequesting}
                style={{ fontSize: "16px", padding: "8px 16px", letterSpacing: "2px" }}
              >
                I UNDERSTAND
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-share confirmation panel. Two visual variants:
          - "monitor" surface gets the loud red entire-screen warning.
          - Window / tab / unknown surfaces get a lighter "preflight check"
            so the user can confirm the right window/tab is selected.
          Both variants embed a live <video> bound to the captured
          MediaStream so the user literally sees what peers would see
          before broadcasting starts. */}
      {pendingShare && (() => {
        const isMonitor = pendingShare.surface === "monitor";
        const accent = isMonitor ? "#C8351A" : "var(--gold)";
        const surfaceLabel = (() => {
          switch (pendingShare.surface) {
            case "monitor": return "ENTIRE SCREEN";
            case "window": return "APPLICATION WINDOW";
            case "browser": return "BROWSER TAB";
            default: return "SCREEN SOURCE";
          }
        })();
        return (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "var(--scrim)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          padding: "20px",
        }}>
          <div
            ref={pendingShareDialogRef}
            role={isMonitor ? "alertdialog" : "dialog"}
            aria-modal="true"
            aria-labelledby="pending-share-dialog-title"
            data-testid="pending-share-dialog"
            style={{
              background: "var(--bg)",
              border: `2px solid ${accent}`,
              padding: "24px",
              maxWidth: "440px",
              width: "100%",
              fontFamily: "var(--font-mono)",
              boxShadow: "none",
            }}
          >
            <h2
              id="pending-share-dialog-title"
              style={{
                fontSize: "13px",
                letterSpacing: "3px",
                color: accent,
                fontWeight: 700,
                marginBottom: "16px",
                marginTop: 0,
                textTransform: "uppercase",
              }}
            >
              {isMonitor ? "YOU SELECTED AN ENTIRE SCREEN" : "PREFLIGHT CHECK"}
            </h2>
            <div style={{
              fontSize: "12px",
              letterSpacing: "2px",
              color: "var(--fg-dim)",
              marginBottom: "8px",
              textTransform: "uppercase",
            }}>
              {`PREVIEW · ${surfaceLabel}`}
            </div>
            <div style={{
              border: "1px solid var(--fg-dim)",
              marginBottom: "16px",
              background: "#000",
            }}>
              <SharePreviewVideo stream={pendingShare.stream} />
            </div>
            {isMonitor ? (
              <>
                <div style={{
                  fontSize: "12px",
                  lineHeight: 1.7,
                  /* contrast-exception: sits on the dialog's var(--bg) panel
                     (--fg = 8+:1); the scanner pairs it with the sibling #000
                     preview box above. */
                  color: "var(--fg)",
                  letterSpacing: "0.5px",
                  marginBottom: "16px",
                }}>
                  Anything visible on that screen — including notifications, open email, and chat windows — will be visible to all peers.
                </div>
                <div style={{
                  fontSize: "12px",
                  lineHeight: 1.6,
                  /* contrast-exception: sits on the dialog's var(--bg) panel
                     (--fg-dim = 6.56:1); the scanner pairs it with the sibling
                     #000 preview box above. */
                  color: "var(--fg-dim)",
                  letterSpacing: "0.5px",
                  marginBottom: "20px",
                  fontStyle: "italic",
                }}>
                  Tip: Share a single window or tab when possible.
                </div>
              </>
            ) : (
              <div style={{
                fontSize: "12px",
                lineHeight: 1.7,
                /* contrast-exception: sits on the dialog's var(--bg) panel
                   (--fg = 8+:1); the scanner pairs it with the sibling #000
                   preview box above. */
                color: "var(--fg)",
                letterSpacing: "0.5px",
                marginBottom: "20px",
              }}>
                This is exactly what your peers will see. Cancel and pick again if it isn’t the right source.
              </div>
            )}
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                className="void-btn"
                onClick={cancelPendingShare}
                style={{ fontSize: "16px", padding: "8px 16px", letterSpacing: "2px" }}
              >
                CANCEL
              </button>
              <button
                className="void-btn"
                onClick={pickAnotherShareSource}
                style={{ fontSize: "16px", padding: "8px 16px", letterSpacing: "2px" }}
              >
                PICK ANOTHER SOURCE
              </button>
              <button
                className="void-btn void-btn--gold active"
                onClick={confirmPendingShare}
                style={{ fontSize: "16px", padding: "8px 16px", letterSpacing: "2px" }}
              >
                START SHARING
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
