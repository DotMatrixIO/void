# Onion fail-open audit (Task #385)

**Date:** 2026-05-20
**Audit scope:** Every outbound network request a `void-client` page can
initiate when the page is loaded over a `.onion` origin. The question
this audit answers is: *does any request, on any code path the onion
page exercises, resolve a hostname other than the onion host itself?*
If the answer is "yes" anywhere, the Tor circuit fails open and the
privacy posture we advertise on the threat-model page is silently
false.

This is the audit deliverable promised by the "Done looks like" line of
the task. The regression test that pins the result lives at
`artifacts/void-client/src/__tests__/onion-no-clearnet-egress.test.ts`.
The threat-model page (`ThreatModelPage.tsx`, "TOR AND THE MEDIA PATH"
section) carries the verbatim hostname list from this file.

## Methodology

The task's preferred evidence is a HAR capture of a real
two-peer onion call. That artefact will be attached to this doc as
`evidence/onion-call-2026-05-20.har` once it can be recorded against a
deployed `.onion` mirror — the audit environment has no production
onion deployment to point Playwright at, so this revision of the
audit is built from an **exhaustive code-read cross-check** of every
`fetch(`, `new WebSocket(`, `io(`, `new Image(`, `new Audio(`,
`navigator.sendBeacon(`, `XMLHttpRequest`, `@font-face`, `url(`,
`<img>`, `<link>`, and `<script>` site in `artifacts/void-client/src`,
`artifacts/void-client/public`, and `artifacts/void-client/index.html`,
plus every transitively reachable CSS `url()` from `src/index.css`,
plus the service-worker `PRECACHE` list. The cross-check is enumerated
in the table below; the regression test mocks the global `fetch` under
a simulated onion origin and asserts the union of attempted hostnames
is a subset of `{ <onion-host>, <relative paths> }`.

**Why a code-read is sufficient as the *interim* primary method:** the
CSP for the API server (see `artifacts/api-server/src/app.ts` and
`__tests__/onion-location.test.ts`) is `'self'`-only for every fetch
directive — no `https:` scheme keyword, no third-party hostname, no
`unsafe-eval`, no `unsafe-inline` on `scriptSrc`. A bundler-injected
clearnet URL or a CSS-loaded font from a third party would be blocked
at the browser by CSP before it ever reached the network. CSP is the
belt; this audit is the suspenders. The HAR capture remains the
gold-standard evidence and is tracked as the follow-up "Attach a real
onion HAR capture as primary audit evidence" (proposed).

## Inventory — outbound request kinds an onion-origin page initiates

