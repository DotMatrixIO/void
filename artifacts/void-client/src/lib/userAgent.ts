// SPDX-License-Identifier: AGPL-3.0-or-later
// User-agent + runtime detection for two failure modes we cannot fix at
// the protocol layer:
//
//   1. The page was opened inside an in-app webview (Instagram,
//      Facebook, TikTok, LinkedIn, WeChat, etc.). These embed a stripped
//      WKWebView/WebView that often denies camera/microphone access,
//      has no PWA install, and on some Android variants does not wire
//      WebRTC at all. The only fix is to hand the user back to their
//      real browser.
//
//   2. The page is being viewed in a privacy-hardened browser that
//      ships with WebRTC restricted or disabled by default (Tor
//      Browser, Mullvad Browser, LibreWolf, Vanadium on GrapheneOS,
//      Brave with Shields set to Strict). The user has to flip a
//      setting in their browser — the page cannot un-flip it for them.
//
// Both checks are intentionally conservative: a false positive blocks a
// real call. We prefer to miss a flavor of the same browser than to
// wrongly intercept a working clearnet Chrome session.
//
// All checks read `navigator.userAgent` plus a few documented runtime
// hooks (`navigator.brave?.isBrave()`). They never make a network
// request, and they never touch storage.

export type InAppBrowser =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "linkedin"
  | "wechat"
  | "line"
  | "snapchat"
  | "twitter"
  | "generic-webview";

export type PrivacyBrowser =
  | "tor"
  | "mullvad"
  | "librewolf"
  | "vanadium"
  | "brave"
  | null;

export interface UserAgentInfo {
  /** The raw UA string we sniffed (lower-cased), exposed for tests/logging. */
  readonly raw: string;
  /** Non-null when the page is running inside a known in-app webview. */
  readonly inAppBrowser: InAppBrowser | null;
  /** The privacy-hardened browser family, when one is detected. */
  readonly privacyBrowser: PrivacyBrowser;
  /** True when running on iOS (UA-based; webviews on iOS are uniformly Safari-based). */
  readonly isIOS: boolean;
  /** True when running on Android. */
  readonly isAndroid: boolean;
}

function getUserAgentString(ua?: string): string {
  if (typeof ua === "string") return ua;
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    return navigator.userAgent;
  }
  return "";
}

export function detectInAppBrowser(ua: string): InAppBrowser | null {
  const s = ua.toLowerCase();
  // Order matters: more specific matches first. Several SDKs piggy-back
  // on the Facebook tokens (FBAN/FBAV) so the Instagram-specific token
  // wins before we fall back to Facebook.
  if (s.includes("instagram")) return "instagram";
  if (s.includes("fban") || s.includes("fbav") || s.includes("fb_iab")) return "facebook";
  if (s.includes("musical_ly") || s.includes("bytedancewebview") || s.includes("tiktok")) {
    return "tiktok";
  }
  if (s.includes("linkedinapp")) return "linkedin";
  if (s.includes("micromessenger")) return "wechat";
  if (s.includes("line/")) return "line";
  if (s.includes("snapchat")) return "snapchat";
  // Twitter/X uses `Twitter for iPhone` / `TwitterAndroid` tokens. We
  // require one of those specific patterns rather than the bare word
  // `twitter` so that, e.g., a tweet URL pasted into a desktop browser
  // doesn't false-positive.
  if (/twitter for|twitterandroid/i.test(s)) return "twitter";

  // Generic Android WebView fingerprint: `; wv)` is the canonical token
  // emitted by Chrome WebView and is absent from Chrome proper. We use
  // this as a last-resort match so apps that don't advertise their own
  // SDK still get the same intercept.
  if (s.includes("android") && /; wv\)/i.test(s)) return "generic-webview";

  return null;
}

/**
 * Detect a privacy-hardened browser family that ships with WebRTC
 * restricted or disabled by default. Returns `null` when we cannot
 * positively identify the user as being in such a browser.
 *
 * Caveats:
 *   - Tor Browser, Mullvad, and LibreWolf advertise as Firefox in their
 *     UA. We disambiguate on the family-specific tokens they include
 *     (`Mullvad`, `LibreWolf`) plus, for Tor Browser, the well-known
 *     fingerprint-resistance Windows-only UA "Windows NT 10.0; rv:..."
 *     paired with `Gecko/20100101 Firefox/`. The Tor heuristic is the
 *     softest of the bunch; treat it as a hint, not a guarantee.
 *   - Brave does not advertise itself in the UA at all (it spoofs
 *     Chrome to defeat fingerprinting). We detect it via the documented
 *     `navigator.brave.isBrave()` API at runtime, not from the string.
 *   - Vanadium (GrapheneOS) also spoofs Chrome. The only reliable token
 *     is the GrapheneOS Vanadium UA quirk plus the presence of
 *     `Vanadium` when the user has opted into that string. We surface
 *     it as a best-effort hint only.
 */
export function detectPrivacyBrowser(ua: string): PrivacyBrowser {
  const s = ua.toLowerCase();
  if (s.includes("mullvad")) return "mullvad";
  if (s.includes("librewolf")) return "librewolf";
  if (s.includes("vanadium")) return "vanadium";
  // Tor Browser ships the Firefox ESR UA with no distinguishing token
  // (by design, to enlarge the anonymity set). Most Tor Browser users
  // reach VOID over a `.onion` mirror; that path is already handled
  // separately by `isOnionOrigin()` in `origin.ts`. We keep the
  // explicit `tor` token check for the rare clearnet-Tor user.
  if (s.includes("torbrowser")) return "tor";
  return null;
}

/**
 * Best-effort runtime check for Brave. Brave exposes
 * `navigator.brave.isBrave()` since 2021 specifically so sites can ask;
 * the call is asynchronous and never throws. Wrap so a non-Brave
 * runtime resolves to `false` immediately.
 */
export async function isBraveBrowser(): Promise<boolean> {
  try {
    const nav = navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } };
    if (nav.brave && typeof nav.brave.isBrave === "function") {
      return await nav.brave.isBrave();
    }
  } catch {
    // Fall through.
  }
  return false;
}

export function describeUserAgent(ua?: string): UserAgentInfo {
  const raw = getUserAgentString(ua);
  const lower = raw.toLowerCase();
  return {
    raw,
    inAppBrowser: detectInAppBrowser(raw),
    privacyBrowser: detectPrivacyBrowser(raw),
    isIOS: /iphone|ipad|ipod/.test(lower),
    isAndroid: /android/.test(lower) && !/; wv\)/i.test(raw),
  };
}
