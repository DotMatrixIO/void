// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  describeUserAgent,
  detectInAppBrowser,
  detectPrivacyBrowser,
} from "./userAgent";

describe("detectInAppBrowser", () => {
  it("matches Instagram's in-app webview", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 343.0.0.18.96",
      ),
    ).toBe("instagram");
  });

  it("matches Facebook's FBAN/FBAV tokens", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 FBAN/FBIOS;FBAV/486.0;FBBV/123",
      ),
    ).toBe("facebook");
  });

  it("matches TikTok via musical_ly and BytedanceWebview", () => {
    expect(detectInAppBrowser("BytedanceWebview/1.0 musical_ly")).toBe("tiktok");
  });

  it("matches LinkedIn", () => {
    expect(detectInAppBrowser("AppleWebKit/605.1.15 LinkedInApp/9.30")).toBe("linkedin");
  });

  it("matches WeChat via MicroMessenger", () => {
    expect(detectInAppBrowser("Mozilla/5.0 MicroMessenger/8.0")).toBe("wechat");
  });

  it("matches Line and Snapchat", () => {
    expect(detectInAppBrowser("Mozilla/5.0 Line/13.0.0")).toBe("line");
    expect(detectInAppBrowser("AppleWebKit/605.1.15 Snapchat/12.50")).toBe("snapchat");
  });

  it("matches generic Android WebView via the ;wv) token", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("generic-webview");
  });

  it("does NOT match a desktop UA that merely contains the word 'twitter' (URL bar etc.)", () => {
    // Conservative-detection contract: only the canonical in-app tokens
    // count, not the bare word 'twitter'.
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 (with a twitter link)",
      ),
    ).toBeNull();
  });

  it("DOES match the X/Twitter native iOS app", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Twitter for iPhone",
      ),
    ).toBe("twitter");
  });

  it("DOES match the X/Twitter native Android app", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 TwitterAndroid",
      ),
    ).toBe("twitter");
  });

  it("does NOT match desktop Chrome", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBeNull();
  });

  it("does NOT match mobile Safari proper", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBeNull();
  });

  it("does NOT match mobile Chrome on Android (no ;wv) token)", () => {
    expect(
      detectInAppBrowser(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      ),
    ).toBeNull();
  });
});

describe("detectPrivacyBrowser", () => {
  it("matches Mullvad Browser", () => {
    expect(
      detectPrivacyBrowser(
        "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0 MullvadBrowser/13.5",
      ),
    ).toBe("mullvad");
  });

  it("matches LibreWolf", () => {
    expect(
      detectPrivacyBrowser(
        "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0 LibreWolf/130.0",
      ),
    ).toBe("librewolf");
  });

  it("matches Vanadium when the UA exposes the token", () => {
    expect(
      detectPrivacyBrowser(
        "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Vanadium/130.0",
      ),
    ).toBe("vanadium");
  });

  it("matches Tor Browser via the torbrowser token", () => {
    expect(detectPrivacyBrowser("Mozilla/5.0 TorBrowser/13.5")).toBe("tor");
  });

  it("returns null for plain Firefox", () => {
    expect(
      detectPrivacyBrowser(
        "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
      ),
    ).toBeNull();
  });

  it("returns null for plain Chrome (Brave is checked via runtime API, not UA)", () => {
    expect(
      detectPrivacyBrowser(
        "Mozilla/5.0 (Macintosh) Chrome/130.0.0.0 Safari/537.36",
      ),
    ).toBeNull();
  });
});

describe("describeUserAgent", () => {
  it("reports iOS for iPhone UAs", () => {
    const info = describeUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );
    expect(info.isIOS).toBe(true);
    expect(info.isAndroid).toBe(false);
  });

  it("reports Android only when ;wv) is absent (so the UA is a real browser, not a webview)", () => {
    const browser = describeUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0.0.0 Mobile Safari/537.36",
    );
    expect(browser.isAndroid).toBe(true);
    const webview = describeUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) Chrome/130.0.0.0 Mobile Safari/537.36",
    );
    expect(webview.isAndroid).toBe(false);
    expect(webview.inAppBrowser).toBe("generic-webview");
  });
});
