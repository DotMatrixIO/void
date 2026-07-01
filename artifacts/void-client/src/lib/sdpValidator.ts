// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure-function SDP validator. Filters inbound SDP from a peer to a
// known-safe subset before the browser's WebRTC stack touches it.
//
// Threat model: the peer shares the room phrase, so cleartext SDP
// control is theirs. They can today push pathological SDP at our
// WebRTC stack — oversized payloads, exotic codecs, malformed
// fingerprint algorithms, malformed ICE candidates — and the browser
// will dutifully parse them. This validator is the first line of
// defence on the inbound receive path.
//
// Design rules:
//   - Pure function. No side effects, no I/O.
//   - Reject, never rewrite. If the input would fail any rule,
//     return `{ ok: false, reason }` and let the caller tear the
//     secure channel down. The existing `clampOpusBitrate` rewrite
//     in webrtcSdp.ts is the *only* rewrite step on the receive
//     path and stays unchanged.
//   - Distinct enum reason per rule so the audit log can tell a
//     codec-allowlist violation apart from a UTF-8 fault apart from
//     a smuggled link-local candidate.
//
// See task #466 (H-03 SDP validation layer).

export type SdpValidationReason =
  | "too_large"
  | "too_many_lines"
  | "attribute_too_long"
  | "too_many_candidates"
  | "disallowed_codec"
  | "missing_required_field"
  | "disallowed_fingerprint_algorithm"
  | "disallowed_address"
  | "invalid_utf8"
  | "malformed_candidate";

export type SdpValidationResult =
  | { ok: true; sdp: string }
  | { ok: false; reason: SdpValidationReason; detail?: string };

// 16 KiB total cap on an inbound SDP body. Real-browser offers from
// Chrome/Firefox/Safari with audio + video + a handful of candidates
// land in the 2-6 KiB range; 16 KiB gives ~3x headroom for hosts on
// multi-homed networks while still being a hard memory bound.
export const SDP_MAX_BYTES = 16 * 1024;

// 200-line cap. A real offer is ~60-120 lines. 200 leaves room for
// codec-rich offers without leaving so much slack that line-by-line
// parsing pathologies (regex backtracking, attribute combinatorics)
// become exploitable.
export const SDP_MAX_LINES = 200;

// 1 KiB cap per `a=` attribute. Prevents a single line from
// smuggling bulk past the line-count cap.
export const SDP_MAX_ATTR_BYTES = 1024;

// 30-candidate cap per offer. The H-04 per-session accepted-ICE cap
// (50) lives in webrtc.ts and is a different control — this caps how
// many candidates a *single* offer/answer SDP can declare inline;
// H-04 caps how many candidates are accepted in total across one
// negotiation (inline + trickled).
export const SDP_MAX_CANDIDATES = 30;

// Codec allowlist. Strict on primary media codecs (Opus / VP8 / VP9
// / H264) but permissive on the housekeeping codecs every real
// browser emits — comfort noise, DTMF, RTX, FEC.
//
// `telephone-event` (DTMF) is *tolerated* here but never negotiated:
// this validator is reject-only (a disallowed codec tears the channel
// down), and every real Chrome/Firefox/Safari offer carries DTMF, so
// rejecting it would break legitimate calls. DTMF is instead stripped
// from the negotiated SDP at the munge (`clampOpusBitrate` in
// webrtcSdp.ts), which removes the codec from offers and answers in
// both directions. So DTMF passes validation but can never flow.
const ALLOWED_AUDIO_CODECS = new Set([
  "opus",
  "telephone-event",
  "cn",
  "red",
  // G.711 + G.722 are 1970s-era narrowband/wideband audio codecs that
  // Chrome (and Chromium derivatives like DuckDuckGo browser on Win/
  // Android) still ships in every default WebRTC offer with explicit
  // rtpmaps on the historical static PTs (0=PCMU, 8=PCMA, 9=G722).
  // Observed in the staging test: Chrome Win11 offerer included
  // `a=rtpmap:9 G722/8000`, causing disallowed_codec rejection on
  // every peer's receive path. These codecs have decades-old reference
  // decoders in libwebrtc — accepting them does not meaningfully
  // expand decoder attack surface beyond what the browser already
  // exposes to any HTML5 <audio> element.
  "g722",
  "pcmu",
  "pcma",
]);

