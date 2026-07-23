// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useEffect, useMemo, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NotFound from "@/pages/not-found";
import WhyPage from "@/pages/WhyPage";
import HowItWorksPage from "@/pages/HowItWorksPage";
import ComparePage from "@/pages/ComparePage";
import ThreatModelPage from "@/pages/ThreatModelPage";
import AuditPage from "@/pages/AuditPage";
import ServerStateProofPage from "@/pages/ServerStateProofPage";
import RuntimeProofPage from "@/pages/RuntimeProofPage";
import BiometricPage from "@/pages/BiometricPage";
import LawEnforcementPage from "@/pages/LawEnforcementPage";
import InvitedPage from "@/pages/InvitedPage";
import HostPage from "@/pages/HostPage";
import TorPage from "@/pages/TorPage";
import DocsIndexPage from "@/pages/docs/DocsIndexPage";
import DocsHowItWorksPage from "@/pages/docs/DocsHowItWorksPage";
import DocsWhyRedirect from "@/pages/docs/DocsWhyRedirect";
import DocsThreatModelPage from "@/pages/docs/DocsThreatModelPage";
import DocsComparePage from "@/pages/docs/DocsComparePage";
import DocsAuditPage from "@/pages/docs/DocsAuditPage";
import DocsBiometricPage from "@/pages/docs/DocsBiometricPage";
import DocsPricingPage from "@/pages/docs/DocsPricingPage";
import DocsLimitsPage from "@/pages/docs/DocsLimitsPage";
import DocsFaqPage from "@/pages/docs/DocsFaqPage";
import LandingPage from "@/pages/LandingPage";
import MediaPage from "@/pages/MediaPage";
import SplashScreen, { shouldShowSplash } from "@/components/SplashScreen";
import RoomPage from "@/pages/RoomPage";
import SmokeRoom from "@/pages/SmokeRoom";
import TestJoinedCallRoom from "@/pages/TestJoinedCallRoom";
import TestShareWarnings from "@/pages/TestShareWarnings";
import TestStartScreen from "@/pages/TestStartScreen";
import PreviewGate from "@/pages/PreviewGate";
import InAppBrowserScreen from "@/components/InAppBrowserScreen";
import { describeUserAgent } from "@/lib/userAgent";
import { parseHashPhrase, deriveRoomCredentials, phraseToHash, generateVoidPhrase } from "@/lib/voidPhrase";
import { rendezvousCreateCode } from "@/lib/rendezvous";
import { getSocket } from "@/lib/socket";
import { uiBleep } from "@/lib/uiSounds";
import { persistHostToken } from "@/lib/hostTokenStorage";
import type { VideoStyle } from "@/lib/mediaPipeline";

const queryClient = new QueryClient();

interface PendingRoom {
  roomId: string;
  e2eKey: CryptoKey;
  voidPhrase: string;
  fromUrl: boolean;
  isHost: boolean;
}

interface ActiveRoom extends PendingRoom {
  audioDeviceId?: string;
  videoStyle?: VideoStyle;
  voiceMode?: number;
}

