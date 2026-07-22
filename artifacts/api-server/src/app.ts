// SPDX-License-Identifier: AGPL-3.0-or-later
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import router from "./routes";
import { httpAccessLogger } from "./lib/accessLog";
import { isValidOnionHostname } from "./lib/torPosture";
import { resolveAllowedOrigins } from "./lib/corsOrigins";

const app: Express = express();

// Trust the front-facing reverse proxy so `req.ip` returns the actual client
// IP — the rightmost entry in `X-Forwarded-For` (the one the trusted proxy
// itself appended) — rather than a leftmost value an untrusted client could
// have spoofed by prepending their own header. This is required for the
// per-IP rate limiters on /paywall/recover and /ice-servers to be effective.
//
// Defaults to 1 hop, which matches both Replit's edge proxy and the documented
// nginx self-host setup in README-selfhost.md (single proxy in front). Operators
// running deeper proxy chains (e.g. CDN → LB → app) can override via
// TRUST_PROXY_HOPS, which is interpreted by Express as the number of trusted
// hops from the right of the X-Forwarded-For chain.
const trustProxyHops = Number(process.env["TRUST_PROXY_HOPS"] ?? "1");
app.set("trust proxy", Number.isFinite(trustProxyHops) && trustProxyHops >= 0 ? trustProxyHops : 1);

const allowedOrigins = resolveAllowedOrigins();
const isSelfHosted = process.env["SERVE_STATIC"] === "1";

// HTTP security headers. Allow-lists below are sized to the actual
// void-client API surface (audited in task #256). See
// docs/security-audit-public-2026-04.md §R-9.11a for rationale.
//
// CORP is keyed off SERVE_STATIC: same-origin under single-origin
// self-host; same-site when the client is served from a different
// origin. Both block cross-site embedders.
const corpPolicy: "same-origin" | "same-site" = isSelfHosted ? "same-origin" : "same-site";

// connect-src omits TURN/STUN intentionally — the ICE agent is not
// governed by CSP. COEP declined: void-client uses no SAB / isolated
// APIs, so COEP would only impose a CORP burden on future cross-origin
// subresources for no security gain.
//
// Task #384 — CSP parity audit for the .onion mirror.
// Every directive below resolves over the .onion origin without any
// clearnet hostname being named or implied: every fetch source is
// `'self'`, a scheme keyword (`data:`, `blob:`, `mediastream:`,
// `wss:`, `ws:`), a no-op (`'none'`, `'unsafe-inline'`), the
// host-free `'wasm-unsafe-eval'` keyword, or a content hash
// (`'sha256-<base64>'` — base64 has no dots, so no clearnet TLD can
// appear). There is no third-party host string anywhere in this
// policy. The `report-to` group resolves to the same-origin endpoint
// `/api/csp-report`, so violation reports posted from the onion
// origin go back to the onion origin — never escape to clearnet.
// __tests__/onion-location.test.ts pins this by loading the CSP
// from a synthetic onion Host and asserting it contains no `.com`
// / `.net` / `.io` / `.org` substring; if a future directive
// adds a clearnet hostname, that test fails before review.

