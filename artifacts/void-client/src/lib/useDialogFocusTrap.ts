// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Options {
  // Called on Escape. Omit for overlays where Escape should not dismiss
  // (e.g. the ROOM ENDED screen, which is terminal).
  onEscape?: () => void;
  // When false, the hook is a no-op. Lets the same hook be wired into a
  // component that conditionally renders.
  active?: boolean;
}

// Shared accessible-dialog focus trap that mirrors
// SasVerificationDialog's behavior:
//   - On mount: remember the previously-focused element and move focus
//     to the first focusable inside the dialog so screen readers
//     announce it from the top.
//   - While mounted: cycle Tab / Shift+Tab inside the dialog so
//     keyboard users can't tab out into the (visually hidden but DOM-
//     present) page underneath.
//   - On unmount: restore focus to whoever had it before, so the user's
//     point of regard is preserved.
//
// Escape handling is opt-in because some overlays (BURN, ROOM ENDED)
// auto-dismiss or are terminal and shouldn't honor Escape.
export function useDialogFocusTrap<T extends HTMLElement>(
  options: Options = {},
): RefObject<T | null> {
  const { onEscape, active = true } = options;
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      if (first) {
        first.focus();
      } else {
        // No focusable child (purely informational dialog). Park focus on
        // the dialog container itself so screen readers still announce
        // the labelled heading and Tab cycling is contained.
        if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
        try {
          node.focus();
        } catch {
          // ignore
        }
      }
    }

    const onKey = (e: KeyboardEvent) => {
      // Gate every key handler on `ref.current` being mounted. Without
      // this, an overlay whose state is still `active=true` but which is
      // not currently rendered (e.g. another higher-priority overlay
      // took over via early return) would still swallow Escape and
      // invoke its dismissal callback, which would be confusing.
      const d = ref.current;
      if (!d || !d.isConnected) return;
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(d.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (!activeEl || activeEl === firstEl || !d.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (!activeEl || activeEl === lastEl || !d.contains(activeEl)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        try {
          previouslyFocused.focus();
        } catch {
          // ignore
        }
      }
    };
    // We deliberately re-run only on `active` toggling. onEscape is read
    // through a ref so callers can pass fresh closures without thrashing
    // the listener.
  }, [active]);

  return ref;
}
