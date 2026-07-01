// SPDX-License-Identifier: AGPL-3.0-or-later
// Canonical "share a join link" affordance shared by the pre-call lobby
// (PreviewGate) and any other host-facing surface that wants the same
// behaviour as the in-room SHARE button: prefer the native Web Share
// sheet on touch devices, fall back to writing the link to the clipboard
// on desktop or when the share sheet is unavailable / dismissed.
//
// Returning a discriminated outcome lets the caller drive its own
// transient "SENT ✓" / "COPIED ✓" feedback without re-implementing the
// branching every time.
export type ShareOutcome = "sent" | "copied" | "aborted" | "unavailable";

export interface ShareOrCopyOptions {
  /** The link peers will open to join. */
  url: string;
  /** Title handed to the native share sheet. */
  title?: string;
  /** Free-text shown alongside the URL in the native share sheet. */
  shareText?: string;
  /** Text written to the clipboard on the fallback path. Defaults to `url`. */
  clipboardText?: string;
}

async function copyFallback(text: string): Promise<ShareOutcome> {
  if (!navigator.clipboard?.writeText) return "unavailable";
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    // Insecure context / older browser — nothing more we can do here.
    return "unavailable";
  }
}

export async function shareOrCopyUrl(
  opts: ShareOrCopyOptions,
): Promise<ShareOutcome> {
  const { url, title = "Void", shareText = "", clipboardText = url } = opts;

  const isMobile =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;

  if (isMobile && "share" in navigator) {
    try {
      await navigator.share({ title, text: shareText, url });
      return "sent";
    } catch (e: unknown) {
      // User dismissed the sheet — treat as a no-op, do not silently copy.
      if (e instanceof DOMException && e.name === "AbortError") return "aborted";
      return copyFallback(clipboardText);
    }
  }

  return copyFallback(clipboardText);
}