// The built client HTML carries an inline <script> (the SRI-failure
// diagnostic installed by task #249 — see artifacts/void-client/index.html).
// script-src deliberately has no 'unsafe-inline', so each inline script
// must be allow-listed by its sha256 hash or the browser blocks it (the
// exact failure observed in production self-host deployments). Hashes
// are computed once at startup from the HTML files actually on disk in
// CLIENT_DIST — index.html plus the per-route OG pages emitted by
// gen-og-pages.mjs — so a rebuild that changes the inline script is
// picked up automatically on the next server start with no code change
// here. Empty when SERVE_STATIC != 1 (split-origin installs: whatever
// serves the client must emit its own CSP) or when the client build is
// absent.
function collectInlineScriptHashes(): string[] {
  if (process.env["SERVE_STATIC"] !== "1") return [];
  const dist = path.resolve(process.env["CLIENT_DIST"] || "./client");
  let htmlFiles: string[];
  try {
    htmlFiles = readdirSync(dist).filter((f) => f.endsWith(".html"));
  } catch {
    return [];
  }
  const hashes = new Set<string>();
  for (const file of htmlFiles) {
    let html: string;
    try {
      html = readFileSync(path.join(dist, file), "utf8");
    } catch {
      continue;
    }
    // Inline scripts only: any <script> tag without a src attribute.
    // The CSP hash is computed over the exact bytes between the tags,
    // untrimmed, per the CSP3 spec.
    for (const m of html.matchAll(
      /<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      const body = m[1];
      if (!body) continue;
      hashes.add(
        `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
      );
    }
  }
  return [...hashes].sort();
}
const inlineScriptHashes = collectInlineScriptHashes();

// Read + validate ONION_HOSTNAME up here (before the helmet CSP is built)
// because it feeds two consumers: the connect-src allow-list below and the
// Onion-Location middleware further down. Single source of truth for the
// server-side .onion host rule, shared with the /api/proof/posture
// attestation (lib/torPosture.ts) so the two can never disagree about
// whether ingress is onion-fronted.
const ONION_HOSTNAME = (process.env["ONION_HOSTNAME"] ?? "").trim();
const ONION_HOST_VALID =
  ONION_HOSTNAME.length > 0 && isValidOnionHostname(ONION_HOSTNAME);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval' is required for room-key derivation: the
        // void-client derives roomId + AES key from the Void Phrase via
        // argon2id compiled to WebAssembly (hash-wasm, lib/wire-core).
        // Without it, browsers refuse WebAssembly compilation under a
        // script-src that lacks 'unsafe-eval'/'wasm-unsafe-eval', and
        // hosting/joining a room fails with DERIVATION_FAILED on every
        // single-origin (SERVE_STATIC=1) install. It permits ONLY WASM
        // compilation — JS eval()/Function() stay blocked.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", ...inlineScriptHashes],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Audit L-05 (task #464): dropped the bare `ws:` scheme. Production
        // and Replit dev both run over HTTPS, so socket.io upgrades to wss:.
        // Permitting plaintext ws: meant a successful HTTP downgrade or a
        // hostile injected script could connect to a plaintext WebSocket
        // anywhere on the network. If a future deployment ever needs to
        // serve plaintext-HTTP dev, gate the addition of "ws:" on
        // NODE_ENV !== "production" here instead of restoring it globally.
        // Own onion mirror (when configured): the void-client footer runs a
        // best-effort HEAD probe against http://<onion>/ from the clearnet
        // origin (lib/onionReachability.ts) to decide whether to show the
        // "requires Tor Browser" hint next to the ALSO ON .ONION link.
        // Without this entry the probe is CSP-blocked on every page view,
        // which (a) forces the hint into a permanent false "unreachable"
        // even on Tor-aware browsers and (b) spams the csp_report log sink.
        // http:// is correct — onion services terminate inside Tor, no TLS
        // port exists (same reasoning as the Onion-Location header below).
        connectSrc: ONION_HOST_VALID
          ? ["'self'", "wss:", `http://${ONION_HOSTNAME}`]
          : ["'self'", "wss:"],
        workerSrc: ["'self'", "blob:"],
        mediaSrc: ["'self'", "blob:", "mediastream:"],
        imgSrc: ["'self'", "data:", "blob:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        // Audit L-04 (task #464): tightened from 'self' to 'none'. No client
        // code emits a runtime <base> tag (verified via grep across
        // artifacts/void-client). With 'self', an injected <base href>
        // pointing at any path under the origin could redirect every
        // relative URL on the page; 'none' eliminates that surface
        // entirely.
        baseUri: ["'none'"],
        formAction: ["'self'"],
        // Endpoint owned by task #252; directive named here so reports
        // start flowing automatically once that endpoint lands. We use
        // the well-known group name `default` so Permissions-Policy
        // violations (which the spec routes to the `default` endpoint
        // group of the Reporting API, not via a per-policy directive)
        // are sent through the same sink as CSP violations.
        reportTo: ["default"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: "same-origin" },
    crossOriginResourcePolicy: { policy: corpPolicy },
    frameguard: { action: "deny" },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "no-referrer" },
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
  }),
);

// Permissions-Policy: deny by default; allow only the features the
// void-client actually invokes (camera/mic, getDisplayMedia, clipboard
// WRITE only, fullscreen, autoplay, web-share). Everything else is `()`.
const PERMISSIONS_POLICY = [
  "camera=(self)",
  "microphone=(self)",
  "display-capture=(self)",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "fullscreen=(self)",
  "autoplay=(self)",
  "web-share=(self)",
  "accelerometer=()",
  "ambient-light-sensor=()",
  "battery=()",
  "bluetooth=()",
  "browsing-topics=()",
  "encrypted-media=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "interest-cohort=()",
  "magnetometer=()",
  "midi=()",
  "otp-credentials=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "speaker-selection=()",
  "storage-access=()",
  "sync-xhr=()",
  "usb=()",
  "window-management=()",
  "xr-spatial-tracking=()",
].join(", ");

// Reporting-Endpoints names the same logical sink that CSP's
// `report-to` directive references. Permissions-Policy reports also
// flow through the Reporting API's `default` endpoint group (the spec
// does not define a per-policy reporting directive on the
// Permissions-Policy header value itself), so naming the group
// `default` here means a single endpoint covers both header families.
// Task #252 owns the actual ingestion route; until then browsers have
// nowhere to POST and the header is inert.
const REPORTING_ENDPOINTS = `default="/api/csp-report"`;

app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  res.setHeader("Reporting-Endpoints", REPORTING_ENDPOINTS);
  next();
});