async function emitHostCreate(
  initial: PendingRoom,
  relayOnly: boolean,
): Promise<{ room: PendingRoom } | { error: string }> {
  const token = sessionStorage.getItem("void_token");
  if (!token) return { error: "PAYMENT REQUIRED" };
  const socket = getSocket();
  let current = initial;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Task #1024: human rooms register under a per-epoch rendezvous handle
    // rather than the durable phrase-derived roomId, so a live operator's
    // wire view rotates instead of pinning to a stable room. The host
    // re-derives the same current-epoch handle on its own join, so no
    // value needs threading from here into RoomPage.
    const wireRoomId = await rendezvousCreateCode(current.roomId);
    const result = await new Promise<{ success?: boolean; error?: string }>((resolve) => {
      socket.emit("create-room", { roomId: wireRoomId, token, relayOnly }, resolve);
    });
    if (result.success) {
      // Task #171 / #191: stash the creation token under a phrase-derived
      // slot in localStorage so a later rejoin can present it back to the
      // server to reclaim host. The original `void_token` key is wiped
      // after extension/handshake; this dedicated slot sticks around even
      // across full browser-tab restarts (so a 24-hour day-tier host who
      // closes their browser doesn't permanently lose host on rejoin).
      // The JWT is encrypted at rest under a key derived from the phrase
      // and lives under a slot whose name is also phrase-derived — see
      // hostTokenStorage.ts for the at-rest privacy properties.
      await persistHostToken(current.voidPhrase, token);
      return { room: current };
    }
    if (result.error === "ROOM_EXISTS" && attempt < 3) {
      const phrase = generateVoidPhrase();
      try {
        const creds = await deriveRoomCredentials(phrase);
        current = { ...current, roomId: creds.roomId, e2eKey: creds.e2eKey, voidPhrase: phrase };
      } catch {
        return { error: "CRYPTO ERROR" };
      }
      continue;
    }
    if (result.error === "RATE_LIMITED") return { error: "TOO MANY REQUESTS" };
    if (result.error === "ROOM_EXISTS") return { error: "COLLISION — TRY AGAIN" };
    // Task #181: distinguish "you already spent this paid token on a
    // previous room" from a generic missing-payment error. Falling
    // through to "PAYMENT REQUIRED" misleads a host who genuinely paid
    // but is creating a second room from a stale tab — the wire-level
    // error code is dedicated, so surface it as plain language instead
    // of pretending the payment didn't happen.
    if (result.error === "TOKEN_ALREADY_USED") {
      // Task #1143: the stored token is spent — clear it (and the resume
      // hash, whose status poll would only hand the same spent token back)
      // so the next HOST ROOM click reopens the paywall instead of
      // dead-ending through this same rejected emit forever.
      sessionStorage.removeItem("void_token");
      sessionStorage.removeItem("void_payment_hash");
      return { error: "ONE PAYMENT, ONE ROOM — PAY AGAIN FOR A NEW ONE" };
    }
    // Task #482: the catch-all used to read "PAYMENT REQUIRED" for every
    // remaining create-room error. That copy is a lie when the server
    // actually returned INVALID_REQUEST / INVALID_ROOM_ID (malformed
    // input) — not a billing problem and the user has no payment they
    // can make to clear it. Branch it on its own plain-language line;
    // everything else still falls through to PAYMENT REQUIRED, which is
    // the correct default for a host who landed in the no-token branch.
    if (result.error === "INVALID_REQUEST" || result.error === "INVALID_ROOM_ID") {
      return { error: "BAD REQUEST — RELOAD AND TRY AGAIN" };
    }
    // Task #1143: any remaining rejection while a token IS present means the
    // server refused it (expired, or signed under a previous ephemeral
    // PAYWALL_SECRET before a restart). Clear the stored state so HOST ROOM
    // recovers to the paywall — leaving it stored made the button dead
    // forever, surviving refresh, because sessionStorage does.
    sessionStorage.removeItem("void_token");
    sessionStorage.removeItem("void_payment_hash");
    return { error: "PAYMENT REQUIRED" };
  }
  return { error: "COLLISION — TRY AGAIN" };
}