const ALLOWED_VIDEO_CODECS = new Set([
  "vp8",
  "vp9",
  "h264",
  // AV1 ships default-on in Chrome (Win/macOS) and Edge as of 2024 and
  // in Safari 17.4+ on Apple Silicon. Rejecting it breaks real-browser
  // negotiation in 4-peer mixed-device calls — observed in the staging
  // test run (Chrome Win11 ThinkPad as offerer, mobile DDG browsers
  // as receivers, all sdp_validation_failed→disallowed_codec).
  "av1",
  // H.265 / HEVC ships in Safari 17+ and behind a flag in Chrome.
  // Same compatibility argument: it's a real, royalty-tracked video
  // codec, not an exotic attack surface.
  "h265",
  // The entries below are RTP mechanisms, not video codecs in the
  // conventional sense — but real browsers list them via `a=rtpmap`
  // alongside the primary codecs, so the codec allowlist is the
  // correct place to gate them. Do not remove thinking they're dead:
  //   - rtx        RFC 4588 retransmission payload (every PT in the
  //                primary codec list gets a paired RTX PT in Chrome
  //                / Firefox / Safari offers).
  //   - red        RFC 2198 redundant encoding; used to wrap forward
  //                error correction packets and, in audio, Opus
  //                redundancy.
  //   - ulpfec     RFC 5109 uneven-level protection FEC.
  //   - flexfec-03 draft-ietf-payload-flexible-fec-03 FEC; Chrome
  //                negotiates it when both peers offer it.
  "rtx",
  "red",
  "ulpfec",
  "flexfec-03",
]);

// DTLS fingerprint hash algorithms we accept. SHA-1 / MD5 are
// rejected: SHA-1 is theoretically collidable today and MD5 has
// been broken for over a decade. Real browsers emit SHA-256.
const ALLOWED_FINGERPRINT_ALGS = new Set(["sha-256", "sha-384", "sha-512"]);

/**
 * Validate an inbound SDP string. Returns a discriminated union so
 * the caller can branch on `result.ok` and surface the specific
 * rejection reason in the audit log.
 */
export function validateSdp(sdp: string): SdpValidationResult {
  if (typeof sdp !== "string") {
    return { ok: false, reason: "missing_required_field" };
  }

  if (!isWellFormedUtf16(sdp)) {
    return { ok: false, reason: "invalid_utf8" };
  }

  // Byte length, not code-unit length: a multibyte sequence costs
  // 2-4 bytes on the wire and we want the cap to be a real memory
  // bound, not a UTF-16 code-unit accident.
  const byteLen = utf8ByteLength(sdp);
  if (byteLen > SDP_MAX_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  // SDP lines are CRLF-terminated per RFC 4566 but real
  // implementations are sloppy and emit bare LF in places. Split on
  // both to keep the line count honest.
  const lines = sdp.split(/\r\n|\n/);
  // Trailing empty line after final CRLF is normal — strip it before
  // counting so a perfectly-shaped offer doesn't burn a slot.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length > SDP_MAX_LINES) {
    return { ok: false, reason: "too_many_lines" };
  }

  // Required structural fields (RFC 4566 §5). `v=`, `o=`, `s=`,
  // `t=` are session-level; at least one `m=` line is required for
  // the SDP to mean anything to setRemoteDescription.
  let hasV = false;
  let hasO = false;
  let hasS = false;
  let hasT = false;
  let hasFingerprint = false;
  let mediaCount = 0;
  let candidateCount = 0;

  for (const line of lines) {
    if (line.startsWith("v=")) hasV = true;
    else if (line.startsWith("o=")) hasO = true;
    else if (line.startsWith("s=")) hasS = true;
    else if (line.startsWith("t=")) hasT = true;
    else if (line.startsWith("m=")) mediaCount++;

    // Per-attribute byte cap. Apply to every line, not just `a=`,
    // so a giant `o=` or `m=` line can't sneak past either.
    if (utf8ByteLength(line) > SDP_MAX_ATTR_BYTES) {
      return { ok: false, reason: "attribute_too_long" };
    }

    if (line.startsWith("a=candidate:")) {
      candidateCount++;
      const candReason = validateCandidateLine(line.slice(2));
      if (candReason) return { ok: false, reason: candReason };
    }

    if (line.startsWith("a=fingerprint:")) {
      const fpReason = validateFingerprintLine(line);
      if (fpReason) return { ok: false, reason: fpReason };
      hasFingerprint = true;
    }
  }

  if (!hasV || !hasO || !hasS || !hasT || mediaCount === 0) {
    return { ok: false, reason: "missing_required_field" };
  }

  // DTLS fingerprint is mandatory for any WebRTC SDP we'd actually
  // hand to setRemoteDescription — without it the browser can't
  // anchor the DTLS handshake. Requiring it here closes the door on
  // partial-shape stubs that pass the v=/o=/s=/t=/m= check but
  // would never represent a real negotiation.
  if (!hasFingerprint) {
    return { ok: false, reason: "missing_required_field" };
  }

  if (candidateCount > SDP_MAX_CANDIDATES) {
    return { ok: false, reason: "too_many_candidates" };
  }

  // Codec allowlist enforcement — per m-section. We split the SDP
  // into media sections so an `a=rtpmap` line is checked against
  // the correct (audio vs video) allowlist.
  const codecResult = validateCodecs(lines);
  if (codecResult) {
    return { ok: false, reason: codecResult.reason, detail: codecResult.detail };
  }

  return { ok: true, sdp };
}

