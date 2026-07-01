// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import {
  validateSdp,
  validateIceCandidate,
  SDP_MAX_BYTES,
  SDP_MAX_LINES,
  SDP_MAX_ATTR_BYTES,
  SDP_MAX_CANDIDATES,
} from "../sdpValidator";

// Real-browser SDP samples — captured from production Chrome,
// Firefox, and Safari offers (codec-list trimmed for brevity, but
// every structural element preserved). These exercise the
// happy-path: a well-formed real offer must pass every rule.

const CHROME_AUDIO_VIDEO_OFFER = [
  "v=0",
  "o=- 7588459132016812345 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0 1",
  "a=msid-semantic: WMS stream-id",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 63 13 126",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:abcdefghijklmnopqrstuvwx",
  "a=fingerprint:sha-256 12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0",
  "a=setup:actpass",
  "a=mid:0",
  "a=sendrecv",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:63 red/48000/2",
  "a=rtpmap:13 CN/8000",
  "a=rtpmap:126 telephone-event/8000",
  "a=candidate:842163049 1 udp 1677729535 192.0.2.5 50000 typ srflx raddr 192.168.1.5 rport 50000 generation 0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99 100",
  "c=IN IP4 0.0.0.0",
  "a=rtcp:9 IN IP4 0.0.0.0",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:abcdefghijklmnopqrstuvwx",
  "a=fingerprint:sha-256 12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0:12:34:56:78:9A:BC:DE:F0",
  "a=setup:actpass",
  "a=mid:1",
  "a=sendrecv",
  "a=rtpmap:96 VP8/90000",
  "a=rtpmap:97 rtx/90000",
  "a=rtpmap:98 VP9/90000",
  "a=rtpmap:99 H264/90000",
  "a=rtpmap:100 red/90000",
  "a=candidate:842163049 1 udp 1677729535 192.0.2.5 50001 typ srflx raddr 192.168.1.5 rport 50001 generation 0",
  "",
].join("\r\n");

// Note: Chrome's real audio offer includes G722/PCMU/PCMA on their
// historical static payload types (9 / 0 / 8) with explicit rtpmaps.
// These are now allowlisted (see ALLOWED_AUDIO_CODECS) after the
// staging test confirmed Chrome Win11 emits `a=rtpmap:9 G722/8000`
// in every default offer. The fixture above keeps the simpler
// Opus-only shape because it exercises the same rules with less
// noise — extra real-codec coverage lives in the dedicated test
// cases below.

const FIREFOX_OFFER = [
  "v=0",
  "o=mozilla...THIS_IS_SDPARTA-99.0 1234567890 0 IN IP4 0.0.0.0",
  "s=-",
  "t=0 0",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  "a=group:BUNDLE 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 109",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=setup:actpass",
  "a=ice-ufrag:wxyz",
  "a=ice-pwd:abcdefghijklmnopqrstuvwx",
  "a=rtpmap:109 opus/48000/2",
  "a=fmtp:109 maxplaybackrate=48000;stereo=1;useinbandfec=1",
  "",
].join("\r\n");

describe("validateSdp — happy path", () => {
  it("accepts a real-shape Chrome offer with audio+video", () => {
    const r = validateSdp(CHROME_AUDIO_VIDEO_OFFER);
    expect(r.ok).toBe(true);
  });

  it("accepts a real-shape Firefox audio-only offer", () => {
    const r = validateSdp(FIREFOX_OFFER);
    expect(r.ok).toBe(true);
  });
});

