// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dropSanitize.ts — Task #443.
 *
 * The shared DROP slot is a single UTF-8 string ≤2 KB that is rendered as
 * plain React text on every peer's screen. The slot is broadcast over a
 * per-peer RTCDataChannel("drop") and atomically overwrites whatever the
 * previous text was. There is no history, no per-peer view, no formatting,
 * no auto-linkify, no markdown.
 *
 * This module centralizes every transformation we apply to a candidate
 * DROP string — both on the local "about to send" path and on the remote
 * "just received" path. We apply it on both sides on purpose: the sender
 * cannot trust the receiver to sanitize, and the receiver cannot trust the
 * sender to sanitize. Either side may run an older or modified client.
 *
 * The transformations are deliberately strict:
 *
 *   1. Unicode NFC normalization. Prevents the same visual character from
 *      arriving as multiple distinct byte sequences (combining diacritics,
 *      precomposed vs decomposed Hangul, etc.).
 *   2. Strip ASCII control bytes (U+0000-U+001F) except U+0009 (TAB) and
 *      U+000A (LF). U+000D (CR) is normalized to LF first so paste from a
 *      Windows clipboard does not produce blank double-spaced lines.
 *   3. Strip C1 control bytes (U+007F DEL, U+0080-U+009F).
 *   4. Strip zero-width and invisible-formatting code points that are a
 *      well-known homograph / spoof vector:
 *        U+200B ZERO WIDTH SPACE
 *        U+200C ZERO WIDTH NON-JOINER
 *        U+200D ZERO WIDTH JOINER
 *        U+2060 WORD JOINER
 *        U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM
 *   5. Strip bidirectional override controls that can visually re-order
 *      arbitrary substrings — the "Trojan Source" class of attack:
 *        U+202A-U+202E LRE/RLE/PDF/LRO/RLO
 *        U+2066-U+2069 LRI/RLI/FSI/PDI
 *   6. Cap the result at 2048 UTF-8 bytes. We measure with TextEncoder
 *      (not `.length`) so multi-byte characters are charged honestly.
 *      Truncation is done at a code-point boundary so we never emit half
 *      a surrogate pair or half a multi-byte sequence.
 *
 * Returns the cleaned string plus a `mutated` flag that the UI uses to
 * surface "(some invisible characters were removed)" — the user should
 * know when a paste was silently rewritten.
 */

export const DROP_MAX_BYTES = 2048;

const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const INVISIBLE_RE = /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g;

export interface SanitizeResult {
  /** The sanitized text. Always a string. May be empty. */
  text: string;
  /** True if any character was stripped, normalized, or the input was
   *  truncated at the 2 KB byte cap. The UI shows a hint when true. */
  mutated: boolean;
}

/**
 * Truncate `text` so its UTF-8 byte length is ≤ `maxBytes`, never
 * splitting a code point. Returns `{ text, truncated }`.
 */
function clampToBytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return { text, truncated: false };
  // Walk code-point boundaries and stop just before we would exceed
  // maxBytes. Using the spread iterator handles surrogate pairs.
  let total = 0;
  let out = "";
  for (const ch of text) {
    const chBytes = encoder.encode(ch).length;
    if (total + chBytes > maxBytes) break;
    out += ch;
    total += chBytes;
  }
  return { text: out, truncated: true };
}

/**
 * Sanitize a candidate DROP string. Applies NFC, strips control /
 * zero-width / RTL-override code points, normalizes CRLF to LF, and
 * caps the result at 2 KB UTF-8.
 *
 * The `mutated` flag is true if the output differs from the input in
 * any way after the above transformations — the caller (DropSlot UI)
 * uses it to show a one-line hint to the user.
 */
export function sanitizeDrop(input: string): SanitizeResult {
  if (typeof input !== "string") return { text: "", mutated: true };
  if (input.length === 0) return { text: "", mutated: false };

  // CRLF / lone-CR → LF so Windows pastes don't produce blank lines.
  let s = input.replace(/\r\n?/g, "\n");

  // NFC normalize. Some platforms emit decomposed sequences; this
  // collapses them to canonical composed form so two visually-identical
  // strings compare equal byte-for-byte downstream.
  s = s.normalize("NFC");

  // Strip control bytes (keeping TAB and LF).
  s = s.replace(CONTROL_RE, "");

  // Strip zero-width and bidi-override invisibles.
  s = s.replace(INVISIBLE_RE, "");

  // Cap at the byte budget.
  const clamped = clampToBytes(s, DROP_MAX_BYTES);

  const mutated = clamped.text !== input;
  return { text: clamped.text, mutated };
}