/**
 * Validate a trickled ICE candidate before `addIceCandidate`.
 * Accepts the wire-format `RTCIceCandidateInit` and checks the
 * same address / size / UTF-8 rules the per-offer SDP path applies
 * to inline candidates. An empty candidate string (end-of-candidates
 * sentinel) is accepted as a no-op.
 */
export function validateIceCandidate(
  candidate: RTCIceCandidateInit | null | undefined,
): SdpValidationResult {
  if (!candidate || typeof candidate !== "object") {
    return { ok: false, reason: "malformed_candidate" };
  }
  const raw = candidate.candidate;
  if (typeof raw !== "string") {
    return { ok: false, reason: "malformed_candidate" };
  }
  // End-of-candidates sentinel — RFC 8838 §5.1 lets the empty
  // string travel as an explicit "no more candidates" signal.
  if (raw === "") return { ok: true, sdp: raw };

  if (!isWellFormedUtf16(raw)) {
    return { ok: false, reason: "invalid_utf8" };
  }
  if (utf8ByteLength(raw) > SDP_MAX_ATTR_BYTES) {
    return { ok: false, reason: "attribute_too_long" };
  }
  const reason = validateCandidateLine(raw);
  if (reason) return { ok: false, reason };
  return { ok: true, sdp: raw };
}

// ── internals ────────────────────────────────────────────────────

function utf8ByteLength(s: string): number {
  // Native — and the TextEncoder is unconditionally present in
  // modern browsers and Node 18+ (our minimum supported runtime per
  // the test harness in vitest.config.ts).
  return new TextEncoder().encode(s).byteLength;
}

/**
 * Detect ill-formed UTF-16 (lone surrogates). JS strings are stored
 * as UTF-16 code units; a lone surrogate is not representable in
 * UTF-8 and would either throw or produce a replacement character
 * when passed through any UTF-8 transcoder. We loud-fail instead.
 */
function isWellFormedUtf16(s: string): boolean {
  // `String.prototype.isWellFormed` is the canonical check (ES2024).
  // It's present in every browser we ship to, but fall back to the
  // manual scan when the helper is missing (e.g. older test runners).
  const native = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof native === "function") {
    return native.call(s);
  }
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      if (i + 1 >= s.length) return false;
      const next = s.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function validateFingerprintLine(line: string): SdpValidationReason | null {
  // `a=fingerprint:<alg> <hex>` per RFC 8122 §5.
  const m = /^a=fingerprint:([A-Za-z0-9-]+)\s+/.exec(line);
  if (!m) return "disallowed_fingerprint_algorithm";
  if (!ALLOWED_FINGERPRINT_ALGS.has(m[1].toLowerCase())) {
    return "disallowed_fingerprint_algorithm";
  }
  return null;
}

/**
 * Validate one `candidate:...` payload (no leading `a=`). Checks
 * the shape is parseable and rejects link-local / loopback
 * addresses that would leak local network topology.
 */