// Task #384 — Onion-Location header.
//
// Tor Browser reads this response header on https clearnet pages
// and surfaces a one-click "this site has an onion version —
// switch?" affordance, with no UI work needed on our side.
//
// Rules of emission (all enforced below):
//   1. Only when ONION_HOSTNAME is configured.
//   2. Only on https responses — Tor Browser ignores it on http.
//   3. Never when the inbound request itself arrived via the
//      onion (Host header ends in `.onion`) — that would create
//      a no-op switch prompt / redirect loop.
//   4. Path-equivalent: the value carries the same `req.originalUrl`
//      the user was reading, so the prompt lands them on the
//      same page they were on, not the homepage. Per Tor Browser
//      behaviour, the prompt only fires when the header's path
//      matches the current path.
//
// `http://` is the right scheme for the value: production .onion
// services in the published runbook (docs/onion-mirror-runbook.md
// §"Provisioning a Tor hidden service in front of the API") run
// on plain HTTP — TLS termination happens inside the Tor network
// at the rendezvous point. The Onion-Location spec accepts
// `http://*.onion`. Emitting `https://` here would point users at
// a port that does not exist.
//
// ONION_HOSTNAME / ONION_HOST_VALID are defined above the helmet block —
// the CSP connect-src allow-list needs them before this middleware does.
app.use((req, res, next) => {
  if (!ONION_HOST_VALID) return next();
  // req.protocol respects `trust proxy` (set above), so this is
  // "https" when X-Forwarded-Proto: https is provided by the
  // trusted edge — the production case behind the Replit /
  // nginx proxy.
  if (req.protocol !== "https") return next();
  const inboundHost = (req.hostname ?? "").toLowerCase();
  if (inboundHost.endsWith(".onion")) return next();
  res.setHeader(
    "Onion-Location",
    `http://${ONION_HOSTNAME}${req.originalUrl}`,
  );
  next();
});

