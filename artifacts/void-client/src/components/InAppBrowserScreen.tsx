// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from "react";
import type { InAppBrowser } from "@/lib/userAgent";

interface Props {
  detected: InAppBrowser;
  /** True when the host OS is iOS. Drives the deep-link copy. */
  isIOS: boolean;
  /** True when the host OS is Android. Drives the deep-link copy. */
  isAndroid: boolean;
}

const APP_LABELS: Record<InAppBrowser, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  wechat: "WeChat",
  line: "Line",
  snapchat: "Snapchat",
  twitter: "X",
  "generic-webview": "this app’s built-in browser",
};

function currentUrl(): string {
  if (typeof window === "undefined" || !window.location) return "";
  return window.location.href;
}

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through.
  }
  return false;
}

export default function InAppBrowserScreen({ detected, isIOS, isAndroid }: Props) {
  const [copied, setCopied] = useState(false);
  const url = currentUrl();
  const label = APP_LABELS[detected];

  // Android Chrome deep link via the `googlechrome://navigate?url=`
  // scheme. We use this instead of the canonical `intent://...` URI
  // because VOID's room phrase lives in the URL hash fragment, and
  // `intent://` uses `#Intent;...` as the start of intent extras —
  // those two `#`s collide and truncate the phrase. The
  // `googlechrome://navigate?url=<encoded>` form encodes the entire
  // URL (hash included) as a query parameter, so the phrase survives
  // verbatim. Chrome on Android registers the `googlechrome:` scheme;
  // if Chrome isn't installed the OS shows a chooser, which is the
  // right fallback.
  const androidChromeDeepLink = url
    ? `googlechrome://navigate?url=${encodeURIComponent(url)}`
    : null;

  async function handleCopy() {
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <div
      data-testid="in-app-browser-screen"
      style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 20px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
        background: "transparent",
        textAlign: "center",
        gap: "18px",
      }}
    >
      <div style={{ maxWidth: "520px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h1
          style={{
            fontSize: "16px",
            letterSpacing: "2px",
            margin: 0,
            color: "var(--gold)",
            textTransform: "uppercase",
            alignSelf: "center",
            background: "var(--surface-dark)",
            border: "1px solid var(--gold)",
            padding: "8px 14px",
          }}
        >
          OPEN VOID IN YOUR BROWSER
        </h1>
        <p style={{ fontSize: "13px", lineHeight: 1.55, margin: 0 }}>
          You’re viewing this page inside {label}. Built-in browsers like this one usually block
          camera and microphone access, which VOID needs to start a call.
        </p>
        {/* contrast-exception: sits on the page's light var(--bg) body
            (--fg-dim = 6.56:1); the scanner pairs it with the sibling
            heading's #0a0a0a chip above. */}
        <p style={{ fontSize: "12px", lineHeight: 1.55, margin: 0, color: "var(--fg-dim)" }}>
          {isIOS && "Tap the share button in the corner, then Open in Safari."}
          {isAndroid && "Tap the three-dot menu, then Open in browser."}
          {!isIOS && !isAndroid && "Open this link in your normal browser."}
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            alignItems: "center",
          }}
        >
          <code
            data-testid="in-app-browser-url"
            style={{
              fontSize: "12px",
              wordBreak: "break-all",
              padding: "10px 12px",
              border: "1px dashed var(--fg-dim, #555)",
              background: "rgba(0,0,0,0.25)",
              maxWidth: "100%",
            }}
          >
            {url || "(this page)"}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!url}
            style={{
              background: "transparent",
              color: "var(--fg)",
              border: "1px solid var(--fg-dim, #555)",
              padding: "8px 14px",
              fontFamily: "inherit",
              fontSize: "12px",
              letterSpacing: "2px",
              cursor: url ? "pointer" : "not-allowed",
            }}
          >
            {copied ? "COPIED" : "COPY LINK"}
          </button>
          {isAndroid && androidChromeDeepLink && (
            <a
              href={androidChromeDeepLink}
              data-testid="in-app-browser-android-chrome"
              style={{
                color: "var(--gold)",
                fontSize: "12px",
                letterSpacing: "2px",
                marginTop: "4px",
                textDecoration: "none",
                border: "1px solid var(--gold)",
                background: "var(--surface-dark)",
                padding: "8px 14px",
              }}
            >
              OPEN IN CHROME
            </a>
          )}
        </div>
        {/* contrast-exception: sits on the page's light var(--bg) body
            (--fg-dim = 6.56:1); the scanner pairs it with the sibling
            OPEN IN CHROME link's var(--surface-dark) background above. */}
        <p style={{ fontSize: "11px", letterSpacing: "1.5px", color: "var(--fg-dim)", margin: 0 }}>
          NOTHING WAS SENT. NOTHING WAS STORED.
        </p>
      </div>
    </div>
  );
}
