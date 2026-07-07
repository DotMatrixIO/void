// SPDX-License-Identifier: AGPL-3.0-or-later
import type { PrivacyBrowser } from "@/lib/userAgent";

interface Props {
  /**
   * The privacy-browser family we detected, when one matched. `null`
   * means we ran the probe and saw a blocked outcome but cannot
   * positively identify the browser — likely a corporate-managed
   * Chrome/Edge or an unrecognised hardened build.
   */
  detected: PrivacyBrowser;
  /** Optional Brave runtime hint. Surfaces the Brave-specific copy when true. */
  brave?: boolean;
  /** Called when the user picks "back". Cancels the room entry. */
  onBack: () => void;
}

interface Guidance {
  heading: string;
  body: string;
  steps: string[];
}

function guidanceFor(detected: PrivacyBrowser, brave: boolean): Guidance {
  if (brave) {
    return {
      heading: "BRAVE IS BLOCKING PEER-TO-PEER MEDIA",
      body:
        "Brave Shields on Strict (or fingerprint blocking on Strict) disables the WebRTC features VOID needs to connect.",
      steps: [
        "Click the Shields icon next to the URL.",
        "Switch fingerprint blocking to Standard for this site.",
        "Reload and try again.",
      ],
    };
  }
  switch (detected) {
    case "vanadium":
      return {
        heading: "VANADIUM IS BLOCKING PEER-TO-PEER MEDIA",
        body:
          "Vanadium’s default WebRTC policy refuses non-proxied UDP, which stops VOID from connecting to other peers.",
        steps: [
          "Open vanadium://settings/content/webrtc",
          "Switch WebRTC IP handling to Default.",
          "Reload this tab and try again.",
        ],
      };
    case "tor":
      return {
        heading: "TOR BROWSER BLOCKS PEER-TO-PEER VIDEO",
        body:
          "Tor Browser disables WebRTC at the Safer and Safest security levels. Real-time video also conflicts with Tor’s anonymity model — it routes media off the Tor network.",
        steps: [
          "If you need this call, open VOID in a different browser.",
          "If you opened VOID through a .onion mirror, the room phrase still works in any normal browser.",
        ],
      };
    case "mullvad":
      return {
        heading: "MULLVAD BROWSER HAS WEBRTC DISABLED",
        body:
          "Mullvad Browser ships with media.peerconnection.enabled set to false. VOID needs that turned on to connect peers.",
        steps: [
          "Open about:config in Mullvad Browser.",
          "Set media.peerconnection.enabled to true.",
          "Reload this tab and try again. (You can switch it back after the call.)",
        ],
      };
    case "librewolf":
      return {
        heading: "LIBREWOLF HAS WEBRTC DISABLED",
        body:
          "LibreWolf disables media.peerconnection.enabled by default for fingerprinting reasons. VOID needs it enabled to connect.",
        steps: [
          "Open about:config in LibreWolf.",
          "Set media.peerconnection.enabled to true.",
          "Reload this tab and try again.",
        ],
      };
    case "brave":
      // The async runtime check raced ahead of the UA-based detection.
      return guidanceFor(null, true);
    case null:
    default:
      return {
        heading: "YOUR BROWSER IS BLOCKING PEER-TO-PEER MEDIA",
        body:
          "VOID could not gather any of the network candidates it needs to connect. This usually means a browser setting or an admin policy is restricting WebRTC.",
        steps: [
          "Check your browser’s WebRTC or privacy settings.",
          "On a managed work device, ask your admin about the WebRTC policy.",
          "Or open VOID in Firefox, Chrome, or Safari with default settings.",
        ],
      };
  }
}

export default function BrowserBlockedScreen({ detected, brave = false, onBack }: Props) {
  const g = guidanceFor(detected, brave);
  return (
    <div
      data-testid="browser-blocked-screen"
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
        gap: "20px",
      }}
    >
      <div style={{ maxWidth: "520px", display: "flex", flexDirection: "column", gap: "18px" }}>
        <h1
          style={{
            fontSize: "16px",
            letterSpacing: "2px",
            margin: 0,
            color: "var(--gold)",
            textTransform: "uppercase",
            alignSelf: "center",
            background: "#0a0a0a",
            border: "1px solid var(--gold)",
            padding: "8px 14px",
          }}
        >
          {g.heading}
        </h1>
        <p style={{ fontSize: "13px", lineHeight: 1.55, margin: 0 }}>{g.body}</p>
        <ol
          style={{
            textAlign: "left",
            fontSize: "12px",
            lineHeight: 1.6,
            paddingLeft: "22px",
            margin: 0,
          }}
        >
          {g.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {/* contrast-exception: sits on the page's light var(--bg) body
            (--fg-dim = 6.56:1); the scanner pairs it with the sibling
            heading's #0a0a0a chip above. */}
        <p style={{ fontSize: "11px", letterSpacing: "1.5px", color: "var(--fg-dim)", margin: 0 }}>
          NOTHING WAS SENT. THE ROOM PHRASE STAYED ON YOUR DEVICE.
        </p>
        <button
          type="button"
          onClick={onBack}
          style={{
            alignSelf: "center",
            marginTop: "8px",
            background: "transparent",
            /* contrast-exception: transparent button on the page's light
               var(--bg) body (--fg = 8+:1); the scanner pairs it with the
               sibling heading's #0a0a0a chip above. */
            color: "var(--fg)",
            border: "1px solid var(--fg-dim, #555)",
            padding: "10px 18px",
            fontFamily: "inherit",
            fontSize: "12px",
            letterSpacing: "2px",
            cursor: "pointer",
          }}
        >
          BACK
        </button>
      </div>
    </div>
  );
}