function validateCandidateLine(payload: string): SdpValidationReason | null {
  // candidate:<foundation> <component> <transport> <priority>
  // <connection-address> <port> typ <type> ...
  const tokens = payload.split(/\s+/);
  if (tokens.length < 8) return "malformed_candidate";
  if (!tokens[0].startsWith("candidate:")) return "malformed_candidate";
  const address = tokens[4];
  if (!address) return "malformed_candidate";
  if (isDisallowedAddress(address)) return "disallowed_address";
  // Validate any `raddr` (reflexive / related address) token too —
  // a srflx/relay candidate can embed the local address there and
  // smuggle the same leak past a check that only looks at column 5.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === "raddr") {
      const rel = tokens[i + 1];
      if (rel && isDisallowedAddress(rel)) return "disallowed_address";
    }
  }
  return null;
}

function isDisallowedAddress(addr: string): boolean {
  // Strip IPv6 zone-id (`fe80::1%eth0`) before classifying.
  const a = addr.split("%")[0].toLowerCase();

  // IPv4 dotted-quad.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) {
    const parts = a.split(".").map((x) => parseInt(x, 10));
    if (parts.some((p) => p < 0 || p > 255)) return true;
    // 127.0.0.0/8 loopback.
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 link-local.
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
  }

  // IPv6 forms. Accept either compressed (::1) or expanded.
  if (a.includes(":")) {
    if (a === "::1") return true;
    // fe80::/10 — first 10 bits = 1111 1110 10xx → high byte 0xfe,
    // next byte top 2 bits = 10 → byte in [0x80, 0xbf].
    const m = /^fe([89ab])[0-9a-f]?:/i.exec(a);
    if (m) return true;
    // Accept compact `fe80:` literal too.
    if (a.startsWith("fe80:") || a.startsWith("fe80::")) return true;
    return false;
  }

  // Hostnames (mDNS `.local`, server-reflexive hostnames) are not
  // numeric addresses we can classify here — the browser's own ICE
  // agent applies its own rules. Don't reject what we can't parse.
  return false;
}

// Build per-section payload-type → codec name maps from `a=rtpmap`
// lines, then verify every payload type declared in the `m=` line
// has an allowlisted codec. This closes the static-PT bypass: a
// peer cannot list `m=audio 9 ... 0 8` (PCMU/PCMA) without
// `a=rtpmap` lines — those PTs would have no codec proven and we
// reject the SDP. Real Chrome/Firefox offers always include
// `a=rtpmap` for every PT they advertise.
type MediaSection = {
  kind: "audio" | "video" | "other";
  pts: string[];
  rtpmaps: Map<string, string>;
};

function validateCodecs(
  lines: string[],
): { reason: SdpValidationReason; detail: string } | null {
  const sections: MediaSection[] = [];
  let current: MediaSection | null = null;

  for (const line of lines) {
    if (line.startsWith("m=")) {
      // `m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126`
      const tokens = line.slice(2).split(/\s+/);
      const kindRaw = tokens[0]?.toLowerCase();
      const kind: MediaSection["kind"] =
        kindRaw === "audio" ? "audio" : kindRaw === "video" ? "video" : "other";
      // Payload-type list starts at column 3 (index 3) — after kind,
      // port, proto.
      const pts = tokens.slice(3).filter((t) => /^\d+$/.test(t));
      current = { kind, pts, rtpmaps: new Map() };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const m = /^a=rtpmap:(\d+)\s+([A-Za-z0-9-]+)\b/.exec(line);
    if (m) current.rtpmaps.set(m[1], m[2].toLowerCase());
  }

  for (const section of sections) {
    if (section.kind === "other") continue;
    const allowed =
      section.kind === "audio" ? ALLOWED_AUDIO_CODECS : ALLOWED_VIDEO_CODECS;
    for (const pt of section.pts) {
      const codec = section.rtpmaps.get(pt);
      // No rtpmap → can't prove the PT resolves to an allowed
      // codec, even if the implicit static mapping would (PT 0 =
      // PCMU, PT 8 = PCMA, PT 9 = G722). Reject.
      if (!codec) {
        return {
          reason: "disallowed_codec",
          detail: `${section.kind}/pt=${pt}/no-rtpmap`,
        };
      }
      if (!allowed.has(codec)) {
        return {
          reason: "disallowed_codec",
          detail: `${section.kind}/pt=${pt}/codec=${codec}`,
        };
      }
    }
  }
  return null;
}
