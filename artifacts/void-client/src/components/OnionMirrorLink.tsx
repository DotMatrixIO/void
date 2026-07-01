// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DocsAnchorLink from "@/components/DocsAnchorLink";
import { isOnionOrigin } from "@/lib/origin";
import { getOnionMirrorUrl } from "@/lib/onionMirror";
import {
  clearCachedOnionReachability,
  detectOnionReachability,
  getCachedOnionReachability,
  ONION_BACKGROUND_REPROBE_THRESHOLD_MS,
  type OnionReachability,
} from "@/lib/onionReachability";

// Task #384 — persistent "ALSO ON .ONION" footer affordance.
//
// Rendered on every clearnet page the footer appears on. No UA
// sniffing: Tor Browser's own `Onion-Location` auto-prompt is the
// primary discovery mechanism for the audience that benefits most,
// and a small always-visible footer link covers users on other
// Tor-aware browsers, on Orbot-routed connections, and on regular
// browsers who want to share the .onion address with someone else.
// Hidden when the page is already loaded via the onion origin
// (avoids a redundant self-link).
//
// Also reachable from inside the installed PWA via every page that
// renders `PageFooter` (ThreatModel, Why, Compare, Pricing, Limits,
// Biometric, Audit, AgentMode, ServerStateProof) — satisfying the
// "reuse the .onion copy helper on an in-PWA surface" step without
// abusing the `related_applications` manifest field.
//
// Task #389 — surface a short hint when the user is plainly on a
// clearnet browser whose network cannot route `.onion`. We avoid UA
// sniffing entirely; the signal comes from a `no-cors` HEAD probe
// against the mirror with a short timeout. See
// `lib/onionReachability.ts` for the signal hierarchy. When the
// probe is inconclusive (offline, timeout, no `fetch`), we degrade
// to the previous always-visible link with no hint.
export default function OnionMirrorLink() {
  const onionUrl = useMemo(() => getOnionMirrorUrl(), []);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [reachability, setReachability] = useState<OnionReachability | null>(() =>
    getCachedOnionReachability(),
  );

  const handleCopy = useCallback(async () => {
    if (!onionUrl) return;
    try {
      await navigator.clipboard.writeText(onionUrl);
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail in restricted contexts (no user
      // gesture, insecure origin, permissions policy). Fall back
      // to surfacing the raw URL so the user can copy manually.
      setCopied(false);
      setCopyFailed(true);
    }
  }, [onionUrl]);

  useEffect(() => {
    if (!onionUrl) return;
    if (reachability !== null) return;
    if (isOnionOrigin()) return;
    const ctrl = new AbortController();
    let cancelled = false;
    detectOnionReachability(onionUrl, { signal: ctrl.signal })
      .then((r) => {
        if (!cancelled) setReachability(r);
      })
      .catch(() => {
        // detectOnionReachability never rejects, but be defensive.
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [onionUrl, reachability]);

  // Task #426 — invalidate the cached probe result when the network
  // comes back online, or when the tab returns to foreground after a
  // long background period. Without this, a user who was offline /
  // on a captive portal when the first probe ran stays stuck with the
  // stale "unreachable"/"unknown" result for the lifetime of the tab,
  // even after they switch to Tor Browser / Orbot.
  //
  // Probe-storm guard: clearing the cache + nulling state schedules at
  // most one re-probe per transition (the probe effect above writes a
  // fresh cache entry before the next event could fire). A quick
  // alt-tab does NOT count as a returning-from-background transition;
  // we require at least ONION_BACKGROUND_REPROBE_THRESHOLD_MS of
  // hidden time first.
  const hiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!onionUrl) return;
    if (isOnionOrigin()) return;
    if (typeof window === "undefined") return;

    hiddenSinceRef.current =
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? Date.now()
        : null;

    const invalidate = () => {
      clearCachedOnionReachability();
      setReachability(null);
    };

    const onOnline = () => {
      invalidate();
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const since = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      if (since !== null && Date.now() - since >= ONION_BACKGROUND_REPROBE_THRESHOLD_MS) {
        invalidate();
      }
    };

    window.addEventListener("online", onOnline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      window.removeEventListener("online", onOnline);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [onionUrl]);

  if (!onionUrl) return null;
  if (isOnionOrigin()) return null;

  return (
    <div
      data-testid="onion-mirror-link"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "6px",
      }}
    >
      {/* Task #1022: name the current path so "clearnet" is an explicit,
          known state — not an invisible default. The .onion link below is
          the one-click switch; the caption underneath discloses, honestly,
          that this very page load already reached us over clearnet. */}
      <span
        data-testid="onion-mirror-clearnet-state"
        style={{
          color: "var(--fg-dim)",
          fontSize: "10px",
          letterSpacing: "2px",
          textTransform: "uppercase",
        }}
      >
        You are on the clearnet path
      </span>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
      <span style={{ color: "var(--fg-dim)" }}>ALSO ON .ONION: </span>
      <a
        href={onionUrl}
        rel="noopener noreferrer"
        style={{
          // Task #406: --teal on --bg = 1.64:1 fails WCAG AA for body text.
          // Use --fg (8.37:1) for the URL itself; the teal underline and the
          // sibling "Copy" pill carry the accent affordance without putting
          // unreadable text in a footer that links to our .onion mirror.
          color: "var(--fg)",
          textDecoration: "underline",
          textDecorationColor: "var(--teal)",
          textUnderlineOffset: "2px",
          letterSpacing: "1px",
          fontSize: "11px",
          maxWidth: "min(80vw, 360px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {onionUrl}
      </a>
      <button
        type="button"
        onClick={handleCopy}
        data-testid="onion-mirror-copy"
        style={{
          background: "transparent",
          border: "1px solid var(--teal)",
          // Task #406: text was var(--teal) on --bg = 1.64:1 (FAIL AA). Use
          // --fg (8.37:1) for the label; the 1px teal border keeps the
          // affordance.
          color: "var(--fg)",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          letterSpacing: "2px",
          padding: "3px 8px",
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {reachability === "unreachable" && (
        <span
          data-testid="onion-mirror-hint"
          style={{
            color: "var(--fg-dim)",
            fontSize: "10px",
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          requires Tor Browser
        </span>
      )}
      {copyFailed && (
        <input
          type="text"
          readOnly
          value={onionUrl}
          data-testid="onion-mirror-fallback"
          aria-label="Our .onion mirror address (copy failed — select manually)"
          ref={(el) => {
            if (el) {
              el.focus();
              el.select();
            }
          }}
          style={{
            fontSize: "16px",
            // Task #406: text was var(--teal) on --bg = 1.64:1 (FAIL AA). Use
            // --fg (8.37:1); the 1px teal border keeps the affordance.
            color: "var(--fg)",
            letterSpacing: "1px",
            border: "1px solid var(--teal)",
            padding: "3px 6px",
            fontFamily: "var(--font-mono)",
            background: "transparent",
            maxWidth: "min(60vw, 320px)",
            minWidth: "160px",
          }}
        />
      )}
      </div>
      {/* Task #1022: bootstrap-honesty disclosure. Even when a reader switches
          to .onion next, this clearnet page load already reached us over the
          public internet — say so plainly. The .onion address only moves the
          signaling layer behind a hidden service; it does not hide an IP from
          the other people on a call (their media path stays on each peer's own
          network). */}
      <span
        data-testid="onion-mirror-bootstrap-note"
        style={{
          color: "var(--fg-dim)",
          fontSize: "10px",
          letterSpacing: "0.5px",
          lineHeight: 1.4,
          maxWidth: "min(90vw, 420px)",
          textAlign: "center",
        }}
      >
        This visit already reached us over the public internet. Opening the
        .onion address in Tor Browser keeps our signaling layer behind a hidden
        service from then on — it does not hide your IP from the other people on
        a call.
      </span>
      {/* Task #1039: deep-link the switch to the explainer subsection so a
          reader can learn how VOID surfaces the .onion path (and what the
          one-click switch does and does not change). Wouter in-app routing,
          not a full-page <a> — a hard nav to a constructed BASE_URL strands
          the user on a blank page inside the proxied preview iframe. */}
      <DocsAnchorLink
        href="/docs/threat-model#how-void-surfaces-the-onion-path"
        testId="onion-mirror-explainer-link"
        style={{
          // Task #406 pattern: --teal on --bg is 1.64:1 (FAIL AA). Use --fg
          // (8.37:1) for the text and carry the accent on the teal underline.
          color: "var(--fg)",
          textDecoration: "underline",
          textDecorationColor: "var(--teal)",
          textUnderlineOffset: "2px",
          fontSize: "10px",
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        How VOID surfaces the .onion path →
      </DocsAnchorLink>
    </div>
  );
}