// CORS is registered AFTER helmet + Permissions-Policy so that the
// security headers are present even on the 204 OPTIONS preflight that
// the cors middleware short-circuits before reaching any downstream
// handler. (Property #3 of the Task #256 regression test.)
// CodeQL #11: never reflect arbitrary origins. When no origin can be
// derived (fresh default self-host install), fail closed with `false` —
// same-origin requests are not CORS requests, so the SPA served from
// this very server keeps working; only cross-origin callers are refused.
app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Task #374: one-line-per-request access log. Registered after the
// body parsers so the logger sees the same `req.originalUrl` the
// route saw. Success-path URLs are scrubbed of 32-hex room IDs
// before they hit disk; 4xx/5xx URLs are left intact for triage.
// The published policy on /why ("WHAT WE LOG") names exactly the
// fields written here, and a regression test in
// __tests__/access-log-scrub.test.ts asserts the 2xx URL has no
// room ID and the 4xx URL still does.
app.use(httpAccessLogger());

app.use("/api", router);

if (process.env["SERVE_STATIC"] === "1") {
  const clientDist = path.resolve(process.env["CLIENT_DIST"] || "./client");
  app.use(express.static(clientDist, { maxAge: "1h" }));

  // Per-route Open Graph HTML files. The client build (gen-og-pages.mjs)
  // emits one <slug>.html per marketing route AND writes og-routes.json —
  // a { "<path>": "<slug>.html" } map — into the dist folder. Loading the
  // map from that file means adding a new route to og-routes.mjs and
  // rebuilding the client is the only step required; no code change here.
  const ogManifestPath = path.join(clientDist, "og-routes.json");
  let ogRouteFiles: Record<string, string> = {};
  if (existsSync(ogManifestPath)) {
    try {
      ogRouteFiles = JSON.parse(readFileSync(ogManifestPath, "utf8"));
    } catch (err) {
      console.warn(
        `[app] Failed to parse og-routes.json at ${ogManifestPath}: ${err}. ` +
          `Per-route OG metadata will not be served.`,
      );
    }
  } else {
    console.warn(
      `[app] og-routes.json not found at ${ogManifestPath}. ` +
        `Per-route OG metadata will not be served. ` +
        `Run the void-client build to generate the manifest.`,
    );
  }

  // Catch-all for the SPA. Express 5 / path-to-regexp v8 rejects bare
  // `"*"` strings, so use a RegExp literal — semantically equivalent.
  app.get(/.*/, (req, res) => {
    // Normalize trailing slash so /compare and /compare/ both pick up
    // the per-route card. The TOML rewrite table doesn't currently have
    // trailing-slash variants, but in self-host mode we can be lenient.
    const normalizedPath =
      req.path.length > 1 && req.path.endsWith("/")
        ? req.path.slice(0, -1)
        : req.path;
    const fileName = ogRouteFiles[normalizedPath];
    if (fileName) {
      const candidate = path.join(clientDist, fileName);
      // sendFile resolves errors via the callback; if the per-route HTML
      // is missing for any reason (build skipped gen-og-pages, file got
      // pruned), fall back to index.html so the SPA still works rather
      // than returning a 404 to a real user.
      res.sendFile(candidate, (err) => {
        if (err) {
          res.sendFile(path.join(clientDist, "index.html"));
        }
      });
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

// Custom 404 + error handlers — Express's default `finalhandler`
// forcibly overwrites `Content-Security-Policy` to `default-src 'none'`
// on error responses, which would break the Task #256 invariant that
// helmet's full header surface persists on 4xx / 5xx responses.
// Sending the response ourselves keeps every Set-Header that helmet
// applied earlier in the middleware chain.
app.use((_req, res) => {
  res.status(404).type("text/plain").send("Not Found");
});

// 4-arg signature is required for Express to recognize this as an
// error-handling middleware. If headers have already been sent (e.g.
// the route streamed a partial response before throwing), delegate to
// Express's default handler so the connection is closed cleanly
// instead of being silently abandoned.
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  res.status(500).type("text/plain").send("Internal Server Error");
});

export default app;
