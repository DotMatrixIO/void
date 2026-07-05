# Browser Compatibility

VOID is a WebRTC product. A browser that refuses to gather UDP ICE
candidates cannot connect a call no matter what we do at the protocol
layer. This page lists the browsers that block, degrade, or work fine,
and describes the in-app pre-flight gates that intercept the broken
cases before the user wastes a permission prompt.

## Tier 1 — Blocks calls by default

These browsers either disable WebRTC outright or restrict it to proxied
UDP. The result is identical every time: signaling succeeds, ICE
finishes with no usable candidates, and the call silently times out.
The user must change a browser setting; we cannot un-change it for
them.

| Browser                            | Default behavior                                 | Fix                                                      |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| Tor Browser (Safer / Safest)       | WebRTC disabled                                  | Lower the security level, or open VOID in a real browser |
| Mullvad Browser                    | `media.peerconnection.enabled = false`           | Flip it in `about:config`                                |
| LibreWolf                          | `media.peerconnection.enabled = false`           | Flip it in `about:config`                                |
| Vanadium (GrapheneOS)              | WebRTC IP handling = "Disabled non-proxied UDP"  | Switch to Default in `vanadium://settings/content/webrtc`|
| Brave (Shields → Strict)           | Fingerprint blocking restricts WebRTC            | Switch fingerprint blocking to Standard for the site     |
| Managed Chrome/Edge w/ `WebRtcLocalIpsAllowedUrls` | UDP candidates suppressed              | Ask IT, or use a non-managed device                      |

The void-client runs a 3-second `probeWebRtcCapability()` on
`PreviewGate` mount. If no usable ICE candidate arrives, it swaps the
preview UI for `BrowserBlockedScreen` with browser-specific copy. See
`artifacts/void-client/src/lib/browserCapability.ts`.

## Tier 1 — In-app webviews

Embedded webviews (Instagram, Facebook, TikTok, LinkedIn, WeChat, Line,
Snapchat, Twitter/X, generic Android WebView) typically deny
`getUserMedia`, strip PWA install, and on some Android variants do not
wire WebRTC at all. The only fix is to open the page in a real browser.

The void-client intercepts these UAs in `App.tsx` (`Home()`) before
PreviewGate ever mounts, and shows `InAppBrowserScreen` with a copyable
URL plus per-OS instructions for opening the link in the real browser.
On Android, the screen also renders an "Open in Chrome" deep link that
uses the `googlechrome://navigate?url=<encoded>` scheme. We pick that
scheme over the canonical `intent://` URI because VOID room URLs carry
the phrase in the hash fragment, and `intent://` uses `#Intent;...` as
the start of intent extras — the two `#`s collide and truncate the
phrase. `googlechrome://navigate?url=` URL-encodes the full URL as a
query value, so the hash survives intact.

Detection rules live in `artifacts/void-client/src/lib/userAgent.ts`.

## Tier 2 — Works, with caveats

| Browser           | Caveat                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------- |
| Safari (iOS)      | Autoplay restrictions, Low Power Mode drops frame rate, background tabs suspend         |
| Firefox (Android) | Hardware H.264 support varies by device; screen-share API has had regressions           |
| Samsung Internet  | Secret Mode disables some WebRTC features                                               |
| Brave (Standard)  | Fine. Strict mode is Tier 1; standard mode passes the probe                             |

## Tier 3 — Annoying but not blocking

| Knob                                                       | Effect                                       |
| ---------------------------------------------------------- | -------------------------------------------- |
| `chrome://flags` → "Anonymize local IPs exposed by WebRTC" | Suppresses host candidates; relies on TURN   |
| Tor wallet / Tor node in user's Lightning setup            | Slower paywall; does not affect media        |

## Adding a new privacy-browser variant

1. Add the UA token to `detectPrivacyBrowser` in
   `artifacts/void-client/src/lib/userAgent.ts`.
2. Add a guidance entry to `guidanceFor` in
   `artifacts/void-client/src/components/BrowserBlockedScreen.tsx`.
3. Add a UA matcher test to `userAgent.test.ts`.
4. Add a rendering test to `BrowserBlockedScreen.test.tsx`.

## Manual test matrix

The pre-flight gates are most easily verified by hand. Suggested rota
before each launch:

- Desktop Firefox, Chrome, Safari — baseline (probe → ok)
- iOS Safari — baseline (probe → ok)
- Android Chrome — baseline (probe → ok)
- Instagram in-app browser (iOS or Android) — should hit `InAppBrowserScreen`
- Vanadium on GrapheneOS — should hit `BrowserBlockedScreen` with Vanadium copy
- LibreWolf or Mullvad — should hit `BrowserBlockedScreen` with about:config copy

If any of these regress, the corresponding unit test in
`src/lib/userAgent.test.ts` or
`src/components/BrowserBlockedScreen.test.tsx` should be updated to
lock in the new behavior.
