// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import HamburgerMenu from "@/components/HamburgerMenu";
import { hostnameIsOnion, isOnionOrigin } from "@/lib/origin";
import {
  clearCachedOnionReachability,
  detectOnionReachability,
  getCachedOnionReachability,
  ONION_BACKGROUND_REPROBE_THRESHOLD_MS,
  type OnionReachability,
} from "@/lib/onionReachability";
import { markPaidCreateOnion } from "@/lib/paidCreateOnion";
import { getSocket } from "@/lib/socket";
import { resumeAudio } from "@/lib/sounds";
import { uiClick } from "@/lib/uiSounds";
import PaywallModal from "@/components/PaywallModal";
import { tokenLooksExpired } from "@/lib/paywallToken";
import Bip39PhraseGrid, {
  emptyPhraseSlots,
  splitPhraseTokens,
  unknownSlotIndices,
} from "@/components/Bip39PhraseGrid";
import {
  generateVoidPhrase,
  validateVoidPhrase,
  deriveRoomCredentials,
} from "@/lib/voidPhrase";

// Lazy: pulls in qr-scanner (and a worker chunk) only when the user opens
// the scanner. Keeps the cold start of the join screen unchanged.
const QrScannerModal = lazy(() => import("@/components/QrScannerModal"));

interface Props {
  onJoinRoom: (roomId: string, e2eKey: CryptoKey, voidPhrase: string, isHost: boolean) => void;
  sessionNotice?: string | null;
  onDismissNotice?: () => void;
  // When true, suppresses the page-level chrome (top header bar with
  // the V[]ID icon + "P2P VIDEO" + onion offer, the brand block with
  // "V [] I D" + "Host 1h / 24h · Join free", the decorative gold
  // Voyager geometry, and the footer). The host page is expected to
  // provide its own chrome around the controls. Modal overlays
  // (session notice, clipboard warning, paywall, QR scanners) are
  // always rendered because they are floating, not part of the page
  // frame.
  chromeless?: boolean;
}

const SLOT_COUNT = 6;
const RECOVERY_SLOT_COUNT = 4;
// Task #250: per-browser flag that records that the first-paste clipboard-
// readability warning has already been surfaced once on this browser. Once
// set, the toast never auto-shows again on this device — the warning is
// strictly one-time per browser. Stored as a single string so the value
// is dead simple to inspect in DevTools and there is no schema to migrate
// later.
const CLIPBOARD_WARNING_KEY = "void:clipboard-warning-shown";
function emptySlots(): string[] {
  return emptyPhraseSlots(SLOT_COUNT);
}

function emptyRecoverySlots(): string[] {
  return emptyPhraseSlots(RECOVERY_SLOT_COUNT);
}

// Task #421: the page-level error lines below (BIP39-not-found notices and
// submission errors) are the SOLE indicator of what went wrong — unlike the
// phrase grid's own inline hint, they have no redundant red border/wavy
// underline to lean on. As plain --red glyphs on the dark concrete card
// (--surface-dark #14110D) they measured only 3.40:1, below the WCAG AA
// body-text threshold of 4.5:1. Recolor the glyph to --fg-on-dark (#F2EEE6,
// well above 4.5:1 on #14110D) and move the red signal onto the pill's
// border, which clears the 3:1 non-text threshold. Both pairs are audited
// as PASS in scripts/check-contrast.mjs.
const ERROR_PILL_STYLE: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--fg-on-dark)",
  letterSpacing: "2px",
  textTransform: "uppercase",
  textAlign: "center",
  maxWidth: "360px",
  border: "1px solid var(--red)",
  borderRadius: "4px",
  padding: "6px 12px",
};