describe("validateSdp — rejection rules", () => {
  it("rejects non-string input", () => {
    const r = validateSdp(undefined as unknown as string);
    expect(r).toEqual({ ok: false, reason: "missing_required_field" });
  });

  it("rejects oversized SDP (>16 KiB)", () => {
    // Pad an a=ssrc line until total bytes exceed cap. Each ssrc line
    // adds ~50 bytes and is <1 KiB so we stay under the attr cap.
    const pad = Array(SDP_MAX_BYTES).fill("a=ssrc:1234567890 cname:abc").join("\r\n");
    const r = validateSdp(FIREFOX_OFFER + "\r\n" + pad);
    expect(r).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects too many lines (>200)", () => {
    const filler = Array(SDP_MAX_LINES + 5).fill("a=x:1").join("\r\n");
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      filler,
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "too_many_lines" });
  });

  it("rejects per-attribute length > 1 KiB", () => {
    const big = "a=tag:" + "x".repeat(SDP_MAX_ATTR_BYTES + 1);
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      big,
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "attribute_too_long" });
  });

  it("rejects too many candidates per offer (>30)", () => {
    const candidates = Array(SDP_MAX_CANDIDATES + 1)
      .fill(0)
      .map(
        (_, i) =>
          `a=candidate:${i} 1 udp 1677729535 192.0.2.${(i % 250) + 1} ${50000 + i} typ host generation 0`,
      )
      .join("\r\n");
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      candidates,
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "too_many_candidates" });
  });

  it("rejects disallowed audio codec (speex — not in any major browser's WebRTC stack)", () => {
    // Previously asserted G722 was rejected. G722 (and PCMU/PCMA) are
    // now allowlisted because Chrome Win11 emits `a=rtpmap:9 G722/8000`
    // in every default offer — see ALLOWED_AUDIO_CODECS. Speex is a
    // real audio codec name but no shipping browser advertises it via
    // WebRTC, so it's a safe stand-in for "unknown audio codec".
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 97",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:97 speex/16000",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toMatchObject({ ok: false, reason: "disallowed_codec" });
  });

  it("accepts G722 / PCMU / PCMA on their historical static PTs (Chrome default)", () => {
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8",
      "a=rtpmap:111 opus/48000/2",
      "a=rtpmap:9 G722/8000",
      "a=rtpmap:0 PCMU/8000",
      "a=rtpmap:8 PCMA/8000",
      "",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r.ok).toBe(true);
  });

  it("rejects disallowed video codec (theora — unknown to all major browsers)", () => {
    // Previously asserted AV1 was rejected. AV1 is now allowlisted
    // (Chrome/Edge default-on, Safari 17.4+) — see ALLOWED_VIDEO_CODECS.
    // Theora is a real codec name but no browser ships it via WebRTC,
    // so it's a safe stand-in for "unknown video codec" coverage.
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:96 theora/90000",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toMatchObject({ ok: false, reason: "disallowed_codec" });
  });

  it.each([
    ["v=", "v=0"],
    ["o=", "o=- 1 1 IN IP4 0.0.0.0"],
    ["s=", "s=-"],
    ["t=", "t=0 0"],
    ["m=", "m=audio 9 UDP/TLS/RTP/SAVPF 111"],
  ])("rejects SDP missing required %s line", (_kind, missingLine) => {
    const lines = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
    ].filter((l) => l !== missingLine);
    const r = validateSdp(lines.join("\r\n"));
    expect(r).toEqual({ ok: false, reason: "missing_required_field" });
  });

  it("rejects SHA-1 fingerprint (off allowlist)", () => {
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-1 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE",
      "a=rtpmap:111 opus/48000/2",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "disallowed_fingerprint_algorithm" });
  });

  it.each([
    ["IPv4 loopback", "127.0.0.1"],
    ["IPv4 link-local", "169.254.1.5"],
    ["IPv6 loopback", "::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with zone", "fe80::1%eth0"],
  ])("rejects candidate address (%s)", (_label, addr) => {
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      `a=candidate:1 1 udp 1677729535 ${addr} 50000 typ host generation 0`,
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "disallowed_address" });
  });

  it("rejects candidate that smuggles loopback in raddr", () => {
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      "a=candidate:1 1 udp 1677729535 192.0.2.5 50000 typ srflx raddr 127.0.0.1 rport 50000",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "disallowed_address" });
  });

  it("rejects ill-formed UTF-16 (lone surrogate)", () => {
    // Lone high surrogate U+D800, not followed by a low surrogate.
    const sdp = FIREFOX_OFFER + "\r\na=label:" + String.fromCharCode(0xd800);
    const r = validateSdp(sdp);
    expect(r).toEqual({ ok: false, reason: "invalid_utf8" });
  });
});

describe("validateSdp — boundary cases", () => {
  it("accepts SDP exactly at line count cap", () => {
    const base = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
    ];
    while (base.length < SDP_MAX_LINES) base.push("a=x:1");
    expect(base.length).toBe(SDP_MAX_LINES);
    const r = validateSdp(base.join("\r\n"));
    expect(r.ok).toBe(true);
  });

  it("accepts SDP with exactly 30 candidates", () => {
    const candidates = Array(SDP_MAX_CANDIDATES)
      .fill(0)
      .map(
        (_, i) =>
          `a=candidate:${i} 1 udp 1677729535 192.0.2.${(i % 250) + 1} ${50000 + i} typ host generation 0`,
      )
      .join("\r\n");
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      candidates,
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r.ok).toBe(true);
  });

  it("accepts attribute exactly at 1 KiB", () => {
    // Construct a line whose UTF-8 byte length is exactly 1024.
    const prefix = "a=label:";
    const fill = "x".repeat(SDP_MAX_ATTR_BYTES - prefix.length);
    const line = prefix + fill;
    expect(new TextEncoder().encode(line).byteLength).toBe(SDP_MAX_ATTR_BYTES);
    const sdp = [
      "v=0",
      "o=- 1 1 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "a=rtpmap:111 opus/48000/2",
      line,
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r.ok).toBe(true);
  });

  it("accepts all three allowlisted fingerprint algorithms", () => {
    for (const alg of ["sha-256", "sha-384", "sha-512"]) {
      const sdp = [
        "v=0",
        "o=- 1 1 IN IP4 0.0.0.0",
        "s=-",
        "t=0 0",
        "m=audio 9 UDP/TLS/RTP/SAVPF 111",
        `a=fingerprint:${alg} AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99`,
        "a=rtpmap:111 opus/48000/2",
      ].join("\r\n");
      const r = validateSdp(sdp);
      expect(r.ok).toBe(true);
    }
  });
});

