// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #667 — Device-cloud Safari WebRTC automation.
//
// Headless WebKit on Linux (Playwright's WPE/GTK port) does not gather
// ICE candidates, so the local cross-engine flow gate can only assert a
// loopback RTCPeerConnection on Chromium/Firefox and SKIPS the WebRTC
// assertion on WebKit (see cross-engine-flow.spec.ts). This helper wires
// Playwright up to a *real* Safari/WebKit running on a device-cloud
// provider (BrowserStack by default) so that the live Safari WebRTC stack
// can be exercised automatically instead of relying solely on the manual
// iOS-Safari runbook row.
//
// The connection is provider-agnostic: any provider that exposes a
// Playwright-over-CDP `wsEndpoint` for real WebKit works. BrowserStack is
// the default because its `cdp.browserstack.com/playwright` endpoint runs
// genuine Safari on real macOS. Point `DEVICE_CLOUD_WS_ENDPOINT` at a
// different provider (Sauce Labs, LambdaTest, …) to override.
//
// Credentials are never hard-coded — they are read from the environment so
// the test stays a no-op (cleanly SKIPPED, never falsely PASSED) when the
// device cloud is not configured, and becomes a real gate the moment the
// secrets are present in CI.

/**
 * Resolved device-cloud configuration. `wsEndpoint` is what Playwright's
 * `webkit.connect()` dials; `targetUrl` is the publicly reachable origin
 * of the app under test (the cloud browser cannot see `localhost`).
 */
export interface DeviceCloudConfig {
  wsEndpoint: string;
  targetUrl: string;
  /** Human-readable provider label for logs / session naming. */
  provider: string;
  /** The capabilities object encoded into the BrowserStack endpoint. */
  capabilities: Record<string, unknown>;
}

/** Why the device-cloud run is being skipped, for a precise annotation. */
export interface DeviceCloudSkip {
  skip: true;
  reason: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Build a BrowserStack `playwright-over-CDP` endpoint from credentials and
 * desired capabilities. BrowserStack runs real Safari on real macOS for
 * the `playwright-webkit` browser, which (unlike Linux headless WebKit)
 * gathers ICE candidates and completes a peer connection.
 */
function browserStackEndpoint(
  username: string,
  accessKey: string,
  capabilities: Record<string, unknown>,
): string {
  const caps = {
    "browserstack.username": username,
    "browserstack.accessKey": accessKey,
    ...capabilities,
  };
  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(
    JSON.stringify(caps),
  )}`;
}

/**
 * Default target URL. The masked-output assertion needs the DEV-only
 * `/__test/joined-call` route, which the Replit dev domain serves and
 * which is publicly reachable by a cloud browser. When running against a
 * production build (no `__test` routes), set `DEVICE_CLOUD_TARGET_URL`
 * explicitly and the masked-output sub-check will skip itself.
 */
function defaultTargetUrl(): string | undefined {
  const explicit = env("DEVICE_CLOUD_TARGET_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const devDomain = env("REPLIT_DEV_DOMAIN");
  if (devDomain) return `https://${devDomain.replace(/\/$/, "")}`;
  return undefined;
}

/**
 * Resolve device-cloud config from the environment, or return a
 * {@link DeviceCloudSkip} describing exactly what is missing. Callers pass
 * the result to `test.skip()` so an unconfigured environment yields a
 * clean SKIP (exit 0) rather than a false pass or a hard failure.
 */
