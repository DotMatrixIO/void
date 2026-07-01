// SPDX-License-Identifier: AGPL-3.0-or-later
// SDP / crypto-fingerprint helpers extracted from webrtc.ts during
// the Refactor 2 decomposition (task #448). These are pure functions
// with no peer-connection state — they exist as their own module so
// the orchestrator class doesn't carry codec-rewriting trivia
// alongside per-peer lifecycle code.

function setFmtpParam(params: string, key: string, value: string): string {
  const re = new RegExp(`(^|;)${key}=[^;]*`, "i");
  if (re.test(params)) {
    return params.replace(re, `$1${key}=${value}`);
  }
  return params ? params + `;${key}=${value}` : `${key}=${value}`;
}

export function clampOpusBitrate(sdp: string): string {
  const lines = sdp.split("\r\n");
  let opusPT: string | null = null;
  for (const line of lines) {
    const m = line.match(/^a=rtpmap:(\d+)\s+opus\//i);
    if (m) { opusPT = m[1]; break; }
  }
  if (!opusPT) {
    // No Opus codec to clamp, but the DTMF strip is independent of
    // Opus and the "DTMF can never flow" guarantee must hold for every
    // SDP — including Opus-less audio sections. Run the strip and
    // return without touching the CBR/DTX/ssrc-audio-level logic (which
    // is Opus-scoped and out of this change's scope).
    return stripDtmf(lines).join("\r\n");
  }

  const fmtpPrefix = `a=fmtp:${opusPT}`;
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(fmtpPrefix)) continue;
    found = true;
    const spaceIdx = lines[i].indexOf(" ");
    let params = spaceIdx !== -1 ? lines[i].slice(spaceIdx + 1) : "";
    params = setFmtpParam(params, "maxaveragebitrate", "24000");
    params = setFmtpParam(params, "stereo", "0");
    params = setFmtpParam(params, "sprop-stereo", "0");
    // Opus VBR is a packet-size side-channel against SRTP: a passive
    // on-path observer can infer phonemes/language from frame sizes
    // without decrypting media ("Spot Me If You Can", Wright et al.
    // 2008). DTX leaks silence-vs-speech the same way. Request CBR
    // and disable DTX in the fmtp line; the browser ultimately
    // enforces the encoded behavior.
    params = setFmtpParam(params, "cbr", "1");
    params = setFmtpParam(params, "usedtx", "0");
    lines[i] = `${fmtpPrefix} ${params}`;
    break;
  }
  if (!found) {
    const rtpmapIdx = lines.findIndex((l) => l.startsWith(`a=rtpmap:${opusPT}`));
    if (rtpmapIdx !== -1) {
      lines.splice(rtpmapIdx + 1, 0, `${fmtpPrefix} maxaveragebitrate=24000;stereo=0;sprop-stereo=0;cbr=1;usedtx=0`);
    }
  }
  // Strip the ssrc-audio-level RTP header extension. VOID does not
  // consume it (no speaking indicator, no client-side VAD UI), and
  // when present it exposes per-packet audio loudness in cleartext
  // RTP headers — a second packet-shape side-channel orthogonal to
  // CBR. If a future feature needs it, remove this strip and
  // document the trade-off here.
  const filtered = lines.filter(
    (l) => !/^a=extmap:\d+(\/[^ ]*)?\s+urn:ietf:params:rtp-hdrext:ssrc-audio-level\b/i.test(l),
  );

  // Strip the DTMF (telephone-event) codec entirely from the audio
  // m-section(s). Every real browser offer carries telephone-event, but
  // VOID ships no dialpad, so DTMF is never a feature — and the codec
  // is a packet-timing side-channel surface (RFC 4733 sends each digit
  // as its own RTP event packet, whose timing would leak independently
  // of the CBR-flattened Opus stream). Defense-in-depth: removing the
  // codec from the negotiated SDP guarantees no DTMF can be sent or
  // received over a VOID call, regardless of any future dialpad-shaped
  // UI. The inbound validator still *tolerates* telephone-event (it is
  // reject-only and rewriting at the munge is the correct place to drop
  // it); this strip is what makes that tolerance safe.
  //
  // CRITICAL: payload-type numbers are scoped to their m= section, not
  // global. A video codec may legally reuse a PT number that the audio
  // section assigned to telephone-event, so DTMF PTs are collected and
  // their dependent attribute lines (rtpmap/fmtp/rtcp-fb) removed ONLY
  // within the same audio section that declared them.
  return stripDtmf(filtered).join("\r\n");
}

// Remove the telephone-event (DTMF) codec from every audio m-section,
// scoping payload-type matching to the section it belongs to. Returns
// the rewritten line array (the m=audio format list has the DTMF PTs
// removed; the codec's rtpmap/fmtp/rtcp-fb lines are dropped).
function stripDtmf(lines: string[]): string[] {
  // Index of every m= line; each marks the start of a media section.
  const sectionStarts: number[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (/^m=/.test(lines[k])) sectionStarts.push(k);
  }
  const removal = new Set<number>();
  const out = [...lines];

  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s];
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1] : lines.length;
    if (!/^m=audio\s/.test(lines[start])) continue;

    // First pass over THIS section only: collect its DTMF PTs.
    const pts = new Set<string>();
    for (let k = start; k < end; k++) {
      const m = lines[k].match(/^a=rtpmap:(\d+)\s+telephone-event\//i);
      if (m) pts.add(m[1]);
    }
    if (pts.size === 0) continue;

    // Rewrite the m=audio line: keep `m=audio <port> <proto>` and drop
    // the DTMF payload types from the remaining format list.
    const parts = lines[start].split(" ");
    const head = parts.slice(0, 3);
    const keep = parts.slice(3).filter((pt) => !pts.has(pt));
    out[start] = [...head, ...keep].join(" ");

    // Second pass over THIS section only: drop the DTMF codec's
    // dependent attribute lines.
    for (let k = start; k < end; k++) {
      if (/^a=rtpmap:(\d+)\s+telephone-event\//i.test(lines[k])) {
        removal.add(k);
        continue;
      }
      const fm = lines[k].match(/^a=fmtp:(\d+)\b/);
      if (fm && pts.has(fm[1])) {
        removal.add(k);
        continue;
      }
      const fb = lines[k].match(/^a=rtcp-fb:(\d+)\b/);
      if (fb && pts.has(fb[1])) {
        removal.add(k);
      }
    }
  }

  return out.filter((_, idx) => !removal.has(idx));
}

// SHA-256 over the encoded ECDH public key, base64url. Deterministic
// 1:1 with the underlying SPKI bytes.
export async function fingerprintRemoteKey(encodedPub: string): Promise<string> {
  const bytes = new TextEncoder().encode(encodedPub);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const u8 = new Uint8Array(digest);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
