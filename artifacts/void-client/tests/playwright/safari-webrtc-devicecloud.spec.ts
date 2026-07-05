// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #667 — Automate real Safari WebRTC on a device cloud.
//
// This is the automated counterpart to the manual iOS-Safari runbook row.
// The local cross-engine flow gate (cross-engine-flow.spec.ts) cannot
// assert WebRTC on WebKit because Playwright's headless Linux WebKit does
// not gather ICE candidates — so it SKIPS the loopback probe there and
// points at this spec for live-Safari coverage.
//
// Here we connect Playwright to a *real* Safari/WebKit on a device-cloud
// provider (BrowserStack by default; any Playwright-over-CDP provider via
// DEVICE_CLOUD_WS_ENDPOINT) and:
//
//   1. Assert the landing page renders over the real cloud browser
//      (proves reachability + that genuine Safari can render the app).
//   2. Establish a real two-peer loopback RTCPeerConnection inside that
//      Safari and assert it reaches the connected state with an open data
//      channel — the assertion the headless WebKit run cannot make.
//   3. (Best-effort) Render the synthetic joined-call route and assert the
//      masked video grid paints under real Safari. This needs the DEV-only
//      `/__test/joined-call` route; against a production target the route
//      is absent and this sub-check skips itself rather than failing.
//
// Credentials and the target URL come from the environment. When they are
// absent the whole describe SKIPS cleanly (never a false pass), so this
// file is safe to run anywhere and becomes a real gate only once the
// device cloud is wired up in CI. Run with:
//
//   pnpm --filter @workspace/void-client run test:playwright:devicecloud

import { test, expect, webkit, type Browser } from "@playwright/test";
import {
  resolveDeviceCloud,
  isDeviceCloudSkip,
  runLoopbackProbe,
  runDtmfNegotiationProbe,
  type DeviceCloudConfig,
} from "./lib/device-cloud";

const resolved = resolveDeviceCloud();