export default function StartScreen({ onJoinRoom, sessionNotice, onDismissNotice, chromeless = false }: Props) {
  useEffect(() => {
    if (!sessionNotice) return;
    const t = setTimeout(() => onDismissNotice?.(), 6000);
    return () => clearTimeout(t);
  }, [sessionNotice, onDismissNotice]);

  const [joinMode, setJoinMode] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Second use of the QR scanner, opened from inside join mode. A scan here
  // does NOT auto-join — it distributes the scanned 6-word phrase into the
  // grid via `splitPhraseTokens`, the same path the bulk-paste field uses,
  // so the user can still review/correct before pressing JOIN.
  const [phraseScanOpen, setPhraseScanOpen] = useState(false);
  // Recovery mode: redeem a one-time recovery code (4 BIP-39 words) to mint
  // a fresh JWT that resumes a paid window the host already paid for. The
  // code is the only thing the user has — we never persist it for them.
  const [recoverMode, setRecoverMode] = useState(false);
  const [recoverWords, setRecoverWords] = useState<string[]>(emptyRecoverySlots);
  const [autoFocusRecover, setAutoFocusRecover] = useState(false);
  const [words, setWords] = useState<string[]>(emptySlots);
  const [autoFocusGrid, setAutoFocusGrid] = useState(false);
  // Bulk "paste the whole phrase" shortcut field above the 6-slot grid.
  // A dedicated single input is the most forgiving on-ramp for guests
  // pasting from Messages, email, or a password manager — they don't
  // have to think about which slot is "first" or where focus is. The
  // field clears after distributing so the same phrase doesn't double-
  // render below the grid.
  const [bulkPhrase, setBulkPhrase] = useState("");
  // When a paste/typed input contained more than SLOT_COUNT tokens, we
  // silently took the first 6 and surface a one-line friendly hint so the
  // user understands why their 7th+ word didn't land.
  const [bulkOverflowHint, setBulkOverflowHint] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  // Task #1143: when set, the paywall modal resumes an interrupted paid
  // flow (polls this hash instead of showing the tier picker).
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  // Task #250: clipboard-readability warning. The first time on this
  // browser that a user pastes a multi-word phrase into the join grid,
  // surface a one-time toast that names the clipboard-extension surface
  // (mirroring ThreatModelPage's "BROWSER-LEVEL SURFACES → 2. THE
  // CLIPBOARD IS READABLE BY EXTENSIONS" paragraph) and the user-side
  // mitigation. The notice is strictly one-time per browser: once it has
  // been shown we set a localStorage flag and never auto-show it again,
  // regardless of how the user closes it.
  const [showClipboardWarning, setShowClipboardWarning] = useState(false);
  useEffect(() => {
    getSocket();
  }, []);

  // Hostname-validated `.onion` mirror URL derived from the build-time
  // env var. Returns null when unset or when the value's hostname is
  // not a `.onion`, so a misconfigured value never renders a misleading
  // clearnet "copy" affordance.
  const onionMirrorUrl = useMemo<string | null>(() => {
    const raw = (import.meta.env.VITE_VOID_ONION_HOST as string | undefined)?.trim();
    if (!raw) return null;
    const stripped = raw.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    const host = stripped.split("/")[0];
    if (!hostnameIsOnion(host)) return null;
    return `http://${stripped}/`;
  }, []);
  const showOnionOffer = onionMirrorUrl !== null && !isOnionOrigin();
  const [onionCopied, setOnionCopied] = useState(false);
  const [onionCopyFailed, setOnionCopyFailed] = useState(false);

  // Task #1043 — surface the same quiet "requires Tor Browser" hint the
  // footer (`OnionMirrorLink`) shows when the published .onion mirror is
  // detected as unreachable from this clearnet network. Reuses the shared
  // reachability signal (`lib/onionReachability.ts`), which caches its
  // result per session so the footer and this header probe at most once
  // between them. Degrades silently when the probe is inconclusive
  // (offline / timeout / no `fetch`) — only the definite "unreachable"
  // verdict renders the hint, so we never warn someone whose network can
  // actually route .onion.
  const [onionReachability, setOnionReachability] = useState<OnionReachability | null>(
    () => getCachedOnionReachability(),
  );
  useEffect(() => {
    if (!showOnionOffer || !onionMirrorUrl) return;
    if (onionReachability !== null) return;
    const ctrl = new AbortController();
    let cancelled = false;
    detectOnionReachability(onionMirrorUrl, { signal: ctrl.signal })
      .then((r) => {
        if (!cancelled) setOnionReachability(r);
      })
      .catch(() => {
        // detectOnionReachability never rejects, but be defensive.
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [showOnionOffer, onionMirrorUrl, onionReachability]);

  const handleCopyOnion = useCallback(async () => {
    if (!onionMirrorUrl) return;
    uiClick();
    try {
      await navigator.clipboard.writeText(onionMirrorUrl);
      setOnionCopyFailed(false);
      setOnionCopied(true);
      setTimeout(() => setOnionCopied(false), 2000);
    } catch {
      // Clipboard write can fail in restricted contexts (no user
      // gesture, insecure origin, permissions policy). Surface the
      // raw URL inline so the user can select-and-copy manually.
      setOnionCopied(false);
      setOnionCopyFailed(true);
    }
  }, [onionMirrorUrl]);

  // Task #1046 — keep the header hint fresh when connectivity changes.
  // The mount probe above runs once and then reads the shared session
  // cache; without this, a visitor who starts Tor Browser / Orbot after
  // the first probe would stay stuck with the stale "unreachable" hint
  // for the lifetime of the tab, even after the footer (OnionMirrorLink)
  // has already re-probed. Mirror the footer's re-probe machinery
  // (Task #426): invalidate the shared cache + null the state (which re-
  // arms the mount probe above) when the browser comes back online, or
  // when the tab returns to foreground after a long background period.
  //
  // Probe-storm guard: each transition schedules at most one re-probe —
  // the mount effect writes a fresh cache entry before the next event
  // could fire. A quick alt-tab does NOT count as a returning-from-
  // background transition; we require at least
  // ONION_BACKGROUND_REPROBE_THRESHOLD_MS of hidden time first.
  const onionHiddenSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!showOnionOffer || !onionMirrorUrl) return;
    if (typeof window === "undefined") return;

    onionHiddenSinceRef.current =
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? Date.now()
        : null;

    const invalidate = () => {
      clearCachedOnionReachability();
      setOnionReachability(null);
    };

    const onOnline = () => {
      invalidate();
    };

    const onVisibility = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        onionHiddenSinceRef.current = Date.now();
        return;
      }
      const since = onionHiddenSinceRef.current;
      onionHiddenSinceRef.current = null;
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
  }, [showOnionOffer, onionMirrorUrl]);

  const handleJoinPhrasePaste = useCallback(() => {
    let alreadyShown = false;
    try {
      alreadyShown = localStorage.getItem(CLIPBOARD_WARNING_KEY) === "1";
    } catch {
      // localStorage may throw in private-window / disabled-storage
      // contexts. Fall through and show the notice — this is a privacy
      // disclosure, so erring on the side of "show it" is the honest
      // default.
    }
    if (alreadyShown) return;
    // Persist the "shown" flag synchronously, before the toast renders,
    // so even an immediate refresh after this paste cannot cause a second
    // automatic display.
    try {
      localStorage.setItem(CLIPBOARD_WARNING_KEY, "1");
    } catch {
      // Storage failures here are not fatal — the worst case is one
      // additional display on the next paste. Strictly safer for a
      // security-disclosure notice than swallowing the error.
    }
    setShowClipboardWarning(true);
  }, []);

  const dismissClipboardWarning = useCallback(() => {
    setShowClipboardWarning(false);
  }, []);

  const proceedToHost = useCallback(async () => {
    setShowPaywall(false);
    setLoading(true);
    setError("");
    const phrase = generateVoidPhrase();
    try {
      const creds = await deriveRoomCredentials(phrase);
      setLoading(false);
      onJoinRoom(creds.roomId, creds.e2eKey, phrase, true);
    } catch {
      setLoading(false);
      setError("CRYPTO ERROR");
    }
  }, [onJoinRoom]);

  function handleCreateRoom() {
    resumeAudio();
    uiClick();
    setError("");
    // Task #1143: presence of a stored token is NOT proof of a usable
    // payment. An expired (or garbage) token used to silently dead-end the
    // whole flow: proceedToHost → create-room rejected → nothing cleared
    // the token → every later click (and refresh — sessionStorage survives
    // refresh) took the same dead path. Vet it locally first and clear
    // stale state so the paywall reopens cleanly.
    let existing = sessionStorage.getItem("void_token");
    if (existing && tokenLooksExpired(existing)) {
      sessionStorage.removeItem("void_token");
      sessionStorage.removeItem("void_payment_hash");
      existing = null;
    }
    if (existing) {
      // A stored payment hash means the paid flow was interrupted before
      // the host opened the room (refresh or dismissed modal). Resume the
      // modal against that hash so the recovery code — still unacked
      // server-side — is shown before entering the room.
      const pendingHash = sessionStorage.getItem("void_payment_hash");
      if (pendingHash) {
        setResumeHash(pendingHash);
        setShowPaywall(true);
      } else {
        proceedToHost();
      }
    } else {
      setShowPaywall(true);
    }
  }

  function handlePaywallSuccess(_token: string) {
    // Task #345: a fresh Lightning payment just settled for this create. If
    // VOID was loaded over a .onion origin, mark it so the room raises a
    // one-time reminder that paying from a clearnet wallet linked the host's
    // IP to this room at the operator's Lightning node. Gated to onion only —
    // clearnet hosts were never promised network-layer privacy, so the note
    // would just be noise for them.
    if (isOnionOrigin()) markPaidCreateOnion();
    setResumeHash(null);
    proceedToHost();
  }

  const phrase = useMemo(() => words.map((w) => w.trim()).join(" ").trim(), [words]);
  const unknownIndices = useMemo(() => unknownSlotIndices(words), [words]);
  const hasUnknown = unknownIndices.length > 0;
  const recoverUnknownIndices = useMemo(
    () => unknownSlotIndices(recoverWords),
    [recoverWords],
  );
  const recoverHasUnknown = recoverUnknownIndices.length > 0;

  async function handleJoinSubmit() {
    const trimmed = phrase.toLowerCase();
    if (!validateVoidPhrase(trimmed)) {
      setError("INVALID PHRASE — NEED 6 BIP39 WORDS");
      return;
    }
    uiClick();
    setLoading(true);
    setError("");
    try {
      const creds = await deriveRoomCredentials(trimmed);
      setLoading(false);
      onJoinRoom(creds.roomId, creds.e2eKey, trimmed, false);
    } catch {
      setLoading(false);
      setError("CRYPTO ERROR");
    }
  }

  function enterJoinMode() {
    resumeAudio();
    uiClick();
    setJoinMode(true);
    setWords(emptySlots());
    setBulkPhrase("");
    setBulkOverflowHint(false);
    setError("");
    setAutoFocusGrid(true);
  }

  function cancelJoinMode() {
    uiClick();
    setJoinMode(false);
    setWords(emptySlots());
    setBulkPhrase("");
    setBulkOverflowHint(false);
    setError("");
    setAutoFocusGrid(false);
  }

  function openScanner() {
    resumeAudio();
    uiClick();
    setError("");
    setScanOpen(true);
  }

  async function handleScannedPhrase(phrase: string) {
    setScanOpen(false);
    setError("");
    setLoading(true);
    try {
      const creds = await deriveRoomCredentials(phrase);
      setLoading(false);
      onJoinRoom(creds.roomId, creds.e2eKey, phrase, false);
    } catch {
      setLoading(false);
      setError("CRYPTO ERROR");
    }
  }

  function openPhraseScanner() {
    resumeAudio();
    uiClick();
    setError("");
    setPhraseScanOpen(true);
  }

  function handleScannedPhraseFill(phrase: string) {
    setPhraseScanOpen(false);
    // Run the scanned phrase through the same tokenizer the bulk-paste
    // field uses so the distribution path is identical: split on any
    // whitespace/dash, sanitize each token, drop empties. The QR payload
    // from PhraseShareModal is already a space-separated 6-word phrase
    // that parseRoomQr validated, so we'll get exactly six tokens here.
    const tokens = splitPhraseTokens(phrase).slice(0, SLOT_COUNT);
    const next = emptySlots();
    for (let i = 0; i < tokens.length; i++) next[i] = tokens[i];
    setWords(next);
    setBulkPhrase("");
    setBulkOverflowHint(false);
    setError("");
  }

  function enterRecoverMode() {
    resumeAudio();
    uiClick();
    setRecoverMode(true);
    setRecoverWords(emptyRecoverySlots());
    setError("");
    setAutoFocusRecover(true);
  }

  function cancelRecoverMode() {
    uiClick();
    setRecoverMode(false);
    setRecoverWords(emptyRecoverySlots());
    setError("");
    setAutoFocusRecover(false);
  }

  async function handleRecoverSubmit() {
    // Normalize: lowercase, collapse whitespace to single spaces. The grid
    // already restricts inputs to [a-z], but we still defend against stray
    // whitespace on submit. Server enforces the canonical 4-word lowercase
    // form, so we mirror it here for honest UX.
    const normalized = recoverWords
      .map((w) => w.toLowerCase().trim())
      .filter(Boolean)
      .join(" ");
    if (!/^[a-z]+ [a-z]+ [a-z]+ [a-z]+$/.test(normalized)) {
      setError("RECOVERY CODE IS 4 WORDS");
      return;
    }
    uiClick();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/paywall/recover"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: normalized }),
      });
      if (res.status === 404) {
        setLoading(false);
        setError("CODE NOT FOUND OR ALREADY USED");
        return;
      }
      if (res.status === 410) {
        setLoading(false);
        setError("PAID WINDOW HAS EXPIRED");
        return;
      }
      if (!res.ok) {
        setLoading(false);
        setError("RECOVERY FAILED — TRY AGAIN");
        return;
      }
      const data = await res.json();
      if (typeof data?.token !== "string") {
        setLoading(false);
        setError("RECOVERY FAILED — TRY AGAIN");
        return;
      }
      // Same sessionStorage handoff as paid-flow success: the create-room
      // path reads `void_token` and includes it in the socket emit.
      sessionStorage.setItem("void_token", data.token);
      setLoading(false);
      setRecoverMode(false);
      setRecoverWords(emptyRecoverySlots());
      setAutoFocusRecover(false);
      proceedToHost();
    } catch {
      setLoading(false);
      setError("RECOVERY FAILED — TRY AGAIN");
    }
  }

  // Build the apiUrl prefix the same way PaywallModal does (artifact base path
  // aware). Inlined here to avoid a one-liner shared module for two callsites.
  function apiUrl(path: string) {
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
    return base + path;
  }

  return (
    <div
      style={{
        // chromeless mode (embedded inside LandingPage): no min-height,
        // no overflow clipping, no positioned wrapper — the host page
        // owns the page frame. The flex column is still useful so the
        // main-content gap behaviour stays consistent.
        minHeight: chromeless ? undefined : "100svh",
        background: "transparent",
        display: "flex",
        flexDirection: "column",
        fontFamily: "var(--font-mono)",
        color: "var(--fg)",
        overflow: chromeless ? undefined : "hidden",
        position: chromeless ? undefined : "relative",
      }}
    >
      {sessionNotice && (
        <div
          onClick={() => onDismissNotice?.()}
          style={{
            position: "fixed",
            top: "16px",
            left: 0,
            right: 0,
            margin: "0 auto",
            width: "max-content",
            maxWidth: "calc(100vw - 32px)",
            zIndex: 9999,
            background: "var(--surface-dark)",
            border: "1px solid var(--gold)",
            padding: "12px 24px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "3px",
            color: "var(--gold)",
            textTransform: "uppercase",
            cursor: "pointer",
            animation: "void-pulse 1.4s ease-in-out 1",
            whiteSpace: "nowrap",
          }}
        >
          {sessionNotice}
        </div>
      )}
      {showClipboardWarning && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="clipboard-warning"
          style={{
            position: "fixed",
            top: "16px",
            left: 0,
            right: 0,
            margin: "0 auto",
            zIndex: 9999,
            width: "min(560px, calc(100vw - 32px))",
            background: "var(--surface-dark)",
            border: "1px solid var(--gold)",
            padding: "14px 16px",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "1px",
            /* Task #1112: this toast sits on --surface-dark — --fg is 1.09:1
               there (invisible). --fg-on-dark is the body-text-on-dark token. */
            color: "var(--fg-on-dark)",
            lineHeight: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              letterSpacing: "3px",
              color: "var(--gold)",
              textTransform: "uppercase",
            }}
          >
            Clipboard is readable
          </div>
          <div>
            What you just pasted lives on the system clipboard. Any browser
            extension installed with the{" "}
            <span style={{ color: "var(--teal)" }}>clipboardRead</span>{" "}
            permission can read it. To mitigate, copy a neutral character
            over the clipboard, or use a clean browser profile with no
            extensions installed.{" "}
            <a
              href={
                import.meta.env.BASE_URL +
                "threat-model#browser-level-surfaces"
              }
              style={{
                color: "var(--gold)",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              }}
            >
              READ MORE
            </a>
          </div>
          <div
            style={{
              display: "flex",
              gap: "10px",
              justifyContent: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={dismissClipboardWarning}
              style={{
                background: "transparent",
                border: "1px solid var(--gold)",
                color: "var(--gold)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "2px",
                padding: "8px 12px",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {!chromeless && (
        <>
          {/* ── Gold Voyager decorative geometry ── */}
          <div style={{ position: "absolute", top: 0, left: 0, width: "260px", height: "230px", backgroundColor: "#E8A200", backgroundImage: "linear-gradient(rgba(232,162,0,0.84), rgba(232,162,0,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", opacity: 0.82, zIndex: 1, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "-125px", left: "230px", width: "200px", height: "160px", backgroundColor: "#C85A00", backgroundImage: "linear-gradient(rgba(200,90,0,0.84), rgba(200,90,0,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", opacity: 0.485, zIndex: 2, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "220px", right: 0, width: "33px", height: "460px", backgroundColor: "#5A5248", backgroundImage: "linear-gradient(rgba(90,82,72,0.84), rgba(90,82,72,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", opacity: 0.35, zIndex: 1, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, width: "110px", height: "100px", backgroundColor: "#E8A200", backgroundImage: "linear-gradient(rgba(232,162,0,0.84), rgba(232,162,0,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", clipPath: "polygon(0 0, 0 100%, 100% 100%)", opacity: 0.5, zIndex: 2, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "230px", left: 0, width: "14px", height: "220px", backgroundColor: "#F0B800", backgroundImage: "linear-gradient(rgba(240,184,0,0.84), rgba(240,184,0,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", opacity: 0.975, zIndex: 4, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: 0, bottom: 0, left: "112px", width: "3px", background: "#CC2200", opacity: 0.45, zIndex: 5, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "0", right: "18px", width: "90px", height: "200px", backgroundColor: "#D4A040", backgroundImage: "linear-gradient(rgba(212,160,64,0.84), rgba(212,160,64,0.84)), url('/concrete.jpeg')", backgroundSize: "auto, 400px auto", backgroundRepeat: "repeat", opacity: 0.22, zIndex: 1, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: "180px", left: 0, right: 0, height: "2px", background: "#E8A200", opacity: 0.35, zIndex: 1, pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: "210px", right: "8px", width: "16px", height: "16px", background: "#0D9D8B", opacity: 0.9, zIndex: 30, pointerEvents: "none" }} />
          <div style={{ position: "absolute", top: "280px", right: "36px", width: "10px", height: "10px", background: "#CC2200", opacity: 0.7, zIndex: 30, pointerEvents: "none" }} />

          <HamburgerMenu />
        </>
      )}
      {showPaywall && (
        <PaywallModal
          onSuccess={handlePaywallSuccess}
          onClose={() => {
            setShowPaywall(false);
            setResumeHash(null);
          }}
          resumePaymentHash={resumeHash ?? undefined}
        />
      )}
      {scanOpen && (
        <Suspense fallback={null}>
          <QrScannerModal
            onResult={handleScannedPhrase}
            onClose={() => setScanOpen(false)}
          />
        </Suspense>
      )}
      {phraseScanOpen && (
        <Suspense fallback={null}>
          <QrScannerModal
            onResult={handleScannedPhraseFill}
            onClose={() => setPhraseScanOpen(false)}
          />
        </Suspense>
      )}
      {/* Header */}
      {!chromeless && (
      <div style={{
        position: "relative",
        zIndex: 50,
        flexShrink: 0,
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 60px 10px 16px",
        borderBottom: "3px solid #E8A200",
        backgroundColor: "var(--surface-dark)",
        backgroundImage: "linear-gradient(rgba(20,17,13,0.82), rgba(20,17,13,0.82)), url('/concrete.jpeg')",
        backgroundSize: "auto, 400px auto",
        backgroundRepeat: "repeat",
        gap: "12px",
      }}>
        <img src="/void-icon.png" alt="VOID" style={{ height: "32px", width: "32px", flexShrink: 0 }} />
        <div style={{ fontSize: "12px", color: "#C8900A", letterSpacing: "2px" }}>
          P2P VIDEO
        </div>
        {showOnionOffer && (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "8px",
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {/* Task #1027: name the current path explicitly on the home screen
                too. Mirrors the in-call CLEARNET PATH badge (RoomHeaderBar) and
                the footer OnionMirrorLink so "clearnet" is a known choice at the
                very first decision point, not an invisible default. The
                copy-.onion affordance beside it is the one-click switch.
                Non-alarming (--fg-dim, not red). */}
            <span
              data-testid="clearnet-path-indicator"
              title="You reached VOID over the public internet (clearnet), not our .onion address. To put our signaling layer behind a Tor hidden service, open the .onion address in Tor Browser before your next call. It does not hide your IP from the other people on the call."
              style={{
                fontSize: "11px",
                /* Task #1114: was var(--fg-dim) on the dark header
                   (1.39:1, invisible). #A89E90 is the audited header
                   text tone (7.13:1) — still non-alarming/dim. */
                color: "#A89E90",
                letterSpacing: "2px",
                textTransform: "uppercase",
              }}
            >
              CLEARNET PATH
            </span>
            {!onionCopyFailed && (
              <button
                type="button"
                onClick={handleCopyOnion}
                data-testid="onion-copy-offer"
                title={`Copy our .onion mirror address: ${onionMirrorUrl}`}
                style={{
                  fontSize: "11px",
                  color: "var(--teal)",
                  letterSpacing: "2px",
                  border: "1px solid var(--teal)",
                  padding: "4px 8px",
                  fontFamily: "var(--font-mono)",
                  background: "transparent",
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                {onionCopied ? "Copied .onion" : "Copy our .onion"}
              </button>
            )}
            {/* Task #1043: quiet "requires Tor Browser" hint when the mirror is
                detected as unreachable from this clearnet network. Mirrors the
                footer OnionMirrorLink hint. Non-alarming (--fg-dim, not red);
                silent when the probe is inconclusive. */}
            {onionReachability === "unreachable" && (
              <span
                data-testid="onion-copy-hint"
                style={{
                  fontSize: "10px",
                  color: "var(--fg-dim)",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                }}
              >
                requires Tor Browser
              </span>
            )}
            {onionCopyFailed && onionMirrorUrl && (
              <input
                type="text"
                readOnly
                value={onionMirrorUrl}
                data-testid="onion-copy-fallback"
                aria-label="Our .onion mirror address (copy failed — select manually)"
                ref={(el) => {
                  if (el) {
                    el.focus();
                    el.select();
                  }
                }}
                style={{
                  fontSize: "16px",
                  color: "var(--teal)",
                  letterSpacing: "1px",
                  border: "1px solid var(--teal)",
                  padding: "4px 8px",
                  fontFamily: "var(--font-mono)",
                  background: "transparent",
                  maxWidth: "min(60vw, 360px)",
                  minWidth: "180px",
                }}
              />
            )}
          </div>
        )}
        {isOnionOrigin() && (
          <div
            data-testid="tor-onion-indicator"
            title="You loaded VOID over a Tor .onion address. Relay-only is enforced on every call you join from this origin."
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--teal)",
              letterSpacing: "2px",
              border: "1px solid var(--teal)",
              padding: "4px 8px",
              fontFamily: "var(--font-mono)",
            }}
          >
            Connected via Tor onion
          </div>
        )}
      </div>
      )}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          gap: "24px",
          position: "relative",
          zIndex: 20,
        }}
      >
        {/* Task #420: the SOUNDS toggle was removed from this page and
            consolidated into the HamburgerMenu's PREFERENCES section so
            the home screen header stays uncluttered. The in-room toggle
            (RoomHeaderBar) is untouched. */}
        {!joinMode && !recoverMode ? (
          <>
            {!chromeless && (
              <div style={{ textAlign: "center", marginBottom: "16px" }}>
                <div style={{
                  fontFamily: "'Staatliches', system-ui, sans-serif",
                  fontWeight: 400,
                  fontSize: "clamp(40px, 12vw, 72px)",
                  letterSpacing: "clamp(2px, 1.2vw, 6px)",
                  textTransform: "uppercase",
                  color: "var(--fg)",
                  lineHeight: 1,
                  marginBottom: "12px",
                }}>
                  V&nbsp;&nbsp;[]&nbsp;&nbsp;I&nbsp;&nbsp;D
                </div>
                <div style={{ fontSize: "12px", letterSpacing: "3px", color: "var(--fg-dim)", textTransform: "uppercase" }}>
                  Host 1h / 24h &nbsp;·&nbsp; Join free
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "340px" }}>
              {loading ? (
                <div style={{ textAlign: "center", fontSize: "13px", letterSpacing: "3px", color: "var(--fg-dim)" }}>
                  STARTING...
                </div>
              ) : (
                <>
                  <button
                    className="void-btn void-btn--gold active"
                    onClick={handleCreateRoom}
                    style={{ width: "100%", fontSize: "16px", padding: "18px", letterSpacing: "2px" }}
                  >
                    HOST A ROOM
                  </button>
                  <button
                    className="void-btn void-btn--teal active"
                    onClick={enterJoinMode}
                    style={{ width: "100%", fontSize: "16px", padding: "18px", letterSpacing: "2px" }}
                  >
                    JOIN A ROOM
                  </button>
                  <button
                    onClick={enterRecoverMode}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--fg-dim)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "16px",
                      padding: "4px 10px",
                      marginTop: "4px",
                      cursor: "pointer",
                      letterSpacing: "2px",
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                      alignSelf: "center",
                    }}
                  >
                    RECOVER A PAID ROOM
                  </button>
                </>
              )}
            </div>
          </>
        ) : recoverMode ? (
          <>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg-dim)", textTransform: "uppercase", marginBottom: "8px" }}>
                Enter Recovery Code
              </div>
              <div style={{ fontSize: "12px", letterSpacing: "1px", color: "var(--fg-dim)", textTransform: "uppercase", maxWidth: "360px", lineHeight: 1.6 }}>
                4 words you wrote down at payment time. Resumes the same paid window — no new charge.
              </div>
            </div>

            <Bip39PhraseGrid
              words={recoverWords}
              onChange={(next) => {
                setRecoverWords(next);
                setError("");
              }}
              onSubmit={handleRecoverSubmit}
              slotCount={RECOVERY_SLOT_COUNT}
              columns={2}
              autoFocus={autoFocusRecover}
              ariaLabelPrefix="recovery word"
            />

            {recoverHasUnknown && !error && (
              <div style={ERROR_PILL_STYLE}>
                {recoverUnknownIndices.length === 1
                  ? `WORD ${recoverUnknownIndices[0] + 1} NOT IN BIP39 LIST`
                  : `${recoverUnknownIndices.length} WORDS NOT IN BIP39 LIST`}
              </div>
            )}

            {error && (
              <div style={ERROR_PILL_STYLE}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "340px" }}>
              <button
                className="void-btn void-btn--gold active"
                onClick={handleRecoverSubmit}
                disabled={loading}
                style={{ width: "100%", fontSize: "16px", padding: "16px", letterSpacing: "2px" }}
              >
                {loading ? "REDEEMING..." : "RECOVER"}
              </button>
              <button
                className="void-btn"
                onClick={cancelRecoverMode}
                style={{ width: "100%", fontSize: "16px", padding: "14px", letterSpacing: "2px", color: "var(--fg-dim)", borderColor: "var(--fg-dim)" }}
              >
                BACK
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "13px", letterSpacing: "3px", color: "var(--fg-dim)", textTransform: "uppercase", marginBottom: "8px" }}>
                Enter Your Void Phrase
              </div>
              <div style={{ fontSize: "12px", letterSpacing: "1px", color: "var(--fg-dim)", textTransform: "uppercase" }}>
                (Get the 6-word Void phrase from your host)
              </div>
            </div>

            <div style={{ width: "100%", maxWidth: "360px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <button
                type="button"
                className="void-btn"
                onClick={openPhraseScanner}
                data-testid="scan-phrase-qr"
                style={{
                  width: "100%",
                  fontSize: "16px",
                  padding: "12px",
                  letterSpacing: "2px",
                }}
              >
                SCAN PHRASE QR
              </button>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={bulkPhrase}
                placeholder="paste all six words here"
                aria-label="paste the whole phrase"
                onChange={(e) => {
                  const text = e.target.value;
                  const tokens = splitPhraseTokens(text);
                  // Auto-distribute once we have a full phrase typed/dropped
                  // in. For shorter input keep it as raw text so the user
                  // can keep typing or finish pasting.
                  if (tokens.length >= SLOT_COUNT) {
                    const next = tokens.slice(0, SLOT_COUNT);
                    setWords(next);
                    setBulkPhrase("");
                    setBulkOverflowHint(tokens.length > SLOT_COUNT);
                    setError("");
                    // Intentionally do NOT fire `handleJoinPhrasePaste`
                    // here — that toast is the clipboard-readability
                    // warning, which only makes sense for real paste
                    // events (handled by `onPaste` below). A user who
                    // typed/dropped six words into this field hasn't
                    // touched the clipboard.
                    return;
                  }
                  setBulkPhrase(text);
                  if (bulkOverflowHint) setBulkOverflowHint(false);
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text") ?? "";
                  const tokens = splitPhraseTokens(text);
                  if (tokens.length < 2) return;
                  e.preventDefault();
                  const next = tokens.slice(0, SLOT_COUNT);
                  while (next.length < SLOT_COUNT) next.push("");
                  setWords(next);
                  setBulkPhrase("");
                  setBulkOverflowHint(tokens.length > SLOT_COUNT);
                  setError("");
                  handleJoinPhrasePaste();
                }}
                style={{
                  background: "var(--surface)",
                  border: "2px dashed var(--fg-dim)",
                  color: "var(--fg)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "16px",
                  letterSpacing: "1px",
                  padding: "10px 12px",
                  width: "100%",
                  outline: "none",
                  textTransform: "lowercase",
                  boxSizing: "border-box",
                }}
              />
              {bulkOverflowHint && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.5px",
                    color: "var(--fg-dim)",
                    textAlign: "center",
                    padding: "2px 4px 0",
                  }}
                >
                  only the first 6 words were used
                </div>
              )}
            </div>

            <Bip39PhraseGrid
              words={words}
              onChange={(next) => {
                setWords(next);
                setError("");
              }}
              onSubmit={handleJoinSubmit}
              slotCount={SLOT_COUNT}
              autoFocus={autoFocusGrid}
              ariaLabelPrefix="word"
              onPasteDistributed={handleJoinPhrasePaste}
            />

            {hasUnknown && !error && (
              <div style={ERROR_PILL_STYLE}>
                {unknownIndices.length === 1
                  ? `WORD ${unknownIndices[0] + 1} NOT IN BIP39 LIST`
                  : `${unknownIndices.length} WORDS NOT IN BIP39 LIST`}
              </div>
            )}

            {error && (
              <div style={ERROR_PILL_STYLE}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "340px" }}>
              <button
                className="void-btn void-btn--teal active"
                onClick={handleJoinSubmit}
                disabled={loading}
                style={{ width: "100%", fontSize: "16px", padding: "16px", letterSpacing: "2px" }}
              >
                {loading ? "DERIVING..." : "JOIN"}
              </button>
              <button
                className="void-btn"
                onClick={cancelJoinMode}
                style={{ width: "100%", fontSize: "16px", padding: "14px", letterSpacing: "2px", color: "var(--fg-dim)", borderColor: "var(--fg-dim)" }}
              >
                BACK
              </button>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {!chromeless && (
        <div style={{ padding: "12px 16px", borderTop: "3px solid var(--fg-dim)", textAlign: "center", position: "relative", zIndex: 20 }}>
          <div style={{ fontSize: "12px", color: "var(--fg-dim)", letterSpacing: "2px" }}>
            © 2026 VOID {"  "}
            <a
              href={import.meta.env.BASE_URL + "why"}
              style={{
                color: "var(--fg-dim)",
                textDecoration: "none",
                borderBottom: "1px solid var(--fg-dim)",
              }}
            >
              WHY
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
