// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";
import { parseRoomQr } from "@/lib/parseRoomQr";
import { useDialogFocusTrap } from "@/lib/useDialogFocusTrap";

interface Props {
  onResult: (phrase: string) => void;
  onClose: () => void;
}

type ScannerState =
  | { kind: "starting" }
  | { kind: "scanning" }
  | { kind: "permission-denied" }
  | { kind: "no-camera" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string };

function classifyCameraError(err: unknown): ScannerState {
  if (typeof err === "string") {
    // qr-scanner sometimes rejects with a plain string ("Camera not found.").
    const msg = err.toLowerCase();
    if (msg.includes("permission") || msg.includes("denied"))
      return { kind: "permission-denied" };
    if (msg.includes("no camera") || msg.includes("not found"))
      return { kind: "no-camera" };
    return { kind: "error", message: err };
  }
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "SecurityError")
      return { kind: "permission-denied" };
    if (err.name === "NotFoundError" || err.name === "OverconstrainedError")
      return { kind: "no-camera" };
    if (err.name === "NotReadableError")
      return { kind: "error", message: "CAMERA IN USE BY ANOTHER APP" };
    return { kind: "error", message: err.name.toUpperCase() };
  }
  if (err instanceof Error) {
    return { kind: "error", message: err.message.toUpperCase() };
  }
  return { kind: "error", message: "CAMERA UNAVAILABLE" };
}