export function resolveDeviceCloud(): DeviceCloudConfig | DeviceCloudSkip {
  const targetUrl = defaultTargetUrl();
  if (!targetUrl) {
    return {
      skip: true,
      reason:
        "No device-cloud target URL. Set DEVICE_CLOUD_TARGET_URL (or run where REPLIT_DEV_DOMAIN is set) to the publicly reachable origin of the app under test.",
    };
  }

  // Capabilities: default to real Safari on real macOS. Override per
  // provider/version via env. iOS-Safari-on-Playwright support varies by
  // provider; macOS Safari is the portable default and is genuine WebKit.
  const capabilities: Record<string, unknown> = {
    browser: env("DEVICE_CLOUD_BROWSER") ?? "playwright-webkit",
    os: env("DEVICE_CLOUD_OS") ?? "os x",
    os_version: env("DEVICE_CLOUD_OS_VERSION") ?? "sonoma",
    name: env("DEVICE_CLOUD_SESSION_NAME") ?? "VOID — Safari WebRTC (Task #667)",
    build: env("DEVICE_CLOUD_BUILD") ?? "void-client-safari-webrtc",
    "browserstack.networkLogs": "false",
  };

  // Full endpoint override wins — lets non-BrowserStack providers plug in
  // their own Playwright-over-CDP URL without touching this file.
  const wsOverride = env("DEVICE_CLOUD_WS_ENDPOINT");
  if (wsOverride) {
    return {
      wsEndpoint: wsOverride,
      targetUrl,
      provider: env("DEVICE_CLOUD_PROVIDER") ?? "custom",
      capabilities,
    };
  }

  const username =
    env("BROWSERSTACK_USERNAME") ?? env("DEVICE_CLOUD_USERNAME");
  const accessKey =
    env("BROWSERSTACK_ACCESS_KEY") ?? env("DEVICE_CLOUD_ACCESS_KEY");
  if (!username || !accessKey) {
    return {
      skip: true,
      reason:
        "No device-cloud credentials. Set BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY (or DEVICE_CLOUD_WS_ENDPOINT for another provider) to run real Safari WebRTC.",
    };
  }

  return {
    wsEndpoint: browserStackEndpoint(username, accessKey, capabilities),
    targetUrl,
    provider: env("DEVICE_CLOUD_PROVIDER") ?? "browserstack",
    capabilities,
  };
}

/** Narrowing helper for the skip branch. */
export function isDeviceCloudSkip(
  value: DeviceCloudConfig | DeviceCloudSkip,
): value is DeviceCloudSkip {
  return (value as DeviceCloudSkip).skip === true;
}

/**
 * The two-peer loopback WebRTC probe, as a string to inject via
 * `page.evaluate`. Identical in intent to the loopback probe in
 * cross-engine-flow.spec.ts, but here it runs inside *real* Safari: a
 * successful ICE connection + open data channel proves Safari's live
 * WebRTC transport — the one the actual call rides on — works end to end.
 */
export async function runLoopbackProbe(
  page: import("@playwright/test").Page,
): Promise<{
  outcome: "ok" | "timeout";
  connectionState: string;
  iceConnectionState: string;
}> {
  return page.evaluate(async () => {
    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    try {
      a.onicecandidate = (e) => {
        if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {});
      };
      b.onicecandidate = (e) => {
        if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {});
      };

      const channelOpen = new Promise<boolean>((resolve) => {
        const dc = a.createDataChannel("probe");
        dc.onopen = () => resolve(true);
      });

      const connected = new Promise<boolean>((resolve) => {
        const check = () => {
          if (
            a.connectionState === "connected" ||
            a.iceConnectionState === "connected" ||
            a.iceConnectionState === "completed"
          ) {
            resolve(true);
          }
        };
        a.onconnectionstatechange = check;
        a.oniceconnectionstatechange = check;
      });

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);

      const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 20_000),
      );

      const both = await Promise.race([
        Promise.all([channelOpen, connected]).then(() => "ok" as const),
        timeout,
      ]);

      return {
        outcome: both,
        connectionState: a.connectionState,
        iceConnectionState: a.iceConnectionState,
      };
    } finally {
      a.close();
      b.close();
    }
  });
}