function Home() {
  // In-app webview intercept (task #368). Facebook, Instagram, TikTok,
  // LinkedIn, WeChat, etc. embed a stripped WKWebView/WebView that
  // routinely denies getUserMedia. Detect those UAs up front and show
  // the "open in your real browser" screen instead of letting the user
  // hit a generic camera-permission denial three screens deeper.
  // Synchronous — no network or storage cost.
  const uaInfo = useMemo(() => describeUserAgent(), []);

  const hashPhrase = parseHashPhrase(window.location.hash);
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;

  // First-visit splash gate. We skip the splash entirely for any
  // entry path that bypasses the landing page (hash-phrase deep link,
  // installed-PWA launch). For everyone else we consult shouldShowSplash()
  // which checks the per-browser localStorage flag and the
  // prefers-reduced-motion media query. Computed once at mount; the
  // splash component flips this back to false via onDone.
  const [showSplash, setShowSplash] = useState(() => {
    if (hashPhrase) return false;
    if (isStandalone) return false;
    return shouldShowSplash();
  });

  const [pendingRoom, setPendingRoom] = useState<PendingRoom | null>(null);
  const [activeRoom, setActiveRoom] = useState<ActiveRoom | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [deriving, setDeriving] = useState(!!hashPhrase);
  const [creating, setCreating] = useState(false);
  // Item 18: flips true ~8s into a create-room ack that hasn't resolved, so the
  // STARTING screen can offer a "this is taking a while / cancel" affordance for
  // hosts on flaky sockets instead of an indefinite plain-text wait.
  const [createSlow, setCreateSlow] = useState(false);
  const [signalingOffline, setSignalingOffline] = useState(false);
  const derivedRef = useRef(false);
  // Item 18: set true when the host cancels a slow create. Checked after the
  // create-room ack resolves so a late reply doesn't yank the host into a room
  // they already backed out of.
  const createAbortRef = useRef(false);

  // When the api-server SIGTERMs (operator restart, deploy,
  // host reboot) it broadcasts a `server-shutdown` notice during its
  // drain window so clients can flip into "signaling offline, call
  // continues P2P" mode WITHOUT tearing down their already-established
  // peer connections. We deliberately do not call `disconnect()` or
  // touch the room state — WebRTC media flows browser-to-browser and
  // is unaffected by the loss of signaling. The notice is non-blocking
  // and dismissible; socket.io will reconnect on its own once the
  // server is back, at which point we clear the notice.
  useEffect(() => {
    const socket = getSocket();
    const onShutdown = () => setSignalingOffline(true);
    const onReconnect = () => setSignalingOffline(false);
    socket.on("server-shutdown", onShutdown);
    // `socket.io` (the Manager) is optional — production socket.io
    // clients always expose it, but a few unit-test mocks substitute a
    // bare emitter shape. Guard the manager-level reconnect listener
    // so a partial mock doesn't blow up component mount; the
    // shutdown-banner contract still holds for the production socket.
    socket.io?.on?.("reconnect", onReconnect);
    return () => {
      socket.off("server-shutdown", onShutdown);
      socket.io?.off?.("reconnect", onReconnect);
    };
  }, []);

  useEffect(() => {
    if (!hashPhrase || derivedRef.current) return;
    // Guard: the host flow calls `replaceState(phraseToHash(...))` AFTER
    // setting pendingRoom={fromUrl:false,isHost:true}. That replaceState
    // mutates window.location.hash, which makes `hashPhrase` non-null on
    // the next render and would otherwise fire this effect for the first
    // time — clobbering the host's pendingRoom with a joiner-shaped
    // {fromUrl:true, isHost:false}. The host then lands on the join-
    // confirmation overlay, never calls create-room, and the eventual
    // join-room emit hits ROOM_NOT_FOUND → DeadRoomOverlay. If we already
    // have a pendingRoom or activeRoom, the user did not arrive via a
    // cold deep-link; skip the derivation.
    if (pendingRoom || activeRoom) {
      derivedRef.current = true;
      return;
    }
    derivedRef.current = true;
    deriveRoomCredentials(hashPhrase).then((creds) => {
      setDeriving(false);
      setPendingRoom({
        roomId: creds.roomId,
        e2eKey: creds.e2eKey,
        voidPhrase: hashPhrase,
        fromUrl: true,
        isHost: false,
      });
    }).catch(() => {
      setDeriving(false);
    });
  }, [hashPhrase, pendingRoom, activeRoom]);

  // Item 18: arm the "taking a while" affordance ~8s after a create starts.
  // Resets whenever we leave the creating state so the next create starts clean.
  useEffect(() => {
    if (!creating) {
      setCreateSlow(false);
      return;
    }
    const id = setTimeout(() => setCreateSlow(true), 8000);
    return () => clearTimeout(id);
  }, [creating]);

  // Item 18: abandon a slow/flaky create. Returns the host to a clean landing
  // state; createAbortRef makes a late create-room ack a no-op (see onEnter).
  function handleCancelCreate() {
    createAbortRef.current = true;
    setCreating(false);
    setPendingRoom(null);
    window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
    setSessionNotice("Room creation cancelled.");
  }

  // Item 7: while PBKDF2 derives the room key (seconds on low-end Android),
  // show a labelled placeholder instead of a blank screen so a cold deep-link
  // open does not look broken.
  if (deriving) {
    return (
      <div style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "14px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg-dim)",
        fontSize: "13px",
        letterSpacing: "3px",
      }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            background: "var(--teal)",
            animation: "void-blink 1s step-start infinite",
          }}
        />
        <span role="status">DERIVING ROOM KEY…</span>
      </div>
    );
  }

  // First-visit splash. Runs ONCE per browser; subsequent visits skip
  // it entirely via the localStorage flag SplashScreen writes on
  // completion. Renders above everything else (no offline banner, no
  // route content) so the cold-start impression is uncluttered.
  if (showSplash) {
    return <SplashScreen onDone={() => setShowSplash(false)} />;
  }

  // Hard intercept: if we're inside an in-app webview, nothing past
  // this point is reachable until the user opens VOID in a real
  // browser. This must run before PreviewGate / LandingPage so we don't
  // provoke a camera prompt that the webview will silently deny.
  if (uaInfo.inAppBrowser) {
    return (
      <InAppBrowserScreen
        detected={uaInfo.inAppBrowser}
        isIOS={uaInfo.isIOS}
        isAndroid={uaInfo.isAndroid}
      />
    );
  }

  // Non-blocking notice rendered as an overlay when the
  // signaling server has flagged a planned shutdown. Sits above any
  // page-level UI (LandingPage, PreviewGate, RoomPage) so the user
  // sees it whether they are mid-call or on a static screen, and
  // dismissible because the call itself continues over P2P.
  const offlineBanner = signalingOffline ? (
    <div
      role="status"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.92)",
        color: "var(--fg, #ddd)",
        borderBottom: "1px solid var(--fg-dim, #555)",
        padding: "10px 16px",
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        letterSpacing: "2px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "12px",
      }}
    >
      <span>SIGNALING SERVER OFFLINE — YOUR CALL CONTINUES P2P.</span>
      <button
        type="button"
        onClick={() => setSignalingOffline(false)}
        style={{
          background: "transparent",
          color: "inherit",
          border: "1px solid var(--fg-dim, #555)",
          padding: "4px 10px",
          fontFamily: "inherit",
          fontSize: "11px",
          letterSpacing: "2px",
          cursor: "pointer",
        }}
      >
        DISMISS
      </button>
    </div>
  ) : null;

  if (activeRoom) {
    return (
      <>
      {offlineBanner}
      <RoomPage
        roomId={activeRoom.roomId}
        e2eKey={activeRoom.e2eKey}
        voidPhrase={activeRoom.voidPhrase}
        fromUrl={activeRoom.fromUrl}
        audioDeviceId={activeRoom.audioDeviceId}
        initialVideoStyle={activeRoom.videoStyle}
        initialVoiceMode={activeRoom.voiceMode}
        onLeave={(reason?: string) => {
          // Security (M-03): use replaceState, never pushState, to clear the
          // phrase fragment from the URL on leave. pushState would leave the
          // phrase-bearing URL one entry back in browser history, where a
          // shoulder-surfer or history-extracting malware could recover it,
          // and the browser back button would return the user to the live
          // phrase URL. This handler is the single convergence point for
          // every leave path (leave button, BURN, kick, timer expiry,
          // network-failure abandon, in-app route changes), so fixing it
          // here covers all of them.
          window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
          if (reason) setSessionNotice(reason);
          setActiveRoom(null);
        }}
      />
      </>
    );
  }

  if (creating) {
    return (
      <>
      {offlineBanner}
      <div style={{
        minHeight: "100svh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        fontFamily: "var(--font-mono)",
        color: "var(--fg-dim)",
        fontSize: "13px",
        letterSpacing: "3px",
        padding: "24px",
        textAlign: "center",
      }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "8px",
            height: "8px",
            background: "var(--teal)",
            animation: "void-blink 1s step-start infinite",
          }}
        />
        <span role="status">STARTING…</span>
        {createSlow && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            maxWidth: "320px",
          }}>
            <span style={{ fontSize: "11px", letterSpacing: "1px", lineHeight: 1.6 }}>
              Still working — this can be slow on a weak connection.
            </span>
            <button
              type="button"
              onClick={handleCancelCreate}
              style={{
                background: "none",
                border: "2px solid var(--fg-dim)",
                color: "var(--fg-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                letterSpacing: "2px",
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              CANCEL
            </button>
          </div>
        )}
      </div>
      </>
    );
  }

  if (pendingRoom) {
    const current = pendingRoom;
    return (
      <>
      {offlineBanner}
      <PreviewGate
        voidPhrase={current.voidPhrase}
        showRelayToggle={current.isHost}
        roomId={current.roomId}
        onEnter={async (opts) => {
          if (current.isHost) {
            createAbortRef.current = false;
            setCreating(true);
            setPendingRoom(null);
            const res = await emitHostCreate(current, opts.relayOnly);
            // Item 18: the host cancelled while we were waiting on the ack —
            // drop this (now-stale) result instead of yanking them into a room.
            if (createAbortRef.current) return;
            if ("error" in res) {
              setCreating(false);
              window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
              setSessionNotice(res.error);
              return;
            }
            if (res.room.voidPhrase !== current.voidPhrase) {
              window.history.replaceState(null, "", phraseToHash(res.room.voidPhrase));
            }
            uiBleep();
            setActiveRoom({
              ...res.room,
              audioDeviceId: opts.audioDeviceId,
              videoStyle: opts.videoStyle,
              voiceMode: opts.voiceMode,
            });
            setCreating(false);
          } else {
            setActiveRoom({
              ...current,
              audioDeviceId: opts.audioDeviceId,
              videoStyle: opts.videoStyle,
              voiceMode: opts.voiceMode,
            });
            setPendingRoom(null);
          }
        }}
        onCancel={() => {
          window.history.replaceState(null, "", import.meta.env.BASE_URL || "/");
          setPendingRoom(null);
        }}
      />
      </>
    );
  }

  return (
    <>
    {offlineBanner}
    <LandingPage
      sessionNotice={sessionNotice}
      onDismissNotice={() => setSessionNotice(null)}
      onJoinRoom={(roomId, e2eKey, voidPhrase, isHost) => {
        // Security (M-03): replaceState, not pushState. Using pushState here
        // would leave the LandingPage URL one entry back and the phrase URL
        // as the current entry. If the user then pressed the browser back
        // button while in the room (URL pops back to "/" but the React
        // activeRoom state stays alive) and subsequently triggered a leave,
        // the leave handler's replaceState would overwrite "/" while the
        // phrase URL stayed alive in forward history. replaceState here
        // prevents that history entry from ever existing.
        window.history.replaceState(null, "", phraseToHash(voidPhrase));
        setPendingRoom({
          roomId,
          e2eKey,
          voidPhrase,
          fromUrl: false,
          isHost,
        });
      }}
    />
    </>
  );
}

