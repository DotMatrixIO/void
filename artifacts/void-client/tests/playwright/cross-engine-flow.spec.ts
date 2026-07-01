// SPDX-License-Identifier: AGPL-3.0-or-later
// Task #664 — Cross-engine flow gate. Exercises the core path a real
// user walks before masked output begins, under Chromium, Firefox, and
// WebKit (project-driven; see playwright.config.ts):
//
//   1. Landing page renders (host/join controls present).
//   2. A deep-link phrase hash renders the PREVIEW gate (the surface
//      that probes WebRTC capability and gates ENTER ROOM).
//   3. The synthetic joined-call route renders the in-call UI
//      (control bar + video grid) — no getUserMedia, so it runs
//      headlessly on every engine including WebKit.
//   4. The engine establishes a real loopback RTCPeerConnection with an
//      open data channel — a direct check of the engine's WebRTC stack,
//      which is what powers the actual call.
//
// What this does NOT cover (intentionally — out of headless reach):
//   - Live Safari/WebKit WebRTC. Headless Linux WebKit does not gather
//     ICE candidates, so the loopback probe below SKIPS on WebKit. Genuine
//     Safari WebRTC is now automated on a real device cloud — see
//     tests/playwright/safari-webrtc-devicecloud.spec.ts (and the manual
//     iOS-Safari runbook row for human-judged masked output).
//   - Masked / processed video output. WebKit cannot fake a camera in
//     headless Playwright, and pixel-level mask verification is a human
//     judgement call. See docs/cross-browser-tor-runbook.md.
//   - SAS verification, relay-only enforcement on the wire, and
//     no-clearnet-leak checks — all in the manual runbook.

import { test, expect } from "@playwright/test";

// Six BIP39 words (all in the wordlist) — the only validity requirement
// parseHashPhrase enforces. Renders the preview gate via App's hash
// effect without needing a live signaling server.
const PHRASE_HASH = "#abandon-ability-able-about-above-absent";

const JOINED_CALL_ROUTE = "/__test/joined-call";

// Collect the DTMF (telephone-event) payload-type numbers declared in
// every audio m-section of an SDP, scoped per section (PTs are
// section-local, so we only count telephone-event rtpmaps that fall
// inside an `m=audio` block). Used against the RAW, pre-munge offer so
// the PT-removal assertion below is anchored to PTs the browser
// genuinely advertised — not to whatever survives post-munge (which
// would be vacuous).
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

// Collect every payload-type token from every `m=audio` format list in
// an SDP (the PT numbers after `m=audio <port> <proto>`).
function audioFormatPts(sdp: string): Set<string> {
  const pts = new Set<string>();
  for (const line of sdp.split(/\r\n|\n/)) {
    if (!/^m=audio\s/.test(line)) continue;
    for (const pt of line.split(" ").slice(3)) pts.add(pt);
  }
  return pts;
}

// Whether the SDP advertises an Opus codec in any m=audio section. Used
// as the raw-offer guard for the privacy-clamp assertion so it can never
// pass vacuously on a browser that did not offer Opus.
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
// Mirrors the strip predicate in src/lib/webrtcSdp.ts.
function hasSsrcAudioLevel(sdp: string): boolean {
  return sdp
    .split(/\r\n|\n/)
    .some((l) =>
      /^a=extmap:\d+(\/[^ ]*)?\s+urn:ietf:params:rtp-hdrext:ssrc-audio-level\b/i.test(
        l,
      ),
    );
}

/** Outcome of {@link runNegotiatedAudioProbe}. */
interface NegotiatedAudioResult {
  outcome: "ok" | "timeout";
  connectionState: string;
  iceConnectionState: string;
  /**
   * The RAW, pre-munge offer the browser produced. Both the DTMF-strip
   * and the Opus-clamp assertions are anchored to what THIS offer
   * genuinely advertised (telephone-event PTs / an Opus codec) so they
   * can never pass vacuously against the post-munge SDP.
   */
  rawOfferSdp: string;
  /** Negotiated SDP governing the live session, both peers, both directions. */
  offererLocal: string;
  offererRemote: string;
  answererLocal: string;
  answererRemote: string;
}

