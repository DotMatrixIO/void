// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from "vitest";
import { __testing } from "./webrtc";

const { clampOpusBitrate } = __testing;

const sampleOpusSdp = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level",
  "a=extmap:2 urn:ietf:params:rtp-hdrext:sdes:mid",
  "",
].join("\r\n");

// A real-browser-shaped audio m-section carrying the DTMF
// (telephone-event) codec on PT 126, alongside Opus on 111 and comfort
// noise on 13. The munge must drop telephone-event entirely while
// leaving Opus + CN negotiable.
const dtmfOfferSdp = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 13 126",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:111 opus/48000/2",
  "a=fmtp:111 minptime=10;useinbandfec=1",
  "a=rtpmap:13 CN/8000",
  "a=rtpmap:126 telephone-event/8000",
  "a=fmtp:126 0-16",
  "",
].join("\r\n");

const noOpusSdp = [
  "v=0",
  "o=- 0 0 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=rtpmap:96 VP8/90000",
  "",
].join("\r\n");

describe("clampOpusBitrate CBR / DTX / extension audit", () => {
  it("injects cbr=1 and usedtx=0 into the Opus fmtp line while preserving existing params", () => {
    const out = clampOpusBitrate(sampleOpusSdp);
    const fmtp = out.split("\r\n").find((l) => l.startsWith("a=fmtp:111"));
    expect(fmtp).toBeDefined();
    expect(fmtp).toMatch(/(^|;)cbr=1(;|$)/);
    expect(fmtp).toMatch(/(^|;)usedtx=0(;|$)/);
    expect(fmtp).toMatch(/(^|;)maxaveragebitrate=24000(;|$)/);
    expect(fmtp).toMatch(/\bminptime=10\b/);
    expect(fmtp).toMatch(/\buseinbandfec=1\b/);
  });

  it("strips the ssrc-audio-level extmap line and leaves other extmaps intact", () => {
    const out = clampOpusBitrate(sampleOpusSdp);
    expect(out).not.toMatch(/ssrc-audio-level/);
    expect(out).toMatch(/a=extmap:2 urn:ietf:params:rtp-hdrext:sdes:mid/);
  });

  it("passes SDP without an Opus rtpmap through unchanged", () => {
    const out = clampOpusBitrate(noOpusSdp);
    expect(out).toBe(noOpusSdp);
  });

  it("overrides a pre-existing cbr=0 / usedtx=1 if a remote SDP sets them", () => {
    const sdpWithVbr = sampleOpusSdp.replace(
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=fmtp:111 minptime=10;useinbandfec=1;cbr=0;usedtx=1",
    );
    const out = clampOpusBitrate(sdpWithVbr);
    const fmtp = out.split("\r\n").find((l) => l.startsWith("a=fmtp:111"));
    expect(fmtp).toMatch(/(^|;)cbr=1(;|$)/);
    expect(fmtp).toMatch(/(^|;)usedtx=0(;|$)/);
    expect(fmtp).not.toMatch(/cbr=0/);
    expect(fmtp).not.toMatch(/usedtx=1/);
  });
});

describe("clampOpusBitrate DTMF (telephone-event) strip", () => {
  it("removes the telephone-event rtpmap and fmtp from the munged SDP", () => {
    const out = clampOpusBitrate(dtmfOfferSdp);
    expect(out).not.toMatch(/telephone-event/i);
    expect(out).not.toMatch(/a=rtpmap:126\b/);
    expect(out).not.toMatch(/a=fmtp:126\b/);
  });

  it("drops the DTMF payload type from the m=audio format list, keeping Opus + CN", () => {
    const out = clampOpusBitrate(dtmfOfferSdp);
    const mLine = out.split("\r\n").find((l) => l.startsWith("m=audio"));
    expect(mLine).toBeDefined();
    expect(mLine).toBe("m=audio 9 UDP/TLS/RTP/SAVPF 111 13");
    const pts = mLine!.split(" ").slice(3);
    expect(pts).not.toContain("126");
    expect(pts).toContain("111");
    expect(pts).toContain("13");
  });

  it("still applies the Opus CBR / no-DTX munge to the surviving Opus codec", () => {
    const out = clampOpusBitrate(dtmfOfferSdp);
    const fmtp = out.split("\r\n").find((l) => l.startsWith("a=fmtp:111"));
    expect(fmtp).toMatch(/(^|;)cbr=1(;|$)/);
    expect(fmtp).toMatch(/(^|;)usedtx=0(;|$)/);
  });

  it("leaves SDP without telephone-event otherwise unchanged in PT membership", () => {
    const out = clampOpusBitrate(sampleOpusSdp);
    const mLine = out.split("\r\n").find((l) => l.startsWith("m=audio"));
    expect(mLine).toBe("m=audio 9 UDP/TLS/RTP/SAVPF 111");
  });

  it("strips DTMF even when the audio section has no Opus codec", () => {
    // Opus-less audio (e.g. a G.711/G.722-only offer). The Opus CBR
    // clamp short-circuits, but the "DTMF can never flow" guarantee must
    // still hold, so telephone-event must be stripped regardless.
    const noOpusWithDtmf = [
      "v=0",
      "o=- 0 0 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 9 126",
      "c=IN IP4 0.0.0.0",
      "a=rtpmap:9 G722/8000",
      "a=rtpmap:126 telephone-event/8000",
      "a=fmtp:126 0-16",
      "",
    ].join("\r\n");

    const out = clampOpusBitrate(noOpusWithDtmf);
    expect(out).not.toMatch(/telephone-event/i);
    expect(out).not.toMatch(/a=fmtp:126\b/);
    const mLine = out.split("\r\n").find((l) => l.startsWith("m=audio"));
    expect(mLine).toBe("m=audio 9 UDP/TLS/RTP/SAVPF 9");
  });

  it("scopes the strip per m= section: a video codec reusing the DTMF PT survives", () => {
    // PT 126 is telephone-event in the audio section but a legitimate
    // codec (with fmtp + rtcp-fb) in the video section. SDP payload
    // types are section-scoped, so the video PT 126 must be untouched.
    const crossMediaSdp = [
      "v=0",
      "o=- 0 0 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0 1",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111 126",
      "c=IN IP4 0.0.0.0",
      "a=mid:0",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1",
      "a=rtpmap:126 telephone-event/8000",
      "a=fmtp:126 0-16",
      "m=video 9 UDP/TLS/RTP/SAVPF 96 126",
      "c=IN IP4 0.0.0.0",
      "a=mid:1",
      "a=rtpmap:96 VP8/90000",
      "a=rtpmap:126 H264/90000",
      "a=fmtp:126 profile-level-id=42e01f",
      "a=rtcp-fb:126 nack",
      "",
    ].join("\r\n");

    const out = clampOpusBitrate(crossMediaSdp);
    const lines = out.split("\r\n");

    // Audio section: DTMF gone.
    const audioM = lines.find((l) => l.startsWith("m=audio"));
    expect(audioM).toBe("m=audio 9 UDP/TLS/RTP/SAVPF 111");
    expect(out).not.toMatch(/telephone-event/i);
    expect(lines).not.toContain("a=fmtp:126 0-16");

    // Video section: PT 126 and its dependent lines must survive intact.
    const videoM = lines.find((l) => l.startsWith("m=video"));
    expect(videoM).toBe("m=video 9 UDP/TLS/RTP/SAVPF 96 126");
    expect(lines).toContain("a=rtpmap:126 H264/90000");
    expect(lines).toContain("a=fmtp:126 profile-level-id=42e01f");
    expect(lines).toContain("a=rtcp-fb:126 nack");
  });
});