// Wouter does a soft navigation that swaps the rendered route without
// touching scroll position, so navigating between long pages can land the
// user mid-page. Reset to the top whenever the path changes. Wouter's
// useLocation tracks pathname only, so this does not fire on the hash-only
// replaceState mutations VOID uses for phrase-bearing room URLs.
function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/why" component={WhyPage} />
      <Route path="/media" component={MediaPage} />
      <Route path="/how-it-works" component={HowItWorksPage} />
      <Route path="/compare" component={ComparePage} />
      <Route path="/threat-model" component={ThreatModelPage} />
      <Route path="/audit" component={AuditPage} />
      <Route path="/proof/server-state" component={ServerStateProofPage} />
      <Route path="/proof/runtime" component={RuntimeProofPage} />
      <Route path="/pricing" component={DocsPricingPage} />
      <Route path="/biometric-masking" component={BiometricPage} />
      {/* Task #577: short-form /limits page was removed. The long-form
          DocsLimitsPage is the only LIMITS page now, reachable at both
          /limits (kept for inbound links + OG card + hamburger entry)
          and the canonical /docs/limits. */}
      <Route path="/limits" component={DocsLimitsPage} />
      <Route path="/law-enforcement" component={LawEnforcementPage} />
      <Route path="/invited" component={InvitedPage} />
      <Route path="/host" component={HostPage} />
      <Route path="/tor" component={TorPage} />
      <Route path="/docs" component={DocsIndexPage} />
      <Route path="/docs/how-it-works" component={DocsHowItWorksPage} />
      <Route path="/docs/why" component={DocsWhyRedirect} />
      <Route path="/docs/threat-model" component={DocsThreatModelPage} />
      <Route path="/docs/compare" component={DocsComparePage} />
      <Route path="/docs/audit" component={DocsAuditPage} />
      <Route path="/docs/biometric" component={DocsBiometricPage} />
      <Route path="/docs/pricing" component={DocsPricingPage} />
      <Route path="/docs/limits" component={DocsLimitsPage} />
      <Route path="/docs/faq" component={DocsFaqPage} />
      {/* Task #519: smoke harness route that mounts the real RoomPage in
          snapshot mode with forced secure-channel failures + visible
          wait-hint, so the layout pass in
          `scripts/smoke-room-header-layout.mjs` can drive the live dev
          server at each viewport against the real components. Dev-only;
          never shipped to production. */}
      {import.meta.env.DEV && (
        <Route path="/__smoke/room" component={SmokeRoom} />
      )}
      {/* Task #587: DEV-only test route that mounts RoomPage in a
          joined-call state with mocked media tracks and one mocked
          peer. Drives the Playwright real-viewport layout gate
          (`tests/playwright/control-bar-layout.spec.ts`) without the
          paywall → JWT mint → create-room → camera permission
          sequence. Gated behind `import.meta.env.DEV` so the route is
          entirely absent from production builds. */}
      {import.meta.env.DEV && (
        <Route path="/__test/joined-call" component={TestJoinedCallRoom} />
      )}
      {/* Task #738: DEV-only test route that mounts the real
          PhraseShareModal / RoomShareSheet (one at a time, selected by
          `?which=phrase|room`) so the Playwright real-browser
          visibility gate (`tests/playwright/share-warnings-visible.spec.ts`)
          can prove the link-mangling and fragment-leak cautions are
          genuinely on-screen, closing the gap left by the jsdom
          component tests which have no real layout. Gated behind
          `import.meta.env.DEV` so it never ships to production. */}
      {import.meta.env.DEV && (
        <Route path="/__test/share-warnings" component={TestShareWarnings} />
      )}
      {/* Task #1042: DEV-only test route that mounts the real StartScreen
          in its FULL-FRAME (non-chromeless) form so the Playwright
          real-browser gate
          (`tests/playwright/clearnet-path-indicator.spec.ts`) can prove the
          Task #1027 home-screen CLEARNET PATH badge + one-click .onion
          switch render with genuine layout — and that the badge is
          suppressed (positive Tor badge shown instead) on the .onion
          origin. The landing page embeds StartScreen with `chromeless`,
          which hides the header, so this is the only place those
          affordances render. Gated behind `import.meta.env.DEV` so it never
          ships to production. */}
      {import.meta.env.DEV && (
        <Route path="/__test/start-screen" component={TestStartScreen} />
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <ScrollToTop />
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