// Drive a real negotiated audio session in the engine under test and
// return the raw (pre-munge) offer plus the negotiated SDP on both peers
// in both directions, after applying the app's PRODUCTION munge
// (window.__voidWebrtcTesting.clampOpusBitrate — a DEV-only hook in
// src/main.tsx that re-exports the exact function the call path uses). A
// real getUserMedia audio track is added so the browser emits a real
// audio m-section (the flow projects feed a fake mic via launch flags).
// Shared by the DTMF-strip and Opus-clamp gates below so both assert
// against the SAME real offer/answer/ICE handshake.
async function runNegotiatedAudioProbe(
  page: import("@playwright/test").Page,
): Promise<NegotiatedAudioResult> {
  return page.evaluate(async () => {
    const munge = (
      window as unknown as {
        __voidWebrtcTesting: { clampOpusBitrate: (sdp: string) => string };
      }
    ).__voidWebrtcTesting.clampOpusBitrate;

    const a = new RTCPeerConnection();
    const b = new RTCPeerConnection();
    let stream: MediaStream | null = null;

    try {
      a.onicecandidate = (e) => {
        if (e.candidate) b.addIceCandidate(e.candidate).catch(() => {});
      };
      b.onicecandidate = (e) => {
        if (e.candidate) a.addIceCandidate(e.candidate).catch(() => {});
      };

      // A real audio track makes the browser emit a real audio
      // m-section — which always advertises telephone-event + Opus.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getAudioTracks()) a.addTrack(track, stream);

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

      // Real browser-generated offer (carries telephone-event + Opus),
      // then the production munge, then a genuine offer/answer exchange.
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
        setTimeout(() => resolve("timeout"), 15_000),
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
      if (stream) for (const t of stream.getTracks()) t.stop();
      a.close();
      b.close();
    }
  });
}