export default function QrScannerModal({ onResult, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const consumedRef = useRef(false);

  const [state, setState] = useState<ScannerState>({ kind: "starting" });
  const [hint, setHint] = useState<string | null>(null);
  const [decodingImage, setDecodingImage] = useState(false);
  const dialogRef = useDialogFocusTrap<HTMLDivElement>({
    onEscape: () => closeRef.current(),
  });

  useEffect(() => {
    let cancelled = false;
    const videoEl = videoRef.current;
    if (!videoEl) return;

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState({ kind: "unsupported" });
      return;
    }

    const scanner = new QrScanner(
      videoEl,
      (result) => {
        if (consumedRef.current) return;
        const phrase = parseRoomQr(result.data);
        if (!phrase) {
          setHint("NOT A VOID ROOM QR");
          return;
        }
        consumedRef.current = true;
        // Stop the camera before handing off so the indicator turns off
        // immediately and the parent unmount has nothing to clean up.
        scanner.stop();
        onResultRef.current(phrase);
      },
      {
        preferredCamera: "environment",
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 8,
        returnDetailedScanResult: true,
      },
    );
    scannerRef.current = scanner;
    QrScanner.hasCamera()
      .then((has) => {
        if (cancelled) return;
        if (!has) {
          setState({ kind: "no-camera" });
          return;
        }
        return scanner.start().then(() => {
          if (cancelled) {
            scanner.stop();
            return;
          }
          setState({ kind: "scanning" });
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState(classifyCameraError(err));
      });

    return () => {
      cancelled = true;
      scannerRef.current = null;
      try {
        scanner.stop();
      } catch {
        // ignore — scanner may not have started
      }
      scanner.destroy();
    };
  }, []);

  async function handleImageFile(file: File) {
    if (consumedRef.current) return;
    setHint(null);
    setDecodingImage(true);
    try {
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
      });
      if (consumedRef.current) return;
      const phrase = parseRoomQr(result.data);
      if (!phrase) {
        setHint("NOT A VOID ROOM QR");
        return;
      }
      consumedRef.current = true;
      try {
        scannerRef.current?.stop();
      } catch {
        // ignore — camera may not have started
      }
      onResultRef.current(phrase);
    } catch {
      if (consumedRef.current) return;
      setHint("COULD NOT READ A QR FROM THAT IMAGE");
    } finally {
      setDecodingImage(false);
    }
  }

  const errorCopy =
    state.kind === "permission-denied"
      ? {
          title: "CAMERA ACCESS BLOCKED",
          body: "VOID needs camera permission to scan a QR. Allow camera access in your browser settings, then try again.",
        }
      : state.kind === "no-camera"
        ? {
            title: "NO CAMERA FOUND",
            body: "This device does not seem to have a camera available. Type the phrase by hand instead.",
          }
        : state.kind === "unsupported"
          ? {
              title: "SCANNING NOT SUPPORTED",
              body: "This browser cannot open the camera. Use a recent browser, or type the phrase by hand.",
            }
          : state.kind === "error"
            ? {
                title: "CAMERA ERROR",
                body: state.message,
              }
            : null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-scanner-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(8, 6, 4, 0.92)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
      }}
    >
      <button
        type="button"
        onClick={() => closeRef.current()}
        aria-label="Close scanner"
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          background: "var(--fg)",
          border: "2px solid var(--fg)",
          color: "var(--bg)",
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "2px",
          padding: "10px 16px",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        ✕ CLOSE
      </button>

      <div
        id="qr-scanner-modal-title"
        style={{
          fontSize: "13px",
          letterSpacing: "3px",
          /* Task #1114: was var(--fg-dim) on the near-black overlay
             (~1.3:1, invisible). --fg-on-dark is the token for text on
             dark surfaces. */
          color: "var(--fg-on-dark)",
          textTransform: "uppercase",
          marginBottom: "12px",
          textAlign: "center",
        }}
      >
        Scan Room QR
      </div>
      <div
        style={{
          fontSize: "12px",
          letterSpacing: "1px",
          /* Task #1114: was var(--fg-dim) on the near-black overlay
             (~1.3:1, invisible). --fg-on-dark is the token for text on
             dark surfaces. */
          color: "var(--fg-on-dark)",
          textTransform: "uppercase",
          marginBottom: "16px",
          textAlign: "center",
          maxWidth: "360px",
          lineHeight: 1.6,
        }}
      >
        Point your camera at the host’s QR code.
      </div>

      <div
        style={{
          position: "relative",
          width: "min(80vw, 360px)",
          aspectRatio: "1 / 1",
          background: "#000",
          border: "2px solid var(--gold)",
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          aria-label="camera preview"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: errorCopy ? "none" : "block",
          }}
        />
        {state.kind === "starting" && !errorCopy && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              letterSpacing: "3px",
              /* Task #1114: was var(--fg-dim) on the #000 camera box
                 (1.55:1, invisible). --fg-on-dark is the token for text
                 on dark surfaces. */
              color: "var(--fg-on-dark)",
            }}
          >
            STARTING CAMERA...
          </div>
        )}
        {errorCopy && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              textAlign: "center",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "2px",
                color: "var(--red)",
                textTransform: "uppercase",
              }}
            >
              {errorCopy.title}
            </div>
            <div
              style={{
                fontSize: "12px",
                letterSpacing: "1px",
                color: "var(--fg-dim)",
                textTransform: "uppercase",
                lineHeight: 1.6,
              }}
            >
              {errorCopy.body}
            </div>
          </div>
        )}
      </div>

      {hint && (
        <div
          role="status"
          style={{
            marginTop: "12px",
            fontSize: "12px",
            letterSpacing: "2px",
            color: "var(--red)",
            textTransform: "uppercase",
            textAlign: "center",
            maxWidth: "360px",
            lineHeight: 1.6,
          }}
        >
          {hint}
        </div>
      )}

      <div
        style={{
          marginTop: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          width: "100%",
          maxWidth: "340px",
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          aria-hidden="true"
          tabIndex={-1}
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so the same file can be picked again after a failure.
            e.target.value = "";
            if (file) void handleImageFile(file);
          }}
        />
        <button
          type="button"
          className="void-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={decodingImage || consumedRef.current}
          style={{
            width: "100%",
            fontSize: "12px",
            padding: "14px",
            letterSpacing: "2px",
          }}
        >
          {decodingImage ? "READING IMAGE..." : "USE A SAVED IMAGE"}
        </button>
        <button
          type="button"
          onClick={() => closeRef.current()}
          style={{
            width: "100%",
            background: "var(--fg)",
            border: "2px solid var(--fg)",
            color: "var(--bg)",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "2px",
            padding: "14px",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          CANCEL
        </button>
      </div>
    </div>
  );
}