/** Outcome of {@link runDtmfNegotiationProbe}. */
export interface DtmfNegotiationResult {
  outcome: "ok" | "timeout";
  connectionState: string;
  iceConnectionState: string;
  /**
   * The RAW, pre-munge offer the browser produced. The DTMF payload-type
   * removal assertion is anchored to the telephone-event PTs found HERE
   * (what genuine Safari advertised) — not to the post-munge SDP, which
   * would make the assertion vacuous.
   */
  rawOfferSdp: string;
  /** Negotiated SDP that actually governs the live session, both peers, both directions. */
  offererLocal: string;
  offererRemote: string;
  answererLocal: string;
  answererRemote: string;
}

/**
 * Drive a real negotiated audio session inside *real* Safari and return
 * the raw (pre-munge) offer plus the negotiated SDP on both peers in both
 * directions, after applying the app's PRODUCTION munge
 * (`window.__voidWebrtcTesting.clampOpusBitrate`, the DEV-only hook in
 * `src/main.tsx` that re-exports the exact function the call path uses).
 *
 * This is the device-cloud counterpart to the DTMF negotiation probe in
 * cross-engine-flow.spec.ts. Two differences, both deliberate:
 *
 *   1. An audio *transceiver* is used instead of `getUserMedia`. The
 *      device-cloud config has no fake-media flags, so a real Safari would
 *      block on a microphone-permission prompt no one can click.
 *      `addTransceiver("audio")` still makes the browser emit a real audio
 *      m-section that advertises telephone-event — which is all the DTMF
 *      strip needs to act on. The caller's raw-offer DTMF guard
 *      (PT count > 0) proves the section really advertised telephone-event,
 *      so the strip assertion is never vacuous.
 *   2. The munge is resolved from `window.__voidWebrtcTesting` inside the
 *      page; the caller must verify the hook is present (and skip cleanly
 *      against a prod target that lacks the DEV-only hook) before calling.
 */
export async function runDtmfNegotiationProbe(
  page: import("@playwright/test").Page,
): Promise<DtmfNegotiationResult> {
  return page.evaluate(async () => {
    const munge = (
      window as unknown as {
        __voidWebrtcTesting: { clampOpusBitrate: (sdp: string) => string };
      }
    ).__voidWebrtcTesting.clampOpusBitrate;

    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();

    try {
      a.onicecandidate = (e) => {
        if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {});
      };
      b.onicecandidate = (e) => {
        if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {});
      };

      // An audio transceiver makes the browser emit a real audio
      // m-section advertising telephone-event — without a mic prompt.
      a.addTransceiver("audio", { direction: "sendrecv" });

      const connected = new Promise<boolean>((resolve) => {
        const check = () => {
          if (
            a.connectionState === "connected" ||
            a.iceConnectionState === "connected" ||
            a.iceConnectionState === "completed"
          ) {
            resolve(true);
          }
        };
        a.onconnectionstatechange = check;
        a.oniceconnectionstatechange = check;
      });

      // Real browser-generated offer (carries telephone-event), then the
      // production munge, then a genuine offer/answer exchange.
      const rawOffer = await a.createOffer();
      const rawOfferSdp = rawOffer.sdp ?? "";
      const mungedOfferSdp = munge(rawOfferSdp);
      await a.setLocalDescription({ type: "offer", sdp: mungedOfferSdp });
      await b.setRemoteDescription(a.localDescription!);

      const rawAnswer = await b.createAnswer();
      const mungedAnswerSdp = munge(rawAnswer.sdp ?? "");
      await b.setLocalDescription({ type: "answer", sdp: mungedAnswerSdp });
      await a.setRemoteDescription(b.localDescription!);

      const timeout = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 20_000),
      );
      const outcome = await Promise.race([
        connected.then(() => "ok" as const),
        timeout,
      ]);

      return {
        outcome,
        connectionState: a.connectionState,
        iceConnectionState: a.iceConnectionState,
        rawOfferSdp,
        offererLocal: a.localDescription?.sdp ?? "",
        offererRemote: a.remoteDescription?.sdp ?? "",
        answererLocal: b.localDescription?.sdp ?? "",
        answererRemote: b.remoteDescription?.sdp ?? "",
      };
    } finally {
      a.close();
      b.close();
    }
  });
}