| # | Request kind | Site | Target (onion-origin) | Classification |
|---|---|---|---|---|
| 1 | Signaling WebSocket | `lib/socket.ts` → `io({ path: "/api/socket.io" })` | Same-origin (no `url` argument given) — Socket.IO defaults to `window.location.origin`, which is the `.onion` host | **onion-resolvable** |
| 2 | Lightning paywall: create invoice | `components/PaywallModal.tsx` → `fetch(apiUrl("/api/paywall/invoice"))` | Same-origin (`apiUrl` = `BASE_URL` + path) | **onion-resolvable** |
| 3 | Lightning paywall: poll status | `components/PaywallModal.tsx` → `fetch(apiUrl("/api/paywall/status/:hash"))` | Same-origin | **onion-resolvable** |
| 4 | Lightning paywall: dev bypass (dev-only) | `components/PaywallModal.tsx` → `fetch(apiUrl("/api/paywall/dev-pay/:hash"))` | Same-origin; route is 404 in production | **onion-resolvable** |
| 5 | Lightning paywall: recovery code | `pages/StartScreen.tsx` → `fetch(apiUrl("/api/paywall/recover"))` | Same-origin | **onion-resolvable** |
| 6 | ICE servers | `pages/RoomPage.tsx` → `fetch("/api/ice-servers")` | Same-origin (root-relative) | **onion-resolvable** |
| 7 | Room state (PreviewGate onion-joiner gate) | `pages/PreviewGate.tsx` → `fetch(\`${base}/api/room-state/:id\`)` | Same-origin | **onion-resolvable** |
| 8 | Room state (proof page) | `pages/ServerStateProofPage.tsx` → `fetch(apiUrl("/api/room-state/:id"))` | Same-origin | **onion-resolvable** |
| 9 | Demo-video HEAD probe | `components/DemoVideoEmbed.tsx` → `fetch(BASE_URL + src, { method: "HEAD" })` | Same-origin; `src` is a relative path (`biometric-demo.mp4`, `coordination-demo.mp4`) served from `/public` | **onion-resolvable** |
| 10 | Service-worker precache + runtime cache | `public/sw.js` — `cache.addAll(["./"])` + same-origin asset cache; explicitly skips `/api/` and `socket.io` | Same-origin | **onion-resolvable** |
| 11 | Service-worker registration | `src/main.tsx` → `navigator.serviceWorker.register(\`${BASE_URL}sw.js\`)` | Same-origin | **onion-resolvable** |
| 12 | Page fonts | `src/index.css` `@font-face` → `url('/fonts/jetbrains-mono-latin.woff2')`, `url('/fonts/staatliches-latin.woff2')` | Same-origin (served from `public/fonts/`) | **onion-resolvable** |
| 13 | Page background image | `src/index.css` + per-page inline style — `url('/concrete.jpeg')` | Same-origin | **onion-resolvable** |
| 14 | Page icons / favicons / splash | `index.html` `<link rel="icon" …>`, `<link rel="apple-touch-icon" …>`, `<link rel="apple-touch-startup-image" …>` | Same-origin (all `/`-prefixed) | **onion-resolvable** |
| 15 | Web app manifest | `index.html` `<link rel="manifest" href="manifest.json">` | Same-origin | **onion-resolvable** |
| 16 | OG / Twitter card image (per-route HTML emits `<meta property="og:image" content="/og/...jpg">`) | Crawlers fetch this from the origin where the meta tag lives. Not initiated by the in-browser session. | Same-origin when the URL itself is fetched | **onion-resolvable** (and not a per-session request) |
| 17 | TURN URL the server hands out via `/api/ice-servers` | `artifacts/api-server/src/routes/ice-servers.ts` — value of `TURN_URL` env var | **Operator-supplied.** Acceptable only if the operator points it at a TURN service reachable from the Tor network OR accepts the documented degradation (host-candidates-only on the onion path). See "TURN/STUN deployment guidance" below. The client cannot rewrite this; the threat-model page already flags it ("the TURN server sees your IP"). | **acceptable (operator-controlled, documented degradation)** |
| 18 | STUN URL the server hands out via `/api/ice-servers` | Same file — value of `STUN_URL` env var; default is **empty list** (fail-closed) when unset. No third-party fallback (no Google STUN). | **acceptable (operator-controlled, fail-closed default)** |
| 19 | ICE candidate gathering | When the room is `relayOnly` OR the page was loaded over `.onion`, `initialIceTransportPolicy()` returns `"relay"` and the browser only gathers relay candidates. On the onion path this is **enforced locally regardless of the room setting** (`lib/origin.ts`, pinned by `onion-defaults.test.tsx`). | **onion-resolvable / acceptable** — ICE is outside CSP, but relay-only pinning forecloses host/srflx leaks. |
| 20 | Health-check beacon | None. There is no `navigator.sendBeacon`, no analytics, no telemetry, no error-reporting fetch in the client. `rg -n "sendBeacon\|analytics\|telemetry\|sentry\|datadog\|posthog" src/` returns no matches. | **acceptable (does not exist)** |
| 21 | Live BTC→USD price ("≈ $0.80" caption) | `src/hooks/useSatsToUsd.ts` → `fetch("https://api.coingecko.com/...")`. Used by `LandingPage.tsx` and `PaywallModal.tsx`. | **LEAK — fix required.** `api.coingecko.com` is a third-party clearnet hostname. Both `LandingPage` and `PaywallModal` are reachable on the onion path. | **FIXED in this PR** (see below) |
| 22 | External documentation links (`docs.zeusln.com`, `phoenix.acinq.co`, `github.com/...`) | `pages/ThreatModelPage.tsx` — `<a href="https://...">…</a>` to wallet documentation in the "Tor-routed wallet" section | Plain `<a>` links — no auto-fetch. They only resolve clearnet hostnames *if the user clicks*, and at that point the user has explicitly opted into clearnet navigation away from the onion page. Documented in the page copy. | **acceptable (user-initiated navigation)** |
| 23 | Inline SVG / inline JS in `index.html` | The SRI failure diagnostic in `index.html` is inline JS that runs in-page and makes no network request of its own. SVGs in `public/` are static assets fetched same-origin. | n/a | **acceptable** |