// Collect the DTMF (telephone-event) payload-type numbers declared in
// every audio m-section of an SDP, scoped per section (PTs are
// section-local, so we only count telephone-event rtpmaps that fall
// inside an `m=audio` block). Run against the RAW, pre-munge offer so the
// PT-removal assertion is anchored to PTs genuine Safari actually
// advertised — not to whatever survives post-munge (which would be
// vacuous). Mirrors the helper in cross-engine-flow.spec.ts.
function audioDtmfPts(sdp: string): Set<string> {
  const lines = sdp.split(/\r\n|\n/);
  const pts = new Set<string>();
  let inAudio = false;
  for (const line of lines) {
    if (/^m=/.test(line)) inAudio = /^m=audio\s/.test(line);
    if (!inAudio) continue;
    const m = line.match(/^a=rtpmap:(\d+)\s+telephone-event\//i);
    if (m) pts.add(m[1]);
  }
  return pts;
}

// Collect every payload-type token from every `m=audio` format list in an
// SDP (the PT numbers after `m=audio <port> <proto>`). Mirrors the helper
// in cross-engine-flow.spec.ts.
function audioFormatPts(sdp: string): Set<string> {
  const pts = new Set<string>();
  for (const line of sdp.split(/\r\n|\n/)) {
    if (!/^m=audio\s/.test(line)) continue;
    for (const pt of line.split(" ").slice(3)) pts.add(pt);
  }
  return pts;
}

// Whether the SDP advertises an Opus codec in any m=audio section. The
// raw-offer guard for the privacy-clamp assertion so it can never pass
// vacuously on a Safari that did not offer Opus. Mirrors the helper in
// cross-engine-flow.spec.ts.
function audioHasOpus(sdp: string): boolean {
  let inAudio = false;
  for (const line of sdp.split(/\r\n|\n/)) {
    if (/^m=/.test(line)) inAudio = /^m=audio\s/.test(line);
    if (inAudio && /^a=rtpmap:\d+\s+opus\//i.test(line)) return true;
  }
  return false;
}

// Extract the fmtp params string for every Opus payload type declared in
// any m=audio section. Used to assert the privacy clamps (cbr=1,
// usedtx=0, maxaveragebitrate=24000, stereo=0) survived negotiation.
// Mirrors the helper in cross-engine-flow.spec.ts.
function audioOpusFmtps(sdp: string): string[] {
  const lines = sdp.split(/\r\n|\n/);
  const opusPts = new Set<string>();
  let inAudio = false;
  for (const line of lines) {
    if (/^m=/.test(line)) inAudio = /^m=audio\s/.test(line);
    if (!inAudio) continue;
    const m = line.match(/^a=rtpmap:(\d+)\s+opus\//i);
    if (m) opusPts.add(m[1]);
  }
  const fmtps: string[] = [];
  inAudio = false;
  for (const line of lines) {
    if (/^m=/.test(line)) inAudio = /^m=audio\s/.test(line);
    if (!inAudio) continue;
    const m = line.match(/^a=fmtp:(\d+)\s+(.*)$/);
    if (m && opusPts.has(m[1])) fmtps.push(m[2]);
  }
  return fmtps;
}

// Whether any extmap line declares the ssrc-audio-level RTP header
// extension (the per-packet loudness side-channel the munge strips).
// Mirrors the strip predicate in src/lib/webrtcSdp.ts and the helper in
// cross-engine-flow.spec.ts.
function hasSsrcAudioLevel(sdp: string): boolean {
  return sdp
    .split(/\r\n|\n/)
    .some((l) =>
      /^a=extmap:\d+(\/[^ ]*)?\s+urn:ietf:params:rtp-hdrext:ssrc-audio-level\b/i.test(
        l,
      ),
    );
}

test.describe("real Safari WebRTC (device cloud)", () => {
  // Connecting to a remote grid + real-device boot is slow; give each test
  // room without flaking on cold provider sessions.
  test.setTimeout(180_000);

  // Skip the entire suite (with a precise reason) when the device cloud is
  // not configured. Playwright records this as SKIPPED, exit 0.
  test.skip(
    isDeviceCloudSkip(resolved),
    isDeviceCloudSkip(resolved) ? resolved.reason : undefined,
  );

  const config = resolved as DeviceCloudConfig;

  let browser: Browser;

  test.beforeAll(async () => {
    browser = await webkit.connect(config.wsEndpoint);
  });

  test.afterAll(async () => {
    await browser?.close();
  });

  test("genuine Safari renders the landing host/join controls", async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByRole("button", { name: "HOST A ROOM" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole("button", { name: "JOIN A ROOM" }),
      ).toBeVisible();
    } finally {
      await page.context().close();
    }
  });

  test("genuine Safari establishes a loopback WebRTC peer connection", async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      // Same-origin normal document so the in-page RTCPeerConnection runs
      // in a real page context (not about:blank).
      await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

      const result = await runLoopbackProbe(page);

      expect(
        result.outcome,
        `Real Safari WebRTC loopback did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState}). ` +
          `Unlike headless Linux WebKit, genuine Safari should gather ICE candidates and complete the connection.`,
      ).toBe("ok");
    } finally {
      await page.context().close();
    }
  });

  test("genuine Safari renders the masked joined-call output", async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      // The masked-stream surface lives behind the DEV-only synthetic
      // joined-call route. On a production target it does not exist, so we
      // probe for it and skip (not fail) if it is absent.
      const joinedCallUrl = `${config.targetUrl}/__test/joined-call`;
      const response = await page.goto(joinedCallUrl, {
        waitUntil: "domcontentloaded",
      });

      const controlBar = page.getByTestId("room-control-bar");
      const grid = page.locator(".void-video-grid").first();

      const rendered = await controlBar
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);

      test.skip(
        !rendered,
        `Synthetic joined-call route not available at ${joinedCallUrl} ` +
          `(HTTP ${response?.status() ?? "?"}). The masked-output assertion ` +
          `needs a DEV-mode target that serves the /__test routes; on a ` +
          `production target this sub-check is skipped. Peer-connection ` +
          `establishment is still covered by the loopback test above.`,
      );

      // The local tile renders the masked processedStream (PeerTileGrid
      // enforces never showing the raw camera), so a visible grid under
      // real Safari is the masked-output surface painting end to end.
      await expect(grid).toBeVisible({ timeout: 30_000 });
    } finally {
      await page.context().close();
    }
  });

  // Task #884 — Prove DTMF can't flow on real Safari either.
  //
  // The local cross-engine gate proves a real Chromium/Firefox negotiated
  // call comes out with no DTMF (telephone-event) codec, but it SKIPS that
  // assertion on headless WebKit (no ICE on Linux). This is the genuine
  // Safari counterpart: it drives a real negotiated audio session inside
  // real Safari on the device cloud, applies the app's PRODUCTION munge,
  // completes the handshake, and asserts the negotiated local + remote SDP
  // on BOTH peers has no telephone-event rtpmap and that the DTMF payload
  // type the raw offer advertised is gone from every m=audio format list.
  // Closing this engine gap means "DTMF can never flow" is verified on real
  // Safari, not just Chromium/Firefox.
  test("a real negotiated audio session carries no DTMF (telephone-event)", async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

      // The DEV-only hook re-exports the exact SDP munge the call path
      // uses. It is absent on a production build, so against a prod target
      // we SKIP cleanly (matching the masked-output sub-check above and the
      // suite's skip discipline) rather than fail — the dev domain target
      // serves it. Peer-connection establishment is still covered by the
      // loopback test above regardless.
      const hookPresent = await page.evaluate(
        () =>
          typeof (
            window as unknown as {
              __voidWebrtcTesting?: { clampOpusBitrate?: unknown };
            }
          ).__voidWebrtcTesting?.clampOpusBitrate === "function",
      );
      test.skip(
        !hookPresent,
        `window.__voidWebrtcTesting.clampOpusBitrate (DEV hook in src/main.tsx) ` +
          `not found at ${config.targetUrl} — the real SDP munge could not be ` +
          `exercised. The no-DTMF assertion needs a DEV-mode target that exposes ` +
          `the hook; on a production target this is skipped (not failed).`,
      );

      const result = await runDtmfNegotiationProbe(page);

      // The handshake must really have connected — otherwise there is no
      // "real call" and the SDP is not authoritative.
      expect(
        result.outcome,
        `Real Safari WebRTC handshake did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState}). ` +
          `Unlike headless Linux WebKit, genuine Safari should gather ICE candidates and complete the connection.`,
      ).toBe("ok");

      // Anchor PT-removal to the telephone-event PT(s) the RAW Safari offer
      // genuinely advertised. Deriving these from the raw (pre-munge) offer
      // is what makes the m=audio assertion below meaningful.
      const dtmfPts = audioDtmfPts(result.rawOfferSdp);

      // Guard against a vacuous pass: real Safari's raw offer must have
      // actually advertised at least one DTMF payload type for the strip to
      // mean anything.
      expect(
        dtmfPts.size,
        "Raw Safari offer did not advertise any telephone-event payload type — the DTMF strip would be vacuous. Investigate before trusting this gate.",
      ).toBeGreaterThan(0);

      // No telephone-event rtpmap may survive on either peer, in either
      // direction, AND none of the raw-advertised DTMF PTs may remain in any
      // negotiated m=audio format list.
      const negotiated: Array<[string, string]> = [
        ["offerer localDescription", result.offererLocal],
        ["offerer remoteDescription", result.offererRemote],
        ["answerer localDescription", result.answererLocal],
        ["answerer remoteDescription", result.answererRemote],
      ];

      for (const [label, sdp] of negotiated) {
        expect(sdp, `${label} should be non-empty`).not.toBe("");

        // No telephone-event rtpmap line anywhere.
        expect(
          /telephone-event/i.test(sdp),
          `${label} still contains a telephone-event codec:\n${sdp}`,
        ).toBe(false);

        // The DTMF PT(s) the raw offer advertised must be gone from every
        // m=audio format list of the negotiated SDP.
        const formatPts = audioFormatPts(sdp);
        const survivors = [...dtmfPts].filter((pt) => formatPts.has(pt));
        expect(
          survivors,
          `${label} m=audio format list still lists DTMF payload type(s) ${survivors.join(", ")} that the raw offer advertised:\n${sdp}`,
        ).toEqual([]);
      }
    } finally {
      await page.context().close();
    }
  });

  // Task #897 — Prove the Opus voice-fingerprint clamps hold on real Safari.
  //
  // The same SDP munge that strips DTMF also flattens the Opus stream to
  // kill packet-shape side-channels that leak speech/phonemes/loudness to a
  // passive on-path observer without decrypting SRTP: constant bitrate
  // (cbr=1), no DTX (usedtx=0), a clamped maxaveragebitrate (24000) and mono
  // (stereo=0), plus stripping the ssrc-audio-level RTP header extension
  // (per-packet loudness in cleartext). The local cross-engine gate proves
  // these survive a real Chromium/Firefox handshake but SKIPS on headless
  // WebKit (no ICE on Linux). This is the genuine Safari counterpart: it
  // drives a real negotiated audio session inside real Safari on the device
  // cloud, applies the app's PRODUCTION munge, completes the handshake, and
  // asserts every negotiated m=audio Opus fmtp (both peers, both directions)
  // carries the clamps and that no ssrc-audio-level extmap survives. A
  // raw-offer Opus guard prevents a vacuous pass. Closing this engine gap
  // means "voice fingerprinting can't leak via packet shape" is verified on
  // real Safari, not just Chromium/Firefox.
  test("a real negotiated audio session keeps Opus flattened (CBR / no DTX / mono, no loudness extension)", async () => {
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

      // The DEV-only hook re-exports the exact SDP munge the call path
      // uses. It is absent on a production build, so against a prod target
      // we SKIP cleanly (matching the suite's skip discipline) rather than
      // fail — the dev domain target serves it. Peer-connection
      // establishment is still covered by the loopback test above.
      const hookPresent = await page.evaluate(
        () =>
          typeof (
            window as unknown as {
              __voidWebrtcTesting?: { clampOpusBitrate?: unknown };
            }
          ).__voidWebrtcTesting?.clampOpusBitrate === "function",
      );
      test.skip(
        !hookPresent,
        `window.__voidWebrtcTesting.clampOpusBitrate (DEV hook in src/main.tsx) ` +
          `not found at ${config.targetUrl} — the real SDP munge could not be ` +
          `exercised. The Opus-clamp assertion needs a DEV-mode target that exposes ` +
          `the hook; on a production target this is skipped (not failed).`,
      );

      const result = await runDtmfNegotiationProbe(page);

      // The handshake must really have connected — otherwise there is no
      // "real call" and the SDP is not authoritative.
      expect(
        result.outcome,
        `Real Safari WebRTC handshake did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState}). ` +
          `Unlike headless Linux WebKit, genuine Safari should gather ICE candidates and complete the connection.`,
      ).toBe("ok");

      // Raw-offer guard: real Safari's raw offer must really have advertised
      // an Opus codec, else the clamp assertions below would be vacuous.
      expect(
        audioHasOpus(result.rawOfferSdp),
        "Raw Safari offer did not advertise an Opus codec — the CBR/DTX clamp would be vacuous. Investigate before trusting this gate.",
      ).toBe(true);

      const negotiated: Array<[string, string]> = [
        ["offerer localDescription", result.offererLocal],
        ["offerer remoteDescription", result.offererRemote],
        ["answerer localDescription", result.answererLocal],
        ["answerer remoteDescription", result.answererRemote],
      ];

      for (const [label, sdp] of negotiated) {
        expect(sdp, `${label} should be non-empty`).not.toBe("");

        // The per-packet loudness side-channel must not survive.
        expect(
          hasSsrcAudioLevel(sdp),
          `${label} still carries the ssrc-audio-level RTP header extension (per-packet loudness side-channel):\n${sdp}`,
        ).toBe(false);

        // Every negotiated Opus fmtp must carry the privacy clamps.
        const opusFmtps = audioOpusFmtps(sdp);
        expect(
          opusFmtps.length,
          `${label} has no Opus fmtp line; cannot confirm the CBR/DTX clamp survived negotiation:\n${sdp}`,
        ).toBeGreaterThan(0);
        for (const fmtp of opusFmtps) {
          expect(fmtp, `${label} Opus fmtp missing cbr=1:\n${fmtp}`).toMatch(
            /(^|;)cbr=1(;|$)/,
          );
          expect(fmtp, `${label} Opus fmtp missing usedtx=0:\n${fmtp}`).toMatch(
            /(^|;)usedtx=0(;|$)/,
          );
          expect(
            fmtp,
            `${label} Opus fmtp missing maxaveragebitrate=24000:\n${fmtp}`,
          ).toMatch(/(^|;)maxaveragebitrate=24000(;|$)/);
          expect(fmtp, `${label} Opus fmtp missing stereo=0:\n${fmtp}`).toMatch(
            /(^|;)stereo=0(;|$)/,
          );
        }
      }
    } finally {
      await page.context().close();
    }
  });
});
