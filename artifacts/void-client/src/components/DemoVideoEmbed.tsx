// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState, useCallback } from "react";

interface Props {
  src: string;
  poster: string;
  caption?: string;
  label: string;
  ariaLabel: string;
  iframeSrc?: string;
  /** When the embed sits on a dark surface (e.g. the landing page's
      asphalt demo band), light the label text so it stays legible. */
  onDark?: boolean;
  /** Drop the .void-tan-frost backdrop-filter on the label/caption. The
      landing page renders this on an already-opaque band and must stay free
      of backdrop-filter (it spawns a compositing layer that intermittently
      fails to repaint, making the text vanish — see .landing-haze in index.css).
      Callers that pass this MUST guarantee the text already has an opaque
      backing behind it. */
  solidLabel?: boolean;
}

type Mode =
  | "poster"      // iframeSrc provided; waiting for user click
  | "iframe"      // iframeSrc provided; iframe is mounted
  | "checking"    // no iframeSrc (or iframe failed); HEAD-checking the MP4
  | "available"   // MP4 confirmed; show <video>
  | "missing";    // nothing available; show placeholder

export default function DemoVideoEmbed({
  src,
  poster,
  caption,
  label,
  ariaLabel,
  iframeSrc,
  onDark = false,
  solidLabel = false,
}: Props) {
  const base = import.meta.env.BASE_URL;
  const videoUrl = base + src;
  const posterUrl = base + poster;

  const [mode, setMode] = useState<Mode>(iframeSrc ? "poster" : "checking");

  const checkMp4 = useCallback(() => {
    setMode("checking");
    let cancelled = false;
    fetch(videoUrl, { method: "HEAD" })
      .then((res) => {
        if (cancelled) return;
        const contentType = res.headers.get("content-type") || "";
        const isVideo = res.ok && contentType.toLowerCase().startsWith("video/");
        setMode(isVideo ? "available" : "missing");
      })
      .catch(() => {
        if (!cancelled) setMode("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!iframeSrc) {
      return checkMp4();
    }
    return undefined;
  }, [iframeSrc, checkMp4]);

  const handlePosterClick = () => {
    setMode("iframe");
  };

  const handleIframeError = () => {
    checkMp4();
  };

  return (
    <figure
      style={{
        margin: 0,
        maxWidth: "680px",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          letterSpacing: "2px",
          color: onDark ? "#EFE7D6" : "var(--fg)",
          textTransform: "uppercase",
        }}
      >
        <span className={solidLabel ? undefined : "void-tan-frost"}>
          <span style={{ color: "var(--burnt)" }}>▌</span> {label}
        </span>
      </div>

      {/* ── poster: click-to-play overlay ── */}
      {mode === "poster" && (
        <button
          onClick={handlePosterClick}
          aria-label={`Play ${ariaLabel}`}
          style={{
            all: "unset",
            display: "block",
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: `var(--surface-dark) url(${posterUrl}) center / cover no-repeat`,
            border: "2px solid var(--fg-dim)",
            cursor: "pointer",
          }}
        >
          {/* Play chevron */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(20,17,13,0.45)",
            }}
          >
            <div
              style={{
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: "rgba(20,17,13,0.75)",
                border: "2px solid var(--gold)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 0,
                  height: 0,
                  borderTop: "10px solid transparent",
                  borderBottom: "10px solid transparent",
                  borderLeft: "18px solid var(--gold)",
                  marginLeft: "4px",
                }}
              />
            </div>
          </div>
        </button>
      )}

      {/* ── sandboxed iframe ── */}
      {mode === "iframe" && iframeSrc && (
        <iframe
          src={iframeSrc}
          title={ariaLabel}
          sandbox="allow-scripts allow-same-origin"
          allow="autoplay"
          onError={handleIframeError}
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            border: "2px solid var(--fg-dim)",
            display: "block",
            background: "var(--surface-dark)",
          }}
        />
      )}

      {/* ── MP4 fallback: checking (transient) — shows the same placeholder
          badge as "missing" so the user sees consistent UI while the HEAD
          request is in-flight. ── */}
      {(mode === "checking" || mode === "missing") && (
        <div
          role="img"
          aria-label={`${ariaLabel}. Recording in production.`}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "16 / 9",
            background: `var(--surface-dark) url(${posterUrl}) center / cover no-repeat`,
            border: "2px solid var(--fg-dim)",
            display: "block",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "12px",
              right: "12px",
              padding: "6px 10px",
              background: "rgba(20,17,13,0.85)",
              border: "1px solid var(--burnt)",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              letterSpacing: "2px",
              color: "var(--burnt)",
              textTransform: "uppercase",
            }}
          >
            Recording in production
          </div>
        </div>
      )}

      {/* ── MP4 available ── */}
      {mode === "available" && (
        <video
          controls
          preload="none"
          playsInline
          poster={posterUrl}
          aria-label={ariaLabel}
          style={{
            width: "100%",
            height: "auto",
            aspectRatio: "16 / 9",
            background: "var(--surface-dark)",
            border: "2px solid var(--fg-dim)",
            display: "block",
          }}
        >
          <source src={videoUrl} type="video/mp4" />
        </video>
      )}

      {caption && (
        <figcaption
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "2px",
            color: "var(--fg-dim)",
            lineHeight: 1.7,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          <span className={solidLabel ? undefined : "void-tan-frost"}>{caption}</span>
        </figcaption>
      )}
    </figure>
  );
}