test.describe("cross-engine core flow", () => {
  test("landing page renders the host/join controls", async ({ page }) => {
    await page.goto("/");

    // The embedded StartScreen controls are the entry point to the whole
    // product. If the engine can't render them, nothing else matters.
    await expect(
      page.getByRole("button", { name: "HOST A ROOM" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "JOIN A ROOM" }),
    ).toBeVisible();
  });

  test("a deep-link phrase renders the preview gate", async ({ page }) => {
    await page.goto(`/${PHRASE_HASH}`);

    // PREVIEW header confirms App routed the hash → pendingRoom →
    // PreviewGate. The ENTER ROOM control is the gate the WebRTC probe
    // guards; we assert its presence (it may be disabled until the probe
    // resolves — that's the gate working, not a failure).
    await expect(page.getByText("PREVIEW", { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("enter-room")).toBeAttached({ timeout: 15_000 });
  });

  test("the joined-call UI renders (control bar + video grid)", async ({
    page,
  }) => {
    await page.goto(JOINED_CALL_ROUTE);

    await expect(page.getByTestId("room-control-bar")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator(".void-video-grid").first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the engine establishes a loopback WebRTC peer connection", async ({
    page,
    browserName,
  }) => {
    // Headless WebKit on Linux (Playwright's WPE/GTK port) does not
    // gather ICE candidates, so a loopback connection never leaves the
    // "new" state. This is a tooling limitation of the Linux WebKit
    // build, NOT a defect in the app or in Safari proper. Real
    // WebKit/Safari WebRTC (iOS Safari) is verified by the manual
    // runbook (docs/cross-browser-tor-runbook.md). We still run the
    // landing, preview-gate, and joined-call assertions above on WebKit.
    test.skip(
      browserName === "webkit",
      "Headless WebKit on Linux does not gather ICE candidates; real Safari WebRTC is covered by the manual runbook.",
    );

    // Navigate to a real same-origin page first so the in-page script
    // runs in a normal document context (not about:blank).
    await page.goto("/");

    const result = await page.evaluate(async () => {
      // Two peers in the same page, wired to each other. A successful
      // ICE connection + an open data channel proves the engine's
      // WebRTC stack — the transport the actual call rides on — works
      // end to end in this browser.
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
          setTimeout(() => resolve("timeout"), 15_000),
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

    expect(
      result.outcome,
      `WebRTC loopback did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState})`,
    ).toBe("ok");
  });

  // Task #880 — Prove DTMF really can't flow in a real browser call.
  //
  // The DTMF (telephone-event) strip is enforced in the SDP munge
  // (src/lib/webrtcSdp.ts) and pinned by unit tests on *synthetic* SDP
  // (src/lib/webrtc.cbr.test.ts). The gap this closes: those fixtures are
  // hand-written, so nothing proved a *real* browser-generated offer —
  // which always advertises telephone-event on its audio m-section — ends
  // up with no telephone-event after a genuine offer/answer/ICE handshake.
  //
  // This drives a real loopback RTCPeerConnection in the engine, adds a
  // (fake) audio track so the browser emits a real audio section, applies
  // the app's PRODUCTION munge (window.__voidWebrtcTesting.clampOpusBitrate,
  // a DEV-only hook in src/main.tsx that re-exports the exact function the
  // call path uses), completes the handshake, and asserts the negotiated
  // local + remote SDP on BOTH peers has no telephone-event rtpmap and the
  // DTMF payload type is gone from every m=audio format list.
  //
  // It also asserts the *raw* (pre-munge) offer DID contain telephone-event
  // so the test can never silently pass on a browser that stopped emitting
  // DTMF (which would make the strip vacuous).
  //
  // Skip discipline matches the loopback probe above: headless Linux WebKit
  // gathers no ICE candidates, so a real handshake is unreachable there —
  // we SKIP cleanly (never silently pass). Genuine Safari WebRTC is covered
  // by the device-cloud spec + manual runbook.
  test("a real negotiated audio session carries no DTMF (telephone-event)", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Headless WebKit on Linux does not gather ICE candidates; a real handshake is unreachable. Real Safari WebRTC is covered by the device-cloud spec + manual runbook.",
    );

    await page.goto("/");

    // The DEV-only hook must be present; if it is missing (e.g. a prod
    // build), fail loudly rather than skip — this test exists to exercise
    // the real munge.
    const hookPresent = await page.evaluate(
      () =>
        typeof (
          window as unknown as {
            __voidWebrtcTesting?: { clampOpusBitrate?: unknown };
          }
        ).__voidWebrtcTesting?.clampOpusBitrate === "function",
    );
    expect(
      hookPresent,
      "window.__voidWebrtcTesting.clampOpusBitrate (DEV hook in src/main.tsx) not found — the real SDP munge could not be exercised.",
    ).toBe(true);

    const result = await runNegotiatedAudioProbe(page);

    // The handshake must really have connected — otherwise there is no
    // "real call" and the SDP is not authoritative.
    expect(
      result.outcome,
      `WebRTC handshake did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState})`,
    ).toBe("ok");

    // Anchor PT-removal to the telephone-event PT(s) the RAW browser offer
    // genuinely advertised. Deriving these from the raw (pre-munge) offer —
    // not the post-munge SDP — is what makes the m=audio assertion below
    // meaningful: if a regression dropped the telephone-event rtpmap line
    // but left the PT in the m=audio list, we still catch it.
    const dtmfPts = audioDtmfPts(result.rawOfferSdp);

    // Guard against a vacuous pass: the raw browser offer must have
    // actually advertised at least one DTMF payload type for the strip to
    // mean anything.
    expect(
      dtmfPts.size,
      "Raw browser offer did not advertise any telephone-event payload type — the DTMF strip would be vacuous. Investigate before trusting this gate.",
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
  });

  // Task #897 — Prove the Opus voice-fingerprint clamps hold on a real call.
  //
  // The same SDP munge that strips DTMF also flattens the Opus stream to
  // kill packet-shape side-channels that leak speech/phonemes/loudness to a
  // passive on-path observer even without decrypting SRTP: constant bitrate
  // (cbr=1), no DTX (usedtx=0), a clamped maxaveragebitrate (24000) and mono
  // (stereo=0), plus stripping the ssrc-audio-level RTP header extension
  // (per-packet loudness in cleartext). Those were only pinned by unit
  // tests on *synthetic* SDP (src/lib/webrtc.cbr.test.ts) — nothing proved
  // they survive a genuine offer/answer/ICE handshake. This closes the same
  // engine gap for the privacy clamps that the DTMF test above closes for
  // telephone-event.
  //
  // It drives a real negotiated audio session (the SAME probe the DTMF test
  // uses), applies the app's PRODUCTION munge, completes the handshake, and
  // asserts the negotiated local + remote SDP on BOTH peers has, for every
  // m=audio Opus fmtp: cbr=1, usedtx=0, maxaveragebitrate=24000, stereo=0;
  // and that no ssrc-audio-level extmap line survives. A raw-offer Opus
  // guard prevents a vacuous pass (a browser that never offered Opus).
  //
  // Skip discipline matches the DTMF + loopback tests: headless Linux WebKit
  // gathers no ICE candidates, so a real handshake is unreachable there — we
  // SKIP cleanly (never silently pass). Genuine Safari is covered by the
  // device-cloud spec.
  test("a real negotiated audio session keeps Opus flattened (CBR / no DTX / mono, no loudness extension)", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "Headless WebKit on Linux does not gather ICE candidates; a real handshake is unreachable. Real Safari WebRTC is covered by the device-cloud spec + manual runbook.",
    );

    await page.goto("/");

    // The DEV-only hook must be present; if it is missing (e.g. a prod
    // build), fail loudly rather than skip — this test exists to exercise
    // the real munge.
    const hookPresent = await page.evaluate(
      () =>
        typeof (
          window as unknown as {
            __voidWebrtcTesting?: { clampOpusBitrate?: unknown };
          }
        ).__voidWebrtcTesting?.clampOpusBitrate === "function",
    );
    expect(
      hookPresent,
      "window.__voidWebrtcTesting.clampOpusBitrate (DEV hook in src/main.tsx) not found — the real SDP munge could not be exercised.",
    ).toBe(true);

    const result = await runNegotiatedAudioProbe(page);

    // The handshake must really have connected — otherwise there is no
    // "real call" and the SDP is not authoritative.
    expect(
      result.outcome,
      `WebRTC handshake did not connect (connectionState=${result.connectionState}, iceConnectionState=${result.iceConnectionState})`,
    ).toBe("ok");

    // Raw-offer guard: the browser's raw offer must really have advertised
    // an Opus codec, else the clamp assertions below would be vacuous.
    expect(
      audioHasOpus(result.rawOfferSdp),
      "Raw browser offer did not advertise an Opus codec — the CBR/DTX clamp would be vacuous. Investigate before trusting this gate.",
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
  });
});