## Leaks found and fixes landed in this PR

### Leak #21 — `api.coingecko.com` (the only one)

`useSatsToUsd` fetches a live BTC→USD price from CoinGecko so the
landing page and paywall modal can show a soft "≈ $X per hour" hint
beside the sat amount. On the clearnet site this is a small nicety;
on the onion site it is a **silent failure of the relay-only privacy
posture** — CoinGecko learns the user's exit-node IP and the timing
of every visit to the onion site.

(Note — Task #549: the paywall modal's per-tier USD figures now come
from the server's `/api/paywall/tiers` endpoint rather than this
hook, but the hook is still imported by the landing page so the gate
described below remains load-bearing.)

**Fix:** `useSatsToUsd` now short-circuits to `null` when
`isOnionOrigin()` returns true. The hook already returns `null` while
loading or on fetch failure, and every call site
(`LandingPage.tsx`, `PaywallModal.tsx`) renders nothing when the value
is `null`, so the UI degrades gracefully — the rest of the page is
unaffected, and the "≈ $X" hint is simply omitted on the onion mirror.

Implementation: `artifacts/void-client/src/hooks/useSatsToUsd.ts`.
Pinned by `artifacts/void-client/src/__tests__/onion-no-clearnet-egress.test.ts`,
which:
- asserts the hook does **not** call `fetch` when `window.location.hostname`
  ends in `.onion`,
- asserts it **does** call `fetch` on a clearnet origin (control), and
- exercises every other fetch site enumerated above under a simulated
  onion origin and asserts every observed URL is either same-origin to
  the onion host or a relative path.

After this fix, the audit's "leak — fix required" column is empty.

## TURN/STUN deployment guidance for onion operators

The TURN URL the server hands out at `/api/ice-servers` (rows #17 /
#18) is operator-supplied and therefore not something the client can
rewrite. Operators publishing a `.onion` mirror have two acceptable
choices:

1. **Onion-reachable TURN (preferred).** Run `coturn` (or another
   TURN implementation) on a host reachable from the Tor network and
   point `TURN_URL` at it. The threat-model page's existing copy ("the
   TURN server sees your IP") still applies, but the TURN server is
   the only third party in the path, not the TURN server *plus* the
   exit node.

2. **Documented degradation: host-candidates-only.** Leave `TURN_URL`
   unset on the onion-facing deployment. `GET /api/ice-servers`
   returns `{ iceServers: [] }`, and the relay-only-pinned onion
   peer-connection negotiates with host candidates only — most
   cross-NAT calls will fail to connect. This is acceptable for a
   privacy-maximalist deployment (the operator is telling onion users
   "calls may not connect if your NAT is unfriendly; that is the price
   of zero third-party reachability"). The threat-model page already
   names this trade in "TOR AND THE MEDIA PATH".

`docs/onion-mirror-runbook.md` is the operator-facing surface for
these options; the runbook is the source of truth for the deployment
recipe and should reference this audit by name.

## Verbatim hostname list (copied into ThreatModelPage)

The onion-origin client contacts exactly one hostname during a
two-peer call: the `.onion` host the page is loaded from. All paths
listed in the inventory above resolve to that host.

```
<your-deployment>.onion         (same-origin — every fetch above)
<operator-supplied TURN URL>    (if configured — see "TURN/STUN
                                 deployment guidance"; the threat-
                                 model page already documents that
                                 the TURN server sees the user's IP)
```

There are **zero** third-party hostnames in the onion-origin client's
outbound request set after the fix in this PR.

## Cross-references

- Regression test: `artifacts/void-client/src/__tests__/onion-no-clearnet-egress.test.ts`
- Onion detection: `artifacts/void-client/src/lib/origin.ts`
- ICE policy pinning: `artifacts/void-client/src/lib/origin.ts` (`initialIceTransportPolicy`)
- CSP that backstops this audit: `artifacts/api-server/src/app.ts` + `__tests__/onion-location.test.ts`
- ICE-servers fail-closed default: `artifacts/api-server/src/routes/ice-servers.ts`
- Operator runbook: `docs/onion-mirror-runbook.md`
- Threat model "TOR AND THE MEDIA PATH" section: `artifacts/void-client/src/pages/ThreatModelPage.tsx`