describe("validateIceCandidate", () => {
  it("accepts a well-formed host candidate", () => {
    const r = validateIceCandidate({
      candidate: "candidate:1 1 udp 1677729535 192.0.2.5 50000 typ host generation 0",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts the end-of-candidates sentinel (empty string)", () => {
    const r = validateIceCandidate({ candidate: "" });
    expect(r.ok).toBe(true);
  });

  it("rejects null / missing candidate", () => {
    expect(validateIceCandidate(null).ok).toBe(false);
    expect(validateIceCandidate(undefined).ok).toBe(false);
    expect(validateIceCandidate({} as RTCIceCandidateInit).ok).toBe(false);
  });

  it("rejects candidate with loopback address", () => {
    const r = validateIceCandidate({
      candidate: "candidate:1 1 udp 1677729535 127.0.0.1 50000 typ host generation 0",
    });
    expect(r).toEqual({ ok: false, reason: "disallowed_address" });
  });

  it("rejects candidate with link-local IPv6 address", () => {
    const r = validateIceCandidate({
      candidate: "candidate:1 1 udp 1677729535 fe80::abcd 50000 typ host generation 0",
    });
    expect(r).toEqual({ ok: false, reason: "disallowed_address" });
  });

  it("rejects malformed candidate (too few tokens)", () => {
    const r = validateIceCandidate({ candidate: "candidate:1 1 udp" });
    expect(r).toEqual({ ok: false, reason: "malformed_candidate" });
  });

  it("rejects oversized candidate (>1 KiB)", () => {
    const longTail = " junk".repeat(300);
    const r = validateIceCandidate({
      candidate:
        "candidate:1 1 udp 1677729535 192.0.2.5 50000 typ host generation 0" + longTail,
    });
    expect(r).toEqual({ ok: false, reason: "attribute_too_long" });
  });
});

// Regression coverage for the H-03 hardening pass (Task #466 code-
// review round 2): codec policy must be enforced against the m=line
// payload-type list (not just the rtpmap entries that happen to be
// present), and DTLS fingerprint must be required.

describe("validateSdp — codec allowlist enforced via m= payload-type list", () => {
  it("rejects a static PT (e.g. PCMU=0) when no rtpmap is provided", () => {
    // m=audio includes PT 0 (implicit PCMU). With no `a=rtpmap:0`,
    // a naïve "only check rtpmaps" validator would let this through;
    // the browser would still happily negotiate PCMU. We reject.
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=audio 9 UDP/TLS/RTP/SAVPF 0 111",
      "a=rtpmap:111 opus/48000/2",
      "",
    ].join("\r\n");
    expect(validateSdp(sdp)).toMatchObject({ ok: false, reason: "disallowed_codec" });
  });

  it("rejects an m=audio section that lists only static PTs with no rtpmap at all", () => {
    // Pure PCMU/PCMA offer — every PT static, no rtpmap. The browser
    // would accept it from a peer that knows the static table.
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=audio 9 UDP/TLS/RTP/SAVPF 0 8",
      "",
    ].join("\r\n");
    expect(validateSdp(sdp)).toMatchObject({ ok: false, reason: "disallowed_codec" });
  });

  it("rejects an m=video section with a PT whose rtpmap is for a disallowed codec", () => {
    // Use a clearly-unknown codec name. AV1 and H.265 were previously
    // rejected here; both are now allowlisted (real-browser default-on
    // codecs as of Chrome 2024+ / Safari 17+) — see ALLOWED_VIDEO_CODECS.
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 theora/90000",
      "",
    ].join("\r\n");
    expect(validateSdp(sdp)).toMatchObject({ ok: false, reason: "disallowed_codec" });
  });

  it("accepts an m=video section using AV1 (real-browser default in Chrome/Edge 2024+)", () => {
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 AV1/90000",
      "",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r.ok).toBe(true);
  });

  it("accepts an m=video section using H.265 (Safari 17+ default)", () => {
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
      "m=video 9 UDP/TLS/RTP/SAVPF 96",
      "a=rtpmap:96 H265/90000",
      "",
    ].join("\r\n");
    const r = validateSdp(sdp);
    expect(r.ok).toBe(true);
  });
});

describe("validateSdp — DTLS fingerprint is required", () => {
  it("rejects an otherwise well-formed SDP that has no a=fingerprint line", () => {
    const sdp = [
      "v=0",
      "o=- 0 0 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "",
    ].join("\r\n");
    expect(validateSdp(sdp)).toEqual({ ok: false, reason: "missing_required_field" });
  });
});
