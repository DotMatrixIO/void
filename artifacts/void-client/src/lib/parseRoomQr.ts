// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseHashPhrase } from "./voidPhrase";

/**
 * Pull a Void room phrase out of arbitrary scanned QR data.
 *
 * Accepts:
 *  - Full URLs that carry a phrase hash (e.g. `https://void.example/#a-b-c-d-e-f`)
 *  - The hash fragment alone (e.g. `#a-b-c-d-e-f`)
 *  - The dashed phrase alone (e.g. `a-b-c-d-e-f`)
 *
 * Returns the canonical space-separated 6-word phrase if the data points at a
 * valid Void room, or `null` for anything else (including unrelated URLs).
 */
export function parseRoomQr(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 1. Treat as a URL when it parses as one. We only care about the hash;
  //    the origin/path can be anything (room links may come from a different
  //    Void deployment).
  try {
    const url = new URL(trimmed);
    if (url.hash) {
      const fromUrl = parseHashPhrase(url.hash.toLowerCase());
      if (fromUrl) return fromUrl;
    }
  } catch {
    // not a URL — fall through to fragment / phrase parsing
  }

  // 2. Bare hash fragment.
  if (trimmed.startsWith("#")) {
    return parseHashPhrase(trimmed.toLowerCase());
  }

  // 3. Bare dashed phrase — re-add the leading `#` and reuse the same parser
  //    so word-count / BIP-39 validation stays in one place.
  if (/^[a-zA-Z]+(?:-[a-zA-Z]+){5}$/.test(trimmed)) {
    return parseHashPhrase("#" + trimmed.toLowerCase());
  }

  // 4. Bare space-separated phrase — tolerated for legacy printed phrase
  //    QRs and manual paste. The current `PhraseShareModal` QR encodes the
  //    full join URL (handled by case 1), but older printouts and hand-
  //    typed input may still arrive as a bare 6-word phrase. Normalize the
  //    whitespace into the dashed form and reuse the same validator so the
  //    word-count / BIP-39 check stays in one place.
  if (/^[a-zA-Z]+(?:\s+[a-zA-Z]+){5}$/.test(trimmed)) {
    const dashed = trimmed.toLowerCase().split(/\s+/).join("-");
    return parseHashPhrase("#" + dashed);
  }

  return null;
}
